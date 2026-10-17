// SPDX-License-Identifier: Apache-2.0
/**
 * Parity between the original page and the wrapped app. Two independent checks:
 *
 * - `verifyPolicy`: replays every navigation the probe observed (start URL, redirect chain, links,
 *   form posts, sign-in providers) through the navigation policy of the plan. Deterministic, no
 *   browser: a page whose own navigation would be blocked or sent to the system browser fails here.
 * - `compareSnapshots`: compares what a browser and the wrapped webview rendered for the same
 *   path (title, text, accessibility tree, requests). The capture side lives in `drivers.ts`.
 *
 * Neither is a proof of pixel parity; a skipped capture is reported as `skipped`, never as `pass`.
 */
import { decide } from "./policy.ts";
import { IDP_RULES } from "./signals.ts";
import type { ConversionPlan } from "./types.ts";

export interface TreeEntry {
  tag: string;
  role: string | null;
  name: string;
  id: string | null;
  testId: string | null;
  href: string | null;
  disabled: boolean;
}

export interface ResourceEntry {
  name: string;
  initiator: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  lang: string | null;
  text: string;
  tree: TreeEntry[];
  resources: ResourceEntry[];
}

/** Function body evaluated in the page; returns a `PageSnapshot`. Same text on both sides. */
export const PARITY_SNAPSHOT_BODY = `
const roleOf = (el) => el.getAttribute("role") || ({ a: "link", button: "button", input: el.type === "checkbox" ? "checkbox" : "textbox", select: "combobox", textarea: "textbox", img: "img", h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading", nav: "navigation", main: "main", header: "banner", footer: "contentinfo", aside: "complementary", form: "form", table: "table", ul: "list", ol: "list", li: "listitem" })[el.tagName.toLowerCase()] || null;
const nameOf = (el) => (el.getAttribute("aria-label") || (el.labels && el.labels[0] && el.labels[0].textContent) || el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("placeholder") || (el.textContent || "")).trim().replace(/\\s+/g, " ").slice(0, 120);
const SKIP = new Set(["STYLE", "SCRIPT", "NOSCRIPT", "TEMPLATE", "HEAD"]);
const BLOCK = /^(P|DIV|LI|H[1-6]|TR|BR|SECTION|ARTICLE|HEADER|FOOTER|NAV|MAIN|ASIDE|UL|OL|TABLE|FORM)$/;
const hidden = (el) => {
  if (el.hasAttribute && el.hasAttribute("hidden")) return true;
  try {
    const cs = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
    return !!cs && (cs.display === "none" || cs.visibility === "hidden");
  } catch (_) {
    return false;
  }
};
const parts = [];
const walk = (node) => {
  if (node.nodeType === 3) { parts.push(node.nodeValue); return; }
  if (node.nodeType !== 1 || SKIP.has(node.tagName) || hidden(node)) return;
  for (const child of node.childNodes) walk(child);
  if (BLOCK.test(node.tagName)) parts.push("\\n");
};
if (document.body) walk(document.body);
const nodes = [...document.querySelectorAll("a[href],button,input,select,textarea,[role],h1,h2,h3,h4,h5,h6,nav,main,header,footer,aside,form,img[alt],table")].slice(0, 800);
return {
  url: location.href,
  title: document.title,
  lang: document.documentElement.lang || null,
  text: parts.join(" ").slice(0, 60000),
  tree: nodes.map((el) => ({ tag: el.tagName.toLowerCase(), role: roleOf(el), name: nameOf(el), id: el.id || null, testId: el.getAttribute("data-testid"), href: el.getAttribute("href"), disabled: !!el.disabled })),
  resources: performance.getEntriesByType("resource").map((entry) => ({ name: entry.name, initiator: entry.initiatorType })),
};`;

export type Severity = "regression" | "info";

export interface Finding {
  severity: Severity;
  check: string;
  message: string;
}

export interface PathReport {
  path: string;
  status: "pass" | "fail" | "skipped";
  textSimilarity: number | null;
  findings: Finding[];
}

export interface ParityReport {
  schema: "aphrody-web-to-tauri.parity/1";
  verdict: "pass" | "fail" | "incomplete";
  paths: PathReport[];
  policy: Finding[];
  /** Checks that did not run, with the reason. */
  skipped: string[];
}

export interface CompareOptions {
  /** Minimum word-shingle similarity of the visible text. */
  minTextSimilarity?: number;
  /** Rewrites an origin before comparing (loopback origin of a bundle to the public origin). */
  originMap?: Record<string, string>;
  /** Regular expressions; matching text runs are removed before comparing (clocks, counters). */
  ignoreText?: RegExp[];
  /** Resource initiators that count as API traffic. */
  apiInitiators?: string[];
}

const DEFAULT_API_INITIATORS = ["fetch", "xmlhttprequest", "beacon"];

export function normalizeText(text: string, ignore: RegExp[] = []): string {
  let out = text;
  for (const pattern of ignore) out = out.replace(pattern, " ");
  return out.replace(/\s+/g, " ").trim().toLowerCase();
}

function shingles(text: string): Set<string> {
  const words = text.split(" ").filter(Boolean);
  if (words.length === 0) return new Set();
  if (words.length < 3) return new Set([words.join(" ")]);
  const out = new Set<string>();
  for (let index = 0; index + 3 <= words.length; index += 1) out.add(words.slice(index, index + 3).join(" "));
  return out;
}

/** Jaccard similarity of 3-word shingles; 1 for two empty texts. */
export function textSimilarity(a: string, b: string): number {
  const left = shingles(a);
  const right = shingles(b);
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function mapOrigin(url: string, originMap: Record<string, string>): string {
  try {
    const parsed = new URL(url);
    const mapped = originMap[parsed.origin];
    return mapped ? `${mapped}${parsed.pathname}${parsed.search}` : url;
  } catch {
    return url;
  }
}

function stripVolatile(url: string): string {
  try {
    const parsed = new URL(url);
    // Cache busters and timestamps differ run to run, not between the two sides.
    const volatile: string[] = [];
    parsed.searchParams.forEach((_value, key) => {
      if (/^(?:_|t|ts|v|cb|cachebust|nonce|rnd|random)$/i.test(key)) volatile.push(key);
    });
    for (const key of volatile) parsed.searchParams.delete(key);
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) out.set(key(item), (out.get(key(item)) ?? 0) + 1);
  return out;
}

function missing(reference: Map<string, number>, wrapped: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [key, count] of reference) if ((wrapped.get(key) ?? 0) < count) out.push(key);
  return out;
}

const treeKey = (entry: TreeEntry) => `${entry.role ?? entry.tag}|${entry.name}|${entry.disabled ? "disabled" : ""}`;

/** Compares one path. `reference` is what the browser rendered, `wrapped` what the app rendered. */
export function compareSnapshots(
  path: string,
  reference: PageSnapshot,
  wrapped: PageSnapshot,
  options: CompareOptions = {},
): PathReport {
  const findings: Finding[] = [];
  const originMap = options.originMap ?? {};
  const api = new Set(options.apiInitiators ?? DEFAULT_API_INITIATORS);
  const add = (severity: Severity, check: string, message: string) => findings.push({ severity, check, message });

  if (reference.title !== wrapped.title)
    add("regression", "title", `title differs: "${reference.title}" vs "${wrapped.title}"`);
  if ((reference.lang ?? "") !== (wrapped.lang ?? ""))
    add("info", "lang", `lang differs: ${reference.lang} vs ${wrapped.lang}`);

  const refPath = (() => {
    try {
      return new URL(reference.url).pathname;
    } catch {
      return reference.url;
    }
  })();
  const wrapPath = (() => {
    try {
      return new URL(wrapped.url).pathname;
    } catch {
      return wrapped.url;
    }
  })();
  if (refPath !== wrapPath) add("regression", "route", `final path differs: ${refPath} vs ${wrapPath}`);

  const min = options.minTextSimilarity ?? 0.98;
  const similarity = textSimilarity(
    normalizeText(reference.text, options.ignoreText),
    normalizeText(wrapped.text, options.ignoreText),
  );
  if (similarity < min) add("regression", "text", `visible text similarity ${similarity.toFixed(3)} is below ${min}`);

  const refTree = countBy(reference.tree, treeKey);
  const wrapTree = countBy(wrapped.tree, treeKey);
  for (const key of missing(refTree, wrapTree).slice(0, 20)) add("regression", "tree", `missing in the app: ${key}`);
  for (const key of missing(wrapTree, refTree).slice(0, 10)) add("info", "tree", `only in the app: ${key}`);

  const resourceKey = (entry: ResourceEntry) => `${entry.initiator}|${stripVolatile(mapOrigin(entry.name, originMap))}`;
  const refRes = countBy(reference.resources, resourceKey);
  const wrapRes = countBy(wrapped.resources, resourceKey);
  for (const key of missing(refRes, wrapRes).slice(0, 30)) {
    const initiator = key.slice(0, key.indexOf("|"));
    add(
      api.has(initiator) ? "regression" : "info",
      "requests",
      `request made by the browser but not by the app: ${key}`,
    );
  }
  for (const key of missing(wrapRes, refRes).slice(0, 10))
    add("info", "requests", `request only made by the app: ${key}`);

  return {
    path,
    status: findings.some(finding => finding.severity === "regression") ? "fail" : "pass",
    textSimilarity: similarity,
    findings,
  };
}

/** Navigations observed in the probe, replayed through the plan's policy. */
export function verifyPolicy(plan: ConversionPlan): Finding[] {
  const findings: Finding[] = [];
  const { config, probe } = plan;
  const extra = config.mode === "remote" ? [] : ["http://127.0.0.1:*"];
  const check = (url: string, kind: "navigation" | "new-window", why: string, severity: Severity = "regression") => {
    const decision = decide(config.origins, url, kind, extra);
    if (decision !== "allow")
      findings.push({
        severity,
        check: "policy",
        message: `${why} ${url} would be ${decision === "external" ? "sent to the system browser" : "blocked"}`,
      });
  };
  if (probe.kind !== "site") {
    for (const backend of probe.backends.slice(0, 1)) check(`${backend}/`, "navigation", "backend origin", "info");
    return findings;
  }
  check(config.start, "navigation", "start page");
  for (const hop of probe.redirects) {
    check(hop.url, "navigation", "redirect hop");
    if (hop.location) check(new URL(hop.location, hop.url).href, "navigation", "redirect target");
  }
  const base = new URL(probe.finalUrl);
  for (const path of probe.links) check(new URL(path, base).href, "navigation", "same-origin link");
  for (const origin of probe.formOrigins) check(`${origin}/`, "navigation", "form action");
  for (const idp of probe.idps) {
    const rule = IDP_RULES.find(entry => entry.id === idp.id);
    for (const pattern of rule?.patterns ?? []) {
      // A sample URL under the pattern: the provider's own pages must open in the app.
      const sample = pattern
        .replace("*.", "www.")
        .replace(/\*$/, "x")
        .replace(/\/\*\//g, "/x/");
      check(sample, "new-window", `${idp.id} sign-in page`);
    }
  }
  return findings;
}

/** Assembles the report; `incomplete` when no path was captured on both sides. */
export function buildReport(paths: PathReport[], policy: Finding[], skipped: string[]): ParityReport {
  const compared = paths.filter(entry => entry.status !== "skipped");
  const failed =
    paths.some(entry => entry.status === "fail") || policy.some(finding => finding.severity === "regression");
  return {
    schema: "aphrody-web-to-tauri.parity/1",
    verdict: failed ? "fail" : compared.length === 0 ? "incomplete" : "pass",
    paths,
    policy,
    skipped,
  };
}
