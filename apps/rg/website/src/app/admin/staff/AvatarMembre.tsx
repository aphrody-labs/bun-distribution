"use client";

import { cn } from "@rosegriffon/ui/lib/utils";
import { Users as UsersIcon } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

/**
 * Photo d'un membre du staff.
 *
 * Le même bloc était recopié trois fois dans la page (tableau des imports,
 * tableau par équipe, tableau des désactivés) et une quatrième dans la carte.
 * Deux défauts s'y étaient installés :
 *
 * - `unoptimized` manquait, alors que les photos pointent sur des hôtes
 *   distants (`cdn.discordapp.com` en très large majorité) : l'optimiseur
 *   d'images de Next les réencodait pour rien, ce qui est précisément le
 *   scénario documenté comme cause des photos d'équipe cassées ;
 * - `sizes` manquait sur les `fill`, donc chaque vignette de 40 px téléchargeait
 *   une image pleine largeur ;
 * - aucun repli en cas d'URL morte (avatar Discord périmé) : la vignette restait
 *   vide, sans indiquer que la source était cassée.
 */
export function AvatarMembre({
  src,
  alt,
  taille,
  className,
  attenue = false,
}: {
  src: string | null;
  alt: string;
  /** Côté du carré rendu, en pixels CSS — sert aussi d'attribut `sizes`. */
  taille: number;
  className?: string;
  /** Rend la photo en retrait (membres désactivés). */
  attenue?: boolean;
}) {
  const [sourceEnEchec, setSourceEnEchec] = useState<string | null>(null);
  const enEchec = src !== null && sourceEnEchec === src;

  const afficheImage = Boolean(src) && !enEchec;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-full bg-surface-container-high",
        attenue && "opacity-60",
        className,
      )}
      style={{ height: taille, width: taille }}
    >
      {afficheImage ? (
        <Image
          src={src as string}
          alt={alt}
          fill
          sizes={`${taille}px`}
          className="object-cover"
          onError={() => setSourceEnEchec(src)}
          unoptimized
        />
      ) : (
        <div
          className="flex size-full items-center justify-center text-on-surface-variant"
          title={enEchec ? "Photo introuvable" : "Aucune photo"}
        >
          <UsersIcon aria-hidden="true" style={{ height: taille / 2, width: taille / 2 }} />
          <span className="sr-only">{enEchec ? "Photo introuvable" : "Aucune photo"}</span>
        </div>
      )}
    </div>
  );
}
