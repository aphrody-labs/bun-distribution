// SPDX-License-Identifier: Apache-2.0
/** Shared HTTP transport primitives for the Shenron site and bot A2A adapters. */

export const A2A_URL_ENV = "APHRODY_A2A_URL";
export const A2A_DEFAULT_URL = "http://127.0.0.1:8788";
export const LEGACY_SEND_METHOD = "message/send";

export interface UpstreamReply {
  status: number;
  body: unknown;
}

export type LegacyMethodAliases = Readonly<Record<string, string>>;

export interface A2ARequestOptions {
  noStore?: boolean;
}

export function a2aBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env[A2A_URL_ENV]?.trim();
  return (raw || A2A_DEFAULT_URL).replace(/\/+$/, "");
}

export async function readA2ABody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: "upstream_non_json", status: res.status, body: text.slice(0, 2000) };
  }
}

export function unreachableA2A(err: unknown): UpstreamReply {
  return {
    status: 502,
    body: {
      error: "a2a_upstream_unreachable",
      message: err instanceof Error ? err.message : String(err),
    },
  };
}

function requestInit(
  init: RequestInit | undefined,
  options: A2ARequestOptions,
): RequestInit | undefined {
  return options.noStore ? { cache: "no-store", ...init } : init;
}

export async function callA2A(
  path: string,
  init?: RequestInit,
  options: A2ARequestOptions = {},
): Promise<UpstreamReply> {
  try {
    const res = await fetch(`${a2aBaseUrl()}${path}`, requestInit(init, options));
    return { status: res.status, body: await readA2ABody(res) };
  } catch (err) {
    return unreachableA2A(err);
  }
}

export async function streamA2A(
  path: string,
  init?: RequestInit,
  options: A2ARequestOptions = {},
): Promise<Response | UpstreamReply> {
  try {
    return await fetch(`${a2aBaseUrl()}${path}`, requestInit(init, options));
  } catch (err) {
    return unreachableA2A(err);
  }
}

export function postA2AJson(
  path: string,
  body: unknown,
  options: A2ARequestOptions = {},
): Promise<UpstreamReply> {
  return callA2A(
    path,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    options,
  );
}

export async function fetchA2AEnvelopes(
  limit: number,
  accept: string,
  options: A2ARequestOptions = {},
): Promise<UpstreamReply> {
  try {
    const res = await fetch(`${a2aBaseUrl()}/coord`, requestInit({ headers: { accept } }, options));
    if (!res.ok) return { status: res.status, body: await readA2ABody(res) };
    const envelopes: unknown[] = [];
    for (const line of (await res.text()).split("\n")) {
      if (!line.trim()) continue;
      try {
        envelopes.push(JSON.parse(line));
      } catch {
        // Skip malformed records in a best-effort mailbox snapshot.
      }
    }
    return { status: 200, body: envelopes.slice(-limit) };
  } catch (err) {
    return unreachableA2A(err);
  }
}

export function postA2AEnvelope(
  envelope: unknown,
  options: A2ARequestOptions = {},
): Promise<UpstreamReply> {
  return postA2AJson("/msg", envelope, options);
}

export function rewriteA2AMethod(
  body: unknown,
  aliases: LegacyMethodAliases,
): { method: unknown; payload: unknown } {
  const method =
    body && typeof body === "object" ? (body as { method?: unknown }).method : undefined;
  const alias = typeof method === "string" ? aliases[method] : undefined;
  return { method, payload: alias ? { ...(body as object), method: alias } : body };
}

export function postA2AJsonRpc(
  body: unknown,
  aliases: LegacyMethodAliases,
  options: A2ARequestOptions = {},
): Promise<UpstreamReply> {
  const { method, payload } = rewriteA2AMethod(body, aliases);
  return postA2AJson(
    method === LEGACY_SEND_METHOD ? "/a2a" : "/",
    method === LEGACY_SEND_METHOD ? body : payload,
    options,
  );
}

export function postA2AJsonRpcStream(
  body: unknown,
  aliases: LegacyMethodAliases,
  options: A2ARequestOptions = {},
): Promise<Response | UpstreamReply> {
  const { payload } = rewriteA2AMethod(body, aliases);
  return streamA2A(
    "/",
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(payload),
    },
    options,
  );
}

export function fetchA2ACoordStream(
  options: A2ARequestOptions = {},
): Promise<Response | UpstreamReply> {
  return streamA2A("/coord", { headers: { accept: "text/event-stream" } }, options);
}

export function fetchA2AAgentCard(options: A2ARequestOptions = {}): Promise<UpstreamReply> {
  return callA2A("/.well-known/agent-card.json", undefined, options);
}
