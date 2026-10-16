"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

/**
 * Fond de l'accueil, qui passe d'un univers à l'autre.
 *
 * POURQUOI IL EXISTE
 * Les trois sites avaient chacun leur identité visuelle : le marine et l'or de
 * Rose Griffon, le grenat d'Azalée, le violet d'Achilléa. Les fusionner sous un
 * seul domaine les a réduits à un fond uni. Ces images-là sont déjà dans le
 * dépôt et ne servaient plus à rien.
 *
 * CE QU'IL NE FAIT PAS
 * Il ne bouge pas si la personne a demandé à réduire les animations
 * (`prefers-reduced-motion`) : le fond se fige alors sur la première image. Un
 * arrière-plan qui change tout seul est exactement ce que ce réglage vise.
 *
 * Il ne charge pas non plus les trois images d'un coup : seule la première est
 * prioritaire, les suivantes arrivent en différé. Le fond ne doit pas retarder
 * le contenu qu'il décore.
 */

export interface FondUnivers {
  /** Chemin de l'image dans `public/`. */
  src: string;
  /** Univers, pour la teinte du voile. */
  univers: "rose-griffon" | "azalee" | "achillea";
}

const VOILE: Record<FondUnivers["univers"], string> = {
  achillea: "from-[#1a0b2e]/95 via-[#1a0b2e]/80 to-[#1a0b2e]/95",
  azalee: "from-[#240112]/95 via-[#240112]/80 to-[#240112]/95",
  "rose-griffon": "from-[#0c1730]/95 via-[#0c1730]/80 to-[#0c1730]/95",
};

/** Durée d'affichage d'un univers, en millisecondes. */
const DUREE = 9000;

export function FondAlternant({ fonds }: { fonds: readonly FondUnivers[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (fonds.length < 2) return;
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const minuterie = setInterval(() => {
      setIndex(precedent => (precedent + 1) % fonds.length);
    }, DUREE);

    return () => clearInterval(minuterie);
  }, [fonds.length]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {fonds.map((fond, rang) => (
        <div
          key={fond.src}
          className={`absolute inset-0 transition-opacity duration-1000 ${
            rang === index ? "opacity-100" : "opacity-0"
          }`}
        >
          <Image
            src={fond.src}
            alt=""
            fill
            priority={rang === 0}
            loading={rang === 0 ? undefined : "lazy"}
            sizes="100vw"
            className="object-cover"
          />
          <div className={`absolute inset-0 bg-linear-to-b ${VOILE[fond.univers]}`} />
        </div>
      ))}
    </div>
  );
}
