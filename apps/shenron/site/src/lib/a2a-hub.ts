// SPDX-License-Identifier: Apache-2.0
/**
 * a2a-hub.ts — client of the Rust A2A server served by `aphrody a2a serve`
 * (crates/os/a2a-coord listener + crates/os/a2a-server routers).
 *
 * Upstream routes used:
 * - GET  /.well-known/agent-card.json  agent card
 * - GET  /coord                        mailbox snapshot (JSONL)
 * - POST /msg                          raw `.coord` envelope
 * - POST /a2a                          legacy JSON-RPC `message/send` bridge
 * - POST /                             A2A 1.0 JSON-RPC (SendMessage, GetTask, ListTasks, ...)
 *
 * Base URL: `APHRODY_A2A_URL`, default `http://127.0.0.1:8788` (the `serve --bind`
 * default). Read per call, never at module load.
 */

import { ShenronA2AHub, type AdminNotifier } from "@shenron/pipeline/aphrody/a2a";
import {
  A2A_DEFAULT_URL,
  A2A_URL_ENV,
  LEGACY_SEND_METHOD,
  a2aBaseUrl,
  fetchA2AAgentCard,
  fetchA2AEnvelopes,
  postA2AEnvelope,
  postA2AJsonRpc,
  type UpstreamReply,
} from "@shenron/pipeline/aphrody/a2a-transport";

export { A2A_DEFAULT_URL, A2A_URL_ENV, LEGACY_SEND_METHOD, a2aBaseUrl };
export type { UpstreamReply };

/** Legacy task methods still sent by older peers, renamed for the A2A 1.0 root. */
export const LEGACY_METHOD_ALIASES: Readonly<Record<string, string>> = {
  "tasks/get": "GetTask",
  "tasks/list": "ListTasks",
  "tasks/cancel": "CancelTask",
};

/** Agent card of the upstream server. */
export function fetchAgentCard(): Promise<UpstreamReply> {
  return fetchA2AAgentCard({ noStore: true });
}

/** Last `limit` mailbox envelopes from the upstream JSONL snapshot. */
export function fetchEnvelopes(limit = 100): Promise<UpstreamReply> {
  return fetchA2AEnvelopes(limit, "application/x-ndjson", { noStore: true });
}

/** Raw `.coord` envelope → upstream `/msg`. */
export function postEnvelope(envelope: unknown): Promise<UpstreamReply> {
  return postA2AEnvelope(envelope, { noStore: true });
}

/** JSON-RPC: legacy `message/send` → `/a2a`, other methods → A2A 1.0 root. */
export function postJsonRpc(body: unknown): Promise<UpstreamReply> {
  return postA2AJsonRpc(body, LEGACY_METHOD_ALIASES, { noStore: true });
}

// ---------------------------------------------------------------------------
// In-process hub, still read by `api/admin/dashboard-live` (envelopes/tasks
// from `.coord`). The public `/api/a2a` route no longer uses it.
// ---------------------------------------------------------------------------

let configured = false;

const siteAdminNotifier: AdminNotifier = async (message) => {
  const { sendAdminLabMessage } = await import("@/lib/admin-lab");
  return sendAdminLabMessage(message);
};

/** Returns the in-process hub, configured once per process with the site admin notifier. */
export function getA2AHub(): typeof ShenronA2AHub {
  if (!configured) {
    ShenronA2AHub.configure({ notifier: siteAdminNotifier });
    configured = true;
  }
  return ShenronA2AHub;
}
