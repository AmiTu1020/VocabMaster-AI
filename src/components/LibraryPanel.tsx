import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Volume2, Trash2, Search, BookOpen, Loader2, Play, Pause, Square, Star, StarOff, Filter, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { db, auth } from "@/lib/firebase";
import { collection, query, where, onSnapshot, deleteDoc, doc, orderBy, updateDoc, setDoc } from "firebase/firestore";
import { toast } from "sonner";
import { VocabEntry } from "@/types";

// Helpers to clean up verbose/repetitive instruction text from display
const getCleanContextChinese = (ctx: string | undefined): string => {
  if (!ctx) return "";
  let cleaned = ctx.trim();
  
  cleaned = cleaned.replace(/挑戰練習：?根據語意情境拼寫出正確的英文單字：?/g, "");
  cleaned = cleaned.replace(/挑戰練習：?根據語意情境拼寫出正確的英文單字/g, "");
  cleaned = cleaned.replace(/挑戰練習：?/g, "");
  cleaned = cleaned.replace(/根據語意情境拼寫出正確的英文單字：?/g, "");
  cleaned = cleaned.replace(/針對特定決定提出看法時，試著誠實、具建設性地回應：?/g, "");
  cleaned = cleaned.replace(/當長官對你的決定提出質疑時，試著誠實、具建設性地回應：?/g, "");
  cleaned = cleaned.replace(/句中空格之單字代表.*?填空挑戰.*?/g, "");
  
  cleaned = cleaned.trim();
  if (/^[：:\s]*$/.test(cleaned) || cleaned === "挑戰與情境提示：" || cleaned === "挑戰與情境提示") {
    return "";
  }
  return cleaned;
};

const getCleanTranslation = (trans: string | undefined, originalTranslation: string, sentence?: string): string => {
  if (!trans) return originalTranslation;
  let cleaned = trans.trim();
  
  // Strip various boilerplate text that the AI or fallback might have included
  const removePatterns = [
    /請根據上下文寫出對應作答[（\(]提示：單字中文為「.*?」[）\)]/g,
    /請根據上下文寫出對應作答/g,
    /[（\(]提示：單字中文為「.*?」[）\)]/g,
    /提示：單字中文為「.*?」/g,
    /提示：/g,
    /[（\(]句中空格之單字代表「?.*?」?之語意，試著填空挑戰。?[）\)]/g,
    /句中空格之單字代表「?.*?」?之語意，試著填空挑戰。?/g,
    /[（\(]配合上下文填入最適合的單字。?[）\)]/g,
    /配合上下文填入最適合的單字。?/g,
    /[（\(]填空挑戰。?[）\)]/g,
    /填空挑戰。?/g,
    /[（\(]請依上下文.*?[）\)]/g,
    /請依上下文.*?/g,
    /[（\(]讀音為.*?[）\)]/g
  ];

  removePatterns.forEach(pattern => {
    cleaned = cleaned.replace(pattern, "");
  });

  // Clean empty parens that might be left behind
  cleaned = cleaned.replace(/[（\(]\s*[）\)]/g, "");
  
  cleaned = cleaned.trim();
  
  if (!cleaned || cleaned === originalTranslation) {
    if (sentence) {
      const lowerS = sentence.toLowerCase().trim();
      if (lowerS.startsWith("don't be") || lowerS.includes(" don't be")) {
        const meaning = originalTranslation.replace(/的$/, "");
        return `不要${meaning}`;
      }
    }
    return originalTranslation;
  }

  return cleaned;
};

const processMixedSentence = (sentence: string) => {
  if (!sentence) return { english: "", extractedChinese: "" };
  
  // Find index of first Chinese character
  const chineseMatch = sentence.match(/[\u4e00-\u9fa5]/);
  if (chineseMatch && typeof chineseMatch.index === 'number') {
    const englishPart = sentence.substring(0, chineseMatch.index).trim().replace(/[\s\-\,\.\(\)（）]+$/, "");
    const chinesePart = sentence.substring(chineseMatch.index).trim();
    
    // Ensure English sentence has ending punctuation if stripped
    const cleanEnglish = englishPart + (/[a-zA-Z0-9]$/.test(englishPart) ? "." : "");
    return {
      english: cleanEnglish,
      extractedChinese: chinesePart
    };
  }
  
  return { english: sentence, extractedChinese: "" };
};

export function LibraryPanel() {
  const [vocab, setVocab] = useState<VocabEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMode, setFilterMode] = useState<'all' | 'hard'>('all');
  const [quizFilter, setQuizFilter] = useState<'all' | 'hasQuiz' | 'noQuiz'>('all');
  const [expandedChallengeId, setExpandedChallengeId] = useState<string | null>(null);
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
    
    // Check quiz filter condition
    const matchesQuiz = quizFilter === 'all' ||
                        (quizFilter === 'hasQuiz' && !!item.quizChallenge) ||
                        (quizFilter === 'noQuiz' && !item.quizChallenge);

    return matchesSearch && matchesFilter && matchesQuiz;
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

  // Stats for classification
  const totalCount = vocab.length;
  const hardCount = vocab.filter(item => item.isHard).length;
  const withQuizCount = vocab.filter(item => item.quizChallenge).length;
  const withoutQuizCount = Math.max(0, totalCount - withQuizCount);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between sticky top-[64px] z-20 bg-white/95 backdrop-blur-md py-3 border-b border-slate-100 -mx-4 px-4 sm:-mx-1 sm:px-1 shadow-sm sm:shadow-none">
        <h2 className="text-sm font-bold text-slate-500 flex items-center gap-2">
          <BookOpen className="h-4 w-4" />
          雲端存檔 / 智慧分類
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
              篩選後單字: <span className="text-primary">{filteredVocab.length}</span> / {totalCount}
            </span>
          </div>
        </div>
      </div>

      {/* Classification Bento Grid Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-center sm:text-left transition-all shadow-sm">
          <p className="text-[10px] font-bold text-slate-400">總儲存單字</p>
          <p className="text-lg font-extrabold text-slate-800">{totalCount} <span className="text-xs font-medium text-slate-400">字</span></p>
        </div>
        <div className="bg-amber-50 md:bg-amber-50/50 border border-amber-100 rounded-xl p-3 text-center sm:text-left transition-all shadow-sm">
          <p className="text-[10px] font-bold text-amber-600 flex items-center justify-center sm:justify-start gap-1">
            <Star className="h-3 w-3 fill-amber-500 text-amber-500" /> 常忘標記
          </p>
          <p className="text-lg font-extrabold text-amber-700">{hardCount} <span className="text-xs font-medium text-slate-400">字</span></p>
        </div>
        <div className="bg-purple-50 md:bg-purple-50/50 border border-purple-100/80 rounded-xl p-3 text-center sm:text-left transition-all shadow-sm">
          <p className="text-[10px] font-bold text-purple-600 flex items-center justify-center sm:justify-start gap-1">
            <Sparkles className="h-3 w-3 text-purple-500 animate-pulse" /> 已存 AI 測驗
          </p>
          <p className="text-lg font-extrabold text-purple-700">
            {withQuizCount} <span className="text-xs font-medium text-purple-400">({totalCount > 0 ? Math.round((withQuizCount / totalCount) * 100) : 0}%)</span>
          </p>
        </div>
        <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-center sm:text-left transition-all shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 flex items-center justify-center sm:justify-start gap-1">
            待生成測驗
          </p>
          <p className="text-lg font-extrabold text-slate-600">{withoutQuizCount} <span className="text-xs font-medium text-slate-400">字</span></p>
        </div>
      </div>

      <div className="relative space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input 
            type="text" 
            placeholder="搜尋單字、音標、或中文翻譯..." 
            className="w-full bg-white border border-slate-200 rounded-xl h-11 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        {/* Dual Axis Filtering Ribbon */}
        <div className="flex flex-col gap-2 bg-slate-50 border border-slate-100 p-2 rounded-xl">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold text-slate-400 w-12 shrink-0">常忘分類:</span>
            <div className="flex gap-1 p-0.5 bg-slate-200/60 rounded-md">
              <button 
                onClick={() => setFilterMode('all')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-sm transition-all ${filterMode === 'all' ? 'bg-white text-primary shadow-xs font-bold' : 'text-slate-500 hover:text-slate-800'}`}
              >
                全部常忘狀態
              </button>
              <button 
                onClick={() => setFilterMode('hard')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-sm transition-all flex items-center gap-1 ${filterMode === 'hard' ? 'bg-white text-amber-600 shadow-xs font-bold' : 'text-slate-500 hover:text-amber-600'}`}
              >
                <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                常忘單字
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200/50 pt-2">
            <span className="text-[10px] font-bold text-slate-400 w-12 shrink-0">測驗分類:</span>
            <div className="flex gap-1 p-0.5 bg-slate-200/60 rounded-md">
              <button 
                onClick={() => setQuizFilter('all')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-sm transition-all ${quizFilter === 'all' ? 'bg-white text-primary shadow-xs font-bold' : 'text-slate-500 hover:text-slate-800'}`}
              >
                全部測驗狀態
              </button>
              <button 
                onClick={() => setQuizFilter('hasQuiz')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-sm transition-all flex items-center gap-1 ${quizFilter === 'hasQuiz' ? 'bg-white text-purple-600 shadow-xs font-bold' : 'text-slate-500 hover:text-purple-600'}`}
              >
                <Sparkles className="h-3 w-3 text-purple-500" />
                已存 AI 測驗 ({withQuizCount})
              </button>
              <button 
                onClick={() => setQuizFilter('noQuiz')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-sm transition-all flex items-center gap-1 ${quizFilter === 'noQuiz' ? 'bg-white text-slate-750 shadow-xs font-bold' : 'text-slate-500 hover:text-slate-700'}`}
              >
                待生成測驗 ({withoutQuizCount})
              </button>
            </div>
          </div>
        </div>
      </div>

      {filteredVocab.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <BookOpen className="h-12 w-12 mb-4 opacity-20" />
          <p>{searchTerm ? "找不到符合此篩選條件的單字" : "目前還沒有已存檔的單字"}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredVocab.map((item, index) => {
            const isBeingToured = touringIndex === index;
            const hasQuiz = !!item.quizChallenge;
            const isChallengeExpanded = expandedChallengeId === item.id;

            return (
              <Card 
                key={`lib-vocab-${item.id}-${index}`} 
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
                      {item.phonetic && (
                        <span className="text-xs font-mono text-slate-400 truncate">{item.phonetic}</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 truncate">{item.translation}</p>
                    
                    {/* Inline classification tags */}
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {item.isHard && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-600 border border-amber-100">
                          <Star className="h-2.5 w-2.5 fill-amber-500 text-amber-500" />
                          常忘
                        </span>
                      )}
                      {hasQuiz ? (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-50 text-purple-600 border border-purple-100">
                          <Sparkles className="h-2.5 w-2.5 text-purple-500" />
                          已存 AI 測驗
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-50 text-slate-400 border border-slate-100">
                          待生成測驗
                        </span>
                      )}
                    </div>
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

                {/* Collapsible Stored Quiz Challenge Section */}
                {hasQuiz && (
                  <div className="border-t border-slate-100 bg-slate-50/40">
                    <button 
                      onClick={() => setExpandedChallengeId(isChallengeExpanded ? null : item.id)}
                      className="w-full flex items-center justify-between px-4 py-2 text-[11px] font-bold text-slate-500 hover:text-purple-600 hover:bg-slate-50 transition-all"
                    >
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="h-3 w-3 text-purple-500" />
                        {isChallengeExpanded ? "隱藏內建 AI 情境題目" : "點此展開已存 AI 測驗情境題目"}
                      </span>
                      {isChallengeExpanded ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                    </button>
                    
                    {isChallengeExpanded && (() => {
                      const { english: cleanSentence, extractedChinese } = processMixedSentence(item.quizChallenge.sentence);
                      
                      let baseTranslation = item.quizChallenge.translation || "";
                      if (extractedChinese) {
                        const cleanExtracted = getCleanTranslation(extractedChinese, "", cleanSentence);
                        const cleanTrans = getCleanTranslation(baseTranslation, "", cleanSentence);
                        const isMeaningless = !cleanTrans || cleanTrans === item.translation;
                        if (cleanExtracted && isMeaningless) {
                          baseTranslation = cleanExtracted;
                        }
                      }
                      const displayedTrans = getCleanTranslation(baseTranslation, item.translation, cleanSentence);
                      
                      return (
                      <div className="px-4 pb-4 pt-1.5 text-xs space-y-2 border-t border-slate-100/50 bg-slate-50/80">
                        <div>
                          <p className="font-extrabold text-slate-400 text-[10px] mb-0.5 uppercase tracking-wide">互動英文化境 (Sentence Challenge)：</p>
                          <p className="font-medium text-slate-800 leading-relaxed bg-white border border-slate-200/60 p-2.5 rounded-lg font-mono">
                            {cleanSentence}
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <p className="font-extrabold text-slate-400 text-[10px] mb-0.5 uppercase tracking-wide">情境背景 (Scenario Context)：</p>
                            <p className="text-slate-700 bg-white border border-slate-200/60 p-2.5 rounded-lg">
                              {getCleanContextChinese(item.quizChallenge.contextChinese) || "在日常情境中"}
                            </p>
                          </div>
                          <div>
                            <p className="font-extrabold text-slate-400 text-[10px] mb-0.5 uppercase tracking-wide">中文情境對照 (Translation)：</p>
                            <p className="text-slate-700 bg-white border border-slate-200/60 p-2.5 rounded-lg">
                              {displayedTrans}
                            </p>
                          </div>
                          <div>
                            <p className="font-extrabold text-slate-400 text-[10px] mb-0.5 uppercase tracking-wide">挖空空格答案 (Correct Word)：</p>
                            <p className="text-purple-700 font-extrabold bg-purple-50 border border-purple-100 p-2.5 rounded-lg font-mono">
                              {item.quizChallenge.missingWord}
                            </p>
                          </div>
                        </div>
                        {item.quizChallenge.comment && (
                          <div>
                            <p className="font-extrabold text-slate-400 text-[10px] mb-0.5 uppercase tracking-wide">記憶聯想與引導解析 (Hint / Comment)：</p>
                            <p className="text-slate-600 bg-amber-50/55 border border-amber-100/80 p-2.5 rounded-lg leading-relaxed italic">
                              {item.quizChallenge.comment}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                    })()}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
