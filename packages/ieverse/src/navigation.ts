import type { MediaEntry } from "./work";

export function nextUnwatchedEpisode(available: readonly number[], watched: ReadonlySet<number>): number | null {
  return [...available].sort((left, right) => left - right).find(episode => !watched.has(episode)) ?? null;
}

export function neighboringEpisodes(
  available: readonly number[],
  episode: number,
): { previous: number | null; next: number | null } {
  const sorted = [...available].sort((left, right) => left - right);
  const index = sorted.indexOf(episode);
  return index < 0
    ? {
        previous: sorted.filter(candidate => candidate < episode).at(-1) ?? null,
        next: sorted.find(candidate => candidate > episode) ?? null,
      }
    : {
        previous: index > 0 ? sorted[index - 1]! : null,
        next: index + 1 < sorted.length ? sorted[index + 1]! : null,
      };
}

export function nextUnwatchedEntry(entries: readonly MediaEntry[], watched: ReadonlySet<string>): MediaEntry | null {
  return entries.find(entry => !watched.has(entry.id)) ?? null;
}

export function neighboringEntries(
  entries: readonly MediaEntry[],
  currentId: string,
): { previous: MediaEntry | null; next: MediaEntry | null } {
  const index = entries.findIndex(entry => entry.id === currentId);
  return index < 0
    ? { previous: null, next: entries[0] ?? null }
    : {
        previous: index > 0 ? entries[index - 1]! : null,
        next: index + 1 < entries.length ? entries[index + 1]! : null,
      };
}

export function sortMediaEntries(entries: readonly MediaEntry[]): MediaEntry[] {
  return [...entries].sort((left, right) => {
    const leftSeason = left.season ?? Number.MAX_SAFE_INTEGER;
    const rightSeason = right.season ?? Number.MAX_SAFE_INTEGER;
    return (
      leftSeason - rightSeason ||
      (left.episode ?? left.volume ?? Number.MAX_SAFE_INTEGER) -
        (right.episode ?? right.volume ?? Number.MAX_SAFE_INTEGER) ||
      left.id.localeCompare(right.id)
    );
  });
}
