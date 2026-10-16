// SPDX-License-Identifier: Apache-2.0
// Accordion: stacked disclosure items.
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/accordion.css`.
"use client";
import { Accordion as B } from "@base-ui/react/accordion";
import { part } from "./part";

export const Header = part(B.Header, "m3-bui-accordion__header");
export const Item = part(B.Item, "m3-bui-accordion__item");
export const Panel = part(B.Panel, "m3-bui-accordion__panel");
export const Root = part(B.Root, "m3-bui-accordion");
export const Trigger = part(
  B.Trigger,
  "m3-bui-accordion__trigger m3-bui-state",
);
