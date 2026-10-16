/**
 * Glyphe — rendu commun des icônes maison.
 *
 * Un seul composant lit `GEOMETRIES` (`./geometries`, source unique de la
 * géométrie) et applique l'encrage du support : trait d'épaisseur constante,
 * bouts coupés net (`butt`), coudes pointus (`miter`), aplats en `currentColor`
 * et aucun dégradé. Rien ici ne dessine : toute correction de forme se fait
 * dans `geometries.ts` et se contrôle avec `scripts/rend-icones.ts`.
 *
 * L'API reproduit celle de `lucide-react` (`size`, `strokeWidth`, `className`,
 * `color`, `absoluteStrokeWidth`, plus les props SVG et `ref`) pour que le
 * remplacement d'un glyphe se réduise à un changement d'import. Comme chez
 * lucide, `aria-hidden` est posé par défaut : une icône décorative ne doit pas
 * être annoncée. Passer `aria-label` (ou `role="img"`) le lève.
 */

import type { SVGProps } from "react";
import {
  BOITE_ICONE,
  GEOMETRIES,
  POINTE_ICONE,
  TRAIT_ICONE,
  type GeometrieIcone,
  type NomIcone,
} from "./geometries";

export type ProprietesIcone = Omit<SVGProps<SVGSVGElement>, "children"> & {
  /** Côté du carré rendu, en pixels. Défaut 24, comme lucide. */
  size?: number | string;
  /** Épaisseur du trait, en unités de la boîte de 24. Défaut 2. */
  strokeWidth?: number | string;
  /**
   * Garde l'épaisseur constante en pixels quelle que soit `size` (le trait ne
   * maigrit plus quand l'icône rétrécit). Même sémantique que lucide.
   */
  absoluteStrokeWidth?: boolean;
};

type ProprietesGlyphe = ProprietesIcone & { nom: NomIcone };

export function Glyphe({
  nom,
  size = 24,
  strokeWidth = TRAIT_ICONE,
  absoluteStrokeWidth = false,
  color,
  ...reste
}: ProprietesGlyphe) {
  // `as const satisfies` fige chaque entrée dans son propre type : `traits` et
  // `aplats` n'existent alors pas sur toutes les branches de l'union. On relit
  // la table par le contrat commun, qui les déclare optionnels.
  const geo: GeometrieIcone = GEOMETRIES[nom];
  const trait = absoluteStrokeWidth
    ? (Number(strokeWidth) * BOITE_ICONE) / Number(size)
    : strokeWidth;
  // L'en-tête promet qu'`aria-label` OU `role="img"` lève le masquage ; le code
  // ne regardait qu'`aria-label`, si bien qu'une icône nommée par
  // `aria-labelledby` — ou déclarée `role="img"` — restait invisible aux lecteurs
  // d'écran, sans rien signaler. (`children` étant exclu de `ProprietesIcone`, un
  // `<title>` interne n'est pas une option : le nom vient forcément d'une prop.)
  const roleAnnonce =
    reste.role !== undefined &&
    reste.role !== "presentation" &&
    reste.role !== "none";
  const estAnnoncee =
    Boolean(reste["aria-label"] ?? reste["aria-labelledby"]) || roleAnnonce;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={`0 0 ${BOITE_ICONE} ${BOITE_ICONE}`}
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={trait}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      strokeMiterlimit={POINTE_ICONE}
      aria-hidden={estAnnoncee ? undefined : true}
      {...reste}
    >
      {geo.traits?.map((d) => (
        <path key={d} d={d} />
      ))}
      {geo.aplats?.map((d) => (
        <path key={d} d={d} fill={color ?? "currentColor"} stroke="none" />
      ))}
    </svg>
  );
}
