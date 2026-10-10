// SPDX-License-Identifier: Apache-2.0
// One-time password field: one input per character.
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/otp-field.css`.
"use client";
import { OTPField as B } from "@base-ui/react/otp-field";
import { part } from "./part";

export const Input = part(B.Input, "m3-bui-otp__input");
export const Root = part(B.Root, "m3-bui-otp");
export const Separator = part(B.Separator, "m3-bui-otp__separator");
