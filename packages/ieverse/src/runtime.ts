import type { CanonicalMediaKind, GamePlatform, RustRuntimeLink } from "./work";

const link = (
  id: string,
  role: RustRuntimeLink["role"],
  crate: string,
  sourcePath: string,
  executesTarget: boolean,
  status: RustRuntimeLink["status"],
): RustRuntimeLink => ({ id, role, crate, sourcePath, executesTarget, status });

/**
 * One measured Rust bridge per platform. There is no console emulator in this repository for
 * DS/3DS/Wii/Switch/PlayStation/Xbox/mobile; those rows deliberately point at the closest reader
 * and remain `closest_available` instead of claiming execution support.
 */
export const RUST_RUNTIME_BY_PLATFORM: Readonly<Record<GamePlatform, RustRuntimeLink>> = {
  ds: link(
    "ds-format-reader",
    "format_reader",
    "iecode-core",
    "crates.io:iecode-core@1::formats",
    false,
    "closest_available",
  ),
  "3ds": link(
    "3ds-format-reader",
    "format_reader",
    "iecode-core",
    "crates.io:iecode-core@1::formats",
    false,
    "closest_available",
  ),
  wii: link(
    "wii-format-reader",
    "format_reader",
    "iecode-core",
    "crates.io:iecode-core@1::formats",
    false,
    "closest_available",
  ),
  switch: link(
    "switch-format-reader",
    "format_reader",
    "iecode-core",
    "crates.io:iecode-core@1::formats",
    false,
    "closest_available",
  ),
  switch_2: link(
    "switch-2-format-reader",
    "format_reader",
    "iecode-core",
    "crates.io:iecode-core@1::formats",
    false,
    "closest_available",
  ),
  ps4: link(
    "ps4-format-reader",
    "format_reader",
    "iecode-core",
    "crates.io:iecode-core@1::formats",
    false,
    "closest_available",
  ),
  ps5: link(
    "ps5-format-reader",
    "format_reader",
    "iecode-core",
    "crates.io:iecode-core@1::formats",
    false,
    "closest_available",
  ),
  playstation: link(
    "playstation-format-reader",
    "format_reader",
    "iecode-core",
    "crates.io:iecode-core@1::formats",
    false,
    "closest_available",
  ),
  xbox: link(
    "xbox-format-reader",
    "format_reader",
    "iecode-core",
    "crates.io:iecode-core@1::formats",
    false,
    "closest_available",
  ),
  pc: link(
    "pc-format-reader",
    "format_reader",
    "iecode-core",
    "crates.io:iecode-core@1::formats",
    false,
    "closest_available",
  ),
  ios: link(
    "ios-format-reader",
    "format_reader",
    "iecode-core",
    "crates.io:iecode-core@1::formats",
    false,
    "closest_available",
  ),
  android: link(
    "android-format-reader",
    "format_reader",
    "iecode-core",
    "crates.io:iecode-core@1::formats",
    false,
    "closest_available",
  ),
  mobile: link(
    "mobile-format-reader",
    "format_reader",
    "iecode-core",
    "crates.io:iecode-core@1::formats",
    false,
    "closest_available",
  ),
  arcade: link(
    "arcade-format-reader",
    "format_reader",
    "iecode-core",
    "crates.io:iecode-core@1::formats",
    false,
    "closest_available",
  ),
  unknown: link(
    "unknown-format-reader",
    "format_reader",
    "iecode-core",
    "crates.io:iecode-core@1::formats",
    false,
    "closest_available",
  ),
};

export const RUST_RUNTIME_BY_MEDIA_KIND: Readonly<Record<CanonicalMediaKind, RustRuntimeLink>> = {
  episode: link(
    "episode-catalog",
    "catalog",
    "iecode-core",
    "crates.io:iecode-core@1::catalog",
    false,
    "closest_available",
  ),
  film: link(
    "film-player",
    "media_player",
    "iecode-core",
    "crates.io:iecode-core@1::video",
    true,
    "available",
  ),
  game_video: link(
    "game-video-player",
    "media_player",
    "iecode-core",
    "crates.io:iecode-core@1::video",
    true,
    "available",
  ),
  manga_volume: link(
    "manga-catalog",
    "catalog",
    "iecode-core",
    "crates.io:iecode-core@1::catalog",
    false,
    "closest_available",
  ),
  special: link(
    "special-media-catalog",
    "catalog",
    "iecode-core",
    "crates.io:iecode-core@1::catalog",
    false,
    "closest_available",
  ),
};

export function runtimeForPlatform(platform: GamePlatform): RustRuntimeLink {
  return RUST_RUNTIME_BY_PLATFORM[platform];
}

export function runtimeForMediaKind(kind: CanonicalMediaKind): RustRuntimeLink {
  return RUST_RUNTIME_BY_MEDIA_KIND[kind];
}

export function runtimeLinksForPlatforms(
  platforms: readonly GamePlatform[] | undefined,
): RustRuntimeLink[] {
  return (platforms ?? ["unknown"]).map(runtimeForPlatform);
}
