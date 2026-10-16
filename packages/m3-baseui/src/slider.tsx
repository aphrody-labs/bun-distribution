// SPDX-License-Identifier: Apache-2.0
// Slider: one or two thumbs on a track.
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/slider.css`.
"use client";
import { Slider as B } from "@base-ui/react/slider";
import { part } from "./part";

export const Control = part(B.Control, "m3-bui-slider__control");
export const Indicator = part(B.Indicator, "m3-bui-slider__indicator");
export const Label = part(B.Label, "m3-bui-slider__label");
export const Root = part(B.Root, "m3-bui-slider");
export const Thumb = part(B.Thumb, "m3-bui-slider__thumb");
export const Track = part(B.Track, "m3-bui-slider__track");
export const Value = part(B.Value, "m3-bui-slider__value");
