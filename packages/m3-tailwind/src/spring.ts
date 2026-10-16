// SPDX-License-Identifier: Apache-2.0
// M3 springs as CSS: the unit-step response of a mass-spring-damper (mass 1, damping ratio, stiffness)
// sampled into a `linear()` easing plus the time it takes to settle. CSS has no spring easing, and a
// cubic-bezier cannot overshoot; `linear()` can, so the Expressive springs keep their bounce.

export interface SpringCss {
  /** `linear(0, ...)` easing function value. */
  easing: string;
  /** Settle time in ms (within 0.2% of the rest position), rounded up to 10 ms. */
  durationMs: number;
}

/** Position of the spring at time `t` seconds, from 0 at rest to 1 at target. */
export function springPosition(
  damping: number,
  stiffness: number,
  t: number,
): number {
  const w0 = Math.sqrt(stiffness);
  if (damping < 1) {
    const wd = w0 * Math.sqrt(1 - damping * damping);
    const decay = Math.exp(-damping * w0 * t);
    return (
      1 - decay * (Math.cos(wd * t) + ((damping * w0) / wd) * Math.sin(wd * t))
    );
  }
  if (damping === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const root = Math.sqrt(damping * damping - 1);
  const s1 = -w0 * (damping - root);
  const s2 = -w0 * (damping + root);
  return 1 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1);
}

const SETTLE = 0.002;

/** Smallest time (ms, multiple of 10) after which the spring stays within {@link SETTLE} of 1. */
export function springSettleMs(damping: number, stiffness: number): number {
  let last = 0;
  for (let ms = 0; ms <= 4000; ms += 1) {
    if (Math.abs(1 - springPosition(damping, stiffness, ms / 1000)) > SETTLE)
      last = ms;
  }
  return Math.ceil((last + 1) / 10) * 10;
}

const round = (n: number): string => String(Math.round(n * 1e4) / 1e4);

/** Sample a spring (damping ratio, stiffness; mass 1) into `points + 1` evenly spaced `linear()` stops. */
export function springToCss(
  damping: number,
  stiffness: number,
  points = 32,
): SpringCss {
  const durationMs = springSettleMs(damping, stiffness);
  const stops: string[] = [];
  for (let i = 0; i <= points; i += 1) {
    stops.push(
      i === points
        ? "1"
        : i === 0
          ? "0"
          : round(
              springPosition(
                damping,
                stiffness,
                (durationMs / 1000) * (i / points),
              ),
            ),
    );
  }
  return { easing: `linear(${stops.join(", ")})`, durationMs };
}
