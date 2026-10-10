"use client";

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createTransition, EASING } from "./create-transition.js";

/**
 * Fades its child in and out by animating `opacity`, using M3 motion tokens.
 * The MUI `Fade` equivalent.
 */
export const Fade = createTransition("Fade", {
  enter: { easing: EASING.standardDecelerate, fallbackMs: 250 },
  exit: { easing: EASING.standardAccelerate, fallbackMs: 200 },
  properties: ["opacity"],
  style: ({ visible }) => ({ opacity: visible ? 1 : 0 }),
});
