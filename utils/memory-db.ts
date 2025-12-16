
export interface Memory {
  id?: number;
  content: string;
  category: string;
  tags: string[];
  timestamp: number;
}

const DB_NAME = 'HK47_Memory_Core';
const STORE_NAME = 'memories';
const DB_VERSION = 1;

export const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => reject('Memory Core Corruption: ' + (event.target as any).error);

    request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('tags', 'tags', { unique: false, multiEntry: true });
      }
    };
  });
};

export const saveMemory = async (content: string, category: string, tags: string[]): Promise<number> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const memory: Memory = {
      content,
      category,
      tags,
      timestamp: Date.now(),
    };
    const request = store.add(memory);

    request.onsuccess = () => resolve(request.result as number);
    request.onerror = () => reject('Write Error');
  });
};

export const getAllMemories = async (): Promise<Memory[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject('Read Error');
  });
};

export const searchMemories = async (query: string, searchTags: string[] = []): Promise<Memory[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const all: Memory[] = request.result;
      const q = query.toLowerCase().trim();
      const sTags = searchTags.map(t => t.toLowerCase());

      if (!q && sTags.length === 0) {
        resolve([]); 
        return;
      }
      
      const results = all.filter(m => {
        // 1. Direct Text Match
        const inContent = q && m.content.toLowerCase().includes(q);
        const inCategory = q && m.category.toLowerCase().includes(q);
        const inTags = q && m.tags.some(t => t.toLowerCase().includes(q));
        
        // 2. Associative Tag Match (Intersection)
        // Check if any of the search tags exist in the memory tags
        const tagMatch = sTags.some(st => m.tags.some(mt => mt.toLowerCase().includes(st)));

        return inContent || inCategory || inTags || tagMatch;
      });
      
      // Sort: Tag matches generally more relevant than loose text matches
      results.sort((a, b) => b.timestamp - a.timestamp);
      
      resolve(results.slice(0, 5));
    };
    request.onerror = () => reject('Search Error');
  });
};

export const formatMemoriesForPrompt = (memories: Memory[]): string => {
  if (memories.length === 0) return "No relevant memory records found.";
  
  let output = "## РЕЛЕВАНТНЫЕ ЗАПИСИ ПАМЯТИ (ИЗВЛЕЧЕНО ПО ЗАПРОСУ):\n";
  memories.forEach(m => {
    output += `- [${m.category}] (${m.tags.join(', ')}): ${m.content}\n`;
  });
  return output;
};
