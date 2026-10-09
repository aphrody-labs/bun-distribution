// SPDX-License-Identifier: Apache-2.0
import React, { useState, useEffect } from 'react';
import type { SystemMetrics } from '../core/types';

interface TopBarProps {
  metrics: SystemMetrics | null;
  activeAppTitle?: string;
  onOpenCommandPalette: () => void;
  onSetTheme: (seed: string) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  isDark: boolean;
  onToggleDark: () => void;
  onOpenAbout: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  metrics,
  activeAppTitle = 'Desktop',
  onOpenCommandPalette,
  onSetTheme,
  soundEnabled,
  onToggleSound,
  isDark,
  onToggleDark,
  onOpenAbout,
}) => {
  const [timeStr, setTimeStr] = useState('');
  const [showAppleMenu, setShowAppleMenu] = useState(false);
  const [showThemeMenu, setShowThemeMenu] = useState(false);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const colorPresets = [
    { name: 'Emerald', seed: '#10b981', color: 'bg-emerald-500' },
    { name: 'Sapphire', seed: '#3b82f6', color: 'bg-blue-500' },
    { name: 'Amber', seed: '#f59e0b', color: 'bg-amber-500' },
    { name: 'Rose', seed: '#f43f5e', color: 'bg-rose-500' },
    { name: 'Violet', seed: '#8b5cf6', color: 'bg-purple-500' },
  ];

  return (
    <header className="fixed top-0 left-0 right-0 h-10 z-50 backdrop-blur-2xl bg-[var(--md-sys-color-surface)]/85 border-b border-[var(--md-sys-color-outline-variant)] px-4 flex items-center justify-between text-xs select-none">
      {/* Left: Brand & Active Application */}
      <div className="flex items-center gap-3 relative">
        <button
          onClick={() => setShowAppleMenu(!showAppleMenu)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-primary)] font-black text-sm transition"
        >
          <span>🌸</span>
          <span className="hidden sm:inline font-extrabold tracking-tight">AphrodyOS</span>
        </button>

        {showAppleMenu && (
          <div className="absolute top-9 left-0 w-56 rounded-2xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] shadow-2xl p-1.5 flex flex-col gap-0.5 z-50 animate-in fade-in zoom-in-95 duration-100">
            <button
              onClick={() => {
                setShowAppleMenu(false);
                onOpenAbout();
              }}
              className="px-3 py-1.5 rounded-xl text-left text-xs font-semibold hover:bg-[var(--md-sys-color-primary-container)] hover:text-[var(--md-sys-color-on-primary-container)] transition text-[var(--md-sys-color-on-surface)]"
            >
              ℹ️ About Aphrody OS
            </button>
            <button
              onClick={() => {
                setShowAppleMenu(false);
                onOpenCommandPalette();
              }}
              className="px-3 py-1.5 rounded-xl text-left text-xs font-semibold hover:bg-[var(--md-sys-color-primary-container)] hover:text-[var(--md-sys-color-on-primary-container)] transition text-[var(--md-sys-color-on-surface)] flex justify-between"
            >
              <span>🔍 Command Palette</span>
              <kbd className="font-mono text-[10px] opacity-60">⌘K</kbd>
            </button>
            <div className="h-px bg-[var(--md-sys-color-outline-variant)] my-1" />
            <div className="px-3 py-1 text-[10px] text-[var(--md-sys-color-on-surface-variant)] uppercase font-bold tracking-wider">
              System Specs
            </div>
            <div className="px-3 py-1 text-[11px] font-mono text-[var(--md-sys-color-on-surface-variant)]">
              Kernel: Bun {metrics?.bunVersion || '1.4.3'}
            </div>
            <div className="px-3 py-1 text-[11px] font-mono text-[var(--md-sys-color-on-surface-variant)]">
              Architecture: {metrics?.platform || 'win32'}-{metrics?.arch || 'x64'}
            </div>
          </div>
        )}

        <div className="h-4 w-px bg-[var(--md-sys-color-outline-variant)] hidden sm:block" />

        <span className="font-bold text-[var(--md-sys-color-on-surface)] hidden sm:inline">
          {activeAppTitle}
        </span>
      </div>

      {/* Center: Command Palette Trigger & Digital Clock */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenCommandPalette}
          className="flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--md-sys-color-surface-container)] hover:bg-[var(--md-sys-color-surface-container-high)] border border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface-variant)] transition-colors"
        >
          <span className="text-xs">🔍</span>
          <span className="hidden md:inline text-[11px]">Search & Run...</span>
          <kbd className="hidden sm:inline font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline-variant)]">
            ⌘K
          </kbd>
        </button>

        <span className="font-mono text-xs font-semibold text-[var(--md-sys-color-on-surface)]">
          {timeStr}
        </span>
      </div>

      {/* Right: Live Telemetry, Theme Controls & System Toggles */}
      <div className="flex items-center gap-2 relative">
        {/* Memory RSS Badge */}
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] font-mono text-[11px] text-[var(--md-sys-color-on-surface)]">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>{metrics ? `${metrics.memoryUsageMb.toFixed(1)} MB` : '14.1 MB'}</span>
        </div>

        {/* Dynamic Color Theme Palette Quick Trigger */}
        <div className="relative">
          <button
            onClick={() => setShowThemeMenu(!showThemeMenu)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)] font-semibold text-[11px] hover:opacity-90 transition"
          >
            <span>🎨</span>
            <span className="hidden md:inline">Theme</span>
          </button>

          {showThemeMenu && (
            <div className="absolute top-9 right-0 w-44 rounded-2xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] shadow-2xl p-2 flex flex-col gap-1.5 z-50">
              <span className="text-[10px] font-bold text-[var(--md-sys-color-on-surface-variant)] uppercase px-1">
                Seed Color Palettes
              </span>
              {colorPresets.map(cp => (
                <button
                  key={cp.name}
                  onClick={() => {
                    onSetTheme(cp.seed);
                    setShowThemeMenu(false);
                  }}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-[var(--md-sys-color-surface-container-high)] text-left transition"
                >
                  <span className={`w-3.5 h-3.5 rounded-full ${cp.color}`} />
                  <span className="text-xs font-semibold text-[var(--md-sys-color-on-surface)]">
                    {cp.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sound Toggle */}
        <button
          onClick={onToggleSound}
          className="p-1.5 rounded-full hover:bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] transition"
          title={soundEnabled ? 'Mute Web Audio' : 'Enable Web Audio'}
        >
          {soundEnabled ? '🔊' : '🔇'}
        </button>

        {/* Dark/Light Toggle */}
        <button
          onClick={onToggleDark}
          className="p-1.5 rounded-full hover:bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] transition"
          title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {isDark ? '🌙' : '☀️'}
        </button>
      </div>
    </header>
  );
};
