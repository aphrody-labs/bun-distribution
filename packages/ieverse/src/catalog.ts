import type { MediaEntry } from "./work";
import { sortMediaEntries } from "./navigation";

export interface MediaQuery {
  text?: string;
  kind?: MediaEntry["kind"];
  series?: string;
  season?: number;
  language?: string;
}

export function mergeMediaEntries(...catalogues: readonly (readonly MediaEntry[])[]): MediaEntry[] {
  const merged = new Map<string, MediaEntry>();
  for (const catalogue of catalogues) {
    for (const entry of catalogue) {
      const previous = merged.get(entry.id);
      merged.set(entry.id, previous ? { ...previous, sources: [...previous.sources, ...entry.sources] } : entry);
    }
  }
  return sortMediaEntries(
    [...merged.values()].map(entry => ({
      ...entry,
      sources: [...new Map(entry.sources.map(source => [`${source.platform}:${source.id}`, source])).values()],
    })),
  );
}

export function queryMedia(entries: readonly MediaEntry[], query: MediaQuery = {}): MediaEntry[] {
  const text = query.text?.trim().toLocaleLowerCase();
  return sortMediaEntries(
    entries.filter(entry => {
      if (query.kind && entry.kind !== query.kind) return false;
      if (query.series && entry.work.series !== query.series) return false;
      if (query.season !== undefined && entry.season !== query.season) return false;
      if (query.language && !entry.sources.some(source => source.language === query.language)) return false;
      if (text && !`${entry.title} ${entry.titleOriginal ?? ""} ${entry.work.title}`.toLocaleLowerCase().includes(text))
        return false;
      return true;
    }),
  );
}
