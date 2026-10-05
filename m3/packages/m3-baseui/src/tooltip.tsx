// SPDX-License-Identifier: Apache-2.0
// Tooltip: a plain tooltip.
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/tooltip.css`.
"use client";
import { Tooltip as B } from "@base-ui/react/tooltip";
import { part } from "./part";

export const Arrow = B.Arrow;
export const Handle = B.Handle;
export const Popup = part(B.Popup, "m3-bui-tooltip__popup");
export const Portal = B.Portal;
export const Positioner = part(B.Positioner, "m3-bui-positioner");
export const Provider = B.Provider;
export const Root = B.Root;
export const Trigger = B.Trigger;
export const Viewport = B.Viewport;
export const createHandle = B.createHandle;
