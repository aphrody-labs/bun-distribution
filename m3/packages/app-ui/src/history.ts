// SPDX-License-Identifier: Apache-2.0
// Pure helpers of the thread history: app-server `thread/list` / `thread/read` decoding,
// search, date groups and the plain-text transcript used by "share".

export type ThreadSummary = {
  id: string;
  title: string;
  updatedAt: number; // epoch seconds
  model?: string;
  status?: string;
};

type RawThread = {
  id?: unknown;
  name?: unknown;
  preview?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
  model?: unknown;
  status?: unknown;
  turns?: unknown;
};

const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** Decode a `thread/list` result (`{ threads, nextCursor }`, `data` accepted for older servers). */
export function normalizeThreads(result: unknown): {
  threads: ThreadSummary[];
  nextCursor?: string;
} {
  const record = (result ?? {}) as { threads?: unknown; data?: unknown; nextCursor?: unknown };
  const raw = Array.isArray(record.threads)
    ? record.threads
    : Array.isArray(record.data)
      ? record.data
      : [];
  const threads = (raw as RawThread[])
    .filter((item) => typeof item?.id === "string" && item.id.length > 0)
    .map((item) => ({
      id: item.id as string,
      title: str(item.name).trim() || str(item.preview).trim() || "Untitled thread",
      updatedAt: num(item.updatedAt) || num(item.createdAt),
      model: str(item.model) || undefined,
      status: typeof item.status === "string" ? item.status : undefined,
    }))
    .toSorted((a, b) => b.updatedAt - a.updatedAt);
  const nextCursor = str(record.nextCursor) || undefined;
  return { threads, nextCursor };
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Case- and accent-insensitive search over title and model; every word must match. */
export function filterThreads(threads: ThreadSummary[], query: string): ThreadSummary[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return threads;
  return threads.filter((thread) => {
    const haystack = fold(`${thread.title} ${thread.model ?? ""}`);
    return words.every((word) => haystack.includes(word));
  });
}

export type DateGroup = { key: string; label: string; threads: ThreadSummary[] };

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** Group threads (already sorted newest first) into Today / Yesterday / 7 days / 30 days / months. */
export function groupByDate(
  threads: ThreadSummary[],
  now: Date = new Date(),
  locale = "en",
): DateGroup[] {
  const today = startOfDay(now);
  const day = 86_400_000;
  const groups = new Map<string, DateGroup>();
  const month = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" });
  for (const thread of threads) {
    const at = thread.updatedAt * 1000;
    let key: string;
    let label: string;
    if (at >= today) [key, label] = ["today", "Today"];
    else if (at >= today - day) [key, label] = ["yesterday", "Yesterday"];
    else if (at >= today - 7 * day) [key, label] = ["week", "Previous 7 days"];
    else if (at >= today - 30 * day) [key, label] = ["month", "Previous 30 days"];
    else {
      const date = new Date(at);
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      label = month.format(date);
    }
    let group = groups.get(key);
    if (!group) {
      group = { key, label, threads: [] };
      groups.set(key, group);
    }
    group.threads.push(thread);
  }
  return [...groups.values()];
}

type RawItem = { type?: string; text?: string; content?: Array<{ type?: string; text?: string }> };

/** Plain-text transcript of a `thread/read` (`includeTurns: true`) result, for local sharing. */
export function transcript(result: unknown): string {
  const thread = ((result ?? {}) as { thread?: RawThread }).thread ?? {};
  const title = str(thread.name).trim() || str(thread.preview).trim() || "Untitled thread";
  const lines = [`# ${title}`];
  const turns = Array.isArray(thread.turns) ? (thread.turns as Array<{ items?: RawItem[] }>) : [];
  for (const turn of turns) {
    for (const item of turn.items ?? []) {
      if (item.type === "userMessage") {
        const text = (item.content ?? [])
          .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
          .join("\n");
        if (text) lines.push("", `**You:** ${text}`);
      } else if (item.type === "agentMessage" && item.text) {
        lines.push("", `**Aphrody:** ${item.text}`);
      }
    }
  }
  return lines.join("\n");
}
