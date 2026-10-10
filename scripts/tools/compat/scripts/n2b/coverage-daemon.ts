#!/usr/bin/env bun
import { pluginStorePath } from "@aphrody/paths";
/**
 * n2b coverage daemon — runs the coverage audit on a schedule.
 *
 * Utilise Bun.cron (in-process, no overlap, ref/unref). Schedule par défaut :
 * hebdomadaire le lundi 04:00 UTC. Override via N2B_COVERAGE_SCHEDULE.
 *
 * Usage :
 *   bun scripts/n2b/coverage-daemon.ts                       # run forever
 *   bun scripts/n2b/coverage-daemon.ts --once                # run once then exit
 *   N2B_COVERAGE_SCHEDULE='@daily' bun scripts/n2b/coverage-daemon.ts
 *
 * Signaux :
 *   SIGTERM / SIGINT → stop gracefully
 */

import { dirname, join, resolve } from "node:path";

const SCRIPT_DIR = dirname(import.meta.path);
// scripts/tools/compat/scripts/n2b -> repository root is five levels up.
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..", "..", "..", "..");
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? pluginStorePath("aphrody");
const COVERAGE_DIR = process.env.N2B_COVERAGE_DIR ?? join(REPO_ROOT, "var/audit/n2b-coverage");
const CHECK_SCRIPT = join(REPO_ROOT, "scripts/audit/compat/scripts/n2b/coverage-check.ts");
const SCHEDULE = process.env.N2B_COVERAGE_SCHEDULE ?? "0 4 * * 1"; // Mon 04:00
const STATE_FILE = join(COVERAGE_DIR, ".daemon-state.json");

const RUN_ONCE = process.argv.includes("--once");

type DaemonState = {
  started_at: string;
  last_run?: string;
  last_status?: "ok" | "failed";
  last_summary?: { plugin_coverage_pct: number; critical_gaps: number };
  runs: number;
};

async function loadState(): Promise<DaemonState> {
  try {
    return await Bun.file(STATE_FILE).json();
  } catch {
    return { started_at: new Date().toISOString(), runs: 0 };
  }
}

async function saveState(s: DaemonState) {
  await Bun.write(STATE_FILE, JSON.stringify(s, null, 2));
}

async function runCheck(): Promise<{ ok: boolean; summary?: any }> {
  console.log(`[${new Date().toISOString()}] coverage check — starting`);
  try {
    const proc = Bun.spawn([process.execPath, CHECK_SCRIPT, "--json"], {
      windowsHide: true,
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "inherit",
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, N2B_COVERAGE_DIR: COVERAGE_DIR },
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) {
      console.error(`[${new Date().toISOString()}] coverage check exited ${code}`);
      return { ok: false };
    }
    const parsed = JSON.parse(out);
    const s = parsed.summary;
    console.log(
      `[${new Date().toISOString()}] coverage=${s.plugin_coverage_pct}% · n2b=${s.n2b_coverage_pct}% · gaps=${s.critical_gaps} · ${s.passed ? "✅" : "❌"}`,
    );
    return { ok: s.passed, summary: s };
  } catch (err) {
    console.error(`[${new Date().toISOString()}] coverage check error`, err);
    return { ok: false };
  }
}

async function tick() {
  const state = await loadState();
  state.runs++;
  state.last_run = new Date().toISOString();
  const { ok, summary } = await runCheck();
  state.last_status = ok ? "ok" : "failed";
  if (summary) state.last_summary = summary;
  await saveState(state);
}

if (RUN_ONCE) {
  await tick();
  process.exit(0);
}

console.log(`[${new Date().toISOString()}] n2b coverage daemon — schedule: ${SCHEDULE}`);
console.log(`  plugin root : ${PLUGIN_ROOT}`);
console.log(`  script      : ${CHECK_SCRIPT}`);

const state = await loadState();
state.started_at = new Date().toISOString();
await saveState(state);

// Schedule via Bun.cron (in-process, no-overlap)
const job = Bun.cron(SCHEDULE, async function () {
  await tick();
});

// Run once at startup
await tick();

// Graceful shutdown
const shutdown = () => {
  console.log(`[${new Date().toISOString()}] shutdown — stopping cron job`);
  job.stop();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log(`[${new Date().toISOString()}] daemon running (${SCHEDULE}). Ctrl+C to stop.`);
