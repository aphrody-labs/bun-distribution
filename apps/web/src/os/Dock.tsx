// SPDX-License-Identifier: Apache-2.0
import React from 'react';
import type { AppId, WindowState } from './types';

export interface DockItemConfig {
  id: AppId;
  title: string;
  icon: string;
  color: string;
}

interface DockProps {
  windows: WindowState[];
  onToggleApp: (id: AppId) => void;
  onOpenCommandPalette: () => void;
}

export const DOCK_ITEMS: DockItemConfig[] = [
  { id: 'bunsh', title: 'Bun Shell (bunsh)', icon: '💻', color: 'bg-zinc-800' },
  { id: 'kernel-monitor', title: 'Aphrody Kernel Monitor', icon: 'Ω', color: 'bg-gradient-to-tr from-purple-700 to-indigo-600' },
  { id: 'spacedrive', title: 'Spacedrive VFS', icon: '📁', color: 'bg-blue-600' },
  { id: 'codex-studio', title: 'Codex AI Studio', icon: '🧠', color: 'bg-gradient-to-tr from-pink-500 to-purple-600' },
  { id: 'apk-manager', title: 'Alpine Package & Container Hub', icon: '📦', color: 'bg-blue-500' },
  { id: 'm3-fusion', title: 'M3 Token Fusion Studio', icon: '🎨', color: 'bg-purple-600' },
  { id: 'diagnostics', title: 'Hardware Diagnostics & SIMD', icon: '📊', color: 'bg-indigo-600' },
  { id: 'arcade', title: 'Dragon Pixel (Crystal Universe)', icon: '🎮', color: 'bg-amber-500' },
];

export const Dock: React.FC<DockProps> = ({
  windows,
  onToggleApp,
  onOpenCommandPalette,
}) => {
  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 select-none">
      <div className="flex items-end gap-2 px-4 py-2.5 rounded-3xl bg-[var(--md-sys-color-surface-container)]/90 backdrop-blur-2xl border border-[var(--md-sys-color-outline-variant)] shadow-2xl transition-all duration-200 hover:scale-[1.02]">
        {/* Spotlight launcher button */}
        <button
          onClick={onOpenCommandPalette}
          className="group relative flex flex-col items-center justify-center p-2 rounded-2xl bg-[var(--md-sys-color-surface-container-high)] border border-[var(--md-sys-color-outline-variant)] text-lg hover:-translate-y-2 hover:shadow-lg transition-all duration-150"
          title="Spotlight Search"
        >
          <span>🌸</span>
          <span className="absolute -top-8 px-2 py-0.5 rounded-lg bg-[var(--md-sys-color-on-surface)] text-[var(--md-sys-color-surface)] text-[10px] font-bold opacity-0 group-hover:opacity-100 transition whitespace-nowrap pointer-events-none shadow-md">
            Launcher (⌘K)
          </span>
        </button>

        <div className="w-px h-8 bg-[var(--md-sys-color-outline-variant)] my-auto mx-1" />

        {/* Application Dock Icons */}
        {DOCK_ITEMS.map(item => {
          const win = windows.find(w => w.id === item.id);
          const isOpen = Boolean(win?.isOpen);
          const isMinimized = Boolean(win?.isMinimized);

          return (
            <button
              key={item.id}
              onClick={() => onToggleApp(item.id)}
              className="group relative flex flex-col items-center justify-center p-2 rounded-2xl hover:-translate-y-2 hover:scale-110 transition-all duration-150 active:scale-95"
            >
              {/* App Icon Container */}
              <div className={`w-11 h-11 rounded-2xl flex items-center justify-center text-xl shadow-md border border-white/10 ${item.color}`}>
                <span>{item.icon}</span>
              </div>

              {/* Running Status Dot */}
              <div className="h-1.5 flex items-center justify-center mt-1">
                {isOpen && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isMinimized
                        ? 'bg-[var(--md-sys-color-outline)]'
                        : 'bg-[var(--md-sys-color-primary)]'
                    }`}
                  />
                )}
              </div>

              {/* Tooltip */}
              <span className="absolute -top-8 px-2 py-0.5 rounded-lg bg-[var(--md-sys-color-on-surface)] text-[var(--md-sys-color-surface)] text-[10px] font-bold opacity-0 group-hover:opacity-100 transition whitespace-nowrap pointer-events-none shadow-md z-50">
                {item.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
