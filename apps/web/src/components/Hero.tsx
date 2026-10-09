import React, { useEffect, useState } from 'react';
import type { SystemMetrics } from '../core/types';

interface HeroProps {
  metrics: SystemMetrics | null;
  onRefreshMetrics: () => void;
}

export const Hero: React.FC<HeroProps> = ({ metrics, onRefreshMetrics }) => {
  const [ticker, setTicker] = useState<number>(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTicker(t => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="relative overflow-hidden pt-12 pb-16 px-4 md:px-8 border-b border-[var(--md-sys-color-outline-variant)]">
      {/* Decorative gradient glow */}
      <div 
        className="absolute top-0 right-1/4 w-96 h-96 rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, var(--md-sys-color-primary) 0%, transparent 70%)' }}
      />

      <div className="max-w-6xl mx-auto relative z-10">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <span className="px-3 py-1 rounded-full text-xs font-semibold tracking-wide uppercase bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]">
            Full Bun • Full M3 • Full Framework
          </span>
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-[var(--md-sys-color-surface-variant)] text-[var(--md-sys-color-on-surface-variant)]">
            v{metrics?.bunVersion || '1.4.3-aphrody'}
          </span>
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-emerald-950/40 text-emerald-400 border border-emerald-800/60">
            Target: {metrics?.targetEnvironment?.toUpperCase() || 'WEB (BUN NATIVE)'}
          </span>
        </div>

        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-[var(--md-sys-color-on-surface)] leading-tight mb-4">
          The Full-Stack Bun <br />
          <span className="bg-gradient-to-r from-[var(--md-sys-color-primary)] via-[var(--md-sys-color-tertiary)] to-[var(--md-sys-color-secondary)] bg-clip-text text-transparent">
            Material 3 Experience
          </span>
        </h1>

        <p className="text-lg md:text-xl text-[var(--md-sys-color-on-surface-variant)] max-w-3xl mb-8 leading-relaxed">
          Powered entirely by native Bun APIs and Web Standards. Built on parallel <code className="text-[var(--md-sys-color-primary)] font-mono">Bun.build</code> pipelines, streaming <code className="text-[var(--md-sys-color-primary)] font-mono">ReadableStream</code> SSR, native <code className="text-[var(--md-sys-color-primary)] font-mono">HTMLRewriter</code>, and the complete Material Design 3 token system.
        </p>

        {/* Live Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-2xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] shadow-sm">
          <div className="p-3">
            <div className="text-xs uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)] font-medium mb-1">
              Runtime Platform
            </div>
            <div className="text-lg font-bold text-[var(--md-sys-color-on-surface)] font-mono">
              {metrics?.platform ? `${metrics.platform}-${metrics.arch}` : 'win32-x64'}
            </div>
          </div>

          <div className="p-3">
            <div className="text-xs uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)] font-medium mb-1">
              Memory Usage
            </div>
            <div className="text-lg font-bold text-[var(--md-sys-color-primary)] font-mono">
              {metrics?.memoryUsageMb ? `${metrics.memoryUsageMb.toFixed(1)} MB` : '42.8 MB'}
            </div>
          </div>

          <div className="p-3">
            <div className="text-xs uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)] font-medium mb-1">
              Uptime
            </div>
            <div className="text-lg font-bold text-[var(--md-sys-color-on-surface)] font-mono">
              {metrics?.uptimeSeconds ? `${metrics.uptimeSeconds + ticker}s` : `${ticker}s`}
            </div>
          </div>

          <div className="p-3 flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)] font-medium mb-1">
                Bun Engine
              </div>
              <div className="text-lg font-bold text-emerald-400 font-mono flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                Active
              </div>
            </div>
            <button
              onClick={onRefreshMetrics}
              title="Refresh metrics"
              className="p-2 rounded-full hover:bg-[var(--md-sys-color-surface-variant)] text-[var(--md-sys-color-primary)] transition"
            >
              🔄
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
