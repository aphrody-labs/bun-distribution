/**
 * ToriyamaPanel — Authentic Manga Koma-wari Cell Panel Primitive.
 * Features 2px/3px solid inking, comic halftone textures, action slant geometry, and sound effect slots.
 */

import type { ReactNode } from "react";

export interface ToriyamaPanelProps {
  children: ReactNode;
  variant?: "standard" | "slanted" | "action" | "scouter" | "capsule";
  sfx?: string;
  title?: string;
  className?: string;
}

const PANEL_STYLES = {
  standard:
    "bg-[var(--color-card,#18181b)] border-2 border-[var(--color-toriyama-ink,#121417)] shadow-[4px_4px_0px_var(--color-toriyama-ink,#121417)] rounded-none",
  slanted:
    "bg-[var(--color-card,#18181b)] border-2 border-[var(--color-toriyama-ink,#121417)] shadow-[4px_4px_0px_var(--color-toriyama-ink,#121417)] -skew-x-2 rounded-none",
  action:
    "bg-[var(--color-card,#18181b)] border-3 border-[var(--color-toriyama-orange,#f85b1a)] shadow-[5px_5px_0px_var(--color-toriyama-ink,#121417)] toriyama-speedlines",
  scouter:
    "bg-[#0b2528] border-2 border-[var(--color-toriyama-scouter-green,#00ff66)] shadow-[0_0_12px_rgba(0,255,102,0.3)] font-mono rounded-md",
  capsule:
    "bg-[var(--color-card,#18181b)] border-2 border-[var(--color-toriyama-capsule,#00b4d8)] shadow-[4px_4px_0px_var(--color-toriyama-ink,#121417)] rounded-2xl",
};

export function ToriyamaPanel({ children, variant = "standard", sfx, title, className = "" }: ToriyamaPanelProps) {
  const panelStyle = PANEL_STYLES[variant] ?? PANEL_STYLES.standard;

  return (
    <div className={`relative p-5 text-[var(--color-foreground)] ${panelStyle} ${className}`}>
      {/* Sound Effect (SFX / Onomatopoeia) Top Badge */}
      {sfx && (
        <span
          className="absolute -top-3.5 -right-2 px-2.5 py-0.5 bg-[var(--color-toriyama-red,#de1b22)] text-white text-xs font-black tracking-widest uppercase border-2 border-[var(--color-toriyama-ink,#121417)] shadow-[2px_2px_0px_var(--color-toriyama-ink,#121417)] rotate-3 select-none"
          aria-hidden
        >
          {sfx}
        </span>
      )}

      {/* Optional Panel Title Header */}
      {title && (
        <div className="mb-3 pb-2 border-b-2 border-dashed border-[var(--color-border)] flex items-center justify-between">
          <h3 className="font-bold uppercase tracking-wider text-sm flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 bg-[var(--color-toriyama-orange,#f85b1a)] border border-black" />
            {title}
          </h3>
        </div>
      )}

      {children}
    </div>
  );
}
