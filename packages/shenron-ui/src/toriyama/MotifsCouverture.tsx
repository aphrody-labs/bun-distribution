/**
 * Les quatre motifs de décor de la couverture de tankōbon, en composants.
 *
 * Géométrie et nombres : `src/lib/couverture.ts` — une seule source, partagée
 * avec le script `scripts/genere-motifs-couverture.ts`. Tout est rendu côté
 * serveur, sans JavaScript client, comme `<KintoUn>`.
 *
 * Deux techniques de rendu, et la raison du partage :
 *
 *  - **SVG en ligne** pour ce qui a une forme — l'étoile. Le tracé vient de la
 *    bibliothèque, la couleur de `currentColor`.
 *  - **anneaux et dégradés CSS** pour ce qui n'est qu'une suite de couronnes —
 *    le cadre et la pastille. Un SVG y aurait imposé un `<defs>` avec un
 *    identifiant de dégradé, donc des identifiants dupliqués dès qu'une grille
 *    affiche vingt vignettes ; `box-shadow` et `radial-gradient` rendent
 *    exactement la même chose, suivent n'importe quel format et n'ajoutent rien
 *    au DOM.
 *  - **fichier statique répété** pour le banc de nuages : `background-repeat`
 *    est le seul moyen d'obtenir une frise sans couture à n'importe quelle
 *    largeur. Le fichier porte les aplats mesurés, il n'hérite d'aucune
 *    variable — c'est l'exception prévue à la règle « pas d'hexadécimal ».
 */
import type { CSSProperties, ReactNode } from "react";
import { uiAssetUrl } from "../assets";
import {
  PASTILLE,
  anneauPastille,
  anneauxCadre,
  etoilePath,
  etoileViewBox,
  ombreCadre,
} from "../toriyama-svg/couverture";

// ─────────────────────────── 1. Cadre de case ───────────────────────────────

/**
 * Encadrement de couverture : trait d'encre, liseré jaune, trait d'encre, coins
 * vifs. Mesuré sur la case de l'illustration (liseré 1,77 % de la largeur du
 * cadre, encre 0,37 %, aucun rayon de coin).
 *
 * Le cadre est posé en `box-shadow` : il ne prend pas de place dans le flux, ne
 * décale rien, et suit le format de l'enfant. `largeur` sert à calculer les
 * épaisseurs — donner la largeur RENDUE, pas celle de l'image source.
 */
export function CadreCase({
  children,
  largeur = 320,
  className = "",
  style,
}: {
  children: ReactNode;
  /** Largeur rendue de la vignette, en px : elle pilote les épaisseurs. */
  largeur?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const a = anneauxCadre(largeur);
  return (
    <div className={`relative ${className}`} style={{ boxShadow: ombreCadre(a), borderRadius: a.rayon, ...style }}>
      {children}
    </div>
  );
}

// ───────────────────────── 2. Volutes de nuage ──────────────────────────────

/**
 * Banc de nuages : la frise de volutes du fond de case, répétée en x.
 *
 * Le ciel derrière n'est pas décoratif au sens du goût, il est mesuré : sur la
 * couverture, ces nuages pâles sont toujours posés sur l'aplat `#3760B2`, et
 * seuls ils flotteraient sur le noir du site.
 */
export function BancNuages({
  hauteur = 56,
  className = "",
  opacite = 1,
  cloudUrl = uiAssetUrl("dbz/marque/banc-nuage.svg"),
  /** Retourne la frise (lobes vers le bas) : bas de section plutôt que haut. */
  retourne = false,
}: {
  hauteur?: number;
  className?: string;
  opacite?: number;
  cloudUrl?: string;
  retourne?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={`w-full ${className}`}
      style={{
        height: hauteur,
        opacity: opacite,
        backgroundColor: "var(--color-case-ciel)",
        backgroundImage: `url("${cloudUrl}")`,
        backgroundRepeat: "repeat-x",
        backgroundSize: "auto 100%",
        transform: retourne ? "scaleY(-1)" : undefined,
      }}
    />
  );
}

// ─────────────────────── 3. Pastille de numéro de tome ──────────────────────

/**
 * Pastille de numéro : disque à dégradé radial concentrique, cerne d'encre à
 * 5,75 % du diamètre, chiffre à la moitié du diamètre.
 *
 * Un anneau clair est ajouté DEHORS du cerne d'encre — il n'existe pas sur le
 * papier, mais le noir sur noir du site fait disparaître la pastille, exactement
 * comme le double cerne des titres (cf. document de mesures). `surImage` le
 * coupe : sur une couverture, l'encre suffit.
 */
export function PastilleTome({
  numero,
  taille = 44,
  className = "",
  surImage = false,
  decorative = false,
}: {
  numero: number | string;
  /** Diamètre rendu, en px. */
  taille?: number;
  className?: string;
  /** Posée sur une image : pas d'anneau clair. */
  surImage?: boolean;
  decorative?: boolean;
}) {
  const a = anneauPastille(taille);
  const arrets = PASTILLE.degradeJetons.map(([r, c]) => `${c} ${Math.round(r * 100)}%`).join(", ");
  const texte = String(numero);
  // Le chiffre mesure la moitié du diamètre ; au-delà d'un chiffre, il faut
  // bien le réduire, sinon « 42 » déborde du cerne.
  const facteur = texte.length >= 3 ? 0.42 : texte.length === 2 ? 0.56 : 0.68;
  const anneaux = surImage
    ? `0 0 0 ${a.cerne}px var(--color-encre)`
    : `0 0 0 ${a.cerne}px var(--color-encre), 0 0 0 ${a.cerne * 1.7}px var(--color-os)`;
  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-full font-display font-black leading-none tabular-nums ${className}`}
      style={{
        width: taille,
        height: taille,
        background: `radial-gradient(circle closest-side at 50% 50%, ${arrets})`,
        boxShadow: anneaux,
        color: "var(--color-encre)",
        fontSize: Math.round(taille * facteur),
      }}
      {...(decorative ? { "aria-hidden": true } : { role: "img" as const, "aria-label": `Tome ${texte}` })}
    >
      <span aria-hidden>{texte}</span>
    </span>
  );
}

// ──────────────────────────── 4. Étoile ─────────────────────────────────────

/**
 * L'étoile de la ligne de titre secondaire : cinq branches, pointe en haut,
 * rapport intérieur/extérieur 0,45 (le pentagramme régulier donne 0,382 — la
 * mesure du support est franchement plus grasse, et c'est ce qui la garde
 * lisible à 12 px). Aplat plein, aucun contour.
 *
 * La couleur vient de `currentColor` : posée dans un texte, elle en prend la
 * teinte. L'aplat mesuré du support est `--color-etoile-rouge` (#ba151c, teinte
 * 357,5°) — dix degrés plus froid que le rouge du titre, ce ne sont pas les
 * mêmes encres ; l'appeler avec `className="text-[var(--color-etoile-rouge)]"`
 * quand on veut l'aplat exact plutôt que la couleur du texte porteur.
 */
export function Etoile({
  taille = 12,
  className = "",
  title,
  decorative = true,
}: {
  /** Hauteur rendue en px ; la largeur suit le ratio mesuré (1,05). */
  taille?: number;
  className?: string;
  title?: string;
  decorative?: boolean;
}) {
  const e = etoileViewBox(50);
  const [, , w, h] = e.viewBox.split(" ").map(Number);
  if (w === undefined || h === undefined || !Number.isFinite(w) || !Number.isFinite(h) || h <= 0) {
    throw new RangeError("Invalid star viewBox dimensions");
  }
  return (
    <svg
      viewBox={e.viewBox}
      width={Math.round((taille * w) / h)}
      height={taille}
      className={`inline-block shrink-0 ${className}`}
      fill="currentColor"
      {...(decorative ? { "aria-hidden": true as const } : { role: "img" as const, "aria-label": title ?? "Étoile" })}
    >
      <path d={etoilePath(e.cx, e.cy, 50)} />
    </svg>
  );
}
