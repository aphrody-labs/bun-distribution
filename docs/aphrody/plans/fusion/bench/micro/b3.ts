// Banc B3 : pilote des mesures S3 et S4 (realm et bootstrap.js) et des sondes P1 à P5, Bun (JSC) contre Deno (V8).
//   bun b3.ts --bun <bin> --deno <bin> --src <bootstrap-patched.js> [--processes 5] [--out <dir>]
// Chaque côté est lancé en processus frais, côtés entrelacés (A, B, B, A…), à nice 10. Sortie : <out>/b3-raw.json.
import os from "node:os";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name: string, dflt?: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? dflt : args[i + 1];
};
const BIN = { bun: opt("bun", process.execPath)!, deno: opt("deno", "deno")! };
const SRC = opt("src")!;
const PROCESSES = Number(opt("processes", "5"));
const OUT = opt("out", ".")!;
const DIR = import.meta.dir;
mkdirSync(OUT, { recursive: true });
try {
  os.setPriority(0, 10);
} catch {}

type Side = "bun" | "deno";
const sides: Side[] = ["bun", "deno"];
const cmd = (side: Side, script: string, json: object) =>
  side === "bun"
    ? [BIN.bun, join(DIR, script), JSON.stringify(json)]
    : [BIN.deno, "run", "--allow-all", join(DIR, script), JSON.stringify(json)];
const spawn = (c: string[], timeout = 120_000) => {
  const r = Bun.spawnSync(c, { windowsHide: true, stdout: "pipe", stderr: "pipe", timeout });
  const stdout = r.stdout.toString().trim();
  if (r.exitCode !== 0) throw new Error(`exit ${r.exitCode}: ${r.stderr.toString().slice(-300)}`);
  return JSON.parse(stdout.split("\n").at(-1)!);
};
const median = (a: number[]) => {
  const s = a.toSorted((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[n >> 1]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
};
const p95 = (a: number[]) => {
  const s = a.toSorted((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
};
const stat = (a: number[]) => ({
  n: a.length,
  min: Math.min(...a),
  median: median(a),
  p95: p95(a),
  max: Math.max(...a),
});
const load = async () =>
  (await Bun.file("/proc/loadavg").text()).trim().split(/\s+/).slice(0, 3).map(Number);
const procStat = async () => (await Bun.file("/proc/stat").text()).split("\n")[0]!.trim();
const sha = async (p: string) =>
  new Bun.CryptoHasher("sha256").update(await Bun.file(p).arrayBuffer()).digest("hex");

const before = { load: await load(), procStat: await procStat(), at: new Date().toISOString() };
const revisions = {
  bun: Bun.spawnSync([BIN.bun, "--revision"], { windowsHide: true }).stdout.toString().trim(),
  webkit: Bun.spawnSync([BIN.bun, "-p", "process.versions.webkit"], { windowsHide: true })
    .stdout.toString()
    .trim(),
  deno: Bun.spawnSync([BIN.deno, "--version"], { windowsHide: true })
    .stdout.toString()
    .split("\n")
    .slice(0, 2)
    .join(" ; "),
};
const cacheFile: Record<Side, string> = {
  bun: join(OUT, "boot.bun.cache"),
  deno: join(OUT, "boot.deno.cache"),
};
const produced: Record<string, unknown> = {};
for (const side of sides)
  produced[side] = spawn(
    cmd(side, "b3-boot.mjs", { mode: "produce", src: SRC, cacheFile: cacheFile[side] }),
  );

type Run = {
  s3: { medianMs: number; firstMs: number };
  cold: { totalMs: number; compileMs: number; runMs: number; ctxMs: number };
  warmHit: { totalMs: number }[];
  warmMiss?: { totalMs: number }[];
  cacheReadMs?: number;
  vmHWMMB: number | null;
};
const runs: Record<Side, { run: Run[]; consume: Run[] }> = {
  bun: { run: [], consume: [] },
  deno: { run: [], consume: [] },
};
for (let p = 0; p < PROCESSES; p++) {
  for (const side of p % 2 === 0 ? sides : sides.toReversed()) {
    runs[side].run.push(
      spawn(cmd(side, "b3-boot.mjs", { mode: "run", src: SRC, warm: 10, ctxN: 100 })),
    );
    runs[side].consume.push(
      spawn(
        cmd(side, "b3-boot.mjs", {
          mode: "consume",
          src: SRC,
          cacheFile: cacheFile[side],
          warm: 10,
        }),
      ),
    );
  }
}
const summarize = (rs: Run[]) => ({
  coldTotalMs: stat(rs.map((r) => r.cold.totalMs)),
  coldCompileMs: stat(rs.map((r) => r.cold.compileMs)),
  coldRunMs: stat(rs.map((r) => r.cold.runMs)),
  coldCtxMs: stat(rs.map((r) => r.cold.ctxMs)),
  warmHitTotalMs: stat(rs.flatMap((r) => r.warmHit.map((w) => w.totalMs))),
  warmHitProcessMedians: rs.map((r) => Number(median(r.warmHit.map((w) => w.totalMs)).toFixed(2))),
  warmMissTotalMs: rs[0]?.warmMiss
    ? stat(rs.flatMap((r) => r.warmMiss!.map((w) => w.totalMs)))
    : undefined,
  warmMissProcessMedians: rs[0]?.warmMiss
    ? rs.map((r) => Number(median(r.warmMiss!.map((w) => w.totalMs)).toFixed(2)))
    : undefined,
  cacheReadMs: rs[0]?.cacheReadMs !== undefined ? stat(rs.map((r) => r.cacheReadMs!)) : undefined,
  s3EmptyContextMedianMs: stat(
    rs.map((r) => r.s3?.medianMs).filter((x): x is number => x !== undefined),
  ),
  vmHWMMB: stat(rs.map((r) => r.vmHWMMB).filter((x): x is number => x !== null)),
  coldTotalPerProcessMs: rs.map((r) => Number(r.cold.totalMs.toFixed(2))),
});
const results = {
  bun: { run: summarize(runs.bun.run), consume: summarize(runs.bun.consume) },
  deno: { run: summarize(runs.deno.run), consume: summarize(runs.deno.consume) },
};
const probes: Record<string, unknown> = {};
for (const side of sides) probes[side] = spawn(cmd(side, "b3-probes.mjs", {}), 180_000);

const after = { load: await load(), procStat: await procStat(), at: new Date().toISOString() };
const raw = {
  command: `bun b3.ts ${args.join(" ")}`,
  host: {
    name: os.hostname(),
    kernel: os.release(),
    nproc: os.availableParallelism(),
    ramMiB: Math.round(os.totalmem() / 2 ** 20),
    before,
    after,
  },
  revisions,
  hashes: {
    binaries: { bun: await sha(BIN.bun), deno: await sha(BIN.deno) },
    bootstrapPatched: (await sha(SRC)).slice(0, 16),
  },
  n: { processes: PROCESSES, warmIterationsPerProcess: 10, emptyContextsPerProcess: 100 },
  cacheProduction: produced,
  results,
  probes,
  rawRuns: runs,
};
await Bun.write(join(OUT, "b3-raw.json"), JSON.stringify(raw, null, 1));
console.log(JSON.stringify({ results, probes }, null, 1).slice(0, 6000));
