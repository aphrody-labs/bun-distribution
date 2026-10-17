"use client";

/**
 * Rendu de `next/image` (alias de `next.config.ts`) avec un repli quand la
 * source a disparu.
 *
 * Deux familles d'images meurent sans prévenir :
 * - les avatars Discord : l'URL porte le hash de l'avatar, qui change dès que
 *   le membre en choisit un autre — le profil stocké pointe alors sur un 404 ;
 * - les médias hébergés (Supabase Storage, `/storage/v1`, anciens fichiers du
 *   CDN, images de posts X supprimés) dont l'original n'existe plus.
 *
 * Au premier échec, l'image bascule sur l'avatar par défaut de Discord (dérivé
 * de l'identifiant, comme le fait Discord) ou sur l'illustration neutre du
 * site, au lieu de laisser l'icône d'image cassée du navigateur.
 */
import NextImage from "next/dist/api/image";
import type { ImageProps } from "next/image";
import { type SyntheticEvent, useState } from "react";

import { withGuardrail } from "./image-cdn";

const PLACEHOLDER = "/images/placeholder-news.svg";

/** Avatar par défaut que Discord sert à un compte sans avatar personnalisé. */
function avatarDiscordParDefaut(userId: string): string {
  let index = 0;
  try {
    index = Number((BigInt(userId) >> 22n) % 6n);
  } catch {
    index = 0;
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/** Image de repli d'une source, ou `null` quand l'échec doit rester visible. */
export function imageDeRepli(src: ImageProps["src"]): string | null {
  if (typeof src !== "string") return null;
  if (src.startsWith("/storage/v1/")) return PLACEHOLDER;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  if (url.hostname === "cdn.discordapp.com") {
    const userId = url.pathname.match(/^\/(?:guilds\/\d+\/users\/)?avatars\/(\d+)\//)?.[1];
    if (userId) return avatarDiscordParDefaut(userId);
    return url.pathname.startsWith("/embed/avatars/") ? null : PLACEHOLDER;
  }
  if (url.hostname.endsWith(".supabase.co") || url.pathname.startsWith("/storage/v1/")) return PLACEHOLDER;
  if (url.hostname === "pbs.twimg.com") return PLACEHOLDER;
  // Anciens médias du CDN, nommés par leur empreinte (`/<16 hex>.webp`).
  if (url.hostname === "cdn.rosegriffon.fr" && /^\/[0-9a-f]{16}\.\w+$/.test(url.pathname)) return PLACEHOLDER;
  return null;
}

export default function Image(props: ImageProps) {
  const [sourceEnEchec, setSourceEnEchec] = useState<ImageProps["src"] | null>(null);
  const repli = sourceEnEchec === props.src ? imageDeRepli(props.src) : null;
  const { onError } = props;

  const handleError = (event: SyntheticEvent<HTMLImageElement, Event>) => {
    if (sourceEnEchec !== props.src && imageDeRepli(props.src)) setSourceEnEchec(props.src);
    onError?.(event);
  };

  const rendu = repli ? { ...props, src: repli, unoptimized: true } : props;
  return <NextImage {...withGuardrail(rendu)} onError={repli ? onError : handleError} />;
}
