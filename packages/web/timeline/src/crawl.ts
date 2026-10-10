// SPDX-License-Identifier: Apache-2.0
import { join } from "node:path";
import { rename } from "node:fs/promises";
import type { Snapshot } from "./model.ts";

interface Detail {
  checkedAt: string;
  status: number;
  failures: number;
  lastSuccessAt?: string;
  text?: string;
}
export interface CrawlState {
  entries: Record<string, Detail>;
}
const fields = [
  "title",
  "titleJa",
  "name",
  "synopsis",
  "synopsisFr",
  "description",
  "summary",
  "article",
  "sourceRef",
  "officialSourceUrl",
];
export function detailText(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid detail object");
  const data = value as Record<string, unknown>;
  return fields
    .flatMap((field) =>
      typeof data[field] === "string" && data[field].trim() ? [`${field}: ${data[field]}`] : [],
    )
    .join("\n");
}

/** Each pass revisits the oldest source first, including failures; no poisoned empty replacement. */
export async function crawlDetails(
  snapshot: Snapshot,
  output: string,
  budget: number,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch,
  pause: () => Promise<unknown> = () => Bun.sleep(1000),
): Promise<{ state: CrawlState; checked: number; failed: number }> {
  if (!Number.isInteger(budget) || budget < 1 || budget > 1000)
    throw new Error("crawl budget must be 1..1000");
  const file = join(output, "crawl-state.json");
  const state: CrawlState = (await Bun.file(file).exists())
    ? await Bun.file(file).json()
    : { entries: {} };
  const selected = snapshot.entries
    .toSorted(
      (a, b) =>
        (state.entries[a.key]?.checkedAt ?? "").localeCompare(
          state.entries[b.key]?.checkedAt ?? "",
        ) || a.key.localeCompare(b.key),
    )
    .slice(0, budget);
  let failed = 0;
  for (const e of selected) {
    // eslint-disable-next-line no-await-in-loop -- One origin, deliberately limited to one request per second.
    await pause();
    let status = 0;
    const previous = state.entries[e.key];
    try {
      // eslint-disable-next-line no-await-in-loop -- Serial requests protect the production source.
      const response = await fetcher(e.api, {
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
        headers: { Accept: "application/json" },
      });
      status = response.status;
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json"))
        throw new Error("detail unavailable");
      // eslint-disable-next-line no-await-in-loop -- Content belongs to this completed request.
      const text = detailText(await response.json());
      if (!text) throw new Error("detail has no editorial content");
      const now = new Date().toISOString();
      state.entries[e.key] = { checkedAt: now, lastSuccessAt: now, status, failures: 0, text };
    } catch {
      failed++;
      state.entries[e.key] = {
        ...previous,
        checkedAt: new Date().toISOString(),
        status,
        failures: (previous?.failures ?? 0) + 1,
      };
    }
    // Save each observed result so an interrupted pass resumes from remaining sources.
    // eslint-disable-next-line no-await-in-loop -- This checkpoint must precede the next source request.
    await Bun.write(file + ".tmp", JSON.stringify(state));
    // eslint-disable-next-line no-await-in-loop -- Atomic checkpoint before starting the next source.
    await rename(file + ".tmp", file);
  }
  return { state, checked: selected.length, failed };
}
