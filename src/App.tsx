import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { ImportPanel } from "./components/ImportPanel";
import { LibraryPanel } from "./components/LibraryPanel";
import { QuizPanel } from "./components/QuizPanel";
import { BookOpen, BookText, BrainCircuit, Loader2, LogIn } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { auth } from "./lib/firebase";
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, User } from "firebase/auth";
import { Button } from "@/components/ui/button";

export default function App() {
  const [activeTab, setActiveTab] = useState("import");
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

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
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg">
              <BrainCircuit className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
              VocabMaster AI
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

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {!user ? (
          <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl shadow-sm border border-slate-100">
             <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6">
                <BrainCircuit className="h-10 w-10 text-slate-400" />
             </div>
             <h2 className="text-2xl font-bold mb-2">歡迎使用 VocabMaster AI</h2>
             <p className="text-slate-500 mb-8 text-center max-w-sm px-6">
                這款應用利用人工智慧幫助您從手機截圖中快速學習英文。請先登入以同步您的雲端單字庫。
             </p>
             <Button onClick={login} size="lg" className="px-8 h-12 rounded-xl text-md font-bold shadow-lg shadow-primary/20 transition-all hover:translate-y-[-2px] active:translate-y-[0px] gap-2">
               <LogIn className="h-5 w-5" />
               使用 Google 帳號開始
             </Button>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-8 h-12 p-1 bg-slate-100 rounded-xl overflow-hidden shadow-sm">
              <TabsTrigger 
                value="import" 
                className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all flex items-center gap-2"
              >
                <BookOpen className="h-4 w-4" />
                <span className="hidden sm:inline">辨識萃取</span>
              </TabsTrigger>
              <TabsTrigger 
                value="library" 
                className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all flex items-center gap-2"
              >
                <BookText className="h-4 w-4" />
                <span className="hidden sm:inline">雲端單字</span>
              </TabsTrigger>
              <TabsTrigger 
                value="quiz" 
                className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all flex items-center gap-2"
              >
                <BrainCircuit className="h-4 w-4" />
                <span className="hidden sm:inline">智能測驗</span>
              </TabsTrigger>
            </TabsList>

            <div className="mt-4">
              <div className={activeTab === "import" ? "block" : "hidden"}>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ImportPanel />
                </motion.div>
              </div>
              <div className={activeTab === "library" ? "block" : "hidden"}>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <LibraryPanel />
                </motion.div>
              </div>
              <div className={activeTab === "quiz" ? "block" : "hidden"}>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <QuizPanel />
                </motion.div>
              </div>
            </div>
          </Tabs>
        )}
      </main>

      <Toaster position="top-center" richColors />
    </div>
  );
}
