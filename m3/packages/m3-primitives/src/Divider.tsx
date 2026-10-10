// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Divider.tsx), MIT, rebuilt on Material Design 3.

"use client";

import { clsx } from "clsx";

export interface DividerProps extends React.HTMLAttributes<HTMLHRElement> {
  /** M3 dividers are horizontal by default; `vertical` draws a 1 dp column. */
  orientation?: "horizontal" | "vertical";
}

/** M3 divider: 1 dp `outline-variant`. A native `<hr>` (implicit `separator` role). */
export const Divider = ({ className, orientation = "horizontal", ...props }: DividerProps) => (
  <hr
    aria-orientation={orientation === "vertical" ? "vertical" : undefined}
    className={clsx(
      "shrink-0 border-0 bg-outline-variant",
      orientation === "vertical" ? "mx-1 my-0 h-full w-px self-stretch" : "mx-0 my-1 h-px w-full",
      className,
    )}
    data-m3-component="Divider"
    {...props}
  />
);
