// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/ShinyToggle.tsx), MIT, rebuilt on Material Design 3.

import { m3Durations, m3Easings, useM3ReducedMotion } from "@aphrody/m3-motion";
import { clsx } from "clsx";
import { LayoutGroup, motion } from "motion/react";
import { type ReactNode, useId } from "react";

import { m3FocusRing, m3StateLayer } from "./utils";

interface ShinyToggleOption<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

interface ShinyToggleProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ShinyToggleOption<T>[];
  className?: string;
  /** Accessible name for the radio group. */
  ariaLabel?: string;
}

/**
 * A single-select pill toggle whose selection indicator is the SpaceUI "shiny" gradient, on M3
 * roles (`primary` → `tertiary`, content `on-primary`). The indicator slides between options with
 * the M3 emphasized easing.
 */
export function ShinyToggle<T extends string>({
  value,
  onChange,
  options,
  className = "",
  ariaLabel = "Options",
}: ShinyToggleProps<T>) {
  const groupId = useId();
  const reduced = useM3ReducedMotion();
  const focusValue = options.some((option) => option.value === value) ? value : options[0]?.value;

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented) return;

    const target = event.target;
    if (!(target instanceof Element)) return;
    const current = target.closest<HTMLButtonElement>('button[role="radio"]');
    if (!current || !event.currentTarget.contains(current)) return;

    const radios = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
    );
    const index = radios.indexOf(current);
    if (index < 0) return;

    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (index + 1) % radios.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (index - 1 + radios.length) % radios.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = radios.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    radios[nextIndex].focus();
    if (nextIndex !== index) onChange(options[nextIndex].value);
  }

  return (
    <LayoutGroup id={groupId}>
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={clsx(
          "inline-flex gap-1 rounded-full border border-outline-variant bg-surface-container p-1",
          className,
        )}
      >
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- segmented radio group: each option is a button carrying the animated shared-layout pill; a native radio input cannot host it.
              role="radio"
              aria-checked={selected}
              tabIndex={option.value === focusValue ? 0 : -1}
              onClick={() => onChange(option.value)}
              className={clsx(
                "h-8 rounded-full px-3 text-label-large transition-colors duration-200 ease-standard",
                selected ? "relative text-on-primary" : ["text-on-surface-variant", m3StateLayer],
                m3FocusRing,
              )}
            >
              {selected && (
                <motion.div
                  layoutId={reduced ? undefined : "shinyToggleActive"}
                  className="absolute inset-0 rounded-full bg-linear-to-br from-primary to-tertiary shadow-[0_0_0.75rem_color-mix(in_srgb,var(--color-primary)_30%,transparent)]"
                  transition={{
                    duration: reduced ? 0 : m3Durations.medium2,
                    ease: m3Easings.emphasized,
                  }}
                />
              )}
              <span className="relative">
                {option.label}
                {option.count !== undefined && ` (${option.count})`}
              </span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
