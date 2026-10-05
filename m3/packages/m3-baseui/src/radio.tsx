// SPDX-License-Identifier: Apache-2.0
// Radio: 20dp ring with a 10dp dot, in a 40dp state layer.
"use client";
import { Radio } from "@base-ui/react/radio";
import type { ComponentProps } from "react";
import { part } from "./part";

export const Root = part(Radio.Root, "m3-bui-radio m3-bui-state");
export const Indicator = part(Radio.Indicator, "m3-bui-radio__indicator");

export type M3RadioProps = ComponentProps<typeof Root>;

/** `Root` with its `Indicator`. Put it inside {@link M3RadioGroup}. */
export function M3Radio(props: M3RadioProps) {
  return (
    <Root {...props}>
      <Indicator />
    </Root>
  );
}
