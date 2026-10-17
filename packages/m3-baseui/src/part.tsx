// SPDX-License-Identifier: Apache-2.0
// The one helper every wrapper uses: a Base UI part with M3 classes prepended to its `className`.
// Base UI accepts `className` as a string or as a function of the part state; both forms keep working.
// No hooks, no context and no CSS-in-JS: the appearance is `css/*.css`, the runtime cost is one function call.
import type { JSXElementConstructor } from "react";

/** Join class names, dropping falsy values. */
export const cx = (...names: (string | false | null | undefined)[]): string => names.filter(Boolean).join(" ");

type ClassName<S> = string | ((state: S) => string | undefined) | undefined;

/** `base` followed by a string `className`, or a state function that returns it with `base` first. */
export function mergeClassName<S>(base: string, className: ClassName<S>): string | ((state: S) => string) {
  if (typeof className === "function") return (state: S) => cx(base, className(state));
  return cx(base, className);
}

/**
 * A Base UI part (or any component taking `className`) styled with `base`. The returned component has
 * the same props, ref and state-function `className` as `Component`. In React 19 `ref` is an ordinary
 * prop, so nothing needs `forwardRef`.
 */
// oxlint-disable-next-line typescript/no-explicit-any
export function part<C extends JSXElementConstructor<any>>(Component: C, base: string): C {
  const Base = Component as JSXElementConstructor<{
    className?: ClassName<unknown>;
  }>;
  const Part = (props: { className?: ClassName<unknown> }) => (
    <Base {...props} className={mergeClassName(base, props.className)} />
  );
  Part.displayName = `M3(${(Component as { displayName?: string }).displayName ?? base})`;
  return Part as unknown as C;
}
