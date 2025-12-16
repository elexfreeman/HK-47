
import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { ConnectionState, LogEntry } from '../types';
import { decodeBase64, pcmToAudioBuffer, float32ToPcmBlob, downsampleBuffer } from '../utils/audio-utils';
import { HK47_SYSTEM_INSTRUCTION } from './instructions';
import { saveMemory, formatMemoriesForPrompt, searchMemories } from '../utils/memory-db';

const memoryToolDeclaration: FunctionDeclaration = {
  name: 'commitToMemoryCore',
  description: 'Saves a fact, rule, or piece of knowledge to long-term storage.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      content: {
        type: Type.STRING,
        description: 'The fact or information to be saved.',
      },
      category: {
        type: Type.STRING,
        description: 'The category of the memory (e.g., PROTOCOL, MEATBAG_INFO, TARGET_DATA, PHILOSOPHY).',
      },
      tags: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Keywords associated with this memory for associative retrieval.',
      },
    },
    required: ['content', 'category'],
  },
};

const retrievalToolDeclaration: FunctionDeclaration = {
  name: 'retrieveFromMemoryCore',
  description: 'Searches long-term memory for specific information based on keywords or context.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'The search query or keyword to find in memory.',
      },
    },
    required: ['query'],
  },
};

export const useLiveSession = () => {
  const [status, setStatus] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [volume, setVolume] = useState<number>(0); // 0 to 1 for visualizer
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

    // Stop all playing audio
    audioSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    audioSourcesRef.current.clear();
    
    sessionPromiseRef.current = null;
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
      // Creates a metallic comb filter effect
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

      // 2. Setup Google GenAI Client
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // 3. Connect to Live API
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

            // Start Microphone Stream
            try {
              streamRef.current = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                  echoCancellation: true,
                  noiseSuppression: true,
                } 
              });
              
              if (!inputContextRef.current) return;

              const source = inputContextRef.current.createMediaStreamSource(streamRef.current);
              sourceRef.current = source;
              
              const processor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
              processorRef.current = processor;

              processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                
                // Calculate volume for visualizer
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
              
              // Trigger initial greeting
              if (sessionPromiseRef.current) {
                 setTimeout(() => {
                    sessionPromiseRef.current?.then(session => {
                        const silentData = new Float32Array(8000).fill(0); // ~0.5s silence
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

            // Handle Tool Calls (Memory Saving & Retrieval)
            if (message.toolCall) {
                for (const fc of message.toolCall.functionCalls) {
                    if (fc.name === 'commitToMemoryCore') {
                        const { content, category, tags } = fc.args as any;
                        addLog(`ARCHIVING MEMORY [${category}]: ${content.substring(0, 30)}...`, 'success', 'HK-47');
                        
                        try {
                            await saveMemory(content, category, tags || []);
                            sessionPromiseRef.current?.then(session => {
                                session.sendToolResponse({
                                    functionResponses: {
                                        id: fc.id,
                                        name: fc.name,
                                        response: { result: "Memory archived successfully in Core." }
                                    }
                                });
                            });
                        } catch (e) {
                            addLog("Memory Write Failed", 'error');
                             sessionPromiseRef.current?.then(session => {
                                session.sendToolResponse({
                                    functionResponses: {
                                        id: fc.id,
                                        name: fc.name,
                                        response: { result: "Error: Memory Core write failure." }
                                    }
                                });
                            });
                        }
                    } else if (fc.name === 'retrieveFromMemoryCore') {
                        const { query } = fc.args as any;
                        addLog(`SEARCHING MEMORY: "${query}"`, 'info', 'HK-47');
                        
                        try {
                            const memories = await searchMemories(query);
                            const resultText = formatMemoriesForPrompt(memories);
                            addLog(`Found ${memories.length} records.`, 'success');
                            
                            sessionPromiseRef.current?.then(session => {
                                session.sendToolResponse({
                                    functionResponses: {
                                        id: fc.id,
                                        name: fc.name,
                                        response: { result: resultText }
                                    }
                                });
                            });
                        } catch (e) {
                             addLog("Memory Read Failed", 'error');
                             sessionPromiseRef.current?.then(session => {
                                session.sendToolResponse({
                                    functionResponses: {
                                        id: fc.id,
                                        name: fc.name,
                                        response: { result: "Error: Memory Core read failure." }
                                    }
                                });
                            });
                        }
                    }
                }
            }

            if (!serverContent) return;

            if (serverContent.interrupted) {
                audioSourcesRef.current.forEach(source => source.stop());
                audioSourcesRef.current.clear();
                nextStartTimeRef.current = 0;
                
                if (outputTranscriptRef.current) {
                    addLog(outputTranscriptRef.current + " [INTERRUPTED]", 'info', 'HK-47');
                    outputTranscriptRef.current = '';
                }
            }

            if (serverContent.inputTranscription) {
                inputTranscriptRef.current += serverContent.inputTranscription.text;
            }
            if (serverContent.outputTranscription) {
                const text = serverContent.outputTranscription.text;
                outputTranscriptRef.current += text;

                const emotionMatch = outputTranscriptRef.current.trim().match(/^[\*\[]*([А-Яа-яЁё]+)[\*\]]*:/);
                if (emotionMatch && emotionMatch[1]) {
                   const rawEmotion = emotionMatch[1].toLowerCase();
                   if (rawEmotion.includes('угроза')) setCurrentEmotion('threat');
                   else if (rawEmotion.includes('негодование')) setCurrentEmotion('angry');
                   else if (rawEmotion.includes('сарказм')) setCurrentEmotion('suspicious');
                   else if (rawEmotion.includes('радость') || rawEmotion.includes('удовлетворение')) setCurrentEmotion('happy');
                   else if (rawEmotion.includes('переспрос')) setCurrentEmotion('query');
                   else if (rawEmotion.includes('отказ')) setCurrentEmotion('refusal');
                   else if (rawEmotion.includes('приветствие')) setCurrentEmotion('happy'); 
                   else setCurrentEmotion('neutral');
                }
            }

            const audioData = serverContent.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData) {
               if (inputTranscriptRef.current.trim()) {
                   addLog(inputTranscriptRef.current, 'info', 'MEATBAG');
                   inputTranscriptRef.current = '';
               }

               if (outputContextRef.current) {
                   const ctx = outputContextRef.current;
                   const rawBytes = decodeBase64(audioData);
                   const audioBuffer = pcmToAudioBuffer(rawBytes, ctx, 24000); 

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
               }
            }

            if (serverContent.turnComplete) {
                if (inputTranscriptRef.current.trim()) {
                    addLog(inputTranscriptRef.current, 'info', 'MEATBAG');
                    inputTranscriptRef.current = '';
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
  }, [disconnect]);

  return {
    status,
    connect,
    disconnect,
    logs,
    volume,
    currentEmotion
  };
};
