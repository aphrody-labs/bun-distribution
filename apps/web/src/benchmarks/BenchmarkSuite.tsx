// SPDX-License-Identifier: Apache-2.0
import React, { useState } from "react";

interface LiveBenchmarkResult {
  name: string;
  iterations: number;
  durationMs: number;
  opsPerSec: number;
  environment: "Browser Client" | "Bun Server";
}

function measure(
  name: string,
  iterations: number,
  durationMs: number,
  environment: LiveBenchmarkResult["environment"],
): LiveBenchmarkResult {
  return {
    name,
    iterations,
    durationMs: Math.round(durationMs),
    opsPerSec: Math.round((iterations / durationMs) * 1000),
    environment,
  };
}

/**
 * Micro-benchmarks executed on demand: two in this browser, three on the Bun
 * server (POST /api/benchmarks/run). Nothing is precomputed; the numbers are
 * single runs on the current machine, not comparisons with other runtimes.
 */
export const BenchmarkSuite: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [liveResults, setLiveResults] = useState<LiveBenchmarkResult[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);

  const runLiveBenchmarks = async () => {
    setIsRunning(true);
    setServerError(null);
    const results: LiveBenchmarkResult[] = [];

    try {
      const sampleData = new TextEncoder().encode("Aphrody runtime payload with Web Standards");
      const cryptoIters = 5000;
      const t0 = performance.now();
      for (let i = 0; i < cryptoIters; i++) {
        await crypto.subtle.digest("SHA-256", sampleData);
      }
      results.push(measure("crypto.subtle.digest (SHA-256)", cryptoIters, performance.now() - t0, "Browser Client"));

      const jsonIters = 25000;
      const testObj = { id: 1, name: "Aphrody", framework: "Bun", active: true, metrics: [1, 2, 3, 4, 5] };
      const t2 = performance.now();
      for (let i = 0; i < jsonIters; i++) {
        JSON.parse(JSON.stringify(testObj));
      }
      results.push(measure("JSON.stringify + JSON.parse", jsonIters, performance.now() - t2, "Browser Client"));

      try {
        const res = await fetch("/api/benchmarks/run", { method: "POST" });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const serverData = await res.json();
        if (Array.isArray(serverData.results)) {
          results.push(...serverData.results);
        }
      } catch (error) {
        setServerError(error instanceof Error ? error.message : String(error));
      }

      setLiveResults(results);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold tracking-wider uppercase text-[var(--md-sys-color-primary)]">
            Live Measurements
          </span>
          <h2 className="text-3xl font-black text-[var(--md-sys-color-on-surface)]">Benchmark Runner</h2>
          <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] mt-1 max-w-2xl">
            Runs Web Crypto and JSON loops in this browser, then Bun.Transpiler, Bun.deflateSync and Bun.password.hash
            loops on the Bun server. Single runs on this machine, without warm-up or comparison baseline.
          </p>
        </div>

        <button
          onClick={runLiveBenchmarks}
          disabled={isRunning}
          className="px-6 py-3 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-sm shadow-md transition-transform active:scale-95 disabled:opacity-50 flex items-center gap-2 self-start md:self-auto"
        >
          {isRunning ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Running Benchmarks...</span>
            </>
          ) : (
            <>
              <span>⚡</span>
              <span>Run Benchmarks</span>
            </>
          )}
        </button>
      </div>

      {serverError && (
        <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-800/50 text-xs text-rose-300 font-mono">
          Server benchmarks unavailable: {serverError}
        </div>
      )}

      {liveResults.length === 0 ? (
        <div className="p-12 rounded-3xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] text-center flex flex-col items-center gap-4">
          <span className="text-4xl">⏱️</span>
          <h3 className="text-lg font-bold text-[var(--md-sys-color-on-surface)]">No benchmark executed yet</h3>
          <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] max-w-md">
            Click "Run Benchmarks" to measure on this machine.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {liveResults.map((res, idx) => (
            <div
              key={idx}
              className="p-5 rounded-3xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] flex flex-col justify-between gap-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[var(--md-sys-color-on-surface)]">{res.name}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)] font-semibold">
                  {res.environment}
                </span>
              </div>

              <div className="flex items-baseline justify-between pt-2 border-t border-[var(--md-sys-color-outline-variant)]">
                <div>
                  <span className="text-2xl font-black text-emerald-400 font-mono">
                    {res.opsPerSec.toLocaleString()}
                  </span>
                  <span className="text-xs text-[var(--md-sys-color-on-surface-variant)] ml-1">ops / sec</span>
                </div>

                <div className="text-right text-xs font-mono text-[var(--md-sys-color-on-surface-variant)]">
                  <span>
                    {res.iterations.toLocaleString()} iters in {res.durationMs}ms
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
