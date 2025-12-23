
export interface Memory {
  id?: string | number;
  content: string;
  category: string;
  tags: string[];
  created_ms: number; 
}

// Configuration
const DB_URL = process.env.HK_DB_URL || 'wss://some-network.ru/ws';
const DB_USER = process.env.HK_DB_USER || 'admin';
const DB_PASS = process.env.HK_DB_PASS || 'qehjdfh746@yrh1';
const PARTITION = 'hk47';

// --- Logging System ---
type LogCallback = (message: string, type: 'info' | 'error' | 'success') => void;
const listeners: LogCallback[] = [];

export const subscribeToMemoryLogs = (callback: LogCallback) => {
  listeners.push(callback);
  return () => {
    const index = listeners.indexOf(callback);
    if (index > -1) listeners.splice(index, 1);
  };
};

const emitLog = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
  listeners.forEach(cb => cb(message, type));
  if (type === 'error') console.error(`[MemoryDB] ${message}`);
  else console.log(`[MemoryDB] ${message}`);
};

class MemoryDBClient {
  private ws: WebSocket | null = null;
  private queue: Array<() => Promise<any>> = [];
  private isProcessing = false;
  private isAuthenticated = false;
  
  // Handlers for the current active request
  private pendingResolver: ((val: any) => void) | null = null;
  private pendingRejecter: ((reason: any) => void) | null = null;

  constructor() {}

  async connect(): Promise<void> {
    emitLog("Try connect to Memory Core...", 'info');
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isAuthenticated) {
      return;
    }

    // Force clean state if retrying
    if (this.ws) {
        try { this.ws.close(); } catch(e) {}
        this.ws = null;
    }
    this.isAuthenticated = false;

    emitLog("Initiating subspace uplink to Memory Core...", 'info');

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(DB_URL);
      } catch (e: any) {
        const err = `Secure Protocol Error: ${e.message}`;
        emitLog(err, 'error');
        return reject(e);
      }

      this.ws.onopen = () => {
        emitLog("Uplink established. Transmitting auth codes...", 'info');
        // Protocol Step 2: Send Auth
        this.sendRaw({
            type: 'auth',
            login: DB_USER,
            password: DB_PASS
        });
      };

      this.ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            
            // Auth Handshake
            if (msg.type === 'auth_ok') {
                this.isAuthenticated = true;
                emitLog("Memory Core access: GRANTED.", 'success');
                resolve();
                return;
            }
            if (msg.type === 'error' && !this.isAuthenticated) {
                emitLog(`Auth Failure: ${msg.message}`, 'error');
                reject(new Error(`HK-DB Auth Failure: ${msg.message}`));
                return;
            }

            // Operation Responses
            if (this.pendingResolver) {
                if (msg.type === 'error') {
                     emitLog(`Operation Error: ${msg.message}`, 'error');
                     if (this.pendingRejecter) this.pendingRejecter(new Error(msg.message));
                } else {
                     this.pendingResolver(msg);
                }
                // Cleanup
                this.pendingResolver = null;
                this.pendingRejecter = null;
            }
        } catch (e) {
            console.error("HK-DB Parse Error", e);
        }
      };

      this.ws.onerror = (e) => {
        console.error("HK-DB Socket Error", e);
        emitLog("Memory Core socket malfunction.", 'error');
        if (!this.isAuthenticated) {
            reject(new Error("WebSocket Connection Failed"));
        } else if (this.pendingRejecter) {
            this.pendingRejecter(new Error("WebSocket Connection Error during request"));
            this.pendingResolver = null;
            this.pendingRejecter = null;
        }
      };

      this.ws.onclose = () => {
        if (this.isAuthenticated) {
            emitLog("Memory Core uplink terminated.", 'info');
        }
        
        if (!this.isAuthenticated) {
            reject(new Error("HK-DB Connection Closed before Auth"));
        }

        this.isAuthenticated = false;
        
        if (this.pendingRejecter) {
            this.pendingRejecter(new Error("HK-DB Connection Closed"));
            this.pendingResolver = null;
            this.pendingRejecter = null;
        }
      };
    });
  }

  private sendRaw(data: any) {
     // if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(data));
      //}
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
      return new Promise((resolve, reject) => {
          this.queue.push(async () => {
              try {
                  await this.connect();
                  const result = await operation();
                  resolve(result);
              } catch (e) {
                  reject(e);
              }
          });
          this.processQueue();
      });
  }

  private async processQueue() {
      if (this.isProcessing) return;
      this.isProcessing = true;

      while (this.queue.length > 0) {
          const task = this.queue.shift();
          if (task) await task();
      }

      this.isProcessing = false;
  }

  // --- Public Operations ---

  public async insert(content: string, category: string, tags: string[]): Promise<string> {
      emitLog(`Archiving to sector [${category}]: "${content.substring(0, 20)}..."`, 'info');
      return this.enqueue(async () => {
          return new Promise((resolve, reject) => {
              this.pendingResolver = (msg: any) => {
                  if (msg.type === 'inserted') {
                      emitLog(`Archive confirmed. ID: ${msg.id}`, 'success');
                      resolve(msg.id);
                  }
                  else reject(new Error('Unexpected response: ' + msg.type));
              };
              this.pendingRejecter = reject;

              this.sendRaw({
                  type: 'insert',
                  partition: PARTITION,
                  data: content,
                  tags: tags,
                  categories: [category]
              });
          });
      });
  }

  public async fetchAll(): Promise<Memory[]> {
      emitLog("Initiating full memory dump...", 'info');
      return this.enqueue(async () => {
          return new Promise((resolve, reject) => {
              this.pendingResolver = (msg: any) => {
                  if (msg.type === 'search_results') {
                      const memories = this.mapItemsToMemory(msg.items);
                      emitLog(`Memory dump complete. ${memories.length} records found.`, 'success');
                      resolve(memories);
                  } else {
                      reject(new Error('Unexpected response: ' + msg.type));
                  }
              };
              this.pendingRejecter = reject;

              this.sendRaw({
                  type: 'search',
                  partition: PARTITION,
                  tags: [],
                  categories: []
              });
          });
      });
  }
  
  private mapItemsToMemory(items: any[]): Memory[] {
      if (!Array.isArray(items)) return [];
      return items.map(item => ({
          id: item.id,
          content: item.data,
          category: item.categories?.[0] || 'Unknown',
          tags: item.tags || [],
          created_ms: item.created_ms || Date.now()
      }));
  }
}

export const db = new MemoryDBClient();

// --- Exported Helper Functions ---

export const saveMemory = async (content: string, category: string, tags: string[]): Promise<string> => {
  try {
      return await db.insert(content, category, tags);
  } catch (error: any) {
      emitLog(`Write Protocol Failed: ${error.message}`, 'error');
      return "offline-id-" + Date.now();
  }
};

export const getAllMemories = async (): Promise<Memory[]> => {
  try {
      return await db.fetchAll();
  } catch (error: any) {
      emitLog(`Read Protocol Failed: ${error.message}`, 'error');
      return [];
  }
};

export const searchMemories = async (query: string, searchTags: string[] = []): Promise<Memory[]> => {
  try {
      if (query || searchTags.length > 0) {
          emitLog(`Searching archives: "${query}" ${searchTags.length ? `[${searchTags.join(',')}]` : ''}`, 'info');
      }
      
      const allMemories = await db.fetchAll();
      
      const q = query.toLowerCase().trim();
      const sTags = searchTags.map(t => t.toLowerCase());

      if (!q && sTags.length === 0) return [];

      const results = allMemories.filter(m => {
        const inContent = q && m.content.toLowerCase().includes(q);
        const inCategory = q && m.category.toLowerCase().includes(q);
        const inTags = q && m.tags.some(t => t.toLowerCase().includes(q));
        const tagMatch = sTags.some(st => m.tags.some(mt => mt.toLowerCase().includes(st)));
        return inContent || inCategory || inTags || tagMatch;
      });

      results.sort((a, b) => b.created_ms - a.created_ms);
      
      if (results.length > 0) {
          emitLog(`Search complete. ${results.length} relevant records identified.`, 'success');
      } else {
          emitLog("Search complete. No relevant records found.", 'info');
      }
      
      return results.slice(0, 5);
  } catch (error: any) {
      emitLog(`Search Protocol Failed: ${error.message}`, 'error');
      return [];
  }
};

export const formatMemoriesForPrompt = (memories: Memory[]): string => {
  if (!memories || memories.length === 0) return "No data available in archives.";
  return memories.map(m => 
    `[ARCHIVE:${m.id} | ${m.category}] ${m.content}`
  ).join('\n');
};
        