"use client";

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createTransition, EASING } from "./create-transition.js";

/**
 * Scales its child up from a small, faded state and fades/scales it back out.
 * Combines opacity with a `transform: scale()`, like the MUI `Grow`.
 */
export const Grow = createTransition("Grow", {
  enter: { easing: EASING.emphasizedDecelerate, fallbackMs: 300 },
  exit: { easing: EASING.emphasizedAccelerate, fallbackMs: 200 },
  properties: ["opacity", "transform"],
  style: ({ visible, childStyle }) => ({
    opacity: visible ? 1 : 0,
    transform: visible ? "scale(1)" : "scale(0.75)",
    transformOrigin: childStyle?.transformOrigin ?? "center center",
  }),
});
