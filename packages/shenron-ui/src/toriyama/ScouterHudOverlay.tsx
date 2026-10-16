/**
 * ScouterHudOverlay — Saiyan & Frieza Force Scouter Targeting Reticle in Pure SVG.
 * Features corner lock-on brackets, digital Battle Power display, telemetry grid, and lens hue.
 */

import type { SVGProps } from "react";
import { scouterBrackets } from "../toriyama-svg";

export interface ScouterHudOverlayProps extends Omit<
  SVGProps<SVGSVGElement>,
  "size"
> {
  powerLevel?: number | string;
  color?: "green" | "red" | "blue";
  size?: number | string;
  targetLocked?: boolean;
  title?: string;
  decorative?: boolean;
}

const COLOR_MAP = {
  green: {
    hud: "#00ff66",
    lens: "rgba(0, 255, 102, 0.12)",
    glow: "rgba(0, 255, 102, 0.4)",
  },
  red: {
    hud: "#ff0033",
    lens: "rgba(255, 0, 51, 0.12)",
    glow: "rgba(255, 0, 51, 0.4)",
  },
  blue: {
    hud: "#00e5ff",
    lens: "rgba(0, 229, 255, 0.12)",
    glow: "rgba(0, 229, 255, 0.4)",
  },
};

export function ScouterHudOverlay({
  powerLevel = 9001,
  color = "green",
  size = 200,
  targetLocked = true,
  className = "",
  title,
  decorative = false,
  ...props
}: ScouterHudOverlayProps) {
  const c = COLOR_MAP[color] ?? COLOR_MAP.green;
  const a11y = decorative
    ? { "aria-hidden": true as const }
    : {
        role: "img" as const,
        "aria-label": title ?? `Scouter HUD (Puissance: ${powerLevel})`,
      };

  const brackets = scouterBrackets(10, 10, 80, 80, 14);

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`inline-block select-none font-mono ${className}`}
      style={{ filter: `drop-shadow(0 0 8px ${c.glow})` }}
      {...a11y}
      {...props}
    >
      {/* Lens tint background */}
      <rect x="0" y="0" width="100" height="100" rx="6" fill={c.lens} />

      {/* Scanlines */}
      <line
        x1="0"
        y1="20"
        x2="100"
        y2="20"
        stroke={c.hud}
        strokeWidth="0.4"
        opacity="0.3"
      />
      <line
        x1="0"
        y1="40"
        x2="100"
        y2="40"
        stroke={c.hud}
        strokeWidth="0.4"
        opacity="0.3"
      />
      <line
        x1="0"
        y1="60"
        x2="100"
        y2="60"
        stroke={c.hud}
        strokeWidth="0.4"
        opacity="0.3"
      />
      <line
        x1="0"
        y1="80"
        x2="100"
        y2="80"
        stroke={c.hud}
        strokeWidth="0.4"
        opacity="0.3"
      />

      {/* Lock-on corner brackets */}
      <path
        d={brackets}
        fill="none"
        stroke={c.hud}
        strokeWidth="2.5"
        strokeLinecap="square"
      />

      {/* Center crosshair */}
      <line x1="42" y1="50" x2="47" y2="50" stroke={c.hud} strokeWidth="1.5" />
      <line x1="53" y1="50" x2="58" y2="50" stroke={c.hud} strokeWidth="1.5" />
      <line x1="50" y1="42" x2="50" y2="47" stroke={c.hud} strokeWidth="1.5" />
      <line x1="50" y1="53" x2="50" y2="58" stroke={c.hud} strokeWidth="1.5" />

      {/* Target Lock Circle */}
      {targetLocked && (
        <circle
          cx="50"
          cy="50"
          r="16"
          fill="none"
          stroke={c.hud}
          strokeWidth="1"
          strokeDasharray="4 3"
          className="animate-spin"
          style={{ transformOrigin: "50px 50px", animationDuration: "6s" }}
        />
      )}

      {/* Power Level Readout Display */}
      <g transform="translate(14, 28)">
        <text
          x="0"
          y="0"
          fill={c.hud}
          fontSize="6"
          fontWeight="bold"
          letterSpacing="1"
        >
          BATTLE POWER
        </text>
        <text
          x="0"
          y="12"
          fill={c.hud}
          fontSize="13"
          fontWeight="900"
          letterSpacing="1.5"
        >
          {powerLevel}
        </text>
      </g>

      {/* Telemetry bar meters at bottom */}
      <g transform="translate(14, 82)">
        <rect x="0" y="0" width="10" height="3" fill={c.hud} />
        <rect x="13" y="0" width="10" height="3" fill={c.hud} />
        <rect x="26" y="0" width="10" height="3" fill={c.hud} />
        <rect x="39" y="0" width="10" height="3" fill={c.hud} opacity="0.4" />
        <rect x="52" y="0" width="10" height="3" fill={c.hud} opacity="0.4" />
        <rect x="65" y="0" width="6" height="3" fill={c.hud} opacity="0.2" />
      </g>
    </svg>
  );
}
