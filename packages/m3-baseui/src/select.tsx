// SPDX-License-Identifier: Apache-2.0
// Select: choose one value from a popup list.
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/select.css`.
"use client";
import { Select as B } from "@base-ui/react/select";
import { part } from "./part";

export const Arrow = B.Arrow;
export const Backdrop = B.Backdrop;
export const Group = B.Group;
export const GroupLabel = part(B.GroupLabel, "m3-bui-select__group-label");
export const Icon = part(B.Icon, "m3-bui-select__icon");
export const Item = part(B.Item, "m3-bui-select__item m3-bui-item");
export const ItemIndicator = part(B.ItemIndicator, "m3-bui-select__item-indicator");
export const ItemText = part(B.ItemText, "m3-bui-select__item-text");
export const Label = part(B.Label, "m3-bui-select__label");
export const List = part(B.List, "m3-bui-select__list");
export const Popup = part(B.Popup, "m3-bui-select__popup m3-bui-popup");
export const Portal = B.Portal;
export const Positioner = part(B.Positioner, "m3-bui-positioner");
export const Root = B.Root;
export const ScrollDownArrow = part(B.ScrollDownArrow, "m3-bui-select__arrow");
export const ScrollUpArrow = part(B.ScrollUpArrow, "m3-bui-select__arrow");
export const Separator = part(B.Separator, "m3-bui-select__separator");
export const Trigger = part(B.Trigger, "m3-bui-select__trigger");
export const Value = part(B.Value, "m3-bui-select__value");
