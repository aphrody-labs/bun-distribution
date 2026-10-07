// SPDX-License-Identifier: Apache-2.0
import type { Turn } from "./codex.ts";
import { Queue, type Job } from "./store.ts";

export interface Outcome {
  status: "achieved" | "blocked" | "continue";
  summary: string;
  evidence: string[];
  needs: string[];
}

/** Commit a terminal turn once. Repeated missing prerequisites must not monopolize the queue. */
export function recordOutcome(
  queue: Queue,
  job: Job,
  turn: Turn,
  result: Outcome,
  channelId: string,
  now = Date.now(),
): Outcome {
  return queue.db.transaction(() => {
    if (queue.get(`processed:${job.id}`) === turn.id) {
      const stored = queue.db.query<Job, [string]>("SELECT * FROM jobs WHERE id=?").get(job.id);
      return stored?.evidence ? (JSON.parse(stored.evidence) as Outcome) : result;
    }
    const key = `dependency:${job.id}`;
    const prior = JSON.parse(queue.get(key) ?? "null") as { count: number } | null;
    const needs = result.needs.map((need) => need.trim()).filter(Boolean);
    // needs is reserved for missing prerequisites. Three consecutive contradictory
    // continue/needs outcomes trigger the same contract audit even if wording changes.
    const count = result.status === "continue" && needs.length ? (prior?.count ?? 0) + 1 : 0;
    queue.set(key, JSON.stringify({ count }));
    const outcome: Outcome = count >= 3 ? { ...result, status: "blocked", needs } : result;
    queue.update(job.id, {
      state: outcome.status === "continue" ? "executing" : outcome.status,
      evidence: JSON.stringify({
        threadId: job.worker_thread,
        workerHost: job.worker_host ?? "local",
        turnId: turn.id,
        ...outcome,
      }),
    });
    queue.set(`processed:${job.id}`, turn.id);
    const lastPost = queue.get(`outcome-post:${job.id}`);
    // Persist every turn, but rate-limit intermediate reports across restarts.
    if (outcome.status !== "continue" || lastPost === null || now - Number(lastPost) >= 60000) {
      queue.post(
        String(Bun.hash(turn.id)),
        job.id,
        `${outcome.status === "achieved" ? "Objectifs vérifiés" : outcome.status === "blocked" ? "Dépendance requise" : "Travail en cours"}\n${outcome.summary}\n${(outcome.status === "blocked" ? outcome.needs : outcome.evidence).join("\n")}`,
        channelId,
      );
      queue.set(`outcome-post:${job.id}`, String(now));
    }
    return outcome;
  })();
}
