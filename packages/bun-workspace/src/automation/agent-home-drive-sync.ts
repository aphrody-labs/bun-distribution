#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop -- Commit job receipts sequentially, then retry publication. */
import { chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { replicateHome, type ReplicaConfig } from "./agent-home-replica.ts";
import { readRagStatus, type RagMonitorConfig } from "./agent-home-rag-status.ts";
import {
  reconcileDriveReview,
  verifyReviewedProjection,
  type DriveReviewConfig,
} from "./agent-home-drive-reconcile.ts";

export interface SyncConfig {
  version: 1;
  root: string;
  aphrody: string;
  yolo: string;
  receiptRoot: string;
  drive: { home: string; folderId: string; intervalSeconds: number };
  agents?: { intervalSeconds: number };
  homes?: { profile: "aphrody" | "dbfr"; intervalSeconds: number }[];
  jobs?: SyncJobName[];
  retrieval?: { root: string; intervalSeconds: number; label?: string };
  driveReview?: DriveReviewConfig;
  replica?: ReplicaConfig;
  ragMonitor?: RagMonitorConfig;
  publication: {
    host: "vps" | "local";
    directory: string;
    receiptName?: string;
  };
}

/** Resolve only local paths; remote stores and profile boundaries remain unchanged. */
export function resolveSyncContext(config: SyncConfig, cwd = process.cwd(), home = homedir()): SyncConfig {
  const local = (path: string): string =>
    path.startsWith("~/") ? join(home, path.slice(2)) : isAbsolute(path) ? path : resolve(cwd, path);
  const root = local(config.root);
  return {
    ...config,
    root,
    aphrody: config.aphrody.startsWith("~/") ? local(config.aphrody) : config.aphrody,
    yolo: config.yolo.startsWith("~/") ? local(config.yolo) : config.yolo,
    receiptRoot: local(config.receiptRoot),
    drive: { ...config.drive, home: local(config.drive.home) },
    ...(config.retrieval
      ? {
          retrieval: {
            ...config.retrieval,
            root: local(config.retrieval.root),
          },
        }
      : {}),
    ...(config.replica
      ? {
          replica: {
            ...config.replica,
            incoming: local(config.replica.incoming),
            contract: config.replica.contract.startsWith("~/")
              ? local(config.replica.contract)
              : resolve(root, config.replica.contract),
          },
        }
      : {}),
    ...(config.ragMonitor
      ? {
          ragMonitor: {
            ...config.ragMonitor,
            reportPath: local(config.ragMonitor.reportPath),
          },
        }
      : {}),
  };
}
export type SyncJobName =
  | "drive"
  | "agents"
  | "home-dbfr"
  | "home-aphrody"
  | "drive-retrieval"
  | "drive-review"
  | "drive-replica"
  | "rag-monitor";
export interface JobReceipt {
  observedAt: string;
  report: Record<string, number>;
}
export interface JobState {
  nextAt: number;
  failures: number;
  ok: boolean;
  lastSuccess?: JobReceipt;
  waiting?: JobReceipt;
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
  "reviewed",
  "review_submitted",
  "review_pending",
  "review_blocked",
  "review_applied",
];
export function counters(value: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(
    numeric.flatMap(key =>
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
    JSON.parse(result.content?.find((item: { type: string }) => item.type === "text")?.text ?? "null");
  if (!report || typeof report.records_ingested !== "number" || typeof report.sources_scanned !== "number")
    throw new Error("Invalid native sync receipt");
  return counters(report);
}
function jobs(config: SyncConfig) {
  const available = [
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
    ...(config.agents
      ? [
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
        ]
      : []),
    ...(config.homes ?? []).map(home => ({
      name: `home-${home.profile}`,
      interval: home.intervalSeconds,
      argv: [config.aphrody, "home", "sync", "--profile", home.profile, "--apply"],
      parse: (text: string) => {
        const report = JSON.parse(text);
        if (report.integrity !== "ok") throw new Error("Home integrity failed");
        return counters({
          ...report.sessions?.counts,
          verified: report.backups?.verified,
        });
      },
    })),
    ...(config.driveReview
      ? [
          {
            name: "drive-review",
            interval: config.driveReview.intervalSeconds,
            perform: (run: Runner) =>
              reconcileDriveReview(
                {
                  ...config.driveReview!,
                  home: config.drive.home,
                  folderId: config.drive.folderId,
                  yolo: config.yolo,
                },
                run,
              ),
          },
        ]
      : []),
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
              config.retrieval.label ?? "drive-dbfr-staged",
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
                config.driveReview?.reviewedDirectory ?? config.drive.home,
                config.receiptRoot,
                config.aphrody,
                run,
              ),
          },
        ]
      : []),
  ];
  if (config.driveReview && config.replica) {
    const replica = available.splice(
      available.findIndex(job => job.name === "drive-replica"),
      1,
    )[0]!;
    available.splice(available.findIndex(job => job.name === "drive-review") + 1, 0, replica);
  }
  if (config.jobs === undefined) return available;
  if (
    !Array.isArray(config.jobs) ||
    config.jobs.length === 0 ||
    new Set(config.jobs).size !== config.jobs.length ||
    config.jobs.some(name => !available.some(job => job.name === name))
  )
    throw new Error("Selected sync jobs must be unique configured capabilities");
  const wanted = new Set<string>(config.jobs);
  // Keep owner download/review before downstream consumers regardless of selection order.
  return available.filter(job => wanted.has(job.name));
}
/** A failed capability does not block other due jobs; failures retry with bounded backoff. */
export async function syncPass(
  config: SyncConfig,
  previous: SyncState,
  run: Runner,
  now = Date.now(),
  persist: (state: SyncState) => Promise<void> = async () => {},
) {
  const selected = jobs(config);
  const state = structuredClone(
    config.jobs === undefined
      ? previous
      : Object.fromEntries(Object.entries(previous).filter(([name]) => selected.some(job => job.name === name))),
  );
  for (const job of selected) {
    if ((state[job.name]?.nextAt ?? 0) > now) continue;
    const old = state[job.name];
    const guarded = config.driveReview && (job.name === "drive-replica" || job.name === "drive-retrieval");
    const review = state["drive-review"];
    if (
      guarded &&
      (!review?.ok || review.lastSuccess?.report.review_pending || review.lastSuccess?.report.review_blocked)
    ) {
      state[job.name] = {
        ...old,
        ok: false,
        failures: old?.failures ?? 0,
        nextAt: now + Math.min(60, job.interval) * 1000,
        waiting: {
          observedAt: new Date(now).toISOString(),
          report: {
            [review?.lastSuccess?.report.review_blocked ? "review_blocked" : "review_pending"]: 1,
          },
        },
      };
      await persist(state);
      continue;
    }
    try {
      if (guarded && config.driveReview?.reviewedDirectory)
        await verifyReviewedProjection(config.driveReview.reviewedDirectory);
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
        waiting: undefined,
        ok: false,
        failures,
        nextAt: now + Math.min(3600, 60 * 2 ** Math.min(failures - 1, 6)) * 1000,
      };
    }
    await persist(state);
  }
  return state;
}
/** A job parked on a human review is waiting, not failed: only real failures make the timer fail. */
export function hasFailedJob(state: SyncState) {
  return Object.values(state).some(job => !job.ok && job.waiting === undefined);
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
      windowsHide: true,
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
function validatePublication(config: SyncConfig) {
  const { host, receiptName } = config.publication;
  if (
    !["vps", "local"].includes(host) ||
    (receiptName !== undefined &&
      (typeof receiptName !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.json$/.test(receiptName)))
  )
    throw new Error("Invalid sync publication destination or receipt basename");
}
export async function publishSyncReceipts(config: SyncConfig, state: SyncState, run: Runner) {
  validatePublication(config);
  // Only counters travel; raw provider output and authentication remain in protected stores.
  const publicState: Record<string, JobState> = Object.fromEntries(
    Object.entries(state)
      .filter(([name]) =>
        [
          "drive",
          "agents",
          "home-dbfr",
          "home-aphrody",
          "drive-retrieval",
          "drive-review",
          "drive-replica",
          "rag-monitor",
        ].includes(name),
      )
      .map(([name, value]) => [
        name,
        {
          ok: value.ok === true,
          failures: Number.isSafeInteger(value.failures) && value.failures >= 0 ? value.failures : 0,
          nextAt: Number.isSafeInteger(value.nextAt) && value.nextAt >= 0 ? value.nextAt : 0,
          ...Object.fromEntries(
            ["lastSuccess", "waiting"].flatMap(key => {
              const receipt = value[key as "lastSuccess" | "waiting"];
              return receipt && /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(receipt.observedAt)
                ? [
                    [
                      key,
                      {
                        observedAt: receipt.observedAt,
                        report: counters(receipt.report),
                      },
                    ],
                  ]
                : [];
            }),
          ),
        },
      ]),
  );
  const automation = {
    observedAt: new Date().toISOString(),
    jobs: publicState,
  };
  const reports: Record<string, unknown> = {
    [config.publication.receiptName ?? "automation-sync.json"]: automation,
  };
  if (config.publication.receiptName === undefined) {
    for (const [job, file] of [
      ["drive", "drive-sync.json"],
      ["agents", "agent-sync.json"],
      ["rag-monitor", "rag-sync.json"],
    ]) {
      const receipt = publicState[job!]?.lastSuccess;
      if (receipt) reports[file!] = receipt;
    }
  }
  if (config.publication.host === "local") {
    for (const [name, report] of Object.entries(reports)) await save(join(config.publication.directory, name), report);
    return;
  }
  const payload = Buffer.from(JSON.stringify(reports)).toString("base64");
  const remote = Buffer.from(config.publication.directory).toString("base64");
  const script = `import {mkdir,open,rename,lstat,realpath} from "node:fs/promises"; import {join,resolve,isAbsolute} from "node:path";
const root=Buffer.from("${remote}","base64").toString("utf8"); const reports=JSON.parse(Buffer.from("${payload}","base64").toString("utf8"));
if(!isAbsolute(root))throw Error("UNSAFE_RECEIPT_ROOT"); await mkdir(root,{recursive:true,mode:0o700});
if(!(await lstat(root)).isDirectory()||(await realpath(root))!==resolve(root))throw Error("UNSAFE_RECEIPT_ROOT");
for(const [name,data] of Object.entries(reports)){if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\\.json$/.test(name))throw Error("UNSAFE_RECEIPT_NAME");
const target=join(root,name),temporary=target+"."+crypto.randomUUID()+".tmp",file=await open(temporary,"wx",0o600);
try{await file.writeFile(JSON.stringify(data)+"\\n");await file.sync();}finally{await file.close();}await rename(temporary,target);}
if(process.platform!=="win32"){const directory=await open(root,"r");try{await directory.sync();}finally{await directory.close();}}console.log("sync-receipts-published");`;
  const result = await run([
    config.aphrody,
    "infra",
    "ssh",
    "exec",
    "--host",
    config.publication.host,
    "--cmd",
    "/home/ubuntu/.bun/bin/bun -e '" + script.replace(/'/g, "'\\''") + "'",
  ]);
  if (result.trim() !== "sync-receipts-published") throw new Error("Unverified receipt publication");
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
  const config = resolveSyncContext(
    (await Bun.file(at < 0 ? "infra/config/host/agent-sync.json" : process.argv[at + 1]!).json()) as SyncConfig,
  );
  if (config.version !== 1 || (config.homes ?? []).some(home => !["dbfr", "aphrody"].includes(home.profile)))
    throw new Error("Invalid sync scope");
  validatePublication(config);
  const selected = jobs(config);
  if (!process.argv.includes("--apply")) {
    console.log(
      JSON.stringify({
        planned: true,
        jobs: selected.map(job => ({
          name: job.name,
          intervalSeconds: job.interval,
        })),
      }),
    );
    process.exit(0);
  }
  await mkdir(config.receiptRoot, { recursive: true, mode: 0o700 });
  const lockPath = join(config.receiptRoot, "sync.lock");
  if (!(await lock(lockPath))) process.exit(0);
  try {
    const path = join(config.receiptRoot, "sync-state.json");
    const previous = (await Bun.file(path).exists()) ? ((await Bun.file(path).json()) as SyncState) : {};
    const run = runner(config);
    const state = await syncPass(config, previous, run, Date.now(), next => save(path, next));
    let published = false;
    try {
      await publishSyncReceipts(config, state, run);
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
            {
              ok: value.ok,
              failures: value.failures,
              observedAt: value.lastSuccess?.observedAt,
            },
          ]),
        ),
      }),
    );
    if (!published || hasFailedJob(state)) process.exitCode = 1;
  } finally {
    await rm(lockPath, { recursive: true });
  }
}
