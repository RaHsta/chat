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
  const animationFrameRef = useRef<number>();
  
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const particlesRef = useRef<Particle[]>([]);

  // 1. Observe Container Resize
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

  // 2. Handle Drawing & Canvas Sizing
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0 || dimensions.height === 0) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Handle High DPI displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    
    // Scale context to match CSS dimensions
    ctx.scale(dpr, dpr);

    // Audio Data Buffer
    let outputDataArray: Uint8Array;
    let inputDataArray: Uint8Array;
    
    // Initialize buffers if analysers exist
    if (outputAnalyser) {
      outputDataArray = new Uint8Array(outputAnalyser.frequencyBinCount);
    }
    if (inputAnalyser) {
      inputDataArray = new Uint8Array(inputAnalyser.frequencyBinCount);
    }

    // Animation State
    const pointsCount = 64; 
    const currentRadii = new Array(pointsCount).fill(0);
    let idleOffset = 0;
    
    const minDim = Math.min(dimensions.width, dimensions.height);
    const maxRadiusBase = minDim * 0.35; 
    
    // Draw Single Glossy Sphere Helper
    const drawGlossyShape = (
      ctx: CanvasRenderingContext2D, 
      cx: number, cy: number, 
      path: Path2D, 
      baseR: number
    ) => {
      // 1. Shadow
      ctx.shadowColor = 'rgba(0,0,0,0.15)';
      ctx.shadowBlur = 40;
      ctx.shadowOffsetY = 20;

      // 2. Main Fill - Black glossy look
      const grad = ctx.createRadialGradient(
        cx - baseR * 0.3, cy - baseR * 0.3, baseR * 0.05,
        cx, cy, baseR * 1.2
      );
      grad.addColorStop(0, '#444444');
      grad.addColorStop(0.3, '#111111');
      grad.addColorStop(1, '#000000');
      
      ctx.fillStyle = grad;
      ctx.fill(path);

      // Reset shadow for reflections
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // 3. Specular Highlights
      ctx.save();
      ctx.clip(path); // Clip highlights to the shape
      
      ctx.globalCompositeOperation = 'source-atop';
      
      // Large Soft Highlight
      ctx.beginPath();
      ctx.ellipse(
         cx - baseR * 0.3, 
         cy - baseR * 0.3, 
         baseR * 0.35, baseR * 0.25, 
         Math.PI / 4, 0, Math.PI * 2
      );
      const hlGrad = ctx.createLinearGradient(
          cx - baseR * 0.5, cy - baseR * 0.5,
          cx, cy
      );
      hlGrad.addColorStop(0, 'rgba(255,255,255,0.4)');
      hlGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hlGrad;
      ctx.fill();
      
      // Sharp Hotspot
      ctx.beginPath();
      ctx.ellipse(
         cx - baseR * 0.35, 
         cy - baseR * 0.35, 
         baseR * 0.08, baseR * 0.05, 
         Math.PI / 4, 0, Math.PI * 2
      );
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.shadowColor = 'rgba(255,255,255,0.6)';
      ctx.shadowBlur = 4;
      ctx.fill();

      // Bottom Rim Light
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.ellipse(
         cx + baseR * 0.2, 
         cy + baseR * 0.3, 
         baseR * 0.4, baseR * 0.15, 
         -Math.PI / 6, 0, Math.PI * 2
      );
      const rimGrad = ctx.createLinearGradient(
          cx, cy + baseR * 0.2,
          cx + baseR * 0.4, cy + baseR * 0.4
      );
      rimGrad.addColorStop(0, 'rgba(255,255,255,0)');
      rimGrad.addColorStop(1, 'rgba(255,255,255,0.2)');
      ctx.fillStyle = rimGrad;
      ctx.fill();
      
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
    };

    const render = () => {
      animationFrameRef.current = requestAnimationFrame(render);
      
      const { width, height } = dimensions;
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      // --- 1. Physics / Frequency Processing ---
      let targetRadii = new Array(pointsCount).fill(0);
      
      if (isActive) {
        // Get data from both analysers
        if (outputAnalyser) outputAnalyser.getByteFrequencyData(outputDataArray);
        if (inputAnalyser) inputAnalyser.getByteFrequencyData(inputDataArray);

        // Mix data: max of input and output to show activity from both sides
        // Focus on vocal range (roughly first 60% of bins)
        const usefulLength = Math.floor((outputDataArray?.length || 0) * 0.6);
        const step = usefulLength / pointsCount;

        for (let i = 0; i < pointsCount; i++) {
           const dataIndex = Math.floor(i * step);
           
           const valOut = outputDataArray ? outputDataArray[dataIndex] : 0;
           const valIn = inputDataArray ? inputDataArray[dataIndex] : 0;
           // Combined volume
           const val = Math.max(valOut, valIn);
           
           // Normalize 0-255 -> 0-1
           const normalized = val / 255;
           
           // Apply a steeper power curve for dramatic "spikes" response
           const boost = Math.pow(normalized, 2.5); // Sharper response
           targetRadii[i] = boost * (maxRadiusBase * 0.8); 
           
           // --- PARTICLE SPAWNING LOGIC ---
           // Lower threshold for spawning + higher randomness = more splashing
           if (boost > 0.3) {
             if (Math.random() < boost * 0.8) {
                const angle = (i / pointsCount) * Math.PI * 2;
                // Add noise to spawn radius so particles come from "inside" or "tips"
                const r = maxRadiusBase * 0.9 + currentRadii[i] + (Math.random() * 10 - 5); 
                
                // Spawn multiple particles for splash effect
                const particleCount = Math.floor(normalized * 4) + 1;
                
                for(let k = 0; k < particleCount; k++) {
                   // Variable size: 20% big chunks (ink), 80% small droplets
                   const isBig = Math.random() > 0.8;
                   const sizeBase = isBig ? 0.35 : 0.08;
                   
                   const pRadius = (Math.random() * sizeBase + 0.05) * maxRadiusBase * (normalized + 0.2);
                   
                   // Explosive velocity - Higher speed for better "separation"
                   const angleSpread = (Math.random() - 0.5) * 0.6;
                   const speed = 6 + Math.random() * 8 + normalized * 15;

                   particlesRef.current.push({
                     x: centerX + Math.cos(angle + angleSpread) * r,
                     y: centerY + Math.sin(angle + angleSpread) * r,
                     vx: Math.cos(angle + angleSpread) * speed,
                     vy: Math.sin(angle + angleSpread) * speed,
                     radius: pRadius,
                     alpha: 1,
                     life: 1.0,
                     maxLife: 1.0
                   });
                }
             }
           }
        }
      } else {
        // IDLE STATE - Gentle breathing
        idleOffset += 0.03;
        for (let i = 0; i < pointsCount; i++) {
           const angle = (i / pointsCount) * Math.PI * 2;
           const noise = Math.sin(angle * 3 + idleOffset) + Math.cos(angle * 5 - idleOffset * 0.5) * 0.5;
           targetRadii[i] = noise * (maxRadiusBase * 0.06);
        }
      }

      // Smooth interpolation (Spring physics)
      // Higher tension = snappier, more "dance" like
      const tension = isActive ? 0.75 : 0.05; 
      
      for (let i = 0; i < pointsCount; i++) {
        currentRadii[i] += (targetRadii[i] - currentRadii[i]) * tension;
      }

      // --- 2. Visuals: Particles ---
      
      // Update Particles
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.015; // Fade out 
        
        // Drag
        p.vx *= 0.95;
        p.vy *= 0.95;
        
        // Gravity for heavy ink feel
        p.vy += 0.25;

        if (p.life <= 0) {
          particlesRef.current.splice(i, 1);
        } else {
          // Draw Particle (Tiny glossy spheres)
          const pPath = new Path2D();
          pPath.arc(p.x, p.y, p.radius * p.life, 0, Math.PI * 2);
          drawGlossyShape(ctx, p.x, p.y, pPath, p.radius * p.life);
        }
      }

      // --- 3. Visuals: Main Blob ---
      
      const points: {x: number, y: number}[] = [];
      const baseRadius = maxRadiusBase * 0.9; 
      
      for (let i = 0; i < pointsCount; i++) {
        const angle = (i / pointsCount) * Math.PI * 2;
        const r = baseRadius + currentRadii[i];
        points.push({
          x: centerX + Math.cos(angle) * r,
          y: centerY + Math.sin(angle) * r
        });
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
      <canvas 
        ref={canvasRef}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
};

export default Visualizer;