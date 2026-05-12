import React, { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Volume2, Save, Loader2, Image as ImageIcon, RefreshCw } from "lucide-react";
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error("請上傳圖片檔案");
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = (event.target?.result as string).split(',')[1];
      setPreviewImage(event.target?.result as string);
      processImage(base64);
    };
    reader.readAsDataURL(file);
  };

  const processImage = async (base64: string) => {
    setIsUploading(true);
    try {
      const result = await extractVocabFromImage(base64);
      setExtractedItems(result.map((item: any) => ({
        ...item,
        id: Math.random().toString(36).substr(2, 9)
      })));
      toast.success("辨識完成！");
    } catch (error) {
      console.error(error);
      toast.error("辨識失敗，請稍後再試");
    } finally {
      setIsUploading(false);
    }
  };

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  const saveToCloud = async (item: VocabEntry) => {
    if (!auth.currentUser) {
      toast.error("請先登入");
      return;
    }

    setIsSaving(item.id);
    try {
      // Duplicate check
      const q = query(
        collection(db, "vocab"),
        where("creatorId", "==", auth.currentUser.uid),
        where("word", "==", item.word)
      );
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        toast.info(`單字 "${item.word}" 已存在於您的雲端庫中`);
        // We could ask to update here, but for now we'll just prevent duplicate
        setIsSaving(null);
        return;
      }

      await addDoc(collection(db, "vocab"), {
        ...item,
        creatorId: auth.currentUser.uid,
        createdAt: serverTimestamp(),
      });
      toast.success(`已將 "${item.word}" 加入雲端資料庫`);
      setExtractedItems(prev => {
        const newItems = prev.filter(i => i.id !== item.id);
        if (newItems.length === 0) {
          setPreviewImage(null); // Clear preview when all items saved
        }
        return newItems;
      });
  } catch (error) {
      console.error(error);
      toast.error("存檔失敗");
    } finally {
      setIsSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className={`border-dashed border-2 bg-slate-50/50 hover:bg-slate-50 transition-colors cursor-pointer overflow-hidden relative ${previewImage ? 'border-none bg-slate-100 shadow-inner' : ''}`}>
        <input 
          type="file" 
          className="hidden" 
          ref={fileInputRef} 
          accept="image/*" 
          onChange={handleFileChange}
        />
        <CardContent 
          className={`flex flex-col items-center justify-center text-center transition-all duration-500 ${previewImage ? 'p-0 min-h-[700px]' : 'p-12 h-64'}`}
          onClick={() => fileInputRef.current?.click()}
        >
          {previewImage ? (
            <div className="w-full h-full flex items-center justify-center bg-slate-900 overflow-hidden group">
              <img src={previewImage} alt="Preview" className="max-w-full max-h-[700px] object-contain shadow-2xl transition-transform duration-300 group-hover:scale-[1.02]" />
              
              <div className="absolute top-4 right-4 z-20">
                <div className="flex items-center gap-2 bg-black/50 backdrop-blur-md px-4 py-2 rounded-full shadow-lg border border-white/20 text-white hover:bg-black/70 transition-all scale-100 active:scale-95">
                  <RefreshCw className="h-4 w-4" />
                  <span className="text-xs font-bold">更換圖片</span>
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
                  <Button variant="ghost" size="icon" onClick={() => speak(item.word)} className="text-slate-400 hover:text-primary">
                    <Volume2 className="h-5 w-5" />
                  </Button>
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
