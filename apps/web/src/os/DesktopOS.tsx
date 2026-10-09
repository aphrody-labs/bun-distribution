// SPDX-License-Identifier: Apache-2.0
import React, { useState, useEffect, useCallback } from 'react';
import { TopBar } from './TopBar';
import { Dock, DOCK_ITEMS } from './Dock';
import { WindowFrame } from './WindowFrame';
import { CommandPalette } from './CommandPalette';
import { BunshTerminalApp } from './apps/BunshTerminalApp';
import { KernelMonitorApp } from './apps/KernelMonitorApp';
import { SpacedriveVfsApp } from './apps/SpacedriveVfsApp';
import { CodexStudioApp } from './apps/CodexStudioApp';
import { AlpinePackageManagerApp } from './apps/AlpinePackageManagerApp';
import { M3FusionStudioApp } from './apps/M3FusionStudioApp';
import { DiagnosticsApp } from './apps/DiagnosticsApp';
import { ArcadeGame } from '../arcade/ArcadeGame';
import { PetCompanion } from './components/PetCompanion';
import { QuickAskBar } from './components/QuickAskBar';
import { applyM3Theme } from '../core/theme';
import type { AppId, WindowState } from './types';
import type { SystemMetrics, CodebaseAnalysis } from '../core/types';

export const DesktopOS: React.FC = () => {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [analysis, setAnalysis] = useState<CodebaseAnalysis | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isDark, setIsDark] = useState(true);
  const [seedColor, setSeedColor] = useState('#8b5cf6');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [quickAskOpen, setQuickAskOpen] = useState(false);
  const [showPet, setShowPet] = useState(true);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [highestZIndex, setHighestZIndex] = useState(12);
  const [activeAppTitle, setActiveAppTitle] = useState('Aphrody OS');

  // Initial Real Aphrody OS Window Configuration
  const [windows, setWindows] = useState<WindowState[]>([
    {
      id: 'kernel-monitor',
      title: 'AphrodyOS Kernel Monitor (Asterinas TCB + Linux Subsystems)',
      icon: 'Ω',
      isOpen: true,
      isMinimized: false,
      isMaximized: false,
      zIndex: 11,
      position: { x: 30, y: 50 },
      size: { width: 780, height: 490 },
    },
    {
      id: 'bunsh',
      title: 'Aphrody Bun Shell (/bin/bunsh)',
      icon: '💻',
      isOpen: true,
      isMinimized: false,
      isMaximized: false,
      zIndex: 12,
      position: { x: 260, y: 110 },
      size: { width: 700, height: 440 },
    },
    {
      id: 'spacedrive',
      title: 'Spacedrive VFS & File Explorer',
      icon: '📁',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      zIndex: 10,
      position: { x: 80, y: 60 },
      size: { width: 880, height: 530 },
    },
    {
      id: 'codex-studio',
      title: 'Codex AI Studio & Agent Mesh',
      icon: '🧠',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      zIndex: 10,
      position: { x: 100, y: 70 },
      size: { width: 920, height: 570 },
    },
    {
      id: 'apk-manager',
      title: 'Aphrody Alpine Package & Container Hub',
      icon: '📦',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      zIndex: 10,
      position: { x: 120, y: 80 },
      size: { width: 840, height: 520 },
    },
    {
      id: 'm3-fusion',
      title: 'M3 Token Fusion Studio (M3 + Tailwind v4 + shadcn)',
      icon: '🎨',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      zIndex: 10,
      position: { x: 140, y: 90 },
      size: { width: 860, height: 540 },
    },
    {
      id: 'diagnostics',
      title: 'Hardware Diagnostics & SIMD Probes',
      icon: '📊',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      zIndex: 10,
      position: { x: 160, y: 100 },
      size: { width: 820, height: 510 },
    },
    {
      id: 'arcade',
      title: 'Dragon Pixel (Crystal Universe)',
      icon: '🎮',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      zIndex: 10,
      position: { x: 180, y: 110 },
      size: { width: 940, height: 600 },
    },
  ]);

  // Audio effects
  const playSound = useCallback((type: 'click' | 'open' | 'close' | 'minimize') => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      const now = audioCtx.currentTime;
      if (type === 'click') {
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.05);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === 'open') {
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(640, now + 0.1);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
      } else if (type === 'close') {
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.08);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      }
    } catch {}
  }, [soundEnabled]);

  // Fetch telemetry
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch('/api/metrics');
        if (res.ok) setMetrics(await res.json());
      } catch {}
    };
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, []);

  // Theme application
  useEffect(() => {
    applyM3Theme(seedColor);
  }, [seedColor]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(prev => !prev);
      }
      if (e.altKey && e.code === 'Space') {
        e.preventDefault();
        setQuickAskOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const focusWindow = (id: AppId) => {
    setWindows(prev => {
      const nextZ = highestZIndex + 1;
      setHighestZIndex(nextZ);
      const target = prev.find(w => w.id === id);
      if (target) setActiveAppTitle(target.title);
      return prev.map(w => (w.id === id ? { ...w, zIndex: nextZ, isMinimized: false } : w));
    });
  };

  const toggleApp = (id: AppId) => {
    setWindows(prev => {
      const win = prev.find(w => w.id === id);
      if (!win) return prev;

      if (!win.isOpen) {
        playSound('open');
        const nextZ = highestZIndex + 1;
        setHighestZIndex(nextZ);
        setActiveAppTitle(win.title);
        return prev.map(w =>
          w.id === id ? { ...w, isOpen: true, isMinimized: false, zIndex: nextZ } : w
        );
      }

      if (win.isMinimized) {
        playSound('open');
        const nextZ = highestZIndex + 1;
        setHighestZIndex(nextZ);
        setActiveAppTitle(win.title);
        return prev.map(w =>
          w.id === id ? { ...w, isMinimized: false, zIndex: nextZ } : w
        );
      }

      if (win.zIndex === highestZIndex) {
        playSound('minimize');
        return prev.map(w => (w.id === id ? { ...w, isMinimized: true } : w));
      } else {
        playSound('click');
        const nextZ = highestZIndex + 1;
        setHighestZIndex(nextZ);
        setActiveAppTitle(win.title);
        return prev.map(w => (w.id === id ? { ...w, zIndex: nextZ } : w));
      }
    });
  };

  const closeWindow = (id: AppId) => {
    playSound('close');
    setWindows(prev => prev.map(w => (w.id === id ? { ...w, isOpen: false } : w)));
  };

  const minimizeWindow = (id: AppId) => {
    playSound('minimize');
    setWindows(prev => prev.map(w => (w.id === id ? { ...w, isMinimized: true } : w)));
  };

  const maximizeWindow = (id: AppId) => {
    playSound('click');
    setWindows(prev =>
      prev.map(w => (w.id === id ? { ...w, isMaximized: !w.isMaximized } : w))
    );
  };

  const updateWindowPos = (id: AppId, pos: { x: number; y: number }) => {
    setWindows(prev => prev.map(w => (w.id === id ? { ...w, position: pos } : w)));
  };

  const updateWindowSize = (id: AppId, size: { width: number; height: number }) => {
    setWindows(prev => prev.map(w => (w.id === id ? { ...w, size } : w)));
  };

  return (
    <div
      className={`fixed inset-0 overflow-hidden select-none font-sans text-[var(--md-sys-color-on-surface)] ${
        isDark ? 'dark' : ''
      }`}
      style={{
        background: isDark
          ? 'radial-gradient(circle at 50% 30%, #151824 0%, #0d0f16 60%, #07080c 100%)'
          : 'radial-gradient(circle at 50% 30%, #f3e8ff 0%, #e0e7ff 50%, #f8fafc 100%)',
      }}
    >
      {/* Top Menu Bar */}
      <TopBar
        metrics={metrics}
        activeAppTitle={activeAppTitle}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        onSetTheme={setSeedColor}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled(!soundEnabled)}
        isDark={isDark}
        onToggleDark={() => setIsDark(!isDark)}
        onOpenAbout={() => setShowAboutModal(true)}
        onOpenApp={toggleApp}
      />

      {/* Main Desktop Canvas Area */}
      <main className="absolute inset-0 top-10 bottom-16 overflow-hidden">
        {/* Windows Rendering */}
        {windows.map(win => {
          if (!win.isOpen) return null;

          return (
            <WindowFrame
              key={win.id}
              window={win}
              onClose={() => closeWindow(win.id)}
              onMinimize={() => minimizeWindow(win.id)}
              onMaximize={() => maximizeWindow(win.id)}
              onFocus={() => focusWindow(win.id)}
              onUpdatePosition={pos => updateWindowPos(win.id, pos)}
              onUpdateSize={size => updateWindowSize(win.id, size)}
            >
              {win.id === 'kernel-monitor' && <KernelMonitorApp />}
              {win.id === 'bunsh' && <BunshTerminalApp onSetTheme={setSeedColor} onOpenApp={toggleApp} />}
              {win.id === 'spacedrive' && <SpacedriveVfsApp />}
              {win.id === 'codex-studio' && <CodexStudioApp />}
              {win.id === 'apk-manager' && <AlpinePackageManagerApp />}
              {win.id === 'm3-fusion' && <M3FusionStudioApp onSetTheme={setSeedColor} currentSeed={seedColor} />}
              {win.id === 'diagnostics' && <DiagnosticsApp />}
              {win.id === 'arcade' && <ArcadeGame />}
            </WindowFrame>
          );
        })}

        {/* Desktop Pet Companion */}
        {showPet && <PetCompanion onLaunchApp={toggleApp} />}
      </main>

      {/* Floating System Dock */}
      <Dock
        windows={windows}
        onToggleApp={toggleApp}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      />

      {/* Spotlight Command Palette (Ctrl/Cmd + K) */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onLaunchApp={toggleApp}
        onSetTheme={setSeedColor}
        onRunBenchmarks={() => toggleApp('diagnostics')}
      />

      {/* Spotlight Quick Ask Bar (Alt + Space) */}
      <QuickAskBar
        isOpen={quickAskOpen}
        onClose={() => setQuickAskOpen(false)}
        onLaunchApp={toggleApp}
      />

      {/* About AphrodyOS Modal */}
      {showAboutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-150">
          <div className="w-[440px] rounded-3xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] shadow-2xl p-6 flex flex-col items-center text-center font-sans">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center text-3xl shadow-lg shadow-purple-500/30 mb-3">
              🌸
            </div>
            <h2 className="text-xl font-black tracking-tight text-[var(--md-sys-color-on-surface)]">
              AphrodyOS
            </h2>
            <div className="text-xs font-mono text-[var(--md-sys-color-primary)] font-semibold mt-0.5">
              Aphrody Alpine Linux v3.24.2 • Kernel 6.18
            </div>

            <div className="w-full bg-[var(--md-sys-color-surface-container-high)] rounded-2xl p-3.5 my-4 text-xs font-mono space-y-1.5 text-left border border-[var(--md-sys-color-outline-variant)]">
              <div className="flex justify-between">
                <span className="text-[var(--md-sys-color-on-surface-variant)]">Kernel Architecture:</span>
                <span className="text-[var(--md-sys-color-on-surface)] font-bold">Asterinas TCB + Linux Subsystems</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--md-sys-color-on-surface-variant)]">Kernel Version:</span>
                <span className="text-[var(--md-sys-color-on-surface)] font-bold">linux-aphrody-v3 6.18.55</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--md-sys-color-on-surface-variant)]">Userland ABI:</span>
                <span className="text-[var(--md-sys-color-on-surface)] font-bold">x86_64-alpine-linux-musl</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--md-sys-color-on-surface-variant)]">SIMD Leaf Overlay:</span>
                <span className="text-emerald-400 font-bold">aphrody-libc 0.1.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--md-sys-color-on-surface-variant)]">Root Shell:</span>
                <span className="text-purple-300 font-bold">/bin/bunsh</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--md-sys-color-on-surface-variant)]">Primary Allocator:</span>
                <span className="text-[var(--md-sys-color-on-surface)] font-bold">mimalloc 2.1 (Arena)</span>
              </div>
            </div>

            <button
              onClick={() => setShowAboutModal(false)}
              className="w-full py-2.5 rounded-full bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] font-bold text-xs shadow-md hover:opacity-90 transition"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
