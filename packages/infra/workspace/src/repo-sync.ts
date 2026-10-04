// SPDX-License-Identifier: Apache-2.0
/** Workspace route to source-sync and the existing native build-factory owner. */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  loadSourceSyncConfig,
  runSourceSync,
  sourceSyncStateRoot,
  type SourceSyncConfig,
  type SyncReport,
} from "../../../../scripts/source-sync.ts";
import { runBuildFactory } from "./build-factory.ts";
import { infraRoot } from "./runtime.ts";

export interface FactoryJob {
  repo: string;
  revision: string;
  pid?: number;
  status: "starting" | "running" | "succeeded" | "failed" | "lost";
  phase: "prepare" | "build" | "complete";
  requestedAt: string;
  finishedAt?: string;
  exitCode?: number;
}
type JobHandle = { pid: number; exited: Promise<number>; unref: () => void };
type JobLauncher = (jobPath: string, logPath: string) => JobHandle;
function readJob(path: string): FactoryJob | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as FactoryJob;
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
function launchFactoryWorker(jobPath: string, logPath: string): JobHandle {
  if (existsSync(logPath) && statSync(logPath).size > 20 * 1024 * 1024)
    renameSync(logPath, `${logPath}.previous`);
  const descriptor = openSync(logPath, "a", 0o600);
  try {
    return Bun.spawn(
      [process.execPath, join(import.meta.dir, "repo-sync.ts"), "worker", "--job", jobPath],
      {
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
          config.repositories.some((value) => value.id === repo && value.buildCommand) &&
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
          (repository) => repository.id === row.repo && repository.buildCommand,
        )
      )
        continue;
      const job = readJob(join(this.directory, `${row.repo}.json`));
      if (job?.revision === row.sourceHead && job.status !== "lost") continue;
      this.pending.set(row.repo, row.sourceHead);
    }
    this.persist();
    this.pump();
  }
  private pump(): void {
    if (this.stopped) return;
    // State text alone is not a live job: revalidate the recorded process handle.
    for (const repository of this.config.repositories) {
      const path = join(this.directory, `${repository.id}.json`);
      const job = readJob(path);
      if (job && ["starting", "running"].includes(job.status)) {
        if (live(job.pid)) return;
        writePrivate(path, { ...job, status: "lost", finishedAt: new Date().toISOString() });
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
    const started = readJob(path) ?? job;
    writePrivate(path, { ...started, pid: child.pid });
    child.unref();
    void child.exited
      .then((code) => {
        const finished = readJob(path);
        if (finished?.revision === revision && ["starting", "running"].includes(finished.status))
          writePrivate(path, {
            ...finished,
            status: code === 0 ? "succeeded" : "failed",
            phase: "complete",
            exitCode: code,
            finishedAt: new Date().toISOString(),
          });
        this.pump();
        return null;
      })
      .catch(() => {
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
): Promise<number> {
  const job = readJob(path);
  if (
    !job ||
    !/^[a-f0-9]{40}$/u.test(job.revision) ||
    !["yolo", "aphrody", "aphrody-py"].includes(job.repo) ||
    resolve(path) !== join(expectedStateRoot, "builds", `${job.repo}.json`)
  )
    throw new Error("Invalid protected factory job");
  const config = await loadSourceSyncConfig(root);
  const repository = config.repositories.find((value) => value.id === job.repo);
  if (!repository?.buildCommand?.length)
    throw new Error("Factory job has no declared owner build command");
  let code = 2;
  try {
    writePrivate(path, { ...job, pid: process.pid, status: "running", phase: "prepare" });
    code = await invokeFactory(
      ["prepare", "--repo", job.repo, "--revision", job.revision, "--apply"],
      root,
    );
    if (code === 0) {
      writePrivate(path, { ...job, pid: process.pid, status: "running", phase: "build" });
      code = await invokeFactory(
        ["run", "--repo", job.repo, "--revision", job.revision, "--", ...repository.buildCommand],
        root,
      );
    }
    return code;
  } finally {
    writePrivate(path, {
      ...job,
      pid: process.pid,
      status: code === 0 ? "succeeded" : "failed",
      phase: "complete",
      exitCode: code,
      finishedAt: new Date().toISOString(),
    });
  }
}
export async function runRepoSync(args: string[], root = infraRoot()): Promise<number> {
  if (args[0] === "worker") {
    if (args.length !== 3 || args[1] !== "--job" || !args[2]) return 2;
    return runFactoryWorker(args[2]);
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: aphrody-ops repo-sync <plan|once|watch> [--apply] [--build] [--repo NAME] [--json]\n       --build prepares exact synchronized main revisions and queues declared native factory profiles",
    );
    return 0;
  }
  const builds = args.includes("--build");
  const remaining = args.filter((value) => value !== "--build");
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
                  factory: config.repositories.map((repository) => ({
                    repo: repository.id,
                    destinationBranch: repository.destinationBranch,
                    command: repository.buildCommand,
                    preparation: [
                      "build-factory",
                      "prepare",
                      "--repo",
                      repository.id,
                      "--revision",
                      "<synchronized-main-sha>",
                      "--apply",
                    ],
                  })),
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
