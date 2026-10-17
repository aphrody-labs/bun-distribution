/**
 * AuraContainer — Authentic Dragon Ball Ki & Divine Energy Aura Wrapper.
 * Supports the 6 canonical aura spectrums calibrated via MPEG-7 ColorLayout analysis:
 * - Super Saiyan (Gold)
 * - Kaio-ken (Crimson)
 * - Super Saiyan God (Magenta/Vermilion)
 * - Super Saiyan Blue (Cyan/Azure)
 * - Ultra Instinct (Silver/Blue)
 * - Gohan Beast (Platinum/Purple)
 */

import type { ReactNode } from "react";

export type CinematicAuraForm = "ssj" | "kaioken" | "god" | "blue" | "ui" | "beast";
export type AuraContainerForm = CinematicAuraForm;
export type AuraIntensity = "subtle" | "active" | "burst";

export interface AuraContainerProps {
  children: ReactNode;
  form?: CinematicAuraForm;
  intensity?: AuraIntensity;
  sparks?: boolean;
  pulse?: boolean;
  className?: string;
}

const FORM_CLASSES: Record<CinematicAuraForm, string> = {
  ssj: "ki-aura-gold",
  kaioken: "ki-aura-kaioken",
  god: "ki-aura-god",
  blue: "ki-aura-blue",
  ui: "ki-aura-ui",
  beast: "ki-aura-beast",
};

const INTENSITY_STYLES: Record<AuraIntensity, { filter: string; scale: string }> = {
  subtle: { filter: "brightness(1.05)", scale: "scale-100" },
  active: {
    filter: "brightness(1.15) drop-shadow(0 0 16px rgba(255,255,255,0.2))",
    scale: "scale-[1.01]",
  },
  burst: {
    filter: "brightness(1.3) drop-shadow(0 0 28px rgba(255,255,255,0.4))",
    scale: "scale-[1.02]",
  },
};

const SPARK_COLORS: Record<CinematicAuraForm, string> = {
  ssj: "var(--color-aura-ssj-spark, #00f0ff)",
  kaioken: "#ffffff",
  god: "#ffd700",
  blue: "#fef08a",
  ui: "#ffffff",
  beast: "var(--color-aura-beast-spark, #ff0055)",
};

export function AuraContainer({
  children,
  form = "ssj",
  intensity = "active",
  sparks = true,
  pulse = true,
  className = "",
}: AuraContainerProps) {
  const formClass = FORM_CLASSES[form] ?? FORM_CLASSES.ssj;
  const intensityStyle = INTENSITY_STYLES[intensity] ?? INTENSITY_STYLES.active;
  const sparkColor = SPARK_COLORS[form] ?? SPARK_COLORS.ssj;

  return (
    <div
      className={`relative inline-block transition-all duration-300 ${formClass} ${intensityStyle.scale} ${className}`}
      style={{ filter: intensityStyle.filter }}
    >
      {/* Dynamic SVG Lightning Sparks Overlay */}
      {sparks && (
        <svg
          className="absolute -inset-4 pointer-events-none z-10 w-[calc(100%+2rem)] h-[calc(100%+2rem)] overflow-visible select-none"
          aria-hidden="true"
        >
          <g
            stroke={sparkColor}
            strokeWidth={intensity === "burst" ? "2.2" : "1.6"}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            className={pulse ? "animate-[spark-flicker_1.4s_infinite]" : "opacity-80"}
          >
            {/* Top Right Bolt */}
            <path d="M 85% 15% L 92% 24% L 88% 30% L 96% 40%" />
            {/* Top Left Bolt */}
            <path d="M 12% 20% L 8% 30% L 14% 34% L 6% 45%" />
            {/* Bottom Right Bolt */}
            <path d="M 88% 70% L 94% 78% L 90% 84% L 96% 92%" />
            {/* Bottom Left Bolt */}
            <path d="M 10% 75% L 15% 82% L 9% 88% L 14% 95%" />
          </g>
        </svg>
      )}

      {/* Wrapped Content */}
      <div className="relative z-0">{children}</div>
    </div>
  );
}
