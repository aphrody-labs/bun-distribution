import type { Metadata } from "next";
import { dbUniverse } from "@/lib/db-universe";
import { PageHero } from "@/components/PageHero";
import { TournamentsGrid } from "@/components/wiki/TournamentsGrid";
import { WikiPageShell } from "@/components/wiki/WikiPageShell";
import { DomainBar, ContributeRail } from "@/components/kit";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { ogMeta } from "@/lib/og";
import { pageHero } from "@/lib/banner-config";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Tournois d'Arts Martiaux de Dragon Ball",
	description:
		"Tous les tournois canoniques de Dragon Ball : Tenkaichi Budōkai (21e, 22e, 23e, 24e, 25e, 28e), Cell Game, Tournoi de l'Autre Monde et Tournoi du Pouvoir.",
	...ogMeta({
		title: "Tournois d'Arts Martiaux — Encyclopédie Dragon Ball",
		description:
			"Règles officielles, tableaux de combats, finalistes et vainqueurs de tous les championnats du monde et tournois divins de Dragon Ball.",
		type: "website",
		canonical: "/wiki/tournois",
	}),
};

import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default async function TournamentsIndexPage() {
	const tournaments = (await dbUniverse.tournaments()) ?? [];
	const heroImage = await pageHero("tournois");

	return (
		<div>
			<PageHero
				eyebrow="Encyclopédie"
				title="Tournois & Championnats d'Arts Martiaux"
				lead="Du mythique Tenkaichi Budōkai de l'île Papaye à la bataille d'anéantissement cosmique du Tournoi du Pouvoir, revivez les plus grandes compétitions martiales de la franchise."
				image={heroImage}
				imageAlt="Les guerriers de Dragon Ball Z"
			/>

			<WikiPageShell>
				<DomainBar domain="wiki" />
				<div className="flex flex-wrap items-center justify-between gap-4">
					<Breadcrumbs items={[{ label: "Tournois & Championnats" }]} />
					<WikiDrawer />
				</div>

				{/* Passerelle unifiée vers /wiki/evenements */}
				<div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-orange-500/30 bg-gradient-to-r from-orange-950/40 via-black/60 to-purple-950/40 p-4 sm:p-5 backdrop-blur-xl">
					<div className="flex items-center gap-3">
						<span className="text-2xl">🥋</span>
						<div>
							<h3 className="text-sm font-bold text-white">
								Espace Central « Événements, Combats &amp; Chronologie »
							</h3>
							<p className="text-xs text-white/70">
								Consultez les tournois rattachés aux cycles narratifs complets et aux continuités canoniques et dérivées (Tenkaichi, Cell Game, Tournoi du Pouvoir, Toki Toki).
							</p>
						</div>
					</div>
					<Link
						href="/wiki/evenements?type=tournaments"
						className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-orange-500 shadow-md shadow-orange-950/40"
					>
						<span>Voir tous les Tournois &amp; Combats</span>
						<ArrowRight className="h-4 w-4" />
					</Link>
				</div>
				<div className="rounded-2xl border border-white/10 bg-gradient-to-r from-amber-950/20 via-black/40 to-transparent p-5 backdrop-blur-md">
					<div className="flex items-center gap-3">
						<span className="text-2xl">🥋</span>
						<div>
							<h2 className="text-sm font-bold text-white">Règles & Palmarès Canoniques</h2>
							<p className="text-xs text-white/60">
								Chaque tournoi liste les vainqueurs officiels, les finalistes, les règles de combat et le dénouement des matchs capitaux selon le manga original et <em>Dragon Ball Super</em>.
							</p>
						</div>
					</div>
				</div>

				<TournamentsGrid tournaments={tournaments} fallbackImage={heroImage} />
				<ContributeRail quoiKey="kit.contribute.what.tournament" />
			</WikiPageShell>
		</div>
	);
}
