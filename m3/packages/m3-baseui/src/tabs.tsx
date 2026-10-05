// SPDX-License-Identifier: Apache-2.0
// Tabs: primary tabs with a sliding indicator.
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/tabs.css`.
"use client";
import { Tabs as B } from "@base-ui/react/tabs";
import { part } from "./part";

export const Indicator = part(B.Indicator, "m3-bui-tabs__indicator");
export const List = part(B.List, "m3-bui-tabs__list");
export const Panel = part(B.Panel, "m3-bui-tabs__panel");
export const Root = part(B.Root, "m3-bui-tabs");
export const Tab = part(B.Tab, "m3-bui-tabs__tab m3-bui-state");
