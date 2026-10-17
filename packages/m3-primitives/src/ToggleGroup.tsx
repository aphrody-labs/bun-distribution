// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/ToggleGroup.tsx), MIT, rebuilt on Material Design 3.

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { clsx } from "clsx";
import { forwardRef } from "react";

import { Icon, type IconSource, renderIcon } from "./Icon";
import { m3FocusRing, m3StateLayer } from "./utils";

export interface ToggleOption {
  value: string;
  label: string;
  /** Material Symbols name, element or icon component. */
  icon?: IconSource | React.ComponentType<{ className?: string }>;
  title?: string;
  className?: string;
}

export interface ToggleGroupProps {
  options: ToggleOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  itemClassName?: string;
}

/**
 * M3 segmented button (single select): full-shape outer corners, square inner segments, 1 dp
 * `outline` between segments; the selected segment is `secondary-container` with a leading
 * `check` (which replaces the option icon, as in M3). Base UI `ToggleGroup` + `Toggle`: single
 * selection, roving focus and `aria-pressed` on each segment.
 */
const ToggleGroup = forwardRef<HTMLDivElement, ToggleGroupProps>(
  ({ options, value, onChange, className, disabled, itemClassName }, ref) => {
    return (
      <ToggleGroupPrimitive
        ref={ref}
        value={[value]}
        onValueChange={values => values[0] !== undefined && onChange(values[0])}
        disabled={disabled}
        data-m3-component="ToggleGroup"
        className={clsx(
          "inline-flex h-8 items-stretch divide-x rounded-full border",
          disabled ? "divide-on-surface/12 border-on-surface/12" : "divide-outline border-outline",
          className,
        )}
      >
        {options.map(option => {
          const selected = option.value === value;
          return (
            <Toggle
              key={option.value}
              value={option.value}
              title={option.title}
              className={clsx(
                "inline-flex min-w-12 cursor-pointer items-center justify-center gap-2 px-3 text-label-large",
                "first:rounded-l-full last:rounded-r-full",
                "transition-colors duration-200 ease-standard",
                "text-on-surface data-pressed:bg-secondary-container data-pressed:text-on-secondary-container",
                "data-disabled:cursor-not-allowed data-disabled:bg-transparent data-disabled:text-on-surface/38",
                m3StateLayer,
                m3FocusRing,
                itemClassName,
                option.className,
              )}
            >
              {selected ? (
                <Icon name="check" size={18} />
              ) : (
                option.icon !== undefined &&
                renderIcon(option.icon as IconSource, {
                  size: 18,
                  className: "size-[18px]",
                })
              )}
              {option.label}
            </Toggle>
          );
        })}
      </ToggleGroupPrimitive>
    );
  },
);

ToggleGroup.displayName = "ToggleGroup";

export { ToggleGroup };
