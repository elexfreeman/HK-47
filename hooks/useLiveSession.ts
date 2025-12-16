
import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { ConnectionState, LogEntry } from '../types';
import { decodeBase64, pcmToAudioBuffer, float32ToPcmBlob, downsampleBuffer } from '../utils/audio-utils';
import { HK47_SYSTEM_INSTRUCTION, getRandomThinkingPrompt } from './instructions';
import { saveMemory, formatMemoriesForPrompt, searchMemories, getAllMemories } from '../utils/memory-db';
import { contextManager } from '../utils/context-manager';

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
  const [status, setStatus] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [volume, setVolume] = useState<number>(0);
  const [currentEmotion, setCurrentEmotion] = useState<string>('neutral');
  
  // Audio Contexts
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  
  // Audio Effects
  const effectInputRef = useRef<AudioNode | null>(null);
  
  // Stream references
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  // Output Queue
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Logic Flags
  const isAnalyzingRef = useRef<boolean>(false);
  
  // Transcription Accumulators
  const inputTranscriptRef = useRef<string>('');
  const outputTranscriptRef = useRef<string>('');

  // API Session
  const sessionPromiseRef = useRef<Promise<any> | null>(null);

  const addLog = (message: string, type: 'info' | 'error' | 'success' = 'info', sender: 'HK-47' | 'MEATBAG' = 'HK-47') => {
    setLogs(prev => [...prev.slice(-49), {
      timestamp: new Date().toLocaleTimeString(),
      sender,
      message,
      type
    }]);
  };

  const playAudioChunk = useCallback((base64Data: string) => {
      if (!outputContextRef.current) return;
      const ctx = outputContextRef.current;
      
      try {
          const rawBytes = decodeBase64(base64Data);
          const audioBuffer = pcmToAudioBuffer(rawBytes, ctx, 24000); 
          
          // Ensure we don't schedule in the past
          nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
          
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          
          if (effectInputRef.current) {
               source.connect(effectInputRef.current);
          } else {
               source.connect(ctx.destination);
          }
          
          source.onended = () => {
            audioSourcesRef.current.delete(source);
          };
          source.start(nextStartTimeRef.current);
          audioSourcesRef.current.add(source);

          nextStartTimeRef.current += audioBuffer.duration;
      } catch (e) {
          console.error("Audio playback error", e);
      }
  }, []);

  const disconnect = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (inputContextRef.current) {
      inputContextRef.current.close();
      inputContextRef.current = null;
    }
    if (outputContextRef.current) {
      outputContextRef.current.close();
      outputContextRef.current = null;
    }
    effectInputRef.current = null;

    audioSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    audioSourcesRef.current.clear();
    
    sessionPromiseRef.current = null;
    isAnalyzingRef.current = false;
    
    setStatus(ConnectionState.DISCONNECTED);
    setVolume(0);
    setCurrentEmotion('neutral');
    addLog("Connection terminated.", 'info');
  }, []);

  const connect = useCallback(async () => {
    if (!process.env.API_KEY) {
      addLog("API Key missing.", 'error');
      return;
    }

    try {
      setStatus(ConnectionState.CONNECTING);
      addLog("Initializing audio protocols...", 'info');

      // 1. Setup Audio Contexts
      inputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const outCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      outputContextRef.current = outCtx;

      // --- ROBOT VOICE EFFECT CHAIN ---
      const inputGain = outCtx.createGain();
      const compressor = outCtx.createDynamicsCompressor();
      
      const dryGain = outCtx.createGain();
      dryGain.gain.value = 0.7;
      
      const delayNode = outCtx.createDelay();
      delayNode.delayTime.value = 0.012; 
      
      const feedbackGain = outCtx.createGain();
      feedbackGain.gain.value = 0.75; 
      
      const wetGain = outCtx.createGain();
      wetGain.gain.value = 0.5;

      const highPass = outCtx.createBiquadFilter();
      highPass.type = 'highpass';
      highPass.frequency.value = 150;

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
      
      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } 
          },
          systemInstruction: HK47_SYSTEM_INSTRUCTION,
          tools: [{ functionDeclarations: [memoryToolDeclaration, retrievalToolDeclaration] }],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: async () => {
            setStatus(ConnectionState.CONNECTED);
            addLog("Connection established. Assassination protocols active.", 'success');
            
            // Initial Memory Dump
            try {
                const allMemories = await getAllMemories();
                if (allMemories.length > 0) {
                    addLog(`MEMORY CHECK: ${allMemories.length} RECORDS FOUND.`, 'info', 'HK-47');
                }
            } catch (err) {
                // Ignore silent fail on init
            }

            try {
              streamRef.current = await navigator.mediaDevices.getUserMedia({ 
                audio: { echoCancellation: true, noiseSuppression: true } 
              });
              
              if (!inputContextRef.current) return;

              const source = inputContextRef.current.createMediaStreamSource(streamRef.current);
              sourceRef.current = source;
              
              const processor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
              processorRef.current = processor;

              processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                
                let sum = 0;
                for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
                setVolume(Math.sqrt(sum / inputData.length));

                const currentRate = inputContextRef.current?.sampleRate || 16000;
                let dataToSend = inputData;
                
                if (currentRate !== 16000) {
                    dataToSend = downsampleBuffer(inputData, currentRate, 16000);
                }

                const pcmBlob = float32ToPcmBlob(dataToSend, 16000);
                
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
              
              // Silence to wake up
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
          onmessage: async (message: LiveServerMessage) => {
            const serverContent = message.serverContent;

            // Handle standard tool calls
            if (message.toolCall) {
                for (const fc of message.toolCall.functionCalls) {
                    if (fc.name === 'commitToMemoryCore') {
                         const { content, category, tags } = fc.args as any;
                         addLog(`MANUAL ARCHIVE [${category}]: ${content.substring(0, 30)}...`, 'success', 'HK-47');
                         await saveMemory(content, category, tags || []);
                         sessionPromiseRef.current?.then(s => s.sendToolResponse({
                             functionResponses: { id: fc.id, name: fc.name, response: { result: "Confirmed." } }
                         }));
                    } else if (fc.name === 'retrieveFromMemoryCore') {
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

            if (serverContent.interrupted) {
                audioSourcesRef.current.forEach(source => source.stop());
                audioSourcesRef.current.clear();
                nextStartTimeRef.current = 0;
                if (outputTranscriptRef.current) outputTranscriptRef.current = '';
            }

            if (serverContent.inputTranscription) {
                inputTranscriptRef.current += serverContent.inputTranscription.text;
            }
            if (serverContent.outputTranscription) {
                const text = serverContent.outputTranscription.text;
                outputTranscriptRef.current += text;
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
            
            // --- CONTEXT TRIGGER LOGIC ---
            // As soon as we have a completed user phrase (model starts responding or silence), trigger analysis.
            if (audioData && inputTranscriptRef.current.trim() && !isAnalyzingRef.current) {
               const userText = inputTranscriptRef.current;
               inputTranscriptRef.current = ''; // Clear buffer to prevent double triggers
               addLog(userText, 'info', 'MEATBAG');

               isAnalyzingRef.current = true;
               
               // 1. Fill the silence: Interrupt any partial hallucination with a "Thinking" phrase
               const thinkingPrompt = getRandomThinkingPrompt();
               sessionPromiseRef.current?.then(session => {
                   session.sendRealtimeInput({ text: thinkingPrompt });
               });

               // 2. Process Context
               contextManager.processUserContext(userText).then(({ injection, log }) => {
                   if (log) addLog(log, 'info', 'HK-47');
                   
                   let finalPrompt = "";
                   if (injection) {
                       addLog("CONTEXT UPDATE INJECTED", 'success', 'HK-47');
                       finalPrompt = `${injection}\n\n[SYSTEM: Context applied. Now answer the user's question: "${userText}"]`;
                   } else {
                       // Even if no context, we interrupted the flow, so we must force the answer now.
                       finalPrompt = `[SYSTEM: Scan complete. No archival data found. Answer the user's question naturally: "${userText}"]`;
                   }
                   
                   sessionPromiseRef.current?.then(session => {
                       session.sendRealtimeInput({ text: finalPrompt });
                   });
                   isAnalyzingRef.current = false;
               });
            }

            // --- AUDIO PLAYBACK LOGIC ---
            if (audioData) {
               playAudioChunk(audioData);
            }

            if (serverContent.turnComplete) {
                // Catch-all for end of turn if not triggered via audio stream yet
                if (inputTranscriptRef.current.trim()) {
                     const userText = inputTranscriptRef.current;
                     inputTranscriptRef.current = '';
                     addLog(userText, 'info', 'MEATBAG');
                     
                     // We still use the thinking prompt here to maintain consistency
                     isAnalyzingRef.current = true;
                     const thinkingPrompt = getRandomThinkingPrompt();
                     sessionPromiseRef.current?.then(session => {
                        session.sendRealtimeInput({ text: thinkingPrompt });
                     });

                     contextManager.processUserContext(userText).then(({ injection, log }) => {
                       if (log) addLog(log, 'info', 'HK-47');
                       
                       let finalPrompt = "";
                       if (injection) {
                           addLog("CONTEXT UPDATE INJECTED", 'success', 'HK-47');
                           finalPrompt = `${injection}\n\n[SYSTEM: Context applied. Now answer the user's question: "${userText}"]`;
                       } else {
                           finalPrompt = `[SYSTEM: Scan complete. No archival data found. Answer the user's question naturally: "${userText}"]`;
                       }

                       sessionPromiseRef.current?.then(session => {
                           session.sendRealtimeInput({ text: finalPrompt });
                       });
                       isAnalyzingRef.current = false;
                    });
                }
                
                if (outputTranscriptRef.current.trim()) {
                    addLog(outputTranscriptRef.current, 'info', 'HK-47');
                    outputTranscriptRef.current = '';
                }
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
  }, [disconnect, playAudioChunk]);

  return { status, connect, disconnect, logs, volume, currentEmotion };
};
