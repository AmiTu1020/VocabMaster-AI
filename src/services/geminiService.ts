import { GoogleGenAI, Type } from "@google/genai";

export async function extractVocabFromImage(base64Image: string, mimeType: string = "image/png") {
  // In AI Studio environment, process.env.GEMINI_API_KEY is injected into the frontend
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error("請先在 Secrets 中設定 GEMINI_API_KEY");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  try {
    const prompt = `You are a specialist in extracting language learning data from screenshots.
    Analyze this dictionary or quiz app screenshot and extract the primary vocabulary being shown.
    
    Extraction Targets:
    1. Main Word: The prominent word being defined or tested.
    2. Phonetics: Look for text between slashes (e.g., /.../) or near speaker icons.
    3. Translation: The Traditional Chinese (繁體中文) explanation.
    4. Example Sentences: Extract 1-2 realistic usage sentences if shown.
    
    Rules:
    - If no vocabulary is clearly found, return an empty array [].
    - Always output valid JSON using the responseSchema.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
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
