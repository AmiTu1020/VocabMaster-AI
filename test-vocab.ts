import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, limit, query } from 'firebase/firestore';
import * as fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  const q = query(collection(db, 'vocabulary'), limit(5));
  const snap = await getDocs(q);
  snap.forEach(doc => {
    console.log('Word:', doc.data().word);
    console.log('Translation:', doc.data().translation);
    console.log('QuizChallenge:', JSON.stringify(doc.data().quizChallenge, null, 2));
    console.log('---');
  });
  process.exit(0);
}
run();
