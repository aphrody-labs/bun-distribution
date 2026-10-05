// Machine-readable perf snapshot: CLI startup, global tool, MCP latency/RSS, bun:ffi call overhead.
// Usage: bun scripts/audit/perf-surfaces.ts [out.json]. No Cargo; benchmarks existing binaries only.
import { dlopen, FFIType } from "bun:ffi";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const runs = Number(process.env.PERF_RUNS ?? 15);
const med = (a: number[]) => [...a].toSorted((x, y) => x - y)[Math.floor(a.length / 2)]!;
const r2 = (n: number) => Math.round(n * 100) / 100;

function timeCmd(cmd: string[], cwd = process.cwd(), n = runs) {
  Bun.spawnSync(cmd, { cwd, stdout: "ignore", stderr: "ignore" }); // warm-up
  const t: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = Bun.nanoseconds();
    Bun.spawnSync(cmd, { cwd, stdout: "ignore", stderr: "ignore" });
    t.push((Bun.nanoseconds() - s) / 1e6);
  }
  return { cmd: cmd.join(" "), runs: n, median_ms: r2(med(t)), min_ms: r2(Math.min(...t)) };
}

async function mcp(cmd: string[], cwd: string, call?: { name: string; arguments: object }) {
  const p = Bun.spawn(cmd, { cwd, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  const rd = p.stdout.getReader();
  let buf = "";
  const next = async (id: number) => {
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        try { const m = JSON.parse(line); if (m.id === id) return m; } catch {}
        continue;
      }
      const { value, done } = await rd.read();
      if (done) throw new Error("eof");
      buf += new TextDecoder().decode(value);
    }
  };
  const send = (o: object) => p.stdin.write(JSON.stringify(o) + "\n");
  const t0 = Bun.nanoseconds();
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "perf", version: "1" } } });
  await next(1);
  const t1 = Bun.nanoseconds();
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tl = await next(2);
  const t2 = Bun.nanoseconds();
  let callMs: number | null = null;
  if (call) {
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: call });
    await next(3);
    callMs = (Bun.nanoseconds() - t2) / 1e6;
  }
  let rssKb = 0;
  try { rssKb = Number(/VmHWM:\s+(\d+)/.exec(readFileSync(`/proc/${p.pid}/status`, "utf8"))?.[1] ?? 0); } catch {}
  p.kill();
  return { initialize_ms: r2((t1 - t0) / 1e6), tools_list_ms: r2((t2 - t1) / 1e6), tools: tl.result?.tools?.length ?? 0, call_ms: callMs && r2(callMs), rss_kb: rssKb };
}

const home = homedir();
const root = process.cwd();
const out: Record<string, unknown> = { date: new Date().toISOString().slice(0, 10), bun: Bun.version, runs };
const sample = `${root}/packages/infra/update`;
out.tools = {
  oxlint_global: timeCmd(["oxlint", "--version"]),
  oxfmt_global: timeCmd(["oxfmt", "--version"]),
  tsc_global: timeCmd(["tsc", "--version"]),
  tsc_typecheck_global: timeCmd(["tsc", "--noEmit", "-p", "."], sample, 5),
  oxlint_lint_global: timeCmd(["oxlint", "src"], sample, 5),
  bun_version: timeCmd(["bun", "--version"]),
  nu_version: timeCmd(["nu", "--version"]),
};
out.cli = Object.fromEntries(
  ["aphrody", "aphrody-kernel", "yolo"].map((b) => [b, timeCmd([`${home}/.local/bin/${b}`, "--version"])]),
);
async function mcpMedian(cmd: string[], cwd: string, call: { name: string; arguments: object }, n = 7) {
  const rs: Awaited<ReturnType<typeof mcp>>[] = [];
  for (let i = 0; i < n + 1; i++) rs.push(await mcp(cmd, cwd, call)); // first run is cold, dropped
  rs.shift();
  const m = (k: "initialize_ms" | "tools_list_ms" | "call_ms" | "rss_kb") => r2(med(rs.map((r) => Number(r[k] ?? 0))));
  return { runs: n, tools: rs[0]!.tools, initialize_ms: m("initialize_ms"), tools_list_ms: m("tools_list_ms"), call: call.name, call_ms: m("call_ms"), rss_kb: m("rss_kb") };
}
out.mcp = {
  aphrody_kernel_inprocess: await mcpMedian([`${home}/.local/bin/aphrody-kernel`, "mcp"], root, { name: "coreutils_status", arguments: {} }).catch((e) => ({ error: String(e) })),
  yolo: await mcpMedian([`${home}/yolo/bin/yolo`, "mcp"], `${home}/yolo`, { name: "yolo_doctor", arguments: {} }).catch((e) => ({ error: String(e) })),
};
try {
  const lib = dlopen(`${home}/.local/bin/IECODE.Ffi.so`, {
    iecode_level5_crc32: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u32 },
  });
  const buf = new Uint8Array(64);
  const N = 1_000_000;
  const f = lib.symbols.iecode_level5_crc32;
  for (let i = 0; i < 1000; i++) f(buf, 64n);
  const s = Bun.nanoseconds();
  for (let i = 0; i < N; i++) f(buf, 64n);
  out.ffi = { lib: "IECODE.Ffi.so", symbol: "iecode_level5_crc32(64B)", ns_per_call: r2((Bun.nanoseconds() - s) / N) };
} catch (e) { out.ffi = { error: String(e) }; }
const path = process.argv[2];
if (path) await Bun.write(path, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
