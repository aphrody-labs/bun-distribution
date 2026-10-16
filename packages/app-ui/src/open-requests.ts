// SPDX-License-Identifier: Apache-2.0
// Interpretation of the files and `aphrody://` links the OS hands to Aphrody ("Open with",
// file associations, deep links). The native side (crates/ui/app/src/integration.rs) queues
// them; the main window drains the queue and applies the resulting intents.

/** One queued request, as returned by `aphrody_take_open_requests`. */
export interface OpenRequest {
  urls: string[];
  files: string[];
}

export const LINK_DESTINATIONS = [
  "agent",
  "chat",
  "files",
  "drive",
  "models",
  "windows",
  "settings",
  "creator",
  "admin",
] as const;
export type LinkDestination = (typeof LINK_DESTINATIONS)[number];

export type OpenIntent =
  | { kind: "navigate"; destination: LinkDestination }
  | { kind: "ask"; prompt: string }
  | { kind: "thread"; id: string }
  | { kind: "files"; paths: string[] };

/**
 * Parse one `aphrody://` link:
 *   aphrody://ask?q=<prompt>      prefill the composer
 *   aphrody://thread/<id>         resume a thread
 *   aphrody://<destination>       open a pane (settings, drive, models, ...)
 * Anything else yields `null` (unknown links are ignored, never executed).
 */
export function parseLink(link: string): OpenIntent | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol.toLowerCase() !== "aphrody:") return null;
  // `aphrody://ask?q=x`: WHATWG puts `ask` in host for special-less schemes only when `//` is present.
  const segments = [url.hostname, ...url.pathname.split("/")]
    .map((s) => decodeURIComponent(s))
    .filter(Boolean);
  const [head, ...rest] = segments;
  if (!head) return null;
  const name = head.toLowerCase();
  if (name === "ask") {
    const prompt = url.searchParams.get("q")?.trim();
    return prompt
      ? { kind: "ask", prompt }
      : { kind: "navigate", destination: "agent" };
  }
  if (name === "thread") {
    const id = rest[0]?.trim();
    return id ? { kind: "thread", id } : null;
  }
  return (LINK_DESTINATIONS as readonly string[]).includes(name)
    ? { kind: "navigate", destination: name as LinkDestination }
    : null;
}

/** All intents of a batch of requests, in arrival order; files of one request stay grouped. */
export function intentsOf(requests: OpenRequest[]): OpenIntent[] {
  const intents: OpenIntent[] = [];
  for (const request of requests) {
    for (const link of request.urls) {
      const intent = parseLink(link);
      if (intent) intents.push(intent);
    }
    if (request.files.length > 0)
      intents.push({ kind: "files", paths: [...request.files] });
  }
  return intents;
}

/** Composer text for files opened with Aphrody: the agent reads them from their paths. */
export function filesPrompt(paths: string[]): string {
  if (paths.length === 1) return `Open and summarize the file ${paths[0]}`;
  return `Open and summarize these files:\n${paths.map((path) => `- ${path}`).join("\n")}`;
}
