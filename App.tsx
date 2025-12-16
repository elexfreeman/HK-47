
import React, { useEffect, useRef } from 'react';
import { useLiveSession } from './hooks/useLiveSession';
import { Visualizer } from './components/Visualizer';
import { RobotFace } from './components/RobotFace';
import { ConnectionState } from './types';

const App: React.FC = () => {
  const { status, connect, disconnect, logs, volume, currentEmotion, isRecording } = useLiveSession();
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const isConnected = status === ConnectionState.CONNECTED;
  const isConnecting = status === ConnectionState.CONNECTING;

  return (
    <div className="h-screen w-full flex flex-col p-2 relative overflow-hidden bg-[#050505]">
      
      {/* Background Grid */}
      <div className="absolute inset-0 pointer-events-none z-0 opacity-10" 
        style={{ 
          backgroundImage: 'linear-gradient(#331100 1px, transparent 1px), linear-gradient(90deg, #331100 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }}
      ></div>

      {/* Header - Compact */}
      <header className="flex-none flex justify-between items-end border-b border-red-900 pb-2 mb-2 z-10">
        <div>
          <h1 className="text-2xl md:text-4xl font-bold text-red-600 tracking-widest drop-shadow-[0_0_10px_rgba(255,0,0,0.5)]">
            HK-47
          </h1>
          <p className="text-[10px] md:text-xs text-red-800 tracking-[0.2em]">ASSASSIN DROID INTERFACE // VER 2.5</p>
        </div>
        <div className="text-right">
            <div className={`text-xs md:text-sm ${isConnected ? 'text-green-500' : 'text-red-500'} font-bold`}>
                STATUS: {status}
            </div>
            <div className="text-[10px] text-red-900 hidden md:block">
                PROTOCOL: {isConnected ? 'ACTIVE' : 'STANDBY'}
            </div>
        </div>
      </header>

      {/* Main Content Area - Flex on Mobile, Grid on Desktop */}
      {/* min-h-0 is crucial for nested flex scrolling/sizing to work */}
      <main className="flex-grow flex flex-col md:grid md:grid-cols-2 gap-2 min-h-0 z-10 mb-2 relative">
        
        {/* Face Panel: Grows to fill space on mobile */}
        <div className="flex-grow md:flex-auto relative border-2 border-red-900/50 bg-black/80 rounded-lg p-1 shadow-[0_0_30px_rgba(255,0,0,0.1)] overflow-hidden">
            <div className="absolute top-2 left-3 text-[10px] text-red-800 z-20">VISUAL RECEPTORS</div>
            <RobotFace 
              emotion={currentEmotion} 
              isActive={isConnected} 
              volume={volume} 
              isRecording={isRecording}
            />
        </div>

        {/* Visualizer & Controls Panel: Fixed height on mobile, full height on desktop */}
        <div className="flex-none h-40 md:h-auto md:flex md:flex-col md:space-y-2 flex flex-col space-y-2 shrink-0">
             {/* Visualizer */}
             <div className="flex-grow relative border-2 border-red-900/50 bg-black/80 rounded-lg overflow-hidden min-h-0">
                <div className="absolute top-1 right-2 text-[8px] md:text-[10px] text-red-800 z-10">AUDIO ANALYZER</div>
                <Visualizer isActive={isConnected} volume={volume} />
             </div>

             {/* Controls */}
             <div className="h-12 md:h-16 flex-none">
                {!isConnected ? (
                    <button
                        onClick={connect}
                        disabled={isConnecting}
                        className={`w-full h-full bg-red-900/20 border border-red-600 text-red-500 hover:bg-red-600 hover:text-black transition-all duration-200 uppercase tracking-widest font-bold text-sm md:text-lg ${isConnecting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {isConnecting ? 'INITIALIZING...' : 'INITIATE PROTOCOL'}
                    </button>
                ) : (
                    <button
                        onClick={disconnect}
                        className="w-full h-full bg-red-950/50 border border-red-800 text-red-800 hover:bg-red-900 hover:text-red-200 transition-all duration-200 uppercase tracking-widest font-bold text-sm md:text-lg"
                    >
                        TERMINATE LINK
                    </button>
                )}
             </div>
        </div>
      </main>

      {/* Logs Panel - Fixed height at bottom */}
      <div className="h-32 md:h-48 flex-none border border-red-900/30 bg-black/60 p-2 overflow-hidden flex flex-col z-10 rounded shrink-0">
        <div className="text-[10px] text-red-700 mb-1 border-b border-red-900/30 pb-1 flex justify-between shrink-0">
            <span>SYSTEM LOG</span>
            <span>ENCRYPTION: NONE</span>
        </div>
        <div ref={logContainerRef} className="flex-grow overflow-y-auto font-mono text-[10px] md:text-xs space-y-1 p-1">
            {logs.length === 0 && <span className="text-red-900/50 italic">Waiting for input...</span>}
            {logs.map((log, i) => (
                <div key={i} className="flex space-x-2 border-l-2 border-transparent hover:border-red-900/50 pl-1 transition-colors">
                    <span className="text-red-900 shrink-0 hidden md:inline">[{log.timestamp}]</span>
                    <span className={`
                        ${log.type === 'error' ? 'text-red-500 font-bold' : ''}
                        ${log.type === 'success' ? 'text-green-600' : ''}
                        ${log.type === 'info' && log.sender === 'HK-47' ? 'text-red-400' : ''}
                        ${log.type === 'info' && log.sender === 'MEATBAG' ? 'text-orange-300' : ''}
                    `}>
                        <span className="opacity-50 mr-1">{log.sender === 'MEATBAG' ? '>>' : '<<'}</span>
                        {log.message}
                    </span>
                </div>
            ))}
        </div>
      </div>
      
      {/* Footer */}
      <footer className="flex-none w-full text-center text-[8px] md:text-[10px] text-red-900/40 mt-1 z-10">
        MANUFACTURED BY CZERKA CORPORATION // UNAUTHORIZED MODIFICATIONS DETECTED
      </footer>
    </div>
  );
};

export default App;
