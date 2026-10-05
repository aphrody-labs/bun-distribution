// SPDX-License-Identifier: Apache-2.0
// Popover: rich content anchored to a trigger.
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/popover.css`.
"use client";
import { Popover as B } from "@base-ui/react/popover";
import { part } from "./part";

export const Arrow = B.Arrow;
export const Backdrop = B.Backdrop;
export const Close = B.Close;
export const Description = part(B.Description, "m3-bui-popover__description");
export const Handle = B.Handle;
export const Popup = part(B.Popup, "m3-bui-popover__popup m3-bui-popup");
export const Portal = B.Portal;
export const Positioner = part(B.Positioner, "m3-bui-positioner");
export const Root = B.Root;
export const Title = part(B.Title, "m3-bui-popover__title");
export const Trigger = B.Trigger;
export const Viewport = B.Viewport;
export const createHandle = B.createHandle;
