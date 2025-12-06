
import React, { useRef, useState } from 'react';
import { useLiveGemini } from './hooks/useLiveGemini';
import Visualizer from './components/Visualizer';
import Terminal from './components/Terminal';

const App: React.FC = () => {
  const { 
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
  } = useLiveGemini();

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Terminal set to open by default
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      importMemory(file);
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50 text-slate-900 relative overflow-hidden">
      
      {/* Background Decorative Elements - Light Theme */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-200/40 rounded-full blur-[128px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-blue-200/40 rounded-full blur-[128px]"></div>
      </div>

      <div className="z-10 w-full max-w-md flex flex-col items-center gap-10">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-slate-200 text-xs font-medium text-purple-600 shadow-sm mb-4">
            <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span>
            Gemini 3 Live
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">
            Gemini Voice
          </h1>
          <p className="text-slate-500 text-sm">
            Experience real-time natural conversation.
          </p>
        </div>

        {/* Visualizer Container */}
        <div className="w-full aspect-square bg-white rounded-[2.5rem] shadow-xl border border-slate-100 flex items-center justify-center relative overflow-hidden">
           {/* Inner subtle gradient for depth */}
           <div className="absolute inset-0 bg-gradient-to-b from-slate-50/50 to-slate-100/50 pointer-events-none"></div>
           
           <div className="z-10 w-full h-full">
            <Visualizer 
              outputAnalyser={analyserNode} 
              inputAnalyser={inputAnalyserNode}
              isActive={isConnected} 
            />
           </div>
          
          {/* Status Overlay */}
          {!isConnected && !isConnecting && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
              <span className="text-slate-400 text-lg font-light tracking-wide">Ready to chat</span>
            </div>
          )}
          {isConnecting && (
             <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
              <div className="flex flex-col items-center gap-3">
                 <div className="w-8 h-8 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
                 <span className="text-slate-500 text-sm font-medium">Connecting...</span>
              </div>
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="w-full p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm text-center shadow-sm">
            {error}
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-col items-center gap-4 w-full">
          <div className="flex items-center gap-6">
            {!isConnected ? (
              <button
                onClick={connect}
                disabled={isConnecting}
                className={`
                  group relative px-8 py-4 bg-slate-900 text-white rounded-full font-semibold text-lg shadow-xl shadow-slate-900/20 
                  transition-all duration-300 hover:scale-105 hover:shadow-slate-900/30 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 focus:ring-offset-slate-50
                  ${isConnecting ? 'opacity-70 cursor-not-allowed' : ''}
                `}
              >
                <span className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  Start Conversation
                </span>
              </button>
            ) : (
               <button
                onClick={disconnect}
                className="
                  group relative px-8 py-4 bg-white text-red-500 border border-red-100 rounded-full font-semibold text-lg shadow-lg shadow-red-500/5
                  transition-all duration-300 hover:bg-red-50 hover:scale-105 hover:border-red-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-slate-50
                "
              >
                <span className="flex items-center gap-2">
                   <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  End Call
                </span>
              </button>
            )}
          </div>

          {/* Memory Management Area */}
          <div className="w-full flex flex-col items-center gap-2 pt-2 border-t border-slate-200">
             
             {/* Load / Import Button */}
             <div className="flex gap-4">
                <input 
                  type="file" 
                  accept=".json" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  className="hidden" 
                />
                
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors"
                >
                   <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Load Memory (Import)
                </button>

                {conversationHistory.length > 0 && (
                   <button
                    onClick={downloadLogs}
                    className={`
                      text-xs font-medium transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                      ${hasUnsavedData 
                        ? 'text-amber-600 bg-amber-50 hover:bg-amber-100' 
                        : 'text-purple-600 hover:text-purple-700'
                      }
                    `}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    {hasUnsavedData ? 'Save Training Data' : 'Download Memory'}
                  </button>
                )}
             </div>
             
             {conversationHistory.length > 0 && (
               <div className="text-[10px] text-slate-400 flex items-center gap-2">
                 <span>{conversationHistory.length} turns in memory (Auto-saved locally)</span>
                 <button onClick={clearMemory} className="text-red-400 hover:text-red-600 underline">Clear</button>
               </div>
             )}
          </div>
        </div>

        <div className="text-slate-400 text-xs text-center max-w-xs">
           Microphone access is required. Audio is streamed to Google Gemini for processing.
        </div>
      </div>

      <Terminal 
        logs={terminalLogs} 
        cwd={cwd} 
        onCommand={executeTerminalCommand}
        isOpen={isTerminalOpen}
        onToggle={() => setIsTerminalOpen(!isTerminalOpen)}
        onMount={mountLocalDrive}
        isMounted={isDriveMounted}
        onConnectRelay={connectRelay}
        isRelayConnected={isRelayConnected}
      />
    </div>
  );
};

export default App;
