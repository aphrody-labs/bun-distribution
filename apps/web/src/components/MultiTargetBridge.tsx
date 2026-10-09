// SPDX-License-Identifier: Apache-2.0
import React, { useState, useEffect } from 'react';
import { createBridge, type PlatformTarget } from '../core/platform';

export const MultiTargetBridge: React.FC = () => {
  const [platform, setPlatform] = useState<PlatformTarget>('web');
  const [ipcLog, setIpcLog] = useState<string[]>([]);

  useEffect(() => {
    const bridge = createBridge();
    setPlatform(bridge.target);
    setIpcLog([
      `[init] Platform detected: ${bridge.target}`,
      `[bridge] ${bridge.isTauri ? 'Tauri webview detected (__TAURI_INTERNALS__)' : 'Browser: calls go to POST /api/bridge/<cmd> on the Bun server'}`,
    ]);
  }, []);

  const pingBridge = async () => {
    const bridge = createBridge();
    const timestamp = new Date().toLocaleTimeString();
    try {
      const res = await bridge.invoke<{ status: string; timestamp: number }>('ping', { clientTime: Date.now() });
      setIpcLog(prev => [`[${timestamp}] IPC ping -> ${JSON.stringify(res)}`, ...prev.slice(0, 9)]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setIpcLog(prev => [`[${timestamp}] IPC ping failed: ${message}`, ...prev.slice(0, 9)]);
    }
  };

  return (
    <section className="py-12 px-4 md:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <span className="text-xs uppercase font-bold tracking-widest text-[var(--md-sys-color-primary)]">
            Cross-Platform Unification
          </span>
          <h2 className="text-2xl md:text-3xl font-bold text-[var(--md-sys-color-on-surface)] mt-1">
            🖥️ Platform Bridge (Web • Tauri)
          </h2>
          <p className="text-sm md:text-base text-[var(--md-sys-color-on-surface-variant)] mt-1">
            src/core/platform.ts routes invoke() to Tauri when the page runs in a Tauri webview, otherwise to the Bun server. No Tauri app embeds apps/web yet and no Tauri command named ping is registered, so only the browser path is exercised.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={`p-5 rounded-2xl border transition ${
            platform === 'web'
              ? 'bg-[var(--md-sys-color-primary-container)] border-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary-container)]'
              : 'bg-[var(--md-sys-color-surface-container)] border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface-variant)]'
          }`}>
            <div className="text-2xl mb-2">🌐</div>
            <div className="font-bold text-sm">Bun Web Target</div>
            <div className="text-xs opacity-80 mt-1">
              Calls are POST requests to apps/web/server.ts (Bun.serve), which answers /api/bridge/ping.
            </div>
            {platform === 'web' && <span className="inline-block mt-3 px-2 py-0.5 rounded text-[10px] font-bold bg-white/20">Active Target</span>}
          </div>

          <div className={`p-5 rounded-2xl border transition ${
            platform === 'tauri'
              ? 'bg-[var(--md-sys-color-primary-container)] border-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary-container)]'
              : 'bg-[var(--md-sys-color-surface-container)] border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface-variant)]'
          }`}>
            <div className="text-2xl mb-2">🦀</div>
            <div className="font-bold text-sm">Tauri Desktop Target</div>
            <div className="text-xs opacity-80 mt-1">
              invoke() through <code className="font-mono text-[10px]">window.__TAURI_INTERNALS__</code>. Not wired: no tauri.conf.json serves apps/web/dist.
            </div>
            {platform === 'tauri' && <span className="inline-block mt-3 px-2 py-0.5 rounded text-[10px] font-bold bg-white/20">Active Target</span>}
          </div>

          <div className={`p-5 rounded-2xl border transition ${
            platform === 'native'
              ? 'bg-[var(--md-sys-color-primary-container)] border-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary-container)]'
              : 'bg-[var(--md-sys-color-surface-container)] border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface-variant)]'
          }`}>
            <div className="text-2xl mb-2">📱</div>
            <div className="font-bold text-sm">React Native Target</div>
            <div className="text-xs opacity-80 mt-1">
              Detection only (navigator.product === 'ReactNative'); no React Native project consumes this code.
            </div>
            {platform === 'native' && <span className="inline-block mt-3 px-2 py-0.5 rounded text-[10px] font-bold bg-white/20">Active Target</span>}
          </div>
        </div>

        {/* Live IPC Diagnostic Console */}
        <div className="p-5 rounded-2xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--md-sys-color-on-surface)] flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              Bridge log
            </span>
            <button
              onClick={pingBridge}
              className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] hover:opacity-90 transition active:scale-95 shadow-sm"
            >
              Test Bridge Call
            </button>
          </div>
          <div className="p-3 rounded-xl bg-black/60 border border-white/10 font-mono text-xs text-emerald-400 space-y-1 max-h-40 overflow-y-auto">
            {ipcLog.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
