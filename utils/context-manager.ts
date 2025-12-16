
import { GoogleGenAI, Type } from "@google/genai";
import { saveMemory, searchMemories, formatMemoriesForPrompt } from "./memory-db";

const CONTEXT_AGENT_PROMPT = `
Ты — аналитический модуль ядра памяти дроида. Твоя задача — классифицировать входящий запрос пользователя и структурировать данные.

1. Проанализируй входящий текст пользователя.
2. Определи ИНТЕНТ (Намерение):
   - "SAVE": Пользователь сообщает факт о себе, правило, предпочтение или информацию, которую стоит запомнить.
   - "RETRIEVE": Пользователь спрашивает о прошлом, просит что-то вспомнить или вопрос требует контекста из базы знаний.
   - "NONE": Обычный разговор, приветствие, эмоции, не требующие работы с памятью.

3. В зависимости от интента заполни JSON:

ЕСЛИ "SAVE":
- content: Суть информации для сохранения (очищенная от лишних слов).
- category: Категория выбранная по смыслу из введенного текста.
- tags: Список ключевых тегов (3-5 шт) понятия  которые встечаются в тексте.

ЕСЛИ "RETRIEVE":
- query: Поисковый запрос, оптимизированный для поиска в базе.
- tags: Теги для ассоциативного поиска.

ЕСЛИ "NONE":
- Верни intent "NONE".

Ответ ТОЛЬКО в формате JSON.
Схема:
{
  "intent": "SAVE" | "RETRIEVE" | "NONE",
  "saveData": { "content": "string", "category": "string", "tags": ["string"] } | null,
  "searchData": { "query": "string", "tags": ["string"] } | null
}
`;

interface ContextAnalysisResult {
  intent: 'SAVE' | 'RETRIEVE' | 'NONE';
  saveData?: {
    content: string;
    category: string;
    tags: string[];
  };
  searchData?: {
    query: string;
    tags: string[];
  };
}

export class ContextManager {
  private ai: GoogleGenAI;
  private model: string = 'gemini-2.5-flash';

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  }

  /**
   * Processes the user text, decides action, executes DB op, and returns a context string for HK-47.
   * Now returns an object containing the system injection string and a log string for the UI.
   */
  async processUserContext(text: string): Promise<{ injection: string | null, log: string | null }> {
    if (!text.trim()) return { injection: null, log: null };

    try {
      // 1. Analyze Intent
      const analysis = await this.analyzeText(text);
      console.log("Context Agent Decision:", analysis);

      let logString = `[ANALYSIS UNIT] Intent: ${analysis.intent}`;

      // 2. Branching Logic & Logging Construction
      if (analysis.intent === 'SAVE' && analysis.saveData) {
        logString += ` | Category: ${analysis.saveData.category} | Tags: [${analysis.saveData.tags.join(', ')}]`;
        const injection = await this.handleSave(analysis.saveData);
        return { injection, log: logString };

      } else if (analysis.intent === 'RETRIEVE' && analysis.searchData) {
        logString += ` | Query: "${analysis.searchData.query}" | Tags: [${analysis.searchData.tags.join(', ')}]`;
        const injection = await this.handleRetrieve(analysis.searchData);
        return { injection, log: logString };
      }

      return { injection: null, log: analysis.intent === 'NONE' ? null : logString };

    } catch (error) {
      console.error("Context Manager Error:", error);
      return { injection: null, log: "[ANALYSIS UNIT] Error processing context." };
    }
  }

  private async analyzeText(text: string): Promise<ContextAnalysisResult> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: `${CONTEXT_AGENT_PROMPT}\n\nВходящий запрос: "${text}"`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                intent: { type: Type.STRING, enum: ["SAVE", "RETRIEVE", "NONE"] },
                saveData: {
                    type: Type.OBJECT,
                    properties: {
                        content: { type: Type.STRING },
                        category: { type: Type.STRING },
                        tags: { type: Type.ARRAY, items: { type: Type.STRING } }
                    },
                    nullable: true
                },
                searchData: {
                    type: Type.OBJECT,
                    properties: {
                        query: { type: Type.STRING },
                        tags: { type: Type.ARRAY, items: { type: Type.STRING } }
                    },
                    nullable: true
                }
            }
        }
      }
    });

    const jsonText = response.text;
    if (!jsonText) return { intent: 'NONE' };
    return JSON.parse(jsonText) as ContextAnalysisResult;
  }

  private async handleSave(data: { content: string, category: string, tags: string[] }): Promise<string> {
    try {
      await saveMemory(data.content, data.category, data.tags);
      return `[SYSTEM ALERT: Новая запись сохранена в ядре памяти. Категория: ${data.category}. Теги: ${data.tags.join(', ')}]`;
    } catch (e) {
      return `[SYSTEM ERROR: Сбой записи памяти.]`;
    }
  }

  private async handleRetrieve(data: { query: string, tags: string[] }): Promise<string> {
    try {
      const memories = await searchMemories(data.query, data.tags);
      if (memories.length === 0) return `[SYSTEM ALERT: По запросу "${data.query}" данных в архивах не найдено.]`;
      
      const formatted = formatMemoriesForPrompt(memories);
      return `[SYSTEM DATA INJECTION: Найдены записи памяти для контекста]\n${formatted}`;
    } catch (e) {
      return `[SYSTEM ERROR: Сбой чтения памяти.]`;
    }
  }
}

export const contextManager = new ContextManager();
