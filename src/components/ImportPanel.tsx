import React, { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Volume2, Save, Loader2, Image as ImageIcon, RefreshCw, Star } from "lucide-react";
import { extractVocabFromImage } from "@/services/geminiService";
import { db, auth } from "@/lib/firebase";
import { collection, addDoc, serverTimestamp, query, where, getDocs } from "firebase/firestore";
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
        const max_size = 1200; // Reduced for mobile reliability

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
        resolve(canvas.toDataURL('image/jpeg', 0.8)); // Convert to JPG with 80% quality
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
        handleItemCompleted(item);
        
        if (isLastItem) {
          await handleCompletionCleanup();
        }
        
        setIsSaving(null);
        return;
      }

      const { id, ...itemToSave } = item;
      await addDoc(collection(db, "vocab"), {
        ...itemToSave,
        isHard: item.isHard || false,
        creatorId: auth.currentUser.uid,
        createdAt: serverTimestamp(),
      });
      toast.success(`已將 "${item.word}" 加入雲端資料庫`);
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
    </div>
  );
}
