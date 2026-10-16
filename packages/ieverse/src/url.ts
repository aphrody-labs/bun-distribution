import type { CanonicalMediaKind, GameFamily, MediaEntry } from "./work";

export type MediaRoute = "media" | "episodes" | "films" | "manga" | "games";

export function routeForKind(kind: CanonicalMediaKind): MediaRoute {
  if (kind === "episode") return "episodes";
  if (kind === "film" || kind === "game_video") return "films";
  if (kind === "manga_volume") return "manga";
  return "media";
}

export function mediaEntryPath(entry: Pick<MediaEntry, "id" | "kind">): string {
  return `/${routeForKind(entry.kind)}/${encodeURIComponent(entry.id)}`;
}

export function gameFamilyPath(family: GameFamily): string {
  return `/games/${family}`;
}
