import { ContributeRail, DomainBar } from "@/components/kit";
import { SectionUnavailable } from "@/components/wiki/SectionUnavailable";
import { dbUniverse } from "@/lib/db-universe";
import { getRatingSummaries } from "@/lib/ratings";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { GamesExplorer } from "@/components/wiki/GamesExplorer";
import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { pageHero } from "@/lib/banner-config";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Jeux vidéo Dragon Ball",
	description:
		"Catalogue interactif des jeux vidéo officiels Dragon Ball : Kakarot, Sparking ZERO, Xenoverse, FighterZ, Dokkan Battle, Legends et classiques rétro.",
	alternates: { canonical: "/wiki/jeux" },
};

export default async function JeuxPage() {
	const data = await dbUniverse.games();
	if (!data || data.games.length === 0)
		return <SectionUnavailable title="Jeux vidéo Dragon Ball" />;
	const games = data.games;
	const ratings = await getRatingSummaries(
		"game",
		games.map((g) => String(g.id))
	);

	const ratingsRecord: Record<string, { average: number; count: number }> = {};
	for (const [id, r] of ratings.entries()) {
		ratingsRecord[id] = { average: r.average, count: r.count };
	}

	return (
		<>
			<PageHero
				eyebrow="Bandai Namco Entertainment & Dérivés Officiels"
				title="Jeux vidéo Dragon Ball"
				lead={`${games.length} titres officiels répertoriés — du fighting compétitif de FighterZ au RPG narratif de Kakarot, du phénomène mobile Dokkan Battle à Sparking ZERO sur PlayStation 5.`}
				image={await pageHero("jeux")}
				imageAlt="Jeux vidéo Dragon Ball"
			/>
			<div className="wiki-container space-y-8">
				<DomainBar domain="wiki" />
				<div className="flex flex-wrap items-center justify-between gap-4">
					<Breadcrumbs items={[{ label: "Jeux vidéo" }]} />
					<WikiDrawer />
				</div>

				<div className="rounded-2xl border border-blue-500/20 bg-gradient-to-r from-blue-950/20 via-black/40 to-transparent p-5 backdrop-blur-md">
					<div className="flex items-center gap-3">
						<span className="text-2xl">🎮</span>
						<div>
							<h2 className="text-sm font-bold text-white">Statut Canonique & Univers Étendu (Gaming)</h2>
							<p className="text-xs leading-relaxed text-blue-200/80">
								Les adaptations vidéoludiques constituent des œuvres dérivées officielles supervisées par Shūeisha et Bandai Namco. Leurs scénarios originaux (comme la Police du Temps de <em>Xenoverse</em>, les timelines altérées de <em>Dragon Ball Heroes</em> ou le Mode Histoire de <em>FighterZ</em>) enrichissent la cosmologie globale sans modifier le canon absolu des 42 tomes du manga d&apos;Akira Toriyama.
							</p>
						</div>
					</div>
				</div>

				<GamesExplorer games={games} ratings={ratingsRecord} />
				<ContributeRail className="mt-14" quoiKey="kit.contribute.what.game" />
			</div>
		</>
	);
}

