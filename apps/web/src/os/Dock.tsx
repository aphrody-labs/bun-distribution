// SPDX-License-Identifier: Apache-2.0
import React from "react";
import type { AppId, WindowSize, WindowState } from "./types";
import { WASM_APPS } from "./wasm/apps";

export interface DockItemConfig {
  id: AppId;
  title: string;
  icon: string;
  color: string;
  size: WindowSize;
}

interface DockProps {
  windows: WindowState[];
  onToggleApp: (id: AppId) => void;
  onOpenCommandPalette: () => void;
}

export const DOCK_ITEMS: DockItemConfig[] = [
  { id: "bunsh", title: "Bun Shell (bunsh)", icon: "💻", color: "bg-zinc-800", size: { width: 700, height: 440 } },
  {
    id: "kernel-monitor",
    title: "Moniteur système",
    icon: "Ω",
    color: "bg-gradient-to-tr from-purple-700 to-indigo-600",
    size: { width: 780, height: 490 },
  },
  { id: "spacedrive", title: "Spacedrive VFS", icon: "📁", color: "bg-blue-600", size: { width: 880, height: 530 } },
  {
    id: "codex-studio",
    title: "Codex AI Studio",
    icon: "🧠",
    color: "bg-gradient-to-tr from-pink-500 to-purple-600",
    size: { width: 920, height: 570 },
  },
  {
    id: "apk-manager",
    title: "Alpine Package & Container Hub",
    icon: "📦",
    color: "bg-blue-500",
    size: { width: 840, height: 520 },
  },
  {
    id: "m3-fusion",
    title: "M3 Token Fusion Studio",
    icon: "🎨",
    color: "bg-purple-600",
    size: { width: 860, height: 540 },
  },
  {
    id: "diagnostics",
    title: "Hardware Diagnostics & SIMD",
    icon: "📊",
    color: "bg-indigo-600",
    size: { width: 820, height: 510 },
  },
  {
    id: "arcade",
    title: "Dragon Pixel (Crystal Universe)",
    icon: "🎮",
    color: "bg-amber-500",
    size: { width: 940, height: 600 },
  },
  {
    id: "bun-apis",
    title: "Bun API Playground",
    icon: "🧪",
    color: "bg-orange-600",
    size: { width: 900, height: 580 },
  },
  { id: "benchmarks", title: "Bun Benchmarks", icon: "⏱️", color: "bg-teal-600", size: { width: 900, height: 580 } },
  { id: "ffi", title: "YOLO C ABI & bun:ffi", icon: "🔌", color: "bg-slate-600", size: { width: 980, height: 600 } },
  { id: "templates", title: "Templates", icon: "🧩", color: "bg-lime-700", size: { width: 900, height: 560 } },
  { id: "docs", title: "Docs", icon: "📚", color: "bg-cyan-700", size: { width: 900, height: 580 } },
  { id: "bridge", title: "Native Bridge", icon: "🌉", color: "bg-rose-700", size: { width: 760, height: 480 } },
  {
    id: "m3-components",
    title: "M3 Components",
    icon: "🧱",
    color: "bg-violet-700",
    size: { width: 960, height: 600 },
  },
  ...WASM_APPS.map(app => ({ id: app.id, title: app.title, icon: app.icon, color: app.color, size: app.size })),
];

const APP_IDS = new Set<string>(DOCK_ITEMS.map(item => item.id));

export function isAppId(id: string): id is AppId {
  return APP_IDS.has(id);
}

export const Dock: React.FC<DockProps> = ({ windows, onToggleApp, onOpenCommandPalette }) => {
  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 select-none max-w-[calc(100vw-24px)]">
      <div className="flex items-end gap-2 px-4 py-2.5 rounded-3xl bg-[var(--md-sys-color-surface-container)]/90 backdrop-blur-2xl border border-[var(--md-sys-color-outline-variant)] shadow-2xl overflow-x-auto">
        {/* Spotlight launcher button */}
        <button
          onClick={onOpenCommandPalette}
          className="group relative shrink-0 flex flex-col items-center justify-center p-2 rounded-2xl bg-[var(--md-sys-color-surface-container-high)] border border-[var(--md-sys-color-outline-variant)] text-lg hover:-translate-y-1 hover:shadow-lg transition-all duration-150"
          title="Launcher (⌘K)"
        >
          <span>🌸</span>
        </button>

        <div className="w-px h-8 shrink-0 bg-[var(--md-sys-color-outline-variant)] my-auto mx-1" />

        {/* Application Dock Icons */}
        {DOCK_ITEMS.map(item => {
          const win = windows.find(w => w.id === item.id);
          const isOpen = Boolean(win?.isOpen);
          const isMinimized = Boolean(win?.isMinimized);

          return (
            <button
              key={item.id}
              onClick={() => onToggleApp(item.id)}
              title={item.title}
              className="relative shrink-0 flex flex-col items-center justify-center p-1.5 rounded-2xl hover:-translate-y-1 transition-all duration-150 active:scale-95"
            >
              {/* App Icon Container */}
              <div
                className={`w-10 h-10 rounded-2xl flex items-center justify-center text-lg shadow-md border border-white/10 ${item.color}`}
              >
                <span>{item.icon}</span>
              </div>

              {/* Running Status Dot */}
              <div className="h-1.5 flex items-center justify-center mt-1">
                {isOpen && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isMinimized ? "bg-[var(--md-sys-color-outline)]" : "bg-[var(--md-sys-color-primary)]"
                    }`}
                  />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
