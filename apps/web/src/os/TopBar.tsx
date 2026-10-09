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
  onOpenApp?: (appId: string) => void;
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
  onOpenApp,
}) => {
  const [timeStr, setTimeStr] = useState('');
  const [dateStr, setDateStr] = useState('');
  const [showAppleMenu, setShowAppleMenu] = useState(false);
  const [showThemeMenu, setShowThemeMenu] = useState(false);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
      setDateStr(
        now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const colorPresets = [
    { name: 'Aphrody Violet', seed: '#8b5cf6', color: 'bg-purple-500' },
    { name: 'Emerald', seed: '#10b981', color: 'bg-emerald-500' },
    { name: 'Sapphire', seed: '#3b82f6', color: 'bg-blue-500' },
    { name: 'Amber', seed: '#f59e0b', color: 'bg-amber-500' },
    { name: 'Rose', seed: '#f43f5e', color: 'bg-rose-500' },
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
          <div className="absolute top-9 left-0 w-64 rounded-2xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] shadow-2xl p-1.5 flex flex-col gap-0.5 z-50 animate-in fade-in zoom-in-95 duration-100 font-sans">
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
                onOpenApp?.('kernel-monitor');
              }}
              className="px-3 py-1.5 rounded-xl text-left text-xs font-semibold hover:bg-[var(--md-sys-color-primary-container)] hover:text-[var(--md-sys-color-on-primary-container)] transition text-[var(--md-sys-color-on-surface)]"
            >
              Ω Kernel Monitor (sysctl, zswap)
            </button>
            <button
              onClick={() => {
                setShowAppleMenu(false);
                onOpenApp?.('bunsh');
              }}
              className="px-3 py-1.5 rounded-xl text-left text-xs font-semibold hover:bg-[var(--md-sys-color-primary-container)] hover:text-[var(--md-sys-color-on-primary-container)] transition text-[var(--md-sys-color-on-surface)]"
            >
              💻 Bun Shell (/bin/bunsh)
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
            <div className="px-3 py-1 text-[10px] text-[var(--md-sys-color-on-surface-variant)] uppercase font-bold tracking-wider font-mono">
              Aphrody Alpine 3.24
            </div>
            <div className="px-3 py-0.5 text-[11px] font-mono text-[var(--md-sys-color-on-surface-variant)]">
              Kernel: linux-aphrody-v3 6.18
            </div>
            <div className="px-3 py-0.5 text-[11px] font-mono text-[var(--md-sys-color-on-surface-variant)]">
              Runtime: Bun {metrics?.bunVersion || '1.4.3'} (musl)
            </div>
          </div>
        )}

        <div className="h-4 w-px bg-[var(--md-sys-color-outline-variant)] hidden sm:block" />

        <div className="flex items-center gap-3">
          <span className="font-bold text-[var(--md-sys-color-on-surface)] hidden sm:inline">
            {activeAppTitle}
          </span>
          <span className="text-[11px] text-[var(--md-sys-color-on-surface-variant)] hidden md:inline hover:text-white cursor-pointer">
            File
          </span>
          <span className="text-[11px] text-[var(--md-sys-color-on-surface-variant)] hidden md:inline hover:text-white cursor-pointer">
            Edit
          </span>
          <span className="text-[11px] text-[var(--md-sys-color-on-surface-variant)] hidden md:inline hover:text-white cursor-pointer">
            View
          </span>
          <span className="text-[11px] text-[var(--md-sys-color-on-surface-variant)] hidden md:inline hover:text-white cursor-pointer">
            Kernel
          </span>
        </div>
      </div>

      {/* Right: Telemetry status pills & Clock */}
      <div className="flex items-center gap-2 font-mono text-[11px]">
        {/* WireGuard Mesh pill */}
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>wg1: 10.42.0.3</span>
        </div>

        {/* ZSwap indicator */}
        <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface-variant)]">
          <span>⚡ ZSwap: Zstd</span>
        </div>

        {/* Memory Usage */}
        {metrics && (
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface)]">
            <span className="text-[var(--md-sys-color-primary)] font-bold">
              {metrics.memoryUsageMb.toFixed(1)} MB
            </span>
          </div>
        )}

        {/* Theme Picker trigger */}
        <div className="relative">
          <button
            onClick={() => setShowThemeMenu(!showThemeMenu)}
            className="p-1.5 rounded-lg hover:bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] transition"
            title="Theme Palette"
          >
            🎨
          </button>

          {showThemeMenu && (
            <div className="absolute top-9 right-0 w-44 rounded-2xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] shadow-2xl p-2 z-50 flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-[var(--md-sys-color-on-surface-variant)] uppercase px-1">
                Dynamic Theme
              </span>
              <div className="grid grid-cols-5 gap-1.5">
                {colorPresets.map(c => (
                  <button
                    key={c.seed}
                    onClick={() => {
                      onSetTheme(c.seed);
                      setShowThemeMenu(false);
                    }}
                    className={`w-6 h-6 rounded-full border border-white/20 hover:scale-110 transition ${c.color}`}
                    title={c.name}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Audio Toggle */}
        <button
          onClick={onToggleSound}
          className="p-1.5 rounded-lg hover:bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] transition"
          title={soundEnabled ? 'Mute SFX' : 'Enable SFX'}
        >
          {soundEnabled ? '🔊' : '🔇'}
        </button>

        {/* Dark/Light mode Toggle */}
        <button
          onClick={onToggleDark}
          className="p-1.5 rounded-lg hover:bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] transition"
          title={isDark ? 'Light Theme' : 'Dark Theme'}
        >
          {isDark ? '🌙' : '☀️'}
        </button>

        {/* Date & Clock */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] font-semibold font-mono">
          <span className="hidden xl:inline text-gray-400">{dateStr}</span>
          <span>{timeStr}</span>
        </div>
      </div>
    </header>
  );
};
