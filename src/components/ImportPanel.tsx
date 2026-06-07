import React, { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Volume2, Save, Loader2, Image as ImageIcon, RefreshCw, Star, FolderOpen, Play, CheckCircle2, AlertCircle, XCircle, Trash2 } from "lucide-react";
import { extractVocabFromImage } from "@/services/geminiService";
import { db, auth } from "@/lib/firebase";
import { collection, addDoc, serverTimestamp, query, where, getDocs, doc, updateDoc } from "firebase/firestore";
import { toast } from "sonner";
import { VocabEntry } from "@/types";

export function ImportPanel() {
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [extractedItems, setExtractedItems] = useState<VocabEntry[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [hasExtractedThisSession, setHasExtractedThisSession] = useState(false);
  const [showDeletionBanner, setShowDeletionBanner] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentFileHandleRef = useRef<any>(null);

  // 📂 批次題目資料夾處理狀態 (Batch Directory Processing States)
  const [activeMode, setActiveMode] = useState<'single' | 'batch'>('single');
  const [dirHandle, setDirHandle] = useState<any>(null);
  const [batchQueue, setBatchQueue] = useState<{
    id: string;
    name: string;
    handle: any;
    status: 'pending' | 'processing' | 'done' | 'skipped' | 'failed';
    message: string;
    wordFound?: string;
  }[]>([]);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [currentProgress, setCurrentProgress] = useState(0);

  // 1. 開啟資料夾 & 掃描圖片
  const handleSelectFolder = async () => {
    if (!('showDirectoryPicker' in window)) {
      toast.error("目前瀏覽器不支援讀取本機資料夾。請使用 Windows 版或 macOS 版 Google Chrome 瀏覽器！", {
        description: "File System Access API 限於部分主流桌面瀏覽器運作。"
      });
      return;
    }

    try {
      const directoryHandle = await (window as any).showDirectoryPicker({
        id: 'vocab-quiz-folder-import',
        mode: 'readwrite'
      });

      setDirHandle(directoryHandle);
      
      const files: any[] = [];
      for await (const entry of directoryHandle.values()) {
        if (entry.kind === 'file') {
          const nameLower = entry.name.toLowerCase();
          if (
            nameLower.endsWith('.png') || 
            nameLower.endsWith('.jpg') || 
            nameLower.endsWith('.jpeg') || 
            nameLower.endsWith('.webp')
          ) {
            files.push({
              id: Math.random().toString(36).substr(2, 9),
              name: entry.name,
              handle: entry,
              status: 'pending',
              message: '等待處理'
            });
          }
        }
      }

      if (files.length === 0) {
        toast.warning("選取的資料夾中，沒有找到任何 PNG / JPG / WEBP 格式的題目圖片！");
        setBatchQueue([]);
      } else {
        setBatchQueue(files);
        toast.success(`成功讀取資料夾！共找到 ${files.length} 張候選題目圖片 📂`);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error("Open directory error:", err);
        toast.error(`開啟資料夾失敗: ${err.message}`);
      }
    }
  };

  // 2. 開始批次辨識、對照資料庫、存檔與刪除圖片
  const handleStartBatchProcessing = async () => {
    if (!dirHandle || batchQueue.length === 0) return;
    if (!auth.currentUser) {
      toast.error("請先登入後再執行此批次雲端儲存任務");
      return;
    }

    setIsProcessingBatch(true);
    setCurrentProgress(0);

    const checkChrome = isChromeBrowser();

    for (let i = 0; i < batchQueue.length; i++) {
      const item = batchQueue[i];
      if (item.status === 'done' || item.status === 'skipped') {
        continue;
      }

      setBatchQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'processing', message: '正在辨識並萃取及對照庫存...' } : q));

      try {
        const file = await item.handle.getFile();
        
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = async (event) => {
            const dataUrl = event.target?.result as string;
            try {
              const compressedDataUrl = await compressImage(dataUrl);
              resolve(compressedDataUrl.split(',')[1]);
            } catch (canvasErr) {
              resolve(dataUrl.split(',')[1]);
            }
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const mimeType = file.type || "image/png";
        const resultList = await extractVocabFromImage(base64Data, mimeType);

        if (!resultList || resultList.length === 0) {
          setBatchQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'skipped', message: 'AI 辨識無單字，略過' } : q));
          continue;
        }

        let containsWordInCloudDb = false;
        let matchedWords: string[] = [];

        for (const vocab of resultList) {
          const wordClean = vocab.word.trim();
          
          const q = query(
            collection(db, "vocab"),
            where("creatorId", "==", auth.currentUser.uid),
            where("word", "==", wordClean)
          );
          const snapshot = await getDocs(q);

          if (!snapshot.empty) {
            containsWordInCloudDb = true;
            matchedWords.push(wordClean);

            const existingDocId = snapshot.docs[0].id;
            const existingDocData = snapshot.docs[0].data();
            const hasExistingQuiz = !!existingDocData?.quizChallenge;

            if (vocab.quizChallenge) {
              // 確保沒有任何屬性是 undefined，這將 100% 覆蓋並以圖片提取的題目為主 (Overrides the existing database one if different)
              const cleanChallenge: any = {
                sentence: vocab.quizChallenge.sentence || "",
                translation: vocab.quizChallenge.translation || "",
                contextChinese: vocab.quizChallenge.contextChinese || "",
                missingWord: vocab.quizChallenge.missingWord || "",
                source: vocab.quizChallenge.source || ""
              };
              
              if (vocab.quizChallenge.comment !== undefined && vocab.quizChallenge.comment !== null) {
                cleanChallenge.comment = vocab.quizChallenge.comment;
              }

              await updateDoc(doc(db, "vocab", existingDocId), {
                quizChallenge: cleanChallenge
              });
              
              // 記錄此單字題目已用圖片覆寫之狀態
              containsWordInCloudDb = true;
            }
          }
        }

        if (containsWordInCloudDb) {
          let wasDeleted = false;
          // 僅針對原生 Chrome (Desktop/Mobile) 開啟檔案刪除功能
          if (checkChrome) {
            try {
              // 依據參考文件進行檔案刪除：
              // https://developer.chrome.com/docs/capabilities/web-apis/file-system-access#deleting_files_and_folders_in_a_directory
              await dirHandle.removeEntry(item.name);
              wasDeleted = true;
            } catch (delErr: any) {
              console.error("Batch deletion error:", delErr);
            }
          }

          const statusMsg = wasDeleted 
            ? `已對照單字「${matchedWords.join(', ')}」：全新圖片題目已覆蓋並存入雲端，本機圖片已自動刪除 🗑️` 
            : `已對照單字「${matchedWords.join(', ')}」：全新圖片題目已覆蓋並存入雲端 (非純 Chrome 瀏覽器故未刪除檔案)`;

          setBatchQueue(prev => prev.map((q, idx) => idx === i ? { 
            ...q, 
            status: 'done', 
            message: statusMsg,
            wordFound: matchedWords.join(', ')
          } : q));
        } else {
          // Words found on image are NOT in the database! Skip!
          setBatchQueue(prev => prev.map((q, idx) => idx === i ? { 
            ...q, 
            status: 'skipped', 
            message: `單字 (${resultList.map((r: any) => r.word).join(', ')}) 在您的雲端資料庫中找不到，不刪圖片` 
          } : q));
        }
      } catch (err: any) {
        console.error(`Batch item [${item.name}] error:`, err);
        setBatchQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'failed', message: `處理出錯: ${err.message || err}` } : q));
      }

      setCurrentProgress(Math.round(((i + 1) / batchQueue.length) * 100));
      await new Promise(r => setTimeout(r, 600));
    }

    setIsProcessingBatch(false);
    toast.success("批次資料夾處理與儲存題目流程已執行完畢！ ⭐");
  };

  // 3. 清空本頁批次結果與資料夾連結 (Reset / Clear UI for starting fresh)
  const handleClearBatchQueue = () => {
    setDirHandle(null);
    setBatchQueue([]);
    setCurrentProgress(0);
    setIsProcessingBatch(false);
    toast.success("已清空本頁批次結果與資料夾連結，畫面已清空 🧹");
  };

  const toggleHardLocal = (id: string) => {
    setExtractedItems(prev => prev.map(item => 
      item.id === id ? { ...item, isHard: !item.isHard } : item
    ));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    currentFileHandleRef.current = null; // Traditional input doesn't provide handles for deletion
    handleSelectedFile(file);
    // Reset input value so the same file can be selected again if needed
    e.target.value = '';
  };

  const isChromeBrowser = () => {
    const ua = window.navigator.userAgent.toLowerCase();
    // Desktop/Mobile Chrome check
    const isChrome = ua.includes('chrome') || ua.includes('chromium');
    const isSamsung = ua.includes('samsungbrowser');
    const isEdge = ua.includes('edg');
    const isOpera = ua.includes('opr') || ua.includes('opera');
    return isChrome && !isSamsung && !isEdge && !isOpera;
  };

  const handleSelectedFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error("請上傳圖片檔案");
      return;
    }
    
    // Reset state for new image
    setExtractedItems([]);
    setShowDeletionBanner(false);
    setHasExtractedThisSession(false);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      
      // Compress image before sending
      try {
        const compressedDataUrl = await compressImage(dataUrl);
        const mimeType = compressedDataUrl.split(';')[0].split(':')[1];
        const base64 = compressedDataUrl.split(',')[1];
        setPreviewImage(compressedDataUrl);
        processImage(base64, mimeType);
      } catch (err) {
        console.error("Compression failed:", err);
        // Fallback to original if compression fails
        const mimeType = dataUrl.split(';')[0].split(':')[1];
        const base64 = dataUrl.split(',')[1];
        setPreviewImage(dataUrl);
        processImage(base64, mimeType);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleImportClick = async () => {
    // Attempt to use File System Access API to allow Chrome to remember the folder
    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await (window as any).showOpenFilePicker({
          id: 'vocab-master-import', // Using a consistent ID helps Chrome remember the last folder
          types: [
            {
              description: 'Images',
              accept: {
                'image/*': ['.png', '.gif', '.jpeg', '.jpg', '.webp'],
              },
            },
          ],
          multiple: false,
        });
        currentFileHandleRef.current = handle;
        const file = await handle.getFile();
        handleSelectedFile(file);
      } catch (err: any) {
        // User cancelled or other error, fallback to traditional input if it wasn't a cancellation
        if (err.name !== 'AbortError') {
          console.error("showOpenFilePicker error:", err);
          fileInputRef.current?.click();
        }
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const compressImage = (dataUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = dataUrl;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const max_size = 900; // Optimized size for fast OCR and low token cost (900px is more than enough)

        if (width > height) {
          if (width > max_size) {
            height *= max_size / width;
            width = max_size;
          }
        } else {
          if (height > max_size) {
            width *= max_size / height;
            height = max_size;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.72)); // Convert to JPG with 72% quality to reduce payload size and speed up API OCR
      };
      img.onerror = reject;
    });
  };

  const processImage = async (base64: string, mimeType: string) => {
    setIsUploading(true);
    try {
      const result = await extractVocabFromImage(base64, mimeType);
      if (!result || result.length === 0) {
        toast.error("未能從圖片中辨識出單字，請換一張試試");
        return;
      }
      setExtractedItems(result.map((item: any) => ({
        ...item,
        id: Math.random().toString(36).substr(2, 9)
      })));
      setHasExtractedThisSession(true);
      toast.success("辨識完成！");
    } catch (error: any) {
      console.error(error);
      const errorMsg = error?.message || "";
      if (errorMsg.includes("429")) {
        toast.error("系統繁忙中，請稍候再試 (Error 429)");
      } else if (errorMsg.includes("413")) {
        toast.error("圖片檔案太大了");
      } else {
        const detail = errorMsg ? `: ${errorMsg.slice(0, 50)}` : "";
        toast.error(`辨識失敗，請確認網路連線或換張圖片再試${detail}`);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  const attemptFileDeletion = async () => {
    if (currentFileHandleRef.current) {
      const filename = currentFileHandleRef.current.name;
      const handle = currentFileHandleRef.current;
      
      try {
        if (typeof handle.remove !== 'function') {
          toast.error("目前瀏覽器不支援直接刪除功能");
          return;
        }

        // Request permission explicitly for deletion
        const permissionStatus = await handle.requestPermission({ mode: 'readwrite' });
        
        if (permissionStatus === 'granted') {
          await handle.remove();
          toast.success(`已成功刪除截圖：${filename}`);
        } else {
          toast.info("已取消檔案刪除");
        }
      } catch (err: any) {
        console.error("Deletion error:", err);
        if (err.name === 'SecurityError' || err.name === 'NotAllowedError') {
          toast.error("刪除失敗：權限不足", {
            description: "若您使用的是手機，請確保在 Chrome 內開啟並授予權限。"
          });
        } else {
          toast.error(`無法刪除：${err.message}`);
        }
      } finally {
        currentFileHandleRef.current = null;
        setShowDeletionBanner(false);
      }
    }
  };

  const saveToCloud = async (item: VocabEntry) => {
    if (!auth.currentUser) {
      toast.error("請先登入");
      return;
    }

    setIsSaving(item.id);
    try {
      // Determine if this is the last item before state update
      const isLastItem = extractedItems.length === 1;

      // Duplicate check
      const q = query(
        collection(db, "vocab"),
        where("creatorId", "==", auth.currentUser.uid),
        where("word", "==", item.word)
      );
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        toast.warning(`提醒：單字 "${item.word}" 已存在於您的雲端庫中`, {
          duration: 4000,
        });

        const existingDoc = querySnapshot.docs[0];
        // 如果填空/題目是目前資料庫的單字，就把題目也存/更新到雲端資料庫
        if (item.quizChallenge) {
          try {
            const cleanChallenge = JSON.parse(JSON.stringify(item.quizChallenge));
            await updateDoc(doc(db, "vocab", existingDoc.id), {
              quizChallenge: cleanChallenge
            });
            toast.success(`已將全新圖片題目更新並存入雲端資料庫的 "${item.word}" 單字中 📝`);
          } catch (dbErr) {
            console.error("Failed to update quizChallenge for duplicate vocab:", dbErr);
          }
        }

        handleItemCompleted(item);
        
        if (isLastItem) {
          await handleCompletionCleanup();
        }
        
        setIsSaving(null);
        return;
      }

      const { id, ...itemToSave } = JSON.parse(JSON.stringify(item));
      await addDoc(collection(db, "vocab"), {
        ...itemToSave, // 這將一併寫入從截圖提取的 quizChallenge
        isHard: item.isHard || false,
        creatorId: auth.currentUser.uid,
        createdAt: serverTimestamp(),
      });
      toast.success(`已將 "${item.word}" 及其截圖題目成功加入雲端資料庫 🚀`);
      handleItemCompleted(item);

      if (isLastItem) {
        await handleCompletionCleanup();
      }
    } catch (error) {
      console.error(error);
      toast.error("存檔失敗");
    } finally {
      setIsSaving(null);
    }
  };

  const handleCompletionCleanup = async () => {
    const fileHandle = currentFileHandleRef.current;
    
    // Force clear results list immediately
    setExtractedItems([]);
    setPreviewImage(null);
    setHasExtractedThisSession(false);
    setShowDeletionBanner(false);

    // Chrome specific deletion prompt
    if (fileHandle && isChromeBrowser()) {
      const filename = fileHandle.name;
      if (window.confirm(`所有單字已存入雲端！\n\n是否從您的裝置中刪除這張截圖 [${filename}]？`)) {
        await attemptFileDeletion();
      } else {
        currentFileHandleRef.current = null;
      }
    } else {
      currentFileHandleRef.current = null;
      toast.success("所有單字已成功同步到雲端！");
    }
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleItemCompleted = (itemToRemove: VocabEntry) => {
    setExtractedItems(prev => prev.filter(i => i.id !== itemToRemove.id));
  };

  const clearResults = () => {
    if (currentFileHandleRef.current && isChromeBrowser()) {
      const filename = currentFileHandleRef.current.name;
      if (window.confirm(`是否要放棄目前的辨識結果，並嘗試刪除裝置中的原始圖片 [${filename}]？`)) {
        attemptFileDeletion();
      } else {
        currentFileHandleRef.current = null;
      }
    } else {
      currentFileHandleRef.current = null;
    }
    setExtractedItems([]);
    setPreviewImage(null);
    setHasExtractedThisSession(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast.info("已清空辨識結果");
  };

  return (
    <div className="space-y-6">
      {/* 🔮 頂部模式切換 Tabs */}
      <div className="flex bg-slate-100 p-1.5 rounded-2xl max-w-sm mx-auto shadow-sm border border-slate-200">
        <button
          onClick={() => setActiveMode('single')}
          className={`flex-1 text-center py-2 text-xs font-bold rounded-xl transition-all duration-300 ${activeMode === 'single' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          單張圖片辨識
        </button>
        <button
          onClick={() => setActiveMode('batch')}
          className={`flex-1 text-center py-2 text-xs font-bold rounded-xl transition-all duration-300 ${activeMode === 'batch' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          資料夾批次處理 📂
        </button>
      </div>

      {activeMode === 'single' ? (
        <>
          <Card 
            id="import-drop-zone"
            className={`border-dashed border-2 bg-slate-50/50 hover:bg-slate-50 transition-colors cursor-pointer overflow-hidden relative ${previewImage ? 'border-none bg-slate-100 shadow-inner' : ''}`}
          >
            <input 
              type="file" 
              id="file-input-hidden"
              className="hidden" 
              ref={fileInputRef} 
              accept="image/png, image/jpeg, image/jpg, image/webp" 
              onChange={handleFileChange}
            />
            <CardContent 
              id="import-content-area"
              className={`flex flex-col items-center justify-center text-center transition-all duration-500 ${previewImage ? 'p-0 min-h-[700px]' : 'p-12 h-64'}`}
              onClick={handleImportClick}
            >
              {previewImage ? (
                <div className="w-full h-full flex items-center justify-center bg-slate-900 overflow-hidden group">
                  <img src={previewImage} alt="Preview" className="max-w-full max-h-[700px] object-contain shadow-2xl transition-transform duration-300 group-hover:scale-[1.02]" />
                  
                  <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
                    <div 
                      className="flex items-center gap-2 bg-black/50 backdrop-blur-md px-4 py-2 rounded-full shadow-lg border border-white/20 text-white hover:bg-black/70 transition-all scale-100 active:scale-95"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleImportClick();
                      }}
                    >
                      <RefreshCw className="h-4 w-4" />
                      <span className="text-xs font-bold">更換圖片</span>
                    </div>
                    <div 
                      className="flex items-center gap-2 bg-red-500/80 backdrop-blur-md px-4 py-2 rounded-full shadow-lg border border-white/20 text-white hover:bg-red-600 transition-all scale-100 active:scale-95"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearResults();
                      }}
                    >
                      <RefreshCw className="h-4 w-4 rotate-45" />
                      <span className="text-xs font-bold">放棄辨識</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="relative z-10 space-y-4">
                  <div className="mx-auto w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-md text-primary">
                    {isUploading ? <Loader2 className="h-8 w-8 animate-spin" /> : <Upload className="h-8 w-8" />}
                  </div>
                  <div>
                    <p className="text-lg font-medium">匯入手機截圖辨識</p>
                    <p className="text-sm text-slate-500">支援拖曳或點擊上傳圖片</p>
                  </div>
                </div>
              )}
              
              {isUploading && (
                <div className="absolute inset-0 z-30 bg-white/60 backdrop-blur-sm flex items-center justify-center">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    <p className="text-sm font-bold text-slate-600">AI 正在努力識萃取中...</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {extractedItems.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {extractedItems.map((item) => (
                <Card key={item.id} className="group hover:shadow-md transition-all overflow-hidden border-slate-200">
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-xl text-primary">{item.word}</CardTitle>
                        <CardDescription className="font-mono text-xs">{item.phonetic}</CardDescription>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          id={`star-item-${item.id}`}
                          onClick={() => toggleHardLocal(item.id)} 
                          className={`h-9 w-9 transition-all duration-200 ${item.isHard ? 'text-amber-500 hover:text-amber-600 scale-110' : 'text-slate-300 hover:text-amber-400'}`}
                        >
                          <Star id={`star-icon-${item.id}`} className={`h-5 w-5 transition-all ${item.isHard ? 'fill-amber-500 text-amber-500' : 'text-slate-300'}`} />
                        </Button>
                        <Button id={`speak-btn-${item.id}`} variant="ghost" size="icon" onClick={() => speak(item.word)} className="text-slate-400 hover:text-primary">
                          <Volume2 className="h-5 w-5" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="font-medium text-slate-700 mb-2">{item.translation}</p>
                    <div className="space-y-1">
                      {item.examples.map((ex, i) => (
                        <p key={i} className="text-xs text-slate-500 italic">" {ex} "</p>
                      ))}
                    </div>
                    {item.quizChallenge && (
                      <div className="mt-3 bg-violet-50/50 p-2.5 rounded-xl border border-violet-100 text-[11px] text-violet-800 space-y-1">
                        <p className="font-bold">✨ 已由截圖直接模擬出互動題目：</p>
                        <p className="font-medium line-clamp-1">「{item.quizChallenge.sentence}」</p>
                      </div>
                    )}
                    <Button 
                      id={`save-cloud-btn-${item.id}`}
                      className="w-full mt-4 bg-slate-900 hover:bg-slate-800 text-white gap-2 h-9"
                      onClick={() => saveToCloud(item)}
                      disabled={isSaving === item.id}
                    >
                      {isSaving === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      存入雲端
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          
          {!isUploading && extractedItems.length === 0 && !previewImage && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <ImageIcon className="h-12 w-12 mb-4 opacity-20" />
              <p>尚未識萃取任何單字</p>
            </div>
          )}
        </>
      ) : (
        /* 📂 批次資料夾處理視圖 */
        <div className="space-y-6">
          <Card className="border border-indigo-100 shadow-sm bg-gradient-to-br from-indigo-50/10 via-white to-slate-50 overflow-hidden rounded-2xl">
            <CardHeader>
              <CardTitle className="text-xl text-indigo-950 flex items-center gap-2">
                <FolderOpen className="h-5 w-5 text-indigo-500" />
                本機題目資料夾批次對照、存檔與刪除
              </CardTitle>
              <CardDescription className="text-xs text-slate-500 leading-relaxed">
                選取本機中的題目圖片資料夾。系統會逐張圖片讀取並以 AI 辨識內含單字：若該單字已被收錄至您的雲端資料庫，就會<strong>將全新模擬截圖的填空題目存入該雲端單字中</strong>（模仿原截圖上的各種中英文教育提示），並在<strong>儲存成功後，同步從您的電腦資料夾中自動刪除該圖片</strong>！維持本機清爽！
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  id="select-folder-btn"
                  onClick={handleSelectFolder}
                  disabled={isProcessingBatch}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl flex items-center gap-2 shadow-sm scale-110 active:scale-95 transition-all py-5 px-6"
                >
                  <FolderOpen className="h-4.5 w-4.5" />
                  {dirHandle ? "更換本機資料夾" : "選擇題目資料夾"}
                </Button>

                {batchQueue.length > 0 && (
                  <>
                    <Button
                      id="start-batch-btn"
                      onClick={handleStartBatchProcessing}
                      disabled={isProcessingBatch}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl flex items-center gap-2 shadow-sm scale-110 active:scale-95 transition-all py-5 px-6"
                    >
                      {isProcessingBatch ? (
                        <Loader2 className="h-4.5 w-4.5 animate-spin" />
                      ) : (
                        <Play className="h-4.5 w-4.5 fill-current" />
                      )}
                      {isProcessingBatch ? "批次分析同步中..." : "開始批次處理與同步 🚀"}
                    </Button>

                    <Button
                      id="clear-batch-btn"
                      onClick={handleClearBatchQueue}
                      disabled={isProcessingBatch}
                      variant="outline"
                      className="border-rose-200 bg-rose-50/55 hover:bg-rose-100 text-rose-700 font-semibold rounded-xl flex items-center gap-2 shadow-sm scale-110 active:scale-95 transition-all py-5 px-6"
                    >
                      <Trash2 className="h-4.5 w-4.5 text-rose-500" />
                      清空畫面 🧹
                    </Button>
                  </>
                )}
              </div>

              {dirHandle && (
                <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 flex items-center justify-between border border-slate-100 font-mono">
                  <span>連結本機資料夾：<strong className="text-slate-800">{dirHandle.name}</strong></span>
                  <span>找到候選題目：<strong className="text-indigo-600 font-bold">{batchQueue.length}</strong> 張</span>
                </div>
              )}

              {isProcessingBatch && (
                <div className="space-y-2 animate-in fade-in duration-300 bg-indigo-50/20 p-3 rounded-lg border border-indigo-100">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                    <span>處理進度：{currentProgress}%</span>
                    <span className="animate-pulse text-indigo-500 font-bold">AI 即時萃取及對照雲端資料庫中...</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200">
                    <div 
                      className="bg-gradient-to-r from-indigo-500 to-emerald-500 h-full transition-all duration-500 rounded-full"
                      style={{ width: `${currentProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Chrome File System Deletion Guide Card */}
              <div className="border border-amber-100 bg-amber-50/40 rounded-2xl p-4 text-xs space-y-2 text-amber-800">
                <p className="font-bold flex items-center gap-1">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  重要安全與操作提示：
                </p>
                <ul className="list-disc pl-4 space-y-1.5 text-slate-600 leading-relaxed">
                  <li>本功能呼叫 Chrome 的原生 File System Access API。讀取時，請在頂部彈出視窗授與資料夾「編輯與檢視 (Read/Write)」權限。</li>
                  <li>
                    <strong>安全排除機制</strong>：只有當單字<strong>已存在於您的雲端庫中</strong>且題目寫入完畢，才會移除該單字截圖。若該圖片非庫存單字，則會自動跳過不予刪除，確保本機檔案安全！
                  </li>
                  <li>
                    本技術遵照 
                    <a 
                      href="https://developer.chrome.com/docs/capabilities/web-apis/file-system-access#deleting_files_and_folders_in_a_directory" 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="text-indigo-600 underline font-semibold ml-1 hover:text-indigo-800"
                    >
                      Chrome 官方 File System Access 規範
                    </a>
                     進行設計與開發。
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {batchQueue.length > 0 && (
            <Card className="border border-slate-200 shadow-sm overflow-hidden rounded-2xl">
              <CardHeader className="bg-slate-50/50 pb-3">
                <CardTitle className="text-sm font-bold text-slate-700">題目處理佇列 ({batchQueue.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0 divide-y divide-slate-100 max-h-[450px] overflow-y-auto">
                {batchQueue.map((item) => (
                  <div key={item.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:bg-slate-50/40 transition-colors">
                    <div className="space-y-1 pr-4">
                      <p className="font-bold text-slate-800 font-mono flex items-center gap-1">{item.name}</p>
                      <p className={`font-medium leading-relaxed ${
                        item.status === 'done' ? 'text-emerald-600 font-semibold' :
                        item.status === 'skipped' ? 'text-amber-600' :
                        item.status === 'failed' ? 'text-rose-600' :
                        item.status === 'processing' ? 'text-indigo-600' : 'text-slate-400'
                      }`}>
                        {item.message}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.status === 'pending' && (
                        <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-bold border border-slate-200">待處理</span>
                      )}
                      {item.status === 'processing' && (
                        <span className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 font-bold border border-indigo-100 flex items-center gap-1 animate-pulse">
                          <Loader2 className="h-3 w-3 animate-spin text-indigo-500" />
                          處理中
                        </span>
                      )}
                      {item.status === 'done' && (
                        <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-bold border border-emerald-100 flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          已同步與刪除 💾
                        </span>
                      )}
                      {item.status === 'skipped' && (
                        <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-bold border border-amber-100 flex items-center gap-1">
                          <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                          跳過 (不刪)
                        </span>
                      )}
                      {item.status === 'failed' && (
                        <span className="px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 font-bold border border-rose-100 flex items-center gap-1">
                          <XCircle className="h-3.5 w-3.5 text-rose-500" />
                          失敗
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {batchQueue.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 bg-slate-50/30 rounded-2xl border border-dashed border-slate-200 text-slate-400">
              <FolderOpen className="h-10 w-10 mb-3 opacity-20" />
              <p className="text-sm">請點擊上方按鈕選擇並開啟本機題目資料夾</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
