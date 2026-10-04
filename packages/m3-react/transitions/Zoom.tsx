"use client";

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createTransition, EASING } from "./create-transition.js";

/**
 * Zooms its child in from scale 0 to its natural size and back out, animating
 * only `transform`. The MUI `Zoom` equivalent.
 */
export const Zoom = createTransition("Zoom", {
  enter: { easing: EASING.emphasizedDecelerate, fallbackMs: 250 },
  exit: { easing: EASING.emphasizedAccelerate, fallbackMs: 200 },
  properties: ["transform"],
  style: ({ visible, childStyle }) => ({
    transform: visible ? "scale(1)" : "scale(0)",
    transformOrigin: childStyle?.transformOrigin ?? "center center",
  }),
});
