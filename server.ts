import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string = "Request timed out"): Promise<T> {
  let timeoutId: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

// -------------------------------------------------------------
// Server-Side Gemini Helpers
// -------------------------------------------------------------

function getSanitizedApiKey(): string | undefined {
  let key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.log("[GEMINI_API_KEY Debug] Key is undefined or empty");
    return undefined;
  }
  const originalRaw = key;
  key = key.trim().replace(/^["']|["']$/g, '');
  
  // Safe diagnostic log of the key to server terminal
  const isAiza = key.startsWith("AIzaSy");
  const prefix = key.length >= 6 ? key.substring(0, 6) : key;
  const suffix = key.length >= 4 ? key.substring(key.length - 4) : "";
  console.log(`[GEMINI_API_KEY Debug] Key length: ${key.length}, Raw length: ${originalRaw.length}, startsWith AIzaSy: ${isAiza}, Prefix: "${prefix}", Suffix: "${suffix}"`);

  if (!key || key === "PLACEHOLDER" || key === "YOUR_API_KEY" || key === "TODO" || key === "undefined" || key === "null") {
    console.log("[GEMINI_API_KEY Debug] Key matches a known placeholder or invalid string.");
    return undefined;
  }
  return key;
}

async function extractVocabFromImageServer(base64Image: string, mimeType: string = "image/png") {
  const apiKey = getSanitizedApiKey();
  if (!apiKey) {
    throw new Error("請先在 Settings > Secrets 中設定 GEMINI_API_KEY");
  }

  const ai = new GoogleGenAI({ 
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
  
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

  const response = await withTimeout(
    ai.models.generateContent({
      model: "gemini-2.5-flash",
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
    }),
    20000,
    "圖片辨識超時，請重試或確認網路連接狀況"
  );

  const text = response.text;
  if (!text) return [];
  return JSON.parse(text);
}

export interface QuizChallenge {
  sentence: string;
  translation: string;
  contextChinese: string;
  missingWord: string;
  source: string;
  comment?: string;
}

async function generateQuizChallengeServer(
  word: string,
  translation: string,
  existingExamples?: string[]
): Promise<QuizChallenge> {
  const apiKey = getSanitizedApiKey();
  if (!apiKey) {
    throw new Error("請先在 Settings > Secrets 中設定 GEMINI_API_KEY");
  }

  const ai = new GoogleGenAI({ 
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
  
  const candidateExample = existingExamples && existingExamples.length > 0 ? existingExamples[0] : "";
  
  const prompt = `You are an expert compiler for an interactive English language learning app.
  Given the English word: "${word}" (primary translation: "${translation}").
  ${candidateExample ? `The word has this existing example sentence in the database: "${candidateExample}". Use it, or design an improved version.` : `Please construct a natural and realistic example sentence containing this word.`}
  
  Generate a high-yield interactive vocabulary quiz challenge in Traditional Chinese. Output ONLY a valid JSON object matching the schema exactly.
  
  Guidelines for components:
  1. "sentence": The complete English sentence containing the target word is vital. Keep it clear, natural, and accessible.
  2. "translation": A natural Traditional Chinese translation of this sentence. DO NOT include any meta-text, round bracket qualifiers, or helper instruction texts like "（句中空格之單字代表...）" or "填空挑戰" - simply translate the english sentence cleanly.
  3. "contextChinese": A brief situational background explanation in Traditional Chinese (e.g. '在討論未來規劃或目標時' or '在辦公室與主管閒聊時'). DO NOT write any literal instructions! Strictly skip boilerplate prefixes like '挑戰練習：根據語意情境拼寫' - just provide a realistic situational setting. Leave empty "" if no interesting setting fits.
  4. "missingWord": The EXACT spelling of the target word as it appears in this sentence (matching shape, case, capitalization - e.g. "Also" or "improved" or "Then").
  5. "source": An authentic-sounding movie source, book name, or conversation context tag (e.g. "What Women Want", "Finding Dory", "The Social Network", or "Business Daily" - make it feel premium).`;

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: "gemini-2.5-flash",
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
      }),
      18000,
      "AI 考題生成超時"
    );

    const text = response.text;
    if (!text) {
      throw new Error("Gemini returned empty response for challenge generator");
    }
    return JSON.parse(text) as QuizChallenge;
  } catch (error) {
    console.error("Server generateQuizChallengeServer failed:", error);
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
      "We should go see a 1-hour concert.": "我們應該去聽一場一小時的音樂會。",
      "In Greek mythology, Hades is the god of the underworld.": "在希臘神話中，黑帝斯是冥界之神。",
      "In Greek mythology, Hades is the god of the underworld": "在希臘神話中，黑帝斯是冥界之神。",
      "She went downstairs to open the door.": "她去樓下打開門。",
      "She went downstairs to open the door": "她去樓下打開門。"
    };

    const cleanExample = candidateExample?.trim() || "";
    let finalSentence = cleanExample;
    let finalTranslation = "";
    let finalContext = "";

    if (!finalSentence) {
      finalSentence = `We should learn how to use "${word}" correctly in daily life.`;
      finalTranslation = `我們應該學會在日常生活中正確使用「${translation}」這個詞。`;
      detectedMissingWord = word;
    } else {
      const normalizeKey = (str: string) => str.trim().toLowerCase().replace(/[\.\?!]$/, "");
      const foundFallbackKey = Object.keys(translationsMap).find(
        (key) => normalizeKey(key) === normalizeKey(cleanExample)
      );

      if (foundFallbackKey) {
        finalTranslation = translationsMap[foundFallbackKey];
        finalContext = "";
      } else {
        const errStr = String(error);
        const isAuthError = errStr.includes("API key not valid") || errStr.includes("INVALID_ARGUMENT") || errStr.includes("API_KEY_INVALID");
        
        const getFallbackMsg = () => {
          const lowerS = cleanExample.toLowerCase().trim();
          if (lowerS.startsWith("don't be") || lowerS.includes(" don't be ")) {
            return `不要${translation.replace(/的$/, "")}`;
          }
          return translation;
        };

        if (!isAuthError) {
          try {
            const simpleAi = new GoogleGenAI({ apiKey });
            const res = await withTimeout(
              simpleAi.models.generateContent({
                model: "gemini-2.5-flash",
                contents: `請將這句英文翻譯成通順自然的繁體中文，不要有任何其他多餘字元、解釋或引號： "${cleanExample}"`
              }),
              6000,
              "快譯超時"
            );
            const apiTrans = res.text?.trim() || "";
            if (apiTrans && apiTrans.length > 0 && !apiTrans.includes("Error") && !apiTrans.includes("API")) {
              finalTranslation = apiTrans;
            } else {
              finalTranslation = getFallbackMsg();
            }
          } catch (innerErr) {
            finalTranslation = getFallbackMsg();
          }
        } else {
          finalTranslation = getFallbackMsg();
        }
        finalContext = "在日常或特定情境中使用此詞彙時";
      }
    }

    return {
      sentence: finalSentence,
      translation: finalTranslation,
      contextChinese: finalContext,
      missingWord: detectedMissingWord,
      source: `[單字本] ` + fallbackSource
    };
  }
}

async function explainMisconceptionServer(
  wrongInput: string,
  correctWord: string,
  translation: string,
  sentence: string
): Promise<string> {
  const apiKey = getSanitizedApiKey();
  if (!apiKey) return `「${wrongInput}」與此處句意不太相符。想想看別的單字，或是調整看看拼寫吧！`;

  const ai = new GoogleGenAI({ 
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
  
  const prompt = `Explain briefly, in a single short sentence in Traditional Chinese, why the word "${wrongInput}" is incorrect or matches a different meaning/nuance compared to the correct target word "${correctWord}" (meaning "${translation}") within the English context sentence: "${sentence}".
  Format your response EXACTLY like this template: "${wrongInput}的多個意思（[Traditional Chinese meanings of ${wrongInput}]......）中，沒有「${translation}」的意思。想想看別的單字吧。" Keep it extremely friendly, warm, encouraging, and clear.`;

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt
      }),
      8000,
      "AI 分析拼答超時"
    );
    return response.text?.trim() || "";
  } catch (error) {
    console.error("Server explainMisconceptionServer failed:", error);
    return `「${wrongInput}」與此處句意不太相符。想想看別的單字，或是調整看看拼寫吧！`;
  }
}

// -------------------------------------------------------------
// Express Server Orchestration
// -------------------------------------------------------------

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));

  // API Endpoints proxying Gemini securely
  app.post("/api/gemini/extract-vocab", async (req, res) => {
    try {
      const { base64Image, mimeType } = req.body;
      if (!base64Image) {
        return res.status(400).json({ error: "Missing base64Image" });
      }
      const result = await extractVocabFromImageServer(base64Image, mimeType);
      res.json(result);
    } catch (error: any) {
      console.error("API extract-vocab failed:", error);
      res.status(500).json({ error: error.message || "Extraction failed" });
    }
  });

  app.post("/api/gemini/generate-challenge", async (req, res) => {
    try {
      const { word, translation, existingExamples } = req.body;
      if (!word) {
        return res.status(400).json({ error: "Missing word" });
      }
      const result = await generateQuizChallengeServer(word, translation, existingExamples);
      res.json(result);
    } catch (error: any) {
      console.error("API generate-challenge failed:", error);
      res.status(500).json({ error: error.message || "Challenge generation failed" });
    }
  });

  app.post("/api/gemini/explain-misconception", async (req, res) => {
    try {
      const { wrongInput, correctWord, translation, sentence } = req.body;
      if (!wrongInput || !correctWord) {
        return res.status(400).json({ error: "Missing wrongInput or correctWord" });
      }
      const explanation = await explainMisconceptionServer(wrongInput, correctWord, translation, sentence);
      res.json({ explanation });
    } catch (error: any) {
      console.error("API explain-misconception failed:", error);
      res.status(500).json({ error: error.message || "Explanation failed" });
    }
  });

  app.get("/api/gemini/debug-key", (req, res) => {
    const key = getSanitizedApiKey();
    if (!key) {
      return res.json({
        isKeyPresent: false,
        length: 0,
        prefix: "",
        isValidPrefix: false,
        isPlaceholder: true,
        isGcpKey: false,
        status: "missing"
      });
    }

    const isAiza = key.startsWith("AIzaSy");
    const isGcpKey = key.startsWith("AQ.");
    const isValidPrefix = isAiza || isGcpKey;
    const isPlaceholderStr = key === "PLACEHOLDER" || key === "YOUR_API_KEY" || key === "TODO" || key === "undefined" || key === "null";
    
    res.json({
      isKeyPresent: true,
      length: key.length,
      prefix: key.length >= 6 ? key.substring(0, 6) : key,
      isValidPrefix: isValidPrefix,
      isPlaceholder: isPlaceholderStr,
      isGcpKey: isGcpKey,
      status: isPlaceholderStr ? "placeholder" : (isAiza ? "valid" : (isGcpKey ? "gcp_restricted" : "invalid_format"))
    });
  });

  // Serve static files / Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
