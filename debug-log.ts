import { db } from "./src/lib/firebase";
import { collection, query, getDocs } from "firebase/firestore";

function levenshtein(a: string, b: string): number {
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
}

async function run() {
  const q = query(collection(db, 'vocab'));
  const snap = await getDocs(q);
  const vocab: any[] = [];
  snap.forEach(doc => {
    vocab.push({id: doc.id, ...doc.data()});
  });

  const targets = ["like it here", "mixed up", "pay attention to", "see you then", "will", "post", "previous", "repair", "textbook"];
  
  for (let i = 0; i < vocab.length; i++) {
        const itemA = vocab[i];
        const rawA = String(itemA.word || "").trim().toLowerCase();
        
        let interestA = false;
        for (const t of targets) {
            if (rawA.includes(t)) { interestA = true; break; }
        }
        if (!interestA) continue;

        const cleanA = rawA.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '');
        const transA = String(itemA.translation || "").trim();
        const engA = rawA.split(/[\/\[（(【]/)[0].trim().replace(/[^a-z0-9\s-]/gi, '');

        for (let j = i + 1; j < vocab.length; j++) {
            const itemB = vocab[j];
            const rawB = String(itemB.word || "").trim().toLowerCase();
            
            let interestB = false;
            for (const t of targets) {
                if (rawB.includes(t)) { interestB = true; break; }
            }
            if (!interestB) continue;

            const cleanB = rawB.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '');
            const transB = String(itemB.translation || "").trim();
            const engB = rawB.split(/[\/\[（(【]/)[0].trim().replace(/[^a-z0-9\s-]/gi, '');

            let isMatch = false;
            let rule = "-";

          // Rule 1: Exact string match
          if (rawA === rawB) {
            isMatch = true; rule="1";
          } 
          // Rule 2: Exact match ignoring punctuation and spaces
          else if (cleanA === cleanB && cleanA.length > 0) {
            isMatch = true; rule="2";
          }
          // Rule 3: Pure English part exact match and one has phonetic or brackets
          else if (engA === engB && engA.length >= 3) {
            isMatch = true; rule="3";
          }
          // Rule 4: Common prefix like "to ", "i ", "a "
          else if (engA.replace(/^(i|to|a|an|the)\s+/, '') === engB || engB.replace(/^(i|to|a|an|the)\s+/, '') === engA) {
            isMatch = true; rule="4";
          }
          // Rule 5: Substring containment with translation match
          else if (engA.length >= 4 && engB.length >= 4 && (engA.includes(engB) || engB.includes(engA))) {
             const transCleanA = transA.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '');
             const transCleanB = transB.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '');
             if (transCleanA.length >= 2 && transCleanB.length >= 2) {
               if (transCleanA.includes(transCleanB) || transCleanB.includes(transCleanA)) {
                 isMatch = true; rule="5";
               }
             }
          }
          // Rule 6: Levenshtein distance for typos if translation matches exactly
          else if (transA === transB && transA.length > 0) {
            const dist = levenshtein(engA, engB);
            if (dist <= 1 && Math.max(engA.length, engB.length) >= 4) {
              isMatch = true; rule="6";
            }
          }

          if (rawA.length > 0 && rawB.length > 0 && engA.substring(0,3) === engB.substring(0,3)) {
              console.log(`[COMPARE] A: {word: "${itemA.word}", trans: "${transA}"}`);
              console.log(`          B: {word: "${itemB.word}", trans: "${transB}"}`);
              console.log(`          engA: "${engA}", engB: "${engB}"`);
              console.log(`          MATCH: ${isMatch} (Rule ${rule})`);
              console.log(`-----------------------------------------------`);
          }
        }
  }

  process.exit(0);
}

run().catch(console.error);
