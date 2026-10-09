// SPDX-License-Identifier: Apache-2.0
import React, { useState, useEffect, useCallback } from 'react';
import { TopBar } from './TopBar';
import { Dock, DOCK_ITEMS } from './Dock';
import { WindowFrame } from './WindowFrame';
import { CommandPalette } from './CommandPalette';
import { TerminalApp } from './apps/TerminalApp';
import { ArcadeGame } from '../arcade/ArcadeGame';
import { TemplatesExplorer } from '../templates/TemplatesExplorer';
import { DocsHub } from '../docs/DocsHub';
import { BenchmarkSuite } from '../benchmarks/BenchmarkSuite';
import { FFIExplorer } from '../ffi/FFIExplorer';
import { M3Showcase } from '../components/M3Showcase';
import { ApiPlayground } from '../components/ApiPlayground';
import { CodebaseExplorer } from '../components/CodebaseExplorer';
import { MultiTargetBridge } from '../components/MultiTargetBridge';
import { ThemePicker } from '../components/ThemePicker';
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
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [highestZIndex, setHighestZIndex] = useState(10);
  const [activeAppTitle, setActiveAppTitle] = useState('Desktop');

  // Initial Window Layouts
  const [windows, setWindows] = useState<WindowState[]>([
    {
      id: 'terminal',
      title: 'Bun Terminal Shell',
      icon: '💻',
      isOpen: true,
      isMinimized: false,
      isMaximized: false,
      zIndex: 11,
      position: { x: 40, y: 60 },
      size: { width: 680, height: 440 },
    },
    {
      id: 'm3-studio',
      title: 'Material 3 Studio',
      icon: '🎨',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      zIndex: 10,
      position: { x: 120, y: 70 },
      size: { width: 920, height: 580 },
    },
    {
      id: 'arcade',
      title: 'Dragon Pixel (Crystal Universe)',
      icon: '🎮',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      zIndex: 10,
      position: { x: 140, y: 70 },
      size: { width: 980, height: 640 },
    },
    {
      id: 'drive',
      title: 'Codebase Drive & Packages',
      icon: '📁',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      zIndex: 10,
      position: { x: 160, y: 80 },
      size: { width: 880, height: 520 },
    },
    {
      id: 'workbench',
      title: 'Bun Web Standards Workbench',
      icon: '🧪',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      zIndex: 10,
      position: { x: 100, y: 80 },
      size: { width: 860, height: 540 },
    },
    {
      id: 'activity-monitor',
      title: 'Activity Monitor & Benchmarks',
      icon: '📊',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      zIndex: 10,
      position: { x: 150, y: 90 },
      size: { width: 900, height: 560 },
    },
    {
      id: 'templates',
      title: 'Starters & Templates Scaffolder',
      icon: '📦',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      zIndex: 10,
      position: { x: 180, y: 80 },
      size: { width: 920, height: 560 },
    },
    {
      id: 'docs',
      title: 'Documentation & Architecture Hub',
      icon: '📚',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      zIndex: 10,
      position: { x: 130, y: 70 },
      size: { width: 940, height: 600 },
    },
    {
      id: 'bridge',
      title: 'Tauri & FFI Native Bridge',
      icon: '🦀',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      zIndex: 10,
      position: { x: 160, y: 90 },
      size: { width: 900, height: 540 },
    },
  ]);

  // Apply M3 dynamic theme
  const applyTheme = useCallback((seed: string, dark: boolean) => {
    applyM3Theme(seed, dark);
    setSeedColor(seed);
  }, []);

  useEffect(() => {
    applyTheme(seedColor, isDark);
  }, [seedColor, isDark, applyTheme]);

  // Fetch telemetry
  const fetchMetrics = async () => {
    try {
      const res = await fetch('/api/metrics');
      if (res.ok) setMetrics(await res.json());
    } catch {}
  };

  const fetchAnalysis = async () => {
    try {
      const res = await fetch('/api/codebase/scan');
      if (res.ok) setAnalysis(await res.json());
    } catch {}
  };

  useEffect(() => {
    fetchMetrics();
    fetchAnalysis();
    const interval = setInterval(fetchMetrics, 3000);
    return () => clearInterval(interval);
  }, []);

  // Keyboard shortcut listener for Command Palette (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Focus Window
  const focusWindow = (id: AppId) => {
    setHighestZIndex(prev => {
      const newZ = prev + 1;
      setWindows(wins =>
        wins.map(w => {
          if (w.id === id) {
            setActiveAppTitle(w.title);
            return { ...w, zIndex: newZ, isMinimized: false };
          }
          return w;
        })
      );
      return newZ;
    });
  };

  // Toggle App from Dock / Desktop
  const toggleApp = (id: AppId) => {
    const win = windows.find(w => w.id === id);
    if (!win) return;

    if (!win.isOpen) {
      setHighestZIndex(prev => {
        const newZ = prev + 1;
        setWindows(wins =>
          wins.map(w => (w.id === id ? { ...w, isOpen: true, isMinimized: false, zIndex: newZ } : w))
        );
        setActiveAppTitle(win.title);
        return newZ;
      });
    } else if (win.isMinimized) {
      focusWindow(id);
    } else {
      // If already open and top-most, minimize it
      setWindows(wins =>
        wins.map(w => (w.id === id ? { ...w, isMinimized: true } : w))
      );
      setActiveAppTitle('Desktop');
    }
  };

  // Launch App directly
  const launchApp = (id: AppId) => {
    setHighestZIndex(prev => {
      const newZ = prev + 1;
      setWindows(wins =>
        wins.map(w => (w.id === id ? { ...w, isOpen: true, isMinimized: false, zIndex: newZ } : w))
      );
      const target = windows.find(w => w.id === id);
      if (target) setActiveAppTitle(target.title);
      return newZ;
    });
  };

  // Close Window
  const closeWindow = (id: AppId) => {
    setWindows(wins => wins.map(w => (w.id === id ? { ...w, isOpen: false } : w)));
    setActiveAppTitle('Desktop');
  };

  // Minimize Window
  const minimizeWindow = (id: AppId) => {
    setWindows(wins => wins.map(w => (w.id === id ? { ...w, isMinimized: true } : w)));
    setActiveAppTitle('Desktop');
  };

  // Maximize / Restore Toggle
  const toggleMaximize = (id: AppId) => {
    setWindows(wins =>
      wins.map(w => (w.id === id ? { ...w, isMaximized: !w.isMaximized } : w))
    );
  };

  // Position & Size updates
  const updatePosition = (id: AppId, x: number, y: number) => {
    setWindows(wins => wins.map(w => (w.id === id ? { ...w, position: { x, y } } : w)));
  };

  const updateSize = (id: AppId, width: number, height: number) => {
    setWindows(wins => wins.map(w => (w.id === id ? { ...w, size: { width, height } } : w)));
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[var(--md-sys-color-background)] text-[var(--md-sys-color-on-background)] select-none">
      {/* Dynamic Procedural Wallpaper */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-90 transition-colors duration-500">
        <div
          className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full blur-[140px] opacity-35"
          style={{ backgroundColor: seedColor }}
        />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full blur-[160px] opacity-30 bg-emerald-500" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full blur-[180px] opacity-20 bg-blue-600" />
      </div>

      {/* Top Bar */}
      <TopBar
        metrics={metrics}
        activeAppTitle={activeAppTitle}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        onSetTheme={seed => applyTheme(seed, isDark)}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled(!soundEnabled)}
        isDark={isDark}
        onToggleDark={() => {
          const next = !isDark;
          setIsDark(next);
          applyTheme(seedColor, next);
        }}
        onOpenAbout={() => setShowAboutModal(true)}
      />

      {/* Desktop Canvas & Grid Shortcuts */}
      <div className="absolute inset-0 pt-12 pb-24 px-6 overflow-hidden flex flex-col justify-start">
        {/* Desktop Icon Grid */}
        <div className="grid grid-flow-col grid-rows-6 gap-6 w-max">
          {DOCK_ITEMS.map(item => (
            <button
              key={item.id}
              onDoubleClick={() => launchApp(item.id)}
              onClick={() => focusWindow(item.id)}
              className="group flex flex-col items-center gap-1.5 p-2 rounded-2xl hover:bg-white/10 transition-colors focus:bg-white/20 outline-none w-24 text-center cursor-pointer"
            >
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-lg border border-white/20 group-hover:scale-105 transition-transform ${item.color}`}>
                <span>{item.icon}</span>
              </div>
              <span className="text-[11px] font-semibold text-white drop-shadow-md leading-tight line-clamp-2">
                {item.title}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Windows Layer */}
      {windows.map(win => {
        return (
          <WindowFrame
            key={win.id}
            window={win}
            onFocus={() => focusWindow(win.id)}
            onClose={() => closeWindow(win.id)}
            onMinimize={() => minimizeWindow(win.id)}
            onMaximizeToggle={() => toggleMaximize(win.id)}
            onUpdatePosition={(x, y) => updatePosition(win.id, x, y)}
            onUpdateSize={(w, h) => updateSize(win.id, w, h)}
          >
            {win.id === 'terminal' && (
              <TerminalApp
                onSetTheme={seed => applyTheme(seed, isDark)}
                onOpenApp={appId => launchApp(appId as AppId)}
              />
            )}
            {win.id === 'm3-studio' && (
              <div className="p-6 overflow-y-auto h-full space-y-6">
                <ThemePicker />
                <M3Showcase />
              </div>
            )}
            {win.id === 'arcade' && (
              <div className="p-6 overflow-y-auto h-full">
                <ArcadeGame />
              </div>
            )}
            {win.id === 'drive' && (
              <div className="p-6 overflow-y-auto h-full">
                <CodebaseExplorer analysis={analysis} />
              </div>
            )}
            {win.id === 'workbench' && (
              <div className="p-6 overflow-y-auto h-full">
                <ApiPlayground />
              </div>
            )}
            {win.id === 'activity-monitor' && (
              <div className="p-6 overflow-y-auto h-full">
                <BenchmarkSuite />
              </div>
            )}
            {win.id === 'templates' && (
              <div className="p-6 overflow-y-auto h-full">
                <TemplatesExplorer />
              </div>
            )}
            {win.id === 'docs' && (
              <div className="p-6 overflow-y-auto h-full">
                <DocsHub />
              </div>
            )}
            {win.id === 'bridge' && (
              <div className="p-6 overflow-y-auto h-full space-y-8">
                <MultiTargetBridge />
                <FFIExplorer />
              </div>
            )}
          </WindowFrame>
        );
      })}

      {/* Floating Dock */}
      <Dock
        windows={windows}
        onToggleApp={toggleApp}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      />

      {/* Command Palette Spotlight */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onLaunchApp={launchApp}
        onSetTheme={seed => applyTheme(seed, isDark)}
        onRunBenchmarks={() => {}}
      />

      {/* About Aphrody OS Modal */}
      {showAboutModal && (
        <div
          onClick={() => setShowAboutModal(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] shadow-2xl p-6 text-center flex flex-col items-center gap-4"
          >
            <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-pink-500 to-purple-600 flex items-center justify-center text-3xl shadow-lg border border-white/20">
              🌸
            </div>

            <div>
              <h3 className="text-xl font-black text-[var(--md-sys-color-on-surface)]">
                Aphrody WebOS
              </h3>
              <p className="text-xs text-[var(--md-sys-color-primary)] font-bold mt-0.5">
                Version 3.3.8 (Build Bun 1.4.3-aphrody.2)
              </p>
            </div>

            <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] leading-relaxed">
              Complete in-browser operating system demonstrating the full power of native Web APIs, Material Design 3 HCT dynamic theming, and Bun’s ultra-fast WebKit JavaScriptCore runtime.
            </p>

            <div className="w-full p-3 rounded-2xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline-variant)] text-[11px] font-mono text-left space-y-1">
              <div className="flex justify-between">
                <span className="text-[var(--md-sys-color-on-surface-variant)]">Runtime:</span>
                <span className="font-bold text-[var(--md-sys-color-on-surface)]">Bun {metrics?.bunVersion || '1.4.3'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--md-sys-color-on-surface-variant)]">Platform:</span>
                <span className="font-bold text-[var(--md-sys-color-on-surface)]">{metrics?.platform || 'win32'}-{metrics?.arch || 'x64'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--md-sys-color-on-surface-variant)]">Architecture:</span>
                <span className="font-bold text-emerald-400">1 App • 1 FFI • 1 CLI • 1 Server</span>
              </div>
            </div>

            <button
              onClick={() => setShowAboutModal(false)}
              className="px-6 py-2 rounded-full bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] font-bold text-xs"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
