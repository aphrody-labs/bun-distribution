// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Loader.tsx), MIT, rebuilt on Material Design 3.

import { clsx } from "clsx";

// M3 circular indeterminate indicator on a 48-unit box: 4-unit stroke, `primary` arc. The arc
// grows and shrinks (emphasized easing) while the whole indicator rotates. SVG/SMIL: no script,
// renders during SSR, no dependency.
const RADIUS = 20;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC_CYCLE = "1.333s";
const ROTATION = "1.568s";
const EMPHASIZED = "0.2 0 0 1";

export function Loader(props: { className?: string; color?: string }) {
  return (
    <svg
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- M3 circular indeterminate indicator is an animated SVG arc; a native <progress> cannot render it.
      role="progressbar"
      aria-label="Loading"
      viewBox="0 0 48 48"
      fill="none"
      className={clsx("size-7", props.color === undefined && "text-primary", props.className)}
    >
      <g>
        <circle
          cx={24}
          cy={24}
          r={RADIUS}
          stroke={props.color ?? "currentColor"}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={`1 ${CIRCUMFERENCE}`}
          transform="rotate(-90 24 24)"
        >
          <animate
            attributeName="stroke-dasharray"
            dur={ARC_CYCLE}
            repeatCount="indefinite"
            calcMode="spline"
            keyTimes="0;0.5;1"
            keySplines={`${EMPHASIZED};${EMPHASIZED}`}
            values={`1 ${CIRCUMFERENCE};${CIRCUMFERENCE * 0.75} ${CIRCUMFERENCE};1 ${CIRCUMFERENCE}`}
          />
          <animate
            attributeName="stroke-dashoffset"
            dur={ARC_CYCLE}
            repeatCount="indefinite"
            calcMode="spline"
            keyTimes="0;0.5;1"
            keySplines={`${EMPHASIZED};${EMPHASIZED}`}
            values={`0;${-CIRCUMFERENCE * 0.25};${-CIRCUMFERENCE}`}
          />
        </circle>
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 24 24"
          to="360 24 24"
          dur={ROTATION}
          repeatCount="indefinite"
        />
      </g>
    </svg>
  );
}
