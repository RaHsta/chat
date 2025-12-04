import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage } from '@google/genai';
import { createBlob, decode, decodeAudioData } from '../utils/audioUtils';

export interface UseLiveGeminiReturn {
  connect: () => Promise<void>;
  disconnect: () => void;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  analyserNode: AnalyserNode | null;
  inputAnalyserNode: AnalyserNode | null;
}

export const useLiveGemini = (): UseLiveGeminiReturn => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const [inputAnalyserNode, setInputAnalyserNode] = useState<AnalyserNode | null>(null);

  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const sessionRef = useRef<any>(null);
  const currentStreamRef = useRef<MediaStream | null>(null);

  const disconnect = useCallback(async () => {
    if (sessionRef.current) {
       try {
         await sessionRef.current.close();
       } catch (e) {
         console.warn("Error closing session", e);
       }
       sessionRef.current = null;
    }
    sessionPromiseRef.current = null;

    sourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch (e) {}
    });
    sourcesRef.current.clear();

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
    }
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
    }
    
    if (currentStreamRef.current) {
      currentStreamRef.current.getTracks().forEach(track => track.stop());
      currentStreamRef.current = null;
    }
    
    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
      try {
        await inputAudioContextRef.current.close();
      } catch (e) { console.error("Error closing input context", e); }
    }
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
      try {
        await outputAudioContextRef.current.close();
      } catch (e) { console.error("Error closing output context", e); }
    }

    inputAudioContextRef.current = null;
    outputAudioContextRef.current = null;
    processorRef.current = null;
    inputSourceRef.current = null;
    outputNodeRef.current = null;
    analyserRef.current = null;
    inputAnalyserRef.current = null;
    nextStartTimeRef.current = 0;

    setAnalyserNode(null);
    setInputAnalyserNode(null);
    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  const connect = useCallback(async () => {
    if (isConnected || isConnecting) return;

    try {
      setIsConnecting(true);
      setError(null);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      
      const inputCtx = new AudioContextClass({ sampleRate: 16000 });
      const outputCtx = new AudioContextClass({ sampleRate: 24000 });

      if (inputCtx.state === 'suspended') {
        await inputCtx.resume();
      }
      if (outputCtx.state === 'suspended') {
        await outputCtx.resume();
      }
      
      inputAudioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;

      const analyser = outputCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      analyserRef.current = analyser;
      setAnalyserNode(analyser);

      const outputGain = outputCtx.createGain();
      outputNodeRef.current = outputGain;
      outputGain.connect(analyser);
      analyser.connect(outputCtx.destination);

      const inputAnalyser = inputCtx.createAnalyser();
      inputAnalyser.fftSize = 512;
      inputAnalyser.smoothingTimeConstant = 0.5;
      inputAnalyserRef.current = inputAnalyser;
      setInputAnalyserNode(inputAnalyser);

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } 
      });
      currentStreamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: ['AUDIO'], // Use string 'AUDIO' to be safe
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          // Use explicit Content object format for systemInstruction to avoid validation errors
          systemInstruction: { 
            parts: [{ 
              text: 'You are a helpful, witty, and friendly AI assistant. Keep your responses concise and engaging.' 
            }] 
          },
        },
        callbacks: {
          onopen: () => {
            console.log('Gemini Live Session Opened');
            setIsConnected(true);
            setIsConnecting(false);

            if (!inputAudioContextRef.current || !stream) return;
            
            const source = inputAudioContextRef.current.createMediaStreamSource(stream);
            inputSourceRef.current = source;
            source.connect(inputAnalyser);

            const processor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              try {
                const pcmBlob = createBlob(inputData);
                if (sessionPromiseRef.current) {
                  sessionPromiseRef.current.then((session) => {
                    try {
                      session.sendRealtimeInput({ media: pcmBlob });
                    } catch (err) {
                      console.debug("Error sending input", err);
                    }
                  }).catch(err => {
                    // Prevent unhandled rejection in audio loop
                    console.debug("Session not ready", err);
                  });
                }
              } catch (e) {
                console.error("Audio processing error", e);
              }
            };

            source.connect(processor);
            
            const muteGain = inputAudioContextRef.current.createGain();
            muteGain.gain.value = 0;
            processor.connect(muteGain);
            muteGain.connect(inputAudioContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const outputCtx = outputAudioContextRef.current;
            const outputNode = outputNodeRef.current;
            
            if (!outputCtx || !outputNode) return;

            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
               nextStartTimeRef.current = Math.max(
                 nextStartTimeRef.current,
                 outputCtx.currentTime
               );

               try {
                 const audioBuffer = await decodeAudioData(
                   decode(base64Audio),
                   outputCtx,
                   24000,
                   1
                 );

                 const source = outputCtx.createBufferSource();
                 source.buffer = audioBuffer;
                 source.connect(outputNode);
                 
                 source.onended = () => {
                   sourcesRef.current.delete(source);
                 };

                 source.start(nextStartTimeRef.current);
                 nextStartTimeRef.current += audioBuffer.duration;
                 sourcesRef.current.add(source);
               } catch (e) {
                 console.error("Error decoding audio", e);
               }
            }

            if (message.serverContent?.interrupted) {
              console.log("Model interrupted");
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onclose: () => {
            console.log('Gemini Live Session Closed');
            disconnect();
          },
          onerror: (err) => {
            console.error('Gemini Live Session Error', err);
            setError("Connection error. Please try again.");
            disconnect();
          }
        }
      });

      sessionPromiseRef.current = sessionPromise;
      
      sessionPromise.then(sess => {
          sessionRef.current = sess;
      }).catch(err => {
          console.error("Connection failed", err);
          setError(err.message || "Failed to establish connection");
          disconnect();
      });

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to connect");
      setIsConnecting(false);
      disconnect();
    }
  }, [isConnected, isConnecting, disconnect]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    connect,
    disconnect,
    isConnected,
    isConnecting,
    error,
    analyserNode,
    inputAnalyserNode
  };
};