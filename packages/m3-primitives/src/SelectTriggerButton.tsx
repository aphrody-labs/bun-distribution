// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/SelectTriggerButton.tsx), MIT, rebuilt on Material Design 3.

import { clsx } from "clsx";
import { forwardRef } from "react";

import { Icon } from "./Icon";
import { m3FocusRing, m3StateLayer } from "./utils";

export interface SelectTriggerButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  placeholder?: string;
}

/** A menu trigger with the M3 outlined-button anatomy (40 dp, full shape, trailing `expand_more`). */
const SelectTriggerButton = forwardRef<HTMLButtonElement, SelectTriggerButtonProps>(
  ({ className, children, placeholder, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        aria-haspopup="listbox"
        className={clsx(
          "flex h-10 min-w-[220px] cursor-pointer items-center gap-2 rounded-full border border-outline-variant bg-transparent ps-4 pe-3 text-left text-label-large text-on-surface",
          "transition-colors duration-200 ease-standard",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-on-surface/12 disabled:text-on-surface/38",
          m3StateLayer,
          m3FocusRing,
          className,
        )}
        {...props}
      >
        <span className={clsx("flex-1 truncate text-left", !children && "text-on-surface-variant")}>
          {children || placeholder}
        </span>
        <Icon name="expand_more" size={20} className="text-on-surface-variant" />
      </button>
    );
  },
);

SelectTriggerButton.displayName = "SelectTriggerButton";

export { SelectTriggerButton };
