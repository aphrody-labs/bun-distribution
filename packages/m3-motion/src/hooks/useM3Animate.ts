import { useAnimate } from "motion/react";
import type {
  AnimationScope,
  AnimationPlaybackControlsWithThen,
  AnimationSequence,
  SequenceOptions,
  ElementOrSelector,
  DOMKeyframesDefinition,
  AnimationOptions,
  MotionValue,
  UnresolvedValueKeyframe,
  ValueAnimationTransition,
  ObjectTarget,
} from "motion/react";
import { m3Easings, m3Durations } from "../easings";
import { useM3ReducedMotion } from "./useM3ReducedMotion";

/**
 * Overloaded type for the scoped animate function returned by useM3Animate.
 * Mirrors the overload set of the underlying motion animate, adding M3 defaults.
 */
export interface M3AnimateFn {
  (sequence: AnimationSequence, options?: SequenceOptions): AnimationPlaybackControlsWithThen;
  (
    value: string | MotionValue<string>,
    keyframes: string | UnresolvedValueKeyframe<string>[],
    options?: ValueAnimationTransition<string>,
  ): AnimationPlaybackControlsWithThen;
  (
    value: number | MotionValue<number>,
    keyframes: number | UnresolvedValueKeyframe<number>[],
    options?: ValueAnimationTransition<number>,
  ): AnimationPlaybackControlsWithThen;
  <V extends string | number>(
    value: V | MotionValue<V>,
    keyframes: V | UnresolvedValueKeyframe<V>[],
    options?: ValueAnimationTransition<V>,
  ): AnimationPlaybackControlsWithThen;
  (
    element: ElementOrSelector,
    keyframes: DOMKeyframesDefinition,
    options?: AnimationOptions,
  ): AnimationPlaybackControlsWithThen;
  <O extends object>(
    object: O | O[],
    keyframes: ObjectTarget<O>,
    options?: AnimationOptions,
  ): AnimationPlaybackControlsWithThen;
}

/**
 * A custom hook wrapping motion's `useAnimate` that injects Material 3 motion defaults
 * (emphasized easing and medium2 duration) for all imperative DOM animations.
 *
 * SSR-safe: useAnimate creates refs; no DOM access occurs at module or render time.
 */
export function useM3Animate<T extends Element = HTMLElement>(): [AnimationScope<T>, M3AnimateFn] {
  const [scope, animate] = useAnimate<T>();
  const reduced = useM3ReducedMotion();

  const m3Animate: M3AnimateFn = (elementOrSelector: unknown, keyframes?: unknown, options?: unknown) => {
    const defaults = {
      ease: m3Easings.emphasized,
      duration: m3Durations.medium2,
    };
    const immediate = reduced ? { type: "tween", duration: 0, delay: 0, repeat: 0 } : {};
    if (Array.isArray(elementOrSelector) && elementOrSelector.some(Array.isArray)) {
      // Sequence overload
      const sequenceOptions = typeof keyframes === "object" && keyframes !== null ? (keyframes as SequenceOptions) : {};
      const sequence = reduced
        ? elementOrSelector.map(segment =>
            Array.isArray(segment) ? [segment[0], segment[1], { ...segment[2], ...immediate, at: 0 }] : segment,
          )
        : elementOrSelector;
      return (animate as CallableFunction)(sequence, {
        ...sequenceOptions,
        defaultTransition: {
          ...defaults,
          ...sequenceOptions.defaultTransition,
          ...immediate,
        },
      }) as AnimationPlaybackControlsWithThen;
    }

    return (animate as CallableFunction)(elementOrSelector, keyframes, {
      ...defaults,
      ...(typeof options === "object" && options !== null ? options : {}),
      ...immediate,
    }) as AnimationPlaybackControlsWithThen;
  };

  return [scope, m3Animate];
}
