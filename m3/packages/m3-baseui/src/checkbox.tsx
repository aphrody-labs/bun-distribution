// SPDX-License-Identifier: Apache-2.0
// Checkbox: 18dp box in a 40dp state layer; the indicator draws a check, or a dash when indeterminate.
"use client";
import { Checkbox } from "@base-ui/react/checkbox";
import type { ComponentProps } from "react";
import { part } from "./part";

export const Root = part(Checkbox.Root, "m3-bui-checkbox m3-bui-state");
export const Indicator = part(Checkbox.Indicator, "m3-bui-checkbox__indicator");

export type M3CheckboxProps = ComponentProps<typeof Root>;

/** `Root` with an `Indicator` holding the check and the indeterminate dash (the stylesheet shows one). */
export function M3Checkbox(props: M3CheckboxProps) {
  return (
    <Root {...props}>
      <Indicator>
        <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
          <path className="m3-bui-checkbox__check" d="M3.5 9.5l3.5 3.5 7.5-8" />
          <path className="m3-bui-checkbox__dash" d="M4 9h10" />
        </svg>
      </Indicator>
    </Root>
  );
}
