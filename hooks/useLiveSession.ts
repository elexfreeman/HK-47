
import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { ConnectionState, LogEntry } from '../types';
import { decodeBase64, pcmToAudioBuffer, float32ToPcmBlob, downsampleBuffer } from '../utils/audio-utils';
import { HK47_SYSTEM_INSTRUCTION, getRandomThinkingPrompt } from './instructions';
import { saveMemory, formatMemoriesForPrompt, searchMemories, getAllMemories, subscribeToMemoryLogs } from '../utils/memory-db';
import { contextManager } from '../utils/context-manager';

// --- ОПРЕДЕЛЕНИЕ ИНСТРУМЕНТОВ (TOOLS) ---
// Эти определения сообщают модели, какие функции она может вызывать.

// Инструмент для сохранения информации в долгосрочную память
const memoryToolDeclaration: FunctionDeclaration = {
  name: 'commitToMemoryCore',
  description: 'Saves a fact, rule, or piece of knowledge to long-term storage.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      content: { type: Type.STRING, description: 'The fact or information to be saved.' },
      category: { type: Type.STRING, description: 'The category of the memory.' },
      tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Keywords.' },
    },
    required: ['content', 'category'],
  },
};

// Инструмент для поиска информации в памяти
const retrievalToolDeclaration: FunctionDeclaration = {
  name: 'retrieveFromMemoryCore',
  description: 'Searches long-term memory for specific information.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: 'The search query.' },
    },
    required: ['query'],
  },
};

export const useLiveSession = () => {
  // --- СОСТОЯНИЕ (STATE) ---
  const [status, setStatus] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [volume, setVolume] = useState<number>(0);
  const [currentEmotion, setCurrentEmotion] = useState<string>('neutral');
  const [isRecording, setIsRecording] = useState<boolean>(false);
  
  // --- ССЫЛКИ (REFS) ДЛЯ АУДИО ---
  const inputContextRef = useRef<AudioContext | null>(null);  // Контекст для микрофона
  const outputContextRef = useRef<AudioContext | null>(null); // Контекст для воспроизведения
  
  // Эффекты (цепочка обработки голоса робота)
  const effectInputRef = useRef<AudioNode | null>(null);
  
  // Ссылки на потоки и процессоры
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  // Очередь воспроизведения (для бесшовного звука)
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // --- ФЛАГИ ЛОГИКИ ---
  const isAnalyzingRef = useRef<boolean>(false); // Идет ли сейчас анализ контекста
  const isRecordingRef = useRef<boolean>(false); // Активен ли режим записи данных
  
  // Буферы для накопления текста (транскрипции)
  const inputTranscriptRef = useRef<string>('');  // То, что говорит юзер
  const outputTranscriptRef = useRef<string>(''); // То, что говорит модель

  // Ссылка на активную сессию Gemini
  const sessionPromiseRef = useRef<Promise<any> | null>(null);

  // --- ЛОГИРОВАНИЕ ---
  const addLog = useCallback((message: string, type: 'info' | 'error' | 'success' = 'info', sender: 'HK-47' | 'MEATBAG' = 'HK-47') => {
    setLogs(prev => [...prev.slice(-49), {
      timestamp: new Date().toLocaleTimeString(),
      sender,
      message,
      type
    }]);
  }, []);

  // Подписка на логи из модуля базы данных (Memory DB)
  useEffect(() => {
    const unsubscribe = subscribeToMemoryLogs((message, type) => {
       addLog(`[MEMORY CORE] ${message}`, type, 'HK-47');
    });
    return unsubscribe;
  }, [addLog]);

  // --- ВОСПРОИЗВЕДЕНИЕ АУДИО (PLAYBACK) ---
  const playAudioChunk = useCallback((base64Data: string) => {
      if (!outputContextRef.current) return;
      const ctx = outputContextRef.current;
      
      try {
          // 1. Декодируем Base64 в байты, затем в AudioBuffer
          const rawBytes = decodeBase64(base64Data);
          const audioBuffer = pcmToAudioBuffer(rawBytes, ctx, 24000); 
          
          // 2. Вычисляем время начала (чтобы чанки шли друг за другом без пауз)
          // Math.max гарантирует, что мы не пытаемся воспроизвести в прошлом
          nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
          
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          
          // 3. Подключаем к цепочке эффектов (голос робота) или напрямую к выходу
          if (effectInputRef.current) {
               source.connect(effectInputRef.current);
          } else {
               source.connect(ctx.destination);
          }
          
          // 4. Очистка ресурсов после окончания проигрывания
          source.onended = () => {
            audioSourcesRef.current.delete(source);
          };
          source.start(nextStartTimeRef.current);
          audioSourcesRef.current.add(source);

          // 5. Сдвигаем курсор времени вперед на длительность текущего чанка
          nextStartTimeRef.current += audioBuffer.duration;
      } catch (e) {
          console.error("Audio playback error", e);
      }
  }, []);

  // --- ОТКЛЮЧЕНИЕ (DISCONNECT) ---
  const disconnect = useCallback(() => {
    // Останавливаем процессор обработки микрофона
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    // Отключаем источник микрофона
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    // Останавливаем треки медиа-стрима (выключаем лампочку микрофона)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    // Закрываем аудиоконтексты
    if (inputContextRef.current) {
      inputContextRef.current.close();
      inputContextRef.current = null;
    }
    if (outputContextRef.current) {
      outputContextRef.current.close();
      outputContextRef.current = null;
    }
    effectInputRef.current = null;

    // Останавливаем все играющие звуки
    audioSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    audioSourcesRef.current.clear();
    
    // Сбрасываем ссылки и состояния
    sessionPromiseRef.current = null;
    isAnalyzingRef.current = false;
    isRecordingRef.current = false;
    setIsRecording(false);
    
    setStatus(ConnectionState.DISCONNECTED);
    setVolume(0);
    setCurrentEmotion('neutral');
    addLog("Connection terminated.", 'info');
  }, [addLog]);

  // --- ОБРАБОТКА КОНТЕКСТА (CONTEXT MANAGER) ---
  const processContext = useCallback((userText: string) => {
      addLog(userText, 'info', 'MEATBAG');
      isAnalyzingRef.current = true;
      
      // 1. Заполняем тишину: Прерываем возможные галлюцинации модели фразой "Думаю..."
      const thinkingPrompt = getRandomThinkingPrompt();
      sessionPromiseRef.current?.then(session => {
          session.sendRealtimeInput({ text: thinkingPrompt });
      });

      // 2. Запускаем ContextManager для анализа интента (SAVE/RETRIEVE/NONE)
      contextManager.processUserContext(userText).then(({ injection, log }) => {
          if (log) addLog(log, 'info', 'HK-47');
          
          let finalPrompt = "";
          if (injection) {
              addLog("CONTEXT UPDATE INJECTED", 'success', 'HK-47');
              // Внедряем результаты памяти в контекст модели
              finalPrompt = `${injection}\n\n[SYSTEM: Context applied. Now answer the user's question: "${userText}"]`;
          } else {
              // Если памяти нет, просто форсируем ответ на вопрос
              finalPrompt = `[SYSTEM: Scan complete. No archival data found. Answer the user's question naturally: "${userText}"]`;
          }
          
          // Отправляем финальную промпт-инструкцию модели
          sessionPromiseRef.current?.then(session => {
              session.sendRealtimeInput({ text: finalPrompt });
          });
          isAnalyzingRef.current = false;
      });
  }, [addLog]);

  // --- ПОДКЛЮЧЕНИЕ (CONNECT) ---
  const connect = useCallback(async () => {
    if (!process.env.API_KEY) {
      addLog("API Key missing.", 'error');
      return;
    }

    try {
      setStatus(ConnectionState.CONNECTING);
      addLog("Initializing audio protocols...", 'info');

      // 1. Инициализация AudioContext API
      inputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const outCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      outputContextRef.current = outCtx;

      // 2. Создание цепочки эффектов для голоса робота (DSP Chain)
      const inputGain = outCtx.createGain();
      const compressor = outCtx.createDynamicsCompressor(); // Компрессия для плотности
      
      const dryGain = outCtx.createGain();
      dryGain.gain.value = 0.7; // Чистый сигнал
      
      const delayNode = outCtx.createDelay();
      delayNode.delayTime.value = 0.012; // Короткая задержка для "металлического" оттенка
      
      const feedbackGain = outCtx.createGain();
      feedbackGain.gain.value = 0.75; 
      
      const wetGain = outCtx.createGain();
      wetGain.gain.value = 0.5; // Обработанный сигнал

      const highPass = outCtx.createBiquadFilter(); // Обрезка низких частот
      highPass.type = 'highpass';
      highPass.frequency.value = 150;

      // Соединение узлов: Input -> Filter -> Split(Dry + DelayChain) -> Compressor -> Out
      inputGain.connect(highPass);
      highPass.connect(dryGain);
      dryGain.connect(compressor);
      highPass.connect(delayNode);
      delayNode.connect(feedbackGain);
      feedbackGain.connect(delayNode); 
      delayNode.connect(wetGain);
      wetGain.connect(compressor);
      compressor.connect(outCtx.destination);
      effectInputRef.current = inputGain;
      // -------------------------------

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      addLog("Contacting HK-47 core...", 'info');
      
      // 3. Установка WebSocket соединения с Gemini
      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO], // Мы хотим получать аудио
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } // Голос Charon (глубокий)
          },
          systemInstruction: HK47_SYSTEM_INSTRUCTION, // Системный промпт
          tools: [{ functionDeclarations: [memoryToolDeclaration, retrievalToolDeclaration] }], // Инструменты
          inputAudioTranscription: {}, // Включить транскрипцию ввода (для команд)
          outputAudioTranscription: {}, // Включить транскрипцию вывода (для эмоций)
        },
        callbacks: {
          // --- СОЕДИНЕНИЕ ОТКРЫТО ---
          onopen: async () => {
            setStatus(ConnectionState.CONNECTED);
            addLog("Connection established. Assassination protocols active.", 'success');     

            try {
              // 4. Захват микрофона
              streamRef.current = await navigator.mediaDevices.getUserMedia({ 
                audio: { echoCancellation: true, noiseSuppression: true } 
              });
              
              if (!inputContextRef.current) return;

              const source = inputContextRef.current.createMediaStreamSource(streamRef.current);
              sourceRef.current = source;
              
              // 5. Настройка ScriptProcessor для обработки аудио "на лету"
              const processor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
              processorRef.current = processor;

              processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                
                // Вычисляем громкость для визуализации
                let sum = 0;
                for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
                setVolume(Math.sqrt(sum / inputData.length));

                // Ресемплинг в 16000Hz (требование Gemini)
                const currentRate = inputContextRef.current?.sampleRate || 16000;
                let dataToSend = inputData;
                
                if (currentRate !== 16000) {
                    dataToSend = downsampleBuffer(inputData, currentRate, 16000);
                }

                const pcmBlob = float32ToPcmBlob(dataToSend, 16000);
                
                // Отправка аудио-чанка на сервер
                if (sessionPromiseRef.current) {
                  sessionPromiseRef.current.then(session => {
                     session.sendRealtimeInput({ media: pcmBlob });
                  }).catch(err => {
                    console.error("Session send error", err);
                  });
                }
              };

              source.connect(processor);
              processor.connect(inputContextRef.current.destination);
              
              // 6. Отправка "тишины" для пробуждения модели (hack)
              if (sessionPromiseRef.current) {
                 setTimeout(() => {
                    sessionPromiseRef.current?.then(session => {
                        const silentData = new Float32Array(8000).fill(0);
                        const silentBlob = float32ToPcmBlob(silentData, 16000);
                        session.sendRealtimeInput({ media: silentBlob });
                    }).catch(console.error);
                 }, 500);
              }

            } catch (err) {
              addLog(`Microphone access denied: ${err}`, 'error');
              disconnect();
            }
          },
          // --- ПОЛУЧЕНИЕ СООБЩЕНИЯ ОТ GEMINI ---
          onmessage: async (message: LiveServerMessage) => {
            const serverContent = message.serverContent;

            // 7. Обработка вызова инструментов (Tool Calls)
            // ВАЖНО: Запрещаем выполнение инструментов, если идет запись (isRecordingRef)
            if (message.toolCall && !isRecordingRef.current) {
                for (const fc of message.toolCall.functionCalls) {
                    if (fc.name === 'commitToMemoryCore') {
                         // Модель хочет что-то запомнить
                         const { content, category, tags } = fc.args as any;
                         addLog(`MANUAL ARCHIVE [${category}]: ${content.substring(0, 30)}...`, 'success', 'HK-47');
                         await saveMemory(content, category, tags || []);
                         // Отправляем результат обратно модели
                         sessionPromiseRef.current?.then(s => s.sendToolResponse({
                             functionResponses: { id: fc.id, name: fc.name, response: { result: "Confirmed." } }
                         }));
                    } else if (fc.name === 'retrieveFromMemoryCore') {
                        // Модель хочет что-то найти
                        const { query } = fc.args as any;
                        const memories = await searchMemories(query);
                        const result = formatMemoriesForPrompt(memories);
                        sessionPromiseRef.current?.then(s => s.sendToolResponse({
                            functionResponses: { id: fc.id, name: fc.name, response: { result } }
                        }));
                    }
                }
            }

            if (!serverContent) return;

            // 8. Обработка прерывания (Interruption)
            // Если пользователь начал говорить, модель присылает interrupted=true
            if (serverContent.interrupted) {
                audioSourcesRef.current.forEach(source => source.stop()); // Остановить звук
                audioSourcesRef.current.clear();
                nextStartTimeRef.current = 0; // Сбросить курсор времени
                if (outputTranscriptRef.current) outputTranscriptRef.current = '';
            }

            // 9. Обработка транскрипции ВВОДА (то, что сказал пользователь)
            if (serverContent.inputTranscription) {
                inputTranscriptRef.current += serverContent.inputTranscription.text;

                const textLower = inputTranscriptRef.current.toLowerCase();
                
                // --- ЛОГИКА ПРОТОКОЛА ЗАПИСИ (RECORDING PROTOCOL) ---
                
                // А) Включение записи
                if (!isRecordingRef.current) {
                    const startTrigger = textLower.match(/(начать запись данных|start recording|включи запись|начать запись)/i);
                    if (startTrigger) {
                        isRecordingRef.current = true;
                        setIsRecording(true);
                        addLog("RECORDING PROTOCOL: INITIALIZED", 'success', 'HK-47');
                        
                        // Обрезаем триггер-фразу, оставляем только полезный текст после неё
                        const triggerIndex = textLower.indexOf(startTrigger[0]);
                        const postTriggerText = inputTranscriptRef.current.substring(triggerIndex + startTrigger[0].length).trim();
                        inputTranscriptRef.current = postTriggerText;
                    }
                }

                // Б) Выключение записи
                if (isRecordingRef.current && (textLower.includes('конец записи') || textLower.includes('end recording') || textLower.includes('stop recording'))) {
                    isRecordingRef.current = false;
                    setIsRecording(false);
                    addLog("RECORDING PROTOCOL: TERMINATED. PROCESSING...", 'info', 'HK-47');
                    
                    // Извлекаем контент ДО стоп-фразы
                    const cleanText = inputTranscriptRef.current
                        .replace(/(конец записи|end recording|stop recording).*/i, "")
                        .trim();
                    
                    // Форсируем анализ контекста (ContextManager), чтобы сохранить данные
                    processContext(cleanText);
                    inputTranscriptRef.current = "";
                    return; // Прерываем дальнейшую обработку этого чанка
                }
            }

            // 10. Обработка транскрипции ВЫВОДА (то, что говорит робот)
            if (serverContent.outputTranscription) {
                const text = serverContent.outputTranscription.text;
                outputTranscriptRef.current += text;
                
                // Парсинг эмоций из текста (формат "Эмоция: текст")
                const emotionMatch = outputTranscriptRef.current.trim().match(/^[\*\[]*([А-Яа-яЁё]+)[\*\]]*:/);
                if (emotionMatch && emotionMatch[1]) {
                    const em = emotionMatch[1].toLowerCase();
                    if (em.includes('угроза')) setCurrentEmotion('threat');
                    else if (em.includes('радость')) setCurrentEmotion('happy');
                    else if (em.includes('сарказм')) setCurrentEmotion('suspicious');
                    else setCurrentEmotion('neutral');
                }
            }

            const audioData = serverContent.modelTurn?.parts?.[0]?.inlineData?.data;
            
            // 11. ЛОГИКА ТРИГГЕРА КОНТЕКСТА (CONTEXT TRIGGER)
            // Работает только если НЕ идет запись
            if (!isRecordingRef.current) {
                // Если пришел аудио-ответ модели И есть накопленный текст ввода И анализ еще не идет
                // Это значит, что Gemini начал отвечать, считая фразу пользователя завершенной.
                if (audioData && inputTranscriptRef.current.trim() && !isAnalyzingRef.current) {
                   const userText = inputTranscriptRef.current;
                   inputTranscriptRef.current = ''; 
                   processContext(userText); // Запускаем RAG/Память
                }

                // Если сервер явно сказал "turnComplete" (ход завершен)
                if (serverContent.turnComplete) {
                    if (inputTranscriptRef.current.trim()) {
                         const userText = inputTranscriptRef.current;
                         inputTranscriptRef.current = '';
                         processContext(userText);
                    }
                    
                    // Логируем ответ робота
                    if (outputTranscriptRef.current.trim()) {
                        addLog(outputTranscriptRef.current, 'info', 'HK-47');
                        outputTranscriptRef.current = '';
                    }
                }
            }

            // 12. Воспроизведение аудио
            if (audioData) {
               playAudioChunk(audioData);
            }
          },
          onclose: () => {
            addLog("Session closed remotely.", 'error');
            disconnect();
          },
          onerror: (err) => {
            addLog(`Protocol Error: ${err}`, 'error');
          }
        }
      });

    } catch (e: any) {
      addLog(`Initialization Failure: ${e.message}`, 'error');
      setStatus(ConnectionState.ERROR);
    }
  }, [disconnect, playAudioChunk, addLog, processContext]);

  return { status, connect, disconnect, logs, volume, currentEmotion, isRecording };
};
