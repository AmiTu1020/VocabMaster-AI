import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Volume2, Trash2, Search, BookOpen, Loader2 } from "lucide-react";
import { db, auth } from "@/lib/firebase";
import { collection, query, where, onSnapshot, deleteDoc, doc, orderBy } from "firebase/firestore";
import { toast } from "sonner";
import { VocabEntry } from "@/types";

export function LibraryPanel() {
  const [vocab, setVocab] = useState<VocabEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

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

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  const filteredVocab = vocab.filter(item => 
    item.word.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.translation.includes(searchTerm)
  );

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
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-500 flex items-center gap-2">
          <BookOpen className="h-4 w-4" />
          雲端存檔
        </h2>
        <div className="px-3 py-1 bg-slate-100 rounded-full border border-slate-200 shadow-sm">
          <span className="text-xs font-bold text-slate-500">
            單字總數: <span className="text-primary">{vocab.length}</span>
          </span>
        </div>
      </div>

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

      {filteredVocab.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <BookOpen className="h-12 w-12 mb-4 opacity-20" />
          <p>{searchTerm ? "找不到符合的單字" : "目前還沒有已存檔的單字"}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredVocab.map((item) => (
            <Card key={item.id} className="overflow-hidden border-slate-200 hover:border-primary/30 transition-colors shadow-sm">
              <div className="flex items-center px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-slate-900 truncate">{item.word}</span>
                    <span className="text-xs font-mono text-slate-400 truncate">{item.phonetic}</span>
                  </div>
                  <p className="text-sm text-slate-600 truncate">{item.translation}</p>
                </div>
                
                <div className="flex items-center gap-1 shrink-0 ml-4">
                  <Button variant="ghost" size="icon" onClick={() => speak(item.word)} className="h-9 w-9 text-slate-400 hover:text-primary">
                    <Volume2 className="h-5 w-5" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteItem(item.id, item.word)} className="h-9 w-9 text-slate-400 hover:text-red-500">
                    <Trash2 className="h-5 w-5" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
