// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/CircularProgress.tsx), MIT, rebuilt on Material Design 3.
// adapted from https://github.com/martyan/react-customizable-progressbar/
import { clsx } from "clsx";
import { useM3ReducedMotion } from "@aphrody/m3-motion";
import React, { type FunctionComponent, useEffect, useState } from "react";

// M3 circular progress: `primary` arc over a `secondary-container` track, 4 dp stroke. The color
// props still override; left unset, the roles apply through the Tailwind `stroke-*` / `fill-*`
// utilities so the indicator follows the scheme.
const M3_TRANSITION = "stroke-dashoffset 200ms cubic-bezier(0.2, 0, 0, 1)";

export type CircularProgressProps = {
  radius: number;
  progress: number;
  steps?: number;
  cut?: number;
  rotate?: number;
  strokeWidth?: number;
  strokeColor?: string;
  fillColor?: string;
  strokeLinecap?: "round" | "inherit" | "butt" | "square";
  transition?: string;
  pointerRadius?: number;
  pointerStrokeWidth?: number;
  pointerStrokeColor?: string;
  pointerFillColor?: string;
  trackStrokeColor?: string;
  trackStrokeWidth?: number;
  trackStrokeLinecap?: "round" | "inherit" | "butt" | "square";
  trackTransition?: string;
  counterClockwise?: boolean;
  inverse?: boolean;
  initialAnimation?: boolean;
  initialAnimationDelay?: number;
  className?: string;
  children?: React.ReactNode;
};

export const CircularProgress: FunctionComponent<CircularProgressProps> = ({
  radius,
  progress,
  steps: _steps = 100,
  cut: _cut = 0,
  rotate = -90,
  strokeWidth = 4,
  strokeColor,
  fillColor = "none",
  strokeLinecap = "round",
  transition = M3_TRANSITION,
  pointerRadius = 0,
  pointerStrokeWidth = 4,
  pointerStrokeColor,
  pointerFillColor,
  trackStrokeColor,
  trackStrokeWidth = 4,
  trackStrokeLinecap = "round",
  trackTransition = M3_TRANSITION,
  counterClockwise: _counterClockwise = false,
  inverse: _inverse = false,
  initialAnimation = false,
  initialAnimationDelay = 0,
  className = "",
  children,
}) => {
  const reduced = useM3ReducedMotion();
  const [animationInitialized, setAnimationInitialized] = useState(false);

  useEffect(() => {
    if (initialAnimation && !reduced) {
      const timeout = setTimeout(
        () => setAnimationInitialized(true),
        initialAnimationDelay,
      );
      return () => clearTimeout(timeout);
    }
  }, [initialAnimation, initialAnimationDelay, reduced]);

  progress = Number.isFinite(progress)
    ? Math.min(100, Math.max(0, progress))
    : 0;

  const getProgress = () =>
    initialAnimation && !animationInitialized && !reduced ? 0 : progress;

  const circumference = radius * 2 * Math.PI;

  const strokeDasharray = `${circumference} ${circumference}`;
  const strokeDashoffset = ((100 - getProgress()) / 100) * circumference;

  const fullStrokeWidth = strokeWidth * 2;
  const svgSize = radius * 2 + fullStrokeWidth;
  const viewBox = `0 0 ${svgSize} ${svgSize}`;
  const center = radius + strokeWidth;

  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- M3 circular determinate indicator renders SVG track and arc; a native <progress> cannot render them.
      role="progressbar"
      aria-label="Progress"
      data-m3-component="CircularProgress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, Math.max(0, progress))}
      className={clsx("relative", className)}
      style={{
        width: `${svgSize}px`,
        height: `${svgSize}px`,
      }}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        width={svgSize}
        height={svgSize}
        viewBox={viewBox}
        style={{ transform: `rotate(${rotate}deg)` }}
      >
        {trackStrokeWidth > 0 && (
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={trackStrokeColor}
            strokeWidth={trackStrokeWidth}
            strokeDasharray={strokeDasharray}
            strokeLinecap={trackStrokeLinecap}
            style={{ transition: reduced ? "none" : trackTransition }}
            className={clsx(
              "track-stroke",
              !trackStrokeColor && "stroke-secondary-container",
            )}
          />
        )}
        {strokeWidth > 0 && (
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
            strokeLinecap={strokeLinecap}
            style={{
              transition: reduced ? "none" : transition,
              strokeDashoffset,
            }}
            className={clsx(
              "progress-stroke",
              !strokeColor && "stroke-primary",
            )}
          />
        )}
        {pointerRadius > 0 && (
          <circle
            cx={radius}
            cy={radius}
            r={pointerRadius}
            fill={pointerFillColor}
            stroke={pointerStrokeColor}
            strokeWidth={pointerStrokeWidth}
            style={{
              transform: `rotate(${rotate}deg)`,
              transformOrigin: `${radius}px ${radius}px`,
            }}
            className={clsx(
              "pointer-stroke",
              !pointerStrokeColor && "stroke-primary",
              !pointerFillColor && "fill-on-primary",
            )}
          />
        )}
      </svg>
      {children}
    </div>
  );
};
