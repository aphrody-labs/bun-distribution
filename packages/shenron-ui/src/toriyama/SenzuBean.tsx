/**
 * SenzuBean — Korin Tower's Miraculous Senzu Bean in Pure SVG.
 * Features curved legume body, central embryo germ seam, and comic ink stroke.
 */

import type { SVGProps } from "react";

export interface SenzuBeanProps extends Omit<SVGProps<SVGSVGElement>, "size"> {
  size?: number | string;
  title?: string;
  decorative?: boolean;
}

export function SenzuBean({ size = 40, className = "", title, decorative = false, ...props }: SenzuBeanProps) {
  const a11y = decorative
    ? { "aria-hidden": true as const }
    : {
        role: "img" as const,
        "aria-label": title ?? "Senzu (Haricot Magique)",
      };

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`inline-block select-none ${className}`}
      style={{ filter: "drop-shadow(2px 3px 0px #121417)" }}
      {...a11y}
      {...props}
    >
      {/* Bean body */}
      <path
        d="M 30 25 C 55 12 85 22 88 48 C 92 68 76 84 56 88 C 34 92 15 82 16 58 C 16 42 20 32 30 25 Z"
        fill="#70e000"
        stroke="#121417"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      {/* Highlight curvature */}
      <path d="M 34 32 C 54 22 76 30 80 48" fill="none" stroke="#b5e48c" strokeWidth="3.5" strokeLinecap="round" />
      {/* Center seam groove */}
      <path d="M 44 45 C 52 56 46 68 50 78" fill="none" stroke="#38b000" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
