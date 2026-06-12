import { db } from "./src/lib/firebase";
import { collection, query, getDocs } from "firebase/firestore";
import * as fs from "fs";

async function run() {
  const q = query(collection(db, 'vocab'));
  const snap = await getDocs(q);
  const vocab: any[] = [];
  snap.forEach(doc => {
    vocab.push({id: doc.id, ...doc.data()});
  });

  const targetWords = ['will', 'post', 'previous', 'repair', 'textbook', 'like it here', 'mixed up', 'pay attention to', 'see you then', 'hardly think so', 'I hardly think so'];
  
  const matches = vocab.filter(w => {
    if (!w.word) return false;
    const l = w.word.toLowerCase();
    return targetWords.some(t => l.includes(t.toLowerCase()));
  });

  fs.writeFileSync('dups.json', JSON.stringify(matches.map(m => ({ 
    id: m.id, 
    creatorId: m.creatorId,
    word: m.word,
    hasQuiz: !!m.quizChallenge
  })), null, 2));

  process.exit(0);
}

run().catch(err => {
  fs.writeFileSync('dups.json', JSON.stringify({error: err.message}));
});

