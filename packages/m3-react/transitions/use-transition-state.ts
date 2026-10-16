"use client";

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from "react";

/**
 * Resolves an MUI-style `timeout` (a single duration or per-direction
 * durations) to the millisecond value for the given direction.
 */
export type TransitionTimeout = number | { appear?: number; enter?: number; exit?: number };

export function resolveTimeout(
  timeout: TransitionTimeout | undefined,
  direction: "appear" | "enter" | "exit",
  fallback: number,
): number {
  if (timeout == null) {
    return fallback;
  }
  if (typeof timeout === "number") {
    return timeout;
  }
  if (direction === "appear") {
    return timeout.appear ?? timeout.enter ?? fallback;
  }
  return timeout[direction] ?? fallback;
}

/** The discrete lifecycle phases of a transition. */
export type TransitionPhase = "entering" | "entered" | "exiting" | "exited";

/** Props shared by every transition component. */
export interface BaseTransitionProps {
  /** Whether the child should be shown. */
  in: boolean;
  /**
   * Duration in ms, or per-direction durations. When omitted, the component's
   * M3 motion-token default is used.
   */
  timeout?: TransitionTimeout;
  /** Animate on the initial mount when `in` is already true. */
  appear?: boolean;
  /** Keep the child mounted while hidden instead of unmounting it. */
  mountOnEnter?: boolean;
  /** Unmount the child once it has finished exiting. */
  unmountOnExit?: boolean;
  /** The single React element to animate. */
  children: React.ReactElement;
}

export interface UseTransitionStateResult {
  /** Whether the child should currently be rendered in the tree. */
  mounted: boolean;
  /** The current lifecycle phase. */
  phase: TransitionPhase;
  /** Whether this is the very first commit (used to gate `appear`). */
  isAppearing: boolean;
  /** Call from the element's `onTransitionEnd` to settle the phase. */
  handleTransitionEnd: () => void;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeReducedMotion,
    () => typeof window !== "undefined" && !!window.matchMedia?.(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/**
 * Drives mount/unmount and entering/entered/exiting/exited phases from the
 * boolean `in` prop, using a small internal state machine. No external
 * dependency. SSR-safe (effects run only on the client).
 */
export function useTransitionState(
  inProp: boolean,
  {
    appear = false,
    mountOnEnter = false,
    unmountOnExit = false,
    enterTimeout,
    exitTimeout,
    appearTimeout = enterTimeout,
    onEntered,
    onExited,
  }: {
    appear?: boolean;
    mountOnEnter?: boolean;
    unmountOnExit?: boolean;
    enterTimeout: number;
    exitTimeout: number;
    appearTimeout?: number;
    onEntered?: () => void;
    onExited?: () => void;
  },
): UseTransitionStateResult {
  const firstRender = React.useRef(true);
  const initialSteady = React.useRef(!inProp || !appear);
  const initialIn = React.useRef(inProp);
  const appearing = React.useRef(inProp && appear);
  const callbacks = React.useRef({ onEntered, onExited });
  callbacks.current = { onEntered, onExited };

  const [phase, setPhase] = React.useState<TransitionPhase>(() => {
    if (inProp) {
      return appear ? "exited" : "entered";
    }
    return "exited";
  });

  // Whether the element is in the DOM at all.
  const [mounted, setMounted] = React.useState(() => inProp || (!mountOnEnter && !unmountOnExit));

  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settlement = React.useRef<(() => void) | undefined>(undefined);
  const clear = () => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
  };

  React.useEffect(() => {
    const initial = firstRender.current;
    firstRender.current = false;
    // A steady initial state must not start a transition or fire its callback.
    if (initialIn.current !== inProp) initialSteady.current = false;
    if ((initial && (!inProp || !appear)) || initialSteady.current) return clear;
    let cancelled = false;
    let settled = false;
    let raf: number | undefined;
    const duration = inProp ? (appearing.current ? appearTimeout : enterTimeout) : exitTimeout;
    const settle = () => {
      if (cancelled || settled) return;
      settled = true;
      clear();
      appearing.current = false;
      setPhase(inProp ? "entered" : "exited");
      if (!inProp && unmountOnExit) setMounted(false);
      (inProp ? callbacks.current.onEntered : callbacks.current.onExited)?.();
    };
    settlement.current = settle;
    clear();
    if (inProp) {
      setMounted(true);
      if (duration <= 0) settle();
      else {
        // Commit the hidden state before entering so browsers can interpolate.
        setPhase("exited");
        raf = requestAnimationFrame(() => {
          setPhase("entering");
          timer.current = setTimeout(settle, duration);
        });
      }
    } else {
      appearing.current = false;
      setPhase("exiting");
      if (duration <= 0) settle();
      else timer.current = setTimeout(settle, duration);
    }
    return () => {
      cancelled = true;
      settlement.current = undefined;
      if (raf !== undefined) cancelAnimationFrame(raf);
      clear();
    };
    // Callbacks are kept current without restarting an animation on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inProp, enterTimeout, exitTimeout, appearTimeout, unmountOnExit]);

  const handleTransitionEnd = React.useCallback(() => {
    if (phase === "entering" || phase === "exiting") settlement.current?.();
  }, [phase]);

  return { mounted, phase, isAppearing: appearing.current, handleTransitionEnd };
}

/** True while the element should be in its "shown" visual state. */
export function isVisible(phase: TransitionPhase): boolean {
  return phase === "entering" || phase === "entered";
}

/**
 * What every transition component derives from its props: the resolved enter/exit durations,
 * the state machine and the current visual state. `durationMs` is the one of the running direction.
 */
export function useTransitionProps(
  props: BaseTransitionProps,
  enterFallbackMs: number,
  exitFallbackMs: number,
) {
  const {
    in: inProp,
    timeout,
    appear = false,
    mountOnEnter = false,
    unmountOnExit = false,
  } = props;
  const reduced = useReducedMotion();
  const enterMs = reduced ? 0 : resolveTimeout(timeout, "enter", enterFallbackMs);
  const exitMs = reduced ? 0 : resolveTimeout(timeout, "exit", exitFallbackMs);
  const appearMs = reduced ? 0 : resolveTimeout(timeout, "appear", enterFallbackMs);
  const { mounted, phase, isAppearing } = useTransitionState(inProp, {
    appear,
    mountOnEnter,
    unmountOnExit,
    enterTimeout: enterMs,
    exitTimeout: exitMs,
    appearTimeout: appearMs,
  });
  const resolvedPhase = reduced ? (inProp ? "entered" : "exited") : phase;
  const visible = isVisible(resolvedPhase);
  return {
    mounted: reduced ? inProp || (!mountOnEnter && !unmountOnExit) : mounted,
    phase: resolvedPhase,
    visible,
    durationMs: isAppearing ? appearMs : visible ? enterMs : exitMs,
  };
}
