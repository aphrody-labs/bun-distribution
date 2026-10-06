// SPDX-License-Identifier: Apache-2.0
/** Builders and readers for A2A messages, parts and tasks. */
import type {
  Artifact,
  JsonObject,
  JsonValue,
  Message,
  Part,
  SendMessageConfiguration,
  SendMessageRequest,
  SendMessageResponse,
  StreamResponse,
  Task,
} from "./generated/a2a.ts";
import { streamPayloadKind } from "./protocol.ts";

export interface PartExtras {
  metadata?: JsonObject;
  filename?: string;
  mediaType?: string;
}

export function textPart(text: string, extras: PartExtras = {}): Part {
  return { text, ...extras };
}

/** Structured data part; `mediaType` defaults to `application/json`. */
export function dataPart(data: JsonValue, extras: PartExtras = {}): Part {
  return { data, mediaType: "application/json", ...extras };
}

export function urlPart(url: string, extras: PartExtras = {}): Part {
  return { url, ...extras };
}

/** File content part: bytes are base64-encoded for the wire. */
export function rawPart(content: Uint8Array | string, extras: PartExtras = {}): Part {
  return { raw: typeof content === "string" ? content : encodeBase64(content), ...extras };
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface MessageOptions {
  messageId?: string;
  contextId?: string;
  taskId?: string;
  metadata?: JsonObject;
  extensions?: string[];
  referenceTaskIds?: string[];
}

function buildMessage(
  role: "ROLE_USER" | "ROLE_AGENT",
  content: string | Part | readonly Part[],
  options: MessageOptions,
): Message {
  const parts: Part[] =
    typeof content === "string"
      ? [textPart(content)]
      : Array.isArray(content)
        ? [...content]
        : [content as Part];
  return {
    messageId: options.messageId ?? crypto.randomUUID(),
    role,
    parts,
    ...(options.contextId ? { contextId: options.contextId } : {}),
    ...(options.taskId ? { taskId: options.taskId } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
    ...(options.extensions ? { extensions: options.extensions } : {}),
    ...(options.referenceTaskIds ? { referenceTaskIds: options.referenceTaskIds } : {}),
  };
}

/** A client message (`ROLE_USER`) from text, one part or several parts. */
export function userMessage(
  content: string | Part | readonly Part[],
  options: MessageOptions = {},
): Message {
  return buildMessage("ROLE_USER", content, options);
}

/** An agent message (`ROLE_AGENT`); mainly useful for tests and servers. */
export function agentMessage(
  content: string | Part | readonly Part[],
  options: MessageOptions = {},
): Message {
  return buildMessage("ROLE_AGENT", content, options);
}

export interface SendOptions extends MessageOptions {
  configuration?: SendMessageConfiguration;
  /** Request-level metadata (not the message metadata). */
  requestMetadata?: JsonObject;
}

/** A `SendMessageRequest` carrying one user message. */
export function sendMessageRequest(
  content: string | Part | readonly Part[],
  options: SendOptions = {},
): SendMessageRequest {
  const { configuration, requestMetadata, ...message } = options;
  return {
    message: userMessage(content, message),
    ...(configuration ? { configuration } : {}),
    ...(requestMetadata ? { metadata: requestMetadata } : {}),
  };
}

/** Text of the `text` parts, joined with a newline. */
export function partsText(parts: readonly Part[] | undefined): string {
  return (parts ?? [])
    .map((part) => part.text)
    .filter((text): text is string => typeof text === "string")
    .join("\n");
}

export function messageText(message: Message | undefined): string {
  return partsText(message?.parts);
}

export function artifactText(artifact: Artifact): string {
  return partsText(artifact.parts);
}

/** Text produced by a task: its artifacts first, else the status message. */
export function taskText(task: Task): string {
  const fromArtifacts = (task.artifacts ?? []).map(artifactText).filter((t) => t !== "");
  if (fromArtifacts.length > 0) return fromArtifacts.join("\n");
  return messageText(task.status.message);
}

/** The task of a `SendMessage` answer, when the agent created one. */
export function responseTask(response: SendMessageResponse): Task | undefined {
  return response.task;
}

/** The direct message of a `SendMessage` answer, when the agent did not create a task. */
export function responseMessage(response: SendMessageResponse): Message | undefined {
  return response.message;
}

/** Text of an answer, whichever form the agent chose. */
export function responseText(response: SendMessageResponse): string {
  return response.task ? taskText(response.task) : messageText(response.message);
}

/**
 * Fold one stream event into the task it describes. A status update replaces the status, an
 * artifact update inserts the artifact or, with `append`, extends its parts. A `message` event
 * yields no task. `undefined` stays `undefined` until a `task` or an update names the task.
 */
export function applyStreamResponse(
  current: Task | undefined,
  event: StreamResponse,
): Task | undefined {
  switch (streamPayloadKind(event)) {
    case "task":
      return event.task;
    case "statusUpdate": {
      const update = event.statusUpdate;
      if (!update) return current;
      return {
        ...(current ?? { id: update.taskId, contextId: update.contextId }),
        status: update.status,
      } as Task;
    }
    case "artifactUpdate": {
      const update = event.artifactUpdate;
      if (!update) return current;
      const base: Task =
        current ??
        ({
          id: update.taskId,
          contextId: update.contextId,
          status: { state: "TASK_STATE_WORKING" },
        } as Task);
      const artifacts = [...(base.artifacts ?? [])];
      const index = artifacts.findIndex((a) => a.artifactId === update.artifact.artifactId);
      const existing = index >= 0 ? artifacts[index] : undefined;
      if (existing && update.append) {
        artifacts[index] = { ...existing, parts: [...existing.parts, ...update.artifact.parts] };
      } else if (index >= 0) {
        artifacts[index] = update.artifact;
      } else {
        artifacts.push(update.artifact);
      }
      return { ...base, artifacts };
    }
    default:
      return current;
  }
}

/**
 * Drain a stream into its final answer: the accumulated task, or the single message of a
 * message-only stream. Returns `undefined` for an empty stream.
 */
export async function collectStream(
  stream: AsyncIterable<StreamResponse>,
): Promise<SendMessageResponse | undefined> {
  let task: Task | undefined;
  for await (const event of stream) {
    if (event.message) return { message: event.message };
    task = applyStreamResponse(task, event);
  }
  return task ? { task } : undefined;
}
