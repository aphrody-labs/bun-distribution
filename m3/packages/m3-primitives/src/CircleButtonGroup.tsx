// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/CircleButtonGroup.tsx), MIT, rebuilt on Material Design 3.

import { clsx } from "clsx";
import { Children, cloneElement, isValidElement } from "react";

interface CircleButtonGroupProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * A connected row of icon buttons on one `surface-container-high` pill (M3 connected button group
 * / floating toolbar). Children lose their own container; their state layer still shows.
 */
export function CircleButtonGroup({ children, className }: CircleButtonGroupProps) {
  const childArray = Children.toArray(children);

  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- M3 connected button group: a <fieldset> would add a border, padding, min-inline-size and legend semantics that break the pill.
      role="group"
      className={clsx(
        "flex h-10 items-center rounded-full",
        "bg-surface-container-high text-on-surface-variant",
        "overflow-hidden",
        className,
      )}
    >
      {childArray.map((child, index) => {
        if (!isValidElement(child)) return child;

        return (
          <div key={child.key} className="relative flex h-full items-center">
            {cloneElement(child as React.ReactElement<any>, {
              className: clsx(
                (child as any).props.className,
                "!h-full !rounded-none !border-0 !bg-transparent !shadow-none",
              ),
            })}
            {index < childArray.length - 1 && (
              <hr
                aria-orientation="vertical"
                className="m-0 h-5 w-px border-0 bg-outline-variant"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export type { CircleButtonGroupProps };
