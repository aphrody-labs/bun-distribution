/**
 * PotaraEarrings — Supreme Kai Fusion Artifact in Pure SVG.
 * Features silver loop clasp, gold connector bead, and luminous glowing fusion orb.
 */

import type { SVGProps } from "react";

export interface PotaraEarringsProps extends Omit<SVGProps<SVGSVGElement>, "size"> {
  size?: number | string;
  orbColor?: "yellow" | "green";
  title?: string;
  decorative?: boolean;
}

export function PotaraEarrings({
  size = 48,
  orbColor = "yellow",
  className = "",
  title,
  decorative = false,
  ...props
}: PotaraEarringsProps) {
  const a11y = decorative
    ? { "aria-hidden": true as const }
    : {
        role: "img" as const,
        "aria-label": title ?? "Boucle Potara (Artefact de Fusion)",
      };

  const orbFill = orbColor === "green" ? "#70e000" : "#fee440";
  const orbShadow = orbColor === "green" ? "#38b000" : "#ffb703";

  return (
    <svg
      viewBox="0 0 100 120"
      width={size}
      height={typeof size === "number" ? (size * 120) / 100 : size}
      className={`inline-block select-none ${className}`}
      style={{ filter: "drop-shadow(2px 3px 0px #121417)" }}
      {...a11y}
      {...props}
    >
      {/* Silver Ear Hook */}
      <path
        d="M 50 12 C 34 12 28 26 28 38 C 28 52 42 56 50 56 L 50 64"
        fill="none"
        stroke="#e0e1dd"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      {/* Gold Connector Bead */}
      <rect x="42" y="62" width="16" height="10" rx="2" fill="#ffb703" stroke="#121417" strokeWidth="2.5" />

      {/* Fusion Glowing Orb */}
      <circle cx="50" cy="90" r="22" fill={orbShadow} stroke="#121417" strokeWidth="3.5" />
      <circle cx="50" cy="90" r="19" fill={orbFill} />

      {/* Specular highlight glint */}
      <circle cx="43" cy="83" r="5" fill="#ffffff" opacity="0.85" />
    </svg>
  );
}
