/**
 * PageShell — la colonne de lecture unique du site.
 *
 * Le site avait autant de largeurs que de pages : `max-w-[1180px] px-6 py-14`
 * dans le journal, `max-w-6xl px-4` dans le wiki, `page-shell` sur la home et le
 * pied de page, des `py-10` ailleurs. Résultat : le contenu sautait de quelques
 * dizaines de pixels d'une rubrique à l'autre, et le rythme vertical changeait
 * au milieu d'un parcours.
 *
 * Ici, trois largeurs nommées, un seul rythme vertical, une seule gouttière —
 * celle de `--shell-pad`, déjà utilisée par la home et le pied de page, pour que
 * les bords s'alignent verticalement d'un bloc à l'autre.
 *
 * Server component : utilisable dans n'importe quelle page sans coût client.
 */
import type { ReactNode } from "react";
import { KintoUn } from "../toriyama/KintoUn";

export type ShellWidth = "prose" | "narrow" | "default" | "wide" | "full";

/**
 * `prose` ≈ 46rem : une colonne de texte long (corps d'article).
 * `narrow` ≈ 62rem : une page-document (à propos, licence, confidentialité,
 *   crédits). Ces quatre pages faisaient 820, 920 et 1000 px — trois largeurs
 *   pour le même genre de contenu, pour rien.
 * `default` = la largeur du site (grilles, index, fiches).
 * `wide` : tableaux et tableaux de bord qui étouffent en dessous.
 * `full` : le shell ne borne plus, il ne garde que la gouttière.
 */
const WIDTHS: Record<ShellWidth, string> = {
  prose: "max-w-[46rem]",
  narrow: "max-w-[62rem]",
  default: "max-w-[var(--shell-max,1180px)]",
  wide: "max-w-[1560px]",
  full: "max-w-none",
};

export type ShellRhythm = "none" | "tight" | "default" | "loose";

/** Rythme vertical : identique partout, fluide entre mobile et desktop. */
const RHYTHMS: Record<ShellRhythm, string> = {
  none: "",
  tight: "py-[clamp(1.5rem,4vw,2.5rem)]",
  default: "py-[clamp(2.5rem,6vw,4.5rem)]",
  loose: "py-[clamp(3.5rem,8vw,6rem)]",
};

export function PageShell({
  children,
  width = "default",
  rhythm = "default",
  as: Tag = "div",
  className = "",
  id,
  wikiDecorative = false,
}: {
  children: ReactNode;
  width?: ShellWidth;
  rhythm?: ShellRhythm;
  as?: "div" | "main" | "section" | "article" | "aside";
  className?: string;
  id?: string;
  wikiDecorative?: boolean;
}) {
  return (
    <Tag
      id={id}
      className={`mx-auto w-full px-[var(--shell-pad,1.5rem)] ${WIDTHS[width]} ${RHYTHMS[rhythm]} ${wikiDecorative ? "relative overflow-hidden" : ""} ${className}`}
    >
      {wikiDecorative && (
        <KintoUn
          decorative
          hauteur={158}
          className="pointer-events-none absolute right-0 top-3 hidden opacity-[0.09] md:block"
        />
      )}
      <div className={wikiDecorative ? "relative z-[1]" : undefined}>
        {children}
      </div>
    </Tag>
  );
}

/**
 * Bloc de contenu séparé par un filet d'encre — l'unité de composition verticale
 * d'une page. Remplace les `mt-16 border-t border-white/10 pt-10` recopiés
 * partout avec des valeurs légèrement différentes.
 */
export function Stack({
  children,
  gap = "default",
  className = "",
}: {
  children: ReactNode;
  gap?: "tight" | "default" | "loose";
  className?: string;
}) {
  const gaps = {
    tight: "space-y-6",
    default: "space-y-[clamp(2rem,5vw,3.5rem)]",
    loose: "space-y-[clamp(3rem,8vw,5.5rem)]",
  } as const;
  return <div className={`${gaps[gap]} ${className}`}>{children}</div>;
}
