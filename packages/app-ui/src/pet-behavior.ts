// SPDX-License-Identifier: Apache-2.0
// Pure behaviour of the desktop pet (crates/ui/app `pet` window): which track to play,
// when to wander, and where to look. Rendering lives in desktop-surfaces.tsx.
import { gazeFrame, PET, type PetFrame } from "@aphrody/identity/pet";

export type PetMode = "idle" | "walk-left" | "walk-right";

/** Logical pixels walked per step request. */
export const WALK_STEP = 3;
/** Period between step requests while walking (ms). */
export const WALK_PERIOD = 40;
/** Radius (logical px) inside which the pet follows the pointer with its eyes. */
export const GAZE_RADIUS = 360;

/** Track name for a mode; hovering the sprite waves. Falls back to `idle` when missing. */
export function trackFor(mode: PetMode, hovering: boolean): string {
  const wanted = hovering ? "waving" : mode === "walk-left" ? "running-left" : mode === "walk-right" ? "running-right" : "idle";
  return PET.tracks[wanted] ? wanted : "idle";
}

/** Delay before the next stroll (8 to 20 s). */
export function idleDelay(random: () => number = Math.random): number {
  return 8000 + Math.floor(random() * 12000);
}

/** Duration of a stroll (2 to 5 s). */
export function walkDuration(random: () => number = Math.random): number {
  return 2000 + Math.floor(random() * 3000);
}

/** Direction of the next stroll. */
export function walkDirection(random: () => number = Math.random): PetMode {
  return random() < 0.5 ? "walk-left" : "walk-right";
}

/**
 * Gaze pose toward `cursor` from `eyes` (same coordinate space), or `null` when the pointer is
 * farther than `radius` or the atlas has no direction ring.
 */
export function gazeToward(cursor: { x: number; y: number }, eyes: { x: number; y: number }, radius = GAZE_RADIUS): PetFrame | null {
  if (PET.directions.length === 0) return null;
  const dx = cursor.x - eyes.x;
  const dy = cursor.y - eyes.y;
  if (Math.hypot(dx, dy) > radius) return null;
  return gazeFrame(dx, dy);
}
