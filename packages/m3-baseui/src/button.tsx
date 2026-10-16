// SPDX-License-Identifier: Apache-2.0
// Button: the five M3 common-button types in the five Expressive sizes.
"use client";
import { Button } from "@base-ui/react/button";
import type { ComponentProps } from "react";
import { cx, mergeClassName } from "./part";

export const BUTTON_VARIANTS = [
  "filled",
  "tonal",
  "outlined",
  "text",
  "elevated",
] as const;
export const BUTTON_SIZES = ["xs", "sm", "md", "lg", "xl"] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];
export type ButtonSize = (typeof BUTTON_SIZES)[number];

export type M3ButtonProps = ComponentProps<typeof Button> & {
  /** Emphasis, `filled` (highest) to `text` (lowest). Default `filled`. */
  variant?: ButtonVariant;
  /** `xs` 32dp, `sm` 40dp (default), `md` 56dp, `lg` 96dp, `xl` 136dp. */
  size?: ButtonSize;
};

export function M3Button({
  variant = "filled",
  size = "sm",
  className,
  ...props
}: M3ButtonProps) {
  // `sm` is the base size: only the other four sizes add a class.
  const base = cx(
    "m3-bui-button m3-bui-state",
    `m3-bui-button--${variant}`,
    size !== "sm" && `m3-bui-button--${size}`,
  );
  return <Button {...props} className={mergeClassName(base, className)} />;
}
