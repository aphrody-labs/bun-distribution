/**
 * /news/fil — le fil d'actualité unifié, une URL par onglet et par page.
 *
 * Deux natures d'événements publics : les parutions de la rédaction et les
 * discussions. Les révisions du wiki et les contributions relues ont été
 * retirées du fil public le 2026-09-12 — elles racontaient la fabrication du
 * site plutôt que Dragon Ball.
 *
 * **Pourquoi un catch-all plutôt qu'un `?filter=`** : lire `searchParams` rend la
 * page dynamique sous Next 16 (`private, no-store`), même avec `revalidate`. Le
 * fil — une des pages les plus rafraîchies du site — serait recalculé à chaque
 * visite et jamais mis en cache CDN. Ici chaque combinaison onglet/page est une
 * route prérendable :
 *
 *     /news/fil                     → tout, page 1
 *     /news/fil/page/2              → tout, page 2
 *     /news/fil/discussions         → onglet discussions, page 1
 *     /news/fil/discussions/page/3  → onglet discussions, page 3
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FeedStream } from "@/components/feed/FeedStream";
import { EmptyState, LinkPager, PageShell, SectionHeading, StatTiles, TabNav } from "@/components/kit";
import { DISCORD_INVITE } from "@/lib/config";
import {
	FEED_FILTERS,
	FEED_FILTER_LABELS,
	feedCounters,
	feedHref,
	isFeedFilter,
	listFeed,
	type FeedFilter,
} from "@/lib/feed";

export const revalidate = 60;
export const dynamicParams = true;

/** Segments reconnus : `[]`, `[filter]`, `["page", n]`, `[filter, "page", n]`. */
function parseSegments(segments: string[] | undefined): { filter: FeedFilter; page: number } | null {
	const parts = segments ?? [];
	if (parts.length === 0) return { filter: "tout", page: 1 };

	let filter: FeedFilter = "tout";
	let rest = parts;
	if (isFeedFilter(parts[0])) {
		// `/news/fil/tout` serait un doublon de `/news/fil` : forme canonique unique.
		if (parts[0] === "tout") return null;
		filter = parts[0];
		rest = parts.slice(1);
	}

	if (rest.length === 0) return { filter, page: 1 };
	if (rest.length !== 2 || rest[0] !== "page") return null;
	// `/page/01` ou `/page/1` créeraient des doublons : entier canonique ≥ 2 seul.
	if (!/^[1-9][0-9]*$/.test(rest[1]!)) return null;
	const page = Number(rest[1]);
	if (page < 2) return null;
	return { filter, page };
}

/** Onglets prérendus : la page 1 de chaque nature. Les pages suivantes sont ISR. */
export function generateStaticParams(): Array<{ path: string[] }> {
	return FEED_FILTERS.filter((f) => f !== "tout").map((f) => ({ path: [f] }));
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ path?: string[] }>;
}): Promise<Metadata> {
	const parsed = parseSegments((await params).path);
	if (!parsed) return {};
	const { filter, page } = parsed;
	const label = FEED_FILTER_LABELS[filter];
	const suffix = page > 1 ? ` — page ${page}` : "";
	return {
		title:
			filter === "tout"
				? `Fil d'actualité Dragon Ball${suffix}`
				: `Fil — ${label}${suffix}`,
		description:
			"Les parutions de la rédaction et les discussions de la communauté, dans l'ordre où elles arrivent.",
		alternates: { canonical: feedHref(filter, page) },
		// Les pages 2+ existent pour la découverte, pas pour ranker : `follow` seul
		// suffit à faire crawler les liens qu'elles contiennent.
		robots: page > 1 ? { index: false, follow: true } : undefined,
	};
}

export default async function FeedPage({ params }: { params: Promise<{ path?: string[] }> }) {
	const parsed = parseSegments((await params).path);
	if (!parsed) notFound();
	const { filter, page } = parsed;

	const [data, counters] = await Promise.all([
		listFeed({ filter, page }),
		feedCounters().catch(() => null),
	]);

	if (page > 1 && data.entries.length === 0) notFound();

	const tabs = FEED_FILTERS.map((f) => ({
		href: feedHref(f),
		label: FEED_FILTER_LABELS[f],
	}));

	return (
		<PageShell rhythm="loose">
			<Breadcrumbs
				className="mb-8"
				items={[
					{ label: "Actualités", href: "/news" },
					{ label: "Fil", href: "/news/fil" },
					...(filter === "tout" ? [] : [{ label: FEED_FILTER_LABELS[filter] }]),
					...(page > 1 ? [{ label: `Page ${page}` }] : []),
				]}
			/>

			<SectionHeading
				level={1}
				kicker="Dragon Ball France"
				title="Le fil"
				standfirst="Les parutions de la rédaction et les discussions de la communauté, dans l'ordre où elles arrivent."
				actions={
					<a
						href="/news/rss.xml"
						className="toriyama-btn-secondary !text-[0.75rem]"
						title="Flux RSS des articles"
					>
						Flux RSS
					</a>
				}
			/>

			{/* Compteurs de CONTENU, pas d'activité interne : le nombre de révisions
			    du wiki et de contributions relues appartient aux écrans d'équipe. */}
			{counters && (
				<StatTiles
					className="mt-8"
					items={[
						{ label: "Articles", value: counters.articles, href: "/news" },
						{ label: "Messages", value: counters.discussions, href: feedHref("discussions") },
					]}
				/>
			)}

			<TabNav className="mt-8" items={tabs} active={feedHref(filter)} ariaLabel="Nature des événements" />

			<div className="mt-8">
				{data.entries.length === 0 ? (
					<EmptyState
						title="Rien à afficher pour l'instant"
						description="Cet onglet se remplira dès la première publication. En attendant, le wiki et le journal sont déjà là."
						actions={[
							{ href: "/news", label: "Lire le journal" },
							{ href: "/wiki", label: "Explorer le wiki" },
							{ href: DISCORD_INVITE, label: "Rejoindre le Discord", external: true },
						]}
					/>
				) : (
					<FeedStream entries={data.entries} />
				)}
			</div>

			<LinkPager
				className="mt-12"
				page={page}
				pages={data.hasMore ? Math.max(data.pages, page + 1) : data.pages}
				href={(p) => feedHref(filter, p)}
			/>
		</PageShell>
	);
}
