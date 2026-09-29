import { Suspense } from "react";
import { PageHero } from "@/components/PageHero";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DomainBar, ContributeRail } from "@/components/kit";
import { dbUniverse } from "@/lib/db-universe";
import { NarrativeEventsExplorer } from "@/components/wiki/NarrativeEventsExplorer";
import { WikiPageShell } from "@/components/wiki/WikiPageShell";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { ogMeta } from "@/lib/og";
import { pageHero } from "@/lib/banner-config";
import type { Metadata } from "next";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Les Combats & Événements Légendaires Dragon Ball",
	description:
		"La base de données unifiée des combats, tournois et affrontements historiques de Dragon Ball, Z, Super et des films. Participants, vainqueurs, techniques et canon.",
	...ogMeta({
		title: "Combats & Événements Légendaires — Dragon Ball FR",
		description:
			"Tous les affrontements du manga et de l'univers Dragon Ball : Goku vs Vegeta, Gohan vs Cell, Goku vs Freezer, tournois martiaux et chronologie.",
		canonical: "/wiki/combats",
		type: "website",
	}),
};

import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default async function CombatsPage() {
	const [battles, tournaments, timelineEvents, sagasRes, arcsRes, heroImage] = await Promise.all([
		dbUniverse.battles().then((r) => r ?? []),
		dbUniverse.tournaments().then((r) => r ?? []),
		dbUniverse.timelineEvents().then((r) => r ?? []),
		dbUniverse.sagas().then((r) => r?.sagas ?? []),
		dbUniverse.arcs().then((r) => r?.arcs ?? []),
		pageHero("combats"),
	]);

	const totalEvents = battles.length + tournaments.length;

	return (
		<div>
			<PageHero
				eyebrow="Encyclopédie & Archives Narratives"
				title="Combats & Événements Légendaires"
				lead={`${totalEvents} affrontements majeurs, championnats martiaux et tournants historiques répertoriés avec rigueur canonique — du 21e Tenkaichi Budokai au Tournoi du Pouvoir.`}
				image={heroImage}
				imageAlt="Goku Super Saiyan face à Freezer sur Namek"
			/>

			<WikiPageShell>
				<DomainBar domain="wiki" />
				<div className="flex flex-wrap items-center justify-between gap-4">
					<Breadcrumbs items={[{ label: "Combats & Événements" }]} />
					<WikiDrawer />
				</div>

				{/* Passerelle unifiée vers /wiki/evenements */}
				<div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-orange-500/30 bg-gradient-to-r from-orange-950/40 via-black/60 to-purple-950/40 p-4 sm:p-5 backdrop-blur-xl">
					<div className="flex items-center gap-3">
						<span className="text-2xl">⚡</span>
						<div>
							<h3 className="text-sm font-bold text-white">
								Espace Central « Événements, Combats &amp; Chronologie »
							</h3>
							<p className="text-xs text-white/70">
								Retrouvez la chronologie globale rattachée aux Sagas, Arcs narratifs et lignes temporelles (Canon, Toei, Films, Xenoverse).
							</p>
						</div>
					</div>
					<Link
						href="/wiki/evenements"
						className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-orange-500 shadow-md shadow-orange-950/40"
					>
						<span>Voir la vue Chronologique Complète</span>
						<ArrowRight className="h-4 w-4" />
					</Link>
				</div>

				<div className="rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-950/20 via-black/40 to-transparent p-5 backdrop-blur-md">
					<div className="flex items-center gap-3">
						<span className="text-2xl">🥋</span>
						<div>
							<h2 className="text-sm font-bold text-white">Doctrine Canonique &amp; Matrice Narratologique</h2>
							<p className="text-xs leading-relaxed text-amber-200/80">
								Chaque affrontement et tournoi est répertorié d&apos;après les 42 tomes du manga d&apos;Akira Toriyama et la continuité officielle supervisée. Les techniques, les vainqueurs et les issues tactiques respectent scrupuleusement la vérité de l&apos;œuvre originale.
							</p>
						</div>
					</div>
				</div>

				<Suspense fallback={<div className="p-8 text-center text-xs text-white/50">Chargement des événements narratifs...</div>}>
					<NarrativeEventsExplorer
						battles={battles}
						tournaments={tournaments}
						timelineEvents={timelineEvents}
						sagas={sagasRes}
						arcs={arcsRes}
						fallbackImage={heroImage}
					/>
				</Suspense>

				<ContributeRail quoiKey="kit.contribute.what.battle" />
			</WikiPageShell>
		</div>
	);
}
