import React, { useEffect, useRef } from 'react';
import { useLiveSession } from './hooks/useLiveSession';
import { Visualizer } from './components/Visualizer';
import { ConnectionState } from './types';

const App: React.FC = () => {
  const { status, connect, disconnect, logs, volume } = useLiveSession();
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const isConnected = status === ConnectionState.CONNECTED;
  const isConnecting = status === ConnectionState.CONNECTING;

  return (
    <div className="min-h-screen flex flex-col items-center justify-between p-4 relative overflow-hidden">
      
      {/* Background Grid */}
      <div className="absolute inset-0 pointer-events-none z-0 opacity-10" 
        style={{ 
          backgroundImage: 'linear-gradient(#331100 1px, transparent 1px), linear-gradient(90deg, #331100 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }}
      ></div>

      {/* Header */}
      <header className="w-full max-w-2xl border-b border-red-900 pb-4 z-10 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-red-600 tracking-widest drop-shadow-[0_0_10px_rgba(255,0,0,0.5)]">
            HK-47
          </h1>
          <p className="text-xs text-red-800">ASSASSIN DROID INTERFACE // VER 2.5</p>
        </div>
        <div className="text-right">
            <div className={`text-sm ${isConnected ? 'text-green-500' : 'text-red-500'} font-bold`}>
                STATUS: {status}
            </div>
            <div className="text-xs text-red-900">
                PROTOCOL: {isConnected ? 'ACTIVE' : 'STANDBY'}
            </div>
        </div>
      </header>

      {/* Main Visualizer Area */}
      <main className="w-full max-w-2xl flex-grow flex flex-col justify-center items-center py-8 z-10">
        <div className="relative w-full border-2 border-red-900/50 bg-black/80 shadow-[0_0_30px_rgba(255,0,0,0.1)] rounded-lg overflow-hidden">
            <div className="absolute top-2 left-2 text-xs text-red-700">OPTICAL SENSORS</div>
            <div className="absolute top-2 right-2 text-xs text-red-700">AUDIO INPUT</div>
            
            <Visualizer isActive={isConnected} volume={volume} />
            
            <div className="p-4 border-t border-red-900/50 flex justify-center space-x-6">
                {!isConnected ? (
                    <button
                        onClick={connect}
                        disabled={isConnecting}
                        className={`px-8 py-3 bg-red-900/20 border border-red-600 text-red-500 hover:bg-red-600 hover:text-black transition-all duration-200 uppercase tracking-widest font-bold ${isConnecting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {isConnecting ? 'INITIALIZING...' : 'INITIATE PROTOCOL'}
                    </button>
                ) : (
                    <button
                        onClick={disconnect}
                        className="px-8 py-3 bg-red-950/50 border border-red-800 text-red-800 hover:bg-red-900 hover:text-red-200 transition-all duration-200 uppercase tracking-widest font-bold"
                    >
                        TERMINATE LINK
                    </button>
                )}
            </div>
        </div>
      </main>

      {/* Logs */}
      <div className="w-full max-w-2xl h-48 border border-red-900/30 bg-black/60 p-2 overflow-hidden flex flex-col z-10 rounded">
        <div className="text-xs text-red-700 mb-1 border-b border-red-900/30 pb-1 flex justify-between">
            <span>SYSTEM LOG</span>
            <span>ENCRYPTION: NONE</span>
        </div>
        <div ref={logContainerRef} className="flex-grow overflow-y-auto font-mono text-xs space-y-1 p-1">
            {logs.length === 0 && <span className="text-red-900/50 italic">Waiting for input...</span>}
            {logs.map((log, i) => (
                <div key={i} className="flex space-x-2">
                    <span className="text-red-800">[{log.timestamp}]</span>
                    <span className={`
                        ${log.type === 'error' ? 'text-red-500 font-bold' : ''}
                        ${log.type === 'success' ? 'text-green-600' : ''}
                        ${log.type === 'info' && log.sender === 'HK-47' ? 'text-red-400' : ''}
                        ${log.type === 'info' && log.sender === 'MEATBAG' ? 'text-orange-300' : ''}
                    `}>
                        <span className="opacity-50 mr-2">{log.sender === 'MEATBAG' ? '>' : '#'}</span>
                        {log.message}
                    </span>
                </div>
            ))}
        </div>
      </div>
      
      {/* Footer */}
      <footer className="w-full text-center text-[10px] text-red-900/40 mt-4 z-10">
        MANUFACTURED BY CZERKA CORPORATION // UNAUTHORIZED MODIFICATIONS DETECTED
      </footer>
    </div>
  );
};

export default App;
