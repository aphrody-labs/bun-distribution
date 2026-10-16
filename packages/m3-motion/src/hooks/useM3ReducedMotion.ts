"use client";

// SPDX-License-Identifier: Apache-2.0
import { useSyncExternalStore } from "react";
import type { TargetAndTransition, Variants } from "motion/react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Tracks the OS preference, including changes made while an application is open. */
export function useM3ReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== "undefined" && !!window.matchMedia?.(QUERY).matches,
    () => false,
  );
}

function immediate(target: TargetAndTransition): TargetAndTransition;
function immediate(target: TargetAndTransition | string): TargetAndTransition | string;
function immediate(target: TargetAndTransition | string): TargetAndTransition | string {
  if (typeof target === "string") return target;
  return { ...target, transition: { type: "tween", duration: 0, delay: 0 } };
}

/** Preserve each state and custom variant while removing animation and stagger delays. */
export function motionVariants(variants: Variants, reduced: boolean): Variants {
  if (!reduced) return variants;
  return Object.fromEntries(
    Object.entries(variants).map(([key, variant]) => [
      key,
      typeof variant === "function"
        ? (...args: Parameters<typeof variant>) => immediate(variant(...args))
        : immediate(variant),
    ]),
  );
}
