/**
 * Icône PrimeIcons — l'iconographie RÉELLE d'Achilléa.
 *
 * Le front Angular en compte 377 occurrences. Le portage les avait toutes
 * remplacées par `lucide-react` : une icône générique là où Achilléa a la
 * sienne, et des approximations pour les pictogrammes de marque (Discord,
 * Twitch, TikTok) que Lucide ne fournit pas. La police est pourtant livrée
 * depuis le début dans `public/achillea/media/`.
 *
 * Ce composant est un `<i>` typé, pas une image : l'icône hérite de
 * `currentColor` et de la taille du texte, donc elle suit le thème et
 * l'échelle typographique sans réglage.
 */

import { cn } from "@/lib/utils";

export interface PrimeIconProps {
  /** Nom PrimeIcons SANS le préfixe : `trophy`, `users`, `discord`… */
  name: string;
  className?: string;
  /**
   * Libellé pour les lecteurs d'écran.
   *
   * Absent, l'icône est masquée (`aria-hidden`) : une icône décorative
   * annoncée à côté du texte qu'elle illustre double l'information.
   */
  label?: string;
  /** Largeur fixe, pour aligner une colonne d'icônes dans une liste. */
  fixedWidth?: boolean;
}

export function PrimeIcon({ className, fixedWidth, label, name }: PrimeIconProps) {
  return (
    <i
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cn("pi", `pi-${name}`, fixedWidth && "pi-fw", className)}
      role={label ? "img" : undefined}
    />
  );
}
