import { invoke } from "@aphrody/api/core";
import { MONOREPO_BUN_CATALOG } from "./generated/bun-catalog";

export interface SystemStats {
  readonly os: string;
  readonly arch: string;
  readonly timestamp_ms: number;
}

export interface BenchmarkResult {
  readonly message: string;
  readonly latency_us: number;
}

export async function fetchSystemStats(): Promise<SystemStats> {
  return await invoke<SystemStats>("get_system_stats");
}

export async function executeBenchmark(iterations: number): Promise<BenchmarkResult> {
  return await invoke<BenchmarkResult>("run_benchmark", { iterations });
}

export function initApp(): void {
  const root = document.getElementById("root");
  if (!root) return;

  root.innerHTML = `
    <main class="container" style="font-family: system-ui, -apple-system, sans-serif; max-width: 860px; margin: 0 auto; padding: 2rem 1.5rem; text-align: center; color: #1e293b;">
      <header style="margin-bottom: 2rem;">
        <h1 style="font-size: 2.2rem; font-weight: 800; background: linear-gradient(135deg, #2563eb, #7c3aed); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0 0 0.5rem 0;">
          YOLO Web & Desktop · Tauri 3 + Bun
        </h1>
        <p style="font-size: 0.95rem; color: #64748b; margin: 0;">
          Autonomous Bun-Driven Monorepo · Self-Generating Architecture · Direct Tauri 3 Rust IPC
        </p>
      </header>

      <section style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
        <h2 style="font-size: 1.1rem; margin: 0 0 1rem 0; color: #334155;">Native Rust IPC Greet</h2>
        <div style="display: flex; gap: 0.5rem; justify-content: center;">
          <input id="greet-input" placeholder="Enter a name..." style="padding: 0.6rem 1rem; border-radius: 8px; border: 1px solid #cbd5e1; outline: none; width: 60%; font-size: 0.95rem;" />
          <button id="greet-btn" style="padding: 0.6rem 1.2rem; border-radius: 8px; background: #2563eb; color: #ffffff; border: none; font-weight: 600; cursor: pointer;">Greet</button>
        </div>
        <div id="greet-msg" style="color: #16a34a; font-weight: 600; min-height: 1.5rem; margin-top: 1rem;"></div>
      </section>

      <section style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
        <h2 style="font-size: 1.1rem; margin: 0 0 1rem 0; color: #334155;">System Architecture & Micro-Benchmark</h2>
        <div style="display: flex; gap: 0.5rem; justify-content: center; margin-bottom: 1rem;">
          <button id="stats-btn" style="padding: 0.5rem 1rem; border-radius: 8px; background: #475569; color: #ffffff; border: none; font-weight: 600; cursor: pointer;">Probe Host</button>
          <button id="bench-btn" style="padding: 0.5rem 1rem; border-radius: 8px; background: #7c3aed; color: #ffffff; border: none; font-weight: 600; cursor: pointer;">Run IPC Benchmark (100k)</button>
        </div>
        <pre id="output-box" style="text-align: left; background: #0f172a; color: #38bdf8; padding: 1rem; border-radius: 8px; font-size: 0.85rem; font-family: monospace; overflow-x: auto; min-height: 80px; margin: 0;">Ready</pre>
      </section>

      <section style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); text-align: left;">
        <h2 style="font-size: 1.15rem; margin: 0 0 0.5rem 0; color: #1e293b; display: flex; align-items: center; justify-content: space-between;">
          <span>⚡ Autonomous Bun Upstream Catalog</span>
          <span style="font-size: 0.8rem; background: #e0f2fe; color: #0369a1; padding: 0.2rem 0.6rem; border-radius: 9999px; font-weight: 500;">
            Bun ${MONOREPO_BUN_CATALOG.bunVersion} (${MONOREPO_BUN_CATALOG.bunRevision.slice(0, 8)})
          </span>
        </h2>
        <p style="font-size: 0.85rem; color: #64748b; margin: 0 0 1rem 0;">
          Self-extracted from vendor/bun upstream commit. Generated at ${new Date(MONOREPO_BUN_CATALOG.generatedAt).toLocaleString()}
        </p>

        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 1rem;">
          ${MONOREPO_BUN_CATALOG.capabilities
            .map(
              (c) => `
            <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; background: #f8fafc;">
              <div style="font-weight: 700; color: #0f172a; font-size: 0.95rem; margin-bottom: 0.25rem;">
                ${c.title}
              </div>
              <div style="font-size: 0.8rem; color: #475569; margin-bottom: 0.5rem; line-height: 1.35;">
                ${c.description}
              </div>
              <div style="font-size: 0.75rem; color: #0284c7; font-family: monospace; margin-bottom: 0.5rem;">
                ${c.keyApis.join(" · ")}
              </div>
              <div style="font-size: 0.7rem; color: #94a3b8;">
                📄 ${c.docCount} docs matched in vendor/bun/docs
              </div>
            </div>
          `,
            )
            .join("")}
        </div>
      </section>
    </main>
  `;

  const input = document.getElementById("greet-input") as HTMLInputElement | null;
  const greetBtn = document.getElementById("greet-btn");
  const greetMsg = document.getElementById("greet-msg");
  const statsBtn = document.getElementById("stats-btn");
  const benchBtn = document.getElementById("bench-btn");
  const outputBox = document.getElementById("output-box");

  async function handleGreet() {
    const name = input?.value || "YOLO Developer";
    try {
      const response = await invoke<string>("greet", { name });
      if (greetMsg) greetMsg.textContent = response;
    } catch (err) {
      if (greetMsg) greetMsg.textContent = String(err);
    }
  }

  async function handleStats() {
    try {
      const stats = await fetchSystemStats();
      if (outputBox) {
        outputBox.textContent = JSON.stringify(
          {
            ...stats,
            date: new Date(stats.timestamp_ms).toISOString(),
            runtime: "Tauri 3.0.0-alpha.4 + Bun 1.4.2",
            autonomous_catalog_domains: MONOREPO_BUN_CATALOG.capabilities.length,
          },
          null,
          2,
        );
      }
    } catch (err) {
      if (outputBox) outputBox.textContent = `Error: ${String(err)}`;
    }
  }

  async function handleBench() {
    try {
      if (outputBox) outputBox.textContent = "Computing 100,000 rounds...";
      const t0 = performance.now();
      const res = await executeBenchmark(100_000);
      const roundtripMs = (performance.now() - t0).toFixed(2);
      if (outputBox) {
        outputBox.textContent = JSON.stringify(
          {
            result: res.message,
            kernel_duration_us: `${res.latency_us} µs`,
            ipc_roundtrip_ms: `${roundtripMs} ms`,
          },
          null,
          2,
        );
      }
    } catch (err) {
      if (outputBox) outputBox.textContent = `Error: ${String(err)}`;
    }
  }

  greetBtn?.addEventListener("click", () => void handleGreet());
  input?.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") void handleGreet();
  });
  statsBtn?.addEventListener("click", () => void handleStats());
  benchBtn?.addEventListener("click", () => void handleBench());
}

initApp();
