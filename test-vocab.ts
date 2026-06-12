import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, limit, query } from 'firebase/firestore';
import * as fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  const q = query(collection(db, 'vocab'));
  const snap = await getDocs(q);
  const words: any[] = [];
  snap.forEach(doc => {
    words.push({id: doc.id, ...doc.data()});
  });
  
  const targetWords = ['will', 'post', 'previous', 'repair', 'special', 'textbook'];
  const matches = words.filter(w => targetWords.some(t => w.word.toLowerCase().includes(t)));
  console.log(JSON.stringify(matches.map(m => ({ id: m.id, word: m.word, wordLength: m.word.length, creatorId: m.creatorId, hasQuiz: !!m.quizChallenge })), null, 2));

  process.exit(0);
}
run();
