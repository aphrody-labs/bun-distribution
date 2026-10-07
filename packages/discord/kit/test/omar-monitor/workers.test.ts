// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Codex, codexCommand } from "../../src/omar-monitor/codex.ts";
import { Queue, type Job, type Policy } from "../../src/omar-monitor/store.ts";
import { WorkerPool, workerHostId } from "../../src/omar-monitor/workers.ts";

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

const policy: Policy = {
  guildId: "guild",
  channelId: "channel",
  omarUserIds: ["omar"],
  ownerId: "owner",
  envFile: "/private/env",
  store: ":memory:",
  receipt: "/private/status",
  codex: "/local/codex",
  cwd: "/local/repo",
  nativeMcp: "/local/aphrody-mcp",
  profile: "aphrody",
  reconcileSeconds: 30,
  historyPageBudget: 100,
  workerHosts: [
    { id: "omar-wsl", match: ["omar", "gpu", "entrainement"], unavailableReason: "peer offline" },
    {
      id: "owner-wsl",
      match: ["wsl", "windows", "github", "code"],
      transport: { type: "ssh", target: "aphro-wsl" },
      codex: "/host/codex",
      cwd: "/host/repo",
      nativeMcp: "/host/aphrody-mcp",
    },
  ],
};
const job = (text: string, fields: Partial<Job> = {}): Job => ({
  id: "123",
  text,
  state: "pending",
  monitor_thread: null,
  worker_thread: null,
  goals: null,
  evidence: null,
  ...fields,
});

test("device needs select complete host sessions while VPS operations remain local", () => {
  expect(workerHostId(policy, job("Corrige le code GitHub dans WSL"))).toBe("owner-wsl");
  expect(workerHostId(policy, job("Entraînement GPU sur le PC d'Omar"))).toBe("omar-wsl");
  expect(workerHostId(policy, job("Crawl et indexe le site sur le VPS"))).toBe("local");
  expect(workerHostId(policy, job("Le shortcode du site est cassé"))).toBe("local");
});

test("persisted affinity prevents moving or replaying an existing thread on another host", () => {
  expect(workerHostId(policy, job("GPU Omar", { worker_thread: "old" }))).toBe("local");
  expect(
    workerHostId(policy, job("VPS", { worker_thread: "remote", worker_host: "owner-wsl" })),
  ).toBe("owner-wsl");
  expect(workerHostId(policy, job("WSL", { worker_host: "removed" }))).toBe("removed");
});

test("SSH stdio uses existing host authentication and quotes host-local command paths", () => {
  const command = codexCommand({
    ...policy,
    codexTransport: { type: "ssh", target: "aphro-wsl" },
    codex: "/owner's path/$(touch bad)/codex",
    profile: "aphrody",
  });
  expect(command.slice(0, 2)).toEqual(["ssh", "-T"]);
  expect(command).toContain("BatchMode=yes");
  expect(command).toContain("StrictHostKeyChecking=yes");
  expect(command).toContain("SendEnv=-*");
  expect(command.at(-1)).toBe(
    "exec env APHRODY_PROFILE='aphrody' '/owner'\\''s path/$(touch bad)/codex' app-server --stdio",
  );
  expect(() =>
    codexCommand({ ...policy, codexTransport: { type: "ssh", target: "-oProxyCommand=bad" } }),
  ).toThrow("target");
});

test("default host sends new work to WSL without relocating legacy threads", () => {
  const configured = { ...policy, defaultWorkerHost: "owner-wsl" };
  expect(workerHostId(configured, job("Corrige cette erreur"))).toBe("owner-wsl");
  expect(workerHostId(configured, job("Corrige cette erreur", { worker_thread: "legacy" }))).toBe(
    "local",
  );
});

test("thread and host are persisted atomically across queue restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "worker-host-"));
  let queue = new Queue(join(dir, "queue.sqlite"));
  try {
    queue.ingest(
      { id: "123", channel_id: "channel", author: { id: "owner" }, content: "WSL" },
      policy,
    );
    queue.update("123", { worker_thread: "remote", worker_host: "owner-wsl", state: "executing" });
    queue.close();
    queue = new Queue(join(dir, "queue.sqlite"));
    expect(queue.next()?.worker_host).toBe("owner-wsl");
    expect(queue.next()?.worker_thread).toBe("remote");
  } finally {
    queue.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("unreachable or undeclared hosts block without invoking a replacement worker", async () => {
  const dir = await mkdtemp(join(tmpdir(), "worker-policy-"));
  const path = join(dir, "fake-codex");
  await Bun.write(
    path,
    `#!/usr/bin/env bun
import {createInterface} from 'node:readline';
for await(const line of createInterface({input:process.stdin})){const m=JSON.parse(line);if(m.id)console.log(JSON.stringify({id:m.id,result:{}}));}
`,
  );
  await chmod(path, 0o700);
  const local = new Codex({ ...policy, codex: path });
  const pool = new WorkerPool(policy, local);
  try {
    await local.initialize();
    expect((await pool.select(job("VPS"))).codex).toBe(local);
    await expect(pool.select(job("GPU Omar"))).rejects.toThrow("peer offline");
    await expect(pool.select(job("VPS", { worker_host: "removed" }))).rejects.toThrow("removed");
  } finally {
    pool.close();
    local.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Codex tools do not inherit the monitor's fork interpreter mode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-fork-mode-"));
  const launcher = join(dir, "codex");
  const server = join(dir, "server.ts");
  await Bun.write(
    server,
    `
import {createInterface} from 'node:readline';
for await(const line of createInterface({input:process.stdin})) {
  const m=JSON.parse(line);
  if(m.id) console.log(JSON.stringify({id:m.id,result:{profile:process.env.APHRODY_PROFILE}}));
}
`,
  );
  await Bun.write(
    launcher,
    `#!/bin/sh
if [ "\${BUN_BE_BUN+x}" = x ]; then exit 88; fi
exec env BUN_BE_BUN=1 ${shellQuote(process.execPath)} ${shellQuote(server)}
`,
  );
  await chmod(launcher, 0o700);
  const previous = process.env.BUN_BE_BUN;
  process.env.BUN_BE_BUN = "1";
  const codex = new Codex({ ...policy, codex: launcher });
  try {
    await codex.initialize();
    expect(await codex.request("fixture/environment", {})).toEqual({ profile: policy.profile });
  } finally {
    codex.close();
    process.env.BUN_BE_BUN = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
