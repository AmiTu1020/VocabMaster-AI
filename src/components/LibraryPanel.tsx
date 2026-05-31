import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Volume2, Trash2, Search, BookOpen, Loader2, Play, Pause, Square, Star, StarOff, Filter } from "lucide-react";
import { db, auth } from "@/lib/firebase";
import { collection, query, where, onSnapshot, deleteDoc, doc, orderBy, updateDoc, setDoc } from "firebase/firestore";
import { toast } from "sonner";
import { VocabEntry } from "@/types";

export function LibraryPanel() {
  const [vocab, setVocab] = useState<VocabEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMode, setFilterMode] = useState<'all' | 'hard'>('all');
  const [touringIndex, setTouringIndex] = useState<number>(-1);
  const [isPaused, setIsPaused] = useState(false);
  const tourTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  const filteredVocab = vocab.filter(item => {
    const matchesSearch = item.word.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.translation.includes(searchTerm);
    const matchesFilter = filterMode === 'all' || item.isHard === true;
    return matchesSearch && matchesFilter;
  });

  // Vocabulary Tour Logic
  useEffect(() => {
    if (touringIndex >= 0 && touringIndex < filteredVocab.length && !isPaused) {
      const currentItem = filteredVocab[touringIndex];
      
      // Auto scroll to the current item
      const element = document.getElementById(`vocab-${currentItem.id}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      // Speak the word
      speak(currentItem.word);

      // Wait and move to next
      tourTimeoutRef.current = setTimeout(() => {
        if (touringIndex < filteredVocab.length - 1) {
          setTouringIndex(prev => prev + 1);
        } else {
          // Finished
          setTouringIndex(-1);
          toast.success("單字連播結束！");
        }
      }, 4500); // 4.5 seconds per word for memorization
    }

    return () => {
      if (tourTimeoutRef.current) clearTimeout(tourTimeoutRef.current);
    };
  }, [touringIndex, isPaused, filteredVocab.length]);

  const startTour = () => {
    if (filteredVocab.length === 0) return;
    setTouringIndex(0);
    setIsPaused(false);
    toast.info("開始單字連播播放...");
  };

  const togglePause = () => {
    setIsPaused(!isPaused);
    if (!isPaused) {
      toast.info("已暫停播放");
    } else {
      toast.info("繼續播放");
    }
  };

  const stopTour = () => {
    setTouringIndex(-1);
    setIsPaused(false);
    if (tourTimeoutRef.current) clearTimeout(tourTimeoutRef.current);
  };

  useEffect(() => {
    if (!auth.currentUser) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, "vocab"),
      where("creatorId", "==", auth.currentUser.uid),
      orderBy("word", "asc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as VocabEntry[];
      setVocab(docs);
      setLoading(false);
    }, (error) => {
      console.error(error);
      toast.error("讀取資料失敗");
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const deleteItem = async (id: string, word: string) => {
    if (!confirm(`確定要刪除 "${word}" 嗎？`)) return;

    try {
      await deleteDoc(doc(db, "vocab", id));
      toast.success("已刪除");
    } catch (error) {
      console.error(error);
      toast.error("刪除失敗");
    }
  };

  const toggleHard = async (id: string, currentStatus: boolean, word: string) => {
    if (!auth.currentUser) {
      toast.error("請先登入");
      return;
    }

    // Optimistic local state update
    setVocab(prev => prev.map(item => 
      item.id === id ? { ...item, isHard: !currentStatus } : item
    ));

    try {
      const docRef = doc(db, "vocab", id);
      await updateDoc(docRef, {
        isHard: !currentStatus
      });
      
      if (!currentStatus) {
        toast.success(`已將 "${word}" 標記為常忘單字`);
      } else {
        toast.info(`已取消 "${word}" 的標記`);
      }
    } catch (error: any) {
      // Revert local state if error
      setVocab(prev => prev.map(item => 
        item.id === id ? { ...item, isHard: currentStatus } : item
      ));
      
      console.error("Firestore Update Error:", error);
      let errorMessage = "更新失敗";
      if (error?.code === 'permission-denied') {
        errorMessage = "更新失敗：權限不足";
      }
      toast.error(errorMessage);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin mb-4" />
        <p>載入中...</p>
      </div>
    );
  }

  if (!auth.currentUser) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <BookOpen className="h-12 w-12 mb-4 opacity-20" />
        <p>請先登入以查看雲端單字庫</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between sticky top-[64px] z-20 bg-white/95 backdrop-blur-md py-3 border-b border-slate-100 -mx-4 px-4 sm:-mx-1 sm:px-1 shadow-sm sm:shadow-none">
        <h2 className="text-sm font-bold text-slate-500 flex items-center gap-2">
          <BookOpen className="h-4 w-4" />
          雲端存檔
        </h2>
        <div className="flex items-center gap-2">
          {filteredVocab.length > 0 && (
            <div className="flex items-center bg-white border border-slate-200 rounded-lg p-1 shadow-sm gap-1">
              {touringIndex === -1 ? (
                <Button variant="ghost" size="sm" onClick={startTour} className="h-8 gap-1 text-primary hover:bg-primary/5">
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span className="text-xs font-bold">單字連播</span>
                </Button>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={togglePause} className="h-8 gap-1 text-amber-500 hover:bg-amber-50">
                    {isPaused ? <Play className="h-3.5 w-3.5 fill-current" /> : <Pause className="h-3.5 w-3.5 fill-current" />}
                    <span className="text-xs font-bold">{isPaused ? "繼續" : "暫停"}</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={stopTour} className="h-8 gap-1 text-slate-500 hover:bg-slate-50">
                    <Square className="h-3.5 w-3.5 fill-current" />
                    <span className="text-xs font-bold">停止</span>
                  </Button>
                </>
              )}
            </div>
          )}
          <div className="px-3 py-1 bg-slate-100 rounded-full border border-slate-200 shadow-sm">
            <span className="text-xs font-bold text-slate-500">
              單字總數: <span className="text-primary">{filteredVocab.length}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="relative space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input 
            type="text" 
            placeholder="搜尋單字或翻譯..." 
            className="w-full bg-white border border-slate-200 rounded-xl h-11 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex gap-2 p-1 bg-slate-100 rounded-lg w-fit">
          <Button 
            variant={filterMode === 'all' ? 'secondary' : 'ghost'} 
            size="sm" 
            onClick={() => setFilterMode('all')}
            className={`h-8 rounded-md px-3 text-xs font-bold transition-all ${filterMode === 'all' ? 'bg-white shadow-sm text-primary' : 'text-slate-500 hover:text-slate-700'}`}
          >
            全部單字
          </Button>
          <Button 
            variant={filterMode === 'hard' ? 'secondary' : 'ghost'} 
            size="sm" 
            onClick={() => setFilterMode('hard')}
            className={`h-8 rounded-md px-3 text-xs font-bold transition-all flex items-center gap-1.5 ${filterMode === 'hard' ? 'bg-white shadow-sm text-amber-600' : 'text-slate-500'}`}
          >
            <Star className={`h-3 w-3 ${filterMode === 'hard' ? 'fill-amber-500 text-amber-500' : 'text-slate-400'}`} />
            常忘單字
          </Button>
        </div>
      </div>

      {filteredVocab.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <BookOpen className="h-12 w-12 mb-4 opacity-20" />
          <p>{searchTerm ? "找不到符合的單字" : "目前還沒有已存檔的單字"}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredVocab.map((item, index) => {
            const isBeingToured = touringIndex === index;
            return (
              <Card 
                key={item.id} 
                id={`vocab-${item.id}`}
                className={`overflow-hidden transition-all shadow-sm ${
                  isBeingToured 
                    ? "border-primary ring-2 ring-primary/20 bg-primary/5 scale-[1.02] z-10" 
                    : "border-slate-200 hover:border-primary/30"
                }`}
              >
                <div className="flex items-center px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-slate-900 truncate">{item.word}</span>
                    <span className="text-xs font-mono text-slate-400 truncate">{item.phonetic}</span>
                  </div>
                  <p className="text-sm text-slate-600 truncate">{item.translation}</p>
                </div>
                
                <div className="flex items-center gap-1 shrink-0 ml-4">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => toggleHard(item.id, !!item.isHard, item.word)} 
                    className={`h-9 w-9 transition-all duration-200 ${item.isHard ? 'text-amber-500 hover:text-amber-600 scale-110' : 'text-slate-300 hover:text-amber-400'}`}
                  >
                    <Star className={`h-5 w-5 transition-all ${item.isHard ? 'fill-amber-500 text-amber-500' : 'text-slate-300'}`} />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => speak(item.word)} className="h-9 w-9 text-slate-400 hover:text-primary">
                    <Volume2 className="h-5 w-5" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteItem(item.id, item.word)} className="h-9 w-9 text-slate-400 hover:text-red-500">
                    <Trash2 className="h-5 w-5" />
                  </Button>
                </div>
              </div>
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
