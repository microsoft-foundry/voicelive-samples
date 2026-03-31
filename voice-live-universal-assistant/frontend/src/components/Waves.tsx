import React, { useRef, useEffect, useCallback } from 'react';
import { useTheme } from '../hooks/useTheme';

interface WavesProps {
  paused?: boolean;
}

interface WaveConfig {
  amplitude: number;
  frequency: number;
  speed: number;
  colorDark: string;
  colorLight: string;
  baseHeight: number;
  verticalAmplitude: number;
  parallaxFactor: number;
}

const verticalFreq = 0.02;
const heightScale = 1;
const phase = 0;
const verticalPhase = 0;

const WAVES: WaveConfig[] = [
  { amplitude: 20, frequency: 0.004, speed: 0.02,  colorDark: 'hsla(0, 0%, 40%, 0.2)', colorLight: 'hsla(0, 0%, 60%, 0.2)', baseHeight: 0.9,  verticalAmplitude: 8,  parallaxFactor: 1   },
  { amplitude: 15, frequency: 0.007, speed: 0.015, colorDark: 'hsla(0, 0%, 30%, 0.2)', colorLight: 'hsla(0, 0%, 70%, 0.2)', baseHeight: 0.71, verticalAmplitude: 12, parallaxFactor: 0.7 },
  { amplitude: 12, frequency: 0.01,  speed: 0.01,  colorDark: 'hsla(0, 0%, 20%, 0.2)', colorLight: 'hsla(0, 0%, 80%, 0.2)', baseHeight: 0.6,  verticalAmplitude: 15, parallaxFactor: 0.4 },
];

export const Waves: React.FC<WavesProps> = ({ paused = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef(0);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const drawWave = useCallback((ctx: CanvasRenderingContext2D, wave: WaveConfig, canvasWidth: number, canvasHeight: number, time: number, dark: boolean) => {
    const verticalOffset = wave.verticalAmplitude * Math.sin(time * verticalFreq * wave.parallaxFactor + verticalPhase);
    ctx.fillStyle = dark ? wave.colorDark : wave.colorLight;
    ctx.beginPath();
    ctx.moveTo(0, canvasHeight);
    const steps = Math.ceil(canvasWidth);
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * canvasWidth;
      const wavePos = x * wave.frequency + time * wave.speed * wave.parallaxFactor + phase;
      const waveHeight = Math.sin(wavePos) * wave.amplitude * heightScale;
      const y = canvasHeight * wave.baseHeight + verticalOffset * wave.parallaxFactor + waveHeight;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineTo(canvasWidth, canvasHeight);
    ctx.lineTo(0, canvasHeight);
    ctx.closePath();
    ctx.fill();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;

    const initAnimation = () => {
      const rect = container.getBoundingClientRect();
      if (rect) { canvas.width = rect.width; canvas.height = rect.height; }
      lastFrameRef.current = performance.now();
      timeRef.current = 0;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      animate();
    };

    const animate = () => {
      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) return;
      const now = performance.now();
      const deltaTime = (now - lastFrameRef.current) / 1000;
      lastFrameRef.current = now;
      timeRef.current += deltaTime * 50;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const reversed = [...WAVES].reverse();
      for (const wave of reversed) drawWave(ctx, wave, canvas.width, canvas.height, timeRef.current, isDark);
      if (!paused) rafRef.current = requestAnimationFrame(animate);
    };

    initAnimation();
    const resizeObserver = new ResizeObserver(() => initAnimation());
    resizeObserver.observe(container);

    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); resizeObserver.disconnect(); };
  }, [paused, drawWave, isDark]);

  return <canvas ref={canvasRef} aria-hidden style={{ width: '100%', height: '100%' }} />;
};
