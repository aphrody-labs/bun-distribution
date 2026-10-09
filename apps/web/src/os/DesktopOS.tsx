// SPDX-License-Identifier: Apache-2.0
import React, { useState, useEffect, useCallback } from "react";
import { TopBar } from "./TopBar";
import { Dock, DOCK_ITEMS, isAppId } from "./Dock";
import { WindowFrame } from "./WindowFrame";
import { CommandPalette } from "./CommandPalette";
import { BunshTerminalApp } from "./apps/BunshTerminalApp";
import { KernelMonitorApp } from "./apps/KernelMonitorApp";
import { SpacedriveVfsApp } from "./apps/SpacedriveVfsApp";
import { CodexStudioApp } from "./apps/CodexStudioApp";
import { AlpinePackageManagerApp } from "./apps/AlpinePackageManagerApp";
import { M3FusionStudioApp } from "./apps/M3FusionStudioApp";
import { DiagnosticsApp } from "./apps/DiagnosticsApp";
import { ArcadeGame } from "../arcade/ArcadeGame";
import { ApiPlayground } from "../components/ApiPlayground";
import { M3Showcase } from "../components/M3Showcase";
import { MultiTargetBridge } from "../components/MultiTargetBridge";
import { BenchmarkSuite } from "../benchmarks/BenchmarkSuite";
import { FFIExplorer } from "../ffi/FFIExplorer";
import { TemplatesExplorer } from "../templates/TemplatesExplorer";
import { DocsHub } from "../docs/DocsHub";
import { WASM_APPS } from "./wasm/apps";
import { PetCompanion } from "./components/PetCompanion";
import { QuickAskBar } from "./components/QuickAskBar";
import { applyM3Theme } from "../core/theme";
import { formatBytes, formatDuration, UNAVAILABLE, useSystemSnapshot } from "./system-client";
import type { AppId, ToolAppId, WindowState } from "./types";

const OPEN_AT_START = new Set<AppId>(["kernel-monitor", "bunsh"]);

const INITIAL_WINDOWS: WindowState[] = DOCK_ITEMS.map((item, i) => ({
  id: item.id,
  title: item.title,
  icon: item.icon,
  isOpen: OPEN_AT_START.has(item.id),
  isMinimized: false,
  isMaximized: false,
  zIndex: item.id === "bunsh" ? 12 : item.id === "kernel-monitor" ? 11 : 10,
  position: item.id === "bunsh" ? { x: 260, y: 110 } : { x: 30 + (i % 8) * 30, y: 50 + (i % 8) * 20 },
  size: item.size,
}));

const TOOL_APPS: Record<ToolAppId, React.FC> = {
  "bun-apis": ApiPlayground,
  benchmarks: BenchmarkSuite,
  ffi: FFIExplorer,
  templates: TemplatesExplorer,
  docs: DocsHub,
  bridge: MultiTargetBridge,
  "m3-components": M3Showcase,
};

const WASM_COMPONENTS = new Map<AppId, React.FC>(WASM_APPS.map(app => [app.id, app.component]));

export const DesktopOS: React.FC = () => {
  const system = useSystemSnapshot();
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isDark, setIsDark] = useState(true);
  const [seedColor, setSeedColor] = useState("#8b5cf6");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [quickAskOpen, setQuickAskOpen] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [highestZIndex, setHighestZIndex] = useState(12);
  const [activeAppTitle, setActiveAppTitle] = useState("Aphrody OS");
  const [windows, setWindows] = useState<WindowState[]>(INITIAL_WINDOWS);

  const playSound = useCallback(
    (type: "click" | "open" | "close" | "minimize") => {
      if (!soundEnabled) return;
      try {
        const AudioCtx = globalThis.AudioContext ?? (globalThis as any).webkitAudioContext;
        const audioCtx: AudioContext = new AudioCtx();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const now = audioCtx.currentTime;
        const [from, to, volume, duration] =
          type === "open"
            ? [320, 640, 0.12, 0.1]
            : type === "close"
              ? [600, 200, 0.1, 0.08]
              : type === "minimize"
                ? [500, 300, 0.08, 0.06]
                : [440, 880, 0.08, 0.05];
        osc.frequency.setValueAtTime(from, now);
        osc.frequency.exponentialRampToValueAtTime(to, now + duration);
        gain.gain.setValueAtTime(volume, now);
        gain.gain.linearRampToValueAtTime(0.001, now + duration);
        osc.start(now);
        osc.stop(now + duration);
      } catch {
        // No Web Audio in this browser: windows still open, silently.
      }
    },
    [soundEnabled],
  );

  useEffect(() => {
    applyM3Theme(seedColor);
  }, [seedColor]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen(prev => !prev);
      }
      if (e.altKey && e.code === "Space") {
        e.preventDefault();
        setQuickAskOpen(prev => !prev);
      }
    };
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, []);

  const bringToFront = (id: AppId, patch: Partial<WindowState>) => {
    const nextZ = highestZIndex + 1;
    setHighestZIndex(nextZ);
    const win = windows.find(w => w.id === id);
    if (win) setActiveAppTitle(win.title);
    setWindows(prev => prev.map(w => (w.id === id ? { ...w, ...patch, zIndex: nextZ } : w)));
  };

  const focusWindow = (id: AppId) => bringToFront(id, { isMinimized: false });

  /** Opens, raises or minimizes `id`; false when no application has that id. */
  const toggleApp = (id: string): boolean => {
    if (!isAppId(id)) return false;
    const win = windows.find(w => w.id === id)!;
    if (!win.isOpen || win.isMinimized) {
      playSound("open");
      bringToFront(id, { isOpen: true, isMinimized: false });
    } else if (win.zIndex === highestZIndex) {
      playSound("minimize");
      setWindows(prev => prev.map(w => (w.id === id ? { ...w, isMinimized: true } : w)));
    } else {
      playSound("click");
      bringToFront(id, {});
    }
    return true;
  };

  const updateWindow = (id: AppId, patch: Partial<WindowState>) =>
    setWindows(prev => prev.map(w => (w.id === id ? { ...w, ...patch } : w)));

  const renderApp = (id: AppId): React.ReactNode => {
    switch (id) {
      case "kernel-monitor":
        return <KernelMonitorApp />;
      case "bunsh":
        return <BunshTerminalApp onSetTheme={setSeedColor} onOpenApp={toggleApp} />;
      case "spacedrive":
        return <SpacedriveVfsApp />;
      case "codex-studio":
        return <CodexStudioApp />;
      case "apk-manager":
        return <AlpinePackageManagerApp />;
      case "m3-fusion":
        return <M3FusionStudioApp onSetTheme={setSeedColor} currentSeed={seedColor} />;
      case "diagnostics":
        return <DiagnosticsApp />;
      case "arcade":
        return <ArcadeGame />;
    }
    const Wasm = WASM_COMPONENTS.get(id);
    if (Wasm) return <Wasm />;
    const Tool = TOOL_APPS[id as ToolAppId];
    return (
      <div className="h-full overflow-auto p-4">
        <Tool />
      </div>
    );
  };

  const snap = system.snapshot;

  return (
    <div
      className={`fixed inset-0 overflow-hidden select-none font-sans text-[var(--md-sys-color-on-surface)] ${
        isDark ? "dark" : ""
      }`}
      style={{
        background: isDark
          ? "radial-gradient(circle at 50% 30%, #151824 0%, #0d0f16 60%, #07080c 100%)"
          : "radial-gradient(circle at 50% 30%, #f3e8ff 0%, #e0e7ff 50%, #f8fafc 100%)",
      }}
    >
      <TopBar
        system={system}
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

      <main className="absolute inset-0 top-10 bottom-16 overflow-hidden">
        {windows.map(win =>
          win.isOpen ? (
            <WindowFrame
              key={win.id}
              window={win}
              onClose={() => {
                playSound("close");
                updateWindow(win.id, { isOpen: false });
              }}
              onMinimize={() => {
                playSound("minimize");
                updateWindow(win.id, { isMinimized: true });
              }}
              onMaximizeToggle={() => {
                playSound("click");
                updateWindow(win.id, { isMaximized: !win.isMaximized });
              }}
              onFocus={() => focusWindow(win.id)}
              onUpdatePosition={(x, y) => updateWindow(win.id, { position: { x, y } })}
              onUpdateSize={(width, height) => updateWindow(win.id, { size: { width, height } })}
            >
              {renderApp(win.id)}
            </WindowFrame>
          ) : null,
        )}

        <PetCompanion soundEnabled={soundEnabled} onOpenApp={toggleApp} />
      </main>

      <Dock windows={windows} onToggleApp={toggleApp} onOpenCommandPalette={() => setCommandPaletteOpen(true)} />

      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onLaunchApp={toggleApp}
        onSetTheme={setSeedColor}
      />

      <QuickAskBar isOpen={quickAskOpen} onClose={() => setQuickAskOpen(false)} onOpenApp={toggleApp} />

      {showAboutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md">
          <div className="w-[460px] rounded-3xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] shadow-2xl p-6 flex flex-col items-center text-center font-sans">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center text-3xl shadow-lg mb-3">
              🌸
            </div>
            <h2 className="text-xl font-black tracking-tight text-[var(--md-sys-color-on-surface)]">AphrodyOS</h2>
            <div className="text-xs font-mono text-[var(--md-sys-color-primary)] font-semibold mt-0.5">
              {snap ? (snap.linux?.distribution ?? `${snap.host.type} ${snap.host.version}`) : UNAVAILABLE}
            </div>

            <div className="w-full bg-[var(--md-sys-color-surface-container-high)] rounded-2xl p-3.5 my-4 text-xs font-mono space-y-1.5 text-left border border-[var(--md-sys-color-outline-variant)]">
              {(
                [
                  ["Noyau", snap ? `${snap.host.type} ${snap.host.release}` : UNAVAILABLE],
                  [
                    "Architecture",
                    snap ? `${snap.host.platform}-${snap.host.arch} (${snap.host.machine})` : UNAVAILABLE,
                  ],
                  ["Runtime", snap ? `Bun ${snap.runtime.bun} (${snap.runtime.revision.slice(0, 12)})` : UNAVAILABLE],
                  ["CPU", snap ? `${snap.cpu.model ?? UNAVAILABLE} × ${snap.cpu.count}` : UNAVAILABLE],
                  ["Mémoire", snap ? formatBytes(snap.memory.totalBytes) : UNAVAILABLE],
                  ["Uptime hôte", snap ? formatDuration(snap.host.uptimeSeconds) : UNAVAILABLE],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <span className="text-[var(--md-sys-color-on-surface-variant)]">{label}</span>
                  <span className="text-[var(--md-sys-color-on-surface)] font-bold text-right">{value}</span>
                </div>
              ))}
              {system.error && <div className="text-rose-300">{system.error}</div>}
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
