// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/ProgressBar.tsx), MIT, rebuilt on Material Design 3.

"use client";

import { m3Easings, useM3ReducedMotion } from "@aphrody/m3-motion";
import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { clsx } from "clsx";
import { motion } from "motion/react";
import { memo } from "react";

export type ProgressBarProps = {
  pending?: boolean;
  /** Extra classes on the track (added, not in SpaceUI). */
  className?: string;
} & (
  | {
      value: number;
      total: number;
    }
  | {
      percent: number;
    }
);

// M3 linear progress: 4 dp track on `secondary-container`, `primary` active indicator, full shape.
const track = "relative h-1 overflow-hidden rounded-full bg-secondary-container";

export const ProgressBar = memo((props: ProgressBarProps) => {
  const reduced = useM3ReducedMotion();
  const percentage = props.pending
    ? 0
    : "percent" in props
      ? props.percent
      : props.total > 0
        ? Math.round((props.value / props.total) * 100)
        : 0;

  if (props.pending) {
    // Base UI indeterminate progress (`value={null}`): role, aria and `data-indeterminate`.
    return (
      <ProgressPrimitive.Root
        value={null}
        aria-busy="true"
        aria-label="Loading"
        data-m3-component="ProgressBar"
        className={clsx("indeterminate-progress-bar", track, props.className)}
      >
        <ProgressPrimitive.Track className="block h-full">
          <motion.div
            className="indeterminate-progress-bar__progress absolute inset-y-0 left-0 w-2/5 rounded-full bg-primary"
            initial={reduced ? false : { x: "-100%" }}
            animate={{ x: reduced ? "0%" : "250%" }}
            transition={{
              duration: reduced ? 0 : 2,
              ease: m3Easings.standard,
              repeat: reduced ? 0 : Infinity,
            }}
          />
        </ProgressPrimitive.Track>
      </ProgressPrimitive.Root>
    );
  }
  const clamped = Math.min(100, Math.max(0, percentage));
  return (
    <ProgressPrimitive.Root
      value={clamped}
      aria-label="Progress"
      data-m3-component="ProgressBar"
      className={clsx(track, "w-[94%]", props.className)}
    >
      <ProgressPrimitive.Track className="block h-full">
        <ProgressPrimitive.Indicator
          style={{ width: `${clamped}%` }}
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-standard motion-reduce:transition-none"
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
});

ProgressBar.displayName = "ProgressBar";
