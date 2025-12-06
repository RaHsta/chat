
import React, { useState, useEffect, useRef } from 'react';

interface TerminalProps {
  logs: { type: 'input' | 'output' | 'system' | 'error', content: string }[];
  cwd: string;
  onCommand: (cmd: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  onMount?: () => void;
  isMounted?: boolean;
  onConnectRelay?: () => void;
  isRelayConnected?: boolean;
}

const Terminal: React.FC<TerminalProps> = ({ 
  logs, cwd, onCommand, isOpen, onToggle, onMount, isMounted, onConnectRelay, isRelayConnected 
}) => {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
      inputRef.current?.focus();
    }
  }, [logs, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onCommand(input);
    setInput('');
  };

  if (!isOpen) {
    return (
      <button 
        onClick={onToggle}
        className="fixed bottom-6 right-6 p-4 bg-slate-900 text-white rounded-full shadow-xl shadow-slate-900/20 hover:scale-105 transition-transform z-50 group"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span className="absolute right-full mr-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-slate-800 text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap transition-opacity pointer-events-none">
          Open Terminal
        </span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-[600px] h-[400px] bg-slate-900/95 backdrop-blur-md rounded-xl shadow-2xl flex flex-col overflow-hidden border border-slate-700 z-50 font-mono text-sm transition-all duration-300">
      {/* Header */}
      <div className="bg-slate-800 px-4 py-2 flex items-center justify-between border-b border-slate-700 select-none cursor-move">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
          </div>
          <span className="text-slate-400 text-xs ml-2">gemini-shell — {cwd}</span>
        </div>
        <div className="flex items-center gap-2">
           {/* Relay Status */}
           {onConnectRelay && !isRelayConnected && (
             <button 
                onClick={onConnectRelay}
                className="text-[10px] bg-blue-600 hover:bg-blue-500 text-white px-2 py-0.5 rounded"
              >
                Connect Shell
              </button>
           )}
           {isRelayConnected && (
              <span className="text-[10px] text-blue-400 px-2 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                Bridge Active
              </span>
           )}

           {/* Mount Status (If relay not active or complementary) */}
           {!isMounted && onMount && !isRelayConnected && (
              <button 
                onClick={onMount}
                className="text-[10px] bg-purple-600 hover:bg-purple-500 text-white px-2 py-0.5 rounded animate-pulse"
              >
                Mount Drive
              </button>
           )}
           {isMounted && !isRelayConnected && (
              <span className="text-[10px] text-green-400 px-2">Local Drive</span>
           )}
           
           <button onClick={onToggle} className="text-slate-500 hover:text-slate-300 ml-2">
             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
             </svg>
           </button>
        </div>
      </div>

      {/* Logs */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1 custom-scrollbar text-slate-300">
        <div className="text-slate-500 mb-4 select-none">
          GeminiOS v3.0 [Advanced Mode]<br/>
          {isRelayConnected 
             ? "Status: CONNECTED to Local Host. Full Access Granted."
             : "Status: Restricted. Click 'Connect Shell' to enable full CMD."}<br/>
          Type 'help' for available commands.
        </div>
        
        {logs.map((log, i) => (
          <div key={i} className={`${
            log.type === 'input' ? 'text-white font-semibold mt-2' : 
            log.type === 'system' ? 'text-blue-400' : 
            log.type === 'error' ? 'text-red-400' : 'text-slate-300'
          } whitespace-pre-wrap break-words`}>
            {log.type === 'input' && <span className="text-purple-400 mr-2">➜</span>}
            {log.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 bg-slate-800/50 border-t border-slate-700 flex gap-2 items-center">
        <span className="text-purple-400">➜</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 bg-transparent border-none outline-none text-white placeholder-slate-600 font-mono"
          placeholder={isRelayConnected ? "Enter shell command..." : "Enter command..."}
          autoFocus
        />
      </form>
    </div>
  );
};

export default Terminal;