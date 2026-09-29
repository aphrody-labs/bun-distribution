import Link from "next/link";
import { WikiImg } from "@/components/wiki/WikiImg";

/**
 * Carte portrait d'un personnage — le pendant de `PosterCard` (2:3, films) pour
 * les fiches de l'encyclopédie, en 3:4.
 *
 * Composant SERVEUR : le survol est entièrement CSS. Elle existe parce que la
 * même carte était réécrite à la main dans `/wiki` et dans `CharacterGrid`,
 * avec des tailles et des replis différents — donc deux rendus pour une seule
 * notion. Le repli d'image passe par `WikiImg` : beaucoup de fiches n'ont pas
 * d'illustration, et un rectangle vide ferait croire à une page cassée.
 */
export function CharacterPosterCard({
	href,
	name,
	race,
	image,
	fallback,
	width = "rail",
}: {
	href: string;
	name: string;
	race?: string | null;
	image: string | null;
	fallback?: string | null;
	/** "rail" = largeur fixe (défilement horizontal) ; "full" = suit la grille. */
	width?: "rail" | "full";
}) {
	return (
		<Link
			href={href}
			className={`group/card relative block shrink-0 snap-start rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange focus-visible:ring-offset-2 focus-visible:ring-offset-dbz-bg ${
				width === "rail" ? "w-[124px] sm:w-[140px]" : "w-full"
			}`}
		>
			<div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-dbz-card ring-1 ring-white/[0.06] transition-all duration-300 group-hover/card:ring-dbz-orange/60 group-focus-visible/card:ring-dbz-orange/60">
				<WikiImg
					src={image}
					fallback={fallback}
					alt={name}
					sizes="160px"
					className="absolute inset-0 h-full w-full object-cover object-top transition-transform duration-500 group-hover/card:scale-105"
				/>
			</div>
			<div className="mt-2 px-0.5">
				<p className="truncate font-display text-[13px] font-semibold text-white/90 transition-colors group-hover/card:text-dbz-orange group-focus-visible/card:text-dbz-orange">
					{name}
				</p>
				{race && <p className="truncate text-[11px] text-white/55">{race}</p>}
			</div>
		</Link>
	);
}
