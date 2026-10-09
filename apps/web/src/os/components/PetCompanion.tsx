// SPDX-License-Identifier: Apache-2.0
import React, { useState, useEffect, useRef } from 'react';
import { sfx } from '../../arcade/audio';

export type PetMood = 'happy' | 'thinking' | 'sleeping' | 'energetic' | 'curious';

interface PetCompanionProps {
  soundEnabled: boolean;
  onOpenApp?: (appId: string) => void;
}

export const PetCompanion: React.FC<PetCompanionProps> = ({ soundEnabled, onOpenApp }) => {
  const [pos, setPos] = useState({ x: 30, y: 140 });
  const [isDragging, setIsDragging] = useState(false);
  const [mood, setMood] = useState<PetMood>('happy');
  const [speech, setSpeech] = useState<string | null>('Hello! Je suis Aphrody Pet 🌸');
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, initialX: 0, initialY: 0 });

  // Floating speech bubble tips
  const tips = [
    'Bun compile apps/web en seulement 92ms ! ⚡',
    'Essaie "neofetch" dans le Terminal 💻',
    'La palette M3 utilise l\'espace colorimétrique HCT 🎨',
    'Dragon Pixel tourne à 60 FPS en WebGPU/Canvas 🎮',
    'Toutes les fenêtres peuvent être déplacées ou agrandies ! 🪟',
    'Appuie sur ⌘K pour ouvrir la Palette de Commandes 🔍',
    '1 Monorepo = 1 App • 1 CLI • 1 FFI • 1 Server 🦀',
  ];

  // Mouse gaze tracking
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const dx = e.clientX - dragStartRef.current.mouseX;
        const dy = e.clientY - dragStartRef.current.mouseY;
        setPos({
          x: Math.max(10, Math.min(window.innerWidth - 120, dragStartRef.current.initialX + dx)),
          y: Math.max(50, Math.min(window.innerHeight - 150, dragStartRef.current.initialY + dy)),
        });
      } else {
        // Calculate gaze angle towards cursor
        const petCenterX = pos.x + 40;
        const petCenterY = pos.y + 40;
        const deltaX = e.clientX - petCenterX;
        const deltaY = e.clientY - petCenterY;
        const dist = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        if (dist > 0 && dist < 500) {
          const clampedX = (deltaX / dist) * Math.min(3, dist / 40);
          const clampedY = (deltaY / dist) * Math.min(3, dist / 40);
          setEyeOffset({ x: clampedX, y: clampedY });
        } else {
          setEyeOffset({ x: 0, y: 0 });
        }
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, pos]);

  // Periodic random idle animations & speech bubble
  useEffect(() => {
    const interval = setInterval(() => {
      const moods: PetMood[] = ['happy', 'curious', 'energetic', 'thinking'];
      const nextMood = moods[Math.floor(Math.random() * moods.length)];
      setMood(nextMood);

      if (Math.random() > 0.4) {
        const randomTip = tips[Math.floor(Math.random() * tips.length)];
        setSpeech(randomTip);
        setTimeout(() => setSpeech(null), 5000);
      }
    }, 12000);
    return () => clearInterval(interval);
  }, []);

  const handleClick = () => {
    if (soundEnabled) sfx.jump();
    setMood('energetic');
    const randomTip = tips[Math.floor(Math.random() * tips.length)];
    setSpeech(randomTip);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialX: pos.x,
      initialY: pos.y,
    };
  };

  return (
    <div
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      className="fixed z-40 select-none flex flex-col items-center cursor-grab active:cursor-grabbing transition-transform hover:scale-105"
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      {/* Speech Bubble */}
      {speech && (
        <div className="mb-2 max-w-[200px] p-2.5 rounded-2xl bg-[var(--md-sys-color-surface-container-highest)]/95 backdrop-blur-md border border-[var(--md-sys-color-outline-variant)] shadow-xl text-[11px] font-medium text-[var(--md-sys-color-on-surface)] text-center animate-in fade-in slide-in-from-bottom-2 duration-150">
          {speech}
          <div className="w-2.5 h-2.5 bg-[var(--md-sys-color-surface-container-highest)] border-b border-r border-[var(--md-sys-color-outline-variant)] rotate-45 mx-auto -mb-3.5 mt-1" />
        </div>
      )}

      {/* Pet Character Body (Material 3 SVG Pet) */}
      <div className="relative w-20 h-20 flex items-center justify-center filter drop-shadow-xl">
        <svg viewBox="0 0 100 100" className="w-full h-full">
          {/* Ki Aura */}
          {mood === 'energetic' && (
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="rgba(255, 235, 59, 0.25)"
              className="animate-ping"
            />
          )}

          {/* Outer Body Glow */}
          <circle
            cx="50"
            cy="52"
            r="38"
            fill="var(--md-sys-color-primary-container)"
            stroke="var(--md-sys-color-primary)"
            strokeWidth="3"
          />

          {/* Cheeks */}
          <ellipse cx="28" cy="56" rx="5" ry="3" fill="#f43f5e" opacity="0.6" />
          <ellipse cx="72" cy="56" rx="5" ry="3" fill="#f43f5e" opacity="0.6" />

          {/* Big Anime Eyes with Gaze Tracking */}
          <g transform={`translate(${eyeOffset.x}, ${eyeOffset.y})`}>
            {/* Left Eye */}
            <circle cx="36" cy="46" r="8" fill="#1e1e2e" />
            <circle cx="34" cy="43" r="3" fill="#ffffff" />
            <circle cx="38" cy="48" r="1.5" fill="#ffffff" />

            {/* Right Eye */}
            <circle cx="64" cy="46" r="8" fill="#1e1e2e" />
            <circle cx="62" cy="43" r="3" fill="#ffffff" />
            <circle cx="66" cy="48" r="1.5" fill="#ffffff" />
          </g>

          {/* Cute Mouth */}
          {mood === 'happy' || mood === 'energetic' ? (
            <path
              d="M 44 56 Q 50 63 56 56"
              fill="none"
              stroke="var(--md-sys-color-on-primary-container)"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          ) : (
            <ellipse cx="50" cy="57" rx="3" ry="3" fill="var(--md-sys-color-on-primary-container)" />
          )}

          {/* Sakura Blossom Ribbon */}
          <circle cx="68" cy="24" r="8" fill="#f472b6" />
          <circle cx="68" cy="24" r="3" fill="#fbbf24" />
        </svg>

        {/* Status Indicator Badge */}
        <span className="absolute bottom-0 right-1 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-white shadow-sm" />
      </div>
    </div>
  );
};
