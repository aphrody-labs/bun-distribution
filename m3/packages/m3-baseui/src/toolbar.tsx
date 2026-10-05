// SPDX-License-Identifier: Apache-2.0
// Toolbar: a row of related controls.
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/toolbar.css`.
"use client";
import { Toolbar as B } from "@base-ui/react/toolbar";
import { part } from "./part";

export const Button = part(B.Button, "m3-bui-toolbar__button m3-bui-state");
export const Group = part(B.Group, "m3-bui-toolbar__group");
export const Input = part(B.Input, "m3-bui-toolbar__input");
export const Link = part(B.Link, "m3-bui-toolbar__button m3-bui-state");
export const Root = part(B.Root, "m3-bui-toolbar");
export const Separator = part(B.Separator, "m3-bui-toolbar__separator");
