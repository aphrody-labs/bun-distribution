// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  drainSourceController,
  runSourceControllerLoop,
  sourceControllerCommand,
  startSourceControllerWorker,
  type SourceControllerProfile,
} from "./shenron-source-controller";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const profile: SourceControllerProfile = {
  host: "dbfr",
  runtime: { path: "/private/runtime", sha256: "1".repeat(64) },
  owner: { path: "/private/owner.mjs", sha256: "2".repeat(64) },
  jobConfig: { path: "/private/source-job.json", sha256: "3".repeat(64) },
};
test("factory uses only fixed pinned remote owner and Ubuntu keyring identity", async () => {
  const command = sourceControllerCommand(profile);
  expect(command).toContain('test "$(id -u)" = 1000');
  expect(command).toContain("sha256sum");
  expect(command).toContain("source-job drain --config");
  let target = "";
  expect(
    await drainSourceController(profile, {
      remote: async (host, text) => {
        target = host;
        expect(text).toBe(command);
        return JSON.stringify({ status: "complete", handled: 1 });
      },
    }),
  ).toEqual({ status: "complete", handled: 1 });
  expect(target).toBe("dbfr");
  expect(() =>
    sourceControllerCommand({
      ...profile,
      owner: { ...profile.owner, path: "/private/$(touch-pwn)" },
    }),
  ).toThrow("fixed absolute");
  await expect(
    drainSourceController(profile, {
      remote: async () => JSON.stringify({ status: "complete", handled: 100 }),
    }),
  ).rejects.toThrow("bounded receipt");
});
test("factory controller stops after its current bounded request without another poll", async () => {
  const abort = new AbortController();
  let entered!: () => void,
    release!: () => void,
    calls = 0;
  const start = new Promise<void>((resolve) => {
      entered = resolve;
    }),
    waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
  const loop = runSourceControllerLoop(profile, {
    signal: abort.signal,
    remote: async () => {
      calls++;
      entered();
      await waiting;
      return JSON.stringify({ status: "idle", handled: 0 });
    },
  });
  await start;
  abort.abort();
  release();
  await loop;
  expect(calls).toBe(1);
});
test("same-service worker readiness prevents early stop races and joins gracefully", async () => {
  const root = await mkdtemp(join(tmpdir(), "shenron-controller-"));
  roots.push(root);
  const entry = join(root, "worker.ts"),
    stopped = join(root, "stopped");
  await Bun.write(
    entry,
    `process.on("SIGUSR1",async()=>{await Bun.write(${JSON.stringify(stopped)},"stopped");process.disconnect();process.exit(0);});process.send({schema:"shenron-source-controller-ready/v1"});setInterval(()=>{},1000);`,
  );
  const worker = await startSourceControllerWorker(Bun.which("bun")!, entry, process.env, {
    joinMs: 1000,
  });
  await worker.stop();
  expect(await Bun.file(stopped).text()).toBe("stopped");
});
test("join deadline kills the owned process group including noncooperative descendants", async () => {
  const root = await mkdtemp(join(tmpdir(), "shenron-controller-kill-"));
  roots.push(root);
  const entry = join(root, "worker.ts"),
    pidFile = join(root, "leaf.pid");
  await Bun.write(
    entry,
    `process.on("SIGUSR1",()=>{});process.on("SIGTERM",()=>{});const leaf=Bun.spawn([process.execPath,"-e",'process.on("SIGTERM",()=>{});console.log("ready");setInterval(()=>{},1000);'],{stdin:"ignore",stdout:"pipe",stderr:"ignore"});await leaf.stdout.getReader().read();await Bun.write(${JSON.stringify(pidFile)},String(leaf.pid));process.send({schema:"shenron-source-controller-ready/v1"});setInterval(()=>{},1000);`,
  );
  const worker = await startSourceControllerWorker(Bun.which("bun")!, entry, process.env, {
    joinMs: 30,
    killMs: 20,
    reapMs: 1000,
  });
  const pid = Number(await Bun.file(pidFile).text());
  await expect(worker.stop()).rejects.toThrow("join deadline");
  let stopped = false;
  try {
    stopped = /^\d+\s+\(.+\)\s+Z\s/.test(await Bun.file("/proc/" + pid + "/stat").text());
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
    stopped = true;
  }
  expect(stopped).toBe(true);
});
