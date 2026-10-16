// SPDX-License-Identifier: Apache-2.0
// Progress: linear progress indicator.
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/progress.css`.
"use client";
import { Progress as B } from "@base-ui/react/progress";
import { part } from "./part";

export const Indicator = part(B.Indicator, "m3-bui-progress__indicator");
export const Label = part(B.Label, "m3-bui-progress__label");
export const Root = part(B.Root, "m3-bui-progress");
export const Track = part(B.Track, "m3-bui-progress__track");
export const Value = part(B.Value, "m3-bui-progress__value");
