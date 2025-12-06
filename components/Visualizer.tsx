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
  
  // Track previous volume for transient detection
  const prevVolRef = useRef<number>(0);

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

    // Audio Data Buffers
    let outputDataArray: Uint8Array;
    let inputDataArray: Uint8Array;
    
    if (outputAnalyser) {
      outputDataArray = new Uint8Array(outputAnalyser.frequencyBinCount);
    }
    if (inputAnalyser) {
      inputDataArray = new Uint8Array(inputAnalyser.frequencyBinCount);
    }

    // Animation Configuration
    const pointsCount = 40; // Fewer points for smoother, more organic liquid curves
    const currentRadii = new Array(pointsCount).fill(0);
    let idleOffset = 0;
    
    const minDim = Math.min(dimensions.width, dimensions.height);
    const maxRadiusBase = minDim * 0.32; 
    
    // Draw Single Glossy Ferrofluid Shape
    const drawGlossyShape = (
      ctx: CanvasRenderingContext2D, 
      cx: number, cy: number, 
      path: Path2D, 
      baseR: number
    ) => {
      // 1. Drop Shadow (Grounding on white)
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 35;
      ctx.shadowOffsetY = 25;

      // 2. Main Body (Deep Black Liquid)
      const grad = ctx.createRadialGradient(
        cx - baseR * 0.3, cy - baseR * 0.4, baseR * 0.05,
        cx, cy, baseR * 1.3
      );
      // Light source top-left
      grad.addColorStop(0, '#4a4a4a');     // Specular hotspot center
      grad.addColorStop(0.15, '#1a1a1a');  // Transition
      grad.addColorStop(0.4, '#000000');   // Deep black body
      grad.addColorStop(1, '#000000');
      
      ctx.fillStyle = grad;
      ctx.fill(path);

      // Reset shadow for internal highlights
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // 3. Surface Reflections (Wet look)
      ctx.save();
      ctx.clip(path);
      
      ctx.globalCompositeOperation = 'source-atop';
      
      // Top-Left Soft Glare (Environment reflection)
      ctx.beginPath();
      ctx.ellipse(
         cx - baseR * 0.3, 
         cy - baseR * 0.3, 
         baseR * 0.4, baseR * 0.25, 
         Math.PI / 4, 0, Math.PI * 2
      );
      const hlGrad = ctx.createLinearGradient(
          cx - baseR * 0.6, cy - baseR * 0.6,
          cx, cy
      );
      hlGrad.addColorStop(0, 'rgba(255,255,255,0.3)');
      hlGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hlGrad;
      ctx.fill();
      
      // Sharp Specular Hotspot (The "shine")
      ctx.beginPath();
      ctx.ellipse(
         cx - baseR * 0.35, 
         cy - baseR * 0.35, 
         baseR * 0.1, baseR * 0.06, 
         Math.PI / 4, 0, Math.PI * 2
      );
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.shadowColor = 'rgba(255,255,255,0.5)';
      ctx.shadowBlur = 5;
      ctx.fill();

      // Bottom Rim Light (Bounce light from white background)
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.ellipse(
         cx + baseR * 0.1, 
         cy + baseR * 0.3, 
         baseR * 0.5, baseR * 0.2, 
         -Math.PI / 8, 0, Math.PI * 2
      );
      const rimGrad = ctx.createLinearGradient(
          cx, cy + baseR * 0.2,
          cx + baseR * 0.3, cy + baseR * 0.5
      );
      rimGrad.addColorStop(0, 'rgba(255,255,255,0)');
      rimGrad.addColorStop(0.5, 'rgba(255,255,255,0.05)');
      rimGrad.addColorStop(1, 'rgba(255,255,255,0.25)');
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

      // --- 1. Physics & Frequency ---
      let targetRadii = new Array(pointsCount).fill(0);
      let globalVolume = 0;
      
      if (isActive) {
        if (outputAnalyser) outputAnalyser.getByteFrequencyData(outputDataArray);
        if (inputAnalyser) inputAnalyser.getByteFrequencyData(inputDataArray);

        const usefulLength = Math.floor((outputDataArray?.length || 0) * 0.5);
        const step = usefulLength / pointsCount;

        for (let i = 0; i < pointsCount; i++) {
           const dataIndex = Math.floor(i * step);
           const valOut = outputDataArray ? outputDataArray[dataIndex] : 0;
           const valIn = inputDataArray ? inputDataArray[dataIndex] : 0;
           const val = Math.max(valOut, valIn);
           
           globalVolume += val;
           const normalized = val / 255;
           
           // Responsive, organic spikes
           const boost = Math.pow(normalized, 2.5); 
           targetRadii[i] = boost * (maxRadiusBase * 0.7); 
        }
        
        globalVolume = globalVolume / pointsCount / 255;

        // --- Transient Detection (Splashes) ---
        const volDelta = globalVolume - prevVolRef.current;
        const isTransient = volDelta > 0.08; 
        
        if (isTransient && globalVolume > 0.15) {
           // Reduced count for less visual noise (Fewer bubbles)
           const particleCount = Math.floor(volDelta * 20) + 1; 
           
           for(let k = 0; k < particleCount; k++) {
              const angle = Math.random() * Math.PI * 2;
              const r = maxRadiusBase * (0.9 + globalVolume * 0.3); 
              
              // Ink droplets vs chunks
              const isBig = Math.random() > 0.8;
              const sizeBase = isBig ? 0.3 : 0.08;
              const pRadius = (Math.random() * sizeBase + 0.04) * maxRadiusBase;
              
              // Splash Velocity - Reduced speed to keep them sticking together
              const speed = 4 + Math.random() * 8 + volDelta * 25; 
              
              particlesRef.current.push({
                x: centerX + Math.cos(angle) * r,
                y: centerY + Math.sin(angle) * r,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: pRadius,
                alpha: 1,
                life: 1.0,
                maxLife: 1.0
              });
           }
        }
        prevVolRef.current = globalVolume;

      } else {
        // Idle breathing
        idleOffset += 0.04;
        for (let i = 0; i < pointsCount; i++) {
           const angle = (i / pointsCount) * Math.PI * 2;
           const noise = Math.sin(angle * 3 + idleOffset) + Math.cos(angle * 2 - idleOffset);
           targetRadii[i] = noise * (maxRadiusBase * 0.05);
        }
        prevVolRef.current = 0;
      }

      // Spring Physics (Liquid feel)
      // 0.5 tension = snappy but fluid. Lower values = sludgy.
      const tension = isActive ? 0.5 : 0.05; 
      
      for (let i = 0; i < pointsCount; i++) {
        currentRadii[i] += (targetRadii[i] - currentRadii[i]) * tension;
      }

      // --- 2. Particles ---
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        
        // Cohesion: Stronger pull back to center to keep it contained
        const dx = centerX - p.x;
        const dy = centerY - p.y;
        const distSq = dx*dx + dy*dy;
        const dist = Math.sqrt(distSq);
        
        // Attraction force increases significantly to mimic high surface tension
        const cohesionStrength = 0.002 + (dist / (maxRadiusBase * 300)); 
        p.vx += dx * cohesionStrength;
        p.vy += dy * cohesionStrength;

        // Organic Jitter (Subtle)
        const jitter = 0.3;
        p.x += (Math.random() - 0.5) * jitter;
        p.y += (Math.random() - 0.5) * jitter;

        p.x += p.vx;
        p.y += p.vy;
        
        p.life -= 0.012;
        
        // Viscosity/Drag - High drag to make it thick/less flying around
        p.vx *= 0.85;
        p.vy *= 0.85;
        
        // Gravity (slight downward drift)
        p.vy += 0.1;
        
        // --- Boundary Check (Keep INK inside) ---
        // Bounce off walls to keep fluids within viewable area
        if (p.x - p.radius < 0) {
            p.x = p.radius;
            p.vx *= -0.7; // Dampened bounce
        }
        if (p.x + p.radius > width) {
            p.x = width - p.radius;
            p.vx *= -0.7;
        }
        if (p.y - p.radius < 0) {
            p.y = p.radius;
            p.vy *= -0.7;
        }
        if (p.y + p.radius > height) {
            p.y = height - p.radius;
            p.vy *= -0.7;
        }

        // Shrink as they die
        const currentR = p.radius * Math.max(0, p.life);

        if (p.life <= 0 || currentR < 0.5) {
          particlesRef.current.splice(i, 1);
        } else {
          // Draw Particle
          const pPath = new Path2D();
          pPath.arc(p.x, p.y, currentR, 0, Math.PI * 2);
          drawGlossyShape(ctx, p.x, p.y, pPath, currentR);
        }
      }

      // --- 3. Main Ferrofluid Body ---
      const points: {x: number, y: number}[] = [];
      const baseRadius = maxRadiusBase * 0.85; 
      
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
         
         // Quadratic bezier for smooth organic blob
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