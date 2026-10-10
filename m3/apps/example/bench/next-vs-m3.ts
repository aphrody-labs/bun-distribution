// SPDX-License-Identifier: Apache-2.0
// Measured comparison of the m3 App Router and Next.js on one small app written once (same app/ sources, React
// 19.3): cold build time, output size, start time to the first 200, JavaScript the browser downloads for `/`,
// throughput and latency on a prerendered page, a dynamic page and a route handler, and memory after the load.
//
//   bun bench/next-vs-m3.ts [--runs 3] [--seconds 5] [--next 16.5.0-canary.4]
//
// The Next app is installed in a temporary directory (`bun install`, React pinned to the version m3 resolves).
//
// Both servers run on Bun (`m3 start`; `bun --bun next start`). The load client is a Bun fetch loop in this process
// (concurrency 32), so it shares the CPU with the server: compare the two columns, not the absolute numbers.
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const option = (name: string, fallback: number) => Number(flag(name) ?? fallback);
const RUNS = option("runs", 3);
const SECONDS = option("seconds", 5);
const CONCURRENCY = 32;

const NEXT_VERSION = flag("next") ?? "16.5.0-canary.4";
const EXAMPLE = resolve(import.meta.dir, "..");
const M3_BIN = resolve(EXAMPLE, "node_modules/@aphrody/m3/bin/m3.ts");
const REACT_VERSION = (await Bun.file(join(EXAMPLE, "node_modules/react/package.json")).json())
  .version as string;

const ITEMS = Array.from({ length: 200 }, (_, i) => `Item ${i + 1}`);
const SOURCES: Record<string, string> = {
  "app/layout.jsx": `export const metadata = { title: "bench" };
export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
`,
  "app/counter.jsx": `"use client";
import { useState } from "react";
export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>count {count}</button>;
}
`,
  "app/page.jsx": `import Link from "next/link";
import { Counter } from "./counter";
const ITEMS = ${JSON.stringify(ITEMS)};
export default function Home() {
  return (
    <main>
      <h1>Home page</h1>
      <Counter />
      <ul>{ITEMS.map((item, i) => <li key={item}><Link href={"/items/" + (i + 1)}>{item}</Link></li>)}</ul>
    </main>
  );
}
`,
  "app/items/[id]/page.jsx": `import { headers } from "next/headers";
export default async function ItemPage({ params }) {
  const { id } = await params;
  const agent = (await headers()).get("user-agent") ?? "";
  return <main><h1>Item {id}</h1><p>{agent.length} bytes of user agent</p></main>;
}
`,
  "app/api/ping/route.js": `export function GET() {
  return Response.json({ ok: true });
}
`,
};

interface Framework {
  name: string;
  dir: string;
  output: string[];
  build: string[];
  start: (port: number) => string[];
}

const root = join(tmpdir(), `m3-bench-${process.pid}`);
// The m3 app sits under apps/example so `@aphrody/m3`, react and react-server-dom-parcel resolve from its node_modules.
const m3Dir = join(EXAMPLE, ".m3", `bench-${process.pid}`);
const nextDir = join(root, "next");
const frameworks: Framework[] = [
  {
    name: "m3",
    dir: m3Dir,
    output: ["dist"],
    build: ["bun", M3_BIN, "build"],
    start: (port) => ["bun", M3_BIN, "start", "--port", String(port)],
  },
  {
    name: "next",
    dir: nextDir,
    output: [".next"],
    build: ["bun", "--bun", "node_modules/next/dist/bin/next", "build"],
    start: (port) => [
      "bun",
      "--bun",
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      String(port),
    ],
  },
];

async function write(dir: string, extra: Record<string, string>) {
  await Promise.all(
    Object.entries({ ...SOURCES, ...extra }).map(([file, text]) =>
      Bun.write(join(dir, file), text),
    ),
  );
}
await write(m3Dir, { "m3.config.ts": `export default { app: true, port: 3000 };\n` });
await write(nextDir, {
  "next.config.mjs": `export default { turbopack: { root: ${JSON.stringify(nextDir)} } };\n`,
  "package.json": JSON.stringify({
    name: "bench-next",
    private: true,
    type: "module",
    dependencies: { next: NEXT_VERSION, react: REACT_VERSION, "react-dom": REACT_VERSION },
  }),
});
const install = Bun.spawnSync(["bun", "install", "--prefer-offline", "--linker", "hoisted"], {
  windowsHide: true,
  cwd: nextDir,
  stdout: "ignore",
  stderr: "pipe",
});
if (install.exitCode !== 0)
  throw new Error(`bun install of next@${NEXT_VERSION} failed\n${install.stderr}`);

const env = {
  ...process.env,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  APHRODY_FFI_DEV: "1",
};
const median = (values: number[]) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const sizeOf = (path: string): number => {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(path)
    .filter((name) => name !== "cache")
    .reduce((sum, name) => sum + sizeOf(join(path, name)), 0);
};

async function build(framework: Framework): Promise<number> {
  for (const output of framework.output)
    rmSync(join(framework.dir, output), { recursive: true, force: true });
  const started = performance.now();
  const proc = Bun.spawn(framework.build, {
    windowsHide: true,
    cwd: framework.dir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${framework.name} build failed (${code})\n${stdout}\n${stderr}`);
  return performance.now() - started;
}

function freePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = server.port ?? 0;
  server.stop(true);
  return port;
}

async function start(framework: Framework) {
  const port = freePort();
  const origin = `http://127.0.0.1:${port}`;
  const started = performance.now();
  const proc = Bun.spawn(framework.start(port), {
    windowsHide: true,
    cwd: framework.dir,
    env,
    stdout: "ignore",
    stderr: "pipe",
  });
  let exited = false;
  for (;;) {
    if (proc.exitCode !== null) {
      exited = true;
      break;
    }
    try {
      // oxlint-disable-next-line no-await-in-loop -- readiness probes are sequential: each one waits for the server's answer
      if ((await fetch(origin + "/")).status === 200) break;
    } catch {}
    // oxlint-disable-next-line no-await-in-loop -- polling interval between readiness probes
    await Bun.sleep(5);
  }
  if (exited)
    throw new Error(`${framework.name} exited: ${await new Response(proc.stderr).text()}`);
  return { proc, origin, ms: performance.now() - started };
}

const children = (id: number): number[] => {
  const file = `/proc/${id}/task/${id}/children`;
  const list = existsSync(file)
    ? Bun.spawnSync(["cat", file], { windowsHide: true }).stdout.toString().trim()
    : "";
  return list ? list.split(/\s+/).map(Number) : [];
};

/** Working set of `pid` and its descendants (Windows: Win32_Process; elsewhere: /proc status VmRSS). */
function memory(pid: number): number {
  if (process.platform === "win32") {
    const script =
      "$all = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize; " +
      `$ids = @(${pid}); $seen = @{}; $sum = 0; ` +
      "while ($ids.Count -gt 0) { $next = @(); foreach ($id in $ids) { if ($seen.ContainsKey($id)) { continue }; " +
      "$seen[$id] = 1; foreach ($p in $all) { if ($p.ProcessId -eq $id) { $sum += $p.WorkingSetSize }; " +
      "if ($p.ParentProcessId -eq $id) { $next += [int]$p.ProcessId } } }; $ids = $next }; $sum";
    return Number(
      Bun.spawnSync(["pwsh", "-NoProfile", "-Command", script], { windowsHide: true })
        .stdout.toString()
        .trim(),
    );
  }
  let sum = 0;
  for (const queue = [pid]; queue.length;) {
    const id = queue.pop()!;
    const status = Bun.spawnSync(["cat", `/proc/${id}/status`], {
      windowsHide: true,
    }).stdout.toString();
    sum += Number(status.match(/VmRSS:\s+(\d+)/)?.[1] ?? 0) * 1024;
    queue.push(...children(id));
  }
  return sum;
}

async function clientBytes(origin: string): Promise<number> {
  const html = await (await fetch(origin + "/")).text();
  const urls = new Set(
    [
      ...html.matchAll(
        /<script[^>]+src="([^"]+)"|<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g,
      ),
    ].map((match) => match[1] ?? match[2]),
  );
  const sizes = await Promise.all(
    Array.from(urls, async (url) => {
      const response = await fetch(new URL(url.replaceAll("&amp;", "&"), origin));
      return (await response.arrayBuffer()).byteLength;
    }),
  );
  return sizes.reduce((sum, size) => sum + size, 0);
}

async function load(url: string) {
  const latencies: number[] = [];
  let errors = 0;
  const run = async (until: number, record: boolean) => {
    while (performance.now() < until) {
      const sent = performance.now();
      try {
        // oxlint-disable-next-line no-await-in-loop -- each load worker sends its requests one after another; concurrency comes from the parallel workers
        const response = await fetch(url);
        // oxlint-disable-next-line no-await-in-loop -- the body is read before the next request so the connection is reused
        await response.arrayBuffer();
        if (response.status !== 200) errors++;
      } catch {
        errors++;
      }
      if (record) latencies.push(performance.now() - sent);
    }
  };
  await Promise.all(
    Array.from({ length: CONCURRENCY }, () => run(performance.now() + 1000, false)),
  );
  const started = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => run(started + SECONDS * 1000, true)));
  const elapsed = (performance.now() - started) / 1000;
  const sorted = latencies.toSorted((a, b) => a - b);
  return {
    rps: Math.round(latencies.length / elapsed),
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
    errors,
  };
}

const results: Record<string, Record<string, string>> = {};
const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MiB`;
try {
  for (const framework of frameworks) {
    const row: Record<string, string> = {};
    const builds: number[] = [];
    // oxlint-disable-next-line no-await-in-loop -- cold builds are timed one after another; parallel builds would skew each other
    for (let i = 0; i < RUNS; i++) builds.push(await build(framework));
    row["build cold (median ms)"] =
      `${Math.round(median(builds))} (${builds.map(Math.round).join(", ")})`;
    row["output size"] = mib(
      framework.output.reduce((sum, output) => sum + sizeOf(join(framework.dir, output)), 0),
    );
    const starts: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      // oxlint-disable-next-line no-await-in-loop -- start-up time is measured run after run; overlapping servers would skew each other
      const server = await start(framework);
      starts.push(server.ms);
      server.proc.kill();
      // oxlint-disable-next-line no-await-in-loop -- the process must exit before the next timed start
      await server.proc.exited;
    }
    row["start to first 200 (median ms)"] =
      `${Math.round(median(starts))} (${starts.map(Math.round).join(", ")})`;
    // oxlint-disable-next-line no-await-in-loop -- frameworks are measured one after another so they never share the CPU
    const server = await start(framework);
    try {
      row["memory idle"] = mib(memory(server.proc.pid));
      // oxlint-disable-next-line no-await-in-loop -- measurement step, run once per framework after the server is up
      row["JS for / (bytes)"] = String(await clientBytes(server.origin));
      for (const path of ["/", "/items/7", "/api/ping"]) {
        // oxlint-disable-next-line no-await-in-loop -- each path is load-tested in turn so the paths do not compete for the CPU
        const r = await load(server.origin + path);
        row[`${path} req/s, p50/p99 ms`] =
          `${r.rps}, ${r.p50.toFixed(1)}/${r.p99.toFixed(1)}${r.errors ? `, ${r.errors} errors` : ""}`;
      }
      row["memory after load"] = mib(memory(server.proc.pid));
    } finally {
      server.proc.kill();
      // oxlint-disable-next-line no-await-in-loop -- the process must exit before the next framework is measured
      await server.proc.exited;
    }
    results[framework.name] = row;
    console.error(`${framework.name}: done`);
  }
  const keys = Object.keys(results.m3 ?? {});
  console.log(
    `| metric | m3 | Next ${(await Bun.file(join(nextDir, "node_modules/next/package.json")).json()).version} |`,
  );
  console.log("| --- | --- | --- |");
  for (const key of keys) console.log(`| ${key} | ${results.m3?.[key]} | ${results.next?.[key]} |`);
  console.log(
    `\nBun ${Bun.version} (${Bun.revision.slice(0, 9)}), ${process.platform}-${process.arch}, ${navigator.hardwareConcurrency} threads, ${RUNS} runs, ${SECONDS} s x ${CONCURRENCY} connections`,
  );
} finally {
  rmSync(m3Dir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
}
