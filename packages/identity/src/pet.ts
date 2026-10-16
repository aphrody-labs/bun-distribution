// SPDX-License-Identifier: Apache-2.0
// The Aphrody pet: atlas geometry, timed tracks and the 16-way gaze ring, plus the frame
// selection of the Codex pet contract (accumulated durations; see crates/ui/identity
// src/pets.rs). Pure data and arithmetic: no DOM, no clock, testable under `bun test`.
import { PET } from "./animations.generated";

/** One atlas cell, in atlas pixels, and how long it stays on screen. */
export interface PetFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Display duration in milliseconds (0 for poses that are not timed). */
  ms: number;
}

export interface PetTrack {
  kind: "timed" | "still";
  frames: PetFrame[];
}

export interface PetAtlas {
  width: number;
  height: number;
  cellWidth: number;
  cellHeight: number;
  columns: number;
  rows: number;
}

export interface PetData {
  id: string;
  displayName: string;
  version: number;
  atlas: PetAtlas;
  tracks: Record<string, PetTrack>;
  /** Gaze poses, clockwise, index 0 looking up, 360 / length degrees apart. */
  directions: PetFrame[];
}

export { PET };

/** Track name: `idle`, `waving`, `running`, `waiting`, `review`, `failed`, `jumping`, ... */
export type PetAnimation = string;

/** Total duration of a track, in milliseconds. */
export function trackDuration(track: PetTrack): number {
  return track.frames.reduce((sum, f) => sum + f.ms, 0);
}

/**
 * The frame of `track` shown `elapsedMs` after it started. Looping tracks wrap; a single pass
 * holds its last frame once elapsed. Still tracks always show their first frame.
 */
export function frameAt(
  track: PetTrack,
  elapsedMs: number,
  loop = true,
): PetFrame {
  const frames = track.frames;
  const last = frames[frames.length - 1];
  if (!last) throw new Error("pet track without frames");
  const total = trackDuration(track);
  if (track.kind === "still" || total <= 0) return frames[0] ?? last;
  let t = Math.max(0, elapsedMs);
  if (loop) t %= total;
  else if (t >= total) return last;
  for (const f of frames) {
    if (t < f.ms) return f;
    t -= f.ms;
  }
  return last;
}

/**
 * The gaze pose for a pointer at (`dx`, `dy`) from the pet's eyes (screen axes: y grows
 * downwards). Inside `deadzone` pixels the neutral pose is returned.
 */
export function gazeFrame(
  dx: number,
  dy: number,
  deadzone = 24,
  data: PetData = PET,
): PetFrame {
  const neutral =
    data.tracks["look-neutral"]?.frames[0] ?? data.tracks.idle?.frames[0];
  if (Math.hypot(dx, dy) < deadzone || data.directions.length === 0) {
    if (!neutral) throw new Error("pet without a neutral pose");
    return neutral;
  }
  // 0 degrees = up, clockwise, as in the atlas ring.
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const step = 360 / data.directions.length;
  const index =
    Math.round((((degrees % 360) + 360) % 360) / step) % data.directions.length;
  const frame = data.directions[index];
  if (!frame) throw new Error("gaze index out of range");
  return frame;
}

/** CSS background geometry that shows `frame` of an atlas scaled by `scale`. */
export function spriteStyle(
  frame: PetFrame,
  scale: number,
  atlas: PetAtlas = PET.atlas,
) {
  return {
    width: `${frame.w * scale}px`,
    height: `${frame.h * scale}px`,
    backgroundSize: `${atlas.width * scale}px ${atlas.height * scale}px`,
    backgroundPosition: `${-frame.x * scale}px ${-frame.y * scale}px`,
  } as const;
}

/**
 * Colours measured on the pet atlas (neutral gaze cell, dominant opaque pixel per region, 2026-10-06).
 * `seed` is the sock mauve: the only pet colour with enough chroma for readable M3 primary roles.
 * The hair, skin and tunic stay exact as accents (`--aphrody-pet-*`).
 */
export const PET_COLORS = {
  seed: "#8c6c88",
  hair: "#dcd894",
  skin: "#fce0b4",
  tunic: "#f4f4f4",
  socks: "#8c6c88",
} as const;
