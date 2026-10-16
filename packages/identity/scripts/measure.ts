// SPDX-License-Identifier: Apache-2.0
// Measures the web pet runtime: bundle size (raw, gzip, brotli) of <aphrody-pet> and of the clock
// alone, import time in a fresh Bun process, cost of one tick. With `--wasm <file>` it measures
// option A too (the crate's clock compiled to wasm32, crates/ui/identity/examples/pet_wasm.rs):
// size, compile + instantiate time, tick cost, and parity on the crate fixture.
//   bun scripts/measure.ts [--wasm path/to/pet_wasm.wasm] [--json]
import { brotliCompressSync, constants } from "node:zlib";
import { join } from "node:path";
import { findWorkspaceRoot } from "@aphrody/paths";
import { resolve as resolveTick } from "../src/runtime";
import type { WebTrack } from "../src/runtime";

const root = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const wasmPath = args.includes("--wasm") ? args[args.indexOf("--wasm") + 1] : undefined;
const asJson = args.includes("--json");

const sizes = (bytes: Uint8Array<ArrayBuffer>) => ({
  raw: bytes.byteLength,
  gzip: Bun.gzipSync(bytes, { level: 9 }).byteLength,
  brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })
    .byteLength,
});

const median = (xs: number[]) =>
  xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)] ?? Number.NaN;

async function bundle(entry: string) {
  const t0 = performance.now();
  const out = await Bun.build({
    entrypoints: [join(root, entry)],
    minify: true,
    target: "browser",
    format: "esm",
  });
  const ms = performance.now() - t0;
  if (!out.success) throw new AggregateError(out.logs, `bun build ${entry}`);
  const code = new Uint8Array(await out.outputs[0]!.arrayBuffer());
  return { entry, buildMs: Math.round(ms), ...sizes(code), code };
}

/** Median wall time of `import()` of a bundle in a fresh Bun process. */
async function importTime(code: Uint8Array, runs = 15): Promise<number> {
  const dir = join(root, "node_modules", ".measure");
  const file = join(dir, "bundle.mjs");
  await Bun.write(file, code);
  const probe = `const t=performance.now();await import(${JSON.stringify(file)});console.log(performance.now()-t)`;
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const p = Bun.spawnSync([process.execPath, "-e", probe], { stderr: "inherit" });
    times.push(Number(p.stdout.toString().trim()));
  }
  return Number(median(times).toFixed(2));
}

const fixture: {
  cases: {
    id: string;
    tracks: Record<string, WebTrack>;
    ticks: [number, string, string | null, number | null, number | null][];
  }[];
} = await Bun.file(join(findWorkspaceRoot(), "crates/ui/identity/tests/fixtures/parite-web.json")).json();
const aphrody = fixture.cases[0]!;

function tickCost(step: (name: string, t: number) => unknown, n = 1_000_000): number {
  const names = Object.keys(aphrody.tracks);
  const t0 = performance.now();
  for (let i = 0; i < n; i++) step(names[i % names.length]!, (i * 37) % 20_000);
  return Number((((performance.now() - t0) * 1e6) / n).toFixed(1));
}

const element = await bundle("src/element.ts");
const clock = await bundle("src/runtime.ts");
const strip = ({ code: _, ...rest }: Awaited<ReturnType<typeof bundle>>) => rest;
const report: Record<string, unknown> = {
  optionB: {
    element: { ...strip(element), importMs: await importTime(element.code) },
    clock: { ...strip(clock), importMs: await importTime(clock.code) },
    tickNs: tickCost((n, t) => resolveTick(aphrody.tracks, n, t)),
  },
};

if (wasmPath) {
  const raw = new Uint8Array(await Bun.file(wasmPath).arrayBuffer());
  const optimised = Bun.which("wasm-opt")
    ? (() => {
        const out = join(root, "node_modules", ".measure", "pet.opt.wasm");
        const r = Bun.spawnSync([
          "wasm-opt",
          "-Oz",
          "--enable-bulk-memory",
          "--enable-nontrapping-float-to-int",
          wasmPath,
          "-o",
          out,
        ]);
        return r.exitCode === 0 ? out : undefined;
      })()
    : undefined;
  const bytes = optimised ? new Uint8Array(await Bun.file(optimised).arrayBuffer()) : raw;
  const compile: number[] = [];
  let instance: WebAssembly.Instance | undefined;
  for (let i = 0; i < 15; i++) {
    const t0 = performance.now();
    // oxlint-disable-next-line no-await-in-loop -- mesure chronométrée : chaque compilation doit être isolée, sans recouvrement
    const module = await WebAssembly.compile(bytes);
    // wasm-bindgen markers pulled in by dependencies (never called by the clock): stubbed.
    const imports: Record<string, Record<string, () => number>> = {};
    for (const imp of WebAssembly.Module.imports(module))
      (imports[imp.module] ??= {})[imp.name] = () => 0;
    // oxlint-disable-next-line no-await-in-loop -- mesure chronométrée : chaque instanciation doit être isolée, sans recouvrement
    instance = await WebAssembly.instantiate(module, imports);
    compile.push(performance.now() - t0);
  }
  const x = instance!.exports as {
    memory: WebAssembly.Memory;
    pet_buffer(n: number): number;
    pet_resolve(n: number, t: number): number;
    pet_track_len(): number;
    pet_delay(): number;
  };
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const step = (name: string, t: number) => {
    const b = enc.encode(name);
    const p = x.pet_buffer(b.length);
    new Uint8Array(x.memory.buffer, p, b.length).set(b);
    const sprite = x.pet_resolve(b.length, t);
    if (sprite < 0) return null;
    const q = x.pet_buffer(0);
    const track = dec.decode(new Uint8Array(x.memory.buffer, q, x.pet_track_len()));
    const delay = x.pet_delay();
    return { track, sprite, delay: delay < 0 ? null : delay };
  };
  let mismatches = 0;
  for (const [t, name, track, sprite, delay] of aphrody.ticks) {
    const r = step(name, t);
    if (
      (r?.track ?? null) !== track ||
      (r?.sprite ?? null) !== sprite ||
      (r?.delay ?? null) !== delay
    )
      mismatches++;
  }
  report.optionA = {
    wasm: { ...sizes(raw), wasmOpt: optimised ? sizes(bytes) : null },
    instantiateMs: Number(median(compile).toFixed(2)),
    tickNs: tickCost(step),
    parity: { ticks: aphrody.ticks.length, mismatches },
  };
}

if (asJson) console.log(JSON.stringify(report, null, 2));
else console.dir(report, { depth: 5 });
