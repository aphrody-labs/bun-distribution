// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Queue, type Policy } from "../../src/omar-monitor/store.ts";
import { recordOutcome, type Outcome } from "../../src/omar-monitor/outcome.ts";
import type { Turn } from "../../src/omar-monitor/codex.ts";

const policy = { channelId: "c", guildId: "g", omarUserIds: ["omar"] } as Policy;
const turn = (id: string): Turn => ({ id, status: "completed", items: [] });
const result: Outcome = {
  status: "continue",
  summary: "Information manquante",
  evidence: ["État vérifié"],
  needs: ["Texte de la demande"],
};
function open(path = ":memory:") {
  const q = new Queue(path);
  q.ingest({ id: "1", channel_id: "c", author: { id: "omar" }, content: "Demande" }, policy);
  q.ingest({ id: "2", channel_id: "c", author: { id: "omar" }, content: "Suite" }, policy);
  return q;
}

test("three contradictory continue/needs turns release the next request despite rewording", () => {
  const q = open();
  try {
    const job = q.next()!;
    expect(recordOutcome(q, job, turn("a"), result, "c", 0).status).toBe("continue");
    expect(
      recordOutcome(
        q,
        job,
        turn("b"),
        { ...result, summary: "Toujours absent", needs: ["Fournir le texte de la demande"] },
        "c",
        10000,
      ).status,
    ).toBe("continue");
    expect(q.next()?.id).toBe("1");
    expect(recordOutcome(q, job, turn("c"), result, "c", 20000).status).toBe("blocked");
    expect(q.next()?.id).toBe("2");
    expect(q.posts().length).toBe(2);
    expect(q.posts()[1]?.text).toContain("Dépendance requise");
  } finally {
    q.close();
  }
});

test("re-reading an already committed turn neither counts twice nor duplicates delivery", () => {
  const q = open();
  try {
    const job = q.next()!;
    recordOutcome(q, job, turn("a"), result, "c", 0);
    recordOutcome(q, job, turn("a"), result, "c", 80000);
    expect(JSON.parse(q.get("dependency:1")!).count).toBe(1);
    expect(q.posts().length).toBe(1);
    expect(recordOutcome(q, job, turn("b"), result, "c", 90000).status).toBe("continue");
  } finally {
    q.close();
  }
});

test("progress without a missing prerequisite resets the contract audit", () => {
  const q = open();
  try {
    const job = q.next()!;
    recordOutcome(q, job, turn("a"), result, "c", 0);
    recordOutcome(q, job, turn("b"), result, "c", 10000);
    recordOutcome(q, job, turn("c"), { ...result, needs: [] }, "c", 20000);
    expect(recordOutcome(q, job, turn("d"), result, "c", 30000).status).toBe("continue");
    recordOutcome(q, job, turn("e"), { ...result, needs: ["Endpoint absent"] }, "c", 40000);
    expect(JSON.parse(q.get("dependency:1")!).count).toBe(2);
    expect(q.next()?.id).toBe("1");
  } finally {
    q.close();
  }
});

test("dependency streak and intermediate delivery limits survive a restart; final proof is always queued", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omar-outcome-"));
  let q = open(join(dir, "queue.sqlite"));
  try {
    recordOutcome(q, q.next()!, turn("a"), result, "c", 1000);
    q.close();
    q = open(join(dir, "queue.sqlite"));
    recordOutcome(q, q.next()!, turn("b"), result, "c", 11000);
    expect(q.posts().length).toBe(1);
    recordOutcome(
      q,
      q.next()!,
      turn("c"),
      { ...result, status: "achieved", needs: [] },
      "c",
      12000,
    );
    expect(q.posts().length).toBe(2);
    expect(q.posts()[1]?.text).toContain("Objectifs vérifiés");
    expect(q.next()?.id).toBe("2");
  } finally {
    q.close();
    await rm(dir, { recursive: true, force: true });
  }
});
