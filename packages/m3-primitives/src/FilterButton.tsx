// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/FilterButton.tsx), MIT, rebuilt on Material Design 3.

import { clsx } from "clsx";
import { forwardRef } from "react";

import { Icon } from "./Icon";
import { m3FocusRing, m3StateLayer } from "./utils";

export interface FilterButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  label?: string;
}

/**
 * M3 filter chip: 32 dp, `rounded-small`, outlined when unselected, `secondary-container` with a
 * leading check when selected.
 */
const FilterButton = forwardRef<HTMLButtonElement, FilterButtonProps>(
  ({ className, active, label, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={active ?? false}
        className={clsx(
          "inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-small border text-label-large",
          "transition-colors duration-200 ease-standard",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:text-on-surface/38",
          m3StateLayer,
          m3FocusRing,
          active
            ? "border-transparent bg-secondary-container ps-2 pe-4 text-on-secondary-container disabled:bg-on-surface/12"
            : "border-outline-variant bg-transparent px-4 text-on-surface-variant disabled:border-on-surface/12",
          className,
        )}
        {...props}
      >
        {active && <Icon name="check" size={18} />}
        {label ?? children}
      </button>
    );
  },
);

FilterButton.displayName = "FilterButton";

export { FilterButton };
