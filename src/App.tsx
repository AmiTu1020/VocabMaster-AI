import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { ImportPanel } from "./components/ImportPanel";
import { LibraryPanel } from "./components/LibraryPanel";
import { QuizPanel } from "./components/QuizPanel";
import { BookOpen, BookText, BrainCircuit, Loader2, LogIn, AlertTriangle, Key } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { auth } from "./lib/firebase";
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, User } from "firebase/auth";
import { Button } from "@/components/ui/button";

export default function App() {
  const [activeTab, setActiveTab] = useState("import");
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [apiKeyStatus, setApiKeyStatus] = useState<{
    showWarning: boolean;
    reason: 'missing' | 'placeholder' | 'gcp_restricted' | 'invalid_format' | 'none';
    details?: string;
  }>({ showWarning: false, reason: 'none' });

  useEffect(() => {
    fetch("/api/gemini/debug-key")
      .then(res => res.json())
      .then(data => {
        if (!data.isKeyPresent || data.status === 'missing') {
          setApiKeyStatus({ showWarning: true, reason: 'missing' });
        } else if (data.status === 'placeholder') {
          setApiKeyStatus({ showWarning: true, reason: 'placeholder' });
        } else if (data.status === 'gcp_restricted' || data.isGcpKey) {
          setApiKeyStatus({ 
            showWarning: true, 
            reason: 'gcp_restricted',
            details: `金鑰開頭為「${data.prefix || '無'}」，此為 Google Cloud 專案限制型或 Vertex AI 規格金鑰`
          });
        } else if (data.status === 'invalid_format' || !data.isValidPrefix) {
          setApiKeyStatus({ 
            showWarning: true, 
            reason: 'invalid_format',
            details: `金鑰長度：${data.length} 字元，開頭為「${data.prefix || '無'}」`
          });
        }
      })
      .catch(err => console.error("Failed to check Gemini key status:", err));
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const login = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error(error);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-[100dvh] bg-slate-50 font-sans text-slate-900 overflow-hidden flex flex-col">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 w-full flex flex-col min-h-0">
        <header className="flex-none z-50 border-b bg-white shadow-sm relative">
          <div className="container mx-auto flex h-[60px] sm:h-16 items-center justify-between px-4">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg">
                <BrainCircuit className="h-6 w-6" />
              </div>
              <h1 className="text-sm font-bold sm:text-xl tracking-tight bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent whitespace-nowrap">
                English Vocab Master
              </h1>
            </div>
            
            <nav>
              {user ? (
                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-end opacity-0 md:opacity-100 transition-opacity">
                    <span className="text-xs font-bold text-slate-900">{user.displayName}</span>
                    <span className="text-[10px] text-slate-500">{user.email}</span>
                  </div>
                  <img 
                    src={user.photoURL || ""} 
                    alt="Avatar" 
                    className="h-8 w-8 rounded-full border-2 border-primary/20 shadow-sm"
                  />
                  <Button variant="ghost" size="sm" onClick={() => auth.signOut()} className="text-xs">登出</Button>
                </div>
              ) : (
                <Button onClick={login} size="sm" className="gap-2 rounded-lg">
                  <LogIn className="h-4 w-4" />
                  登入
                </Button>
              )}
            </nav>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden w-full relative">
          <div className="container mx-auto px-4 py-4 sm:py-8 max-w-4xl h-full">
        {!user ? (
          <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl shadow-sm border border-slate-100">
             <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6">
                <BrainCircuit className="h-10 w-10 text-slate-400" />
             </div>
             <h2 className="text-2xl font-bold mb-2">歡迎使用 English Vocab Master</h2>
             <p className="text-slate-500 mb-8 text-center max-w-sm px-6">
                這款應用利用人工智慧幫助您從手機截圖中快速學習英文。請先登入以同步您的雲端單字庫。
             </p>
             <Button onClick={login} size="lg" className="px-8 h-12 rounded-xl text-md font-bold shadow-lg shadow-primary/20 transition-all hover:translate-y-[-2px] active:translate-y-[0px] gap-2">
               <LogIn className="h-5 w-5" />
               使用 Google 帳號開始
             </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {apiKeyStatus.showWarning && (
              <div id="gemini-key-warning" className="flex flex-col sm:flex-row items-start sm:items-center gap-3.5 p-4 rounded-2xl bg-amber-50 border border-amber-100 text-amber-800 shadow-sm transition-all animate-in fade-in slide-in-from-top-2 duration-300 mb-6">
                <div className="p-2 bg-amber-500 text-white rounded-xl shadow-sm flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm tracking-tight flex items-center gap-1">
                      <Key className="h-3.5 w-3.5 inline text-amber-600 animate-pulse" />
                      Gemini API 金鑰設定提示
                    </span>
                    <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-amber-150 uppercase tracking-wider rounded border border-amber-200">
                      {apiKeyStatus.reason === 'missing' ? '未置入金鑰' : apiKeyStatus.reason === 'placeholder' ? '預設占位符' : apiKeyStatus.reason === 'gcp_restricted' ? 'GCP/Vertex限制金鑰' : '無效金鑰格式'}
                    </span>
                  </div>
                  <p className="text-xs text-amber-700/90 leading-relaxed font-normal">
                    {apiKeyStatus.reason === 'missing' && "伺服器端尚未偵測到您的 GEMINI_API_KEY 金鑰。"}
                    {apiKeyStatus.reason === 'placeholder' && "目前偵測到的 GEMINI_API_KEY 為預設樣板字串，非有效金鑰。"}
                    {apiKeyStatus.reason === 'gcp_restricted' && `系統偵測到其開頭為 AQ.（此為 Google Cloud Vertex AI 或專案限制型金鑰，無法直接用於標準 Gemini API SDK 中，通常會導致 ApiError 400 API key not valid 錯誤）。`}
                    {apiKeyStatus.reason === 'invalid_format' && `偵測到無效的 API Key。目前金鑰偵測細節：${apiKeyStatus.details || ""}`}
                    {"請至右上角點擊齒輪圖示 "}<strong>Settings⚙️ &gt; Secrets</strong>{" 填入以「AIzaSy」開頭之標準 Google AI Studio 專用金鑰，即可完美啟動情境題目生成！"}
                  </p>
                </div>
              </div>
            )}

            <div className="sticky top-0 z-40 bg-slate-50/95 backdrop-blur-md transform-gpu py-3 -mx-4 px-4 sm:-mx-0 sm:px-0 border-b border-transparent shadow-sm shadow-slate-200/50 !mt-0 !pt-2">
              <TabsList className="flex w-full h-auto p-1 bg-slate-200/80 rounded-xl overflow-x-auto shadow-inner">
                <TabsTrigger 
                  value="import" 
                  className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all flex items-center justify-center gap-1.5 flex-1 min-h-[44px] px-2 whitespace-nowrap"
                >
                  <BookOpen className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-medium">辨識萃取</span>
                </TabsTrigger>
                <TabsTrigger 
                  value="library" 
                  className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all flex items-center justify-center gap-1.5 flex-1 min-h-[44px] px-2 whitespace-nowrap"
                >
                  <BookText className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-medium">雲端單字</span>
                </TabsTrigger>
                <TabsTrigger 
                  value="quiz" 
                  className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all flex items-center justify-center gap-1.5 flex-1 min-h-[44px] px-2 whitespace-nowrap"
                >
                  <BrainCircuit className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-medium">智能測驗</span>
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="mt-4">
              <div className={activeTab === "import" ? "block" : "hidden"}>
                <ImportPanel />
              </div>
              <div className={activeTab === "library" ? "block" : "hidden"}>
                <LibraryPanel isActive={activeTab === "library"} />
              </div>
              <div className={activeTab === "quiz" ? "block" : "hidden"}>
                <QuizPanel />
              </div>
            </div>
          </div>
        )}
        </div>
      </main>
      </Tabs>

      <Toaster position="top-center" richColors />
    </div>
  );
}
