// SPDX-License-Identifier: Apache-2.0
// Avatar: image with initials fallback.
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/avatar.css`.
"use client";
import { Avatar as B } from "@base-ui/react/avatar";
import { part } from "./part";

export const Fallback = part(B.Fallback, "m3-bui-avatar__fallback");
export const Image = part(B.Image, "m3-bui-avatar__image");
export const Root = part(B.Root, "m3-bui-avatar");
