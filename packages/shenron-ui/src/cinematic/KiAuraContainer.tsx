"use client";

import React from "react";
import type { AuraForm } from "./AnimeMomentCard";

export interface KiAuraContainerProps {
  form: AuraForm;
  children: React.ReactNode;
  intensity?: "low" | "medium" | "burst";
  showLightning?: boolean;
  className?: string;
}

const AURA_ANIMATIONS: Record<AuraForm, { shadow: string; border: string; auraGlow: string }> = {
  base: { shadow: "shadow-white/10", border: "border-neutral-500", auraGlow: "bg-white/5" },
  kaioken: { shadow: "shadow-red-600/40 animate-pulse", border: "border-red-600", auraGlow: "bg-red-600/15" },
  ssj: { shadow: "shadow-amber-400/50 animate-pulse", border: "border-amber-400", auraGlow: "bg-amber-400/20" },
  ssj2: { shadow: "shadow-cyan-400/60 animate-pulse", border: "border-cyan-400", auraGlow: "bg-cyan-400/25" },
  ssj3: { shadow: "shadow-amber-500/70 animate-pulse", border: "border-amber-500", auraGlow: "bg-amber-500/30" },
  god: { shadow: "shadow-rose-500/60 animate-pulse", border: "border-rose-500", auraGlow: "bg-rose-500/25" },
  blue: { shadow: "shadow-sky-400/70 animate-pulse", border: "border-sky-400", auraGlow: "bg-sky-400/30" },
  "ultra-instinct": { shadow: "shadow-sky-200/80 animate-pulse", border: "border-sky-100", auraGlow: "bg-sky-200/35" },
  beast: { shadow: "shadow-purple-600/70 animate-pulse", border: "border-purple-500", auraGlow: "bg-purple-600/30" },
  "broly-fp": { shadow: "shadow-emerald-500/75 animate-pulse", border: "border-emerald-400", auraGlow: "bg-emerald-500/35" },
};

export const KiAuraContainer: React.FC<KiAuraContainerProps> = ({
  form,
  children,
  intensity = "medium",
  showLightning = false,
  className = "",
}) => {
  const anim = AURA_ANIMATIONS[form];
  const blurIntensity = intensity === "burst" ? "blur-xl scale-105" : intensity === "medium" ? "blur-lg scale-102" : "blur-md";

  return (
    <div className={"relative inline-block isolate " + className}>
      {/* Outer Ki Aura Layer */}
      <div
        className={"absolute -inset-1 rounded-2xl opacity-75 pointer-events-none transition-all duration-700 " + anim.auraGlow + " " + blurIntensity}
        aria-hidden="true"
      />

      {/* Lightning Sparks for SSJ2, Beast, and Broly */}
      {(showLightning || form === "ssj2" || form === "beast" || form === "broly-fp") && (
        <div className="absolute -inset-2 pointer-events-none overflow-hidden rounded-2xl z-20 opacity-90">
          <div className="absolute top-1 left-2 w-4 h-0.5 bg-cyan-200 rotate-45 animate-ping" />
          <div className="absolute bottom-2 right-3 w-5 h-0.5 bg-cyan-100 -rotate-30 animate-pulse" />
          <div className="absolute top-1/2 right-1 w-3 h-0.5 bg-white rotate-60 animate-ping" />
        </div>
      )}

      {/* Core Children Content */}
      <div className={"relative z-10 rounded-xl border-2 transition-shadow duration-500 " + anim.border + " " + anim.shadow}>
        {children}
      </div>
    </div>
  );
};