import type { GameFamily, GamePlatform, WorkRef } from "./work";
import { runtimeLinksForPlatforms } from "./runtime";

export interface GameRelease {
  id: string;
  work: WorkRef;
  family: GameFamily;
  platform: GamePlatform;
  title: string;
  acquisition: "official_purchase" | "owned_original" | "community_build";
  sourceUrl?: string | null;
  region?: string | null;
}

/** Measured catalogue anchors; missing releases remain explicit instead of invented. */
export const CANONICAL_GAME_FAMILIES: readonly WorkRef[] = [
  {
    id: "inazuma_eleven_ds",
    kind: "game",
    title: "Inazuma Eleven",
    series: "inazuma_eleven",
    platforms: ["ds"],
    runtimeLinks: runtimeLinksForPlatforms(["ds"]),
  },
  {
    id: "inazuma_eleven_2_ds",
    kind: "game",
    title: "Inazuma Eleven 2",
    series: "inazuma_eleven_2",
    platforms: ["ds"],
    runtimeLinks: runtimeLinksForPlatforms(["ds"]),
  },
  {
    id: "inazuma_eleven_3_ds",
    kind: "game",
    title: "Inazuma Eleven 3",
    series: "inazuma_eleven_3",
    platforms: ["ds"],
    runtimeLinks: runtimeLinksForPlatforms(["ds"]),
  },
  {
    id: "inazuma_eleven_go_3ds",
    kind: "game",
    title: "Inazuma Eleven GO",
    series: "inazuma_eleven_go",
    platforms: ["3ds"],
    runtimeLinks: runtimeLinksForPlatforms(["3ds"]),
  },
  {
    id: "inazuma_eleven_go_chrono_stones_3ds",
    kind: "game",
    title: "Inazuma Eleven GO Chrono Stones",
    series: "inazuma_eleven_go_chrono_stones",
    platforms: ["3ds"],
    runtimeLinks: runtimeLinksForPlatforms(["3ds"]),
  },
  {
    id: "inazuma_eleven_go_galaxy_3ds",
    kind: "game",
    title: "Inazuma Eleven GO Galaxy",
    series: "inazuma_eleven_go_galaxy",
    platforms: ["3ds"],
    runtimeLinks: runtimeLinksForPlatforms(["3ds"]),
  },
  {
    id: "inazuma_eleven_strikers_wii",
    kind: "game",
    title: "Inazuma Eleven Strikers",
    series: "inazuma_eleven_strikers",
    platforms: ["wii"],
    runtimeLinks: runtimeLinksForPlatforms(["wii"]),
  },
  {
    id: "inazuma_eleven_strikers_2012_wii",
    kind: "game",
    title: "Inazuma Eleven Strikers 2012 Extreme",
    series: "inazuma_eleven_strikers_2012",
    platforms: ["wii"],
    runtimeLinks: runtimeLinksForPlatforms(["wii"]),
  },
  {
    id: "inazuma_eleven_strikers_2013_wii",
    kind: "game",
    title: "Inazuma Eleven GO Strikers 2013",
    series: "inazuma_eleven_strikers_2013",
    platforms: ["wii"],
    runtimeLinks: runtimeLinksForPlatforms(["wii"]),
  },
  {
    id: "inazuma_eleven_victory_road",
    kind: "game",
    title: "Inazuma Eleven: Victory Road",
    series: "inazuma_eleven_victory_road",
    platforms: ["switch", "switch_2", "ps4", "ps5", "xbox", "pc"],
    runtimeLinks: runtimeLinksForPlatforms(["switch", "switch_2", "ps4", "ps5", "xbox", "pc"]),
  },
  {
    id: "inazuma_eleven_cross",
    kind: "game",
    title: "Inazuma Eleven: Cross",
    series: "inazuma_eleven_cross",
    platforms: ["ios", "android", "mobile"],
    runtimeLinks: runtimeLinksForPlatforms(["ios", "android", "mobile"]),
  },
];

/** Release/edition anchors. Patch numbers belong here only after a measured source is recorded. */
export const CANONICAL_GAME_RELEASES: readonly GameRelease[] = CANONICAL_GAME_FAMILIES.flatMap(work =>
  (work.platforms ?? []).map(platform => ({
    id: `${work.id}:${platform}`,
    work,
    family: work.series ?? "other",
    platform,
    title: work.title,
    acquisition: "official_purchase" as const,
    region: null,
  })),
);

export function gamesForPlatform(platform: GamePlatform): WorkRef[] {
  return CANONICAL_GAME_FAMILIES.filter(work => work.platforms?.includes(platform));
}
