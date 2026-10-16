// SPDX-License-Identifier: Apache-2.0
// Scroll area: a scroll container with themed scrollbars.
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/scroll-area.css`.
"use client";
import { ScrollArea as B } from "@base-ui/react/scroll-area";
import { part } from "./part";

export const Content = B.Content;
export const Corner = B.Corner;
export const Root = part(B.Root, "m3-bui-scroll");
export const Scrollbar = part(B.Scrollbar, "m3-bui-scroll__bar");
export const Thumb = part(B.Thumb, "m3-bui-scroll__thumb");
export const Viewport = part(B.Viewport, "m3-bui-scroll__viewport");
