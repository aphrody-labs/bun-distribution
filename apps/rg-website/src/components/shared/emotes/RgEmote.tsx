"use client";

import Image from "next/image";
import { useState } from "react";

import { EMOTES } from "@/lib/emotes";
import type { Emote } from "@/lib/emotes";
import { cn } from "@/lib/utils";

interface RgEmoteProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Nom de l'emote à afficher */
  name: keyof typeof EMOTES;
  /** Taille de l'emote en pixels (default: 48) */
  size?: number;
  /** Animation au survol */
  animated?: boolean;
  /** Priorité de chargement de l'image */
  priority?: boolean;
  /** Empêcher le téléchargement (clic droit, drag) */
  preventDownload?: boolean;
}

/**
 * Composant pour afficher les emotes Rose Griffon
 *
 * @example
 * ```tsx
 * <RgEmote name="gaelle-salut" size={64} animated />
 * <RgEmote name="roy-evil" size={32} />
 * ```
 */
export default function RgEmote({
  name,
  size = 48,
  className,
  animated = false,
  priority = false,
  preventDownload = false,
  ...props
}: RgEmoteProps) {
  const emote = EMOTES[name];
  const [imgSrc, setImgSrc] = useState<string>(emote?.path || "");

  if (!emote) {
    console.warn(`Emote "${name}" not found`);
    return null;
  }

  const handleError = () => {
    const fallback = EMOTES["gaelle-salut"]?.path;
    if (fallback && imgSrc !== fallback) {
      console.warn(`Failed to load emote "${name}", using fallback`);
      setImgSrc(fallback);
    }
  };

  return (
    <div
      className={cn(
        "inline-block relative select-none",
        animated && "hover:scale-110 hover:rotate-12 transition-transform duration-300 cursor-pointer",
        className,
      )}
      style={{ height: size, width: size }}
      title={emote.alt}

      aria-label={emote.alt}
      {...props}
    >
      <Image
        src={imgSrc || emote.path}
        alt={emote.alt}
        fill
        className="object-contain"
        priority={priority}
        sizes={`${size}px`}
        onError={handleError}
        unoptimized // Emotes are small, optimization might be overkill or cause issues with some formats
        onContextMenu={preventDownload ? e => e.preventDefault() : undefined}
        draggable={preventDownload ? false : undefined}
      />
    </div>
  );
}

/**
 * Composant pour afficher plusieurs emotes en ligne
 */
interface RgEmoteLineProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Noms des emotes à afficher */
  emotes: (keyof typeof EMOTES)[];
  /** Taille des emotes en pixels */
  size?: number;
  /** Espacement entre les emotes */
  gap?: number;
  /** Animation au survol */
  animated?: boolean;
}

export function RgEmoteLine({ emotes, size = 32, gap = 8, animated = true, className, ...props }: RgEmoteLineProps) {
  return (
    <div className={cn("flex items-center", className)} style={{ gap: `${gap}px` }} {...props}>
      {emotes.map((emoteName, index) => (
        <RgEmote key={`${emoteName}-${index}`} name={emoteName} size={size} animated={animated} />
      ))}
    </div>
  );
}

/**
 * Composant pour afficher une grille d'emotes
 */
interface RgEmoteGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Personnage dont on veut afficher les emotes */
  character?: "gaelle" | "roy" | "rg";
  /** Catégorie d'emotes à afficher */
  category?: "reaction" | "greeting" | "emotion";
  /** Taille des emotes en pixels */
  size?: number;
  /** Colonnes dans la grille */
  columns?: number;
  /** Animation au survol */
  animated?: boolean;
  /** Callback au clic sur une emote */
  onEmoteClick?: (emote: Emote) => void;
}

export function RgEmoteGrid({
  character,
  category,
  size = 48,
  columns = 4,
  animated = true,
  onEmoteClick,
  className,
  ...props
}: RgEmoteGridProps) {
  let filteredEmotes = Object.values(EMOTES);

  if (character) {
    filteredEmotes = filteredEmotes.filter(e => e.character === character);
  }

  if (category) {
    filteredEmotes = filteredEmotes.filter(e => e.category === category);
  }

  return (
    <div
      className={cn("grid gap-4", className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      {...props}
    >
      {filteredEmotes.map(emote => (
        <button
          key={emote.name}
          onClick={() => onEmoteClick?.(emote)}
          className="flex flex-col items-center gap-2 p-2 rounded-lg hover:bg-muted transition-colors focus:outline-hidden focus:ring-2 focus:ring-primary/50"
          type="button"
        >
          <RgEmote name={emote.name as keyof typeof EMOTES} size={size} animated={animated} />
          <span className="text-xs text-muted-foreground text-center">{emote.name.replaceAll(/_/g, " ")}</span>
        </button>
      ))}
    </div>
  );
}
