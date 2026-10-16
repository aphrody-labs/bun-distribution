// SPDX-License-Identifier: Apache-2.0
/**
 * Navigation policy of a wrapped app: which URLs stay in the window, which go to the system
 * browser, which are blocked. The Rust runtime (`aphrody-tauri-wrap`, `src/policy.rs`) implements
 * the same table; `fixtures/policy-cases.json` is run by both so they cannot drift.
 */
import type { ExternalLinks, WrapOrigins } from "./types.ts";

export type Decision = "allow" | "external" | "deny";
export type NavigationKind = "navigation" | "new-window";

export interface ParsedPattern {
  scheme: string;
  /** Host without the `*.` prefix. */
  host: string;
  /** `*.example.com` matches subdomains only; the bare host is listed separately. */
  subdomains: boolean;
  /** `null` is the default port of the scheme, `"*"` any port. */
  port: string | null;
  /**
   * Path prefix, `null` for any path. A `*` segment matches exactly one path segment
   * (`/*\/dialog/` matches `/v19.0/dialog/oauth`); the prefix is segment-aware only then.
   */
  path: string | null;
}

const DEFAULT_PORT: Record<string, string> = { http: "80", https: "443" };

/** Parses `scheme://host[:port][/path/*]`; returns `null` for anything else. */
export function parsePattern(pattern: string): ParsedPattern | null {
  const match = /^(https?):\/\/(\*\.)?([^/:*]+)(?::(\d+|\*))?(\/[^?#]*)?$/i.exec(pattern.trim());
  if (!match) return null;
  const [, scheme, wildcard, host, port, path] = match;
  let prefix: string | null = null;
  if (path && path !== "/" && path !== "/*") {
    prefix = path.endsWith("/*") ? path.slice(0, -1) : path;
  }
  return {
    scheme: scheme!.toLowerCase(),
    host: host!.toLowerCase(),
    subdomains: Boolean(wildcard),
    port: port ?? null,
    path: prefix,
  };
}

/** Whether `pathname` starts with `prefix`; a `*` segment of the prefix matches one non-empty segment. */
export function pathMatches(prefix: string, pathname: string): boolean {
  if (!prefix.includes("*")) return pathname.startsWith(prefix);
  const wanted = prefix.split("/");
  const actual = pathname.split("/");
  // A trailing slash leaves an empty last segment in the prefix: the URL only has to reach it.
  const required = wanted.at(-1) === "" ? wanted.length - 1 : wanted.length;
  for (let index = 0; index < required; index += 1) {
    const segment = wanted[index]!;
    const value = actual[index];
    if (value === undefined) return false;
    if (segment === "*" ? value === "" : segment !== value) return false;
  }
  // `/a/` must also see a slash after the last named segment.
  return wanted.at(-1) !== "" || actual.length >= wanted.length;
}

/** The pattern without its path: `https://github.com/login/*` becomes `https://github.com`. */
export function stripPath(pattern: string): string | null {
  const parsed = parsePattern(pattern);
  if (!parsed) return null;
  const port = parsed.port ? `:${parsed.port}` : "";
  return `${parsed.scheme}://${parsed.subdomains ? "*." : ""}${parsed.host}${port}`;
}

/** Whether `url` matches the pattern. Invalid patterns match nothing. */
export function matchesPattern(pattern: string, url: URL): boolean {
  const parsed = parsePattern(pattern);
  if (!parsed) return false;
  if (url.protocol !== `${parsed.scheme}:`) return false;
  const host = url.hostname.toLowerCase();
  if (parsed.subdomains) {
    if (!host.endsWith(`.${parsed.host}`)) return false;
  } else if (host !== parsed.host) {
    return false;
  }
  if (parsed.port !== "*") {
    const wanted = parsed.port ?? DEFAULT_PORT[parsed.scheme];
    const actual = url.port || DEFAULT_PORT[parsed.scheme];
    if (wanted !== actual) return false;
  }
  if (parsed.path !== null && !pathMatches(parsed.path, url.pathname)) return false;
  return true;
}

const ALLOWED_OPAQUE = new Set(["blob:", "data:", "javascript:"]);

function outside(external: ExternalLinks): Decision {
  if (external === "system") return "external";
  if (external === "deny") return "deny";
  return "allow";
}

/**
 * Decides one navigation. `extraAllowed` holds origins known only at run time (the loopback
 * origin of a bundle or sidecar).
 */
export function decide(
  origins: WrapOrigins,
  target: string | URL,
  _kind: NavigationKind,
  extraAllowed: string[] = [],
): Decision {
  let url: URL;
  try {
    url = typeof target === "string" ? new URL(target) : target;
  } catch {
    return "deny";
  }
  if (url.protocol === "about:") {
    return url.href === "about:blank" || url.href === "about:srcdoc" ? "allow" : "deny";
  }
  if (ALLOWED_OPAQUE.has(url.protocol)) return "allow";
  if (url.protocol === "file:") return "deny";
  if (url.protocol === "http:" || url.protocol === "https:") {
    const patterns = [...origins.app, ...origins.auth, ...origins.embeds, ...extraAllowed];
    if (patterns.some((pattern) => matchesPattern(pattern, url))) return "allow";
    return outside(origins.external);
  }
  // mailto:, tel:, custom application schemes: only the operating system can handle them.
  return origins.external === "system" ? "external" : "deny";
}

/** `scheme://host[:port]` of a URL, the unit of an origin allowlist entry. */
export function originOf(target: string | URL): string | null {
  try {
    const url = typeof target === "string" ? new URL(target) : target;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}
