/**
 * MangaCard — la carte de contenu du site, en une seule implémentation.
 *
 * Le site en avait une par rubrique (journal, grille de personnages, databooks,
 * tier lists, best-of de la home), chacune avec son propre ratio d'image, son
 * propre survol et sa propre hiérarchie typographique. La carte de databook
 * n'avait pas de badge, celle du journal pas de compteurs, celle du wiki un
 * cadre différent — d'où l'impression de plusieurs sites cousus ensemble.
 *
 * **La grammaire visuelle suit `DESIGN.md`, pas une idée du manga.** Ce document
 * mesure le support officiel (400 planches de nos scans) et en tire trois règles
 * que cette carte applique :
 *
 *  - « La profondeur vient de la surface et du filet, pas de l'ombre portée. » —
 *    donc surface + filet de 1 px, et **aucune** ombre décalée. L'analyse des
 *    illustrations est explicite : l'ombre au sol de Toriyama est un lavis pâle,
 *    « jamais une ombre portée dure ».
 *  - « Une bordure peut être plus franche sur l'élément actif » — le survol
 *    passe le filet à l'or au lieu d'épaissir une ombre.
 *  - Rayon 12 px pour une carte (§ Shapes), 20 px de gouttière intérieure.
 *
 * Server component : aucune interaction au-delà du lien.
 */
import type { ReactNode } from "react";
import { Bulle, Coeur } from "../icones";
import type { UiLinkComponent } from "../navigation/link";

export type UiCardImageProps = {
  src: string;
  alt: string;
  priority: boolean;
  sizes: string;
  className: string;
};

export type MangaCardProps = {
  href: string;
  title: ReactNode;
  badge?: string | null;
  excerpt?: string | null;
  image?: string | null;
  imageAlt?: string | null;
  ratio?: CardRatio;
  meta?: ReactNode;
  footer?: ReactNode;
  priority?: boolean;
  sizes?: string;
  className?: string;
  linkComponent?: UiLinkComponent;
  renderImage?: (props: UiCardImageProps) => ReactNode;
  resolveImage?: (src: string) => string;
};

export type CardRatio = "poster" | "wide" | "square";

const RATIOS: Record<CardRatio, string> = {
	poster: "aspect-[2/3]",
	wide: "aspect-[16/10]",
	square: "aspect-square",
};

export function MangaCard({
	href,
	title,
	badge,
	excerpt,
	image,
	imageAlt,
	ratio = "wide",
	meta,
	footer,
	priority = false,
	sizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 360px",
	className = "",
	linkComponent: Link = "a",
	renderImage,
	resolveImage = (src) => src,
}: MangaCardProps) {
	return (
		<article
			className={`group relative flex flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-dbz-card/80 transition-colors duration-200 focus-within:border-dbz-orange/60 hover:border-dbz-orange/60 ${className}`}
		>
			{image && (
				<Link href={href} tabIndex={-1} aria-hidden className="block">
					<div className={`relative overflow-hidden border-b border-white/[0.08] ${RATIOS[ratio]}`}>
						{renderImage ? renderImage({ src: resolveImage(image), alt: imageAlt ?? "", priority, sizes, className: "object-cover transition-transform duration-500 group-hover:scale-[1.03]" }) : (
							<img src={resolveImage(image)} alt={imageAlt ?? ""} loading={priority ? "eager" : "lazy"} className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
						)}
					</div>
				</Link>
			)}

			<div className="flex min-w-0 flex-1 flex-col p-5">
				{badge && (
					<span className="mb-2.5 self-start rounded border border-white/15 px-2 py-[2px] font-display text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-white/60">
						{badge}
					</span>
				)}

				<h3 className="font-display text-[1.0625rem] font-semibold leading-[1.25] tracking-[-0.01em] text-white sm:text-[1.125rem]">
					{/* Lien étendu : toute la carte est cliquable, sans imbriquer les
					    liens du pied de carte (qui restent au-dessus via z-index). */}
					<Link href={href} className="after:absolute after:inset-0 hover:text-dbz-orange">
						{title}
					</Link>
				</h3>

				{excerpt && (
					<p className="mt-2 line-clamp-3 flex-1 text-[0.875rem] leading-relaxed text-white/[0.68]">
						{excerpt}
					</p>
				)}

				{meta && (
					<p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[0.6875rem] uppercase tracking-[0.06em] text-white/45">
						{meta}
					</p>
				)}

				{footer && (
					<div className="relative z-10 mt-3 flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-3">
						{footer}
					</div>
				)}
			</div>
		</article>
	);
}

/** Grille de cartes responsive — 1 / 2 / 3 colonnes, gouttière unique. */
export function CardGrid({
	children,
	columns = 3,
	className = "",
}: {
	children: ReactNode;
	columns?: 2 | 3 | 4;
	className?: string;
}) {
	const cols = {
		2: "sm:grid-cols-2",
		3: "sm:grid-cols-2 lg:grid-cols-3",
		4: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
	} as const;
	return <div className={`grid gap-5 sm:gap-6 ${cols[columns]} ${className}`}>{children}</div>;
}

/**
 * Compteurs sociaux d'une carte ou d'une ligne de fil.
 *
 * Les glyphes viennent du jeu maison (`components/icones`) : DESIGN.md interdit
 * les emoji décoratifs dans l'interface, et un « 💬 » rendait trois dessins
 * différents selon le système d'exploitation du lecteur.
 */
export function SocialCounts({
	likes,
	comments,
	className = "",
	emptyLabel,
}: {
	likes: number;
	comments: number;
	className?: string;
	/** Texte affiché quand tout est à zéro. Omis, la ligne disparaît. */
	emptyLabel?: string;
}) {
	if (likes === 0 && comments === 0) {
		return emptyLabel ? (
			<span className={`text-[0.75rem] text-white/35 ${className}`}>{emptyLabel}</span>
		) : null;
	}
	return (
		<span
			className={`flex items-center gap-4 font-mono text-[0.75rem] tabular-nums text-white/50 ${className}`}
		>
			{likes > 0 && (
				<span className="inline-flex items-center gap-1.5">
					<Coeur size={14} aria-hidden />
					{likes}
				</span>
			)}
			{comments > 0 && (
				<span className="inline-flex items-center gap-1.5">
					<Bulle size={14} aria-hidden />
					{comments}
				</span>
			)}
		</span>
	);
}
