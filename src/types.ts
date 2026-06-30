export interface VocabEntry {
  id: string;
  word: string;
  baseForm?: string;
  searchVariations?: string[];
  phonetic: string;
  translation: string;
  examples: string[];
  grammarPoints?: string[];
  creatorId: string;
  isHard?: boolean;
  createdAt: any; // Firestore Timestamp
  quizChallenge?: any;
  isRetry?: boolean; // Indicates if this question is a retry appended at the end of a quiz
}

export interface QuizQuestion {
  word: string;
  options: string[];
  correctIndex: number;
  translation: string;
  hint: string;
}
