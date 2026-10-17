/**
 * SectionHeading — le titre de section, partout le même.
 *
 * Trois niveaux d'information, dans l'ordre où l'œil les prend : un *kicker*
 * (la famille : « Le Journal », « Wiki »), le titre, puis une phrase de
 * situation. Les actions (bouton, lien, flux RSS) vivent à droite sur desktop et
 * passent dessous sur mobile — jamais écrasées, jamais coupées.
 *
 * Le filet d'encre sous le titre est la signature Toriyama de la maquette : un
 * trait épais, net, sans dégradé. Il est ici optionnel pour que deux sections
 * empilées ne produisent pas deux traits collés.
 *
 * Server component.
 */
import type { ReactNode } from "react";
import { HeroTitles } from "./HeroTitles";

export function SectionHeading({
  kicker,
  title,
  standfirst,
  actions,
  level = 2,
  rule = true,
  className = "",
  id,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  standfirst?: ReactNode;
  /** Liens ou boutons alignés à droite du titre. */
  actions?: ReactNode;
  /** Niveau de titre réel — l'apparence ne change pas, la sémantique oui. */
  level?: 1 | 2 | 3;
  rule?: boolean;
  className?: string;
  id?: string;
}) {
  const Tag = (level === 2 ? "h2" : "h3") as "h2" | "h3";
  // Les sous-sections gardent la MÊME famille que le titre de page (serif
  // d'affichage, casse normale) d'une taille en dessous : c'est ce qui fait lire
  // une page comme un document, et non comme trois blocs empilés.
  const size = level === 2 ? "text-[clamp(1.5rem,1.2rem+1.2vw,2rem)]" : "text-[clamp(1.125rem,1rem+0.6vw,1.375rem)]";

  return (
    <header id={id} className={`${rule ? "border-b-2 border-white/12 pb-4" : ""} ${className}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {/* Le titre de PAGE délègue à `HeroTitles`, la source unique des
					    titres du site (cf. son en-tête : deux typographies sur un même
					    site, c'est zéro identité). Introduire ici une troisième
					    grammaire aurait refait exactement l'erreur qu'il a corrigée. */}
          {level === 1 ? (
            <HeroTitles eyebrow={kicker} title={title} lead={standfirst} />
          ) : (
            <>
              {kicker && (
                <p className="font-display text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-dbz-orange">
                  {kicker}
                </p>
              )}
              <Tag
                className={`${size} mt-1.5 font-serif font-semibold leading-[1.12] tracking-[-0.015em] text-balance text-white`}
              >
                {title}
              </Tag>
            </>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
      {/* Pour un titre de page, le chapô est rendu par `HeroTitles` lui-même :
			    l'écrire deux fois le ferait apparaître en double. */}
      {standfirst && level !== 1 && (
        <p className="mt-3 max-w-[52ch] text-[0.9375rem] leading-relaxed text-white/60 sm:text-[1rem]">{standfirst}</p>
      )}
    </header>
  );
}
