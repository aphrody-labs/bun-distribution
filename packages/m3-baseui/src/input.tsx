// SPDX-License-Identifier: Apache-2.0
// Input: the M3 text field, outlined or filled (shares `css/field.css`).
"use client";
import { Input } from "@base-ui/react/input";
import type { ComponentProps } from "react";
import { cx, mergeClassName } from "./part";

export const INPUT_VARIANTS = ["outlined", "filled"] as const;
export type InputVariant = (typeof INPUT_VARIANTS)[number];

export type M3InputProps = ComponentProps<typeof Input> & {
  /** Default `outlined`. */
  variant?: InputVariant;
};

export function M3Input({ variant = "outlined", className, ...props }: M3InputProps) {
  return (
    <Input
      {...props}
      className={mergeClassName(cx("m3-bui-input", variant !== "outlined" && `m3-bui-input--${variant}`), className)}
    />
  );
}
