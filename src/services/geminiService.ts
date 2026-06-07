import { GoogleGenAI, Type } from "@google/genai";

export async function extractVocabFromImage(base64Image: string, mimeType: string = "image/png") {
  // In AI Studio environment, process.env.GEMINI_API_KEY is injected into the frontend
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error("請先在 Secrets 中設定 GEMINI_API_KEY");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  try {
    const prompt = `You are a specialist in extracting language learning data from screenshots (e.g., dictionary lookups, books, quiz pages, test papers).
    Analyze this screenshot and extract the primary vocabulary items being shown.
    
    Critical Instruction:
    - If a screenshot shows a group of related words (e.g. underwater, underground, underworld), extract each as a SEPARATE entry.
    - Each entry must be a complete word.
    
    Extraction Targets for each entry:
    1. Main Word: The word being defined or listed.
    2. Phonetics: Look for phonetic transcriptions (such as in slashes /.../).
    3. Translation: Traditional Chinese explanation (繁體中文).
    4. Example Sentences: Extract 1-3 usage sentences shown.
    5. Quiz Challenge (quizChallenge): Generate or extract a fill-in-the-blank question for learning this word.
       - CRITICAL: You MUST mimic and adapt the exact instructions, hints, prompts, or clues shown on the screenshot! If the image lists specific definitions, clues, words starting with a particular letter, or options, you must synthesize and incorporate them into "contextChinese" (or "translation"). The goal is to preserve the visual and educational pedagogy shown on the image.
       - The object must contain:
         - "sentence": The full English sentence incorporating the word (e.g., from the example).
         - "translation": Natural Traditional Chinese translation of this sentence.
         - "contextChinese": A Traditional Chinese scenario prompt, helpful clue, or custom hint mimicking the screenshot's guidelines.
         - "missingWord": The exact spelling of the target word in this sentence.
         - "source": "影像辨識萃取" or the dictionary/book source title visible in the image.
    
    Rules:
    - If no vocabulary is clearly found, return [].
    - Always output valid JSON using the responseSchema.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: {
        parts: [
          { inlineData: { data: base64Image, mimeType } },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              word: { type: Type.STRING },
              phonetic: { type: Type.STRING },
              translation: { type: Type.STRING },
              examples: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              quizChallenge: {
                type: Type.OBJECT,
                properties: {
                  sentence: { type: Type.STRING },
                  translation: { type: Type.STRING },
                  contextChinese: { type: Type.STRING },
                  missingWord: { type: Type.STRING },
                  source: { type: Type.STRING }
                },
                required: ["sentence", "translation", "contextChinese", "missingWord", "source"]
              }
            },
            required: ["word", "phonetic", "translation", "examples"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    return JSON.parse(text);
  } catch (error: any) {
    console.error("Gemini Frontend Error:", error);
    // Handle API key validation errors specifically for the user
    if (error.message?.includes("API key not valid") || error.message?.includes("403") || error.message?.includes("400")) {
      throw new Error(`API Key 無效或不正確 (${error.message.slice(0, 50)}...)。請在右上角 Secrets 重新選擇有效的金鑰並儲存。`);
    }
    throw error;
  }
}

export interface QuizChallenge {
  sentence: string;
  translation: string;
  contextChinese: string;
  missingWord: string;
  source: string;
  comment?: string;
}

export async function generateQuizChallenge(
  word: string,
  translation: string,
  existingExamples?: string[]
): Promise<QuizChallenge> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("請先在 Secrets 中設定 GEMINI_API_KEY");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  // Clean example if exists
  const candidateExample = existingExamples && existingExamples.length > 0 ? existingExamples[0] : "";
  
  const prompt = `You are an expert compiler for an interactive English language learning app.
  Given the English word: "${word}" (primary translation: "${translation}").
  ${candidateExample ? `The word has this existing example sentence in the database: "${candidateExample}". Use it, or design an improved version.` : `Please construct a natural and realistic example sentence containing this word.`}
  
  Generate a high-yield interactive vocabulary quiz challenge in Traditional Chinese. Output ONLY a valid JSON object matching the schema exactly.
  
  Guidelines for components:
  1. "sentence": The complete English sentence containing the target word is vital. Keep it clear, natural, and accessible.
  2. "translation": A natural Traditional Chinese translation of this sentence.
  3. "contextChinese": A preamble, prompt, or scenario explaining the situation or background in Traditional Chinese, setting the context before the user sees the sentence (e.g. '兩點要接受媒體採訪，三點有行政會議', or a situational clue!).
  4. "missingWord": The EXACT spelling of the target word as it appears in this sentence (matching shape, case, capitalization - e.g. "Also" or "improved" or "Then").
  5. "source": An authentic-sounding movie source, book name, or conversation context tag (e.g. "What Women Want", "Finding Dory", "The Social Network", or "Business Daily" - make it feel premium).`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sentence: { type: Type.STRING },
            translation: { type: Type.STRING },
            contextChinese: { type: Type.STRING },
            missingWord: { type: Type.STRING },
            source: { type: Type.STRING },
            comment: { type: Type.STRING }
          },
          required: ["sentence", "translation", "contextChinese", "missingWord", "source"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("Gemini returned empty response for challenge generator");
    }
    return JSON.parse(text) as QuizChallenge;
  } catch (error) {
    console.error("generateQuizChallenge failed:", error);
    // Safe mock fallback if Gemini is overloaded or disconnected
    const fallbackSource = ["What Women Want", "Modern Family", "Finding Nemo", "The Intern", "The Social Network"][Math.floor(Math.random() * 5)];
    
    let detectedMissingWord = word;
    if (candidateExample) {
      const idx = candidateExample.toLowerCase().indexOf(word.toLowerCase());
      if (idx !== -1) {
        detectedMissingWord = candidateExample.substring(idx, idx + word.length);
      }
    }

    // High quality translation map for common database/mock values
    const translationsMap: Record<string, string> = {
      "I still haven't got used to working from home.": "我仍然不習慣在家工作。",
      "Explain why you did it, and also why it was necessary.": "解釋你為什麼這樣做，以及為什麼這是必要的。",
      "I have all the works of Shakespeare on my phone.": "我手機裡有莎士比亞的所有作品。",
      "Do you have any suggestions for sightseeing?": "你有任何觀光的建議嗎？",
      "We should go see a 1-hour concert.": "我們應該去聽一場一小時的音樂會。"
    };

    const cleanExample = candidateExample?.trim() || "";
    let finalTranslation = "解釋你為什麼這樣做，以及為什麼這是必要的。";
    let finalContext = "當長官對你的決定提出質疑時，試著誠實、具建設性地回應：";

    if (candidateExample) {
      if (translationsMap[cleanExample]) {
        finalTranslation = translationsMap[cleanExample];
        finalContext = `「${word}」在日常口語中可代表「${translation}」，試著填空它：`;
      } else {
        // Safe secondary lazy direct translation call to get high level quality Chinese translation
        try {
          // Inside catch block, retry a minimal single call exclusively for translation
          const simpleAi = new GoogleGenAI({ apiKey });
          const res = await simpleAi.models.generateContent({
            model: "gemini-3.5-flash",
            contents: `請將這句英文翻譯成通順自然的繁體中文例句，不要有任何其他多餘字元或引號： "${cleanExample}"`
          });
          const apiTrans = res.text?.trim() || "";
          if (apiTrans && apiTrans.length > 0 && !apiTrans.includes("Error") && !apiTrans.includes("API")) {
            finalTranslation = apiTrans;
          } else {
            finalTranslation = `（請試著填入代表「${translation}」之英文，本句意指此意境。）`;
          }
        } catch (innerErr) {
          finalTranslation = `（配合上下文填入最適合的單字，意思為「${translation}」）`;
        }
        finalContext = `填空練習「${word}」（${translation}）例句：`;
      }
    }

    return {
      sentence: candidateExample || `Explain why you did it, and also why it was necessary.`,
      translation: finalTranslation,
      contextChinese: finalContext,
      missingWord: detectedMissingWord,
      source: `[單字本] ` + fallbackSource
    };
  }
}

export async function explainMisconception(
  wrongInput: string,
  correctWord: string,
  translation: string,
  sentence: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return "";

  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `Explain briefly, in a single short sentence in Traditional Chinese, why the word "${wrongInput}" is incorrect or matches a different meaning/nuance compared to the correct target word "${correctWord}" (meaning "${translation}") within the English context sentence: "${sentence}".
  Format your response EXACTLY like this template: "${wrongInput}的多個意思（[Traditional Chinese meanings of ${wrongInput}]......）中，沒有「${translation}」的意思。想想看別的單字吧。" Keep it extremely friendly, warm, encouraging, and clear.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt
    });
    return response.text?.trim() || "";
  } catch (error) {
    console.error("explainMisconception failed, falling back:", error);
    return `「${wrongInput}」與此處句意不太相符。想想看別的單字，或是調整看看拼寫吧！`;
  }
}
