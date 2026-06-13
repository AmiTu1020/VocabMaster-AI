import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Mic, 
  Send, 
  Lightbulb, 
  RefreshCw, 
  Volume2, 
  ShieldAlert, 
  Sparkles, 
  Trophy, 
  ArrowRight,
  Flame,
  Star,
  Settings,
  ChevronLeft,
  HelpCircle,
  Check,
  X,
  VolumeX,
  Heart,
  Save,
  Loader2
} from "lucide-react";
import { db, auth } from "@/lib/firebase";
import { collection, query, where, getDocs, doc, updateDoc, setDoc } from "firebase/firestore";
import { toast } from "sonner";
import { VocabEntry } from "@/types";
import { motion, AnimatePresence } from "motion/react";
import { generateQuizChallenge, explainMisconception, QuizChallenge } from "../services/geminiService";

// Helper to sanitize and extract actual target English words for spelling inputs
const getCleanTargetWords = (missingWord: string): string[] => {
  if (!missingWord) return [];
  return missingWord.trim().split(/\s+/).filter(word => {
    // Filter out pure punctuation, symbols, placeholders like "...", "/", "()", "[]"
    const clean = word.replace(/[^a-z0-9]/gi, "");
    return clean.length > 0;
  });
};

// Helpers to clean up verbose/repetitive instruction text from display
const getCleanContextChinese = (ctx: string | undefined): string => {
  if (!ctx) return "";
  let cleaned = ctx.trim();
  
  // Remove boilerplate instructions from AI fallbacks or generic prompts
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

// Helper to extract clean english sentence and trailing Chinese translation if mixed in the sentence
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

// Helper to detect if a challenge has a robotic fallback style rather than natural translations
const isFallbackChallenge = (challenge: any, word: string, wordTranslation?: string) => {
  if (!challenge) return true;
  const sentence = challenge.sentence || "";
  const t = challenge.translation || "";
  const c = challenge.contextChinese || "";
  const missing = challenge.missingWord || "";
  
  if (!sentence || !t || !missing) return true;
  
  const lowerWord = word ? word.trim().toLowerCase() : "";
  const hasSpoilerWord = lowerWord && (
    t.toLowerCase().includes(lowerWord) || 
    c.toLowerCase().includes(lowerWord)
  );

  // Broad check: if the translation contains explicit indicators of dictionary definitions (e.g. part of speech tags)
  const lowerT = t.toLowerCase();
  const dictTags = [
    "adj.", "adv.", "prep.", "conj.", "pron.", "noun.", "verb.", "num.", "art.", 
    "adj ", "adv ", "prep ", "conj ", "pron ", "noun ", "verb ", "num ", "art ",
    "形容詞", "名詞", "動詞", "副詞", "介系詞", "連接詞", "代名詞", "冠詞",
    "形.", "副.", "名.", "動.", "介.", "連.", "代.", "【n.】", "【v.】", "【adj.】", "【adv.】"
  ];
  const containsDictTag = dictTags.some(tag => lowerT.includes(tag)) || 
    /\b(adj|adv|prep|conj|pron|noun|verb|int|num|art)\./i.test(t) ||
    /^[a-z]+\.?\s/i.test(t.trim()); // Starts with english POS abbreviation

  if (containsDictTag) {
    return true;
  }

  // Strip all non-Chinese characters and punctuation to check if it's identical or a substring of the dictionary definition
  const getPureChinese = (str: string): string => {
    if (!str) return "";
    // Remove all English letters, numbers, spaces, and punctuation/symbols
    return str
      .replace(/[a-zA-Z0-9]/g, "")
      .replace(/[\s\.\,\;\:\?\!\-\/\_\\\|~～\+=\*#\$%\^\&\(\)（）\[\]【】\{\}，、；。：？！“”‘’「」]/g, "")
      .trim();
  };

  const pureWord = getPureChinese(wordTranslation || "");
  const pureQuiz = getPureChinese(t);

  if (pureWord && pureQuiz) {
    // If they are exactly the same Chinese meaning, or one is almost completely equal to the other after stripping symbols/alphabets
    if (pureQuiz === pureWord) {
      return true;
    }
    
    // If the quiz translation contains the dictionary meaning but is very short (meaning it didn't translate the whole sentence, just the word with maybe minor fillers like "代表", "的意思", "填空")
    if (pureQuiz.includes(pureWord) && pureQuiz.length <= pureWord.length + 5) {
      return true;
    }

    // If the dictionary meaning contains the quiz translation and the quiz translation is short
    if (pureWord.includes(pureQuiz) && pureWord.length <= pureQuiz.length + 5) {
      return true;
    }
  }
  
  return (
    t.includes("請依上下文") ||
    t.includes("配合上下文") ||
    t.includes("請根據上下文") ||
    t.includes("對應作答") ||
    t.includes("提示：") ||
    t.includes("填空練習") ||
    t.includes("最適合的單字") ||
    t.includes("請填入") ||
    t.includes("適合的單字") ||
    t.includes("代表") ||
    t.includes("的意思") ||
    t.includes("的中文是") ||
    t.includes("填空挑戰") ||
    c.includes("為了練習") ||
    c.includes("請在以下句子填入") ||
    c.includes("填空練習") ||
    c.includes("配合上下文") ||
    c.includes("特定情境中使用此詞彙") ||
    hasSpoilerWord ||
    sentence.includes("Explain why you did it, and also why it was necessary")
  );
};

export function QuizPanel() {
  // Vocabulary States
  const [vocabPool, setVocabPool] = useState<VocabEntry[]>([]);
  const [sessionList, setSessionList] = useState<VocabEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  // Challenge States
  const [currentChallenge, setCurrentChallenge] = useState<QuizChallenge | null>(null);
  
  // Extract clean english sentence and trailing Chinese translation if mixed in the sentence
  const { english: cleanSentence, extractedChinese } = currentChallenge 
    ? processMixedSentence(currentChallenge.sentence) 
    : { english: "", extractedChinese: "" };
  const [challengeLoading, setChallengeLoading] = useState(false);
  const [challengeCache, setChallengeCache] = useState<Record<string, QuizChallenge>>({});
  const [challengeFromApiCache, setChallengeFromApiCache] = useState<Record<string, boolean>>({});
  const [challengeFromApi, setChallengeFromApi] = useState(false);
  const [isSavingChallenge, setIsSavingChallenge] = useState(false);
  
  // Game Play States
  const [userInput, setUserInput] = useState("");
  const [wordInputs, setWordInputs] = useState<string[]>([]);

  // Synchronize dynamic multi-box inputs from single string state (such as resets, voice overrides, or automated hints)
  // Initialize inputs when a query/challenge changes (does not run on interactive user input typing to prevent collapsing/shifting)
  useEffect(() => {
    if (!currentChallenge || !currentChallenge.missingWord) {
      setWordInputs([]);
      return;
    }
    const targetWords = getCleanTargetWords(currentChallenge.missingWord);
    if (!userInput) {
      setWordInputs(Array(targetWords.length).fill(""));
    } else {
      const parts = userInput.trim().split(/\s+/);
      const newInputs = Array(targetWords.length).fill("");
      for (let i = 0; i < targetWords.length; i++) {
        newInputs[i] = parts[i] || "";
      }
      setWordInputs(newInputs);
    }
  }, [currentChallenge?.missingWord]);

  // Helper to update both userInput and wordInputs simultaneously for macro actions (e.g. voice, hints, resets)
  const updateUserInputAndWordInputs = (fullText: string) => {
    setUserInput(fullText);
    if (!currentChallenge || !currentChallenge.missingWord) {
      setWordInputs([]);
      return;
    }
    const targetWords = getCleanTargetWords(currentChallenge.missingWord);
    if (!fullText) {
      setWordInputs(Array(targetWords.length).fill(""));
    } else {
      const parts = fullText.trim().split(/\s+/);
      const newInputs = Array(targetWords.length).fill("");
      for (let i = 0; i < targetWords.length; i++) {
        newInputs[i] = parts[i] || "";
      }
      setWordInputs(newInputs);
    }
  };

  const handleWordInputChange = (index: number, val: string) => {
    const targetWords = getCleanTargetWords(currentChallenge?.missingWord || "");
    const newInputs = [...wordInputs];
    while (newInputs.length < targetWords.length) {
      newInputs.push("");
    }
    newInputs[index] = val;
    setWordInputs(newInputs);

    const joined = newInputs.map(item => item || "").join(" ");
    setUserInput(joined);

    if (isCorrect === false) setIsCorrect(null);
  };

  const toggleWordHardById = async (wordId: string, currentStatus: boolean, sessionIndex: number, wordStr: string) => {
    if (!auth.currentUser) {
      toast.error("請先登入");
      return;
    }
    const newHardStatus = !currentStatus;

    // 1. Update sessionList locally
    setSessionList(prev => prev.map((item, idx) => 
      idx === sessionIndex ? { ...item, isHard: newHardStatus } : item
    ));

    // 2. Update vocabPool locally
    setVocabPool(prev => prev.map(item => 
      item.id === wordId ? { ...item, isHard: newHardStatus } : item
    ));

    // 3. Update Firestore DB using setDoc with merge
    try {
      const docRef = doc(db, "vocab", wordId);
      await setDoc(docRef, { isHard: newHardStatus }, { merge: true });
      if (newHardStatus) {
        toast.success(`已將 "${wordStr}" 標記為常忘單字 ⭐️`);
      } else {
        toast.info(`已取消 "${wordStr}" 的常忘單字標記`);
      }
    } catch (error) {
      console.error("Error updating word difficulty:", error);
      toast.error("更新失敗");
    }
  };

  const toggleCurrentWordHard = async () => {
    const currentWord = sessionList[currentIndex];
    if (!currentWord) return;
    await toggleWordHardById(currentWord.id, !!currentWord.isHard, currentIndex, currentWord.word);
  };

  const [isListening, setIsListening] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [hintsLevel, setHintsLevel] = useState(0); // 0: none, 1: first letter, 2: full hint trigger
  const [hasRevealedAnswer, setHasRevealedAnswer] = useState(false);
  const [isSessionComplete, setIsSessionComplete] = useState(false);
  const [showPhonetic, setShowPhonetic] = useState(true);
  const [spellingDiagnosis, setSpellingDiagnosis] = useState<{ entered: string; correct: string } | null>(null);

  // AI Pink Explanation Bubble States
  const [pinkBubble, setPinkBubble] = useState<{
    show: boolean;
    text: string;
    loading: boolean;
  }>({
    show: false,
    text: "",
    loading: false
  });

  // Score Accumulation Tracking
  const [totalAttempts, setTotalAttempts] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);

  const recognitionRef = useRef<any>(null);

  // 用於突破 webkitSpeechRecognition 異步事件回調中的 React 閉包陷阱
  const latestUpdateRef = useRef(updateUserInputAndWordInputs);
  useEffect(() => {
    latestUpdateRef.current = updateUserInputAndWordInputs;
  });

  // 1. Initial Load & Setup Speech SDK
  useEffect(() => {
    fetchVocab();
    
    if ('webkitSpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        const cleanText = text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"").trim();
        latestUpdateRef.current(cleanText);
        setIsListening(false);
        toast.success(`語音辨識成功："${cleanText}"`);
      };

      recognitionRef.current.onerror = () => setIsListening(false);
      recognitionRef.current.onend = () => setIsListening(false);
    }
  }, []);

  // 2. Load vocab list from database
  const fetchVocab = async () => {
    if (!auth.currentUser) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, "vocab"),
        where("creatorId", "==", auth.currentUser.uid)
      );
      const snapshot = await getDocs(q);
      const docs = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      }) as VocabEntry);
      
      setVocabPool(docs);
      if (docs.length > 0) {
        startNewSession(docs);
      }
    } catch (error) {
      console.error(error);
      toast.error("載入雲端單字庫失敗");
    } finally {
      setLoading(false);
    }
  };

  // 3. Shake/Shuffle pool to form a perfect 10-word Session
  const startNewSession = (pool: VocabEntry[] = vocabPool) => {
    if (pool.length === 0) return;
    
    // Shuffle the full list
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    // Select up to 10 words for this session
    const selected = shuffled.slice(0, Math.min(10, shuffled.length));
    
    setSessionList(selected);
    setCurrentIndex(0);
    setIsSessionComplete(false);
    setTotalAttempts(0);
    setCorrectCount(0);
    
    loadChallengeForWord(selected[0]);
  };

  // 4. Fetch or generate high-fidelity AI challenge for active vocabulary
  const loadChallengeForWord = async (vocab: VocabEntry) => {
    setChallengeLoading(true);
    updateUserInputAndWordInputs("");
    setIsCorrect(null);
    setAttempts(0);
    setHintsLevel(0);
    setHasRevealedAnswer(false);
    setChallengeFromApi(false);
    setPinkBubble({ show: false, text: "", loading: false });
    setSpellingDiagnosis(null);

    // Check Cache first to avoid rate limits
    if (challengeCache[vocab.word] && !isFallbackChallenge(challengeCache[vocab.word], vocab.word, vocab.translation)) {
      setCurrentChallenge(challengeCache[vocab.word]);
      setChallengeFromApi(!!challengeFromApiCache[vocab.word]);
      setChallengeLoading(false);
      preloadNextChallenge();
      return;
    }

    // Check if vocabulary record already contains the generated quiz challenge (優先查雲端資料庫)
    if (vocab.quizChallenge && !isFallbackChallenge(vocab.quizChallenge, vocab.word, vocab.translation)) {
      setChallengeCache(prev => ({ ...prev, [vocab.word]: vocab.quizChallenge! }));
      setChallengeFromApiCache(prev => ({ ...prev, [vocab.word]: false }));
      setCurrentChallenge(vocab.quizChallenge);
      setChallengeFromApi(false);
      setChallengeLoading(false);
      preloadNextChallenge();
      return;
    }

    // 找不到題目才需要使用 API
    try {
      const challenge = await generateQuizChallenge(vocab.word, vocab.translation, vocab.examples);
      setChallengeCache(prev => ({ ...prev, [vocab.word]: challenge }));
      setChallengeFromApiCache(prev => ({ ...prev, [vocab.word]: true }));
      setCurrentChallenge(challenge);
      setChallengeFromApi(true); // 標記為 API 產生，等等會顯示「儲存此題目」按鈕
    } catch (error) {
      console.error("AI challenge creation error:", error);
      toast.error("AI 生成情境題失敗，已使用預先設定的經典格式");
    } finally {
      setChallengeLoading(false);
      preloadNextChallenge();
    }
  };

  // 4b. Force re-generate a completely new AI challenge (ignoring cache/db values)
  const forceRegenerateChallenge = async (vocab: VocabEntry) => {
    setChallengeLoading(true);
    updateUserInputAndWordInputs("");
    setIsCorrect(null);
    setAttempts(0);
    setHintsLevel(0);
    setHasRevealedAnswer(false);
    setChallengeFromApi(false);
    setPinkBubble({ show: false, text: "", loading: false });
    setSpellingDiagnosis(null);

    try {
      const challenge = await generateQuizChallenge(vocab.word, vocab.translation, vocab.examples);
      setChallengeCache(prev => ({ ...prev, [vocab.word]: challenge }));
      setChallengeFromApiCache(prev => ({ ...prev, [vocab.word]: true }));
      setCurrentChallenge(challenge);
      setChallengeFromApi(true); // Newly generated from API, show saving options
      toast.success("已重啟 AI 精準出題！已為您編排全新題目 ✨");
    } catch (error) {
      console.error("AI challenge regeneration error:", error);
      toast.error("AI 出題超時或失敗，請稍候重試");
    } finally {
      setChallengeLoading(false);
    }
  };

  // 可讓使用者自行手動存題目的處理器 (儲存到雲端資料庫)
  const handleSaveChallengeToDb = async () => {
    const currentWord = sessionList[currentIndex];
    if (!currentWord || !currentChallenge || !currentWord.id) return;
    
    setIsSavingChallenge(true);
    try {
      const { english: cleanSrcSentence, extractedChinese } = processMixedSentence(currentChallenge.sentence);
      let finalSaveTrans = currentChallenge.translation || "";
      
      // If the extracted Chinese from the sentence is robust and the current translation
      // seems totally unhelpful/empty/only boilerplate/same as definition, fallback to extracted Chinese
      if (extractedChinese) {
        const cleanExtracted = getCleanTranslation(extractedChinese, "", cleanSrcSentence);
        const cleanTrans = getCleanTranslation(finalSaveTrans, "", cleanSrcSentence);
        const isMeaningless = !cleanTrans || cleanTrans === currentWord.translation;
        if (cleanExtracted && isMeaningless) {
          finalSaveTrans = cleanExtracted;
        }
      }

      // 確保沒有任何屬性是 undefined（Firestore 不允許帶有 undefined 的屬性，即使是巢狀物件亦然，這會導致寫入失敗）
      const cleanChallenge: any = {
        sentence: cleanSrcSentence || "",
        translation: finalSaveTrans || "",
        contextChinese: currentChallenge.contextChinese || "",
        missingWord: currentChallenge.missingWord || "",
        source: currentChallenge.source || ""
      };
      
      if (currentChallenge.comment !== undefined && currentChallenge.comment !== null) {
        cleanChallenge.comment = currentChallenge.comment;
      }

      const docRef = doc(db, "vocab", currentWord.id);
      
      // 用於當文件原本不存在時 (例如：換完 Firebase 專案、切換帳號或意外刪除) 來完美重建
      const setPayload: any = {
        quizChallenge: cleanChallenge
      };
      
      if (currentWord.word) setPayload.word = currentWord.word;
      if (currentWord.phonetic) setPayload.phonetic = currentWord.phonetic;
      if (currentWord.translation) setPayload.translation = currentWord.translation;
      if (currentWord.examples) setPayload.examples = currentWord.examples;
      if (currentWord.creatorId) {
        setPayload.creatorId = currentWord.creatorId;
      } else if (auth.currentUser) {
        setPayload.creatorId = auth.currentUser.uid;
      }
      if (currentWord.isHard !== undefined) setPayload.isHard = currentWord.isHard;
      if (currentWord.createdAt) setPayload.createdAt = currentWord.createdAt;
      
      // 使用 setDoc 與 merge: true 取代 updateDoc，杜絕 No document to update 報錯
      await setDoc(docRef, setPayload, { merge: true });
      
      // 更新快取狀態為已儲存 (不再是 API 待存狀態)
      setChallengeFromApi(false);
      setChallengeFromApiCache(prev => ({ ...prev, [currentWord.word]: false }));
      
      // 更新本機單字清單的 quizChallenge 屬性，防重複呼叫
      setVocabPool(prev => prev.map(item => 
        item.id === currentWord.id ? { ...item, quizChallenge: cleanChallenge } : item
      ));
      setSessionList(prev => prev.map(item => 
        item.id === currentWord.id ? { ...item, quizChallenge: cleanChallenge } : item
      ));
      
      toast.success(`已將 "${currentWord.word}" 的情境題目永久儲存至雲端單字庫！ 💾`);
    } catch (err: any) {
      console.error("Failed to save challenge to Firestore:", err);
      const errMsg = err?.message || "請稍後再試";
      toast.error(`儲存題目失敗: ${errMsg}`);
    } finally {
      setIsSavingChallenge(false);
    }
  };

  // 5. Preload next question in backend for a luxury instant feeling
  const preloadNextChallenge = async () => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < sessionList.length) {
      const nextWord = sessionList[nextIndex];
      if (nextWord.quizChallenge && !isFallbackChallenge(nextWord.quizChallenge, nextWord.word, nextWord.translation) && !challengeCache[nextWord.word]) {
        setChallengeCache(prev => ({ ...prev, [nextWord.word]: nextWord.quizChallenge! }));
        setChallengeFromApiCache(prev => ({ ...prev, [nextWord.word]: false }));
        return;
      }
      if (!challengeCache[nextWord.word]) {
        try {
          generateQuizChallenge(nextWord.word, nextWord.translation, nextWord.examples).then(challenge => {
            setChallengeCache(prev => ({ ...prev, [nextWord.word]: challenge }));
            setChallengeFromApiCache(prev => ({ ...prev, [nextWord.word]: true }));
            // 遵循不要自動存的原則，這裡不寫入資料庫
          });
        } catch (e) {
          // Silent swallow preloads
        }
      }
    }
  };

  // Find the exact whole target word and segment the sentence around it. Matches screenshots details!
  const splitSentenceAtWord = (sentence: string, targetWord: string) => {
    if (!targetWord) return { before: "", match: "", after: "", found: false };
    
    // Clean targetWord
    const escapedWord = targetWord.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    
    // Attempt exact match with bound
    let regex = new RegExp(`\\b${escapedWord}\\b`, 'i');
    let match = sentence.match(regex);
    
    if (!match) {
      // Direct string matching
      regex = new RegExp(escapedWord, 'i');
      match = sentence.match(regex);
    }
    
    if (match && typeof match.index === 'number') {
      const matchedStr = match[0];
      const index = match.index;
      return {
        before: sentence.slice(0, index),
        match: matchedStr, // Captures exact uppercase/lowercase state inside example
        after: sentence.slice(index + matchedStr.length),
        found: true
      };
    }
    
    // Multi-word phrase sequential search fallback (e.g. "have ... in common" inside "We have a lot in common.")
    // Split targetWord into clean words
    const cleanWordForMatching = (str: string) => {
      return str.replace(/[^a-z0-9]/gi, "").toLowerCase();
    };
    
    const targetParts = targetWord.split(/[\s\.]+/).map(cleanWordForMatching).filter(p => p.length > 0);
    
    if (targetParts.length > 1) {
      const firstTargetWord = targetParts[0];
      const lastTargetWord = targetParts[targetParts.length - 1];
      
      const firstRegex = new RegExp(`\\b${firstTargetWord}\\b`, 'i');
      const firstMatch = sentence.match(firstRegex);
      
      if (firstMatch && typeof firstMatch.index === 'number') {
        const firstCharIndex = firstMatch.index;
        
        // Find last target word in sentence after first index
        const remainingSentence = sentence.slice(firstCharIndex + firstMatch[0].length);
        const lastRegex = new RegExp(`\\b${lastTargetWord}\\b`, 'i');
        const lastMatch = remainingSentence.match(lastRegex);
        
        if (lastMatch && typeof lastMatch.index === 'number') {
          const lastCharIndex = firstCharIndex + firstMatch[0].length + lastMatch.index + lastMatch[0].length;
          
          return {
            before: sentence.slice(0, firstCharIndex),
            match: sentence.slice(firstCharIndex, lastCharIndex),
            after: sentence.slice(lastCharIndex),
            found: true
          };
        }
      }
    }
    
    // Ultimate Fallback: find a reasonable place to put the gap, NOT at the start!
    // Often, the targetWord is a single word like "underworld", but maybe word mismatched due to spell/singular.
    // If we can't find any match, we place the gap at the end of the sentence before the punctuation.
    let beforeText = sentence;
    let afterText = "";
    
    const endPunctuationMatch = sentence.match(/[\.\?\!]+$/);
    if (endPunctuationMatch && typeof endPunctuationMatch.index === 'number') {
      const pIdx = endPunctuationMatch.index;
      const lastWordMatch = sentence.slice(0, pIdx).match(/\b\w+\b$/);
      if (lastWordMatch && typeof lastWordMatch.index === 'number') {
        beforeText = sentence.slice(0, lastWordMatch.index);
        afterText = lastWordMatch[0] + sentence.slice(pIdx);
      }
    } else {
      const lastWordMatch = sentence.match(/\b\w+\b$/);
      if (lastWordMatch && typeof lastWordMatch.index === 'number') {
        beforeText = sentence.slice(0, lastWordMatch.index);
        afterText = lastWordMatch[0];
      }
    }
    
    return {
      before: beforeText,
      match: targetWord,
      after: afterText ? " " + afterText : "",
      found: false
    };
  };

  // Checks user input against active target
  const handleCheckAnswer = async () => {
    if (!currentChallenge || challengeLoading) return;
    
    // Normalize and clean arrays for foolproof comparison to ignore symbols/spacings
    const cleanInputWords = getCleanTargetWords(userInput);
    const cleanCorrectWords = getCleanTargetWords(currentChallenge.missingWord);
    
    const isMatched = cleanInputWords.length === cleanCorrectWords.length &&
      cleanInputWords.every((word, idx) => {
        const valClean = word.toLowerCase().replace(/[^a-z0-9]/gi, "");
        const correctClean = cleanCorrectWords[idx].toLowerCase().replace(/[^a-z0-9]/gi, "");
        return valClean === correctClean;
      });
    
    setTotalAttempts(prev => prev + 1);

    if (isMatched) {
      setIsCorrect(true);
      if (!hasRevealedAnswer) {
        setCorrectCount(prev => prev + 1);
      }
      setPinkBubble({ show: false, text: "", loading: false });
      setSpellingDiagnosis(null);
      toast.success("太神了！完全正確 💎");
      
      // Auto-pronounce sentence on success to aid auditory pathways
      speak(cleanSentence);
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      setIsCorrect(false);
      
      // Save spelling feedback data for visual guide
      setSpellingDiagnosis({
        entered: userInput,
        correct: currentChallenge.missingWord
      });

      // Automatically replace the user's input with the corrected spelling (keeping correct letters, wrong letters replaced with '_')
      const targetWords = getCleanTargetWords(currentChallenge.missingWord);
      const updatedInputs = wordInputs.map((input, wordIdx) => {
        const correctWord = targetWords[wordIdx] || "";
        if (!input) return "_".repeat(correctWord.length); // If empty, make all underscores
        
        let result = "";
        for (let i = 0; i < correctWord.length; i++) {
          const charIn = input[i] || "";
          const charCorr = correctWord[i] || "";
          if (charIn.toLowerCase() === charCorr.toLowerCase() && charCorr !== "") {
            result += charCorr; // Keep correct characters (matching casing)
          } else {
            result += "_"; // Replace incorrect/missing with underscore
          }
        }
        return result;
      });
      setWordInputs(updatedInputs);
      setUserInput(updatedInputs.join(" "));

      // Visual Feedback: Show pink helper bubble
      setPinkBubble({
        show: true,
        text: "AI 正在分析拼寫與句意情境中...",
        loading: true
      });

      try {
        const explanation = await explainMisconception(
          userInput,
          currentChallenge.missingWord,
          sessionList[currentIndex].translation,
          cleanSentence
        );
        
        setPinkBubble({
          show: true,
          text: explanation || `「${userInput}」不符合句意。想想看有沒有別的可能？`,
          loading: false
        });
      } catch (err) {
        setPinkBubble({
          show: true,
          text: `「${userInput}」的多個意思中，此處並不契合。再想想看吧！`,
          loading: false
        });
      }
    }
  };

  const handleNextQuestion = () => {
    const nextIdx = currentIndex + 1;
    if (nextIdx < sessionList.length) {
      setCurrentIndex(nextIdx);
      loadChallengeForWord(sessionList[nextIdx]);
    } else {
      setIsSessionComplete(true);
    }
  };

  // Interactive Hints reveal mechanics
  const handleShowHint = () => {
    if (!currentChallenge) return;
    if (hintsLevel === 0) {
      setHintsLevel(1);
      // Pre-fill input value with first character to assist users
      const firstLetter = currentChallenge.missingWord[0];
      updateUserInputAndWordInputs(firstLetter);
      toast.info(`為您填入首字「${firstLetter}」囉！`);
    } else {
      setHintsLevel(2);
      setHasRevealedAnswer(true);
      updateUserInputAndWordInputs(currentChallenge.missingWord);
      setIsCorrect(true);
      if (attempts === 0) {
        setTotalAttempts(prev => prev + 1);
      }
      toast.info("已為您揭示正確答案！觀察拼法理解看看吧 💡");
      speak(cleanSentence);
    }
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      updateUserInputAndWordInputs("");
      setIsListening(true);
      recognitionRef.current?.start();
    }
  };

  const speak = (text: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      window.speechSynthesis.speak(utterance);
    }
  };

  const renderSpellingComparison = () => {
    if (!spellingDiagnosis) return null;
    
    const enteredWords = spellingDiagnosis.entered.trim().split(/\s+/);
    const correctWords = spellingDiagnosis.correct.trim().split(/\s+/);
    
    return (
      <div className="mt-2.5 p-3 bg-white/95 rounded-[1.25rem] border border-rose-100/60 shadow-sm space-y-2 text-slate-800">
        <div className="text-[10px] font-black text-rose-500 tracking-wider flex items-center gap-1">
          <Sparkles className="h-3 w-3 animate-pulse" /> 字母比對診斷 (Spelling Guide)
        </div>
        
        <div className="space-y-3">
          {correctWords.map((correctWord, wIdx) => {
            const enteredWord = enteredWords[wIdx] || "";
            
            let letters: { char: string; isCorrect: boolean }[] = [];
            for (let i = 0; i < correctWord.length; i++) {
              const entChar = enteredWord[i] || "";
              const corrChar = correctWord[i];
              const isMatch = entChar.toLowerCase() === corrChar.toLowerCase();
              letters.push({
                char: corrChar,
                isCorrect: isMatch && entChar !== ""
              });
            }
            
            return (
              <div key={wIdx} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-400 w-12 shrink-0">您輸入的：</span>
                  <div className="flex flex-wrap gap-0.5">
                    {enteredWord.split("").map((c, idx) => {
                      const corrChar = correctWord[idx] || "";
                      const isMatch = c.toLowerCase() === corrChar.toLowerCase();
                      return (
                        <span 
                          key={idx} 
                          className={`inline-flex items-center justify-center w-6 h-6 rounded text-[11px] font-black font-mono shadow-xs border ${
                            isMatch 
                              ? "bg-emerald-50 text-emerald-600 border-emerald-200" 
                              : "bg-rose-100 text-rose-600 border-rose-300 line-through decoration-rose-400 decoration-2"
                          }`}
                        >
                          {c}
                        </span>
                      );
                    })}
                    {enteredWord.length === 0 && <span className="text-slate-400 text-xs italic">空</span>}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-amber-600 w-12 shrink-0">自清除提示：</span>
                  <div className="flex flex-wrap gap-0.5">
                    {letters.map((letter, idx) => (
                      <span 
                        key={idx} 
                        className={`inline-flex items-center justify-center w-6 h-6 rounded text-[11px] font-black font-mono shadow-xs border ${
                          letter.isCorrect 
                            ? "bg-emerald-50 text-emerald-600 border-emerald-100 font-black" 
                            : "bg-amber-50 text-amber-700 border-amber-300 font-extrabold"
                        }`}
                      >
                        {letter.isCorrect ? letter.char : "_"}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        
        <p className="text-[10px] text-rose-500/80 italic leading-relaxed pt-1 border-t border-rose-100/30">
          💡 我們已自動為你保留拼對的字母，清除非對應的拼字（底線部分 Waiting for you!），你可直接在上面的輸入框填好送出！
        </p>
      </div>
    );
  };

  // Loading view
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-4">
        <RefreshCw className="h-10 w-10 animate-spin text-blue-500" />
        <p className="font-semibold text-slate-600">準備專屬智能情境題...</p>
      </div>
    );
  }

  // Database empty warning
  if (vocabPool.length === 0) {
    return (
      <Card className="border-slate-200 shadow-xl rounded-3xl bg-white overflow-hidden max-w-md mx-auto">
        <div className="p-10 text-center space-y-6">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto">
            <ShieldAlert className="h-8 w-8 text-slate-400" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-extrabold text-slate-800">單字本空空如也</h3>
            <p className="text-sm text-slate-500 leading-relaxed max-w-xs mx-auto">
              智能測驗需要依據您擁有的字組進行。請先從上方「辨識萃取」或「雲端單字」功能加入字卡吧！
            </p>
          </div>
          <Button onClick={fetchVocab} variant="outline" className="w-full h-11 rounded-xl">
            <RefreshCw className="h-4 w-4 mr-2" />
            重新整理載入
          </Button>
        </div>
      </Card>
    );
  }

  // Completion trophy screen
  if (isSessionComplete) {
    const accuracy = Math.round((correctCount / Math.max(totalAttempts, 1)) * 100);
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md mx-auto"
      >
        <Card className="border-none shadow-2xl rounded-[2.5rem] bg-gradient-to-b from-white via-slate-50 to-blue-50 overflow-hidden">
          <div className="p-8 text-center space-y-8">
            <div className="space-y-2">
              <div className="inline-flex p-4 bg-yellow-100 rounded-full text-yellow-600 mb-2 shadow-inner">
                <Trophy className="h-10 w-10 animate-bounce" />
              </div>
              <h2 className="text-2xl font-black text-slate-800 tracking-tight">智能測驗完美通關！</h2>
              <p className="text-xs text-slate-500">今日的英文肌肉又更紮實了！</p>
            </div>

            {/* Accurate Stats Circle */}
            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm grid grid-cols-2 gap-4 divide-x divide-slate-100">
              <div className="flex flex-col items-center justify-center">
                <span className="text-3xl font-black text-blue-600">{correctCount} <span className="text-xs text-slate-400">/ 10</span></span>
                <span className="text-xs text-slate-500 font-medium mt-1">答對字數</span>
              </div>
              <div className="flex flex-col items-center justify-center">
                <span className="text-3xl font-black text-emerald-500">{accuracy}%</span>
                <span className="text-xs text-slate-500 font-medium mt-1">作答準確率</span>
              </div>
            </div>

            {/* List of Words Reviewed */}
            <div className="text-left space-y-3">
              <h4 className="text-sm font-bold text-slate-700 px-1">本輪複習單字：</h4>
              <div className="max-h-52 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                {sessionList.map((item, i) => (
                  <div key={`quiz-review-${item.id}-${i}`} className="flex items-center justify-between text-xs bg-white p-3 rounded-xl border border-slate-100 hover:border-blue-100 transition-all gap-2">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleWordHardById(item.id, !!item.isHard, i, item.word)}
                        className={`h-7 w-7 rounded-lg shrink-0 transition-all active:scale-90 p-0 ${item.isHard ? 'text-amber-500 hover:text-amber-600' : 'text-slate-300 hover:text-slate-400'}`}
                        title={item.isHard ? "已設為常忘單字" : "設為常忘單字"}
                      >
                        <Star className={`h-4 w-4 ${item.isHard ? 'fill-amber-400 text-amber-500' : 'text-slate-300'}`} />
                      </Button>
                      <div className="flex flex-col">
                        <span className="font-extrabold text-slate-800">{item.word}</span>
                        <span className="text-[10px] text-slate-400 italic">{item.phonetic}</span>
                      </div>
                    </div>
                    <span className="text-slate-500 font-medium text-right break-words max-w-[150px]">{item.translation}</span>
                  </div>
                ))}
              </div>
            </div>

            <Button 
              onClick={() => startNewSession()} 
              className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20"
            >
              再來一輪全新挑戰！
              <ArrowRight className="h-5 w-5 ml-2" />
            </Button>
          </div>
        </Card>
      </motion.div>
    );
  }

  const currentWord = sessionList[currentIndex];

  const parsedSentence = currentChallenge ? splitSentenceAtWord(cleanSentence, currentChallenge.missingWord) : null;

  return (
    <div id="quiz-full-container" className="max-w-md mx-auto space-y-6">
      {/* Playful, mobile-centric Sky Blue Shell Frame wrapper matching screenshots */}
      <div className="bg-gradient-to-b from-[#b7dcfc] via-[#d5edff] to-[#f0f8ff] rounded-[3rem] p-5 shadow-[0_24px_50px_rgba(0,0,0,0.08)] border-4 border-white/90 overflow-hidden relative min-h-[580px] flex flex-col justify-between">
        
        {/* Sky gradient atmospheric highlights */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/20 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-8 -left-8 w-40 h-40 bg-white/15 rounded-full blur-3xl pointer-events-none" />

        {/* Outer Frame Top Controls */}
        <div className="flex justify-between items-center px-2 mb-4 z-10">
          <Button 
            variant="ghost" 
            size="icon" 
            className="w-10 h-10 rounded-full bg-white/60 hover:bg-white text-blue-900 border border-white/20 shadow-sm"
            onClick={() => startNewSession()}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          
          {/* Aesthetic Word Title header */}
          <span className="font-extrabold text-blue-950 text-sm tracking-wide bg-white/50 px-3 py-1 rounded-full border border-white/10 shadow-sm">
            智能語境關卡
          </span>

          <Button 
            variant="ghost" 
            size="icon" 
            className="w-10 h-10 rounded-full bg-white/60 hover:bg-white text-blue-900 border border-white/20 shadow-sm"
            onClick={() => setShowPhonetic(p => !p)}
            title={showPhonetic ? "隱藏音標" : "顯示音標"}
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>

        {/* 1. Gorgeous Wavy Glass Progress Bar matching screens */}
        <div className="w-full px-1 mb-5 z-10">
          <div className="flex items-center gap-2.5 w-full bg-white/50 backdrop-blur-md rounded-full p-1.5 border border-white/40 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
            {/* Action Flame Badge */}
            <div className="flex items-center gap-1 px-3 py-1 bg-gradient-to-b from-blue-500 to-indigo-600 text-white font-black text-xs rounded-full shadow-md animate-pulse">
              <Flame className="h-3.5 w-3.5 fill-white" />
              <span>{currentIndex + 1} / {sessionList.length}</span>
            </div>
            {/* Sliding Star Track */}
            <div className="relative flex-1 h-3.5 bg-slate-200/50 rounded-full overflow-hidden">
              <div 
                className="absolute left-0 top-0 h-full bg-gradient-to-r from-blue-400 via-indigo-500 to-sky-400 rounded-full transition-all duration-500 shadow-sm"
                style={{ width: `${((currentIndex + 1) / sessionList.length) * 100}%` }}
              />
            </div>
            {/* Star victory thumb */}
            <div className="p-1 bg-white rounded-full shadow-sm">
              <Star className="h-4 w-4 text-amber-500 fill-amber-400" />
            </div>
          </div>
        </div>

        {/* 2. Main Question Card Layout */}
        <div className="flex-1 flex flex-col justify-center relative z-10">
          <AnimatePresence mode="wait">
            {challengeLoading ? (
              <motion.div
                key="loader"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="bg-white/95 rounded-[2.5rem] shadow-[0_20px_40px_rgba(0,0,0,0.05)] p-10 text-center space-y-6 flex flex-col justify-center items-center min-h-[360px]"
              >
                <div className="relative">
                  <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-500 rounded-full animate-spin" />
                  <Sparkles className="h-6 w-6 text-indigo-500 absolute top-5 left-5 animate-pulse" />
                </div>
                <div className="space-y-2">
                  <p className="font-extrabold text-slate-800 text-lg">AI 專屬考題建置中...</p>
                  <p className="text-xs text-slate-400 max-w-[200px] leading-relaxed mx-auto">
                    我們正在為代表「<span className="font-semibold text-blue-500">{currentWord.translation}</span>」的單字精心編寫日常情境挑戰！
                  </p>
                </div>
              </motion.div>
            ) : currentChallenge ? (
              <motion.div
                key={`quiz-challenge-${currentWord.id}`}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
                className="bg-white/95 rounded-[2.5rem] shadow-[0_22px_45px_rgba(42,122,254,0.08)] border border-white/50 p-6 md:p-8 space-y-6 relative flex flex-col justify-between min-h-[360px]"
              >
                {/* Level badges and date representation directly matching user upload screenshot */}
                <div className="flex justify-between items-center text-xs text-slate-400">
                  <button
                    onClick={toggleCurrentWordHard}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-black border transition-all active:scale-95 shadow-xs ${
                      currentWord.isHard 
                        ? "bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200" 
                        : "bg-sky-50 hover:bg-sky-100 text-sky-700 border-sky-100"
                    }`}
                    title={currentWord.isHard ? "已設為常忘單字 (點擊取消)" : "設為常忘單字 (點擊加星)"}
                  >
                    <span>{currentWord.isHard ? "難級" : "5級"}</span>
                    <Star className={`h-3.5 w-3.5 shrink-0 transition-transform ${currentWord.isHard ? 'text-amber-500 fill-amber-400 scale-110' : 'text-slate-400 hover:text-amber-500'}`} />
                  </button>
                  
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => forceRegenerateChallenge(currentWord)}
                      className="group flex items-center gap-1 text-[10px] font-black text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-full transition-all border border-indigo-100/30 shadow-xs"
                      title="AI 語意有問題或有瑕疵？點擊讓 AI 重新出題！"
                    >
                      <RefreshCw className="h-2.5 w-2.5 transition-transform duration-500 group-hover:rotate-180 text-indigo-500" />
                      AI 重新出題
                    </button>
                    <span className="font-mono bg-slate-50 text-slate-400 px-2 py-0.5 rounded">
                      {Math.floor(Math.random() * 150) + 1}天前
                    </span>
                  </div>
                </div>

                {/* Scenario text translation content */}
                <div className="space-y-4">
                  {/* Scenario Chinese block */}
                  <div className="space-y-1">
                    {(() => {
                      const displayedCtx = getCleanContextChinese(currentChallenge.contextChinese);
                      
                      let baseTranslation = currentChallenge.translation || "";
                      
                      if (extractedChinese) {
                        const cleanExtracted = getCleanTranslation(extractedChinese, "", cleanSentence);
                        const cleanTrans = getCleanTranslation(baseTranslation, "", cleanSentence);
                        const isMeaningless = !cleanTrans || cleanTrans === currentWord.translation;
                        if (cleanExtracted && isMeaningless) {
                          baseTranslation = cleanExtracted;
                        }
                      }
                      
                      const displayedTrans = getCleanTranslation(baseTranslation, currentWord.translation, cleanSentence);
                      return (
                        <>
                          {displayedCtx && (
                            <p className="text-slate-500 text-xs font-semibold text-center leading-relaxed">
                              {displayedCtx}
                            </p>
                          )}
                          <p className="text-slate-800 font-extrabold text-base md:text-lg text-center leading-relaxed">
                            {displayedTrans}
                          </p>
                        </>
                      );
                    })()}
                  </div>

                  {/* Dynamic Cloze text input sentence container */}
                  {parsedSentence && (() => {
                    const targetWords = getCleanTargetWords(currentChallenge.missingWord);
                    return (
                      <div className="py-4 px-3 bg-slate-50/50 rounded-2xl border border-slate-100 text-center leading-relaxed">
                        <div className="text-lg font-bold text-slate-800 font-sans tracking-wide flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2.5">
                          <span className="break-words whitespace-normal text-slate-800">{parsedSentence.before}</span>
                          
                          {/* Multiple inline input fields exactly matching user's individual words */}
                          <span className="relative inline-flex flex-wrap items-center justify-center gap-2 align-middle mx-1 max-w-full">
                            {targetWords.map((word, idx) => {
                              const val = wordInputs[idx] || "";
                              
                              // Helper to clean words for foolproof comparison (alphanumeric only)
                              const cleanWordForComparison = (str: string) => {
                                if (!str) return "";
                                return str.trim().toLowerCase().replace(/[^a-z0-9]/gi, "");
                              };

                              const valClean = val.trim().toLowerCase();
                              const wordClean = word.trim().toLowerCase();
                              const isSingleWordCorrect = (valClean === wordClean || (cleanWordForComparison(val) === cleanWordForComparison(word))) && cleanWordForComparison(word) !== "";

                              // Proportional sizing: under (5 letters) is smaller than control (7 letters)
                              const wordWidth = Math.max(word.length || 3, 3) * 11 + 30;
                              
                              return (
                                <input
                                  key={idx}
                                  id={`quiz-input-${idx}`}
                                  type="text"
                                  autoComplete="off"
                                  autoFocus={idx === 0}
                                  disabled={isCorrect === true}
                                  className={`inline-block text-center font-extrabold text-lg px-2.5 py-1 rounded-2xl border-2 shadow-sm focus:outline-none focus:ring-4 transition-all ${
                                    (isCorrect === true || isSingleWordCorrect)
                                      ? 'bg-emerald-50 text-emerald-600 border-emerald-400 focus:ring-emerald-100/50 focus:border-emerald-500' 
                                      : isCorrect === false
                                      ? 'bg-rose-50 text-rose-900 border-rose-300 focus:ring-rose-100 focus:border-rose-500'
                                      : 'bg-blue-50/50 text-[#1e3a8a] border-blue-100 focus:ring-blue-100 focus:border-blue-500'
                                  }`}
                                  style={{ 
                                    width: `${wordWidth}px`,
                                    minWidth: '50px',
                                    maxWidth: '180px'
                                  }}
                                  placeholder={hintsLevel > 0 ? (word[0] || '') + '...' : ''}
                                  value={val}
                                  onChange={(e) => {
                                    const text = e.target.value.replace(/\s+/g, '');
                                    handleWordInputChange(idx, text);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Spacebar' || e.key === ' ') {
                                      e.preventDefault();
                                      const nextInput = document.getElementById(`quiz-input-${idx + 1}`);
                                      if (nextInput) {
                                        (nextInput as HTMLInputElement).focus();
                                      }
                                    } else if (e.key === 'Backspace' && !val) {
                                      e.preventDefault();
                                      const prevInput = document.getElementById(`quiz-input-${idx - 1}`);
                                      if (prevInput) {
                                        (prevInput as HTMLInputElement).focus();
                                      }
                                    } else if (e.key === 'Enter') {
                                      if (userInput) {
                                        handleCheckAnswer();
                                      }
                                    }
                                  }}
                                />
                              );
                            })}
                          </span>
                          
                          <span className="break-words whitespace-normal text-slate-800">{parsedSentence.after}</span>
                          
                          {/* Pronounce target volume tool icon - only show after answer is revealed to reinforce memory */}
                          {(isCorrect === true || hasRevealedAnswer) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => speak(cleanSentence)}
                              className="w-7 h-7 inline-flex items-center justify-center rounded-full bg-slate-200/50 hover:bg-slate-200 text-slate-500 shadow-sm animate-bounce"
                            >
                              <Volume2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* 3. AI Pink Explanation Bubble details matching user screenshots */}
                <AnimatePresence>
                  {pinkBubble.show && (
                    <motion.div
                      initial={{ opacity: 0, height: 0, y: 15 }}
                      animate={{ opacity: 1, height: 'auto', y: 0 }}
                      exit={{ opacity: 0, height: 0, y: 15 }}
                      className="bg-[#ffe4e6] border border-rose-200 p-4 rounded-3xl relative shadow-md text-xs text-[#e11d48] font-bold leading-relaxed overflow-hidden"
                    >
                      <div className="flex items-start gap-2.5">
                        <Heart className="h-4 w-4 shrink-0 fill-[#e11d48] text-[#e11d48] animate-pulse mt-0.5" />
                        <div className="flex-1 space-y-2">
                          {pinkBubble.loading ? (
                            <span className="inline-flex items-center gap-1.5 animate-pulse">
                              <RefreshCw className="h-3 w-3 animate-spin inline-block" />
                              AI 分析中，請稍候...
                            </span>
                          ) : (
                            <span>{pinkBubble.text}</span>
                          )}
                          
                          {/* Precise spelling diagnosis feedback visualization */}
                          {renderSpellingComparison()}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* 4. Frequently-forgotten word toggle with Star feedback */}
                {(isCorrect === true || hasRevealedAnswer === true) && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center justify-between p-3 bg-amber-50/70 hover:bg-amber-50 rounded-2xl border border-amber-200/50 shadow-xs mt-3 transition-colors animate-in fade-in slide-in-from-bottom-2 duration-300"
                  >
                    <div className="flex items-center gap-2">
                      <div className="relative flex items-center justify-center">
                        <Star className={`h-5 w-5 transition-transform duration-300 ${currentWord.isHard ? 'fill-amber-400 text-amber-500 scale-110 animate-pulse' : 'text-slate-300 hover:text-amber-400'}`} />
                        {currentWord.isHard && (
                          <span className="absolute -top-1 -right-1 flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                          </span>
                        )}
                      </div>
                      <div className="text-left">
                        <p className="text-xs font-black text-slate-800">
                          {currentWord.isHard ? "已歸類為「常忘單字」★" : "記不起來嗎？這題納入常忘吧！"}
                        </p>
                        <p className="text-[10px] text-slate-500 font-medium">
                          {currentWord.isHard ? "此單字將會加強複習與測驗出題 ⭐️" : "標記為常忘單字，未來系統將優先加強"}
                        </p>
                      </div>
                    </div>
                    
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={toggleCurrentWordHard}
                      className={`h-8 px-2.5 rounded-xl text-xs font-black transition-all border flex items-center gap-1 active:scale-95 ${
                        currentWord.isHard
                          ? "bg-amber-100 hover:bg-amber-200 border-amber-300 text-amber-800"
                          : "bg-white hover:bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-800"
                      }`}
                    >
                      <Star className={`h-3 w-3 ${currentWord.isHard ? 'fill-amber-500 text-amber-500' : 'text-slate-400'}`} />
                      {currentWord.isHard ? "已加星" : "加入常忘"}
                    </Button>
                  </motion.div>
                )}

                {/* Reference source at the bottom right corner exactly like [單字來源]What Women Want */}
                <div className="text-right text-[10px] text-slate-400 italic">
                  {currentChallenge.source ? `[詞彙來源] ${currentChallenge.source}` : `[單字本] 常考錯的單字`}
                </div>
              </motion.div>
            ) : (
              <div className="p-8 text-center bg-white rounded-3xl shadow">暫無本題挑戰情境</div>
            )}
          </AnimatePresence>
        </div>

        {/* 4. Play control buttons at the bottom of the sky outer frame */}
        <div className="space-y-3 mt-4 z-10 px-1">
          {/* Action Row 1: Helpers */}
          <div className="grid grid-cols-2 gap-3.5">
            <Button
              variant="outline"
              disabled={isCorrect === true || challengeLoading}
              className="h-12 bg-white/90 hover:bg-white text-slate-700 font-extrabold rounded-2xl shadow-sm border border-slate-100 transition-all hover:scale-[1.02]"
              onClick={handleShowHint}
            >
              <Lightbulb className="h-4.5 w-4.5 text-amber-500 mr-2" />
              {(attempts >= 1 || hintsLevel >= 1) ? "查看答案" : "查看提示"}
            </Button>

            <Button
              variant="outline"
              disabled={isCorrect === true || challengeLoading}
              className={`h-12 border font-extrabold border-b-4 rounded-2xl transition-all hover:scale-[1.02] ${
                isListening 
                  ? 'bg-rose-500 hover:bg-rose-600 border-rose-700 text-white animate-pulse' 
                  : 'bg-white/90 hover:bg-white border-slate-100 text-slate-700'
              }`}
              onClick={toggleListening}
            >
              <Mic className="h-4.5 w-4.5 text-blue-600 mr-2" />
              {isListening ? "聆聽中..." : "語音輸入"}
            </Button>
          </div>

          {/* Action Row 2: Submit and Next Step triggers */}
          <div className="flex gap-3">
            {isCorrect === true ? (
              <Button
                className="flex-1 h-12 bg-emerald-500 hover:bg-emerald-600 border-b-4 border-emerald-700 text-white font-extrabold rounded-2xl transition-all shadow-md animate-in fade-in duration-350"
                onClick={handleNextQuestion}
              >
                下一題
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            ) : (
              <Button
                className="flex-1 h-12 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-2xl shadow-lg border-b-4 border-blue-800 hover:scale-[1.01] active:translate-y-1 transition-all"
                onClick={handleCheckAnswer}
                disabled={!userInput || challengeLoading}
              >
                <Send className="h-4.5 w-4.5 mr-2" />
                確認答案
              </Button>
            )}
          </div>

          {/* 如果是 API 產生的題目，顯示手動存題目的按鈕 */}
          {challengeFromApi && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <Button
                variant="outline"
                disabled={isSavingChallenge}
                onClick={handleSaveChallengeToDb}
                className="w-full h-11 border border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100 text-indigo-700 font-extrabold rounded-2xl flex items-center justify-center gap-2 shadow-sm transition-all hover:scale-[1.01] active:scale-95"
              >
                {isSavingChallenge ? (
                  <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                ) : (
                  <Save className="h-4.5 w-4.5 text-indigo-500" />
                )}
                <span>
                  {currentWord.quizChallenge 
                    ? "此新題更佳，覆蓋更新雲端資料庫 💾" 
                    : "此題不錯，儲存至雲端資料庫 💾"
                  }
                </span>
              </Button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
