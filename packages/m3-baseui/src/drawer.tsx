// SPDX-License-Identifier: Apache-2.0
// Drawer: a swipeable sheet (bottom sheet by default; side sheets by `swipeDirection`).
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/drawer.css`.
"use client";
import { Drawer as B } from "@base-ui/react/drawer";
import { part } from "./part";

export const Backdrop = part(B.Backdrop, "m3-bui-drawer__backdrop");
export const Close = B.Close;
export const Content = part(B.Content, "m3-bui-drawer__content");
export const Description = part(B.Description, "m3-bui-drawer__description");
export const Handle = B.Handle;
export const Indent = B.Indent;
export const IndentBackground = B.IndentBackground;
export const Popup = part(B.Popup, "m3-bui-drawer__popup");
export const Portal = B.Portal;
export const Provider = B.Provider;
export const Root = B.Root;
export const SwipeArea = B.SwipeArea;
export const Title = part(B.Title, "m3-bui-drawer__title");
export const Trigger = B.Trigger;
export const Viewport = part(B.Viewport, "m3-bui-drawer__viewport");
export const VirtualKeyboardProvider = B.VirtualKeyboardProvider;
export const createHandle = B.createHandle;
