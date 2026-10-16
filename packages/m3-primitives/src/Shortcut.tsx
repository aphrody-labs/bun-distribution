// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Shortcut.tsx), MIT, rebuilt on Material Design 3.

import { clsx } from "clsx";
import { type ComponentProps } from "react";

export interface ShortcutProps extends ComponentProps<"div"> {
  chars: string;
}

/** A keyboard key chip: `surface-container-high`, `label-small` in the code typeface. */
export const Shortcut = (props: ShortcutProps) => {
  const { className, chars, ...rest } = props;

  return (
    <kbd
      className={clsx(
        "inline-flex h-5 min-w-5 items-center justify-center px-1",
        "rounded-extra-small border border-b-2 border-outline-variant",
        "bg-surface-container-high font-code text-label-small text-on-surface-variant",
        className,
      )}
      {...(rest as ComponentProps<"kbd">)}
    >
      {chars}
    </kbd>
  );
};
