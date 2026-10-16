// SPDX-License-Identifier: Apache-2.0
// Switch: 52x32dp track, thumb 16dp off and 24dp on, 28dp pressed.
"use client";
import { Switch } from "@base-ui/react/switch";
import type { ComponentProps } from "react";
import { part } from "./part";

export const Root = part(Switch.Root, "m3-bui-switch");
export const Thumb = part(Switch.Thumb, "m3-bui-switch__thumb");

export type M3SwitchProps = ComponentProps<typeof Root>;

/** `Root` with its `Thumb`. Use `Root` and `Thumb` for a custom thumb. */
export function M3Switch(props: M3SwitchProps) {
  return (
    <Root {...props}>
      <Thumb />
    </Root>
  );
}
