import { resolve, dirname } from "node:path";
import { open } from "node:fs/promises";
import { type Config, SyncEngine, atomicWrite } from "./sync";

const root = resolve(import.meta.dir, "../../..");
const command = Bun.argv[2] ?? "sync";
const args = Bun.argv.slice(3);
function option(name: string, fallback: string) {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
}
const config = (await Bun.file(new URL("../sources.json", import.meta.url)).json()) as Config;
const selected = option("--topics", config.topics.map(topic => topic.id).join(",")).split(",");
const topics = selected.map(id => {
  const topic = config.topics.find(topic => topic.id === id);
  if (!topic) throw new Error(`Unknown documentation topic: ${id}`);
  return topic;
});
const output = resolve(root, "docs");
const checkout = process.env.APHRODY_BUN_CHECKOUT ?? resolve(root, "../bun");
const controller = new AbortController();
const budget = Number(option("--budget-seconds", "1800"));
if (!Number.isFinite(budget) || budget <= 0) throw new Error("Invalid synchronization time budget");
const deadline = setTimeout(
  () => controller.abort(new Error(`Documentation run budget reached (${budget}s)`)),
  budget * 1000,
);
process.on("SIGINT", () => controller.abort(new Error("Interrupted by operator")));
process.on("SIGTERM", () => controller.abort(new Error("Terminated by operator")));
const engine = new SyncEngine(config, { output, checkout, signal: controller.signal });

async function lock() {
  const path = resolve(output, "autosync/run.lock");
  await Bun.$`mkdir -p ${dirname(path)}`.quiet();
  try {
    const existing = (await Bun.file(path).json()) as { pid: number };
    let alive = false;
    try {
      process.kill(existing.pid, 0);
      alive = true;
    } catch {}
    if (alive) throw new Error(`Documentation synchronization already running as PID ${existing.pid}`);
    await Bun.file(path)
      .delete()
      .catch(() => {});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const handle = await open(path, "wx");
  await handle.writeFile(
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), runtime: Bun.version }),
  );
  await handle.close();
  return async () => {
    await Bun.file(path)
      .delete()
      .catch(() => {});
  };
}

async function synchronize() {
  const unlock = await lock();
  const statePath = resolve(output, "autosync/state.json");
  const state: {
    pid: number;
    runtime: string;
    revision: string;
    status: string;
    startedAt: string;
    heartbeatAt: string;
    selected: string[];
    currentTopic?: string;
    results: unknown[];
    error?: string;
    finishedAt?: string;
  } = {
    pid: process.pid,
    runtime: Bun.version,
    revision: Bun.revision,
    status: "running",
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    selected,
    results: [],
  };
  await atomicWrite(statePath, JSON.stringify(state, null, 2));
  let heartbeatWrite = Promise.resolve();
  const heartbeat = setInterval(() => {
    state.heartbeatAt = new Date().toISOString();
    heartbeatWrite = heartbeatWrite
      .then(() => atomicWrite(statePath, JSON.stringify(state, null, 2)))
      .catch(error => controller.abort(error));
  }, 20000);
  try {
    for (const topic of topics) {
      controller.signal.throwIfAborted();
      state.currentTopic = topic.id;
      const manifest = await engine.syncTopic(topic);
      state.results.push({
        topic: topic.id,
        status: manifest.status,
        expected: manifest.expected,
        succeeded: manifest.succeeded,
        failed: manifest.failed,
        errors: manifest.errors,
      });
      await atomicWrite(statePath, JSON.stringify(state, null, 2));
    }
    state.status = state.results.every(result => (result as { status: string }).status === "complete")
      ? "complete"
      : "incomplete";
  } catch (error) {
    state.status = controller.signal.aborted ? "interrupted" : "failed";
    state.error = String(error);
  } finally {
    clearInterval(heartbeat);
    await heartbeatWrite;
    state.finishedAt = new Date().toISOString();
    await atomicWrite(statePath, JSON.stringify(state, null, 2));
    await unlock();
  }
  console.log(JSON.stringify(state, null, 2));
  if (state.status !== "complete") process.exitCode = 1;
}

try {
  if (command === "sync") await synchronize();
  else if (command === "check") {
    const results = [];
    for (const topic of topics) results.push(await engine.check(topic));
    console.log(
      JSON.stringify(
        results.map(result => ({
          ...result,
          errors: result.errors.slice(0, 30),
          errorCount: result.errors.length,
        })),
        null,
        2,
      ),
    );
    if (results.some(result => !result.ok)) process.exitCode = 1;
  } else if (command === "watch") {
    throw new Error(
      "Use the daily Windows task installed by scripts/install-docs-autosync.ps1; each run has its own bounded time budget and resumable manifests",
    );
  } else throw new Error(`Unknown documentation command: ${command}`);
} finally {
  clearTimeout(deadline);
}
