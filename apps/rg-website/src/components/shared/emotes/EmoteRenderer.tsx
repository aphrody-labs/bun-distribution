"use client";

import { useMemo } from "react";

import { EMOTES } from "@/lib/emotes";
import type { Emote } from "@/lib/emotes";
import { cn } from "@/lib/utils";

import RgEmote from "./RgEmote";

interface EmoteRendererProps {
  /** Texte contenant des marqueurs d'emotes (ex: "Hello :gaelle-salut: !") */
  text: string;
  /** Pattern pour détecter les emotes (default: /:(\w+-?\w+):/) */
  pattern?: RegExp;
  /** Taille des emotes inline (default: 24) */
  emoteSize?: number;
  /** Classes CSS personnalisées */
  className?: string;
  /** Animer les emotes au survol */
  animated?: boolean;
}

/**
 * Composant pour rendre du texte avec des emotes inline
 *
 * Convertit les marqueurs :emote-name: en composants RgEmote
 *
 * @example
 * ```tsx
 * <EmoteRenderer
 *   text="Bienvenue :gaelle-salut: sur Rose Griffon :roy-evil: !"
 *   emoteSize={32}
 * />
 * ```
 */
export default function EmoteRenderer({
  text,
  pattern = /:([a-z]+-?[a-z]+):/g,
  emoteSize = 24,
  className,
  animated = true,
}: EmoteRendererProps) {
  const elements = useMemo(() => {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    // Reset regex state
    const matcher = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);

    while ((match = matcher.exec(text)) !== null) {
      const emoteName = match[1];
      if (!emoteName) {
        lastIndex = match.index + match[0].length;
        continue;
      }
      const emote = EMOTES[emoteName as keyof typeof EMOTES];

      // Ajouter le texte avant l'emote
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }

      // Ajouter l'emote si elle existe
      if (emote) {
        parts.push(
          <RgEmote
            key={`emote-${match.index}`}
            name={emoteName as keyof typeof EMOTES}
            size={emoteSize}
            animated={animated}
            className="inline-block align-middle mx-0.5"
          />,
        );
      } else {
        // Si l'emote n'existe pas, garder le texte original
        parts.push(match[0]);
      }

      lastIndex = match.index + match[0].length;
    }

    // Ajouter le texte restant
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts;
  }, [text, pattern, emoteSize, animated]);

  return <span className={cn("inline-flex items-center flex-wrap", className)}>{elements}</span>;
}

/**
 * Hook pour extraire les emotes d'un texte
 *
 * @example
 * ```tsx
 * const emotes = useEmotesFromText("Hello :gaelle-salut: :roy-evil:");
 * // => [{ name: "gaelle-salut", ... }, { name: "roy-evil", ... }]
 * ```
 */
export function useEmotesFromText(text: string, pattern: RegExp = /:([a-z]+-?[a-z]+):/g): Emote[] {
  return useMemo(() => {
    const foundEmotes: Emote[] = [];
    let match: RegExpExecArray | null;

    // Reset regex state
    const matcher = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);

    while ((match = matcher.exec(text)) !== null) {
      const emoteName = match[1];
      if (!emoteName) {
        continue;
      }
      const emote = EMOTES[emoteName as keyof typeof EMOTES];
      if (emote && !foundEmotes.find(e => e.name === emote.name)) {
        foundEmotes.push(emote);
      }
    }

    return foundEmotes;
  }, [text, pattern]);
}

/**
 * Fonction utilitaire pour remplacer les emotes dans un texte par leur alt text
 * Utile pour les meta descriptions, titres, etc.
 *
 * @example
 * ```tsx
 * stripEmotes("Hello :gaelle-salut: !")
 * // => "Hello Gaëlle fait un salut !"
 * ```
 */
export function stripEmotes(text: string, pattern: RegExp = /:([a-z]+-?[a-z]+):/g): string {
  return text.replace(pattern, (match, emoteName) => {
    const emote = EMOTES[emoteName];
    return emote ? emote.alt : match;
  });
}

/**
 * Fonction utilitaire pour obtenir uniquement le texte sans emotes
 *
 * @example
 * ```tsx
 * getTextWithoutEmotes("Hello :gaelle-salut: !")
 * // => "Hello  !"
 * ```
 */
export function getTextWithoutEmotes(text: string, pattern: RegExp = /:([a-z]+-?[a-z]+):/g): string {
  return text.replace(pattern, "").trim();
}
