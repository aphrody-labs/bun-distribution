// SPDX-License-Identifier: Apache-2.0
// Fieldset: a group of related fields.
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/fieldset.css`.
"use client";
import { Fieldset as B } from "@base-ui/react/fieldset";
import { part } from "./part";

export const Legend = part(B.Legend, "m3-bui-fieldset__legend");
export const Root = part(B.Root, "m3-bui-fieldset");
