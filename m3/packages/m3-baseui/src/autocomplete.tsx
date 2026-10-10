// SPDX-License-Identifier: Apache-2.0
// Autocomplete: a text field with a list of suggestions (shares `css/combobox.css`).
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/combobox.css`.
"use client";
import { Autocomplete as B } from "@base-ui/react/autocomplete";
import { part } from "./part";

export const Arrow = B.Arrow;
export const Backdrop = B.Backdrop;
export const Clear = part(B.Clear, "m3-bui-combobox__clear m3-bui-state");
export const Collection = B.Collection;
export const Empty = part(B.Empty, "m3-bui-combobox__empty");
export const Group = B.Group;
export const GroupLabel = part(B.GroupLabel, "m3-bui-combobox__group-label");
export const Icon = part(B.Icon, "m3-bui-combobox__icon");
export const Input = part(B.Input, "m3-bui-combobox__input");
export const InputGroup = part(B.InputGroup, "m3-bui-combobox__input-group");
export const Item = part(B.Item, "m3-bui-combobox__item m3-bui-item");
export const List = part(B.List, "m3-bui-combobox__list");
export const Popup = part(B.Popup, "m3-bui-combobox__popup m3-bui-popup");
export const Portal = B.Portal;
export const Positioner = part(B.Positioner, "m3-bui-positioner");
export const Root = B.Root;
export const Row = B.Row;
export const Separator = part(B.Separator, "m3-bui-combobox__separator");
export const Status = part(B.Status, "m3-bui-combobox__status");
export const Trigger = part(B.Trigger, "m3-bui-combobox__trigger m3-bui-state");
export const Value = B.Value;
export const useFilter = B.useFilter;
export const useFilteredItems = B.useFilteredItems;
