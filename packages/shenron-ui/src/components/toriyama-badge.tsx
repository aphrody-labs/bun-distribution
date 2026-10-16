/**
 * ToriyamaBadge — Authentic Manga & Dragon Ball Emblemed Badge Primitive.
 */

import type { ReactNode } from "react";
import { ToriyamaEmblem, type EmblemName } from "../toriyama/ToriyamaEmblem";
import { DragonBallSphere } from "../toriyama/DragonBallSphere";

export interface ToriyamaBadgeProps {
  children?: ReactNode;
  emblem?: EmblemName | "dragonBall";
  stars?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  variant?:
    "kame" | "capsule" | "saiyan" | "majin" | "scouter" | "ink" | "gold";
  size?: "sm" | "md" | "lg";
  className?: string;
}

const BADGE_STYLES = {
  kame: "bg-[var(--color-toriyama-orange)] text-[var(--color-toriyama-ink)] border-[var(--color-toriyama-ink)] shadow-[2px_2px_0px_var(--color-toriyama-ink)]",
  capsule:
    "bg-[var(--color-toriyama-capsule)] text-white border-[var(--color-toriyama-ink)] shadow-[2px_2px_0px_var(--color-toriyama-ink)]",
  saiyan:
    "bg-[var(--color-toriyama-blue)] text-white border-[var(--color-toriyama-ink)] shadow-[2px_2px_0px_var(--color-toriyama-ink)]",
  majin:
    "bg-[#5a189a] text-white border-[var(--color-toriyama-ink)] shadow-[2px_2px_0px_var(--color-toriyama-ink)]",
  scouter:
    "bg-[#0b2528] text-[var(--color-toriyama-scouter-green)] border-[var(--color-toriyama-scouter-green)] shadow-[0_0_8px_rgba(0,255,102,0.4)] font-mono",
  ink: "bg-[var(--color-toriyama-ink)] text-white border-[var(--color-toriyama-ink)] shadow-[2px_2px_0px_rgba(255,255,255,0.2)]",
  gold: "bg-[var(--color-toriyama-gold)] text-[var(--color-toriyama-ink)] border-[var(--color-toriyama-ink)] shadow-[2px_2px_0px_var(--color-toriyama-ink)]",
};

const SIZE_STYLES = {
  sm: "text-xs px-2 py-0.5 gap-1.5",
  md: "text-sm px-3 py-1 gap-2",
  lg: "text-base px-4 py-1.5 gap-2.5",
};

const EMBLEM_SIZES = {
  sm: 16,
  md: 20,
  lg: 24,
};

export function ToriyamaBadge({
  children,
  emblem,
  stars = 4,
  variant = "kame",
  size = "md",
  className = "",
}: ToriyamaBadgeProps) {
  const badgeStyle = BADGE_STYLES[variant] ?? BADGE_STYLES.kame;
  const sizeStyle = SIZE_STYLES[size] ?? SIZE_STYLES.md;
  const emblemSize = EMBLEM_SIZES[size] ?? 20;

  return (
    <span
      className={`inline-flex items-center font-bold tracking-wider rounded-md border-2 uppercase select-none transition-transform hover:-translate-y-0.5 active:translate-y-0 ${badgeStyle} ${sizeStyle} ${className}`}
    >
      {emblem === "dragonBall" ? (
        <DragonBallSphere stars={stars} size={emblemSize} decorative />
      ) : emblem ? (
        <ToriyamaEmblem
          name={emblem}
          size={emblemSize}
          variant="flat"
          decorative
        />
      ) : null}
      {children && <span>{children}</span>}
    </span>
  );
}
