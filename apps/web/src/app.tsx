// SPDX-License-Identifier: Apache-2.0
import React, { useEffect, useState } from 'react';
import { Hero } from './components/Hero';
import { ThemePicker } from './components/ThemePicker';
import { ApiPlayground } from './components/ApiPlayground';
import { M3Showcase } from './components/M3Showcase';
import { CodebaseExplorer } from './components/CodebaseExplorer';
import { MultiTargetBridge } from './components/MultiTargetBridge';
import { ArcadeGame } from './arcade/ArcadeGame';
import { TemplatesExplorer } from './templates/TemplatesExplorer';
import { DocsHub } from './docs/DocsHub';
import { BenchmarkSuite } from './benchmarks/BenchmarkSuite';
import { FFIExplorer } from './ffi/FFIExplorer';
import type { CodebaseAnalysis, SystemMetrics } from './core/types';

export type NavigationTab =
  | 'overview'
  | 'm3'
  | 'arcade'
  | 'playground'
  | 'templates'
  | 'docs'
  | 'benchmarks'
  | 'bridge';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavigationTab>('overview');
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

  const navItems: { id: NavigationTab; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: '⚡' },
    { id: 'm3', label: 'M3 Design', icon: '🎨' },
    { id: 'arcade', label: 'Arcade (Omar)', icon: '🎮' },
    { id: 'playground', label: 'Bun APIs', icon: '🧪' },
    { id: 'templates', label: 'Templates', icon: '📦' },
    { id: 'docs', label: 'Docs Hub', icon: '📚' },
    { id: 'benchmarks', label: 'Benchmarks', icon: '📊' },
    { id: 'bridge', label: 'Tauri / FFI', icon: '🦀' },
  ];

  return (
    <div className="min-h-screen bg-[var(--md-sys-color-background)] text-[var(--md-sys-color-on-background)] transition-colors duration-200 flex flex-col justify-between">
      {/* Top Header / App Bar */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-[var(--md-sys-color-surface)]/85 border-b border-[var(--md-sys-color-outline-variant)] px-4 md:px-8 py-3">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => setActiveTab('overview')}>
              <span className="text-xl">🌸</span>
              <span className="font-extrabold text-base md:text-lg tracking-tight bg-gradient-to-r from-[var(--md-sys-color-primary)] to-[var(--md-sys-color-tertiary)] bg-clip-text text-transparent">
                APHRODY • UNIFIED WEB
              </span>
            </div>

            <div className="md:hidden flex items-center gap-2">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]">
                Bun {metrics?.bunVersion || '1.4.3'}
              </span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
            {navItems.map(item => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-150 ${
                    isActive
                      ? 'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] shadow-sm'
                      : 'text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container)] hover:text-[var(--md-sys-color-on-surface)]'
                  }`}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Tab Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 md:px-8 py-6">
        {activeTab === 'overview' && (
          <div className="flex flex-col gap-10">
            <Hero metrics={metrics} onRefreshMetrics={fetchMetrics} />
            <ThemePicker />
            <CodebaseExplorer analysis={analysis} />
          </div>
        )}

        {activeTab === 'm3' && (
          <div className="flex flex-col gap-10">
            <ThemePicker />
            <M3Showcase />
          </div>
        )}

        {activeTab === 'arcade' && (
          <div className="flex flex-col gap-6">
            <ArcadeGame />
          </div>
        )}

        {activeTab === 'playground' && (
          <div className="flex flex-col gap-6">
            <ApiPlayground />
          </div>
        )}

        {activeTab === 'templates' && (
          <div className="flex flex-col gap-6">
            <TemplatesExplorer />
          </div>
        )}

        {activeTab === 'docs' && (
          <div className="flex flex-col gap-6">
            <DocsHub />
          </div>
        )}

        {activeTab === 'benchmarks' && (
          <div className="flex flex-col gap-6">
            <BenchmarkSuite />
          </div>
        )}

        {activeTab === 'bridge' && (
          <div className="flex flex-col gap-10">
            <MultiTargetBridge />
            <FFIExplorer />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="py-8 px-4 md:px-8 border-t border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container)] text-center text-xs text-[var(--md-sys-color-on-surface-variant)] space-y-2 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            Aphrody Full Bun Framework • Built with <code className="font-mono text-[var(--md-sys-color-primary)]">Bun.build</code>, <code className="font-mono text-[var(--md-sys-color-primary)]">Bun.serve</code>, and Material 3
          </div>
          <div className="font-mono text-[10px] opacity-75">
            Strict Monorepo Rule: 1 App • 1 CLI • 1 FFI • 1 Server
          </div>
        </div>
      </footer>
    </div>
  );
};
