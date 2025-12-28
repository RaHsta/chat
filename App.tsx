
import React, { useState } from 'react';
import { useLiveGemini } from './hooks/useLiveGemini';
import Visualizer from './components/Visualizer';
import Terminal from './components/Terminal';
import CallCenter from './components/CallCenter';
import Settings from './components/Settings';

type ViewMode = 'CORE' | 'CALL_CENTER' | 'HISTORY' | 'SETTINGS';

const App: React.FC = () => {
  const [view, setView] = useState<ViewMode>('CORE');
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);

  const { 
    connect, disconnect, isConnected, isConnecting, error, analyserNode, inputAnalyserNode,
    terminalLogs, cwd, executeTerminalCommand,
    connectRelay, isRelayConnected, isRelayAuthorized, isHealing,
    selfHealingEnabled, setSelfHealingEnabled, downloadSetupScript,
    callStatus, activeCalls, conversationHistory, clearMemory
  } = useLiveGemini();

  return (
    <div className="min-h-screen flex flex-col bg-white overflow-hidden">
      {/* Top Persistent Bar */}
      <nav className="h-20 border-b flex items-center justify-between px-10 bg-white/80 backdrop-blur-md sticky top-0 z-[100]">
        <div className="flex items-center gap-12">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView('CORE')}>
            <div className="w-8 h-8 bg-red-600 flex items-center justify-center text-white font-black rounded-lg">A</div>
            <h1 className="text-xl font-black tracking-tighter">ARCHITECT<span className="text-red-600 font-light ml-1">v4</span></h1>
          </div>
          
          <div className="flex items-center gap-6">
            <button onClick={() => setView('CORE')} className={`text-[10px] font-black uppercase tracking-widest transition-colors ${view === 'CORE' ? 'text-red-600' : 'text-slate-400 hover:text-slate-900'}`}>Core_Engine</button>
            <button onClick={() => setView('CALL_CENTER')} className={`text-[10px] font-black uppercase tracking-widest transition-colors ${view === 'CALL_CENTER' ? 'text-red-600' : 'text-slate-400 hover:text-slate-900'}`}>Call_Center</button>
            <button onClick={() => setView('HISTORY')} className={`text-[10px] font-black uppercase tracking-widest transition-colors ${view === 'HISTORY' ? 'text-red-600' : 'text-slate-400 hover:text-slate-900'}`}>Log_Archive</button>
            <button onClick={() => setView('SETTINGS')} className={`text-[10px] font-black uppercase tracking-widest transition-colors ${view === 'SETTINGS' ? 'text-red-600' : 'text-slate-400 hover:text-slate-900'}`}>Settings</button>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className={`px-4 py-1.5 rounded-full border text-[9px] font-black tracking-widest flex items-center gap-2 ${isRelayAuthorized ? 'border-[#00FFBB]/40 bg-[#00FFBB]/5 text-[#00FFBB]' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>
             <div className={`w-1.5 h-1.5 rounded-full ${isRelayAuthorized ? 'bg-[#00FFBB] animate-pulse' : 'bg-slate-300'}`}></div>
             {isRelayAuthorized ? 'BRIDGE_ONLINE' : 'BRIDGE_LOCKED'}
          </div>
          <button onClick={isConnected ? disconnect : connect} disabled={isConnecting} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${isConnected ? 'bg-red-50/50 text-red-600 border border-red-100 hover:bg-red-100' : 'bg-slate-900 text-white hover:bg-black'}`}>
            {isConnecting ? 'BOOTING...' : isConnected ? 'DISCONNECT' : 'INITIATE'}
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 relative overflow-y-auto p-12">
        {view === 'CORE' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 max-w-7xl mx-auto">
            <div className="lg:col-span-5">
              <div className="relative p-1 bg-white border rounded-[4rem] shadow-sm">
                <div className="aspect-square w-full bg-slate-50/50 rounded-[3.8rem] flex items-center justify-center overflow-hidden">
                   <Visualizer outputAnalyser={analyserNode} inputAnalyser={inputAnalyserNode} isActive={isConnected} />
                   {!isConnected && !isConnecting && (
                     <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/40 backdrop-blur-sm">
                        <span className="text-[10px] font-black uppercase tracking-[0.5em] text-slate-300">System Ready</span>
                     </div>
                   )}
                </div>
              </div>
            </div>
            <div className="lg:col-span-7 flex flex-col gap-8 justify-center">
              <div className="space-y-4">
                <h2 className="text-5xl font-black tracking-tight text-slate-900 leading-[0.9]">MASTER_LINK<br/><span className="text-slate-300">PROTOCOL</span></h2>
                <p className="text-slate-500 text-sm max-w-md">The Architect Core provides a high-fidelity, low-latency bridge between Gemini and your local filesystem for autonomous code architecture.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={downloadSetupScript} className="p-8 border rounded-[2rem] text-left hover:border-red-600 transition-colors group">
                  <div className="text-[10px] font-black uppercase text-red-600 mb-2">Security</div>
                  <div className="text-lg font-bold">Deploy Relay</div>
                  <div className="text-xs text-slate-400 mt-2">Generate a zero-config setup script for your host.</div>
                </button>
                <button onClick={() => setIsTerminalOpen(true)} className="p-8 border rounded-[2rem] text-left hover:border-slate-900 transition-colors">
                  <div className="text-[10px] font-black uppercase text-slate-400 mb-2">Interface</div>
                  <div className="text-lg font-bold">Launch Shell</div>
                  <div className="text-xs text-slate-400 mt-2">Open the diagnostic terminal to monitor system output.</div>
                </button>
              </div>
            </div>
          </div>
        )}

        {view === 'CALL_CENTER' && <CallCenter status={callStatus} calls={activeCalls} isConnected={isConnected} onInit={connect} />}
        
        {view === 'HISTORY' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-3xl font-black">LOG_ARCHIVE</h2>
              <button onClick={clearMemory} className="text-xs font-black text-red-600 hover:underline uppercase tracking-widest">Wipe Memory</button>
            </div>
            {conversationHistory.length === 0 && <div className="text-center py-20 text-slate-300 font-black uppercase tracking-widest">No Records Found</div>}
            {conversationHistory.map((h, i) => (
              <div key={i} className={`p-8 rounded-[2.5rem] border ${h.role === 'user' ? 'bg-slate-50 border-slate-100 ml-12' : 'bg-white border-slate-200 mr-12'}`}>
                <div className="text-[9px] font-black uppercase text-slate-400 mb-4 tracking-widest">{h.role} • {h.timestamp}</div>
                <div className="text-sm leading-relaxed text-slate-800">{h.text}</div>
              </div>
            ))}
          </div>
        )}

        {view === 'SETTINGS' && (
          <Settings 
            selfHealing={selfHealingEnabled} 
            setSelfHealing={setSelfHealingEnabled}
            ttsHighRes={true}
            setTtsHighRes={() => {}}
            isRelayConnected={isRelayConnected}
          />
        )}
      </main>

      <Terminal 
        logs={terminalLogs} cwd={cwd} onCommand={executeTerminalCommand} 
        isOpen={isTerminalOpen} onToggle={() => setIsTerminalOpen(!isTerminalOpen)} 
        isRelayAuthorized={isRelayAuthorized} isHealing={isHealing} 
      />

      {error && <div className="fixed bottom-12 left-12 p-6 bg-red-600 text-white font-bold rounded-2xl shadow-2xl z-[1000] animate-bounce">FAULT: {error}</div>}
    </div>
  );
};

export default App;
