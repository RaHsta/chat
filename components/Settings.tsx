
import React from 'react';

interface SettingsProps {
  selfHealing: boolean;
  setSelfHealing: (v: boolean) => void;
  ttsHighRes: boolean;
  setTtsHighRes: (v: boolean) => void;
  isRelayConnected: boolean;
}

const Settings: React.FC<SettingsProps> = ({ selfHealing, setSelfHealing, ttsHighRes, setTtsHighRes, isRelayConnected }) => {
  return (
    <div className="max-w-4xl mx-auto space-y-12">
      <h2 className="text-4xl font-black tracking-tight border-b pb-8">SYSTEM_CONFIG</h2>
      
      <div className="space-y-8">
        <section className="space-y-4">
          <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">Security Protocols</h3>
          <div className="grid grid-cols-1 gap-4">
            <div className="p-8 border rounded-[2.5rem] flex items-center justify-between bg-slate-50/50">
              <div>
                <div className="text-lg font-bold">Self-Healing Automation</div>
                <div className="text-xs text-slate-400">Allow the agent to autonomously fix shell execution errors.</div>
              </div>
              <button onClick={() => setSelfHealing(!selfHealing)} className={`w-16 h-8 rounded-full p-1 transition-all ${selfHealing ? 'bg-red-600' : 'bg-slate-200'}`}>
                <div className={`w-6 h-6 bg-white rounded-full transition-transform ${selfHealing ? 'translate-x-8' : 'translate-x-0'}`}></div>
              </button>
            </div>
            
            <div className="p-8 border rounded-[2.5rem] flex items-center justify-between opacity-50 cursor-not-allowed">
              <div>
                <div className="text-lg font-bold">End-to-End Handshake</div>
                <div className="text-xs text-slate-400">Rotate session tokens every 15 minutes. (Always Active)</div>
              </div>
              <div className="w-16 h-8 bg-slate-900 rounded-full flex items-center justify-center text-[8px] text-white font-black uppercase">Locked</div>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">Transceiver Quality</h3>
          <div className="grid grid-cols-1 gap-4">
            <div className="p-8 border rounded-[2.5rem] flex items-center justify-between bg-white">
              <div>
                <div className="text-lg font-bold">High-Fidelity TTS</div>
                <div className="text-xs text-slate-400">Use 24kHz Kore voice for system notifications.</div>
              </div>
              <button className="px-6 py-2 bg-slate-100 rounded-xl text-[10px] font-black uppercase">High_Res</button>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">Bridge Status</h3>
          <div className="p-8 border rounded-[2.5rem] bg-slate-900 text-white flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold">Relay Connection</span>
              <span className={`text-[10px] font-black uppercase px-3 py-1 rounded-full ${isRelayConnected ? 'bg-green-500 text-black' : 'bg-red-500 text-white'}`}>{isRelayConnected ? 'Active' : 'Offline'}</span>
            </div>
            <div className="flex items-center justify-between border-t border-white/10 pt-4">
              <span className="text-xs font-bold">Architecture Platform</span>
              <span className="text-[10px] font-mono text-white/60">Node.js 20.x Native Bridge</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Settings;
