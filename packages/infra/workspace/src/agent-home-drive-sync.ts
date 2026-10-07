#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop -- Commit job receipts sequentially, then retry publication. */
import { chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { replicateHome, type ReplicaConfig } from "./agent-home-replica.ts";
import { readRagStatus, type RagMonitorConfig } from "./agent-home-rag-status.ts";

export interface SyncConfig {
  version: 1;
  root: string;
  aphrody: string;
  yolo: string;
  receiptRoot: string;
  drive: { home: string; folderId: string; intervalSeconds: number };
  agents: { intervalSeconds: number };
  homes: { profile: "aphrody" | "dbfr"; intervalSeconds: number }[];
  retrieval?: { root: string; intervalSeconds: number };
  replica?: ReplicaConfig;
  ragMonitor?: RagMonitorConfig;
  publication: { host: "vps"; directory: string };
}
export interface JobReceipt {
  observedAt: string;
  report: Record<string, number>;
}
export interface JobState {
  nextAt: number;
  failures: number;
  ok: boolean;
  lastSuccess?: JobReceipt;
}
export type SyncState = Record<string, JobState>;
export type Runner = (argv: string[], environment?: Record<string, string>) => Promise<string>;

const numeric = [
  "indexed",
  "seeded",
  "unchanged",
  "localAhead",
  "staged",
  "unsupported",
  "uploaded",
  "records_ingested",
  "sources_scanned",
  "sources_updated",
  "documents",
  "chunks",
  "files_found",
  "verified",
  "files_copied",
  "homes_indexed",
  "running",
  "completed",
  "failed",
  "source_count",
  "progress_current",
  "progress_total",
];
export function counters(value: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(
    numeric.flatMap((key) =>
      typeof value[key] === "number" && Number.isSafeInteger(value[key]) && Number(value[key]) >= 0
        ? [[key, value[key]]]
        : [],
    ),
  );
}
export function nativeAgentReport(text: string): Record<string, number> {
  const result = JSON.parse(text).result;
  if (!result || result.isError) throw new Error("Native agent sync failed");
  const report =
    result.structuredContent ??
    JSON.parse(
      result.content?.find((item: { type: string }) => item.type === "text")?.text ?? "null",
    );
  if (
    !report ||
    typeof report.records_ingested !== "number" ||
    typeof report.sources_scanned !== "number"
  )
    throw new Error("Invalid native sync receipt");
  return counters(report);
}
function jobs(config: SyncConfig) {
  return [
    {
      name: "drive",
      interval: config.drive.intervalSeconds,
      argv: [config.yolo, "google", "drive", "sync", "--download-only"],
      environment: {
        APHRODY_AGENT_HOME: config.drive.home,
        APHRODY_GOOGLE_DRIVE_FOLDER_ID: config.drive.folderId,
      },
      parse: (text: string) => counters(JSON.parse(text)),
    },
    {
      name: "agents",
      interval: config.agents.intervalSeconds,
      argv: [
        config.aphrody,
        "mcp",
        "call",
        "aphrody",
        "sync_external_agents",
        "--args",
        JSON.stringify({ live: true, memory: false }),
      ],
      parse: nativeAgentReport,
    },
    ...config.homes.map((home) => ({
      name: `home-${home.profile}`,
      interval: home.intervalSeconds,
      argv: [config.aphrody, "home", "sync", "--profile", home.profile, "--apply"],
      parse: (text: string) => {
        const report = JSON.parse(text);
        if (report.integrity !== "ok") throw new Error("Home integrity failed");
        return counters({ ...report.sessions?.counts, verified: report.backups?.verified });
      },
    })),
    ...(config.retrieval
      ? [
          {
            name: "drive-retrieval",
            interval: config.retrieval.intervalSeconds,
            argv: [
              config.aphrody,
              "home",
              "index",
              config.retrieval.root,
              "--label",
              "drive-dbfr-staged",
              "--profile",
              "dbfr",
            ],
            parse: (text: string) => {
              const report = JSON.parse(text);
              if (!Array.isArray(report.errors) || report.errors.length)
                throw new Error("Drive retrieval indexing failed");
              return counters(report);
            },
          },
        ]
      : []),
    ...(config.ragMonitor
      ? [
          {
            name: "rag-monitor",
            interval: config.ragMonitor.intervalSeconds,
            perform: (run: Runner) => readRagStatus(config.ragMonitor!, run),
          },
        ]
      : []),
    ...(config.replica
      ? [
          {
            name: "drive-replica",
            interval: config.replica.intervalSeconds,
            perform: (run: Runner) =>
              replicateHome(
                config.replica!,
                config.drive.home,
                config.receiptRoot,
                config.aphrody,
                run,
              ),
          },
        ]
      : []),
  ];
}
/** A failed capability does not block other due jobs; failures retry with bounded backoff. */
export async function syncPass(
  config: SyncConfig,
  previous: SyncState,
  run: Runner,
  now = Date.now(),
  persist: (state: SyncState) => Promise<void> = async () => {},
) {
  const state = structuredClone(previous);
  for (const job of jobs(config)) {
    if ((state[job.name]?.nextAt ?? 0) > now) continue;
    const old = state[job.name];
    try {
      const report =
        "perform" in job && job.perform
          ? counters(await job.perform(run))
          : job.parse(await run(job.argv, "environment" in job ? job.environment : undefined));
      state[job.name] = {
        ok: true,
        failures: 0,
        nextAt: now + job.interval * 1000,
        lastSuccess: { observedAt: new Date(now).toISOString(), report },
      };
    } catch {
      const failures = (old?.failures ?? 0) + 1;
      state[job.name] = {
        ...old,
        ok: false,
        failures,
        nextAt: now + Math.min(3600, 60 * 2 ** Math.min(failures - 1, 6)) * 1000,
      };
    }
    await persist(state);
  }
  return state;
}
async function save(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await Bun.write(temporary, JSON.stringify(value) + "\n", { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}
function runner(config: SyncConfig): Runner {
  return async (argv, environment) => {
    const child = Bun.spawn(argv, {
      cwd: config.root,
      env: { ...process.env, ...environment },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    });
    const deadline = setTimeout(() => child.kill(), 180_000);
    try {
      const text = await new Response(child.stdout).text();
      if ((await child.exited) !== 0) throw new Error("Sync capability failed");
      return text;
    } finally {
      clearTimeout(deadline);
    }
  };
}
async function publish(config: SyncConfig, state: SyncState, run: Runner) {
  // Only counters travel; raw provider output and authentication remain in protected stores.
  const reports: Record<string, unknown> = {
    "automation-sync.json": { observedAt: new Date().toISOString(), jobs: state },
  };
  if (state.drive?.lastSuccess) reports["drive-sync.json"] = state.drive.lastSuccess;
  if (state.agents?.lastSuccess) reports["agent-sync.json"] = state.agents.lastSuccess;
  if (state["rag-monitor"]?.lastSuccess)
    reports["rag-sync.json"] = state["rag-monitor"].lastSuccess;
  const payload = Buffer.from(JSON.stringify(reports)).toString("base64");
  const remote = Buffer.from(config.publication.directory).toString("base64");
  const python = [
    `import base64,json,os,pathlib; root=pathlib.Path(base64.b64decode("${remote}").decode()); reports=json.loads(base64.b64decode("${payload}")); root.mkdir(mode=0o700,parents=True,exist_ok=True)`,
    "for name,data in reports.items():",
    ' p=root/name; t=p.with_suffix(".sync.tmp"); t.write_text(json.dumps(data)+"\\n"); os.chmod(t,0o600); t.replace(p)',
    'print("sync-receipts-published")',
  ].join("\n");
  const result = await run([
    config.aphrody,
    "infra",
    "ssh",
    "exec",
    "--host",
    config.publication.host,
    "--cmd",
    "python3 -c '" + python + "'",
  ]);
  if (result.trim() !== "sync-receipts-published")
    throw new Error("Unverified receipt publication");
}
async function lock(path: string): Promise<boolean> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(
      await Bun.file(join(path, "pid"))
        .text()
        .catch(() => "0"),
    );
    if (pid > 1) {
      try {
        process.kill(pid, 0);
        return false;
      } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe;
      }
    } else if (Date.now() - (await stat(path)).mtimeMs < 60_000) return false;
    await rm(path, { recursive: true });
    await mkdir(path, { mode: 0o700 });
  }
  await Bun.write(join(path, "pid"), String(process.pid), { mode: 0o600 });
  return true;
}
if (import.meta.main) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      "yolo ops agent-home-drive-sync [--config PATH] [--apply]\nPlan by default. Reconciles Drive, native agent sessions and protected homes; the declared user timer owns periodic execution. No training or legacy memory executable is started.",
    );
    process.exit(0);
  }
  if (process.argv.includes("daemon"))
    throw new Error("Use the declared aphrody-agent-sync.timer for periodic synchronization");
  const at = process.argv.indexOf("--config");
  const config = (await Bun.file(
    at < 0 ? "config/host/agent-sync.json" : process.argv[at + 1]!,
  ).json()) as SyncConfig;
  if (
    config.version !== 1 ||
    config.publication.host !== "vps" ||
    config.homes.some((home) => !["dbfr", "aphrody"].includes(home.profile))
  )
    throw new Error("Invalid sync scope");
  if (!process.argv.includes("--apply")) {
    console.log(
      JSON.stringify({
        planned: true,
        jobs: jobs(config).map((job) => ({ name: job.name, intervalSeconds: job.interval })),
      }),
    );
    process.exit(0);
  }
  await mkdir(config.receiptRoot, { recursive: true, mode: 0o700 });
  const lockPath = join(config.receiptRoot, "sync.lock");
  if (!(await lock(lockPath))) process.exit(0);
  try {
    const path = join(config.receiptRoot, "sync-state.json");
    const previous = (await Bun.file(path).exists())
      ? ((await Bun.file(path).json()) as SyncState)
      : {};
    const run = runner(config);
    const state = await syncPass(config, previous, run, Date.now(), (next) => save(path, next));
    let published = false;
    try {
      await publish(config, state, run);
      published = true;
    } catch {
      /* Retry publication on the next tick without rerunning successful jobs. */
    }
    await save(join(config.receiptRoot, "last-pass.json"), {
      observedAt: new Date().toISOString(),
      published,
      jobs: state,
    });
    console.log(
      JSON.stringify({
        published,
        jobs: Object.fromEntries(
          Object.entries(state).map(([name, value]) => [
            name,
            { ok: value.ok, failures: value.failures, observedAt: value.lastSuccess?.observedAt },
          ]),
        ),
      }),
    );
    if (!published || Object.values(state).some((job) => !job.ok)) process.exitCode = 1;
  } finally {
    await rm(lockPath, { recursive: true });
  }
}
