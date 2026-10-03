// SPDX-License-Identifier: Apache-2.0
/** Bot-specific A2A routes backed by the shared Shenron HTTP transport owner. */

import {
  A2A_DEFAULT_URL,
  A2A_URL_ENV,
  a2aBaseUrl,
  fetchA2AAgentCard,
  fetchA2ACoordStream,
  fetchA2AEnvelopes,
  postA2AEnvelope,
  postA2AJsonRpc,
  postA2AJsonRpcStream,
  type UpstreamReply,
} from "@shenron/pipeline/aphrody/a2a-transport";

export { A2A_DEFAULT_URL, A2A_URL_ENV, a2aBaseUrl };
export type { UpstreamReply };

/** Legacy pre-1.0 methods still sent by older peers, renamed for A2A 1.0. */
export const LEGACY_METHOD_ALIASES: Readonly<Record<string, string>> = {
  "tasks/get": "GetTask",
  "tasks/list": "ListTasks",
  "tasks/cancel": "CancelTask",
  "message/stream": "SendStreamingMessage",
  "tasks/resubscribe": "SubscribeToTask",
  "agent/getAuthenticatedExtendedCard": "GetExtendedAgentCard",
};

/** Methods that return an SSE stream from the Rust listener. */
export const STREAMING_METHODS: ReadonlySet<string> = new Set([
  "message/stream",
  "tasks/resubscribe",
]);

export function fetchAgentCard(): Promise<UpstreamReply> {
  return fetchA2AAgentCard();
}

export function fetchEnvelopes(limit = 100): Promise<UpstreamReply> {
  return fetchA2AEnvelopes(limit, "application/x-ndjson");
}

export function postEnvelope(envelope: unknown): Promise<UpstreamReply> {
  return postA2AEnvelope(envelope);
}

export function postJsonRpc(body: unknown): Promise<UpstreamReply> {
  return postA2AJsonRpc(body, LEGACY_METHOD_ALIASES);
}

export function postJsonRpcStream(body: unknown): Promise<Response | UpstreamReply> {
  return postA2AJsonRpcStream(body, LEGACY_METHOD_ALIASES);
}

export function fetchCoordStream(): Promise<Response | UpstreamReply> {
  return fetchA2ACoordStream();
}
