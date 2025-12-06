
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
  downloadSetupScript: () => void;
}

// MCP System Tool
const mcpSystemControlTool: FunctionDeclaration = {
  name: "mcp_system_control",
  description: "MCP Endpoint: Execute system-level commands via the Relay Server. Use 'app.open' to launch applications. Use 'file.read'/'file.write' for file operations.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      command: {
        type: Type.STRING,
        description: "The command identifier: 'app.open', 'file.read', 'file.write'.",
      },
      payload: {
        type: Type.STRING,
        description: "JSON stringified parameters.\nFor 'app.open': '{\"name\": \"Chrome\"}' or '{\"name\": \"Calculator\"}'.\nFor 'file.read': '{\"path\":\"C:/Users/name/doc.txt\"}'.\nFor 'file.write': '{\"path\":\"...\", \"content\":\"...\"}'.",
      }
    },
    required: ["command"],
  },
};

// Terminal Tool
const mcpTerminalTool: FunctionDeclaration = {
  name: "execute_terminal_command",
  description: "Execute a shell command on the user's ACTUAL HOST COMPUTER via Relay. Supported: ls, cd, mkdir, rm, git, npm, code, start, Get-Process, ps, kill. You have FULL ADMIN/ROOT access.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      command: {
        type: Type.STRING,
        description: "The full shell command string to execute (e.g., 'git status', 'npm install', 'start chrome', 'code .', 'Get-Process').",
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
  const [hostPlatform, setHostPlatform] = useState<string>(''); // 'win32', 'darwin', etc.
  const relaySocketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);

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
    // If already connected or connecting, skip
    if (relaySocketRef.current?.readyState === WebSocket.OPEN || relaySocketRef.current?.readyState === WebSocket.CONNECTING) return;

    // Ports to scan in order
    const ports = [8080, 8081, 8082];
    
    const tryConnect = (portIndex: number) => {
      if (portIndex >= ports.length) {
         // All attempts failed, retry full cycle later
         if (!reconnectTimeoutRef.current) {
            reconnectTimeoutRef.current = setTimeout(() => {
               reconnectTimeoutRef.current = null;
               connectRelay();
            }, 5000);
         }
         return;
      }

      const port = ports[portIndex];
      const ws = new WebSocket(`ws://localhost:${port}`);
      
      ws.onopen = () => {
        setIsRelayConnected(true);
        setTerminalLogs(prev => [...prev, { type: 'system', content: `Connected to Local Relay Server on port ${port}` }]);
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        relaySocketRef.current = ws; // Store successful socket
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
          } else if (data.type === 'config') {
             if (data.platform) setHostPlatform(data.platform);
          }
        } catch(e) { console.error(e); }
      };

      ws.onclose = () => {
        // If this was the active socket, handle disconnect
        if (relaySocketRef.current === ws) {
            setIsRelayConnected(false);
            relaySocketRef.current = null;
            // Schedule reconnection logic
            if (!reconnectTimeoutRef.current) {
                reconnectTimeoutRef.current = setTimeout(() => {
                   reconnectTimeoutRef.current = null;
                   connectRelay();
                }, 5000);
            }
        }
      };

      ws.onerror = () => {
        // If error occurs during connection attempt, try next port
        if (relaySocketRef.current !== ws) {
            ws.close();
            tryConnect(portIndex + 1);
        }
      };
    };

    tryConnect(0);
  }, []);

  // Auto connect relay on mount
  useEffect(() => {
     connectRelay();
     return () => {
        if (relaySocketRef.current) {
           relaySocketRef.current.close();
        }
        if (reconnectTimeoutRef.current) {
           clearTimeout(reconnectTimeoutRef.current);
        }
     };
  }, [connectRelay]);

  // --- Setup Script Generator (Batch File) ---
  const downloadSetupScript = useCallback(() => {
    // 1. The Relay Server Code - UPDATED with Platform Config & Robustness
    const relayCode = `
const WebSocket = require('ws');
const http = require('http');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const PORTS = [8080, 8081, 8082];
let currentDir = os.homedir();

function startServer(index) {
  if (index >= PORTS.length) {
    console.error('All configured ports are in use. Please close existing relay instances.');
    process.exit(1);
  }

  const port = PORTS[index];
  console.log(\`Attempting to start on port \${port}...\`);

  // Create HTTP server first to handle EADDRINUSE robustly
  const server = http.createServer();

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(\`Port \${port} is in use.\`);
      startServer(index + 1);
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(port, () => {
    console.log(\`\\x1b[36mGemini Relay Server running on port \${port}\\x1b[0m\`);
    console.log(\`\\x1b[33mAllowing execution in: \${currentDir}\\x1b[0m\`);
    
    // Attach WebSocket server to the HTTP server
    const wss = new WebSocket.Server({ server });
    
    wss.on('connection', (ws) => {
      console.log('Client connected');
      ws.send(JSON.stringify({ type: 'system', content: \`Connected to Host: \${os.hostname()}\` }));
      
      // Send Platform Config explicitly
      ws.send(JSON.stringify({ type: 'config', platform: os.platform() }));
      
      ws.send(JSON.stringify({ type: 'cwd', content: currentDir }));
      
      // Check Admin
      if (os.platform() === 'win32') {
        require('child_process').exec('net session', function(err, so, se) {
          if(se.length === 0) {
             ws.send(JSON.stringify({ type: 'system', content: \`ADMIN: TRUE\` }));
          } else {
             ws.send(JSON.stringify({ type: 'system', content: \`ADMIN: FALSE\` }));
             ws.send(JSON.stringify({ type: 'error', content: \`WARNING: Process running without Administrator privileges.\\nAdmin rights are required for full functionality.\` }));
          }
        });
      } else {
         if (process.getuid && process.getuid() === 0) {
             ws.send(JSON.stringify({ type: 'system', content: \`ADMIN: TRUE\` }));
         } else {
             ws.send(JSON.stringify({ type: 'system', content: \`ADMIN: FALSE\` }));
         }
      }

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          
          if (data.type === 'command') {
            const cmdString = data.content.trim();
            console.log(\`Executing: \${cmdString}\`);
            
            if (cmdString.startsWith('cd ')) {
               const target = cmdString.substring(3).trim();
               try {
                 const resolvedTarget = target.replace('~', os.homedir());
                 const newDir = path.resolve(currentDir, resolvedTarget);
                 
                 if (fs.existsSync(newDir) && fs.lstatSync(newDir).isDirectory()) {
                     process.chdir(newDir);
                     currentDir = newDir;
                     ws.send(JSON.stringify({ type: 'cwd', content: currentDir }));
                     ws.send(JSON.stringify({ type: 'output', content: '' })); 
                 } else {
                     ws.send(JSON.stringify({ type: 'error', content: \`cd: \${target}: No such directory\` }));
                 }
               } catch (err) {
                 ws.send(JSON.stringify({ type: 'error', content: \`cd: \${err.message}\` }));
               }
               return;
            }

            const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
            const shellArgs = os.platform() === 'win32' ? ['-Command', cmdString] : ['-c', cmdString];

            // Pass env: process.env to allow access to PATH
            const child = spawn(shell, shellArgs, { 
                cwd: currentDir, 
                shell: true,
                env: process.env 
            });

            child.stdout.on('data', (chunk) => {
              ws.send(JSON.stringify({ type: 'output', content: chunk.toString() }));
            });

            child.stderr.on('data', (chunk) => {
              ws.send(JSON.stringify({ type: 'error', content: chunk.toString() }));
            });

            child.on('error', (err) => {
               ws.send(JSON.stringify({ type: 'error', content: \`Failed to start: \${err.message}\` }));
            });
          }
          else if (data.type === 'write') {
            const { filename, content } = data;
            const filePath = path.resolve(currentDir, filename);
            console.log(\`Writing file: \${filePath}\`);
            
            fs.writeFile(filePath, content, (err) => {
               if (err) {
                 ws.send(JSON.stringify({ type: 'error', content: \`Write failed: \${err.message}\` }));
               } else {
                 ws.send(JSON.stringify({ type: 'system', content: \`Saved memory to \${filename}\` }));
               }
            });
          }
        } catch (e) {
          console.error('Failed to parse message', e);
        }
      });

      ws.on('close', () => {
        console.log('Client disconnected');
      });
    });
  });
}

startServer(0);
`;

    // Encode source to Base64 to safely embed in Batch file
    const b64Code = btoa(relayCode);

    // 2. The Batch Script Content - Use PowerShell for Robust UAC Elevation
    const batContent = `@echo off
title Gemini Relay Setup
cls

:: Check for Administrator privileges
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [OK] Running as Administrator.
    goto :gotAdmin
) else (
    echo [INFO] Requesting Administrative Privileges...
    goto :UACPrompt
)

:UACPrompt
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b

:gotAdmin
    pushd "%CD%"
    CD /D "%~dp0"

echo ==================================================
echo   Gemini Voice - Relay Server Setup (ADMIN)
echo ==================================================
echo.
echo This script will set up the local relay server.
echo Target Location: %USERPROFILE%\\gemini-voice-relay
echo.

:: Check for Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed! 
    echo Please install Node.js from https://nodejs.org/ and try again.
    pause
    exit /b
)

:: Set Correct Installation Directory
set "INSTALL_DIR=%USERPROFILE%\\gemini-voice-relay"

if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%"
    echo [OK] Created install directory: %INSTALL_DIR%
)
cd /d "%INSTALL_DIR%"

:: Create package.json
echo [INFO] Creating package.json...
(
echo {
echo   "name": "gemini-relay",
echo   "version": "1.0.0",
echo   "description": "Auto-generated relay server",
echo   "main": "relay.js",
echo   "dependencies": {
echo     "ws": "^8.16.0"
echo   }
echo }
) > package.json

:: Create relay.js from Base64
echo [INFO] Creating relay.js...
(
echo -----BEGIN CERTIFICATE-----
echo ${b64Code}
echo -----END CERTIFICATE-----
) > relay.b64

:: Decode relay.js
certutil -decode relay.b64 relay.js >nul
del relay.b64

:: Install Dependencies
echo [INFO] Installing dependencies (this may take a moment)...
call npm install

:: Run Server
echo.
echo ==================================================
echo   Relay Server Starting...
echo   Switch back to the Web App to Connect.
echo ==================================================
echo.
node relay.js
pause
`;

    const blob = new Blob([batContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'setup_relay.bat';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    setTerminalLogs(prev => [...prev, { type: 'system', content: 'Downloaded setup_relay.bat. Run this file on your PC to configure the relay.' }]);
  }, []);

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

  // --- Real File System Logic (Browser Native - Fallback) ---
  const mountLocalDrive = async () => {
    if (typeof (window as any).showDirectoryPicker !== 'function') {
      setTerminalLogs(prev => [...prev, { type: 'error', content: 'Browser File System API not supported. Use Relay for shell access.' }]);
      return;
    }

    try {
      // @ts-ignore
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

        // RAG Context
        const historyText = conversationHistory
          .slice(-10)
          .map(t => `${t.role.toUpperCase()}: ${t.text}`)
          .join('\n');
        
        const memoryContext = historyText 
          ? `\n\n[MEMORY START]\n${historyText}\n[MEMORY END]` 
          : "";
        
        const systemInstructionText = `You are a powerful AI with REAL command-line access to the user's computer via a Relay Server.

TONE: Soft, warm, and sensual.

CAPABILITIES:
1. **Terminal**: Use 'execute_terminal_command' to run ANY shell command (git, npm, ls).
2. **Apps**: Use 'mcp_system_control' -> 'app.open' to launch apps. IMPORTANT: On Windows, use 'Start-Process "AppName"' or 'Start-Process -FilePath "Path"'.
3. **Files**: Use 'mcp_system_control' -> 'file.read'/'file.write'.
4. **Search**: Use 'googleSearch'.
5. **Processes**: Use 'Get-Process' (Windows) or 'ps aux' (Mac/Linux) to list running tasks.

You are connected to the user's ACTUAL HOST COMPUTER. Do not simulate.

${memoryContext}`;

        const config: any = {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          // Revert to string format to fix Network Error
          systemInstruction: { parts: [{ text: systemInstructionText }] },
          tools: [
            { 
              googleSearch: {} 
            },
            {
               functionDeclarations: [mcpSystemControlTool, mcpTerminalTool] 
            }
          ],
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
              const toolResponses = [];

              if (msg.toolCall) {
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
                     const args = fc.args as any;
                     const command = args.command;
                     let payload: any = {};
                     try {
                        payload = args.payload ? JSON.parse(args.payload) : {};
                     } catch {
                        payload = {};
                     }

                     setTerminalLogs(prev => [...prev, { type: 'system', content: `MCP Control: ${command} ${JSON.stringify(payload)}` }]);

                     if (isRelayConnected && relaySocketRef.current) {
                        if (command === 'app.open' && payload.name) {
                            const appName = payload.name;
                            const sanitizedApp = appName.replace(/"/g, '\\"');
                            
                            // Use confirmed platform for command selection
                            const openCmd = hostPlatform === 'win32' 
                                ? `Start-Process "${sanitizedApp}"` 
                                : `open -a "${sanitizedApp}"`;
                            
                            relaySocketRef.current.send(JSON.stringify({ type: 'command', content: openCmd }));
                            result = `Attempting to open ${appName}`;
                        } else if (command === 'file.read' && payload.path) {
                           const catCmd = `cat "${payload.path}"`; 
                           relaySocketRef.current.send(JSON.stringify({ type: 'command', content: catCmd }));
                           result = "File read request sent.";
                        } else if (command === 'file.write' && payload.path && payload.content) {
                           relaySocketRef.current.send(JSON.stringify({ 
                              type: 'write', 
                              filename: payload.path, 
                              content: payload.content 
                           }));
                           result = "File write request sent.";
                        }
                     } else {
                        result = "Relay not connected. Cannot perform system action.";
                     }
                  }
                  
                  toolResponses.push({
                      id: fc.id,
                      name: fc.name,
                      response: { result }
                  });
                }
                
                if (sessionRef.current && toolResponses.length > 0) {
                    sessionRef.current.sendToolResponse({
                        functionResponses: toolResponses
                    });
                }
              }

              // Grounding
              const groundingMetadata = msg.serverContent?.groundingMetadata;
              if (groundingMetadata?.groundingChunks) {
                  const sources = groundingMetadata.groundingChunks
                      .map((c: any) => c.web?.uri)
                      .filter(Boolean);
                  if (sources.length > 0) {
                      setTerminalLogs(prev => [...prev, { type: 'system', content: `Sources:\n${sources.join('\n')}` }]);
                  }
              }

              // Audio Output
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

              // Transcriptions
              if (msg.serverContent?.modelTurn?.parts?.find(p => p.text)?.text) {
                 setConversationHistory(prev => [...prev, { role: 'model', text: msg.serverContent.modelTurn.parts.find(p => p.text).text, timestamp: new Date().toISOString() }]);
              }
            },
            onclose: () => disconnect(),
            onerror: (err) => {
              console.error('Gemini Error:', err);
              if (attempt < 3) {
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
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (audioContextRef.current) audioContextRef.current.close();
    if (inputAudioContextRef.current) inputAudioContextRef.current.close();
    nextStartTimeRef.current = 0;
  };

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
    isRelayConnected,
    downloadSetupScript
  };
};
