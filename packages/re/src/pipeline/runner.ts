// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AdapterInfo, PipelineOptions, PipelineReport, Stage } from "./contract.ts";

const EXE = process.platform === "win32" ? "bunre-pipeline.exe" : "bunre-pipeline";

/** Bun OS checkout root: BUN_OS_ROOT or the nearest ancestor holding AGENTS.md and crates/. */
export function findRoot(from = process.cwd()): string | undefined {
  if (process.env.BUN_OS_ROOT && existsSync(process.env.BUN_OS_ROOT)) return process.env.BUN_OS_ROOT;
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "AGENTS.md")) && existsSync(join(dir, "crates"))) return dir;
    const up = resolve(dir, "..");
    if (up === dir) return undefined;
    dir = up;
  }
}

/** Locate the Rust pipeline binary: BUNRE_PIPELINE_BIN, then target/{release,debug} via Bun.Glob, then PATH. */
export async function findBinary(): Promise<string> {
  const env = process.env.BUNRE_PIPELINE_BIN;
  if (env && existsSync(env)) return env;
  const root = findRoot();
  const roots = [
    process.env.CARGO_TARGET_DIR,
    root && join(root, "target"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Aphrody", "cache", "cargo-target"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "aphrody", "target"),
  ].filter(Boolean) as string[];
  for (const base of roots) {
    for await (const hit of new Bun.Glob(`{release,debug}/${EXE}`).scan({
      cwd: base,
      absolute: true,
    }))
      return hit;
  }
  const onPath = Bun.which("bunre-pipeline");
  if (onPath) return onPath;
  throw new Error(
    "bunre-pipeline not found. Build it with scripts/build/rust/cargo-serial.sh build --release -p bun-re --bin bunre-pipeline, " +
      "or set BUNRE_PIPELINE_BIN.",
  );
}

async function exec(args: string[], timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  const bin = await findBinary();
  const proc = Bun.spawn([bin, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { code, out, err };
  } finally {
    clearTimeout(timer);
  }
}

export async function runPipeline(input: string, opts: PipelineOptions): Promise<PipelineReport> {
  const args = ["run", input, "--target", opts.target, "--out", resolve(opts.outdir)];
  if (opts.external) args.push("--external");
  if (opts.trace) args.push("--trace");
  if (opts.maxFunctions) args.push("--max-functions", String(opts.maxFunctions));
  if (opts.maxInsns) args.push("--max-insns", String(opts.maxInsns));
  if (opts.timeoutSecs) args.push("--timeout", String(opts.timeoutSecs));
  const { code, out, err } = await exec(args, ((opts.timeoutSecs ?? 600) * 8 + 60) * 1000);
  if (!out.trim()) throw new Error(`bunre-pipeline exited ${code}: ${err.trim()}`);
  return JSON.parse(out) as PipelineReport;
}

export async function listAdapters(stage?: Stage): Promise<AdapterInfo[]> {
  const { code, out, err } = await exec(stage ? ["adapters", "--stage", stage] : ["adapters"], 60_000);
  if (code !== 0) throw new Error(`bunre-pipeline adapters exited ${code}: ${err.trim()}`);
  return JSON.parse(out) as AdapterInfo[];
}

export async function emitSchemas(dir: string): Promise<void> {
  const { code, err } = await exec(["schema", resolve(dir)], 60_000);
  if (code !== 0) throw new Error(`bunre-pipeline schema exited ${code}: ${err.trim()}`);
}

/** Run several inputs with bounded concurrency; each run is its own process. */
export async function runBatch(
  inputs: string[],
  opts: PipelineOptions,
  concurrency = Math.max(1, Math.min(4, navigator.hardwareConcurrency ?? 2)),
): Promise<PipelineReport[]> {
  const results: PipelineReport[] = [];
  results.length = inputs.length;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
      for (let i = next++; i < inputs.length; i = next++) {
        const tag = Bun.hash(inputs[i]!).toString(16);
        results[i] = await runPipeline(inputs[i]!, {
          ...opts,
          outdir: join(opts.outdir, `${i}-${tag}`),
        });
      }
    }),
  );
  return results;
}
