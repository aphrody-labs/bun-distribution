/**
 * Grille de personnages liés (cartes cliquables) — utilisée pour les catégories
 * « Versions & apparitions » (versions alternatives d'un perso) et « Personnages
 * affiliés » (même faction). RSC pur : reçoit des données déjà chargées côté
 * serveur (`RelatedCharacter[]`) et rend des `<Link>` internes vers chaque fiche.
 * `assetUrl` importé depuis `@/lib/assets` (client-safe) — jamais depuis
 * db-universe/shenron (fuite de `postgres` dans le bundle).
 */
import type { RelatedCharacter } from "@/lib/shenron";
import {
	normalizeSectionAccent,
	sectionAccentStyle,
	type SectionAccent,
} from "@/lib/wiki-section-accents";
import { WikiImg } from "@/components/wiki/WikiImg";
import { GatedWrap } from "@/components/GatedLink";

export function WikiRelatedCharacters({
	heading,
	caption,
	items,
	accent = "orange",
}: {
	heading: string;
	caption?: string;
	items: RelatedCharacter[];
	accent?: SectionAccent;
}) {
	if (!items.length) return null;
	const style = sectionAccentStyle(normalizeSectionAccent(accent));

	return (
		<section className="space-y-8">
			<div className="flex items-center gap-6">
				<h2
					className={`${style.text} font-saiyan text-2xl sm:text-4xl md:text-5xl uppercase tracking-widest`}
				>
					{heading}
				</h2>
				<div className={`h-px flex-1 bg-gradient-to-r ${style.line} to-transparent`} />
			</div>
			{caption && <p className="max-w-3xl text-sm text-white/50">{caption}</p>}

			<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
				{items.map((c) => (
					<GatedWrap
						key={c.id}
						href={`/wiki/personnages/${c.slug || c.id}`}
						className="dbz-panel group flex flex-col items-center p-3 transition-transform duration-300 hover:scale-105"
					>
						<div className="relative mb-3 aspect-square w-full overflow-hidden rounded-lg border border-dbz-border bg-dbz-bg p-1">
							<div className="halftone absolute inset-0 opacity-10" />
							<WikiImg
								src={c.image}
								sizes="(min-width: 1280px) 160px, (min-width: 768px) 22vw, 45vw"
								alt={c.name}
								loading="lazy"
								className="relative z-10 h-full w-full object-contain transition-transform duration-500 group-hover:scale-110"
								placeholderClassName="relative z-10 flex h-full w-full items-center justify-center rounded"
							/>
						</div>
						<h3
							className={`text-center text-xs font-bold uppercase leading-tight tracking-widest text-white transition-colors ${style.relatedHover}`}
						>
							{c.name}
						</h3>
						{c.race && (
							<span className="mt-1 text-[9px] uppercase tracking-[0.2em] text-white/50">
								{c.race}
							</span>
						)}
					</GatedWrap>
				))}
			</div>
		</section>
	);
}
