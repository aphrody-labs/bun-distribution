#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop -- Resumable chunks and state transitions must execute sequentially. */
// Infrastructure orchestration for the canonical @aphrody/google Drive sync.
import { watch } from "node:fs";
import { statePath, workspacePath } from "@aphrody/paths";
import { infraRoot } from "./runtime.ts";

const ROOT = process.env.APHRODY_ROOT ?? infraRoot();
const ENV = `${ROOT}/.env`;
const YOLO_CLI = `${ROOT}/apps/yolo/cli/src/index.ts`;
const WORKSPACE = statePath("workspaces", "dbfr");
const MEMORY_DB = process.env.APHRODY_AGENT_HOME_MEMORY_DB ?? `${WORKSPACE}/db/agent.db`;
const MEMORY_BIN =
  process.env.APHRODY_AGENT_HOME_MEMORY_BIN ?? Bun.which("aphrody-agent-home-memory") ?? "";
const TRAIN_BIN = process.env.APHRODY_AGENT_TRAIN_BIN ?? Bun.which("aphrody-agent-train") ?? "";
const TRAIN_CONFIG = statePath("private", "agent-training.json");
const TRAIN_STATE = statePath("train", "dbfr", "pipeline-state.json");
const DEFAULT_DOCS = new Set<string>(
  (await Bun.file(`${ROOT}/crates/ai/agent-home/sync-contract.json`).json()) as string[],
);
let running = false;
let pending = false;
let debounce: ReturnType<typeof setTimeout> | undefined;

async function ensureMemoryBinary(): Promise<void> {
  if (!MEMORY_BIN || !(await Bun.file(MEMORY_BIN).exists()))
    throw new Error("Install aphrody-agent-home-memory or set APHRODY_AGENT_HOME_MEMORY_BIN");
}

async function ensureTrainingBinary(): Promise<void> {
  if (!TRAIN_BIN || !(await Bun.file(TRAIN_BIN).exists()))
    throw new Error("Install aphrody-agent-train or set APHRODY_AGENT_TRAIN_BIN");
}

async function sync(): Promise<void> {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  try {
    do {
      pending = false;
      const task = Bun.spawn(
        [process.execPath, `--env-file=${ENV}`, YOLO_CLI, "google", "drive", "sync", "--download-only"],
        {
          cwd: ROOT,
          stdin: "ignore",
          stdout: "inherit",
          stderr: "inherit",
        },
      );
      const result = await task.exited;
      if (result !== 0) throw new Error(`Canonical Google Drive sync exited ${result}`);
      await ensureMemoryBinary();
      const memory = Bun.spawn([MEMORY_BIN], {
        cwd: ROOT,
        env: {
          ...process.env,
          APHRODY_AGENT_HOME: WORKSPACE,
          APHRODY_AGENT_HOME_MEMORY_DB: MEMORY_DB,
        },
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
      });
      const memoryResult = await memory.exited;
      if (memoryResult !== 0)
        throw new Error(`Agent Home memory reconciliation exited ${memoryResult}`);
      await ensureTrainingBinary();
      const training = Bun.spawn([TRAIN_BIN], {
        cwd: ROOT,
        env: {
          ...process.env,
          APHRODY_ROOT: workspacePath(),
          APHRODY_AGENT_HOME: WORKSPACE,
          APHRODY_AGENT_TRAIN_CONFIG: TRAIN_CONFIG,
          APHRODY_AGENT_TRAIN_STATE: TRAIN_STATE,
        },
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
      });
      const trainingResult = await training.exited;
      if (trainingResult !== 0) throw new Error(`Agent training pipeline exited ${trainingResult}`);
    } while (pending);
  } finally {
    running = false;
  }
}

if (Bun.argv.includes("daemon")) {
  const watcher = watch(WORKSPACE, (_event, filename) => {
    if (!filename || !DEFAULT_DOCS.has(filename.toString())) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void sync().catch(console.error), 2_000);
  });
  const job = Bun.cron("*/5 * * * *", async () => {
    try {
      await sync();
    } catch (error) {
      console.error(error);
    }
  });
  function stop(): void {
    watcher.close();
    job.stop();
    if (debounce) clearTimeout(debounce);
  }
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  await sync();
} else {
  await sync();
}
