// SPDX-License-Identifier: Apache-2.0
// Collapsible: one disclosure.
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/collapsible.css`.
"use client";
import { Collapsible as B } from "@base-ui/react/collapsible";
import { part } from "./part";

export const Panel = part(B.Panel, "m3-bui-collapsible__panel");
export const Root = part(B.Root, "m3-bui-collapsible");
export const Trigger = part(
  B.Trigger,
  "m3-bui-collapsible__trigger m3-bui-state",
);
