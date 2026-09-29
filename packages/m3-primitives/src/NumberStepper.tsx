// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/NumberStepper.tsx), MIT, rebuilt on Material Design 3.
import { clsx } from "clsx";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "./Icon";

/**
 * A number field: an M3 outlined text field holding the value between two standard icon
 * buttons (`remove` / `add`). Double-click the value to type it. `showProgress` adds an M3
 * linear progress indicator (range position) underneath.
 */
export interface NumberStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  allowFloat?: boolean;
  disabled?: boolean;
  className?: string;
  showProgress?: boolean;
  label?: string;
  description?: string;
  suffix?: string;
  /** `md`: M3 baseline 56dp field. `sm`: 40dp density step (upstream height). */
  size?: "sm" | "md";
}

const NumberStepper = forwardRef<HTMLDivElement, NumberStepperProps>(
  (
    {
      value,
      onChange,
      min = 0,
      max,
      step = 1,
      allowFloat = false,
      disabled = false,
      className,
      showProgress = false,
      label,
      description,
      suffix,
      size = "md",
    },
    ref,
  ) => {
    const [editing, setEditing] = useState(false);
    const [inputValue, setInputValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const dense = size === "sm";

    useEffect(() => {
      if (editing && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, [editing]);

    const clampValue = useCallback(
      (v: number) => {
        let clamped = Math.max(min, v);
        if (max !== undefined) clamped = Math.min(max, clamped);
        return clamped;
      },
      [min, max],
    );

    const handleDecrement = () => {
      const newValue = allowFloat ? clampValue(value - step) : clampValue(Math.floor(value - step));
      onChange(newValue);
    };

    const handleIncrement = () => {
      const newValue = allowFloat ? clampValue(value + step) : clampValue(Math.ceil(value + step));
      onChange(newValue);
    };

    const commitInput = () => {
      const parsed = allowFloat ? parseFloat(inputValue) : parseInt(inputValue, 10);
      if (!isNaN(parsed)) {
        onChange(clampValue(parsed));
      }
      setEditing(false);
    };

    const progress = max !== undefined ? ((value - min) / (max - min)) * 100 : undefined;

    const iconButton = clsx(
      "inline-flex shrink-0 items-center justify-center rounded-full text-on-surface-variant outline-none",
      "transition-colors duration-200 ease-standard hover:bg-on-surface-variant/8 active:bg-on-surface-variant/10",
      "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-secondary",
      "disabled:cursor-not-allowed disabled:text-on-surface/38 disabled:hover:bg-transparent",
      dense ? "size-8" : "size-10",
    );
    const valueText = clsx(
      "min-w-[3rem] text-center text-on-surface",
      dense ? "text-body-medium" : "text-body-large",
    );

    return (
      <div ref={ref} className={clsx("flex flex-col gap-1", className)}>
        {(label || description) && (
          <div className="flex flex-col gap-0.5">
            {label && <span className="text-label-large text-on-surface">{label}</span>}
            {description && (
              <span className="text-body-small text-on-surface-variant">{description}</span>
            )}
          </div>
        )}
        <div
          className={clsx(
            "flex w-fit items-center gap-1 rounded-extra-small border border-outline bg-transparent",
            "transition-[border-color,box-shadow] duration-200 ease-standard hover:border-on-surface",
            "focus-within:border-primary focus-within:ring-1 focus-within:ring-inset focus-within:ring-primary focus-within:hover:border-primary",
            dense ? "h-10 px-1" : "h-14 px-2",
            disabled && "pointer-events-none opacity-38",
          )}
        >
          <button
            type="button"
            aria-label="Decrease"
            onClick={handleDecrement}
            disabled={disabled || value <= min}
            className={iconButton}
          >
            <Icon name="remove" size={dense ? 20 : 24} />
          </button>
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onBlur={commitInput}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitInput();
                if (e.key === "Escape") setEditing(false);
              }}
              className={clsx(valueText, "w-[4rem] bg-transparent caret-primary outline-none")}
            />
          ) : (
            <span
              className={clsx(valueText, "cursor-text select-none")}
              onDoubleClick={() => {
                if (!disabled) {
                  setInputValue(String(allowFloat ? value.toFixed(1) : value));
                  setEditing(true);
                }
              }}
            >
              {allowFloat ? value.toFixed(1) : value}
              {suffix}
            </span>
          )}
          <button
            type="button"
            aria-label="Increase"
            onClick={handleIncrement}
            disabled={disabled || (max !== undefined && value >= max)}
            className={iconButton}
          >
            <Icon name="add" size={dense ? 20 : 24} />
          </button>
        </div>
        {showProgress && progress !== undefined && (
          <div
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- M3 linear progress with active indicator, 4dp gap, track and stop indicator as child elements; a native <progress> cannot host them.
            role="progressbar"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
            className="relative flex h-1 w-full items-center gap-1"
          >
            {/* M3 linear progress: active indicator, 4dp gap, track, stop indicator. */}
            <div
              className="h-full shrink-0 rounded-full bg-primary transition-[width] duration-200 ease-standard"
              style={{ width: `${progress}%` }}
            />
            <div className="relative h-full min-w-0 flex-1 rounded-full bg-secondary-container">
              <span className="absolute right-0 top-0 size-1 rounded-full bg-primary" />
            </div>
          </div>
        )}
      </div>
    );
  },
);

NumberStepper.displayName = "NumberStepper";

export { NumberStepper };
