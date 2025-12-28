
import React, { useState, useEffect, useRef, useMemo } from 'react';

interface TerminalProps {
  logs: { type: 'input' | 'output' | 'system' | 'error' | 'healing', content: string }[];
  cwd: string;
  onCommand: (cmd: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  isRelayConnected?: boolean;
  isRelayAuthorized?: boolean;
  isAdmin?: boolean;
  isHealing?: boolean;
}

const Terminal: React.FC<TerminalProps> = ({ 
  logs, cwd, onCommand, isOpen, onToggle, isRelayConnected, isRelayAuthorized, isAdmin, isHealing
}) => {
  const [input, setInput] = useState('');
  const [showActivityMonitor, setShowActivityMonitor] = useState(false);
  const [position, setPosition] = useState({ x: 24, y: 24 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  const filteredLogs = useMemo(() => logs.filter(l => l.type !== 'system' && l.type !== 'healing'), [logs]);
  const systemLogs = useMemo(() => logs.filter(l => l.type === 'system' || l.type === 'error' || l.type === 'healing'), [logs]);

  useEffect(() => {
    if (isOpen && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
      inputRef.current?.focus();
    }
  }, [logs, isOpen]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: Math.max(0, Math.min(window.innerWidth - 100, window.innerWidth - e.clientX - dragOffset.x)),
          y: Math.max(0, Math.min(window.innerHeight - 100, window.innerHeight - e.clientY - dragOffset.y))
        });
      }
    };
    const handleMouseUp = () => setIsDragging(false);
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (terminalRef.current) {
      const rect = terminalRef.current.getBoundingClientRect();
      setDragOffset({
        x: window.innerWidth - rect.right + (rect.right - e.clientX),
        y: window.innerHeight - rect.bottom + (rect.bottom - e.clientY)
      });
      setIsDragging(true);
    }
  };

  const highlightContent = (text: string) => {
    const markerRegex = /(\[✓ [^\]]+\]|\[✖ [^\]]+\]|\[GIT:[^\]]+\]|\[ARG:[^\]]+\]|\[PATH:[^\]]+\]|\[URL:[^\]]+\])/g;
    return text.split(markerRegex).map((part, i) => {
      if (!part) return null;
      if (part.startsWith('[✓')) return <span key={i} className="text-emerald-400 font-bold">{part}</span>;
      if (part.startsWith('[✖')) return <span key={i} className="text-rose-400 font-bold">{part}</span>;
      if (part.startsWith('[GIT:')) return <span key={i} className="text-zinc-200 border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 rounded text-[10px] mx-1">{part.slice(5, -1)}</span>;
      if (part.startsWith('[PATH:')) return <span key={i} className="text-sky-400 underline underline-offset-4 decoration-sky-400/30">{part.slice(6, -1)}</span>;
      return part;
    });
  };

  if (!isOpen) {
    return (
      <button 
        onClick={onToggle} 
        className="fixed bottom-8 right-8 w-14 h-14 bg-zinc-950 text-white rounded-2xl shadow-xl z-50 border border-zinc-800 flex items-center justify-center transition-all hover:scale-105 active:scale-95 group"
      >
        <div className={`absolute top-0 right-0 w-3 h-3 rounded-full border-2 border-zinc-950 ${isRelayAuthorized ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
        <svg className="w-6 h-6 text-zinc-400 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </button>
    );
  }

  return (
    <div 
      ref={terminalRef} 
      style={{ bottom: `${position.y}px`, right: `${position.x}px` }} 
      className={`fixed h-[580px] bg-zinc-950 rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-zinc-800 z-50 transition-all ${showActivityMonitor ? 'w-[1000px]' : 'w-[720px]'}`}
    >
      {/* Minimal Header */}
      <div 
        onMouseDown={handleMouseDown} 
        className="px-6 py-4 flex items-center justify-between bg-zinc-900/50 cursor-grab active:cursor-grabbing select-none border-b border-zinc-800/50"
      >
        <div className="flex items-center gap-4">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-zinc-800"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-zinc-800"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-zinc-800"></div>
          </div>
          <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest truncate max-w-[300px] terminal-font">
            {isHealing ? 'System.Recovery' : cwd.replace(/\/Users\/[^\/]+/, '~')}
          </span>
        </div>
        
        <div className="flex items-center gap-4">
           <div className={`flex items-center gap-2 px-3 py-1 rounded-md text-[9px] font-bold tracking-tight border ${isRelayAuthorized ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400' : 'border-rose-500/20 bg-rose-500/5 text-rose-400'}`}>
             <div className={`w-1.5 h-1.5 rounded-full ${isRelayAuthorized ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></div>
             {isRelayAuthorized ? 'AUTH_OK' : 'LOCKED'}
           </div>
           <button 
             onClick={() => setShowActivityMonitor(!showActivityMonitor)} 
             className={`text-[9px] font-bold px-3 py-1 rounded border transition-all ${showActivityMonitor ? 'bg-zinc-100 text-zinc-900 border-zinc-100' : 'bg-transparent text-zinc-500 border-zinc-800 hover:text-white hover:border-zinc-700'}`}
           >
             MONITOR
           </button>
           <button onClick={onToggle} className="text-zinc-600 hover:text-white transition-colors">
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
           </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto p-8 space-y-4 terminal-font text-[13px] text-zinc-300 leading-relaxed custom-scrollbar bg-zinc-950">
            {filteredLogs.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 opacity-10 pointer-events-none">
                <div className="text-[10px] font-bold uppercase tracking-[0.4em]">Standby</div>
              </div>
            )}
            {filteredLogs.map((log, i) => (
              <div key={i} className={`${log.type === 'input' ? 'text-emerald-400 font-bold mt-4' : log.type === 'error' ? 'text-rose-400' : 'text-zinc-400'} whitespace-pre-wrap`}>
                {log.type === 'input' && <span className="mr-3 text-zinc-700">$</span>}
                {highlightContent(log.content)}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <form 
            onSubmit={(e) => { e.preventDefault(); if (input.trim()) onCommand(input); setInput(''); }} 
            className="px-8 py-5 border-t border-zinc-900 bg-zinc-950 flex gap-4 items-center group"
          >
            <span className="text-zinc-600 font-bold terminal-font">❯</span>
            <input 
              ref={inputRef} 
              type="text" 
              value={input} 
              onChange={(e) => setInput(e.target.value)} 
              className="flex-1 bg-transparent border-none outline-none text-zinc-100 font-medium placeholder-zinc-800 terminal-font text-[13px]" 
              placeholder={isRelayAuthorized ? "Enter command..." : "Waiting for auth..."} 
              disabled={isHealing || !isRelayAuthorized} 
              autoFocus 
            />
          </form>
        </div>

        {showActivityMonitor && (
          <div className="w-[340px] bg-zinc-900/30 border-l border-zinc-900 flex flex-col">
            <div className="px-6 py-4 border-b border-zinc-900/50 bg-zinc-900/20">
               <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">Events</span>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6 terminal-font text-[11px] custom-scrollbar">
              {systemLogs.length === 0 && <div className="text-zinc-800 font-bold uppercase tracking-widest text-center py-10">Listening...</div>}
              {systemLogs.map((log, i) => (
                <div key={i} className={`flex flex-col gap-1.5 border-l border-zinc-800 pl-4 ${log.type === 'error' ? 'text-rose-400/80' : 'text-zinc-500'}`}>
                  <div className="uppercase opacity-30 text-[8px] font-bold tracking-tighter">{log.type}</div>
                  <div className="leading-relaxed">{highlightContent(log.content)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Terminal;
