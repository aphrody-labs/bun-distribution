// SPDX-License-Identifier: Apache-2.0
// Toast: snackbar messages.
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/toast.css`.
"use client";
import { Toast as B } from "@base-ui/react/toast";
import { part } from "./part";

export const Action = part(B.Action, "m3-bui-toast__action m3-bui-state");
export const Arrow = B.Arrow;
export const Close = part(B.Close, "m3-bui-toast__close m3-bui-state");
export const Content = part(B.Content, "m3-bui-toast__content");
export const Description = part(B.Description, "m3-bui-toast__description");
export const Portal = B.Portal;
export const Positioner = B.Positioner;
export const Provider = B.Provider;
export const Root = part(B.Root, "m3-bui-toast");
export const Title = part(B.Title, "m3-bui-toast__title");
export const Viewport = part(B.Viewport, "m3-bui-toast__viewport");
export const createToastManager = B.createToastManager;
export const useToastManager = B.useToastManager;
