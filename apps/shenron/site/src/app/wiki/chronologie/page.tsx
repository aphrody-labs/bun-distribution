import { DomainBar, PageShell } from "@/components/kit";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import type { Metadata } from "next";
import { pageHero } from "@/lib/banner-config";
import { dbUniverse } from "@/lib/db-universe";
import { getChronologyConfig } from "@/lib/chronology-config";
import { applyChronology } from "@/lib/chronology";
import { Billboard } from "@/components/stream/Billboard";
import { ChronologieTabs } from "@/components/wiki/ChronologieTabs";
import { ChronologyAtlas } from "@/components/wiki/ChronologyAtlas";
import { ogMeta } from "@/lib/og";
import { JsonLd } from "@/components/JsonLd";
import { SITE_URL } from "@/lib/config";
import type { ItemList, WithContext } from "schema-dts";

// ISR et non `force-dynamic`. Le rendu dynamique coûtait 3 requêtes PG (~750
// lignes) + le rendu de toute la frise À CHAQUE VISITE : ~575 ms de TTFB, zéro
// cache CDN, sur une page publique et immuable entre deux éditions admin.
//
// Les deux raisons qui avaient motivé `force-dynamic` sont traitées autrement :
//   1. fraîcheur de la curation → `/api/chronologie-config` (PUT) appelle déjà
//      `revalidatePath("/wiki/chronologie")` : la purge est immédiate à
//      l'enregistrement, la revalidation périodique n'est qu'un filet ;
//   2. 404 figé par un build lancé pendant une indispo DB → on ne renvoie PLUS
//      `notFound()` sur dataset vide/injoignable. On rend un état dégradé
//      `noindex` qui se répare tout seul à la revalidation suivante (cf. plus bas).
export const revalidate = 300;

export const metadata: Metadata = {
	title: "Chronologie universelle",
	description:
		"La chronologie officielle de Dragon Ball : TOUS les épisodes, TOUS les films et les tomes du manga — Dragon Ball, Z, GT, Super, Daima — réunis sur une seule frise, dans l'ordre validé par l'équipe. Filtre par ère, recherche et exporte.",
	...ogMeta({
		title: "Chronologie universelle Dragon Ball — épisodes, films & manga",
		description:
			"Tous les épisodes, films et tomes du manga (DB, DBZ, GT, Super, Daima) sur une frise unique et officielle. Filtre par ère, recherche et exporte.",
		type: "website",
		canonical: "/wiki/chronologie",
	}),
};

export default async function ChronologiePage() {
	const [raw, config, ageEvents, sagasData, arcsData, databooksData] = await Promise.all([
		dbUniverse.timeline(),
		getChronologyConfig(),
		dbUniverse.timelineEvents(),
		dbUniverse.sagas(),
		dbUniverse.arcs(),
		dbUniverse.databooks({ order: "asc" }),
	]);

	// Frise FIXE : la curation admin (ordre, ère, date, masquage, notes) est
	// appliquée côté serveur → le public reçoit la chronologie officielle résolue.
	const items = raw && raw.length > 0 ? applyChronology(raw, config) : [];
	if (items.length === 0) return <ChronologieUnavailable />;

	const episodes = items.filter((i) => i.kind === "episode").length;
	const movies = items.filter((i) => i.kind === "movie").length;
	const manga = items.length - episodes - movies;

	// Balisage `ItemList` de la frise : sans lui, la chronologie n'était pour un
	// moteur (ou un agent) qu'une longue page de liens sans ordre déclaré — alors
	// que L'ORDRE est précisément ce que la page apporte. On borne à 200 entrées :
	// au-delà, le JSON-LD pèse plus que le HTML et Google ne lit pas la queue.
	const jsonLd: WithContext<ItemList> = {
		"@context": "https://schema.org",
		"@type": "ItemList",
		name: "Chronologie universelle Dragon Ball",
		description: "Ordre officiel de lecture et de visionnage : épisodes, films et tomes du manga.",
		numberOfItems: items.length,
		itemListOrder: "https://schema.org/ItemListOrderAscending",
		itemListElement: items.slice(0, 200).map((it, i) => ({
			"@type": "ListItem" as const,
			position: i + 1,
			name: it.title,
			url: `${SITE_URL}${it.href}`,
		})),
	};

	return (
		<>
			<JsonLd data={jsonLd} />
			<Billboard
				backdrop={await pageHero("chronologie")}
				eyebrow="Frise universelle"
				title="Chronologie complète"
				meta={[
					`${items.length} entrées`,
					`${episodes} épisodes`,
					`${movies} films`,
					manga > 0 ? `${manga} tomes` : null,
					`${ageEvents?.length ?? 0} repères d'âges`,
				]}
				synopsis="Tous les épisodes, tous les films et les tomes du manga — de Dragon Ball à Daima — réunis sur une seule frise officielle, complétée par la chronologie diégétique officielle des Âges (Daizenshuu 7)."
				primaryHref={items[0]!.href}
				primaryLabel="Commencer la frise"
				secondaryHref="/wiki/episodes"
				secondaryLabel="Les épisodes"
			/>
			<ChronologyAtlas
				episodes={episodes}
				movies={movies}
				sagas={sagasData?.sagas ?? []}
				arcs={arcsData?.arcs ?? []}
				databooks={databooksData?.items ?? []}
			/>
			<div id="frise" className="wiki-container scroll-mt-24">
				<DomainBar domain="chronologie" className="mb-6" />
				<div className="flex flex-wrap items-center justify-between gap-4 mb-8">
					<Breadcrumbs items={[{ label: "Chronologie" }]} />
					<WikiDrawer />
				</div>
				<ChronologieTabs mediaItems={items} ageEvents={ageEvents ?? []} />
			</div>
		</>
	);
}

/**
 * État dégradé : dataset vide ou base injoignable au moment du (pré)rendu.
 *
 * Volontairement un 200 `noindex` et non un `notFound()` : sous ISR, un 404 rendu
 * pendant une panne PG resterait servi jusqu'à expiration du cache, alors que la
 * frise, elle, est revenue. Ici la page se répare d'elle-même à la revalidation
 * suivante, et `noindex` empêche Google de mémoriser la version vide entre-temps.
 * (React 19 remonte `<meta>` dans le `<head>` où qu'il soit rendu.)
 */
function ChronologieUnavailable() {
	return (
		<PageShell width="prose" rhythm="loose" className="text-center">
			<meta name="robots" content="noindex, follow" />
			<h1 className="font-display text-3xl font-bold text-white">Chronologie universelle</h1>
			<p className="mt-4 text-white/60">
				La frise est momentanément indisponible. Elle revient d'elle-même d'ici quelques minutes.
			</p>
			<div className="mt-8 flex flex-wrap items-center justify-center gap-3">
				<Link href="/wiki/episodes" className="dbz-button !text-xs">
					Les épisodes
				</Link>
				<Link href="/wiki/films" className="dbz-button-ghost !text-xs">
					Les films
				</Link>
			</div>
		</PageShell>
	);
}
