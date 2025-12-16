
import { GoogleGenAI, Type } from "@google/genai";

const TAGGING_PROMPT = 'Разбери по смыслу текст и выдели основные темы введенного текста в виде тегов ответ в виде JSON списка тегов через запятую. Формат JSON: ["tag","tag"...]';

export async function extractTags(text: string): Promise<string[]> {
  if (!process.env.API_KEY || !text.trim()) return [];

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Using flash model for low latency tagging
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `${TAGGING_PROMPT}\n\nТекст для анализа: "${text}"`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
            }
        }
    });

    const jsonText = response.text;
    if (!jsonText) return [];
    
    const tags = JSON.parse(jsonText);
    return Array.isArray(tags) ? tags : [];
  } catch (error) {
    console.error("Associative Agent Error:", error);
    return [];
  }
}
