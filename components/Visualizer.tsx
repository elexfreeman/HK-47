import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  isActive: boolean;
  volume: number; // 0 to 1
}

export const Visualizer: React.FC<VisualizerProps> = ({ isActive, volume }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let rotation = 0;

    const draw = () => {
      // Resize
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
      }

      const w = canvas.width;
      const h = canvas.height;
      const centerX = w / 2;
      const centerY = h / 2;
      
      // Clear
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, w, h);
      
      if (!isActive) {
        // Passive scan mode
        ctx.strokeStyle = '#331100';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 50, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.font = '12px Share Tech Mono';
        ctx.fillStyle = '#552200';
        ctx.textAlign = 'center';
        ctx.fillText('STANDBY', centerX, centerY + 5);
        
        animationId = requestAnimationFrame(draw);
        return;
      }

      // Active Mode - HK-47 Eye
      const intensity = Math.max(0.2, volume * 3); // Scale volume
      
      // Outer Ring (Rotating)
      rotation += 0.02;
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(rotation);
      
      ctx.strokeStyle = '#ff4400';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 20]);
      ctx.beginPath();
      ctx.arc(0, 0, 80 + (intensity * 10), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Inner Core (Pulsing)
      const coreRadius = 40 + (intensity * 30);
      
      const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, coreRadius);
      gradient.addColorStop(0, '#ffaa00');
      gradient.addColorStop(0.5, '#ff4400');
      gradient.addColorStop(1, 'transparent');
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, coreRadius, 0, Math.PI * 2);
      ctx.fill();

      // Scan lines
      ctx.strokeStyle = 'rgba(255, 68, 0, 0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      for (let i = 0; i < w; i += 20) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i, h);
          ctx.stroke();
      }

      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => cancelAnimationFrame(animationId);
  }, [isActive, volume]);

  return (
    <canvas 
      ref={canvasRef} 
      className="w-full h-64 border-y border-red-900 bg-black bg-opacity-50"
    />
  );
};
