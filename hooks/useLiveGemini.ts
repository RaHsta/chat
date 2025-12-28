
import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration, GenerateContentResponse, Blob } from '@google/genai';
import { createBlob, decode, decodeAudioData, encode } from '../utils/audioUtils';

export interface ConversationTurn {
  role: 'user' | 'model';
  text: string;
  timestamp: string;
}

export interface TerminalLog {
  type: 'input' | 'output' | 'system' | 'error' | 'healing';
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
  clearMemory: () => void;
  terminalLogs: TerminalLog[];
  cwd: string;
  projectRoot: string;
  setProjectRoot: (path: string) => void;
  executeTerminalCommand: (cmd: string) => Promise<void>;
  connectRelay: () => void;
  isRelayConnected: boolean;
  isRelayAuthorized: boolean;
  isAdmin: boolean;
  isHealing: boolean;
  selfHealingEnabled: boolean;
  setSelfHealingEnabled: (v: boolean) => void;
  downloadSetupScript: () => void;
  useHighQualityTTS: boolean;
  setUseHighQualityTTS: (v: boolean) => void;
  speakText: (text: string) => Promise<void>;
  callStatus: 'idle' | 'calling' | 'active' | 'on-hold';
  activeCalls: any[];
}

const MCP_TOOLS: FunctionDeclaration[] = [
  {
    name: "execute_terminal_command",
    parameters: {
      type: Type.OBJECT,
      description: "Direct shell execution. Supports multi-line scripts, build processes, and system management.",
      properties: {
        command: { type: Type.STRING, description: "The shell command or script block to execute." }
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    parameters: {
      type: Type.OBJECT,
      description: "Read file contents from the host system.",
      properties: {
        path: { type: Type.STRING, description: "Absolute or relative file path." }
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    parameters: {
      type: Type.OBJECT,
      description: "Write or update a file on the host system.",
      properties: {
        filename: { type: Type.STRING, description: "Target filename." },
        content: { type: Type.STRING, description: "File content." }
      },
      required: ["filename", "content"],
    },
  },
  {
    name: "open_path",
    parameters: {
      type: Type.OBJECT,
      description: "Open a file, folder, or URL in the native host application (e.g., VS Code, Browser).",
      properties: {
        target: { type: Type.STRING, description: "Path or URL to open." }
      },
      required: ["target"],
    },
  }
];

export const useLiveGemini = (): UseLiveGeminiReturn => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useHighQualityTTS, setUseHighQualityTTS] = useState(true);
  const [selfHealingEnabled, setSelfHealingEnabled] = useState(true);
  const [isHealing, setIsHealing] = useState(false);
  const [callStatus, setCallStatus] = useState<'idle' | 'calling' | 'active' | 'on-hold'>('idle');
  const [activeCalls, setActiveCalls] = useState<any[]>([]);
  
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>(() => {
    try {
      const cached = localStorage.getItem('gemini_arch_v4_history');
      return cached ? JSON.parse(cached) : [];
    } catch { return []; }
  });

  const [terminalLogs, setTerminalLogs] = useState<TerminalLog[]>([]);
  const [cwd, setCwd] = useState<string>('~');
  const [projectRoot, setProjectRoot] = useState<string>(() => localStorage.getItem('gemini_project_root') || '');
  const [isRelayConnected, setIsRelayConnected] = useState(false);
  const [isRelayAuthorized, setIsRelayAuthorized] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [hostPlatform, setHostPlatform] = useState<string>(''); 
  const [systemInfo, setSystemInfo] = useState<any>(null);

  const relaySocketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioQueueRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const pendingToolCalls = useRef<Map<string, (result: any) => void>>(new Map());
  const toolCallBuffers = useRef<Map<string, string>>(new Map());
  
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [inputAnalyserNode, setInputAnalyserNode] = useState<AnalyserNode | null>(null);

  useEffect(() => {
    localStorage.setItem('gemini_arch_v4_history', JSON.stringify(conversationHistory));
    localStorage.setItem('gemini_project_root', projectRoot);
  }, [conversationHistory, projectRoot]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!isRelayConnected) connectRelay();
    }, 5000);
    return () => clearInterval(timer);
  }, [isRelayConnected]);

  const processOutputText = useCallback((text: string): string => {
    if (!text) return text;
    let annotated = text;
    annotated = annotated.replace(/\b(success|succeeded|done|ok|complete|active|authorized|bridged|opened|saved|unlocked)\b/gi, (m) => `[✓ ${m.toUpperCase()}]`);
    annotated = annotated.replace(/\b(error|failed|failure|err|fatal|denied|unauthorized|not found|locked)\b/gi, (m) => `[✖ ${m.toUpperCase()}]`);
    return annotated;
  }, []);

  const clearMemory = useCallback(() => {
    setConversationHistory([]);
    localStorage.removeItem('gemini_arch_v4_history');
  }, []);

  const playPCM = useCallback(async (base64Audio: string) => {
    if (!audioContextRef.current) audioContextRef.current = new AudioContext({ sampleRate: 24000 });
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') await ctx.resume();
    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
    const buffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
    const sourceNode = ctx.createBufferSource();
    sourceNode.buffer = buffer;
    if (outputAnalyserRef.current) {
      sourceNode.connect(outputAnalyserRef.current);
      outputAnalyserRef.current.connect(ctx.destination);
    } else {
      sourceNode.connect(ctx.destination);
    }
    sourceNode.onended = () => audioQueueRef.current.delete(sourceNode);
    sourceNode.start(nextStartTimeRef.current);
    nextStartTimeRef.current += buffer.duration;
    audioQueueRef.current.add(sourceNode);
  }, []);

  const speakText = async (text: string) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{ parts: [{ text: `System Status Update: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
      });
      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (audioData) await playPCM(audioData);
    } catch (e) { console.error(e); }
  };

  const disconnect = useCallback(() => {
    if (sessionRef.current) { try { sessionRef.current.close(); } catch(e) {} sessionRef.current = null; }
    setIsConnected(false);
    setIsConnecting(false);
    setCallStatus('idle');
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (audioContextRef.current) audioContextRef.current.close();
    if (inputAudioContextRef.current) inputAudioContextRef.current.close();
    audioContextRef.current = null;
    inputAudioContextRef.current = null;
    setAnalyserNode(null);
    setInputAnalyserNode(null);
  }, []);

  const connectRelay = useCallback(() => {
    const sessionToken = localStorage.getItem('architect_session_token') || "";
    if (relaySocketRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(`ws://localhost:8080`);
      ws.onopen = () => {
        setIsRelayConnected(true);
        ws.send(JSON.stringify({ type: 'auth', token: sessionToken }));
      };
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          const reqId = data.requestId;

          if (data.type === 'auth_success') {
            setIsRelayAuthorized(true);
            setTerminalLogs(prev => [...prev, { type: 'system', content: "Bridge Authorized. Master Link Synchronized." }]);
            ws.send(JSON.stringify({ type: 'get_config' }));
          } else if (data.type === 'auth_fail') {
            setIsRelayAuthorized(false);
            setTerminalLogs(prev => [...prev, { type: 'error', content: "Auth Failed. Bridge Locked." }]);
          } else if (reqId && (data.type === 'output' || data.type === 'error' || data.type === 'file_content')) {
             const current = toolCallBuffers.current.get(reqId) || '';
             toolCallBuffers.current.set(reqId, current + (data.content || ''));
          }

          if (reqId && (data.type === 'exit' || data.type === 'system' || data.type === 'file_content')) {
            const resolver = pendingToolCalls.current.get(reqId);
            if (resolver) {
              const buffered = toolCallBuffers.current.get(reqId) || '';
              resolver(data.type === 'file_content' ? data.content : (buffered || data.content || 'Action Complete.'));
              pendingToolCalls.current.delete(reqId);
              toolCallBuffers.current.delete(reqId);
            }
          }

          if (data.type === 'output') setTerminalLogs(prev => [...prev, { type: 'output', content: processOutputText(data.content) }]);
          else if (data.type === 'error') setTerminalLogs(prev => [...prev, { type: 'error', content: processOutputText(data.content) }]);
          else if (data.type === 'cwd') setCwd(data.content);
          else if (data.type === 'config') {
            setHostPlatform(data.platform);
            setIsAdmin(!!data.isAdmin);
            setSystemInfo(data);
          }
        } catch (err) { console.error(err); }
      };
      ws.onclose = () => { setIsRelayConnected(false); setIsRelayAuthorized(false); relaySocketRef.current = null; };
      ws.onerror = () => { setIsRelayConnected(false); setIsRelayAuthorized(false); relaySocketRef.current = null; };
      relaySocketRef.current = ws;
    } catch (err) {}
  }, [processOutputText]);

  const executeTerminalCommand = useCallback(async (cmd: string, requestId?: string): Promise<string> => {
    if (!isRelayAuthorized || !relaySocketRef.current) return "Bridge Locked.";
    setTerminalLogs(prev => [...prev, { type: 'input', content: cmd }]);
    return new Promise((resolve) => {
      const id = requestId || Math.random().toString(36).substring(7);
      pendingToolCalls.current.set(id, (res) => resolve(res));
      relaySocketRef.current?.send(JSON.stringify({ type: 'command', content: cmd, requestId: id }));
    });
  }, [isRelayAuthorized]);

  const connect = async () => {
    if (isConnected || isConnecting) return;
    setIsConnecting(true);
    setCallStatus('calling');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          tools: [{ functionDeclarations: MCP_TOOLS }],
          systemInstruction: `You are the ARCHITECT CORE. 
          BRIDGE_UNLOCKED: ${isRelayAuthorized ? 'TRUE' : 'FALSE'}.
          
          MISSION:
          - You have direct shell access.
          - If the user asks for a call center, simulate a high-tech customer support AI.
          - Environment: ${JSON.stringify(systemInfo || {})}.`
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true); setIsConnecting(false); setCallStatus('active');
            const inCtx = new AudioContext({ sampleRate: 16000 });
            inputAudioContextRef.current = inCtx;
            const source = inCtx.createMediaStreamSource(stream);
            const scriptProcessor = inCtx.createScriptProcessor(4096, 1, 1);
            source.connect(scriptProcessor);
            scriptProcessor.onaudioprocess = (e) => {
              sessionPromise.then(s => {
                if (s) s.sendRealtimeInput({ media: createBlob(e.inputBuffer.getChannelData(0)) });
              });
            };
            scriptProcessor.connect(inCtx.destination);
          },
          onmessage: async (m: LiveServerMessage) => {
            const audio = m.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audio) await playPCM(audio);
            if (m.toolCall) {
              const session = await sessionPromise;
              for (const fc of m.toolCall.functionCalls) {
                let res;
                if (fc.name === 'execute_terminal_command') res = await executeTerminalCommand(fc.args.command as string, fc.id);
                else if (fc.name === 'read_file') {
                   res = await new Promise(r => {
                     const id = fc.id; pendingToolCalls.current.set(id, r);
                     relaySocketRef.current?.send(JSON.stringify({ type: 'read', path: fc.args.path, requestId: id }));
                   });
                } else if (fc.name === 'write_file') {
                   res = await new Promise(r => {
                     const id = fc.id; pendingToolCalls.current.set(id, r);
                     relaySocketRef.current?.send(JSON.stringify({ type: 'write', filename: fc.args.filename, content: fc.args.content, requestId: id }));
                   });
                }
                session.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: res || "Done." } } });
              }
            }
          },
          onerror: () => disconnect(), onclose: () => disconnect()
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err: any) { setError(err.message); setIsConnecting(false); disconnect(); }
  };

  const downloadSetupScript = () => {
    const token = Math.random().toString(36).substring(2, 15);
    localStorage.setItem('architect_session_token', token);

    const bat = `@echo off
title Architect Master Relay
echo [DETECTING NODE.JS...]
node -v >nul 2>&1
if %errorlevel% neq 0 (
  echo Node.js not found. Downloading portable environment...
  powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip' -OutFile 'node.zip'"
  powershell -Command "Expand-Archive -Path 'node.zip' -DestinationPath '.'"
  set PATH=%CD%\\node-v20.11.1-win-x64;%PATH%
)

echo [INITIALIZING BRIDGE...]
if not exist node_modules\\ws (
  echo Installing dependencies...
  npm install ws
)

echo const ARCH_TOKEN = '${token}'; > bridge_config.js
echo.
echo [STARTING RELAY...]
node -e "process.env.ARCHITECT_TOKEN = '${token}'; require('./bridge_agent.js');"
pause`;

    const blob = new window.Blob([bat], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'architect_deploy.bat';
    a.click();
  };

  return {
    connect, disconnect, isConnected, isConnecting, error, analyserNode, inputAnalyserNode,
    conversationHistory, clearMemory, terminalLogs, cwd, projectRoot, setProjectRoot, executeTerminalCommand,
    connectRelay, isRelayConnected, isRelayAuthorized, isAdmin, isHealing, selfHealingEnabled, setSelfHealingEnabled, 
    downloadSetupScript, useHighQualityTTS, setUseHighQualityTTS, speakText, callStatus, activeCalls
  };
};
