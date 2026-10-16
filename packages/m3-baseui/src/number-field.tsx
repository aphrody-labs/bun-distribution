// SPDX-License-Identifier: Apache-2.0
// Number field: a numeric text field with steppers.
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/number-field.css`.
"use client";
import { NumberField as B } from "@base-ui/react/number-field";
import { part } from "./part";

export const Decrement = part(
  B.Decrement,
  "m3-bui-number-field__step m3-bui-state",
);
export const Group = part(B.Group, "m3-bui-number-field__group");
export const Increment = part(
  B.Increment,
  "m3-bui-number-field__step m3-bui-state",
);
export const Input = part(B.Input, "m3-bui-number-field__input");
export const Root = part(B.Root, "m3-bui-number-field");
export const ScrubArea = part(B.ScrubArea, "m3-bui-number-field__scrub");
export const ScrubAreaCursor = B.ScrubAreaCursor;
