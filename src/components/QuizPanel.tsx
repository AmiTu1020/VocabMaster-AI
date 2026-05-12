import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mic, Send, Lightbulb, RefreshCw, Volume2, ShieldAlert, Sparkles, Trophy, ArrowRight } from "lucide-react";
import { db, auth } from "@/lib/firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import { toast } from "sonner";
import { VocabEntry } from "@/types";
import { motion, AnimatePresence } from "motion/react";

export function QuizPanel() {
  const [vocabPool, setVocabPool] = useState<VocabEntry[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<VocabEntry | null>(null);
  const [userInput, setUserInput] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [hintLevel, setHintLevel] = useState(0); // 0: none, 1: length, 2: partial, 3: full
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [feedback, setFeedback] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    fetchVocab();
    
    if ('webkitSpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        setUserInput(text.toLowerCase().replace(/[.\s]/g, ''));
        setIsListening(false);
      };

      recognitionRef.current.onerror = () => setIsListening(false);
      recognitionRef.current.onend = () => setIsListening(false);
    }
  }, []);

  const fetchVocab = async () => {
    if (!auth.currentUser) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, "vocab"),
        where("creatorId", "==", auth.currentUser.uid)
      );
      const snapshot = await getDocs(q);
      const docs = snapshot.docs.map(doc => doc.data() as VocabEntry);
      setVocabPool(docs);
      if (docs.length > 0) {
        pickQuestion(docs);
      }
    } catch (error) {
      console.error(error);
      toast.error("載入單字庫失敗");
    } finally {
      setLoading(false);
    }
  };

  const pickQuestion = (pool: VocabEntry[] = vocabPool) => {
    if (pool.length === 0) return;
    const random = Math.floor(Math.random() * pool.length);
    setCurrentQuestion(pool[random]);
    setUserInput("");
    setHintLevel(0);
    setIsCorrect(null);
    setAttempts(0);
    setFeedback([]);
  };

  const checkAnswer = () => {
    if (!currentQuestion) return;
    const target = currentQuestion.word;
    const cleanWord = target.toLowerCase().replace(/[.\s]/g, '');
    const cleanInput = userInput.toLowerCase().replace(/[.\s]/g, '');
    
    if (cleanInput === cleanWord) {
      setIsCorrect(true);
      toast.success("答對了！");
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      setIsCorrect(false);
      
      if (newAttempts >= 3) {
        setHintLevel(3);
        toast.info("已為您顯示正確答案");
      } else {
        toast.error(`再試一次 (還剩 ${3 - newAttempts} 次機會)`);
      }
      
      // Calculate diff for feedback
      const targetWords = target.split(/\s+/);
      const inputWords = userInput.trim().split(/\s+/);
      
      const diffData = targetWords.map((tWord, i) => {
        const iWord = inputWords[i] || "";
        const isMatch = iWord.toLowerCase().replace(/[.,!?;:]/g, "") === tWord.toLowerCase().replace(/[.,!?;:]/g, "");
        
        // Character level diff if not match
        let charDiff: { char: string, isMatch: boolean }[] = [];
        if (!isMatch && iWord) {
          const tClean = tWord.toLowerCase();
          const iClean = iWord.toLowerCase();
          const maxLength = Math.max(tClean.length, iClean.length);
          
          for (let j = 0; j < maxLength; j++) {
            const tC = tClean[j] || "";
            const iC = iClean[j] || "";
            charDiff.push({ 
              char: iC || "_", 
              isMatch: tC === iC 
            });
          }
        }
        
        return { tWord, iWord, isMatch, charDiff };
      });
      setFeedback(diffData);
    }
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setIsListening(true);
      recognitionRef.current?.start();
    }
  };

  const showHint = () => {
    setHintLevel(prev => Math.min(prev + 1, 3));
  };

  const getHintDisplay = () => {
    if (!currentQuestion) return "";
    const word = currentQuestion.word;
    if (hintLevel === 1) return `字數：${word.length} 個字母`;
    if (hintLevel === 2) {
      return word.split('').map((char, i) => 
        i === 0 || i === word.length - 1 || char === ' ' ? char : '_'
      ).join(' ');
    }
    if (hintLevel === 3) return word;
    return "";
  };

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <RefreshCw className="h-8 w-8 animate-spin mb-4" />
        <p>準備測驗中...</p>
      </div>
    );
  }

  if (vocabPool.length === 0) {
    return (
      <Card className="border-slate-200">
        <CardContent className="p-12 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 mx-auto text-slate-300" />
          <div className="space-y-2">
            <h3 className="text-lg font-bold">單字庫空空如也</h3>
            <p className="text-slate-500 max-w-xs mx-auto">
              請先從「辨識萃取」功能匯入一些單字，再來進行測驗吧！
            </p>
          </div>
          <Button onClick={fetchVocab} variant="outline">重新載入</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <AnimatePresence mode="wait">
        <motion.div
           key={currentQuestion?.word}
           initial={{ opacity: 0, scale: 0.95 }}
           animate={{ opacity: 1, scale: 1 }}
           exit={{ opacity: 0, scale: 0.95 }}
           transition={{ duration: 0.3 }}
        >
          <Card className="border-none shadow-xl bg-gradient-to-br from-white to-slate-50">
            <CardHeader className="text-center pb-2">
              <div className="flex justify-center mb-2">
                 <div className="p-3 bg-primary/10 rounded-full">
                   <Sparkles className="h-6 w-6 text-primary" />
                 </div>
              </div>
              <CardTitle className="text-3xl font-black text-slate-800">{currentQuestion?.translation}</CardTitle>
              <CardDescription>請輸入正確的英文單字</CardDescription>
            </CardHeader>
            <CardContent className="p-8 pt-4 space-y-8">
              <div className="relative">
                <input 
                  type="text" 
                  autoFocus
                  placeholder="在此輸入答案..." 
                  className={`w-full text-2xl font-bold bg-white border-2 rounded-2xl h-16 px-6 text-center focus:outline-none transition-all ${
                    isCorrect === true ? 'border-green-500 bg-green-50' : 
                    isCorrect === false ? 'border-red-400 bg-red-50' : 
                    'border-slate-200 focus:border-primary'
                  }`}
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && checkAnswer()}
                />
                
                {isCorrect === false && feedback.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 flex flex-wrap justify-center gap-2"
                  >
                    {feedback.map((item, idx) => (
                      <div key={idx} className="flex flex-col items-center">
                        <div className={`flex text-sm font-bold ${item.isMatch ? 'text-green-500' : 'text-red-500'}`}>
                          {item.charDiff && item.charDiff.length > 0 ? (
                            item.charDiff.map((c: any, cIdx: number) => (
                              <span key={cIdx} className={c.isMatch ? 'text-green-500' : 'text-red-500 bg-red-100 rounded px-0.5'}>
                                {c.char}
                              </span>
                            ))
                          ) : (
                            <span className={item.isMatch ? 'text-green-500' : 'text-red-500'}>
                              {item.iWord || "?"}
                            </span>
                          )}
                        </div>
                        {!item.isMatch && (attempts >= 3 || hintLevel === 3) && (
                          <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                            → {item.tWord}
                          </span>
                        )}
                      </div>
                    ))}
                  </motion.div>
                )}

                {isCorrect === true && (
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -right-4 -top-4 bg-green-500 text-white rounded-full p-2 shadow-lg"
                  >
                    <Trophy className="h-6 w-6" />
                  </motion.div>
                )}
              </div>

              {hintLevel > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-amber-50 text-amber-700 p-4 rounded-xl text-center font-mono text-lg border border-amber-200"
                >
                  {getHintDisplay()}
                </motion.div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <Button 
                  variant="outline" 
                  disabled={isCorrect === true}
                  className="h-12 rounded-xl gap-2 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200"
                  onClick={showHint}
                >
                  <Lightbulb className="h-5 w-5" />
                  提示
                </Button>
                <Button 
                  disabled={isCorrect === true}
                  className={`h-12 rounded-xl gap-2 ${isListening ? 'bg-red-500 hover:bg-red-600 animate-pulse' : 'bg-primary hover:bg-primary/90'}`}
                  onClick={toggleListening}
                >
                  <Mic className="h-5 w-5" />
                  {isListening ? "正在聆聽..." : "語音輸入"}
                </Button>
              </div>

              <div className="flex gap-2">
                <Button 
                  className="flex-1 h-12 rounded-xl bg-slate-900" 
                  onClick={checkAnswer}
                  disabled={!userInput || isCorrect === true}
                >
                  <Send className="h-5 w-5 mr-2" />
                  檢查答案
                </Button>
                {isCorrect === true || hintLevel === 3 ? (
                  <Button 
                    className="flex-1 h-12 rounded-xl bg-green-600 hover:bg-green-700 animate-in fade-in slide-in-from-bottom-2 duration-300" 
                    onClick={() => pickQuestion()}
                  >
                    下一題
                    <ArrowRight className="h-5 w-5 ml-2" />
                  </Button>
                ) : (
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-12 w-12 rounded-xl border border-slate-200"
                    onClick={() => pickQuestion()}
                  >
                    <RefreshCw className="h-5 w-5" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </AnimatePresence>

      {(isCorrect === true || hintLevel === 3) && currentQuestion?.examples && currentQuestion.examples.length > 0 && (
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4 flex items-start gap-3">
             <div className="shrink-0 p-2 bg-slate-100 rounded-lg">
               <Volume2 className="h-4 w-4 text-slate-500 cursor-pointer" onClick={() => speak(currentQuestion.word)} />
             </div>
             <div className="space-y-1">
               <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Example Usage</p>
               <p className="text-sm text-slate-600 italic">" {currentQuestion.examples[0]} "</p>
             </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
