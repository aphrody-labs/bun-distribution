// SPDX-License-Identifier: Apache-2.0
/** A2A 1.0 protocol constants shared by the client, the legacy shim and the tests. */
import type { StreamResponse, TaskState } from "./generated/a2a.ts";

/** `Major.Minor` of the specification this client speaks. Patch versions never travel on the wire. */
export const A2A_PROTOCOL_VERSION = "1.0";
/** Service parameter carrying the protocol version (HTTP header). */
export const A2A_VERSION_HEADER = "A2A-Version";
/** Service parameter carrying the comma-separated extension URIs (HTTP header). */
export const A2A_EXTENSIONS_HEADER = "A2A-Extensions";
/** Well-known Agent Card location, relative to the agent origin. */
export const WELL_KNOWN_AGENT_CARD_PATH = "/.well-known/agent-card.json";
/** Media type registered for the HTTP+JSON binding (IANA, spec 14.1.1). */
export const A2A_JSON_MEDIA_TYPE = "application/a2a+json";

/** Protocol bindings this client can drive. `GRPC` is declared by agents but is not implemented here. */
export const SUPPORTED_BINDINGS = ["JSONRPC", "HTTP+JSON"] as const;
export type SupportedBinding = (typeof SUPPORTED_BINDINGS)[number];

/** Task states after which a task never changes again. */
export const TERMINAL_TASK_STATES: readonly TaskState[] = [
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_REJECTED",
];

/** Task states waiting for the client (input or credentials). */
export const INTERRUPTED_TASK_STATES: readonly TaskState[] = [
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_AUTH_REQUIRED",
];

export function isTerminalState(state: TaskState | undefined): boolean {
  return state !== undefined && TERMINAL_TASK_STATES.includes(state);
}

export function isInterruptedState(state: TaskState | undefined): boolean {
  return state !== undefined && INTERRUPTED_TASK_STATES.includes(state);
}

/** The single member present in a `StreamResponse` or `SendMessageResponse`. */
export type StreamPayloadKind = "task" | "message" | "statusUpdate" | "artifactUpdate";

const PAYLOAD_KEYS: readonly StreamPayloadKind[] = [
  "task",
  "message",
  "statusUpdate",
  "artifactUpdate",
];

/** Which of the oneof members is set, or `undefined` when the object is not a stream payload. */
export function streamPayloadKind(value: unknown): StreamPayloadKind | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const present = PAYLOAD_KEYS.filter(
    (key) => (value as Record<string, unknown>)[key] !== undefined,
  );
  return present.length === 1 ? present[0] : undefined;
}

/** Validate that a decoded JSON value is a `StreamResponse` (exactly one payload member). */
export function asStreamResponse(value: unknown): StreamResponse {
  if (streamPayloadKind(value) === undefined) {
    throw new TypeError(
      "not an A2A StreamResponse: exactly one of task, message, statusUpdate, artifactUpdate is required",
    );
  }
  return value as StreamResponse;
}
