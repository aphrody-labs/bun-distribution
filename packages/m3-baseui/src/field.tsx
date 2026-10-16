// SPDX-License-Identifier: Apache-2.0
// Field: label, control, description and error of one form control.
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/field.css`.
"use client";
import { Field as B } from "@base-ui/react/field";
import { part } from "./part";

export const Control = part(B.Control, "m3-bui-field__control");
export const Description = part(B.Description, "m3-bui-field__description");
export const Error = part(B.Error, "m3-bui-field__error");
export const Item = part(B.Item, "m3-bui-field__item");
export const Label = part(B.Label, "m3-bui-field__label");
export const Root = part(B.Root, "m3-bui-field");
export const Validity = B.Validity;
