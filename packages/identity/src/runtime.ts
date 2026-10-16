// SPDX-License-Identifier: Apache-2.0
// The pet clock of crates/ui/identity (src/pets.rs: `frame_courante`, `PetCodex::resoudre`,
// `Ambiance`, `regard`) over the data the crate exports to assets/aphrody/web.json. Same
// integer-millisecond arithmetic, same order of operations: src/runtime.test.ts replays the
// crate's tests/fixtures/parite-web.json tick for tick. No DOM, no clock.
import { PET_WEB } from "./web.generated";

/** A track: `[cell, duration ms]` per frame, the loop restart index (null: single pass), the fallback. */
export interface WebTrack {
  frames: [number, number][];
  loopStart: number | null;
  fallback: string;
}

export interface WebState {
  lifetimeMs: number;
  label: string;
}

export interface WebAtlas {
  width: number;
  height: number;
  cellWidth: number;
  cellHeight: number;
  columns: number;
  rows: number;
}

export interface PetWebData {
  id: string;
  displayName: string;
  version: number;
  atlas: WebAtlas;
  tracks: Record<string, WebTrack>;
  /** Gaze cells, clockwise from up. */
  directions: number[];
  /** Cell of the neutral (centred) gaze pose. */
  neutral: number;
  /** Ambient states by animation name: `running`, `waiting`, `review`, `failed`. */
  states: Record<string, WebState>;
  /** Gaze dead zone in CSS pixels at scale 1. */
  gazeDeadzone: number;
  /** One `.nie-c<i>` class per atlas cell (aphrody-sprite-sheet). */
  css: string;
}

export { PET_WEB };

/** The cell to show and the milliseconds until it changes (null: the image is frozen). */
export interface Tick {
  sprite: number;
  delay: number | null;
}

const DEFAULT_TRACK = "idle";

const own = <T>(o: Record<string, T>, k: string): T | undefined =>
  Object.hasOwn(o, k) ? o[k] : undefined;

/** Sum of the declared durations (no floor), as `Piste::duree_totale_ms`. */
export function trackTotal(track: WebTrack): number {
  let total = 0;
  for (const [, ms] of track.frames) total += ms;
  return total;
}

function frameAtTime(track: WebTrack, elapsed: number): Tick | null {
  let rest = elapsed;
  for (const [sprite, ms] of track.frames) {
    const duration = Math.max(ms, 1);
    if (rest < duration) return { sprite, delay: duration - rest };
    rest -= duration;
  }
  const last = track.frames.at(-1);
  return last ? { sprite: last[0], delay: null } : null;
}

/** The frame `elapsed` ms into `track`: loops replay only the `loopStart..` segment; single passes freeze. */
export function currentFrame(track: WebTrack, elapsed: number): Tick | null {
  const frames = track.frames;
  if (frames.length <= 1)
    return frames[0] ? { sprite: frames[0][0], delay: null } : null;
  const t = Math.max(0, Math.floor(elapsed));
  const total = trackTotal(track);
  const start = track.loopStart;
  let effective = t;
  if (start !== null && start < frames.length) {
    let prefix = 0;
    let loop = 0;
    frames.forEach(([, ms], i) => {
      if (i < start) prefix += ms;
      else loop += ms;
    });
    if (t >= total && loop > 0)
      effective = prefix + (Math.max(0, t - prefix) % loop);
  } else if (start === null && t >= total) {
    const last = frames.at(-1);
    return last ? { sprite: last[0], delay: null } : null;
  }
  return frameAtTime(track, effective);
}

/**
 * Codex's `current_animation`: an unknown name plays `idle`; a finished single pass hands over
 * to its fallback once, with the same elapsed time.
 */
export function resolve(
  tracks: Record<string, WebTrack>,
  name: string,
  elapsed: number,
): { track: string; tick: Tick } | null {
  let current = own(tracks, name) ? name : DEFAULT_TRACK;
  let track = own(tracks, current);
  if (!track) return null;
  const t = Math.max(0, Math.floor(elapsed));
  const next = own(tracks, track.fallback);
  if (track.loopStart === null && t >= trackTotal(track) && next) {
    current = track.fallback;
    track = next;
  }
  const tick = currentFrame(track, t);
  return tick ? { track: current, tick } : null;
}

/** Index in the gaze ring for a pointer at (dx, dy) from the eyes (y grows downwards); null in the dead zone. */
export function gaze(
  dx: number,
  dy: number,
  deadzone: number,
  n: number,
): number | null {
  if (n === 0 || Math.hypot(dx, dy) < deadzone) return null;
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const step = 360 / n;
  const normalised = ((degrees % 360) + 360) % 360;
  return Math.round(normalised / step) % n;
}

/**
 * The ambient state: a dated state or none, and when the current animation started. `set`
 * restarts the animation (Codex `set_notification`); `clear` and expiry do not.
 */
export class Ambient {
  #state: { name: string; since: number } | null = null;
  #start: number;

  constructor(
    now: number,
    private readonly states: Record<string, WebState> = PET_WEB.states,
  ) {
    this.#start = Math.floor(now);
  }

  set(state: string, now: number): void {
    if (!own(this.states, state)) {
      throw new RangeError(
        `unknown pet state "${state}" (expected ${Object.keys(this.states).join(", ")})`,
      );
    }
    const t = Math.floor(now);
    this.#state = { name: state, since: t };
    this.#start = t;
  }

  clear(): void {
    this.#state = null;
  }

  /** The state still valid at `now`, its age and its remaining lifetime. */
  state(now: number): { name: string; age: number; remaining: number } | null {
    const s = this.#state;
    if (!s) return null;
    const lifetime = own(this.states, s.name)?.lifetimeMs;
    if (lifetime === undefined) return null;
    const age = Math.max(0, Math.floor(now) - s.since);
    return age < lifetime
      ? { name: s.name, age, remaining: lifetime - age }
      : null;
  }

  /** Animation to play at `now` and the time elapsed in it. */
  animation(now: number): [string, number] {
    const elapsed = Math.max(0, Math.floor(now) - this.#start);
    return [this.state(now)?.name ?? DEFAULT_TRACK, elapsed];
  }
}
