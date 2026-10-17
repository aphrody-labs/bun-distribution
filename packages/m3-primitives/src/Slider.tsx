// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Slider.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { clsx } from "clsx";

import { type StateClassName, withClassName } from "./base-ui";

export interface SliderProps extends Omit<
  SliderPrimitive.Root.Props<number[]>,
  "className" | "onValueChange" | "onValueCommitted"
> {
  className?: StateClassName<SliderPrimitive.Root.State>;
  /** Called on every change with one value per handle (Radix shape). */
  onValueChange?: (value: number[], eventDetails: SliderPrimitive.Root.ChangeEventDetails) => void;
  /** Base UI name for the end-of-interaction callback. */
  onValueCommitted?: (value: number[], eventDetails: SliderPrimitive.Root.CommitEventDetails) => void;
  /** Radix name for {@link SliderProps.onValueCommitted}. */
  onValueCommit?: (value: number[]) => void;
  /** Accessible name of each handle (Base UI `getAriaLabel`). */
  getAriaLabel?: (index: number) => string;
}

const asArray = (value: number | readonly number[]) => (typeof value === "number" ? [value] : [...value]) as number[];

/**
 * M3 slider (baseline) on Base UI: 4dp track, `primary` active track, `secondary-container`
 * inactive track, 20dp `primary` handle with a 40dp state layer. One handle per value, so range
 * sliders work; vertical orientation is supported. Each handle wraps a native
 * `<input type="range">`, so keyboard, screen readers and forms work without extra wiring.
 */
export const Slider = ({
  className,
  onValueChange,
  onValueCommitted,
  onValueCommit,
  getAriaLabel,
  ...props
}: SliderProps) => {
  const thumbs = (props.value ?? props.defaultValue ?? [0]).length || 1;

  return (
    <SliderPrimitive.Root
      data-m3-component="Slider"
      {...props}
      onValueChange={onValueChange && ((value, details) => onValueChange(asArray(value), details))}
      onValueCommitted={
        onValueCommitted || onValueCommit
          ? (value, details) => {
              onValueCommitted?.(asArray(value), details);
              onValueCommit?.(asArray(value));
            }
          : undefined
      }
      className={withClassName(
        clsx(
          "relative flex h-11 w-full touch-none select-none items-center",
          "data-[orientation=vertical]:h-full data-[orientation=vertical]:w-11 data-[orientation=vertical]:flex-col",
          "data-disabled:cursor-not-allowed data-disabled:opacity-38",
        ),
        className,
      )}
    >
      <SliderPrimitive.Control
        className={clsx("flex h-full w-full grow items-center", "data-[orientation=vertical]:flex-col")}
      >
        <SliderPrimitive.Track
          className={clsx(
            "relative h-1 grow rounded-full bg-secondary-container outline-none",
            "data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1",
          )}
        >
          <SliderPrimitive.Indicator
            className={clsx(
              "rounded-full bg-primary outline-none",
              "data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full",
            )}
          />
          {Array.from({ length: thumbs }, (_, i) => (
            <SliderPrimitive.Thumb
              key={i}
              index={i}
              getAriaLabel={getAriaLabel}
              className={clsx(
                "z-10 block size-5 cursor-grab rounded-full bg-primary shadow-md3-1 outline-none active:cursor-grabbing",
                "transition-shadow duration-200 ease-standard",
                "before:pointer-events-none before:absolute before:left-1/2 before:top-1/2 before:size-10 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:content-['']",
                "before:transition-colors before:duration-200 before:ease-standard",
                "hover:before:bg-primary/8 has-focus-visible:before:bg-primary/10 active:before:bg-primary/10 data-dragging:before:bg-primary/10",
                "has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-secondary",
                "data-disabled:bg-on-surface data-disabled:shadow-none",
              )}
            />
          ))}
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
};
