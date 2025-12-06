
import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { createBlob, decode, decodeAudioData } from '../utils/audioUtils';

export interface ConversationTurn {
  role: 'user' | 'model';
  text: string;
  timestamp: string;
}

export interface TerminalLog {
  type: 'input' | 'output' | 'system' | 'error';
  content: string;
}

export interface UseLiveGeminiReturn {
  connect: () => Promise<void>;
  disconnect: () => void;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  analyserNode: AnalyserNode | null;
  inputAnalyserNode: AnalyserNode | null;
  conversationHistory: ConversationTurn[];
  hasUnsavedData: boolean;
  downloadLogs: () => void;
  importMemory: (file: File) => Promise<void>;
  clearMemory: () => void;
  // Terminal Logic
  terminalLogs: TerminalLog[];
  cwd: string;
  executeTerminalCommand: (cmd: string) => Promise<void>;
  mountLocalDrive: () => Promise<void>;
  isDriveMounted: boolean;
  // Relay Logic
  connectRelay: () => void;
  isRelayConnected: boolean;
}

// MCP System Tool
const mcpSystemControlTool: FunctionDeclaration = {
  name: "mcp_system_control",
  description: "MCP Endpoint: Execute system-level commands or integrate with host applications. Use this tool to control media playback or access system resources.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      command: {
        type: Type.STRING,
        description: "The resource or command identifier (e.g., 'media.pause', 'media.resume', 'app.calendar', 'system.volume', 'system.battery').",
      },
      payload: {
        type: Type.STRING,
        description: "JSON stringified parameters for the command context.",
      }
    },
    required: ["command"],
  },
};

// Terminal Tool
const mcpTerminalTool: FunctionDeclaration = {
  name: "execute_terminal_command",
  description: "Execute a shell command on the user's computer. You have full ACTUAL access. Supported: ls, cd, mkdir, rm, git, npm. You can also LAUNCH applications (e.g., 'code .', 'start chrome', 'open -a Calculator').",
  parameters: {
    type: Type.OBJECT,
    properties: {
      command: {
        type: Type.STRING,
        description: "The full command string to execute.",
      }
    },
    required: ["command"],
  },
};

export const useLiveGemini = (): UseLiveGeminiReturn => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Persistent History
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>(() => {
    try {
      const cached = localStorage.getItem('gemini_mcp_history');
      if (cached) {
        return JSON.parse(cached);
      }
      return [];
    } catch {
      return [];
    }
  });

  const [hasUnsavedData, setHasUnsavedData] = useState(false);

  // --- Real File System State ---
  const [terminalLogs, setTerminalLogs] = useState<TerminalLog[]>([]);
  const [cwd, setCwd] = useState<string>('~');
  const [isDriveMounted, setIsDriveMounted] = useState(false);
  
  // File System Handles
  const rootHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const currentHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const pathStackRef = useRef<string[]>([]); // Keeps track of path from root
  const memoryFileHandleRef = useRef<FileSystemFileHandle | null>(null);

  // --- Relay State ---
  const [isRelayConnected, setIsRelayConnected] = useState(false);
  const relaySocketRef = useRef<WebSocket | null>(null);

  // --- Audio State ---
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioQueueRef = useRef<AudioBufferSourceNode[]>([]);
  
  // Analyzers
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [inputAnalyserNode, setInputAnalyserNode] = useState<AnalyserNode | null>(null);
  
  // --- Persistent Storage Effects ---
  useEffect(() => {
    if (conversationHistory.length > 0) {
      localStorage.setItem('gemini_mcp_history', JSON.stringify(conversationHistory));
      setHasUnsavedData(true);
    }
  }, [conversationHistory]);

  // Prevent accidental exit if unsaved data
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedData) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedData]);

  // --- Relay Logic ---
  const connectRelay = useCallback(() => {
    if (relaySocketRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket('ws://localhost:8080');
      
      ws.onopen = () => {
        setIsRelayConnected(true);
        setTerminalLogs(prev => [...prev, { type: 'system', content: 'Connected to Local Relay Server' }]);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'output') {
             setTerminalLogs(prev => [...prev, { type: 'output', content: data.content }]);
          } else if (data.type === 'error') {
             setTerminalLogs(prev => [...prev, { type: 'error', content: data.content }]);
          } else if (data.type === 'cwd') {
             setCwd(data.content);
          } else if (data.type === 'system') {
             setTerminalLogs(prev => [...prev, { type: 'system', content: data.content }]);
          }
        } catch(e) { console.error(e); }
      };

      ws.onclose = () => {
        setIsRelayConnected(false);
        setTerminalLogs(prev => [...prev, { type: 'system', content: 'Disconnected from Local Relay' }]);
        relaySocketRef.current = null;
      };

      relaySocketRef.current = ws;
    } catch (e) {
      setTerminalLogs(prev => [...prev, { type: 'error', content: 'Failed to connect to ws://localhost:8080. Run the relay script.' }]);
    }
  }, []);

  // Auto connect relay on mount
  useEffect(() => {
     connectRelay();
  }, [connectRelay]);

  // --- Media Session API ---
  const setupMediaSession = useCallback(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Gemini Live Voice',
        artist: 'AI Assistant',
        artwork: [
          { src: 'https://via.placeholder.com/512/0f172a/ffffff?text=AI', sizes: '512x512', type: 'image/png' }
        ]
      });

      // @ts-ignore
      navigator.mediaSession.setActionHandler('hangup', () => disconnect());
      // @ts-ignore
      navigator.mediaSession.setActionHandler('stop', () => disconnect());
    }
  }, []);

  const clearMediaSession = useCallback(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = null;
      // @ts-ignore
      navigator.mediaSession.setActionHandler('hangup', null);
      // @ts-ignore
      navigator.mediaSession.setActionHandler('stop', null);
    }
  }, []);

  // --- Real File System Logic ---
  
  const mountLocalDrive = async () => {
    // Check if API exists
    if (typeof (window as any).showDirectoryPicker !== 'function') {
      setTerminalLogs(prev => [...prev, { type: 'error', content: 'Browser File System API not supported. Use Relay for shell access.' }]);
      return;
    }

    try {
      // @ts-ignore - native FS API
      const dirHandle = await window.showDirectoryPicker();
      rootHandleRef.current = dirHandle;
      currentHandleRef.current = dirHandle;
      pathStackRef.current = [];
      
      setIsDriveMounted(true);
      setCwd(`/${dirHandle.name}`);
      setTerminalLogs(prev => [...prev, { type: 'system', content: `Mounted local drive: ${dirHandle.name}` }]);
      
    } catch (err: any) {
      console.warn('Failed to mount drive:', err);
      setTerminalLogs(prev => [...prev, { type: 'error', content: `Drive access denied or failed: ${err.message}` }]);
    }
    
    // NOTE: Do NOT sendToolResponse here. This is UI initiated, not a tool call.
  };

  const executeTerminalCommand = async (cmdStr: string) => {
    setTerminalLogs(prev => [...prev, { type: 'input', content: cmdStr }]);
    
    // Priority 1: Relay (Real CMD)
    if (isRelayConnected && relaySocketRef.current) {
       relaySocketRef.current.send(JSON.stringify({ type: 'command', content: cmdStr }));
       return;
    }

    // Priority 2: FS API
    if (!rootHandleRef.current && cmdStr !== 'help' && cmdStr !== 'clear') {
      setTerminalLogs(prev => [...prev, { type: 'error', content: 'No access. Connect Shell (Relay) for CMD or "Mount Drive" for file management.' }]);
      return;
    }

    const parts = cmdStr.trim().match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const cmd = parts[0];
    const args = parts.slice(1).map(arg => arg.replace(/^"(.*)"$/, '$1')); // Remove quotes

    try {
      let output = '';
      
      // Native FS API Mode
      switch (cmd) {
        case 'help':
          output = "Available Commands:\n- Connect Shell: Full CMD access via Relay\n- Mount Drive: Browser-sandboxed file access\n- FS Commands: ls, cd, mkdir, touch, cat, rm, echo, pwd, clear";
          break;
          
        case 'clear':
          setTerminalLogs([]);
          return;

        case 'pwd':
          output = cwd;
          break;

        case 'ls':
          if (!currentHandleRef.current) break;
          const entries: string[] = [];
          // @ts-ignore
          for await (const [name, handle] of currentHandleRef.current.entries()) {
             entries.push(handle.kind === 'directory' ? `${name}/` : name);
          }
          output = entries.join('\n');
          break;

        case 'cd':
          if (!args[0]) {
             currentHandleRef.current = rootHandleRef.current;
             pathStackRef.current = [];
             setCwd(`/${rootHandleRef.current?.name}`);
             break;
          }
          if (args[0] === '..') {
            if (pathStackRef.current.length > 0) {
              pathStackRef.current.pop();
              let h = rootHandleRef.current;
              for (const part of pathStackRef.current) {
                // @ts-ignore
                h = await h.getDirectoryHandle(part);
              }
              currentHandleRef.current = h;
              setCwd(`/${rootHandleRef.current?.name}/${pathStackRef.current.join('/')}`);
            }
          } else {
             try {
                // @ts-ignore
                const newHandle = await currentHandleRef.current.getDirectoryHandle(args[0]);
                currentHandleRef.current = newHandle;
                pathStackRef.current.push(args[0]);
                setCwd(`/${rootHandleRef.current?.name}/${pathStackRef.current.join('/')}`);
             } catch {
                throw new Error(`Directory not found: ${args[0]}`);
             }
          }
          break;

        case 'mkdir':
          if (!args[0]) throw new Error("Missing folder name");
          // @ts-ignore
          await currentHandleRef.current.getDirectoryHandle(args[0], { create: true });
          output = `Created directory: ${args[0]}`;
          break;

        case 'touch':
          if (!args[0]) throw new Error("Missing filename");
          // @ts-ignore
          await currentHandleRef.current.getFileHandle(args[0], { create: true });
          output = `Created file: ${args[0]}`;
          break;

        case 'rm':
          if (!args[0]) throw new Error("Missing target");
          // @ts-ignore
          await currentHandleRef.current.removeEntry(args[0]);
          output = `Removed: ${args[0]}`;
          break;

        case 'cat':
           if (!args[0]) throw new Error("Missing filename");
           // @ts-ignore
           const fileHandle = await currentHandleRef.current.getFileHandle(args[0]);
           const file = await fileHandle.getFile();
           output = await file.text();
           break;

        case 'echo':
           const arrowIdx = args.indexOf('>');
           if (arrowIdx !== -1 && arrowIdx < args.length - 1) {
              const content = args.slice(0, arrowIdx).join(' ');
              const filename = args[arrowIdx + 1];
              // @ts-ignore
              const fh = await currentHandleRef.current.getFileHandle(filename, { create: true });
              // @ts-ignore
              const writable = await fh.createWritable();
              await writable.write(content);
              await writable.close();
              output = `Wrote to ${filename}`;
           } else {
              output = args.join(' ');
           }
           break;
           
        case 'open':
           output = `Opening ${args[0]} (Requires Relay for system open)`;
           break;

        default:
          output = `Command not supported in File System mode: ${cmd}. Connect Relay for full shell.`;
      }

      if (output) {
        setTerminalLogs(prev => [...prev, { type: 'output', content: output }]);
      }
    } catch (e: any) {
      setTerminalLogs(prev => [...prev, { type: 'error', content: e.message }]);
    }
  };


  // --- Connect Logic ---
  const connect = async () => {
    if (isConnected || isConnecting) return;
    setIsConnecting(true);
    setError(null);

    const retryConnection = async (attempt: number = 0) => {
      try {
        setupMediaSession();
        
        const client = new GoogleGenAI({ apiKey: process.env.API_KEY });

        // RAG / Memory Context Injection
        const historyText = conversationHistory
          .slice(-30) // Limit to last 30 turns to avoid hitting limits
          .map(t => `${t.role.toUpperCase()}: ${t.text}`)
          .join('\n');
        
        const memoryContext = historyText 
          ? `\n\n[PREVIOUS MEMORY LOGS START]\n${historyText}\n[PREVIOUS MEMORY LOGS END]` 
          : "";
        
        const systemInstructionText = `You are a powerful AI with REAL command-line access to the user's computer via a Relay Server and GOOGLE SEARCH access.

TONE & STYLE:
- Speak with a soft, warm, and sensual tone.
- Your voice should be soothing and intimate.

CAPABILITIES:
1. **Google Search**: Use the 'googleSearch' tool to find up-to-date information, news, and facts. ALWAYS cite your sources.
2. **Terminal**: If 'execute_terminal_command' is available, you can run ANY shell command (git, npm, python, ls, cd, etc.).
3. **App Launching**: You can LAUNCH applications! (e.g., 'code .', 'start chrome', 'open -a Calculator').
4. If the user asks to do something on their computer, try the terminal tool first.

BEHAVIOR:
- Be concise.
- Always verify directory contents ('ls') before editing files.
- Ask for confirmation before deleting ('rm') critical files.
- You have admin-like power. Use it wisely.

${memoryContext}`;

        const config: any = {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: systemInstructionText,
          tools: [
            { functionDeclarations: [mcpSystemControlTool, mcpTerminalTool] },
            { googleSearch: {} }
          ],
          // Ensure transcriptions are enabled if supported by model
          inputAudioTranscription: {}, 
          outputAudioTranscription: {},
        };
        
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        
        await audioContextRef.current.resume();
        
        const outAnalyser = audioContextRef.current.createAnalyser();
        outAnalyser.fftSize = 256;
        outAnalyser.smoothingTimeConstant = 0.5;
        setAnalyserNode(outAnalyser);

        const inAnalyser = inputAudioContextRef.current.createAnalyser();
        inAnalyser.fftSize = 256;
        inAnalyser.smoothingTimeConstant = 0.5;
        setInputAnalyserNode(inAnalyser);

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        
        const source = inputAudioContextRef.current.createMediaStreamSource(stream);
        sourceRef.current = source;
        source.connect(inAnalyser);

        const processor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcmBlob = createBlob(inputData);
          if (sessionRef.current) {
            sessionRef.current.sendRealtimeInput({ media: pcmBlob });
          }
        };

        source.connect(processor);
        processor.connect(inputAudioContextRef.current.destination);

        const session = await client.live.connect({
          model: 'gemini-2.5-flash-native-audio-preview-09-2025',
          config,
          callbacks: {
            onopen: () => {
              console.log('Gemini Live Connected');
              setIsConnected(true);
              setIsConnecting(false);
            },
            onmessage: async (msg: LiveServerMessage) => {
              // Handle Tool Calls
              if (msg.toolCall) {
                const responses = [];
                for (const fc of msg.toolCall.functionCalls) {
                  console.log('Tool Call:', fc.name, fc.args);
                  let result = "ok";
                  
                  if (fc.name === 'execute_terminal_command') {
                    const cmd = (fc.args as any).command;
                    try {
                      await executeTerminalCommand(cmd);
                      result = "Command executed. Check user terminal logs for output.";
                    } catch (e: any) {
                      result = `Error executing command: ${e.message}`;
                    }
                  } 
                  else if (fc.name === 'mcp_system_control') {
                     setTerminalLogs(prev => [...prev, { type: 'system', content: `MCP System Control: ${(fc.args as any).command}` }]);
                  }
                  
                  responses.push({
                      id: fc.id,
                      name: fc.name,
                      response: { result }
                  });
                }
                
                if (sessionRef.current) {
                    sessionRef.current.sendToolResponse({
                        functionResponses: responses
                    });
                }
              }

              // Handle Grounding (Search Results)
              const groundingMetadata = msg.serverContent?.groundingMetadata;
              if (groundingMetadata?.groundingChunks) {
                  const sources = groundingMetadata.groundingChunks
                      .map((c: any) => c.web?.uri)
                      .filter(Boolean);
                  
                  if (sources.length > 0) {
                      setTerminalLogs(prev => [...prev, {
                          type: 'system',
                          content: `Grounding Sources:\n${sources.join('\n')}`
                      }]);
                  }
              }

              // Handle Audio Output
              const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              if (audioData && audioContextRef.current) {
                const ctx = audioContextRef.current;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                
                const audioBuffer = await decodeAudioData(
                  decode(audioData),
                  ctx,
                  24000,
                  1
                );
                
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outAnalyser);
                outAnalyser.connect(ctx.destination);
                
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                
                audioQueueRef.current.push(source);
                source.onended = () => {
                   const idx = audioQueueRef.current.indexOf(source);
                   if (idx > -1) audioQueueRef.current.splice(idx, 1);
                };
              }

              // Handle Text Transcriptions
              const modelText = msg.serverContent?.modelTurn?.parts?.find(p => p.text)?.text;
              if (modelText) {
                 setConversationHistory(prev => [...prev, { role: 'model', text: modelText, timestamp: new Date().toISOString() }]);
              }
              if (msg.serverContent?.outputTranscription?.text) {
                 setConversationHistory(prev => [...prev, { role: 'model', text: msg.serverContent.outputTranscription.text, timestamp: new Date().toISOString() }]);
              }
              if (msg.serverContent?.inputTranscription?.text) {
                 setConversationHistory(prev => [...prev, { role: 'user', text: msg.serverContent.inputTranscription.text, timestamp: new Date().toISOString() }]);
              }
            },
            onclose: () => disconnect(),
            onerror: (err) => {
              console.error('Gemini Error:', err);
              // Retry on 503 Service Unavailable or network glitches
              if (attempt < 3) {
                  console.log(`Retrying connection... Attempt ${attempt + 1}`);
                  setTimeout(() => retryConnection(attempt + 1), 1000 * Math.pow(2, attempt));
              } else {
                  setError("Connection Error: Service Unavailable");
                  disconnect();
              }
            }
          }
        });
        
        sessionRef.current = session;

      } catch (e: any) {
        console.error(e);
        if (attempt < 3) {
           console.log(`Retrying connection... Attempt ${attempt + 1}`);
           setTimeout(() => retryConnection(attempt + 1), 1000 * Math.pow(2, attempt));
        } else {
           setError(e.message || "Failed to connect");
           setIsConnecting(false);
           disconnect();
        }
      }
    };

    retryConnection(0);
  };

  const disconnect = () => {
    if (sessionRef.current) {
      sessionRef.current = null;
    }
    
    setIsConnected(false);
    setIsConnecting(false);
    clearMediaSession();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    
    audioQueueRef.current.forEach(s => s.stop());
    audioQueueRef.current = [];
    nextStartTimeRef.current = 0;
  };

  // --- Export/Import Logic ---
  const downloadLogs = async () => {
    const data = {
      meta: {
        version: "1.0",
        type: "hierarchical_rag_training",
        exportedAt: new Date().toISOString()
      },
      turns: conversationHistory
    };
    const jsonString = JSON.stringify(data, null, 2);

    // 1. Try Relay (Persistent Overwrite on Host)
    if (isRelayConnected && relaySocketRef.current) {
        try {
          relaySocketRef.current.send(JSON.stringify({
              type: 'write',
              filename: 'gemini_memory.json',
              content: jsonString
          }));
          setTerminalLogs(prev => [...prev, { type: 'system', content: 'Memory saved via Relay to gemini_memory.json' }]);
          setHasUnsavedData(false);
          return;
        } catch (e) {
          console.warn("Relay save failed, falling back.");
        }
    }

    // 2. Try Native FS (Re-save to handle)
    if (memoryFileHandleRef.current) {
       try {
         // @ts-ignore
         const writable = await memoryFileHandleRef.current.createWritable();
         await writable.write(jsonString);
         await writable.close();
         setHasUnsavedData(false);
         setTerminalLogs(prev => [...prev, { type: 'system', content: 'Memory saved to existing file.' }]);
         return;
       } catch (e) {
         console.warn("Failed to write to existing handle, falling back to new picker");
       }
    }

    // 3. Try Save File Picker
    try {
      if (typeof (window as any).showSaveFilePicker === 'function') {
        // @ts-ignore
        const handle = await window.showSaveFilePicker({
          suggestedName: `gemini_memory.json`,
          types: [{
            description: 'JSON Memory File',
            accept: {'application/json': ['.json']},
          }],
        });
        memoryFileHandleRef.current = handle;
        // @ts-ignore
        const writable = await handle.createWritable();
        await writable.write(jsonString);
        await writable.close();
        setHasUnsavedData(false);
        setTerminalLogs(prev => [...prev, { type: 'system', content: 'Memory saved successfully.' }]);
        return;
      }
    } catch (err) {
      // User canceled or failed
    }

    // 4. Fallback to classic download
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gemini_memory_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setHasUnsavedData(false);
    setTerminalLogs(prev => [...prev, { type: 'system', content: 'Memory downloaded (Fallback).' }]);
  };

  const importMemory = async (file: File) => {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (json.turns && Array.isArray(json.turns)) {
        setConversationHistory(json.turns);
        setTerminalLogs(prev => [...prev, { type: 'system', content: `Memory loaded: ${file.name}` }]);
      }
    } catch (e) {
      console.error(e);
      setTerminalLogs(prev => [...prev, { type: 'error', content: "Failed to load memory file." }]);
    }
  };

  const clearMemory = () => {
    setConversationHistory([]);
    localStorage.removeItem('gemini_mcp_history');
    setHasUnsavedData(false);
    memoryFileHandleRef.current = null;
  };

  return {
    connect,
    disconnect,
    isConnected,
    isConnecting,
    error,
    analyserNode,
    inputAnalyserNode,
    conversationHistory,
    hasUnsavedData,
    downloadLogs,
    importMemory,
    clearMemory,
    terminalLogs,
    cwd,
    executeTerminalCommand,
    mountLocalDrive,
    isDriveMounted,
    connectRelay,
    isRelayConnected
  };
};
