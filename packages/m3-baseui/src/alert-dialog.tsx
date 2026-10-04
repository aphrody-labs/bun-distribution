// SPDX-License-Identifier: Apache-2.0
// Alert dialog: the dialog surface for a decision that blocks the page (shares `css/dialog.css`).
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/dialog.css`.
"use client";
import { AlertDialog as B } from "@base-ui/react/alert-dialog";
import { part } from "./part";

export const Backdrop = part(B.Backdrop, "m3-bui-dialog__backdrop");
export const Close = B.Close;
export const Description = part(B.Description, "m3-bui-dialog__description");
export const Handle = B.Handle;
export const Popup = part(B.Popup, "m3-bui-dialog__popup");
export const Portal = B.Portal;
export const Root = B.Root;
export const Title = part(B.Title, "m3-bui-dialog__title");
export const Trigger = B.Trigger;
export const Viewport = part(B.Viewport, "m3-bui-dialog__viewport");
export const createHandle = B.createHandle;
