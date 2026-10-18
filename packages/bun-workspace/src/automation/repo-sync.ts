// SPDX-License-Identifier: Apache-2.0
/** Workspace route to source-sync and the existing native build-factory owner. */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  loadSourceSyncConfig,
  runSourceSync,
  sourceSyncStateRoot,
  type SourceSyncConfig,
  type SyncRepository,
  type SyncReport,
} from "./source-sync.ts";
import { runBuildFactory } from "./build-factory.ts";
import { infraRoot } from "./runtime.ts";

export interface FactoryJob {
  repo: string;
  revision: string;
  token?: string;
  pid?: number;
  status: "starting" | "running" | "succeeded" | "failed" | "lost";
  phase: "prepare" | "build" | "complete";
  requestedAt: string;
  finishedAt?: string;
  exitCode?: number;
  reconciliationRequired?: boolean;
}
/** Bind native CI to the existing durable job rather than an independently sampled HEAD. */
export function factoryBuildCommand(repository: SyncRepository, job: FactoryJob): string[] {
  if (!repository.buildCommand?.length || repository.buildEnabled === false)
    throw new Error("Factory job has no enabled owner build command");
  if (repository.id !== "bun-runtime") return [...repository.buildCommand];
  if (
    repository.buildCommand.join("\0") !== ["bun", "scripts/aphrody/native-ci.ts", "worker"].join("\0") ||
    !/^[a-f0-9]{40}$/u.test(job.revision) ||
    !Number.isFinite(Date.parse(job.requestedAt))
  )
    throw new Error("Invalid native CI owner command or durable source identity");
  const requested = new Bun.CryptoHasher("sha256").update(job.requestedAt).digest("hex").slice(0, 12);
  return [
    ...repository.buildCommand,
    "--revision",
    job.revision,
    "--id",
    `native-${job.revision.slice(0, 12)}-${requested}`,
  ];
}
type JobHandle = { pid: number; exited: Promise<number>; unref: () => void };
type JobLauncher = (jobPath: string, logPath: string) => JobHandle;
type JobObservation = Pick<FactoryJob, "token" | "revision" | "pid" | "status" | "reconciliationRequired">;
function observedJob(path: string, job: FactoryJob): FactoryJob {
  const observation = readPrivate<JobObservation>(`${path}.observation.json`);
  if (
    ["starting", "running", "lost"].includes(job.status) &&
    observation &&
    observation.token === job.token &&
    observation.revision === job.revision &&
    ["starting", "running", "lost"].includes(observation.status)
  )
    return {
      ...job,
      pid: observation.pid ?? job.pid,
      status: observation.status,
      reconciliationRequired: observation.reconciliationRequired === true,
    };
  return job;
}
function readJob(path: string): FactoryJob | undefined {
  if (!existsSync(path)) return undefined;
  return observedJob(path, JSON.parse(readFileSync(path, "utf8")) as FactoryJob);
}
function writePrivate(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}
function live(pid: number | undefined): boolean {
  if (!pid || !Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
type WorkerProbe = { token: string; nonce: string };
type WorkerProof = WorkerProbe & {
  repo: string;
  revision: string;
  pid: number;
};
function validToken(token: string | undefined): token is string {
  return !!token && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(token);
}
function readPrivate<T>(path: string): T | undefined {
  try {
    if (statSync(path).size > 128 * 1024) return undefined;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}
/** A fresh challenge proves the worker identity across platforms, without trusting a reused PID. */
export function answerFactoryJobProbe(path: string, job: FactoryJob): () => void {
  if (!validToken(job.token)) throw new Error("Factory worker has no immutable job token");
  const respond = () => {
    const probe = readPrivate<WorkerProbe>(`${path}.probe.json`);
    if (!probe || probe.token !== job.token || !validToken(probe.nonce)) return;
    const previous = readPrivate<WorkerProof>(`${path}.owner.json`);
    if (previous?.token === probe.token && previous.nonce === probe.nonce) return;
    writePrivate(`${path}.owner.json`, {
      ...probe,
      repo: job.repo,
      revision: job.revision,
      pid: process.pid,
    } satisfies WorkerProof);
  };
  respond();
  const timer = setInterval(respond, 250);
  timer.unref();
  return () => {
    clearInterval(timer);
    for (const suffix of [".probe.json", ".owner.json"])
      if (readPrivate<WorkerProbe>(`${path}${suffix}`)?.token === job.token)
        rmSync(`${path}${suffix}`, { force: true });
  };
}
function launchFactoryWorker(jobPath: string, logPath: string): JobHandle {
  if (existsSync(logPath) && statSync(logPath).size > 20 * 1024 * 1024) renameSync(logPath, `${logPath}.previous`);
  const descriptor = openSync(logPath, "a", 0o600);
  try {
    const job = readJob(jobPath);
    if (!validToken(job?.token)) throw new Error("Factory launch has no immutable job token");
    return Bun.spawn(
      [process.execPath, join(import.meta.dir, "repo-sync.ts"), "worker", "--job", jobPath, "--token", job.token],
      {
        windowsHide: true,
        stdin: "ignore",
        stdout: descriptor,
        stderr: descriptor,
        env: process.env,
      },
    );
  } finally {
    closeSync(descriptor);
  }
}

/** One live native factory handle; newest pending revision per repo, with private durable receipts. */
export class FactoryBuildQueue {
  private readonly pending = new Map<string, string>();
  private readonly handles = new Map<string, JobHandle>();
  private readonly probes = new Map<string, WorkerProbe>();
  private readonly timer: ReturnType<typeof setInterval>;
  private stopped = false;
  constructor(
    private readonly config: SourceSyncConfig,
    private readonly directory = join(sourceSyncStateRoot(), "builds"),
    private readonly launch: JobLauncher = launchFactoryWorker,
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "pending.json");
    if (existsSync(path)) {
      const pending: Record<string, string> = JSON.parse(readFileSync(path, "utf8"));
      for (const [repo, revision] of Object.entries(pending))
        if (
          config.repositories.some(value => value.id === repo && value.buildCommand && value.buildEnabled !== false) &&
          /^[a-f0-9]{40}$/u.test(revision)
        )
          this.pending.set(repo, revision);
    }
    this.timer = setInterval(() => this.pump(), 1000);
    this.timer.unref();
  }
  private persist(): void {
    writePrivate(join(this.directory, "pending.json"), Object.fromEntries(this.pending));
  }
  enqueue(report: SyncReport): void {
    if (this.stopped || report.mode !== "apply") return;
    for (const row of report.rows) {
      if (
        row.status !== "current" ||
        !row.sourceHead ||
        row.sourceHead !== row.destinationHead ||
        !this.config.repositories.some(
          repository => repository.id === row.repo && repository.buildCommand && repository.buildEnabled !== false,
        )
      )
        continue;
      const job = readJob(join(this.directory, `${row.repo}.json`));
      if (job?.revision === row.sourceHead) continue;
      this.pending.set(row.repo, row.sourceHead);
    }
    this.persist();
    this.pump();
  }
  private pump(): void {
    if (this.stopped) return;
    // Ambiguous launches hold the queue: an absent/reused PID cannot authorize duplicate SSH work.
    for (const repository of this.config.repositories) {
      const path = join(this.directory, `${repository.id}.json`);
      const job = readJob(path);
      if (job && ["starting", "running", "lost"].includes(job.status)) {
        if (job.token && this.handles.has(job.token)) return;
        const hold = () =>
          writePrivate(`${path}.observation.json`, {
            token: job.token,
            revision: job.revision,
            pid: job.pid,
            status: live(job.pid) && job.status !== "lost" ? job.status : "lost",
            reconciliationRequired: true,
          });
        if (!validToken(job.token)) {
          if (!job.reconciliationRequired) hold();
          return;
        }
        const probe = this.probes.get(job.repo);
        const proof = readPrivate<WorkerProof>(`${path}.owner.json`);
        const verified =
          probe?.token === job.token &&
          proof?.token === job.token &&
          proof.nonce === probe.nonce &&
          proof.repo === job.repo &&
          proof.revision === job.revision &&
          live(proof.pid);
        if (verified) {
          writePrivate(`${path}.observation.json`, {
            token: job.token,
            revision: job.revision,
            pid: proof.pid,
            status: "running",
            reconciliationRequired: false,
          });
        } else if (!job.reconciliationRequired) {
          hold();
        }
        // Require a new response on the next observation; stale proof cannot adopt a recycled PID.
        if (!probe || probe.token !== job.token || verified) {
          const nextProbe = { token: job.token, nonce: crypto.randomUUID() };
          this.probes.set(job.repo, nextProbe);
          writePrivate(`${path}.probe.json`, nextProbe);
        }
        return;
      }
    }
    const selected = this.pending.entries().next().value as [string, string] | undefined;
    if (!selected) return;
    const [repo, revision] = selected;
    const path = join(this.directory, `${repo}.json`);
    const previous = readJob(path);
    this.pending.delete(repo);
    this.persist();
    if (previous?.revision === revision && ["succeeded", "failed"].includes(previous.status)) {
      this.pump();
      return;
    }
    const job: FactoryJob = {
      repo,
      revision,
      token: crypto.randomUUID(),
      status: "starting",
      phase: "prepare",
      requestedAt: new Date().toISOString(),
    };
    writePrivate(path, job);
    let child: JobHandle;
    try {
      child = this.launch(path, join(this.directory, `${repo}.log`));
    } catch {
      writePrivate(path, {
        ...job,
        status: "failed",
        exitCode: 2,
        finishedAt: new Date().toISOString(),
      });
      this.pump();
      return;
    }
    // The worker publishes its own PID/lifecycle. Parent observations must not race that receipt.
    this.handles.set(job.token!, child);
    child.unref();
    void child.exited
      .then(code => {
        this.handles.delete(job.token!);
        const finished = readJob(path);
        if (
          finished &&
          finished.token === job.token &&
          finished.revision === revision &&
          ["starting", "running", "lost"].includes(finished.status)
        )
          writePrivate(path, {
            ...finished,
            status: code === 0 ? "succeeded" : "failed",
            phase: "complete",
            exitCode: code,
            reconciliationRequired: false,
            finishedAt: new Date().toISOString(),
          });
        this.pump();
        return null;
      })
      .catch(() => {
        this.handles.delete(job.token!);
        /* A subsequent handle observation reconciles the private job state. */
      });
  }
  close(): void {
    this.stopped = true;
    clearInterval(this.timer);
    this.persist();
    // Background native workers own active jobs and remain observable after watcher stop.
  }
}

export async function runFactoryWorker(
  path: string,
  root = infraRoot(),
  invokeFactory = runBuildFactory,
  expectedStateRoot = sourceSyncStateRoot(),
  expectedToken?: string,
): Promise<number> {
  const job = readJob(path);
  if (
    !job ||
    !validToken(job.token) ||
    job.token !== expectedToken ||
    !/^[a-f0-9]{40}$/u.test(job.revision) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(job.repo) ||
    resolve(path) !== join(expectedStateRoot, "builds", `${job.repo}.json`)
  )
    throw new Error("Invalid protected factory job");
  const config = await loadSourceSyncConfig(root);
  const repository = config.repositories.find(value => value.id === job.repo);
  if (!repository?.buildCommand?.length) throw new Error("Factory job has no declared owner build command");
  const command = factoryBuildCommand(repository, job);
  const current = () => {
    const observed = readJob(path);
    return !!observed && observed.token === job.token && observed.revision === job.revision;
  };
  if (!current()) throw new Error("Factory job was superseded before preparation");
  let code = 2;
  const stopProof = answerFactoryJobProbe(path, job);
  const publish = (value: FactoryJob) => {
    if (current()) writePrivate(path, value);
  };
  try {
    publish({ ...job, pid: process.pid, status: "running", phase: "prepare" });
    code = await invokeFactory(["prepare", "--repo", job.repo, "--revision", job.revision, "--apply"], root);
    if (code === 0) {
      if (!current()) return (code = 2);
      publish({ ...job, pid: process.pid, status: "running", phase: "build" });
      code = await invokeFactory(["run", "--repo", job.repo, "--revision", job.revision, "--", ...command], root);
    }
    return code;
  } finally {
    stopProof();
    publish({
      ...job,
      pid: process.pid,
      status: code === 0 ? "succeeded" : "failed",
      phase: "complete",
      exitCode: code,
      reconciliationRequired: false,
      finishedAt: new Date().toISOString(),
    });
  }
}
function safeRevision(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value) ? value : undefined;
}
function safeDate(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
    ? value
    : undefined;
}
/** Project bounded operational metadata only; never fetch Git or expose private identity/log data. */
export async function readRepoSyncStatus(root = infraRoot(), state = sourceSyncStateRoot()) {
  const config = await loadSourceSyncConfig(root);
  const repositories = config.repositories.map(repository => ({
    repo: repository.id,
    path: repository.path,
    remote: repository.remote,
    sourceBranch: repository.sourceBranch,
    destinationBranch: repository.destinationBranch,
    buildDeclared: !!repository.buildCommand?.length,
    buildEnabled: repository.buildEnabled !== false,
  }));
  const ownerRecord = readPrivate<{ pid?: number; at?: string }>(join(state, "owner.lock"));
  const ownerPid = Number.isSafeInteger(ownerRecord?.pid) && ownerRecord!.pid! > 0 ? ownerRecord!.pid : undefined;
  const owner = {
    state: !existsSync(join(state, "owner.lock")) ? "absent" : ownerPid === undefined ? "unverified" : "recorded",
    pid: ownerPid,
    live: live(ownerPid),
    at: safeDate(ownerRecord?.at),
  };
  const directory = join(state, "builds");
  const jobs = config.repositories.map(repository => {
    const path = join(directory, `${repository.id}.json`);
    const raw = readPrivate<FactoryJob>(path);
    const job = raw && observedJob(path, raw);
    const valid =
      job?.repo === repository.id &&
      safeRevision(job.revision) &&
      ["starting", "running", "succeeded", "failed", "lost"].includes(job.status) &&
      ["prepare", "build", "complete"].includes(job.phase);
    if (!valid)
      return {
        repo: repository.id,
        status: existsSync(join(directory, `${repository.id}.json`)) ? "unverified" : "absent",
      };
    const pid = Number.isSafeInteger(job.pid) && job.pid! > 0 ? job.pid : undefined;
    return {
      repo: repository.id,
      revision: job.revision,
      pid,
      processAlive: live(pid),
      status: job.status,
      phase: job.phase,
      requestedAt: safeDate(job.requestedAt),
      finishedAt: safeDate(job.finishedAt),
      exitCode: Number.isSafeInteger(job.exitCode) ? job.exitCode : undefined,
      reconciliationRequired: job.reconciliationRequired === true,
    };
  });
  const pendingRecord = readPrivate<Record<string, unknown>>(join(directory, "pending.json"));
  const pending = Object.fromEntries(
    config.repositories.flatMap(repository => {
      const revision = safeRevision(pendingRecord?.[repository.id]);
      return revision ? [[repository.id, revision]] : [];
    }),
  );
  const latestRecord = readPrivate<SyncReport>(join(state, "latest.json"));
  const statuses = new Set([
    "absent",
    "not-repository-root",
    "invalid-branch",
    "inspection-error",
    "unowned-remote",
    "operation-in-progress",
    "fetch-error",
    "no-destination",
    "diverged",
    "ahead",
    "behind",
    "current",
    "merge-error",
    "changed",
    "push-error",
    "aborted",
  ]);
  const actions = new Set([
    "preserved",
    "fetch-failed",
    "current",
    "planned",
    "local-worktree-preserved",
    "concurrent-work-preserved",
    "fast-forwarded",
    "fetched; push not selected",
    "pushed",
    "normal-push-refused",
  ]);
  const latest =
    latestRecord?.schemaVersion === 3 &&
    ["plan", "apply"].includes(latestRecord.mode) &&
    Array.isArray(latestRecord.rows)
      ? {
          at: safeDate(latestRecord.at),
          mode: latestRecord.mode,
          rows: latestRecord.rows.flatMap(row => {
            const repository = row && repositories.find(value => value.repo === row.repo);
            if (!repository) return [];
            return [
              {
                repo: repository.repo,
                sourceHead: safeRevision(row.sourceHead),
                destinationHead: safeRevision(row.destinationHead),
                dirty: typeof row.dirty === "boolean" ? row.dirty : undefined,
                ahead: Number.isSafeInteger(row.ahead) && row.ahead! >= 0 ? row.ahead : undefined,
                behind: Number.isSafeInteger(row.behind) && row.behind! >= 0 ? row.behind : undefined,
                status: statuses.has(row.status) ? row.status : "unverified",
                action: actions.has(row.action) ? row.action : "unverified",
              },
            ];
          }),
        }
      : null;
  return {
    schemaVersion: 1,
    state: !existsSync(state)
      ? "absent"
      : owner.live
        ? "watching"
        : jobs.some(job => job.reconciliationRequired)
          ? "reconciliation-required"
          : jobs.some(job => job.processAlive && ["starting", "running"].includes(job.status))
            ? "building"
            : "idle",
    repositories,
    owner,
    latest,
    jobs,
    pending,
  };
}
export async function runRepoSync(args: string[], root = infraRoot()): Promise<number> {
  if (args[0] === "status") {
    if (args.length > 2 || (args[1] !== undefined && args[1] !== "--json")) {
      console.error("Usage: yolo ops repo-sync status [--json]");
      return 2;
    }
    try {
      console.log(JSON.stringify(await readRepoSyncStatus(root)));
      return 0;
    } catch {
      console.error("Cannot read source-sync configuration or protected operational metadata");
      return 2;
    }
  }
  if (args[0] === "worker") {
    if (args.length !== 5 || args[1] !== "--job" || !args[2] || args[3] !== "--token" || !validToken(args[4])) return 2;
    return runFactoryWorker(args[2], root, undefined, undefined, args[4]);
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: yolo ops repo-sync <plan|once|watch> [--apply] [--build] [--repo NAME] [--json]\n       yolo ops repo-sync status [--json]\n       --build prepares exact synchronized main revisions and queues declared native factory profiles",
    );
    return 0;
  }
  const builds = args.includes("--build");
  const remaining = args.filter(value => value !== "--build");
  if (builds && remaining[0] !== "plan" && !remaining.includes("--apply")) {
    console.error("Automatic native builds require --apply, or plan --build");
    return 2;
  }
  let queue: FactoryBuildQueue | undefined;
  return runSourceSync(
    remaining,
    root,
    builds
      ? {
          onReport: (report, config) => {
            if (report.mode === "plan") {
              console.log(
                JSON.stringify({
                  executed: false,
                  factory: config.repositories.map(repository => {
                    const row = report.rows.find(value => value.repo === repository.id);
                    const revision = row?.sourceHead;
                    if (!revision || !/^[a-f0-9]{40}$/u.test(revision) || !repository.buildCommand?.length)
                      return {
                        repo: repository.id,
                        buildEnabled: repository.buildEnabled !== false,
                        reason: "No verified source revision and declared command available",
                      };
                    const job: FactoryJob = {
                      repo: repository.id,
                      revision,
                      requestedAt: report.at,
                      status: "starting",
                      phase: "prepare",
                    };
                    return {
                      repo: repository.id,
                      destinationBranch: repository.destinationBranch,
                      buildEnabled: repository.buildEnabled !== false,
                      previewOnly: true,
                      revision,
                      requestedAt: job.requestedAt,
                      sourceDirty: row?.dirty,
                      command: factoryBuildCommand({ ...repository, buildEnabled: true }, job),
                      preparation: [
                        "build-factory",
                        "prepare",
                        "--repo",
                        repository.id,
                        "--revision",
                        revision,
                        "--apply",
                      ],
                    };
                  }),
                }),
              );
            } else {
              queue ??= new FactoryBuildQueue(config);
              queue.enqueue(report);
            }
          },
          onStop: () => queue?.close(),
        }
      : {},
  );
}
if (import.meta.main) process.exit(await runRepoSync(process.argv.slice(2)));
