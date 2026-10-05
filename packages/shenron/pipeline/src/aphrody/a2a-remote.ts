// SPDX-License-Identifier: Apache-2.0
/** Thin client for Aphrody's namespaced durable A2A task and mailbox API. */

import type { A2AEnvelope, A2ATask, A2ATarget } from "./a2a";

const AGENT = "shenron-dragonball";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const TARGETS = new Set<A2ATarget>([
  "codex",
  "agycli",
  "claude",
  "local_model",
  "rag",
  "subagents",
  "ocr",
  "translation",
  "broadcast",
]);
const TASK_STATUSES = new Set([
  "submitted",
  "working",
  "input_required",
  "completed",
  "failed",
  "canceled",
]);
const VERDICTS = new Set(["FAIT", "INCOMPLET", "NON_FAIT"]);
const ENVELOPE_KINDS = new Set(["ask", "fact", "ack", "ping", "error"]);
const ARTIFACT_TYPES = new Set(["json", "markdown", "code", "file"]);

class CoordApiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
    message: string,
  ) {
    super(message);
    this.name = "CoordApiHttpError";
  }
}

function configuredBase(): string | undefined {
  const value = process.env.APHRODY_A2A_COORD_API?.trim();
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("APHRODY_A2A_COORD_API must be a valid credential-free HTTP(S) URL");
  }
  if (!(url.protocol === "http:" || url.protocol === "https:") || url.username || url.password) {
    throw new Error("APHRODY_A2A_COORD_API must be a valid credential-free HTTP(S) URL");
  }
  return value.replace(/\/+$/, "");
}

function missingApiError(): Error {
  return new Error("APHRODY_A2A_COORD_API is required for durable A2A storage in production");
}

export function aphrodyA2aStoreEnabled(): boolean {
  const base = configuredBase();
  if (!base && process.env.NODE_ENV === "production") throw missingApiError();
  return Boolean(base);
}

function timeoutMs(): number {
  const configured = process.env.APHRODY_A2A_COORD_TIMEOUT_MS?.trim();
  if (!configured) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(configured);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("APHRODY_A2A_COORD_TIMEOUT_MS must be a positive integer");
  }
  return Math.min(parsed, MAX_TIMEOUT_MS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMessage(value: unknown): boolean {
  if (!isRecord(value) || !["user", "agent", "system"].includes(String(value.role))) return false;
  if (!Array.isArray(value.parts)) return false;
  return value.parts.every((part) => {
    if (!isRecord(part)) return false;
    if (part.type === "text") return typeof part.text === "string";
    if (part.type === "data") return isRecord(part.data);
    if (part.type === "file") return isRecord(part.file) && typeof part.file.name === "string";
    return false;
  });
}

function isArtifact(value: unknown): boolean {
  return (
    isRecord(value) && typeof value.name === "string" && ARTIFACT_TYPES.has(String(value.type))
  );
}

function isTask(value: unknown): value is A2ATask {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    TARGETS.has(value.target as A2ATarget) &&
    TASK_STATUSES.has(String(value.status)) &&
    typeof value.description === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.history) &&
    value.history.every(isMessage) &&
    Array.isArray(value.artifacts) &&
    value.artifacts.every(isArtifact) &&
    isRecord(value.metadata) &&
    (value.verdict === undefined || VERDICTS.has(String(value.verdict))) &&
    (value.resultMarkdown === undefined || typeof value.resultMarkdown === "string") &&
    (value.resultData === undefined || isRecord(value.resultData))
  );
}

function isEnvelope(value: unknown): value is A2AEnvelope {
  if (!isRecord(value)) return false;
  return (
    Number.isSafeInteger(value.v) &&
    (value.v as number) > 0 &&
    typeof value.ts === "string" &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.from === "string" &&
    typeof value.to === "string" &&
    ENVELOPE_KINDS.has(String(value.kind)) &&
    typeof value.topic === "string" &&
    typeof value.body === "string" &&
    (value.re === undefined || typeof value.re === "string") &&
    (value.taskId === undefined || typeof value.taskId === "string") &&
    (value.verdict === undefined || VERDICTS.has(String(value.verdict))) &&
    (value.channel_hint === undefined ||
      (Array.isArray(value.channel_hint) &&
        value.channel_hint.every((hint) => typeof hint === "string"))) &&
    (value.artifacts === undefined ||
      (Array.isArray(value.artifacts) && value.artifacts.every(isArtifact)))
  );
}

function invalidResponse(operation: string): Error {
  return new Error(`Aphrody A2A store returned an invalid ${operation} response`);
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const base = configuredBase();
  if (!base) {
    if (process.env.NODE_ENV === "production") throw missingApiError();
    throw new Error("APHRODY_A2A_COORD_API is not configured");
  }
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body !== undefined) headers.set("Content-Type", "application/json");
  const token = process.env.APHRODY_A2A_COORD_TOKEN?.trim();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const timeout = timeoutMs();
  const signal = AbortSignal.timeout(timeout);
  let response: Response;
  try {
    response = await fetch(`${base}/coord/${AGENT}/${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw new Error(`Aphrody A2A store timed out after ${timeout} ms`, { cause: error });
    throw error;
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (signal.aborted) throw new Error(`Aphrody A2A store timed out after ${timeout} ms`);
    if (response.ok) throw invalidResponse("JSON");
  }
  if (!response.ok) {
    const detail =
      isRecord(payload) && typeof payload.error === "string" ? payload.error : response.statusText;
    throw new CoordApiHttpError(
      response.status,
      payload,
      `Aphrody A2A store ${response.status}: ${detail}`,
    );
  }
  return payload;
}

export async function createRemoteTask(task: A2ATask): Promise<void> {
  const result = await request("tasks", { method: "POST", body: JSON.stringify(task) });
  if (!isTask(result) || result.id !== task.id) throw invalidResponse("task create");
}

export async function putRemoteTask(task: A2ATask): Promise<void> {
  const result = await request(`tasks/${encodeURIComponent(task.id)}`, {
    method: "PUT",
    body: JSON.stringify(task),
  });
  if (!isTask(result) || result.id !== task.id) throw invalidResponse("task update");
}

export async function getRemoteTask(taskId: string): Promise<A2ATask | undefined> {
  let result: unknown;
  try {
    result = await request(`tasks/${encodeURIComponent(taskId)}`);
  } catch (error) {
    if (
      error instanceof CoordApiHttpError &&
      error.status === 404 &&
      isRecord(error.payload) &&
      error.payload.error === "task not found"
    ) {
      return undefined;
    }
    throw error;
  }
  if (!isTask(result) || result.id !== taskId) throw invalidResponse("task get");
  return result;
}

export async function listRemoteTasks(target?: A2ATarget): Promise<A2ATask[]> {
  const query = target ? `?target=${encodeURIComponent(target)}` : "";
  const result: unknown = await request(`tasks${query}`);
  if (
    !isRecord(result) ||
    !Array.isArray(result.tasks) ||
    !Number.isSafeInteger(result.total) ||
    (result.total as number) < result.tasks.length ||
    !result.tasks.every(isTask) ||
    (target && result.tasks.some((task) => task.target !== target))
  ) {
    throw invalidResponse("task list");
  }
  return result.tasks;
}

export async function appendRemoteEnvelope(envelope: A2AEnvelope): Promise<void> {
  const result: unknown = await request("envelopes", {
    method: "POST",
    body: JSON.stringify(envelope),
  });
  if (!isRecord(result) || result.ok !== true || result.id !== envelope.id) {
    throw invalidResponse("envelope append");
  }
}

export async function listRemoteEnvelopes(limit = 100): Promise<A2AEnvelope[]> {
  const safeLimit = Math.max(1, Math.min(5000, Math.trunc(limit)));
  const result: unknown = await request(`envelopes?limit=${safeLimit}`);
  if (
    !isRecord(result) ||
    !Array.isArray(result.envelopes) ||
    !Number.isSafeInteger(result.total) ||
    (result.total as number) < result.envelopes.length ||
    !result.envelopes.every(isEnvelope)
  ) {
    throw invalidResponse("envelope list");
  }
  return result.envelopes;
}
