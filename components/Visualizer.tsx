
import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';

interface VisualizerProps {
  outputAnalyser: AnalyserNode | null;
  inputAnalyser: AnalyserNode | null;
  isActive: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  life: number;
  maxLife: number;
}

const Visualizer: React.FC<VisualizerProps> = ({ outputAnalyser, inputAnalyser, isActive }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);
  
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const particlesRef = useRef<Particle[]>([]);
  const prevVolRef = useRef<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (!entries[0]) return;
      const { width, height } = entries[0].contentRect;
      setDimensions({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0 || dimensions.height === 0) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    ctx.scale(dpr, dpr);

    let outputDataArray: Uint8Array;
    let inputDataArray: Uint8Array;
    if (outputAnalyser) outputDataArray = new Uint8Array(outputAnalyser.frequencyBinCount);
    if (inputAnalyser) inputDataArray = new Uint8Array(inputAnalyser.frequencyBinCount);

    const pointsCount = 40; 
    const currentRadii = new Array(pointsCount).fill(0);
    let idleOffset = 0;
    
    const minDim = Math.min(dimensions.width, dimensions.height);
    const maxRadiusBase = minDim * 0.32; 
    
    const drawGlossyShape = (ctx: CanvasRenderingContext2D, cx: number, cy: number, path: Path2D, baseR: number) => {
      ctx.shadowColor = 'rgba(0,0,0,0.15)';
      ctx.shadowBlur = 40;
      ctx.shadowOffsetY = 20;

      const grad = ctx.createRadialGradient(cx - baseR * 0.3, cy - baseR * 0.4, baseR * 0.05, cx, cy, baseR * 1.3);
      grad.addColorStop(0, '#4a4a4a');     
      grad.addColorStop(0.15, '#1a1a1a');  
      grad.addColorStop(0.4, '#000000');   
      grad.addColorStop(1, '#000000');
      
      ctx.fillStyle = grad;
      ctx.fill(path);

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      ctx.save();
      ctx.clip(path);
      ctx.globalCompositeOperation = 'source-atop';
      
      ctx.beginPath();
      ctx.ellipse(cx - baseR * 0.3, cy - baseR * 0.3, baseR * 0.4, baseR * 0.25, Math.PI / 4, 0, Math.PI * 2);
      const hlGrad = ctx.createLinearGradient(cx - baseR * 0.6, cy - baseR * 0.6, cx, cy);
      hlGrad.addColorStop(0, 'rgba(255,255,255,0.25)');
      hlGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hlGrad;
      ctx.fill();
      
      ctx.beginPath();
      ctx.ellipse(cx - baseR * 0.35, cy - baseR * 0.35, baseR * 0.1, baseR * 0.06, Math.PI / 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fill();

      ctx.restore();
    };

    const render = () => {
      animationFrameRef.current = requestAnimationFrame(render);
      const { width, height } = dimensions;
      const centerX = width / 2;
      const centerY = height / 2;
      ctx.clearRect(0, 0, width, height);

      let targetRadii = new Array(pointsCount).fill(0);
      let globalVolume = 0;
      
      if (isActive) {
        if (outputAnalyser) outputAnalyser.getByteFrequencyData(outputDataArray);
        if (inputAnalyser) inputAnalyser.getByteFrequencyData(inputDataArray);

        const usefulLength = Math.floor((outputDataArray?.length || 0) * 0.5);
        const step = usefulLength / pointsCount;
        for (let i = 0; i < pointsCount; i++) {
           const dataIndex = Math.floor(i * step);
           const val = Math.max(outputDataArray ? outputDataArray[dataIndex] : 0, inputDataArray ? inputDataArray[dataIndex] : 0);
           globalVolume += val;
           // Square the value for more aggressive peaks
           targetRadii[i] = Math.pow(val / 255, 2.0) * (maxRadiusBase * 0.9); 
        }
        globalVolume = globalVolume / pointsCount / 255;

        const volDelta = globalVolume - prevVolRef.current;
        // More sensitive threshold for splatter
        if (volDelta > 0.04 && globalVolume > 0.1) {
           const count = Math.floor(volDelta * 25) + 2; 
           for(let k = 0; k < count; k++) {
              const angle = Math.random() * Math.PI * 2;
              const r = maxRadiusBase * (0.8 + globalVolume * 0.2);
              const pRad = (Math.random() * 0.15 + 0.03) * maxRadiusBase;
              particlesRef.current.push({
                x: centerX + Math.cos(angle) * r,
                y: centerY + Math.sin(angle) * r,
                vx: Math.cos(angle) * (6 + Math.random() * 8 + volDelta * 25),
                vy: Math.sin(angle) * (6 + Math.random() * 8 + volDelta * 25),
                radius: pRad,
                alpha: 1,
                life: 1.0 + Math.random() * 0.5,
                maxLife: 1.0
              });
           }
        }
        prevVolRef.current = globalVolume;
      } else {
        idleOffset += 0.035;
        for (let i = 0; i < pointsCount; i++) {
           const angle = (i / pointsCount) * Math.PI * 2;
           targetRadii[i] = (Math.sin(angle * 3 + idleOffset) + Math.cos(angle * 2 - idleOffset)) * (maxRadiusBase * 0.04);
        }
        prevVolRef.current = 0;
      }

      for (let i = 0; i < pointsCount; i++) {
        currentRadii[i] += (targetRadii[i] - currentRadii[i]) * (isActive ? 0.4 : 0.06);
      }

      // --- Enhanced Particle Physics ---
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        const dx = centerX - p.x;
        const dy = centerY - p.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        // Cohesion: Attraction force to center
        const cohesion = 1.5 / (dist + 2); 
        p.vx += dx * cohesion;
        p.vy += dy * cohesion;

        // Dynamic Viscosity: Damping varies based on movement
        const damping = 0.92;
        p.vx *= damping;
        p.vy *= damping;

        // Turbulence
        p.vx += (Math.random() - 0.5) * 0.5;
        p.vy += (Math.random() - 0.5) * 0.5;

        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.015;
        
        const currentR = p.radius * Math.max(0, p.life);
        if (p.life <= 0 || currentR < 0.5) {
          particlesRef.current.splice(i, 1);
        } else {
          const pPath = new Path2D();
          pPath.arc(p.x, p.y, currentR, 0, Math.PI * 2);
          drawGlossyShape(ctx, p.x, p.y, pPath, currentR);
        }
      }

      const points: {x: number, y: number}[] = [];
      const baseRadius = maxRadiusBase * 0.8; 
      for (let i = 0; i < pointsCount; i++) {
        const angle = (i / pointsCount) * Math.PI * 2;
        const r = baseRadius + currentRadii[i];
        points.push({ x: centerX + Math.cos(angle) * r, y: centerY + Math.sin(angle) * r });
      }

      if (points.length > 0) {
         const mainPath = new Path2D();
         const len = points.length;
         const getMid = (idx: number) => {
            const p1 = points[idx % len];
            const p2 = points[(idx + 1) % len];
            return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
         };
         const startMid = getMid(len - 1);
         mainPath.moveTo(startMid.x, startMid.y);
         for (let i = 0; i < len; i++) {
            const p = points[i];
            const mid = getMid(i);
            mainPath.quadraticCurveTo(p.x, p.y, mid.x, mid.y);
         }
         mainPath.closePath();
         drawGlossyShape(ctx, centerX, centerY, mainPath, baseRadius);
      }
    };

    render();
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [dimensions, outputAnalyser, inputAnalyser, isActive]); 

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center">
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

export default Visualizer;
