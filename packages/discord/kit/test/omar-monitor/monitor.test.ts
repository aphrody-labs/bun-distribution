// SPDX-License-Identifier: Apache-2.0
import { test, expect } from "bun:test";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Queue, type Policy, type SourceMessage, isOmar } from "../../src/omar-monitor/store.ts";
import {
  reconcile,
  safeOutput,
  parseResult,
  checkOmarMonitorUpgrade,
  checkOmarMonitorReady,
} from "../../src/omar-monitor/service.ts";
import { Codex, finalText, type Turn } from "../../src/omar-monitor/codex.ts";
import type { LabApi } from "../../src/lab/ai-lab.ts";

const fullPage: LabApi = async <T>() =>
  Array.from({ length: 100 }, (_, i) => message(String(1000 + i))) as T;
const terminalTurn = (value: unknown): Turn => ({
  id: "t",
  status: "completed",
  items: [{ type: "agentMessage", phase: "final_answer", text: JSON.stringify(value) }],
});

const policy = {
  guildId: "g",
  channelId: "c",
  omarUserIds: ["omar"],
  historyPageBudget: 3,
} as Policy;
const message = (id = "10", fields: Partial<SourceMessage> = {}): SourceMessage => ({
  id,
  channel_id: "c",
  author: { id: "omar" },
  content: "Vérifie les deux VPS",
  ...fields,
});
test("only authenticated Omar or owner messages in the declared guild/channel create work", () => {
  expect(isOmar(message(), policy)).toBe(true);
  const ownerPolicy = { ...policy, ownerId: "yoyo" };
  expect(isOmar(message("11", { author: { id: "yoyo" } }), ownerPolicy)).toBe(true);
  for (const fields of [
    { author: { id: "other" } },
    { author: { id: "omar", bot: true } },
    { webhook_id: "webhook" },
    { channel_id: "other" },
    { guild_id: "foreign" },
    { content: "  " },
  ])
    expect(isOmar(message("10", fields), ownerPolicy)).toBe(false);
});
test("gateway/history overlap and restart preserve a single running goal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omar-queue-test-"));
  let q = new Queue(join(dir, "queue.sqlite"));
  try {
    q.ingest(message(), policy, "gateway");
    q.ingest(message(), policy);
    q.update("10", { state: "executing", worker_thread: "thread-live" });
    q.close();
    q = new Queue(join(dir, "queue.sqlite"));
    expect(q.counts()).toEqual([{ state: "executing", count: 1 }]);
    expect(q.next()?.worker_thread).toBe("thread-live");
    expect(q.db.query<{ via: string }, []>("SELECT via FROM messages").get()?.via).toBe("gateway");
    q.post("99", "10", "Résultat");
    q.close();
    q = new Queue(join(dir, "queue.sqlite"));
    expect(q.posts()).toEqual([{ nonce: "99", source: "10", text: "Résultat" }]);
    q.posted("99");
    expect(q.posts()).toEqual([]);
  } finally {
    q.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("REST catch-up traverses more than 100 messages without advancing over a gap", async () => {
  const q = new Queue(":memory:");
  q.set("history_complete", "true");
  q.set("after", "1");
  const rows = Array.from({ length: 250 }, (_, i) => message(String(i + 2)));
  const api: LabApi = async <T>(path: string) => {
    const before = Number(
      new URL(`https://discord.test${path}`).searchParams.get("before") ?? "999",
    );
    return rows
      .filter((m) => Number(m.id) < before)
      .slice(-100)
      .toReversed() as T;
  };
  try {
    await reconcile(q, policy, api);
    expect(q.counts()).toEqual([{ state: "pending", count: 250 }]);
    expect(q.get("after")).toBe("251");
    await reconcile(q, policy, api);
    expect(q.counts()[0]?.count).toBe(250);
  } finally {
    q.close();
  }
});
test("a truncated history pass keeps the high-water mark until the gap is collected", async () => {
  const q = new Queue(":memory:");
  q.set("history_complete", "true");
  q.set("after", "1");
  try {
    await expect(reconcile(q, { ...policy, historyPageBudget: 1 }, fullPage)).rejects.toThrow(
      "budget",
    );
    expect(q.get("after")).toBe("1");
  } finally {
    q.close();
  }
});
test("completion requires structured evidence; terminal failures stay open", () => {
  expect(() =>
    parseResult(terminalTurn({ status: "achieved", summary: "OK", evidence: [], needs: [] })),
  ).toThrow("Unproven");
  expect(() => parseResult({ ...terminalTurn({}), status: "failed" })).toThrow("failed");
  expect(
    parseResult(
      terminalTurn({
        status: "blocked",
        summary: "Connexion",
        evidence: [],
        needs: ["Endpoint absent"],
      }),
    ).status,
  ).toBe("blocked");
  expect(
    finalText({
      id: "t",
      status: "completed",
      items: [
        { type: "agentMessage", phase: "final_answer", text: "final" },
        { type: "agentMessage", phase: "commentary", text: "interim" },
      ],
    }),
  ).toBe("final");
});
test("stream output masks credentials and long tokens", () => {
  const secret = "protected-token-123456";
  const output = safeOutput(`value=${secret} password=unknown-value sk-abcdefghijklmnop01234`, [
    secret,
  ]);
  expect(output).not.toContain(secret);
  expect(output).not.toContain("unknown-value");
  expect(output).not.toContain("sk-abc");
});
test("upgrade check requires idle drainage acknowledged by the current live process", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omar-drain-test-"));
  const configured = {
    ...policy,
    store: join(dir, "queue.sqlite"),
    receipt: join(dir, "status.json"),
  };
  const queue = new Queue(configured.store);
  const status = { pid: process.pid, draining: true, live: null, activeGoalId: null };
  try {
    await Bun.write(configured.receipt, JSON.stringify(status));
    await expect(checkOmarMonitorReady(configured, process.pid)).resolves.toEqual({
      ready: true,
      pid: process.pid,
    });
    await expect(checkOmarMonitorReady(configured, process.pid + 1)).rejects.toThrow(
      "live systemd PID",
    );
    await expect(checkOmarMonitorUpgrade(configured, process.pid)).resolves.toEqual({
      upgradeSafe: true,
      activeGoals: 0,
    });
    await expect(checkOmarMonitorUpgrade(configured, process.pid + 1)).rejects.toThrow("drainage");
    await Bun.write(configured.receipt, JSON.stringify({ ...status, activeGoalId: "reserved" }));
    await expect(checkOmarMonitorUpgrade(configured, process.pid)).rejects.toThrow("drainage");
    await Bun.write(configured.receipt, JSON.stringify(status));
    queue.ingest(message(), policy);
    queue.update("10", { state: "executing", worker_thread: "live" });
    await expect(checkOmarMonitorUpgrade(configured, process.pid)).rejects.toThrow("still active");
    expect(queue.next()?.worker_thread).toBe("live");
  } finally {
    queue.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("product capabilities need no Discord or Codex authentication", async () => {
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "../../src/omar-monitor/main.ts"), "--capabilities"],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(await child.exited).toBe(0);
  expect(await new Response(child.stdout).json()).toEqual({ upgradeProtocol: 2 });
});
test("Codex recovery reads a completed unrecorded turn without starting it again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omar-proxy-test-"));
  const path = join(dir, "fake-proxy");
  await Bun.write(
    path,
    `#!/usr/bin/env bun
import { createInterface } from 'node:readline';
const turn={id:'unrecorded',status:'completed',items:[{type:'agentMessage',text:'recovered'}]};
for await(const line of createInterface({input:process.stdin})){const m=JSON.parse(line);if(!m.id)continue; if(m.method==='turn/start'){console.log(JSON.stringify({id:m.id,error:{code:-999}}));continue;} console.log(JSON.stringify({id:m.id,result:m.method==='thread/read'?{thread:{turns:[turn]}}:{}}));}
`,
  );
  await chmod(path, 0o700);
  const codex = new Codex({ ...policy, codex: path, profile: "aphrody" });
  try {
    await codex.initialize();
    const recovered = await codex.run("thread", "input", {}, () => {}, "previous-recorded");
    expect(recovered.id).toBe("unrecorded");
    expect(finalText(recovered)).toBe("recovered");
  } finally {
    codex.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("a fresh Codex thread starts its first turn before attempting history hydration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omar-fresh-test-"));
  const path = join(dir, "fake-server");
  await Bun.write(
    path,
    `#!/usr/bin/env bun
import {createInterface} from 'node:readline';
for await(const line of createInterface({input:process.stdin})){const m=JSON.parse(line);if(!m.id)continue;
 let result={};if(m.method==='thread/start')result={thread:{id:'new-thread'}};
 if(m.method==='turn/start')result={turn:{id:'new-turn',status:'completed',items:[]}};
 if(['thread/read','thread/resume'].includes(m.method)){console.log(JSON.stringify({id:m.id,error:{code:-32600}}));continue;}
 console.log(JSON.stringify({id:m.id,result}));}
`,
  );
  await chmod(path, 0o700);
  const codex = new Codex({ ...policy, codex: path, profile: "aphrody" });
  try {
    await codex.initialize();
    const thread = await codex.thread(policy, "monitor", "read only");
    expect((await codex.run(thread, "input", {}, () => {})).id).toBe("new-turn");
  } finally {
    codex.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("observing a live turn never launches a replacement turn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omar-live-test-"));
  const path = join(dir, "fake-server");
  await Bun.write(
    path,
    `#!/usr/bin/env bun
import {createInterface} from 'node:readline';
for await(const line of createInterface({input:process.stdin})){const m=JSON.parse(line);if(!m.id)continue;
 if(m.method==='turn/start'){console.log(JSON.stringify({id:m.id,error:{code:-999}}));continue;}
 console.log(JSON.stringify({id:m.id,result:m.method==='thread/read'?{thread:{turns:[{id:'live-turn',status:'inProgress',items:[]}]}}:{}}));}
`,
  );
  await chmod(path, 0o700);
  const codex = new Codex({ ...policy, codex: path, profile: "aphrody" });
  try {
    await codex.initialize();
    await expect(
      codex.run(
        "existing",
        "input",
        {},
        (turn) => {
          expect(turn.id).toBe("live-turn");
          throw new Error("Observed existing live handle");
        },
        "previous-recorded",
      ),
    ).rejects.toThrow("Observed existing live handle");
  } finally {
    codex.close();
    await rm(dir, { recursive: true, force: true });
  }
});
