// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/SearchBar.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { clsx } from "clsx";
import { forwardRef, useState } from "react";

import { Icon } from "./Icon";

/**
 * M3 search bar: full-rounded `surface-container-high` container, leading `search` icon,
 * `body-large` input and a trailing clear icon button.
 *
 * `size`: `md` is the M3 baseline (56dp), `sm` (40dp) and `xs` (32dp, the upstream SpaceUI
 * height) are density steps for toolbars and sidebars.
 */
interface SearchBarProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "size"
> {
  value?: string;
  onChange?: (value: string) => void;
  onClear?: () => void;
  size?: "xs" | "sm" | "md";
}

const containerSizes = {
  xs: "h-8 gap-2 px-3",
  sm: "h-10 gap-3 px-3",
  md: "h-14 gap-4 px-4",
} as const;

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
  (
    {
      value,
      onChange,
      onClear,
      className,
      placeholder = "Search...",
      size = "md",
      ...props
    },
    ref,
  ) => {
    const [internalValue, setInternalValue] = useState("");
    const currentValue = value !== undefined ? value : internalValue;
    const dense = size !== "md";

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      if (onChange) {
        onChange(newValue);
      } else {
        setInternalValue(newValue);
      }
    };

    const handleClear = () => {
      if (onChange) {
        onChange("");
      } else {
        setInternalValue("");
      }
      onClear?.();
    };

    return (
      <div
        data-m3-component="SearchBar"
        className={clsx(
          "relative flex items-center",
          containerSizes[size],
          "rounded-full bg-surface-container-high text-on-surface",
          // Hover state layer (on-surface 8 %).
          "before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-on-surface before:opacity-0 before:transition-opacity before:duration-200 before:ease-standard before:content-['']",
          "hover:before:opacity-8",
          "has-[:disabled]:opacity-38",
          className,
        )}
      >
        <Icon
          name="search"
          size={dense ? 20 : 24}
          className="text-on-surface"
        />
        <input
          ref={ref}
          type="text"
          value={currentValue}
          onChange={handleChange}
          placeholder={placeholder}
          className={clsx(
            "relative min-w-0 flex-1 border-0 bg-transparent p-0 outline-none",
            dense ? "text-body-medium" : "text-body-large",
            "text-on-surface placeholder:text-on-surface-variant",
            "focus:border-0 focus:outline-none focus:ring-0",
          )}
          {...props}
        />
        {currentValue && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear Search"
            className={clsx(
              "relative -mr-1 inline-flex shrink-0 items-center justify-center rounded-full text-on-surface-variant outline-none",
              "transition-colors duration-200 ease-standard hover:bg-on-surface-variant/8 active:bg-on-surface-variant/10",
              "focus-visible:outline-3 focus-visible:outline-secondary",
              size === "xs" ? "size-6" : dense ? "size-8" : "size-10",
            )}
          >
            <Icon name="close" size={size === "xs" ? 18 : dense ? 20 : 24} />
          </button>
        )}
      </div>
    );
  },
);

SearchBar.displayName = "SearchBar";
