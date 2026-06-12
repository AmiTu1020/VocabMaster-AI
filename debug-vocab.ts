import { db } from "./src/lib/firebase";
import { collection, query, getDocs } from "firebase/firestore";

async function run() {
  const q = query(collection(db, 'vocab'));
  const snap = await getDocs(q);
  const words: any[] = [];
  snap.forEach(doc => {
    words.push({id: doc.id, ...doc.data()});
  });

  const targetWords = ['will', 'post', 'previous', 'repair', 'textbook'];
  const matches = words.filter(w => {
    if (!w.word) return false;
    return targetWords.some(t => w.word.toLowerCase().includes(t));
  });
  
  console.log(JSON.stringify(matches.map(m => ({ 
    id: m.id, 
    word: m.word,
    translation: m.translation,
    hasQuiz: !!m.quizChallenge
  })), null, 2));

  process.exit(0);
}

run().catch(console.error);
