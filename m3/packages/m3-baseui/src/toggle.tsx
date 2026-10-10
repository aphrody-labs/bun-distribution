// SPDX-License-Identifier: Apache-2.0
// Toggle: a two-state button (M3 toggle button); pressed is `data-pressed`.
"use client";
import { Toggle } from "@base-ui/react/toggle";
import { part } from "./part";

export const M3Toggle = part(Toggle, "m3-bui-toggle m3-bui-state");
