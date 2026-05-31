export interface VocabEntry {
  id: string;
  word: string;
  phonetic: string;
  translation: string;
  examples: string[];
  grammarPoints?: string[];
  creatorId: string;
  isHard?: boolean;
  createdAt: any; // Firestore Timestamp
}

export interface QuizQuestion {
  word: string;
  options: string[];
  correctIndex: number;
  translation: string;
  hint: string;
}
