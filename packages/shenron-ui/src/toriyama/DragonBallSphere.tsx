/**
 * DragonBallSphere — Official Toriyama Dragon Ball Sphere in Pure SVG.
 * Supports 1-7 stars with exact tankobon measured amber gradient and sharp stars.
 */

import { useId, type SVGProps } from "react";
import { starPoints } from "../toriyama-svg";

export type DragonBallStarsCount = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface DragonBallSphereProps extends Omit<SVGProps<SVGSVGElement>, "size"> {
  stars?: DragonBallStarsCount;
  size?: number | string;
  glow?: boolean;
  interactive?: boolean;
  title?: string;
  decorative?: boolean;
}

const R_EXT = 256;
const CERNE = 23; // 4.5% of diameter
const R_INT = R_EXT - CERNE; // 233
const FOYER_X = R_EXT - 0.3 * R_INT; // 186
const FOYER_Y = R_EXT - 0.39 * R_INT; // 165

const DEGRADE: ReadonlyArray<readonly [number, string]> = [
  [0, "#fdffea"],
  [0.1, "#fdfcca"],
  [0.2, "#fef6bb"],
  [0.3, "#fce7a6"],
  [0.4, "#fcdc93"],
  [0.5, "#fdcd7f"],
  [0.6, "#fcc06a"],
  [0.7, "#fcb455"],
  [0.8, "#fba740"],
  [0.9, "#f29d32"],
  [1, "#ef9a2b"],
];

const ROUGE_ETOILE = "#e81f23";

const STAR_LAYOUT: Readonly<
  Record<number, ReadonlyArray<readonly [number, number]>> & { 4: ReadonlyArray<readonly [number, number]> }
> = {
  1: [[0, 0]],
  2: [
    [-0.22, 0],
    [0.22, 0],
  ],
  3: [
    [0, -0.24],
    [-0.21, 0.13],
    [0.21, 0.13],
  ],
  4: [
    [-0.2, -0.2],
    [0.2, -0.2],
    [-0.2, 0.2],
    [0.2, 0.2],
  ],
  5: [
    [-0.22, -0.2],
    [0.22, -0.2],
    [0, 0],
    [-0.22, 0.2],
    [0.22, 0.2],
  ],
  6: [
    [-0.22, -0.22],
    [0.22, -0.22],
    [-0.22, 0],
    [0.22, 0],
    [-0.22, 0.22],
    [0.22, 0.22],
  ],
  7: [
    [0, -0.26],
    [-0.22, -0.11],
    [0.22, -0.11],
    [0, 0.04],
    [-0.22, 0.2],
    [0.22, 0.2],
    [0, 0.28],
  ],
};

const R_ETOILE: Record<number, number> = {
  1: 0.412,
  2: 0.3,
  3: 0.26,
  4: 0.25,
  5: 0.21,
  6: 0.2,
  7: 0.185,
};

export function DragonBallSphere({
  stars = 4,
  size = 64,
  glow = false,
  interactive = false,
  className = "",
  title,
  decorative = false,
  ...props
}: DragonBallSphereProps) {
  const n = Math.min(7, Math.max(1, Math.round(stars))) as DragonBallStarsCount;
  const layout = STAR_LAYOUT[n] ?? STAR_LAYOUT[4];
  const starR = (R_ETOILE[n] ?? 0.25) * R_INT;
  const a11y = decorative
    ? { "aria-hidden": true as const }
    : {
        role: "img" as const,
        "aria-label": title ?? `Dragon Ball à ${n} étoile${n > 1 ? "s" : ""}`,
      };

  const id = useId().replace(/:/g, "");
  const gradId = `dbs-grad-${n}-${id}`;
  const glowFilterId = `dbs-glow-${id}`;

  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={`inline-block shrink-0 transition-transform select-none ${
        interactive ? "hover:scale-105 active:scale-95 cursor-pointer" : ""
      } ${className}`}
      style={{
        filter: glow ? `url(#${glowFilterId}) drop-shadow(0 0 12px rgba(255,183,3,0.6))` : undefined,
      }}
      {...a11y}
      {...props}
    >
      <defs>
        <radialGradient
          id={gradId}
          gradientUnits="userSpaceOnUse"
          cx={R_EXT}
          cy={R_EXT}
          r={R_INT}
          fx={FOYER_X}
          fy={FOYER_Y}
        >
          {DEGRADE.map(([offset, couleur]) => (
            <stop key={offset} offset={offset} stopColor={couleur} />
          ))}
        </radialGradient>
        {glow && (
          <filter id={glowFilterId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="10" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        )}
      </defs>

      {/* Black ink border disk */}
      <circle cx={R_EXT} cy={R_EXT} r={R_EXT} fill="#000000" />
      {/* Amber gradient crystal core */}
      <circle cx={R_EXT} cy={R_EXT} r={R_INT} fill={`url(#${gradId})`} />

      {/* Crimson sharp stars */}
      {layout.map(([nx, ny], i) => (
        <polygon key={i} points={starPoints(R_EXT + nx * 512, R_EXT + ny * 512, starR)} fill={ROUGE_ETOILE} />
      ))}
    </svg>
  );
}
