"use client";

import React from "react";

export type AuraForm =
  | "base"
  | "kaioken"
  | "ssj"
  | "ssj2"
  | "ssj3"
  | "god"
  | "blue"
  | "ultra-instinct"
  | "beast"
  | "broly-fp";

export interface AnimeMomentCardProps {
  title: string;
  character: string;
  saga: string;
  episodeOrMovie: string;
  imageUrl: string;
  form?: AuraForm;
  quote?: string;
  technique?: string;
  director?: string;
  onClick?: () => void;
  className?: string;
}

const AURA_STYLES: Record<AuraForm, { glow: string; border: string; badge: string; text: string }> = {
  base: { glow: "group-hover:shadow-[0_0_25px_rgba(255,255,255,0.2)]", border: "border-neutral-600", badge: "bg-neutral-800 text-neutral-200", text: "text-neutral-300" },
  kaioken: { glow: "group-hover:shadow-[0_0_30px_rgba(255,0,51,0.5)]", border: "border-red-600", badge: "bg-red-950 text-red-300 border-red-700", text: "text-red-400" },
  ssj: { glow: "group-hover:shadow-[0_0_30px_rgba(255,215,0,0.55)]", border: "border-amber-400", badge: "bg-amber-950 text-amber-300 border-amber-500", text: "text-amber-400" },
  ssj2: { glow: "group-hover:shadow-[0_0_35px_rgba(0,255,255,0.6)]", border: "border-cyan-400", badge: "bg-cyan-950 text-cyan-200 border-cyan-400", text: "text-cyan-300" },
  ssj3: { glow: "group-hover:shadow-[0_0_35px_rgba(255,180,0,0.6)]", border: "border-amber-500", badge: "bg-amber-950 text-amber-200 border-amber-400", text: "text-amber-300" },
  god: { glow: "group-hover:shadow-[0_0_35px_rgba(255,0,128,0.55)]", border: "border-rose-500", badge: "bg-rose-950 text-rose-200 border-rose-500", text: "text-rose-400" },
  blue: { glow: "group-hover:shadow-[0_0_35px_rgba(0,229,255,0.6)]", border: "border-sky-400", badge: "bg-sky-950 text-sky-200 border-sky-400", text: "text-sky-300" },
  "ultra-instinct": { glow: "group-hover:shadow-[0_0_40px_rgba(224,242,254,0.7)]", border: "border-sky-200", badge: "bg-slate-900 text-sky-100 border-sky-200", text: "text-sky-200" },
  beast: { glow: "group-hover:shadow-[0_0_40px_rgba(168,85,247,0.65)]", border: "border-purple-500", badge: "bg-purple-950 text-purple-200 border-purple-400", text: "text-purple-300" },
  "broly-fp": { glow: "group-hover:shadow-[0_0_40px_rgba(0,255,102,0.65)]", border: "border-emerald-400", badge: "bg-emerald-950 text-emerald-200 border-emerald-400", text: "text-emerald-300" },
};

export const AnimeMomentCard: React.FC<AnimeMomentCardProps> = ({
  title,
  character,
  saga,
  episodeOrMovie,
  imageUrl,
  form = "base",
  quote,
  technique,
  director,
  onClick,
  className = "",
}) => {
  const style = AURA_STYLES[form];

  return (
    <div
      onClick={onClick}
      onKeyDown={onClick ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      } : undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={"group relative flex flex-col overflow-hidden bg-black rounded-xl border-2 transition-all duration-500 " + (onClick ? "cursor-pointer focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-amber-400 " : "") + style.border + " " + style.glow + " " + className}
    >
      {/* Visual Header with Manga Ink Frame */}
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-neutral-950">
        <img
          src={imageUrl}
          alt={title}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover transition-transform duration-700 ease-out group-hover:scale-108"
        />
        {/* Vignette & Cinematic Grain */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent opacity-80 group-hover:opacity-60 transition-opacity" />

        {/* Top Badges */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between z-10">
          <span className={"px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider rounded border shadow-md " + style.badge}>
            {saga}
          </span>
          <span className="px-2 py-0.5 text-[10px] font-mono bg-black/80 text-neutral-300 rounded border border-neutral-700">
            {episodeOrMovie}
          </span>
        </div>

        {/* Technique Stamp Overlay */}
        {technique && (
          <div className="absolute bottom-3 right-3 z-10">
            <span className="px-2.5 py-1 text-xs font-black uppercase tracking-widest bg-red-600 text-white rounded border border-red-400 shadow-[0_0_12px_rgba(239,68,68,0.7)]">
              {technique}
            </span>
          </div>
        )}
      </div>

      {/* Content Section */}
      <div className="p-4 flex flex-col justify-between flex-1 bg-neutral-950/95 border-t border-neutral-900">
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className={"font-bold tracking-wider uppercase text-[11px] " + style.text}>
              {character}
            </span>
            {director && (
              <span className="text-neutral-300 text-[10px] font-mono">
                Dir: {director}
              </span>
            )}
          </div>
          <h4 className="font-black text-white text-base leading-tight group-hover:text-amber-400 transition-colors">
            {title}
          </h4>
          {quote && (
            <p className="mt-2 text-xs italic text-neutral-300 border-l-2 border-amber-500 pl-2 line-clamp-2">
              « {quote} »
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
