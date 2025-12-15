import React, { useEffect, useState } from 'react';

interface RobotFaceProps {
  emotion: string;
  isActive: boolean;
  volume: number; // 0 to 1
}

export const RobotFace: React.FC<RobotFaceProps> = ({ emotion, isActive, volume }) => {
  // Eye transforms based on emotion
  const getEyeStyle = () => {
    // Base transformations
    const base = {
      left: { rotate: 0, scaleY: 1, scaleX: 1, y: 0, skew: 0 },
      right: { rotate: 0, scaleY: 1, scaleX: 1, y: 0, skew: 0 },
    };

    switch (emotion) {
      case 'threat':
      case 'angry':
        // Narrow, slanted inwards (more than default) - Maximum aggression
        return {
          left: { rotate: 5, scaleY: 0.7, scaleX: 1.1, y: 5, skew: 10 },
          right: { rotate: -5, scaleY: 0.7, scaleX: 1.1, y: 5, skew: -10 },
        };
      case 'suspicious':
        // Flattened squint
        return {
          left: { rotate: 0, scaleY: 0.3, scaleX: 1.2, y: 0, skew: 20 },
          right: { rotate: 0, scaleY: 0.3, scaleX: 1.2, y: 0, skew: -20 },
        };
      case 'happy': // "Satisfied" -> Wider, brighter, slightly lifted
        return {
          left: { rotate: -5, scaleY: 1.1, scaleX: 1, y: -2, skew: 0 },
          right: { rotate: 5, scaleY: 1.1, scaleX: 1, y: -2, skew: 0 },
        };
      case 'query': // One raised brow
        return {
          left: { rotate: 0, scaleY: 1.2, scaleX: 1, y: -5, skew: -5 },
          right: { rotate: 0, scaleY: 0.6, scaleX: 1, y: 5, skew: 0 },
        };
      case 'refusal': // Tight slits
        return {
          left: { rotate: 15, scaleY: 0.1, scaleX: 1.2, y: 0, skew: 0 },
          right: { rotate: -15, scaleY: 0.1, scaleX: 1.2, y: 0, skew: 0 },
        };
      default: // Neutral - slightly angry by default for HK-47
        return base;
    }
  };

  const style = getEyeStyle();
  
  // Random twitch/glitch effect instead of blink for a more robotic feel
  const [glitch, setGlitch] = useState(false);

  useEffect(() => {
    if (!isActive) return;
    const loop = () => {
      const nextGlitch = Math.random() * 3000 + 500;
      setTimeout(() => {
        setGlitch(true);
        setTimeout(() => setGlitch(false), 50 + Math.random() * 100);
        loop();
      }, nextGlitch);
    };
    loop();
    return () => setGlitch(false);
  }, [isActive]);

  const eyeWidth = 100;
  const eyeHeight = 80;

  // Mouth - Digital waveform line instead of rounded bar
  const mouthWidth = 100 + (volume * 150);
  const mouthHeight = 4 + (volume * 40);
  
  // Color Palette
  const primaryColor = '#ff3300';
  const glowColor = '#ff0000';

  return (
    <div className="w-full h-full bg-[#050505] flex flex-col items-center justify-center relative overflow-hidden rounded-lg border-2 border-[#550000] shadow-[inset_0_0_80px_rgba(255,0,0,0.2)]">
      
      {/* Grid Background */}
      <div className="absolute inset-0 z-0 opacity-20"
        style={{ 
            backgroundImage: `radial-gradient(${primaryColor} 1px, transparent 1px)`,
            backgroundSize: '20px 20px'
        }}
      />
      
      {/* Face Container */}
      <div className={`relative z-10 transition-all duration-300 ${isActive ? 'opacity-100' : 'opacity-20 grayscale'}`}>
        
        {/* Eyes Wrapper */}
        <div className="flex space-x-8 mb-16 items-center justify-center">
            
            {/* Left Eye */}
            <div 
                className="relative transition-all duration-300 ease-out drop-shadow-[0_0_8px_rgba(255,50,0,0.8)]"
                style={{
                    width: eyeWidth,
                    height: eyeHeight,
                    transform: `
                        translateY(${style.left.y}px) 
                        rotate(${style.left.rotate}deg) 
                        scaleX(${style.left.scaleX}) 
                        scaleY(${glitch ? 0.05 : style.left.scaleY}) 
                        skewX(${style.left.skew}deg)
                    `,
                }}
            >
                {/* Triangular Clip Path for Aggressive Look: Top slopes down towards center */}
                <div 
                    className="absolute inset-0 bg-[#ff3300]"
                    style={{
                        clipPath: 'polygon(0 0, 100% 25%, 85% 100%, 15% 100%)',
                    }}
                >
                    {/* Inner Lens / Iris */}
                     <div className="absolute inset-0 bg-white opacity-20"></div>
                     <div className="absolute top-[35%] left-[30%] w-[40%] h-[40%] bg-[#ffcc00] rounded-full blur-[4px]"></div>
                </div>
            </div>

            {/* Right Eye */}
            <div 
                className="relative transition-all duration-300 ease-out drop-shadow-[0_0_8px_rgba(255,50,0,0.8)]"
                style={{
                    width: eyeWidth,
                    height: eyeHeight,
                    transform: `
                        translateY(${style.right.y}px) 
                        rotate(${style.right.rotate}deg) 
                        scaleX(${style.right.scaleX}) 
                        scaleY(${glitch ? 0.05 : style.right.scaleY}) 
                        skewX(${style.right.skew}deg)
                    `,
                }}
            >
                 {/* Triangular Clip Path for Aggressive Look: Top slopes down towards center */}
                <div 
                    className="absolute inset-0 bg-[#ff3300]"
                    style={{
                        clipPath: 'polygon(0 25%, 100% 0, 85% 100%, 15% 100%)', 
                    }}
                >
                     <div className="absolute inset-0 bg-white opacity-20"></div>
                     <div className="absolute top-[35%] right-[30%] w-[40%] h-[40%] bg-[#ffcc00] rounded-full blur-[4px]"></div>
                </div>
            </div>
        </div>

        {/* Mouth - Tech Grille */}
        <div className="h-8 flex items-center justify-center absolute bottom-[-50px] left-0 right-0">
             <div 
                className="bg-[#ff3300]"
                style={{
                    width: `${mouthWidth}px`,
                    height: `${mouthHeight}px`,
                    opacity: isActive ? 0.9 : 0,
                    boxShadow: '0 0 15px #ff3300',
                    clipPath: 'polygon(5% 0, 95% 0, 100% 100%, 0% 100%)', // Angular mouth
                    transition: 'all 0.05s'
                }}
             >
                {/* Teeth/Grille lines - Vertical bars */}
                <div className="w-full h-full" 
                    style={{ 
                        backgroundImage: 'linear-gradient(90deg, transparent 60%, rgba(0,0,0,0.9) 60%)',
                        backgroundSize: '12px 100%' 
                    }}
                ></div>
             </div>
        </div>

      </div>

      {!isActive && (
         <div className="absolute z-30 text-[#ff0000] font-mono tracking-[0.5em] text-sm animate-pulse font-bold bg-black/50 px-4 py-1 border border-red-900">
             SYSTEM OFFLINE
         </div>
      )}
      
       {/* Vignette & Screen Dirt */}
      <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_100px_rgba(0,0,0,0.9)]"></div>
    </div>
  );
};
