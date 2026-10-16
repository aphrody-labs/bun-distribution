// SPDX-License-Identifier: Apache-2.0 AND MIT
// Material Design 3 Meter primitive built on Base UI (@base-ui/react/meter).
"use client";

import { Meter as MeterPrimitive } from "@base-ui/react/meter";
import { clsx } from "clsx";
import { forwardRef } from "react";

import { withClassName } from "./base-ui";

export type MeterRootProps = MeterPrimitive.Root.Props & {
  tone?: "primary" | "secondary" | "tertiary" | "error" | "warning";
};

export const MeterRoot = forwardRef<HTMLDivElement, MeterRootProps>(
  ({ className, tone: _tone, ...props }, ref) => (
    <MeterPrimitive.Root
      ref={ref}
      className={withClassName("flex flex-col gap-1.5 w-full", className)}
      data-m3-component="Meter"
      {...props}
    />
  ),
);
MeterRoot.displayName = "MeterRoot";

export type MeterLabelProps = MeterPrimitive.Label.Props;
export const MeterLabel = forwardRef<HTMLSpanElement, MeterLabelProps>(
  ({ className, ...props }, ref) => (
    <MeterPrimitive.Label
      ref={ref}
      className={withClassName(
        "text-label-medium font-medium text-on-surface",
        className,
      )}
      {...props}
    />
  ),
);
MeterLabel.displayName = "MeterLabel";

export type MeterTrackProps = MeterPrimitive.Track.Props;
export const MeterTrack = forwardRef<HTMLDivElement, MeterTrackProps>(
  ({ className, ...props }, ref) => (
    <MeterPrimitive.Track
      ref={ref}
      className={withClassName(
        "relative h-2 w-full overflow-hidden rounded-full bg-surface-variant",
        className,
      )}
      {...props}
    />
  ),
);
MeterTrack.displayName = "MeterTrack";

export type MeterIndicatorProps = MeterPrimitive.Indicator.Props & {
  tone?: "primary" | "secondary" | "tertiary" | "error" | "warning";
};
export const MeterIndicator = forwardRef<HTMLDivElement, MeterIndicatorProps>(
  ({ className, tone = "primary", ...props }, ref) => {
    const toneStyles = {
      primary: "bg-primary",
      secondary: "bg-secondary",
      tertiary: "bg-tertiary",
      error: "bg-error",
      warning: "bg-amber-500",
    }[tone];

    return (
      <MeterPrimitive.Indicator
        ref={ref}
        className={withClassName(
          clsx(
            "h-full rounded-full transition-all duration-300 ease-standard",
            toneStyles,
          ),
          className,
        )}
        {...props}
      />
    );
  },
);
MeterIndicator.displayName = "MeterIndicator";

export type MeterValueProps = MeterPrimitive.Value.Props;
export const MeterValue = forwardRef<HTMLSpanElement, MeterValueProps>(
  ({ className, ...props }, ref) => (
    <MeterPrimitive.Value
      ref={ref}
      className={withClassName(
        "text-label-small font-mono text-on-surface-variant",
        className,
      )}
      {...props}
    />
  ),
);
MeterValue.displayName = "MeterValue";

export interface MeterProps extends MeterPrimitive.Root.Props {
  label?: string;
  showValue?: boolean;
  tone?: "primary" | "secondary" | "tertiary" | "error" | "warning";
}

/** Pre-composed M3 Meter with label, track, indicator and formatted value. */
export function Meter({
  label,
  showValue = true,
  tone = "primary",
  ...props
}: MeterProps) {
  return (
    <MeterRoot
      tone={tone}
      aria-label={typeof label === "string" ? label : undefined}
      {...props}
    >
      {(label || showValue) && (
        <div className="flex items-center justify-between">
          {label && <MeterLabel>{label}</MeterLabel>}
          {showValue && <MeterValue />}
        </div>
      )}
      <MeterTrack>
        <MeterIndicator tone={tone} />
      </MeterTrack>
    </MeterRoot>
  );
}

Meter.Root = MeterRoot;
Meter.Label = MeterLabel;
Meter.Track = MeterTrack;
Meter.Indicator = MeterIndicator;
Meter.Value = MeterValue;
