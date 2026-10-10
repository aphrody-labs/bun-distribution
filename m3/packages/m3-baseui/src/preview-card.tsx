// SPDX-License-Identifier: Apache-2.0
// Preview card: a link preview on hover (shares `css/popover.css`).
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/popover.css`.
"use client";
import { PreviewCard as B } from "@base-ui/react/preview-card";
import { part } from "./part";

export const Arrow = B.Arrow;
export const Backdrop = B.Backdrop;
export const Handle = B.Handle;
export const Popup = part(B.Popup, "m3-bui-popover__popup m3-bui-popup");
export const Portal = B.Portal;
export const Positioner = part(B.Positioner, "m3-bui-positioner");
export const Root = B.Root;
export const Trigger = B.Trigger;
export const Viewport = B.Viewport;
export const createHandle = B.createHandle;
