// SPDX-License-Identifier: Apache-2.0
/** Agent Card discovery (spec section 8): fetch, HTTP caching, normalisation, interface selection. */
import type { AgentCard, AgentInterface } from "./generated/a2a.ts";
import { A2ADiscoveryError } from "./errors.ts";
import { joinUrl, type HeadersProvider } from "./http.ts";
import {
  A2A_PROTOCOL_VERSION,
  SUPPORTED_BINDINGS,
  WELL_KNOWN_AGENT_CARD_PATH,
  type SupportedBinding,
} from "./protocol.ts";

interface CacheEntry {
  card: AgentCard;
  etag?: string;
  lastModified?: string;
  /** Epoch milliseconds until which the entry may be served without revalidation. */
  freshUntil: number;
}

/**
 * In-memory Agent Card cache honouring `Cache-Control: max-age`, `no-store`, `ETag` and
 * `Last-Modified` (spec section 8.6). Opt-in: pass one instance to the calls that should share it.
 */
export class AgentCardCache {
  private readonly entries = new Map<string, CacheEntry>();

  /** Entry for `url`, fresh or stale (a stale one is revalidated with a conditional request). */
  peek(url: string): CacheEntry | undefined {
    return this.entries.get(url);
  }

  store(url: string, entry: CacheEntry): void {
    this.entries.set(url, entry);
  }

  delete(url: string): void {
    this.entries.delete(url);
  }

  clear(): void {
    this.entries.clear();
  }
}

export interface DiscoveryOptions {
  fetch?: typeof fetch;
  headers?: HeadersProvider;
  /** Deadline of the card request in milliseconds. 0 disables. Default 30000. */
  timeoutMs?: number;
  signal?: AbortSignal;
  cache?: AgentCardCache;
}

/** URL of the card for an agent base URL, or the URL itself when it already names a `.json` file. */
export function agentCardUrl(baseUrl: string): string {
  const withoutQuery = baseUrl.split(/[?#]/, 1)[0] ?? baseUrl;
  return /\.json$/i.test(withoutQuery) ? baseUrl : joinUrl(baseUrl, WELL_KNOWN_AGENT_CARD_PATH);
}

function cacheDirectives(header: string | null): {
  maxAgeMs: number;
  noStore: boolean;
} {
  const directives = (header ?? "")
    .toLowerCase()
    .split(",")
    .map(d => d.trim());
  if (directives.includes("no-store")) return { maxAgeMs: 0, noStore: true };
  if (directives.includes("no-cache")) return { maxAgeMs: 0, noStore: false };
  const maxAge = directives.map(d => /^max-age=(\d+)$/.exec(d)?.[1]).find(v => v !== undefined);
  return {
    maxAgeMs: maxAge === undefined ? 0 : Number(maxAge) * 1000,
    noStore: false,
  };
}

/** Fetch and normalise the Agent Card published by an agent. */
export async function fetchAgentCard(baseUrl: string, options: DiscoveryOptions = {}): Promise<AgentCard> {
  const url = agentCardUrl(baseUrl);
  const cached = options.cache?.peek(url);
  if (cached && cached.freshUntil > Date.now()) return cached.card;

  const headers = new Headers();
  const extra = typeof options.headers === "function" ? await options.headers() : options.headers;
  if (extra) new Headers(extra).forEach((value, key) => headers.set(key, value));
  headers.set("accept", "application/json");
  if (cached?.etag) headers.set("if-none-match", cached.etag);
  else if (cached?.lastModified) headers.set("if-modified-since", cached.lastModified);

  const timeoutMs = options.timeoutMs ?? 30_000;
  const signals = [options.signal, timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined].filter(
    (s): s is AbortSignal => s !== undefined,
  );
  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(url, {
      headers,
      signal: signals.length > 0 ? AbortSignal.any(signals) : undefined,
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new A2ADiscoveryError("fetch", `agent card request to ${url} failed: ${reason}`, {
      cause,
    });
  }

  const { maxAgeMs, noStore } = cacheDirectives(response.headers.get("cache-control"));
  if (response.status === 304 && cached) {
    await response.body?.cancel().catch(() => undefined);
    options.cache?.store(url, { ...cached, freshUntil: Date.now() + maxAgeMs });
    return cached.card;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new A2ADiscoveryError("fetch", `agent card request to ${url} answered HTTP ${response.status}`, {
      status: response.status,
    });
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch (cause) {
    throw new A2ADiscoveryError("invalid", `agent card at ${url} is not valid JSON`, { cause });
  }
  const card = normalizeAgentCard(raw);
  if (options.cache && !noStore) {
    const etag = response.headers.get("etag") ?? undefined;
    const lastModified = response.headers.get("last-modified") ?? undefined;
    options.cache.store(url, {
      card,
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {}),
      freshUntil: Date.now() + maxAgeMs,
    });
  }
  return card;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a decoded card and lift the pre-1.0 transport fields (`url`, `preferredTransport`,
 * `additionalInterfaces`, `protocolVersion`, `supportsAuthenticatedExtendedCard`) to the 1.0 shape.
 * Required collections that a legacy card omits are defaulted to empty; unknown members are kept.
 */
export function normalizeAgentCard(raw: unknown): AgentCard {
  if (!isRecord(raw)) throw new A2ADiscoveryError("invalid", "agent card is not a JSON object");
  if (typeof raw.name !== "string" || raw.name === "") {
    throw new A2ADiscoveryError("invalid", "agent card has no name");
  }
  let interfaces: AgentInterface[];
  if (Array.isArray(raw.supportedInterfaces)) {
    interfaces = raw.supportedInterfaces.filter(isRecord).map(toInterface);
  } else if (typeof raw.url === "string") {
    // Pre-1.0 card: one preferred transport at `url`, optionally more in `additionalInterfaces`.
    const version = typeof raw.protocolVersion === "string" ? raw.protocolVersion : "0.3";
    const preferred = typeof raw.preferredTransport === "string" ? raw.preferredTransport : "JSONRPC";
    const extra = Array.isArray(raw.additionalInterfaces) ? raw.additionalInterfaces.filter(isRecord) : [];
    interfaces = [
      { url: raw.url, protocolBinding: preferred, protocolVersion: version },
      ...extra.map(i =>
        toInterface({
          protocolVersion: version,
          ...i,
          protocolBinding: i.transport ?? i.protocolBinding,
        }),
      ),
    ];
  } else {
    throw new A2ADiscoveryError("invalid", `agent card "${raw.name}" declares no interface`);
  }
  if (interfaces.length === 0) {
    throw new A2ADiscoveryError("invalid", `agent card "${raw.name}" declares no usable interface`);
  }
  const capabilities = isRecord(raw.capabilities) ? { ...raw.capabilities } : {};
  if (raw.supportsAuthenticatedExtendedCard === true && capabilities.extendedAgentCard === undefined) {
    capabilities.extendedAgentCard = true;
  }
  return {
    ...raw,
    name: raw.name,
    description: typeof raw.description === "string" ? raw.description : "",
    version: typeof raw.version === "string" ? raw.version : "",
    supportedInterfaces: interfaces,
    capabilities,
    defaultInputModes: strings(raw.defaultInputModes),
    defaultOutputModes: strings(raw.defaultOutputModes),
    skills: Array.isArray(raw.skills) ? raw.skills.filter(isRecord) : [],
  } as unknown as AgentCard;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function toInterface(raw: Record<string, unknown>): AgentInterface {
  if (typeof raw.url !== "string" || typeof raw.protocolBinding !== "string") {
    throw new A2ADiscoveryError("invalid", "agent interface needs a url and a protocolBinding");
  }
  return {
    url: raw.url,
    protocolBinding: raw.protocolBinding,
    protocolVersion: typeof raw.protocolVersion === "string" ? raw.protocolVersion : "",
    ...(typeof raw.tenant === "string" && raw.tenant !== "" ? { tenant: raw.tenant } : {}),
  };
}

/** `1`, `1.0` and `1.0.3` all designate protocol version `1.0`; patch levels never matter. */
export function majorMinor(version: string): string {
  const [major = "", minor = "0"] = version.trim().replace(/^v/i, "").split(".");
  return `${major}.${minor}`;
}

export interface InterfaceSelection {
  interface: AgentInterface;
  binding: SupportedBinding;
}

export interface SelectOptions {
  /** Bindings the caller can drive, in no particular order: the card's order decides. */
  bindings?: readonly SupportedBinding[];
  /** `Major.Minor` to require. Default {@link A2A_PROTOCOL_VERSION}; no automatic fallback. */
  protocolVersion?: string;
}

function canonicalBinding(binding: string): SupportedBinding | undefined {
  const upper = binding.toUpperCase();
  return SUPPORTED_BINDINGS.find(b => b === upper);
}

/**
 * Pick the first interface of the card (preference order, spec 8.3.2) whose binding this client
 * speaks at the requested protocol version.
 */
export function selectInterface(card: AgentCard, options: SelectOptions = {}): InterfaceSelection {
  const bindings = options.bindings ?? SUPPORTED_BINDINGS;
  const version = majorMinor(options.protocolVersion ?? A2A_PROTOCOL_VERSION);
  for (const candidate of card.supportedInterfaces) {
    const binding = canonicalBinding(candidate.protocolBinding);
    if (binding && bindings.includes(binding) && majorMinor(candidate.protocolVersion) === version) {
      return { interface: candidate, binding };
    }
  }
  const offered = card.supportedInterfaces
    .map(i => `${i.protocolBinding} ${i.protocolVersion || "?"} at ${i.url}`)
    .join("; ");
  throw new A2ADiscoveryError(
    "no-interface",
    `agent "${card.name}" offers no ${bindings.join("/")} interface for A2A ${version} (offered: ${offered})`,
  );
}
