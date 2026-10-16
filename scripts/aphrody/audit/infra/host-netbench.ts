#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * host-netbench: comparable before/after measurement of a web host's network path.
 *
 *   bun scripts/audit/infra/host-netbench.ts --target vps --client dbfr --url URL [--url URL]... [--seconds N]
 *       [--connections N] [--freeze UNIT]... [--label NAME] [--out FILE.json]
 *
 * The load comes from another host (`oha` on --client) so it crosses the target's real NIC.
 * Units given with --freeze (batch jobs) are frozen through their cgroup v2 freezer during the run and
 * thawed afterwards, so they do not skew the comparison. For every URL the report keeps oha's
 * rate, latency percentiles and errors, plus the target's per-CPU NET_RX/NET_TX softirq deltas
 * and CPU time split (/proc/softirqs, /proc/stat) over the run.
 */
// oxlint-disable no-await-in-loop -- measurements run one after another by design.
import { $ } from "bun";

interface Options {
  target: string;
  client: string;
  urls: string[];
  seconds: number;
  connections: number;
  freeze: string[];
  label: string;
  out: string | null;
}

function parseArgs(argv: string[]): Options {
  const all = (name: string): string[] =>
    argv.flatMap((a, i) =>
      a === name && argv[i + 1] ? [argv[i + 1] as string] : [],
    );
  const one = (name: string): string | undefined => all(name)[0];
  const target = one("--target");
  const client = one("--client");
  // The measured URLs belong to the product served by the target, so the caller names them.
  const urls = all("--url");
  if (!target || !client || !urls.length) {
    console.error(
      "usage: host-netbench --target <host> --client <host> --url URL [--url URL]... [--seconds N] [--connections N] [--freeze UNIT]... [--label NAME] [--out FILE]",
    );
    process.exit(2);
  }
  return {
    target,
    client,
    urls,
    seconds: Number(one("--seconds") ?? 15),
    connections: Number(one("--connections") ?? 128),
    freeze: all("--freeze"),
    label: one("--label") ?? new Date().toISOString(),
    out: one("--out") ?? null,
  };
}

async function exec(
  host: string,
  cmd: string,
  timeoutSecs = 120,
): Promise<string> {
  const r = await $`aphrody-infra ssh exec --host ${host} --json --cmd ${cmd}`
    .env({
      ...process.env,
      APHRODY_SSH_COMMAND_TIMEOUT_SECS: String(timeoutSecs),
    })
    .nothrow()
    .quiet();
  const text = r.stdout.toString();
  try {
    const j = JSON.parse(text) as {
      exit_code: number;
      stdout: string;
      stderr: string;
    };
    if (j.exit_code !== 0)
      throw new Error(
        `${host}: exit ${j.exit_code}: ${j.stderr.slice(0, 400)}`,
      );
    return j.stdout;
  } catch (e) {
    if (e instanceof SyntaxError)
      throw new Error(
        `${host}: ${text.slice(0, 400)} ${r.stderr.toString().slice(0, 400)}`,
        {
          cause: e,
        },
      );
    throw e;
  }
}

/** cgroup v2 freezer: works for an activating oneshot, which `systemctl freeze` refuses (pending job). */
const cgroupFreeze = (unit: string, state: 0 | 1): string =>
  `g=$(systemctl show -p ControlGroup --value ${unit}) && [ -n "$g" ] && echo ${state} | sudo -n tee /sys/fs/cgroup$g/cgroup.freeze >/dev/null`;

interface Snapshot {
  netRx: number[];
  netTx: number[];
  cpu: Record<string, number>;
}

const SNAPSHOT =
  "grep -E '^ *(NET_RX|NET_TX):' /proc/softirqs; grep '^cpu ' /proc/stat";

function parseSnapshot(text: string): Snapshot {
  const row = (name: string): number[] =>
    (text.split("\n").find((l) => l.trim().startsWith(name + ":")) ?? "")
      .trim()
      .split(/\s+/)
      .slice(1)
      .map(Number);
  const cpuLine = (text.split("\n").find((l) => l.startsWith("cpu ")) ?? "")
    .trim()
    .split(/\s+/)
    .slice(1)
    .map(Number);
  const names = [
    "user",
    "nice",
    "system",
    "idle",
    "iowait",
    "irq",
    "softirq",
    "steal",
  ];
  return {
    netRx: row("NET_RX"),
    netTx: row("NET_TX"),
    cpu: Object.fromEntries(names.map((n, i) => [n, cpuLine[i] ?? 0])),
  };
}

const per = (x: number[], y: number[]): number[] =>
  y.map((v, i) => v - (x[i] ?? 0));

function delta(a: Snapshot, b: Snapshot) {
  const rx = per(a.netRx, b.netRx);
  const total = rx.reduce((s, v) => s + v, 0) || 1;
  const cpuTicks = Object.fromEntries(
    Object.keys(b.cpu).map((k) => [k, (b.cpu[k] ?? 0) - (a.cpu[k] ?? 0)]),
  );
  const ticks = Object.values(cpuTicks).reduce((s, v) => s + v, 0) || 1;
  return {
    netRxPerCpu: rx,
    netRxTopCpuShare: Math.round((Math.max(...rx) / total) * 1000) / 10,
    netRxCpusAbove5pct: rx.filter((v) => v / total > 0.05).length,
    cpuPercent: Object.fromEntries(
      Object.entries(cpuTicks).map(([k, v]) => [
        k,
        Math.round((v / ticks) * 1000) / 10,
      ]),
    ),
  };
}

interface OhaSummary {
  summary: {
    successRate: number;
    requestsPerSec: number;
    total: number;
    sizePerSec?: number;
  };
  latencyPercentiles: Record<string, number>;
  statusCodeDistribution: Record<string, number>;
  errorDistribution: Record<string, number>;
}

async function main(): Promise<void> {
  const opts = parseArgs(Bun.argv.slice(2));
  const frozen: string[] = [];
  const results = [];
  try {
    for (const unit of opts.freeze) {
      const active = (
        await exec(opts.target, `systemctl is-active ${unit} || true`)
      ).trim();
      if (active === "active" || active === "activating") {
        await exec(opts.target, cgroupFreeze(unit, 1));
        frozen.push(unit);
      }
    }
    for (const url of opts.urls) {
      const before = parseSnapshot(await exec(opts.target, SNAPSHOT));
      const oha = JSON.parse(
        await exec(
          opts.client,
          `PATH=$HOME/.cargo/bin:$PATH oha --no-tui --output-format json -z ${opts.seconds}s -c ${opts.connections} ${JSON.stringify(url)}`,
          opts.seconds + 120,
        ),
      ) as OhaSummary;
      const after = parseSnapshot(await exec(opts.target, SNAPSHOT));
      results.push({
        url,
        requestsPerSec: Math.round(oha.summary.requestsPerSec),
        bytesPerSec: Math.round(oha.summary.sizePerSec ?? 0),
        successRate: oha.summary.successRate,
        latencyMs: Object.fromEntries(
          ["p50", "p90", "p99", "p99.9"].map((p) => [
            p,
            Math.round((oha.latencyPercentiles[p] ?? 0) * 100000) / 100,
          ]),
        ),
        status: oha.statusCodeDistribution,
        errors: oha.errorDistribution,
        target: delta(before, after),
      });
    }
  } finally {
    for (const unit of frozen)
      await exec(opts.target, cgroupFreeze(unit, 0)).catch((e: unknown) =>
        console.error(`thaw ${unit}: ${String(e)}`),
      );
  }
  const report = {
    tool: "host-netbench/1",
    label: opts.label,
    at: new Date().toISOString(),
    target: opts.target,
    client: opts.client,
    seconds: opts.seconds,
    connections: opts.connections,
    frozen,
    results,
  };
  const text = JSON.stringify(report, null, 2);
  if (opts.out) await Bun.write(opts.out, text + "\n");
  console.log(text);
}

if (import.meta.main) await main();
