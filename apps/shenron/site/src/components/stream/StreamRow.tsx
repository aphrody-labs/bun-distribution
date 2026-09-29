import Link from "next/link";
import { ChevronDroite } from "@/components/icones";
import { StreamRail } from "./StreamRail";

// Construit UNE fois : `new Intl.NumberFormat` à chaque rendu est l'un des
// appels les plus chers de la plateforme (chargement des données de locale).
const nf = new Intl.NumberFormat("fr-FR");

/**
 * StreamRow — section titrée « à la Netflix » : en-tête (barre d'accent + titre +
 * compteur + lien « Tout voir ») au-dessus d'un rail horizontal. Server Component :
 * seul le rail (défilement) est client ; les cartes enfant sont rendues serveur.
 */
export function StreamRow({
	title,
	accent,
	count,
	seeAllHref,
	seeAllLabel = "Tout voir",
	id,
	headingLevel = 2,
	children,
}: {
	title: string;
	/** 3 quand la page pose déjà un `<h2>` au-dessus du rail (accueil). */
	headingLevel?: 2 | 3;
	accent?: string;
	count?: number;
	seeAllHref?: string;
	seeAllLabel?: string;
	/** Ancre facultative pour naviguer entre les catégories du catalogue. */
	id?: string;
	children: React.ReactNode;
}) {
	const Heading = headingLevel === 3 ? "h3" : "h2";
	return (
		<section id={id} className="scroll-mt-24 mb-9 lg:mb-12">
			<div className="mb-3 flex items-end justify-between gap-4">
				<Heading className="flex items-center gap-2.5 font-display text-[19px] font-bold text-white sm:text-[22px]">
					{accent && (
						<span className="h-5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
					)}
					{title}
					{count != null && (
						// Séparateur de milliers : « 1307 » à côté d'un tableau qui affiche
						// « 1 307 » donne l'impression de deux chiffres différents.
						<span className="font-mono text-[13px] font-normal tabular-nums text-white/55">
							{nf.format(count)}
						</span>
					)}
				</Heading>
				{seeAllHref && (
					<Link
						href={seeAllHref}
						className="group/see -my-2 inline-flex min-h-11 shrink-0 items-center gap-0.5 py-2 text-[12px] font-display font-semibold uppercase tracking-wider text-white/60 transition-colors hover:text-dbz-orange"
					>
						{seeAllLabel}
						<ChevronDroite className="h-4 w-4 transition-transform group-hover/see:translate-x-0.5" />
					</Link>
				)}
			</div>
			<StreamRail ariaLabel={title}>{children}</StreamRail>
		</section>
	);
}
