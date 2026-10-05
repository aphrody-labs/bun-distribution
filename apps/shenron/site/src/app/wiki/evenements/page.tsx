import { Suspense } from "react";
import Link from "next/link";
import { GatedLink } from "@/components/GatedLink";
import { PageHero } from "@/components/PageHero";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DomainBar, ContributeRail } from "@/components/kit";
import { SITE_URL } from "@/lib/config";
import { dbUniverse } from "@/lib/db-universe";
import { NarrativeEventsExplorer } from "@/components/wiki/NarrativeEventsExplorer";
import { WikiPageShell } from "@/components/wiki/WikiPageShell";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { ogMeta } from "@/lib/og";
import { pageHero } from "@/lib/banner-config";
import { JsonLd } from "@/components/JsonLd";

import type { Metadata } from "next";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Événements, Combats & Chronologie de Dragon Ball",
	description:
		"La base de données unifiée des événements, combats d'anthologie, championnats martiaux et repères chronologiques de Dragon Ball, Z, Super, GT et de la Patrouille du Temps (Xenoverse).",
	...ogMeta({
		title: "Événements & Chronologie — Dragon Ball FR",
		description:
			"Explorez tous les affrontements, tournois martiaux et tournants narratifs de l'histoire Dragon Ball, rattachés à leurs sagas, arcs et continuités.",
		canonical: "/wiki/evenements",
		type: "website",
	}),
};

export default async function EvenementsHubPage() {
	const [battles, tournaments, timelineEvents, sagasRes, arcsRes, heroImage] = await Promise.all([
		dbUniverse.battles().then((r) => r ?? []),
		dbUniverse.tournaments().then((r) => r ?? []),
		dbUniverse.timelineEvents().then((r) => r ?? []),
		dbUniverse.sagas().then((r) => r?.sagas ?? []),
		dbUniverse.arcs().then((r) => r?.arcs ?? []),
		pageHero("combats"),
	]);

	const totalEvents = battles.length + tournaments.length + timelineEvents.length;

	return (
		<div>
			<JsonLd
				data={{
					"@context": "https://schema.org",
					"@type": "CollectionPage",
					name: "Événements, Combats & Chronologie de Dragon Ball",
					description:
						"Hub narratif unifié répertoriant combats, tournois et chronologie de Dragon Ball selon les 4 continuités officielles et dérivées.",
					publisher: {
						"@type": "Organization",
						name: "Dragon Ball FR",
						url: SITE_URL,
					},
				} as never}
			/>

			<PageHero
				eyebrow="Chronologie & Archives Narratives Unifiées"
				title="Événements & Combats de Légende"
				lead={`${totalEvents} affrontements majeurs, championnats martiaux et tournants cosmiques répertoriés et rattachés à leurs Sagas et Arcs narratifs respectifs — du manga original aux distorsions de la Patrouille du Temps.`}
				image={heroImage}
				imageAlt="Goku Super Saiyan face à Freezer sur Namek"
			/>

			<WikiPageShell>
				<DomainBar domain="wiki" />
				<div className="flex flex-wrap items-center justify-between gap-4">
					<Breadcrumbs items={[{ label: "Événements & Chronologie" }]} />
					<WikiDrawer />
				</div>

				{/* 4 Continuités Narratives Explicatives */}
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-4 backdrop-blur-md">
						<div className="flex items-center gap-2 font-bold text-amber-300 text-xs uppercase tracking-wider">
							<span>📖</span>
							<span>Canon Manga</span>
						</div>
						<p className="mt-1.5 text-[11px] leading-relaxed text-white/70">
							Les 42 tomes du manga original créés par Akira Toriyama (1984–1995). L&apos;autorité canonique absolue.
						</p>
					</div>

					<div className="rounded-2xl border border-blue-500/30 bg-blue-950/20 p-4 backdrop-blur-md">
						<div className="flex items-center gap-2 font-bold text-blue-300 text-xs uppercase tracking-wider">
							<span>📺</span>
							<span>Toei Animation</span>
						</div>
						<p className="mt-1.5 text-[11px] leading-relaxed text-white/70">
							Séries télévisées animées (DB, DBZ, DBGT, DBS, Daima) incluant les épisodes de transition et arcs originaux.
						</p>
					</div>

					<div className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-4 backdrop-blur-md">
						<div className="flex items-center gap-2 font-bold text-rose-300 text-xs uppercase tracking-wider">
							<span>🎬</span>
							<span>Films DBZ Hors-Série</span>
						</div>
						<p className="mt-1.5 text-[11px] leading-relaxed text-white/70">
							Les 13 longs-métrages cinéma d&apos;époque (Broly, Cooler, Bojack, Janemba) situés en mondes parallèles.
						</p>
					</div>

					<div className="rounded-2xl border border-purple-500/40 bg-purple-950/30 p-4 backdrop-blur-md ring-1 ring-purple-500/30">
						<div className="flex items-center gap-2 font-bold text-purple-300 text-xs uppercase tracking-wider">
							<span>⚡</span>
							<span>Time Patrol / Multivers</span>
						</div>
						<p className="mt-1.5 text-[11px] leading-relaxed text-purple-200/80">
							Altérations temporelles Xenoverse et Heroes supervisées par la Patrouille du Temps, isolées du canon.
						</p>
					</div>
				</div>

				<Suspense
					fallback={
						<div className="p-8 text-center text-xs text-white/50">
							Chargement de la matrice des événements narratifs...
						</div>
					}
				>
					<NarrativeEventsExplorer
						battles={battles}
						tournaments={tournaments}
						timelineEvents={timelineEvents}
						sagas={sagasRes}
						arcs={arcsRes}
						fallbackImage={heroImage}
					/>
				</Suspense>

				{/* Passerelles d'interconnexion wiki */}
				<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6">
					<GatedLink
						href="/wiki/sagas"
						className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/40 p-4 transition-colors hover:border-amber-500/40 hover:bg-amber-950/20"
					>
						<span className="text-2xl">📜</span>
						<div>
							<div className="text-xs font-bold text-white">Chronologie des Sagas</div>
							<div className="text-[11px] text-white/50">De Pilaf au 28e Tenkaichi Budokai &amp; Daima</div>
						</div>
					</GatedLink>

					<GatedLink
						href="/wiki/arcs"
						className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/40 p-4 transition-colors hover:border-orange-500/40 hover:bg-orange-950/20"
					>
						<span className="text-2xl">⚔️</span>
						<div>
							<div className="text-xs font-bold text-white">Index des Arcs Narratifs</div>
							<div className="text-[11px] text-white/50">Découpage précis de chaque cycle de combat</div>
						</div>
					</GatedLink>

					<Link
						href="/wiki/chronologie"
						className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/40 p-4 transition-colors hover:border-cyan-500/40 hover:bg-cyan-950/20"
					>
						<span className="text-2xl">⏳</span>
						<div>
							<div className="text-xs font-bold text-white">Frise Chronologique (Âges)</div>
							<div className="text-[11px] text-white/50">Datation universelle officielle en Âges</div>
						</div>
					</Link>
				</div>

				<ContributeRail quoiKey="kit.contribute.what.battle" />
			</WikiPageShell>
		</div>
	);
}
