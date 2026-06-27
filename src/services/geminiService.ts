export interface QuizChallenge {
  sentence: string;
  translation: string;
  contextChinese: string;
  missingWord: string;
  source: string;
  comment?: string;
}

/**
 * Secures base64 screenshot extraction by delegating it to our Express server backend.
 */
export async function extractVocabFromImage(base64Image: string, mimeType: string = "image/png") {
  const response = await fetch("/api/gemini/extract-vocab", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ base64Image, mimeType }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || "圖片辨識失敗，請檢查網路或 API Key 設定");
  }

  return await response.json();
}

/**
 * Secures English vocabulary scenario quiz creation by delegating it to our Express server backend.
 */
export async function generateQuizChallenge(
  word: string,
  translation: string,
  existingExamples?: string[]
): Promise<QuizChallenge> {
  const response = await fetch("/api/gemini/generate-challenge", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ word, translation, existingExamples }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || "AI 考題生成失敗");
  }

  return await response.json() as QuizChallenge;
}

/**
 * Secures spelling diagnosis or misconception analysis by delegating it to our Express server backend.
 */
export async function explainMisconception(
  wrongInput: string,
  correctWord: string,
  translation: string,
  sentence: string
): Promise<string> {
  try {
    const response = await fetch("/api/gemini/explain-misconception", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ wrongInput, correctWord, translation, sentence }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return `「${wrongInput}」與此處句意不太相符。想想看別的單字，或是調整看看拼寫吧！`;
    }

    const data = await response.json();
    return data.explanation || `「${wrongInput}」與此處句意不太相符。`;
  } catch (err) {
    console.error("Failed to explain misconception:", err);
    return `「${wrongInput}」與此處句意不太相符。想想看別的單字，或是調整看看拼寫吧！`;
  }
}

/**
 * Generates American phonetic symbols for a batch of English words.
 */
export async function generatePhoneticsBatch(words: string[]): Promise<{ word: string; phonetic: string }[]> {
  const response = await fetch("/api/gemini/generate-phonetics-batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ words }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || "生成美式音標失敗");
  }

  return await response.json() as { word: string; phonetic: string }[];
}
