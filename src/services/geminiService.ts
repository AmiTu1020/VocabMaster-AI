import { GoogleGenAI, Type } from "@google/genai";

export async function extractVocabFromImage(base64Image: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const prompt = `Analyze this language learning screenshot. 
    1. Identification:
       - Look for text in "Standard Answer" (標準答案) labels.
       - Look for suggested correct phrases mentioned in pink/red correction boxes or explanations (e.g., "建議使用...").
       - Look for HIGHLIGHTED words in colorful boxes.
    2. Extraction Logic: 
       - If a highlighted word is part of a larger meaningful phrase or sentence being taught, extract the whole phrase.
       - Extract "Standard Answers" exactly as they appear (ignore generic filler words like "Any" if it makes the phrase cleaner, but keep meaningful chunks).
       - Preference: Multi-word natural expressions > individual words.
    3. Output Format: Provide JSON array with:
       - word: The clean phrase or word.
       - phonetic: The IPA symbols.
       - translation: Traditional Chinese translation.
       - examples: 1-2 realistic usage examples.
    
    Priority: Extract multiple items if there are clear distinct phrases being taught (e.g., a "Standard Answer" and a "Suggested alternative").`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { data: base64Image, mimeType: "image/png" } },
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
            },
            required: ["word", "phonetic", "translation", "examples"]
          }
        }
      }
    });

    return JSON.parse(response.text || "[]");
  } catch (error) {
    console.error("Gemini Error:", error);
    throw error;
  }
}
