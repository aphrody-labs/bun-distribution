// SPDX-License-Identifier: Apache-2.0
/** The sole session ingestion loop for a selected kernel domain, over native MCP. */
import { KernelClient } from "@aphrody/os";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

type ObjectValue = Record<string, any>;
export interface SyncClient {
  call(tool: string, args: Record<string, any>, timeoutMs?: number): Promise<unknown>;
  close(): void;
}

function object(value: unknown): ObjectValue {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("kernel returned a non-object result");
  if (parsed.error) throw new Error(String(parsed.error));
  return parsed;
}

/** Check the kernel's domain before invoking a tool that can write conversations. */
export async function syncAgentPass(
  client: SyncClient,
  domain: string,
  memory: boolean,
  live = true,
) {
  if (!["aphrody", "dbfr", "ie"].includes(domain)) throw new Error("invalid domain");
  const environment = object(
    await client.call("nu_eval", { code: "$env.APHRODY_AGENT_DOMAIN?", timeout_secs: 5 }, 10_000),
  );
  if (environment.value !== domain)
    throw new Error(`kernel domain differs from selected ${domain} profile`);
  const report = object(await client.call("sync_external_agents", { live, memory }, 60_000));
  const expected = join(
    process.env.APHRODY_HOME || homedir() + "/.aphrody",
    "workspaces",
    domain,
    "sessions",
  );
  if (typeof report.output_dir !== "string" || resolve(report.output_dir) !== resolve(expected))
    throw new Error("sync output differs from the selected domain store");
  // Publish metadata only. Transcripts and private conversation values stay in their store.
  return {
    output_dir: report.output_dir,
    state_path: report.state_path,
    records_ingested: report.records_ingested,
    sources_scanned: report.sources_scanned,
    sources_updated: report.sources_updated,
    duration_ms: report.duration_ms,
    live_processes: report.live_processes,
    issues_count: report.issues?.length ?? 0,
    memory: report.memory,
  };
}

export async function runAgentSync(args: string[]): Promise<number> {
  let root = process.cwd(),
    domain = "aphrody",
    interval = 2,
    watch = false,
    json = false;
  // One owner commits mirror offsets and memory together; a mirror-only consumer can steal
  // offsets from a memory-ingesting consumer. Observers read AGENT-SYNC.json instead.
  let memory = true;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root" || arg === "--domain" || arg === "--interval-secs") {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      if (arg === "--root") root = resolve(value);
      else if (arg === "--domain") domain = value;
      else interval = Number(value);
    } else if (arg === "--watch") watch = true;
    else if (arg === "--json") json = true;
    else if (arg === "--no-memory") memory = false;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "yolo ops agent-sync [--root PATH] [--domain aphrody|dbfr|ie] [--watch] [--interval-secs 2] [--json] [--no-memory]\nSilent by default; requires a kernel running in the selected domain. One ingestion owner per domain.",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(interval) || interval < 1) throw new Error("interval must be >= 1 second");
  if (!["aphrody", "dbfr", "ie"].includes(domain)) throw new Error("invalid domain");
  const stop = new AbortController();
  let client: SyncClient | undefined;
  const interrupt = () => {
    stop.abort();
    client?.close();
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  let failures = 0,
    lastSuccess: string | null = null,
    report: ObjectValue | undefined;
  let nextProbeAt = 0;
  let liveSampledAt: string | null = null;
  const dir = join(root, ".coord/shared");
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    /* eslint-disable no-await-in-loop */
    do {
      let error: string | undefined;
      try {
        client ??= await KernelClient.connect(undefined, "aphrody-agent-sync");
        if (stop.signal.aborted) break;
        const probeLive = Date.now() >= nextProbeAt;
        const nextReport = await syncAgentPass(client, domain, memory, probeLive);
        if (probeLive) {
          nextProbeAt = Date.now() + 30_000;
          liveSampledAt = new Date().toISOString();
        } else nextReport.live_processes = report?.live_processes;
        report = nextReport;
        lastSuccess = new Date().toISOString();
        failures = 0;
      } catch (failure) {
        if (stop.signal.aborted) break;
        client?.close();
        client = undefined;
        failures++;
        error = failure instanceof Error ? failure.message : String(failure);
      }
      if (stop.signal.aborted) break;
      const status = {
        schema_version: 1,
        domain,
        transport: "native-kernel-mcp",
        sampled_at: new Date().toISOString(),
        last_success_at: lastSuccess,
        live_sampled_at: liveSampledAt,
        consecutive_failures: failures,
        error,
        report,
      };
      const temporary = join(dir, `.AGENT-SYNC.${process.pid}.tmp`);
      await writeFile(temporary, JSON.stringify(status), { mode: 0o600 });
      await rename(temporary, join(dir, "AGENT-SYNC.json"));
      if (json) console.log(JSON.stringify(status));
      if (!watch) return failures ? 1 : 0;
      // Sequential calls and bounded backoff; retry uses the owner's exactly-once offsets.
      const seconds = failures ? Math.min(30, interval * 2 ** Math.min(failures, 5)) : interval;
      await delay(seconds * 1000, undefined, { signal: stop.signal }).catch((failure) => {
        if (!stop.signal.aborted) throw failure;
      });
    } while (!stop.signal.aborted);
    return 0;
  } finally {
    client?.close();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}

if (import.meta.main) process.exit(await runAgentSync(process.argv.slice(2)));
