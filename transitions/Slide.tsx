"use client";

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createTransition, EASING } from "./create-transition.js";
import type { BaseTransitionProps } from "./use-transition-state.js";

/** The edge the child slides in from. */
export type SlideDirection = "left" | "right" | "up" | "down";

export interface SlideProps extends BaseTransitionProps {
  /**
   * The edge the child enters from (and exits toward). Defaults to `down`,
   * i.e. the child starts below its resting position and slides up into view.
   */
  direction?: SlideDirection;
  /**
   * The off-screen offset used while hidden. Accepts any CSS length; defaults
   * to `100%` of the element's own size on the relevant axis.
   */
  offset?: string;
}

function hiddenTransform(direction: SlideDirection, offset: string): string {
  switch (direction) {
    case "left":
      return `translateX(${offset})`;
    case "right":
      return `translateX(-${offset})`;
    case "up":
      return `translateY(${offset})`;
    case "down":
    default:
      return `translateY(-${offset})`;
  }
}

/**
 * Slides its child in from a screen edge and back out, animating `transform`.
 * The MUI `Slide` equivalent.
 */
export const Slide = createTransition<SlideProps>("Slide", {
  enter: { easing: EASING.emphasizedDecelerate, fallbackMs: 300 },
  exit: { easing: EASING.emphasizedAccelerate, fallbackMs: 200 },
  properties: ["transform"],
  style: ({ visible, props }) => ({
    transform: visible
      ? "translate(0, 0)"
      : hiddenTransform(props.direction ?? "down", props.offset ?? "100%"),
  }),
});
