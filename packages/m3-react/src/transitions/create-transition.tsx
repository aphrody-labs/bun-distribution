"use client";

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from "react";

import { BaseTransitionProps, useTransitionProps } from "./use-transition-state.js";

/** M3 easing tokens with their spec values as fallbacks. */
export const EASING = {
  standard: "var(--md-sys-motion-easing-standard, cubic-bezier(0.2, 0, 0, 1))",
  standardDecelerate: "var(--md-sys-motion-easing-standard-decelerate, cubic-bezier(0, 0, 0, 1))",
  standardAccelerate: "var(--md-sys-motion-easing-standard-accelerate, cubic-bezier(0.3, 0, 1, 1))",
  emphasizedDecelerate: "var(--md-sys-motion-easing-emphasized-decelerate, cubic-bezier(0.05, 0.7, 0.1, 1))",
  emphasizedAccelerate: "var(--md-sys-motion-easing-emphasized-accelerate, cubic-bezier(0.3, 0, 0.8, 0.15))",
} as const;

/** How one style transition looks; everything else (state machine, cloning, timing) is shared. */
export interface TransitionSpec<P extends BaseTransitionProps> {
  enter: { easing: string; fallbackMs: number };
  exit: { easing: string; fallbackMs: number };
  /** CSS properties that animate, in `transition` / `will-change` order. */
  properties: readonly string[];
  /** The values of those properties for the current visual state. */
  style(state: { visible: boolean; childStyle: React.CSSProperties | undefined; props: P }): React.CSSProperties;
}

/**
 * Builds a transition component that clones its single child with an inline style: the visual
 * state comes from `spec.style`, the `transition` and `will-change` declarations from the spec.
 */
export function createTransition<P extends BaseTransitionProps = BaseTransitionProps>(
  name: string,
  spec: TransitionSpec<P>,
): (props: P) => React.ReactElement | null {
  const willChange = spec.properties.join(", ");
  function Transition(props: P): React.ReactElement | null {
    const { mounted, visible, durationMs } = useTransitionProps(props, spec.enter.fallbackMs, spec.exit.fallbackMs);
    if (!mounted) {
      return null;
    }
    const easing = visible ? spec.enter.easing : spec.exit.easing;
    const childStyle = (props.children.props as { style?: React.CSSProperties }).style;
    const style: React.CSSProperties = {
      ...childStyle,
      ...spec.style({ visible, childStyle, props }),
      transition: spec.properties.map(p => `${p} ${durationMs}ms ${easing}`).join(", "),
      willChange,
    };
    const childProps = props.children.props as React.HTMLAttributes<HTMLElement>;
    return React.cloneElement(props.children, {
      style,
      inert: !visible || childProps.inert,
      "aria-hidden": !visible || childProps["aria-hidden"],
    } as React.HTMLAttributes<HTMLElement>);
  }
  Transition.displayName = name;
  return Transition;
}
