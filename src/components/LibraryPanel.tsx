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
  const [activeFilter, setActiveFilter] = useState<'all' | 'hard' | 'hasQuiz' | 'noQuiz'>('all');
  const [expandedChallengeId, setExpandedChallengeId] = useState<string | null>(null);
  const [touringIndex, setTouringIndex] = useState<number>(-1);
  const [isPaused, setIsPaused] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const tourTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  const filteredVocab = vocab.filter(item => {
    const matchesSearch = item.word.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.translation.includes(searchTerm);
    
    let matchesFilter = true;
    if (activeFilter === 'hard') {
      matchesFilter = item.isHard === true;
    } else if (activeFilter === 'hasQuiz') {
      matchesFilter = !!item.quizChallenge;
    } else if (activeFilter === 'noQuiz') {
      matchesFilter = !item.quizChallenge;
    }

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
        ...doc.data(),
        id: doc.id
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

  const [isDeduplicating, setIsDeduplicating] = useState(false);

  // Helper to calculate Levenshtein distance
  const levenshtein = (a: string, b: string): number => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
    for (let i = 0; i <= a.length; i += 1) { matrix[0][i] = i; }
    for (let j = 0; j <= b.length; j += 1) { matrix[j][0] = j; }
    for (let j = 1; j <= b.length; j += 1) {
      for (let i = 1; i <= a.length; i += 1) {
        const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }
    return matrix[b.length][a.length];
  };

  const deduplicateDatabase = async () => {
    if (!auth.currentUser) return;
    setIsDeduplicating(true);
    let mergedCount = 0;
    let deletedWords: string[] = [];

    // 1. 確保 React 狀態陣列內部的 ID 絕對唯一，排除雙重訂閱或 StrictMode 重複掛載帶來的暫態重複影響
    const uniqueVocab: VocabEntry[] = Array.from(new Map<string, VocabEntry>(vocab.map(item => [item.id, item])).values());

    console.log("%c=== DEDUPLICATION DIAGNOSTICS START ===", "color: white; background: #8e44ad; font-weight: bold; font-size: 14px; padding: 4px;");
    console.log(`[Dedupe Debug] 目前雲端資料庫唯一單字總數: ${uniqueVocab.length} 筆 (原始讀取: ${vocab.length} 筆)`);

    const targetDebugWords = ['like it here', 'mixed up', 'pay attention to', 'see you then', 'will', 'post', 'previous', 'repair', 'textbook'];

    // 1.5 診斷：找出原始讀取中有哪些 ID 是重複出現的！
    const idCounts = new Map<string, number>();
    vocab.forEach(item => {
      idCounts.set(item.id, (idCounts.get(item.id) || 0) + 1);
    });
    const duplicateIdsInState = Array.from(idCounts.entries()).filter(([_, count]) => count > 1);
    if (duplicateIdsInState.length > 0) {
      console.log(`%c[Debug 警告] 在 React 狀態陣列 (vocab) 中發現有 ${duplicateIdsInState.length} 個 ID 存在重複項！`, "color: red; font-weight: bold;");
      duplicateIdsInState.forEach(([id, count]) => {
        const matches = vocab.filter(item => item.id === id);
        console.log(` - ID: "${id}" 出現了 ${count} 次。對應單字：`, matches.map(m => `"${m.word}" (${m.translation})`));
      });
    } else {
      console.log("%c[Debug 安全] React 狀態陣列中沒有重複 ID 的元素。", "color: green; font-weight: bold;");
    }

    // 2. 針對 user 指名的這 9 個單字，建立獨立的診斷報告！
    targetDebugWords.forEach(target => {
      const cleanTarget = target.toLowerCase().replace(/[^a-z0-9]/gi, '');
      
      // 在雲端資料庫中，尋找拼寫包含、雷同、或翻譯含有此關鍵字的所有可能紀錄
      const matches = uniqueVocab.filter(item => {
        const w = String(item.word || "").toLowerCase();
        const cleanW = w.replace(/[^a-z0-9]/gi, '');
        const cleanT = String(item.translation || "").toLowerCase().replace(/[^a-z0-9]/gi, '');
        
        return w.includes(target) || cleanW.includes(cleanTarget) || cleanW === cleanTarget;
      });

      console.log(`%c[Debug 報告 - "${target}"] 🔍 找到 ${matches.length} 個符合或雷同的單字紀錄：`, "color: #2980b9; font-weight: bold; background: #ebf5fb; padding: 2px;");
      matches.forEach((item, idx) => {
        console.log(`  ${idx + 1}. ID: ${item.id} | 完整單字: "${item.word}" | 中文翻譯: "${item.translation}" | AI 測驗題目: ${item.quizChallenge ? "✅ (有)" : "❌ (無)"}`);
      });

      if (matches.length <= 1) {
        console.log(`  💡 [不合併原因]：因本單字在資料庫中「只有 ${matches.length} 個項目」，在資料庫裡完全沒有其他類似/重複的英文單字能與之合併，所以它不是重複資料，合併功能將此單一項目予以保留。畫面中看到此單字是絕對正常的，表示您的單字庫中並無重複新增此英文。`);
      } else {
        console.log(`  🔎 [兩兩比較分析]：為什麼這 ${matches.length} 個項目沒有成功自動合併？`);
        for (let m1 = 0; m1 < matches.length; m1++) {
          for (let m2 = m1 + 1; m2 < matches.length; m2++) {
            const itemA = matches[m1];
            const itemB = matches[m2];
            
            const rawA = String(itemA.word || "").trim().toLowerCase();
            const cleanA = rawA.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '');
            const transA = String(itemA.translation || "").trim();
            const engA = rawA.split(/[\/\[（(【]/)[0].trim().replace(/[^a-z0-9\s-]/gi, '');
            const normEngA = engA.replace(/\s+/g, ' ').trim();
            const noSymbolA = normEngA.replace(/[^a-z0-9]/gi, '');
            const prefixFreeNoSymbolA = normEngA.replace(/^(i|to|a|an|the|of)\s+/, '').replace(/[^a-z0-9]/gi, '');

            const rawB = String(itemB.word || "").trim().toLowerCase();
            const cleanB = rawB.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '');
            const transB = String(itemB.translation || "").trim();
            const engB = rawB.split(/[\/\[（(【]/)[0].trim().replace(/[^a-z0-9\s-]/gi, '');
            const normEngB = engB.replace(/\s+/g, ' ').trim();
            const noSymbolB = normEngB.replace(/[^a-z0-9]/gi, '');
            const prefixFreeNoSymbolB = normEngB.replace(/^(i|to|a|an|the|of)\s+/, '').replace(/[^a-z0-9]/gi, '');
            
            const step1 = rawA === rawB;
            const step2 = cleanA === cleanB && cleanA.length > 0;
            const step3 = noSymbolA === noSymbolB && noSymbolA.length >= 3;
            const step4 = prefixFreeNoSymbolA === prefixFreeNoSymbolB && prefixFreeNoSymbolA.length >= 3;
            
            let step5 = false;
            if (normEngA.length >= 4 && normEngB.length >= 4 && (normEngA.includes(normEngB) || normEngB.includes(normEngA))) {
              const transCleanA = transA.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '');
              const transCleanB = transB.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '');
              if (transCleanA.length >= 2 && transCleanB.length >= 2) {
                step5 = transCleanA.includes(transCleanB) || transCleanB.includes(transCleanA);
              }
            }

            let step6 = false;
            if (transA === transB && transA.length > 0) {
              const dist = levenshtein(normEngA, normEngB);
              step6 = dist <= 1 && Math.max(normEngA.length, normEngB.length) >= 4;
            }

            console.log(`     👉 正在比較：["${itemA.word}"] vs ["${itemB.word}"]`);
            console.log(`        - 規則 1 (完全相同): ${step1 ? "🟢 通過" : "🔴 不符"}`);
            console.log(`        - 規則 2 (去除符號一致): ${step2 ? "🟢 通過" : "🔴 不符"}`);
            console.log(`        - 規則 3 (純字母一致比對): ${step3 ? "🟢 通過" : "🔴 不符"} | A="${noSymbolA}", B="${noSymbolB}"`);
            console.log(`        - 規則 4 (去除 to/the/a 等前綴一致): ${step4 ? "🟢 通過" : "🔴 不符"} | A="${prefixFreeNoSymbolA}", B="${prefixFreeNoSymbolB}"`);
            console.log(`        - 規則 5 (子字串包含且中文類似): ${step5 ? "🟢 通過" : "🔴 不符"} | A中文="${transA}", B中文="${transB}"`);
            console.log(`        - 規則 6 (拼寫極近且中文一致): ${step6 ? "🟢 通過" : "🔴 不符"}`);
            console.log(`        🔍 評估結論 => ${ (step1 || step2 || step3 || step4 || step5 || step6) ? "🎉 判斷為重複單字，應該合併！" : "❌ 判斷非重複單字，中文或拼寫無強烈關聯，不予合併"}`);
          }
        }
      }
    });
    console.log("%c=======================================", "color: white; background: #8e44ad; font-weight: bold; font-size: 14px; padding: 4px;");

    try {
      const processedIds = new Set<string>();
      const toDelete = new Set<string>();
      const updates = new Map<string, any>(); // id -> fields to update
      
      // We will perform O(n^2) clustering on uniqueVocab (using the deduplicated unique array!)
      for (let i = 0; i < uniqueVocab.length; i++) {
        const itemA = uniqueVocab[i];
        if (processedIds.has(itemA.id)) continue;
        
        const cluster: VocabEntry[] = [itemA];
        processedIds.add(itemA.id);
        
        const rawA = String(itemA.word || "").trim().toLowerCase();
        const cleanA = rawA.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '');
        const transA = String(itemA.translation || "").trim();
        const engA = rawA.split(/[\/\[（(【]/)[0].trim().replace(/[^a-z0-9\s-]/gi, '');
        const normEngA = engA.replace(/\s+/g, ' ').trim();
        const noSymbolA = normEngA.replace(/[^a-z0-9]/gi, '');
        const prefixFreeNoSymbolA = normEngA.replace(/^(i|to|a|an|the|of)\s+/, '').replace(/[^a-z0-9]/gi, '');
        
        for (let j = i + 1; j < uniqueVocab.length; j++) {
          const itemB = uniqueVocab[j];
          if (processedIds.has(itemB.id)) continue;
          
          const rawB = String(itemB.word || "").trim().toLowerCase();
          const cleanB = rawB.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '');
          const transB = String(itemB.translation || "").trim();
          const engB = rawB.split(/[\/\[（(【]/)[0].trim().replace(/[^a-z0-9\s-]/gi, '');
          const normEngB = engB.replace(/\s+/g, ' ').trim();
          const noSymbolB = normEngB.replace(/[^a-z0-9]/gi, '');
          const prefixFreeNoSymbolB = normEngB.replace(/^(i|to|a|an|the|of)\s+/, '').replace(/[^a-z0-9]/gi, '');
          
          let isMatch = false;
          
          // Rule 1: Exact string match
          if (rawA === rawB) {
            isMatch = true;
          } 
          // Rule 2: Exact match ignoring punctuation and spaces
          else if (cleanA === cleanB && cleanA.length > 0) {
            isMatch = true;
          }
          // Rule 3: Pure English part exact match ignoring brackets, phonetics, hyphens, and spaces
          else if (noSymbolA === noSymbolB && noSymbolA.length >= 3) {
            isMatch = true;
          }
          // Rule 4: Match after removing common prefixes and normal symbols ("to repair" vs "repair")
          else if (prefixFreeNoSymbolA === prefixFreeNoSymbolB && prefixFreeNoSymbolA.length >= 3) {
            isMatch = true;
          }
          // Rule 5: Substring containment with translation match
          else if (normEngA.length >= 4 && normEngB.length >= 4 && (normEngA.includes(normEngB) || normEngB.includes(normEngA))) {
             const transCleanA = transA.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '');
             const transCleanB = transB.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '');
             if (transCleanA.length >= 2 && transCleanB.length >= 2) {
               if (transCleanA.includes(transCleanB) || transCleanB.includes(transCleanA)) {
                 isMatch = true;
               }
             }
          }
          // Rule 6: Levenshtein distance for typos if translation matches exactly
          else if (transA === transB && transA.length > 0) {
            const dist = levenshtein(normEngA, normEngB);
            if (dist <= 1 && Math.max(normEngA.length, normEngB.length) >= 4) {
              isMatch = true;
            }
          }
          
          if (isMatch) {
            cluster.push(itemB);
            processedIds.add(itemB.id);
          }
        }
        
        if (cluster.length > 1) {
          // Found duplicates! Choose the best display record (one with phonetics or longer spelling)
          const bestItem = cluster.reduce((prev, current) => {
             const prevHasPhonetic = prev.word.includes('/') || prev.word.includes('[');
             const currHasPhonetic = current.word.includes('/') || current.word.includes('[');
             if (currHasPhonetic && !prevHasPhonetic) return current;
             if (prevHasPhonetic && !currHasPhonetic) return prev;
             return current.word.length > prev.word.length ? current : prev;
          }, cluster[0]);
          
          let needsUpdate = false;
          const patchData: any = {};
          
          // Fold isHard flag
          const hasHard = cluster.some(c => c.isHard);
          if (hasHard && !bestItem.isHard) {
            patchData.isHard = true;
            needsUpdate = true;
          }
          
          // 🏆 強化 AI 測驗題目的轉移：找出 cluster 中品質最好（句子最完整、長度最長）的 quizChallenge
          const validQuizItems = cluster.filter(c => c.quizChallenge && typeof c.quizChallenge === "object" && c.quizChallenge.sentence && String(c.quizChallenge.sentence).trim().length > 0);
          if (validQuizItems.length > 0) {
             const bestQuizItem = validQuizItems.reduce((prev, current) => {
                const prevLen = String(prev.quizChallenge?.sentence || "").length;
                const currLen = String(current.quizChallenge?.sentence || "").length;
                return currLen > prevLen ? current : prev;
             }, validQuizItems[0]);

             const bestChallenge = bestQuizItem.quizChallenge;
             const bestItemChallenge = bestItem.quizChallenge;
             const bestLen = String(bestChallenge?.sentence || "").length;
             const currentLen = String(bestItemChallenge?.sentence || "").length;

             // 只要其他項目的測驗句子更長更優完整，或者主項目目前沒有題庫，就轉移過去並覆蓋，確保不會丟失！
             if (bestLen > currentLen) {
                patchData.quizChallenge = bestChallenge;
                needsUpdate = true;
                console.log(`[Dedupe Debug] 已完美將最完整的 AI 測驗題目從 [${bestQuizItem.word}] 移轉/覆蓋到即將保留的主單字 [${bestItem.word}]:`, bestChallenge);
             }
          }
          
          if (needsUpdate) {
             updates.set(bestItem.id, patchData);
          }
          
          for (const item of cluster) {
            if (item.id !== bestItem.id) {
              toDelete.add(item.id);
              deletedWords.push(item.word);
            }
          }
        }
      }

      // Execute updates for merged primary items
      for (const [id, data] of updates.entries()) {
        try {
          await updateDoc(doc(db, "vocab", id), data);
        } catch (err) {
          console.error("Failed to update merged doc:", err);
        }
      }

      // Execute deletions
      for (const id of Array.from(toDelete)) {
        try {
          await deleteDoc(doc(db, "vocab", id));
          mergedCount++;
        } catch (err) {
          console.error("Failed to delete duplicate doc:", err);
        }
      }

      if (mergedCount > 0) {
        const uniqueWords = [...new Set(deletedWords)];
        toast.success(`成功合併 ${mergedCount} 筆重複資料！包含：${uniqueWords.slice(0, 3).join(", ")}${uniqueWords.length > 3 ? '...' : ''}`);
      } else {
        toast.info("目前單字庫中沒有重複單字或需要合併的雷同單字。");
      }
    } catch (error: any) {
      console.error(error);
      toast.error(`清理重複單字時發生錯誤: ${error?.message || error}`);
    } finally {
      setIsDeduplicating(false);
    }
  };

  const deleteItem = async (id: string, word: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => {
        setDeletingId(current => current === id ? null : current);
      }, 3000);
      return;
    }

    try {
      await deleteDoc(doc(db, "vocab", id));
      toast.success("已刪除");
      setDeletingId(null);
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
              <Button disabled={isDeduplicating} variant="ghost" size="sm" onClick={deduplicateDatabase} className="h-8 gap-1 text-slate-500 hover:text-slate-700 hover:bg-slate-50">
                {isDeduplicating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                <span className="text-xs font-bold hidden sm:inline">合併重複單字</span>
              </Button>
              <div className="w-[1px] h-4 bg-slate-200 mx-1"></div>
              {touringIndex === -1 ? (
                <Button variant="ghost" size="sm" onClick={startTour} className="h-8 gap-1 text-primary hover:bg-primary/5">
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span className="text-xs font-bold hidden sm:inline">單字連播</span>
                </Button>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={togglePause} className="h-8 gap-1 text-amber-500 hover:bg-amber-50">
                    {isPaused ? <Play className="h-3.5 w-3.5 fill-current" /> : <Pause className="h-3.5 w-3.5 fill-current" />}
                    <span className="text-xs font-bold hidden sm:inline">{isPaused ? "繼續" : "暫停"}</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={stopTour} className="h-8 gap-1 text-slate-500 hover:bg-slate-50">
                    <Square className="h-3.5 w-3.5 fill-current" />
                    <span className="text-xs font-bold hidden sm:inline">停止</span>
                  </Button>
                </>
              )}
            </div>
          )}
          <div className="px-3 py-1 bg-slate-100 rounded-full border border-slate-200 shadow-sm hidden sm:block">
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
        
        {/* Unified Filter Ribbon */}
        <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-xl">
          <button 
            onClick={() => setActiveFilter('all')}
            className={`flex-1 sm:flex-initial px-3.5 py-2 text-xs font-bold rounded-lg transition-all text-center ${activeFilter === 'all' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-900 hover:bg-white/50'}`}
          >
            全部
          </button>
          <button 
            onClick={() => setActiveFilter('hard')}
            className={`flex-1 sm:flex-initial px-3.5 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${activeFilter === 'hard' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-500 hover:text-amber-600 hover:bg-amber-50/50'}`}
          >
            <Star className={`h-3.5 w-3.5 ${activeFilter === 'hard' ? 'fill-amber-500 text-amber-500' : 'text-slate-400'}`} />
            常忘單字 ({hardCount})
          </button>
          <button 
            onClick={() => setActiveFilter('hasQuiz')}
            className={`flex-1 sm:flex-initial px-3.5 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${activeFilter === 'hasQuiz' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500 hover:text-purple-600 hover:bg-purple-50/50'}`}
          >
            <Sparkles className="h-3.5 w-3.5 text-purple-500" />
            已存 AI 測驗 ({withQuizCount})
          </button>
          <button 
            onClick={() => setActiveFilter('noQuiz')}
            className={`flex-1 sm:flex-initial px-3.5 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${activeFilter === 'noQuiz' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
          >
            待生成測驗 ({withoutQuizCount})
          </button>
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
                <div className="flex items-start px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-lg font-bold text-slate-900 break-words whitespace-normal leading-tight">{item.word}</span>
                      {item.phonetic && (
                        <span className="text-sm font-mono text-slate-400 break-words whitespace-normal">{item.phonetic}</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 break-words whitespace-normal mt-1.5 leading-relaxed">{item.translation}</p>
                    
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
                    <Button 
                      variant="ghost" 
                      onClick={() => deleteItem(item.id, item.word)} 
                      className={`h-9 transition-all duration-200 ${deletingId === item.id ? 'px-3 text-white bg-red-500 hover:bg-red-600 hover:text-white' : 'w-9 p-0 text-slate-400 hover:bg-slate-100 hover:text-red-500'}`}
                    >
                      {deletingId === item.id ? "確認刪除?" : <Trash2 className="h-5 w-5" />}
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
