import React, { useEffect, useState } from 'react';
import { Hero } from './components/Hero';
import { ThemePicker } from './components/ThemePicker';
import { ApiPlayground } from './components/ApiPlayground';
import { M3Showcase } from './components/M3Showcase';
import { CodebaseExplorer } from './components/CodebaseExplorer';
import { MultiTargetBridge } from './components/MultiTargetBridge';
import type { CodebaseAnalysis, SystemMetrics } from './core/types';

export const App: React.FC = () => {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [analysis, setAnalysis] = useState<CodebaseAnalysis | null>(null);

  const fetchMetrics = async () => {
    try {
      const res = await fetch('/api/metrics');
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
      }
    } catch {}
  };

  const fetchAnalysis = async () => {
    try {
      const res = await fetch('/api/codebase/scan');
      if (res.ok) {
        const data = await res.json();
        setAnalysis(data);
      }
    } catch {}
  };

  useEffect(() => {
    fetchMetrics();
    fetchAnalysis();
  }, []);

  return (
    <div className="min-h-screen bg-[var(--md-sys-color-background)] text-[var(--md-sys-color-on-background)] transition-colors duration-200">
      {/* Top Header / App Bar */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-[var(--md-sys-color-surface)]/80 border-b border-[var(--md-sys-color-outline-variant)] px-4 md:px-8 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🌸</span>
            <span className="font-extrabold text-base md:text-lg tracking-tight bg-gradient-to-r from-[var(--md-sys-color-primary)] to-[var(--md-sys-color-tertiary)] bg-clip-text text-transparent">
              APHRODY • FULL BUN
            </span>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="https://github.com/aphrody-labs"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold px-3 py-1.5 rounded-full border border-[var(--md-sys-color-outline)] text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-variant)] transition"
            >
              GitHub Monorepo
            </a>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main>
        <Hero metrics={metrics} onRefreshMetrics={fetchMetrics} />

        <div className="max-w-6xl mx-auto px-4 md:px-8 my-8">
          <ThemePicker />
        </div>

        <ApiPlayground />
        <M3Showcase />
        <CodebaseExplorer analysis={analysis} />
        <MultiTargetBridge />
      </main>

      {/* Footer */}
      <footer className="py-8 px-4 md:px-8 border-t border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container)] text-center text-xs text-[var(--md-sys-color-on-surface-variant)] space-y-2">
        <div>
          Aphrody Full Bun Framework • Built with <code className="font-mono text-[var(--md-sys-color-primary)]">Bun.build</code>, <code className="font-mono text-[var(--md-sys-color-primary)]">Bun.serve</code>, and Material 3
        </div>
        <div className="font-mono text-[10px] opacity-75">
          1 Monorepo = 1 App • 1 CLI • 1 FFI • 1 Server
        </div>
      </footer>
    </div>
  );
};
