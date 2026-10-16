/** Canonical work taxonomy shared by games, animation, films, manga and specials. */

export type WorkKind = "game" | "anime" | "film" | "manga" | "novel" | "special";

/** Platforms and hardware families, kept separate from an individual release. */
export type GamePlatform =
  | "ds"
  | "3ds"
  | "wii"
  | "switch"
  | "switch_2"
  | "ps4"
  | "ps5"
  | "playstation"
  | "xbox"
  | "pc"
  | "ios"
  | "android"
  | "mobile"
  | "arcade"
  | "unknown";

/** Canonical game families supported by the catalogue. */
export type GameFamily =
  | "inazuma_eleven"
  | "inazuma_eleven_2"
  | "inazuma_eleven_3"
  | "inazuma_eleven_strikers"
  | "inazuma_eleven_strikers_2012"
  | "inazuma_eleven_strikers_2013"
  | "inazuma_eleven_go"
  | "inazuma_eleven_go_chrono_stones"
  | "inazuma_eleven_go_galaxy"
  | "inazuma_eleven_ares"
  | "inazuma_eleven_orion"
  | "inazuma_eleven_victory_road"
  | "inazuma_eleven_cross"
  | "other";

export type CanonicalMediaKind = "episode" | "film" | "game_video" | "manga_volume" | "special";

export type RustRuntimeRole = "emulator" | "game_runtime" | "format_reader" | "media_player" | "catalog";

export interface RustRuntimeLink {
  /** Stable identifier for the Rust capability closest to this content. */
  id: string;
  role: RustRuntimeRole;
  crate: string;
  sourcePath: string;
  /** True only when the Rust owner actually executes the target, not merely reads it. */
  executesTarget: boolean;
  status: "available" | "closest_available" | "unimplemented";
}

export interface WorkRef {
  /** Stable slug, never a translated display label. */
  id: string;
  kind: WorkKind;
  title: string;
  /** Optional official Japanese title or source title. */
  titleOriginal?: string | null;
  series?: GameFamily | null;
  platforms?: readonly GamePlatform[];
  runtimeLinks?: readonly RustRuntimeLink[];
  order?: number | null;
}

export interface MediaSource {
  platform: "vfs" | "youtube" | "dailymotion" | "official_page" | "manga_publisher" | "unknown";
  /** Stable source identifier, not a display URL. */
  id: string;
  url: string;
  language?: string | null;
  official: boolean;
  verified?: boolean;
}

export interface MediaEntry {
  /** Stable deduplication key across every source and host. */
  id: string;
  kind: CanonicalMediaKind;
  work: WorkRef;
  title: string;
  titleOriginal?: string | null;
  season?: number | null;
  episode?: number | null;
  volume?: number | null;
  chapter?: number | null;
  date?: string | null;
  durationSeconds?: number | null;
  thumbnailUrl?: string | null;
  runtime?: RustRuntimeLink;
  sources: readonly MediaSource[];
}

export function workId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function mediaId(kind: CanonicalMediaKind, work: string, ordinal?: number | null): string {
  const suffix = ordinal == null ? "" : `_${ordinal}`;
  return `${kind}:${workId(work)}${suffix}`;
}
