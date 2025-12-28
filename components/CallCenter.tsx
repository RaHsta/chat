
import React from 'react';

interface CallCenterProps {
  status: 'idle' | 'calling' | 'active' | 'on-hold';
  calls: any[];
  isConnected: boolean;
  onInit: () => void;
}

const CallCenter: React.FC<CallCenterProps> = ({ status, calls, isConnected, onInit }) => {
  return (
    <div className="max-w-6xl mx-auto h-full flex flex-col gap-8">
      <div className="flex items-center justify-between border-b pb-8">
        <div>
          <h2 className="text-4xl font-black tracking-tight">AGENT_CONSOLE</h2>
          <p className="text-slate-400 text-xs mt-1 uppercase font-black tracking-widest">Support Node Alpha-9</p>
        </div>
        <div className="flex gap-4">
           <div className="px-6 py-3 bg-slate-50 border rounded-2xl flex flex-col">
             <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Current Status</span>
             <span className={`text-xs font-black uppercase ${status === 'active' ? 'text-green-600' : 'text-slate-900'}`}>{status}</span>
           </div>
           <div className="px-6 py-3 bg-slate-50 border rounded-2xl flex flex-col">
             <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Call Queue</span>
             <span className="text-xs font-black uppercase text-slate-900">{calls.length} Active</span>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1">
        {/* Call Queue */}
        <div className="lg:col-span-1 bg-slate-50 rounded-[2.5rem] border p-8 flex flex-col gap-6">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Incoming_Transmissions</h3>
          {calls.length === 0 && !isConnected && (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 opacity-40">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
              <span className="text-[10px] font-black uppercase">Offline</span>
              <button onClick={onInit} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase">Enable Node</button>
            </div>
          )}
          {isConnected && (
            <div className="space-y-4">
               <div className="p-5 bg-white border border-green-200 rounded-2xl shadow-sm flex items-center justify-between animate-pulse">
                 <div>
                   <div className="text-[10px] font-black text-green-600">INCOMING CALL</div>
                   <div className="text-sm font-bold">System Maintenance</div>
                 </div>
                 <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-600 text-xs font-black">1</div>
               </div>
            </div>
          )}
        </div>

        {/* Interaction Hub */}
        <div className="lg:col-span-2 bg-white rounded-[2.5rem] border shadow-2xl p-10 flex flex-col gap-10">
           <div className="flex-1 flex flex-col items-center justify-center text-center gap-8">
              <div className={`w-40 h-40 rounded-full border-8 flex items-center justify-center transition-all ${status === 'active' ? 'border-green-100 bg-green-50 scale-110 shadow-2xl' : 'border-slate-100 bg-slate-50'}`}>
                {status === 'active' ? (
                   <div className="flex gap-1 items-end h-8">
                      <div className="w-2 bg-green-500 animate-[bounce_0.6s_infinite_0s]"></div>
                      <div className="w-2 bg-green-500 animate-[bounce_0.6s_infinite_0.1s]"></div>
                      <div className="w-2 bg-green-500 animate-[bounce_0.6s_infinite_0.2s]"></div>
                   </div>
                ) : (
                  <svg className="w-12 h-12 text-slate-200" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/></svg>
                )}
              </div>
              <div className="space-y-2">
                 <h4 className="text-2xl font-black">{status === 'active' ? 'TRANSCEIVER ACTIVE' : 'NODE STANDBY'}</h4>
                 <p className="text-slate-400 text-sm">{status === 'active' ? 'The AI Agent is currently responding to system requests.' : 'Waiting for incoming bridge connection...'}</p>
              </div>
              {status === 'active' && (
                <button className="px-10 py-4 bg-red-600 text-white rounded-[2rem] text-xs font-black uppercase tracking-widest hover:bg-red-700 transition-colors">Terminte Call</button>
              )}
           </div>
        </div>
      </div>
    </div>
  );
};

export default CallCenter;
