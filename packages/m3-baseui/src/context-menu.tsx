// SPDX-License-Identifier: Apache-2.0
// Context menu: a menu opened by right click or long press (shares `css/menu.css`).
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/menu.css`.
"use client";
import { ContextMenu as B } from "@base-ui/react/context-menu";
import { part } from "./part";

export const Arrow = B.Arrow;
export const Backdrop = B.Backdrop;
export const CheckboxItem = part(
  B.CheckboxItem,
  "m3-bui-menu__item m3-bui-item",
);
export const CheckboxItemIndicator = part(
  B.CheckboxItemIndicator,
  "m3-bui-menu__indicator",
);
export const Group = part(B.Group, "m3-bui-menu__group");
export const GroupLabel = part(B.GroupLabel, "m3-bui-menu__group-label");
export const Item = part(B.Item, "m3-bui-menu__item m3-bui-item");
export const LinkItem = part(B.LinkItem, "m3-bui-menu__item m3-bui-item");
export const Popup = part(B.Popup, "m3-bui-menu__popup m3-bui-popup");
export const Portal = B.Portal;
export const Positioner = part(B.Positioner, "m3-bui-positioner");
export const RadioGroup = part(B.RadioGroup, "m3-bui-menu__group");
export const RadioItem = part(B.RadioItem, "m3-bui-menu__item m3-bui-item");
export const RadioItemIndicator = part(
  B.RadioItemIndicator,
  "m3-bui-menu__indicator",
);
export const Root = B.Root;
export const Separator = part(B.Separator, "m3-bui-menu__separator");
export const SubmenuRoot = B.SubmenuRoot;
export const SubmenuTrigger = part(
  B.SubmenuTrigger,
  "m3-bui-menu__item m3-bui-menu__submenu-trigger m3-bui-item",
);
export const Trigger = B.Trigger;
