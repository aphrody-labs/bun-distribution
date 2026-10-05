/**
 * Corps partagé de la page Actualités — rendu par `/news` (page 1) ET par
 * `/news/page/[n]` (pages suivantes).
 *
 * Deux décisions structurent ce fichier :
 *
 *  1. **Une seule page d'actualité.** Les parutions de la rédaction tiennent la
 *     tête de page — ce sont elles qui se lisent — et les dernières discussions
 *     suivent, avec le chemin vers le fil complet (`/news/fil`). Le flux des
 *     révisions du wiki, un temps présenté ici, a été retiré du public le
 *     2026-09-12 : il racontait la fabrication du site.
 *
 *  2. **Pourquoi deux routes plutôt qu'un `?page=`** : lire `searchParams` rend
 *     une page dynamique sous Next 16 (`cache-control: private, no-store`), même
 *     avec `export const revalidate`. L'index des actualités — la page la plus
 *     crawlée après la home — était donc recalculé à chaque visite et jamais mis
 *     en cache CDN. Segmenter la pagination en routes statiques rend les deux
 *     prérendables.
 */
import Link from "next/link";
import { cache } from "react";
import { desc } from "drizzle-orm";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { db } from "@/lib/db";
import { posts as postsTable } from "@/db/schema";
import { publicPostFilter } from "@/lib/posts";
import { countCommentsBatch, reactionCounts } from "@/lib/social";
import { listFeed, feedHref, FEED_FILTER_LABELS, FEED_FILTERS } from "@/lib/feed";
import { DISCORD_INVITE } from "@/lib/config";
import { AdUnit } from "@/components/ads/AdUnit";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FeedStream } from "@/components/feed/FeedStream";
import {
	CardGrid,
	Chip,
	ChipRow,
	DomainBar,
	EmptyState,
	LinkPager,
	MangaCard,
	SocialCounts,
	PageShell,
	SectionHeading,
	Stack,
	TabNav,
} from "@/components/kit";
import { T } from "@/components/T";

const POSTS_PER_PAGE = 12;
/** Événements du fil montrés en bas de l'index (aperçu, pas la liste complète). */
const FEED_PREVIEW = 8;

/** URL canonique d'une page du journal (page 1 = la racine, jamais `/page/1`). */
export const journalHref = (p: number) => (p <= 1 ? "/news" : `/news/page/${p}`);

/**
 * Nombre d'articles en ligne. Mémoïsé par `cache()` : la page `/news` (qui
 * calcule le `rel="next"`) et `JournalIndex` (qui affiche le total) le
 * demandaient chacune de leur côté, soit deux `COUNT` identiques par rendu.
 */
const comptePublies = cache(async (): Promise<number> => db.$count(postsTable, publicPostFilter()));

/** Nombre total de pages publiées — sert aussi à `generateStaticParams`. */
export async function journalPageCount(): Promise<number> {
	const total = await comptePublies();
	return Math.max(1, Math.ceil(total / POSTS_PER_PAGE));
}

export async function JournalIndex({ page }: { page: number }) {
	const offset = (page - 1) * POSTS_PER_PAGE;
	const visible = publicPostFilter();

	const [rows, totalCount, allTags, feed] = await Promise.all([
		// Colonnes explicites : la sélection par défaut rapatriait le corps entier
		// des 12 articles (`body`, `contentJson`, `contentHtml`) pour n'afficher
		// qu'un titre, un chapô et une vignette. Idem pour l'auteur, dont seuls le
		// pseudo et l'avatar sont écrits.
		db.query.posts.findMany({
			where: visible,
			orderBy: [desc(postsTable.publishedAt)],
			limit: POSTS_PER_PAGE,
			offset,
			columns: {
				id: true,
				slug: true,
				title: true,
				excerpt: true,
				cover: true,
				coverAlt: true,
				publishedAt: true,
				readingMinutes: true,
				tags: true,
				featured: true,
			},
			with: { author: { columns: { username: true, avatar: true } } },
		}),
		comptePublies(),
		// Thèmes réellement utilisés par les articles en ligne (pas de liste figée
		// qui pointerait vers des pages vides).
		db.select({ tags: postsTable.tags }).from(postsTable).where(visible).limit(300),
		// L'aperçu du fil n'a de sens qu'en page 1 : en page 2, le lecteur pagine
		// les archives, il ne regarde pas l'activité du jour.
		page === 1
			? listFeed({ page: 1, perPage: FEED_PREVIEW }).catch(() => null)
			: Promise.resolve(null),
	]);

	const totalPages = Math.max(1, Math.ceil(totalCount / POSTS_PER_PAGE));

	// Compteurs sociaux du lot affiché — deux requêtes pour douze cartes.
	const ids = rows.map((r) => r.id);
	const [likes, comments] = await Promise.all([
		reactionCounts("post", ids).catch(() => new Map<string, number>()),
		countCommentsBatch("post", ids).catch(() => new Map<string, number>()),
	]);

	// La une n'apparaît que sur la première page : en page 2, elle serait un
	// doublon décoratif d'un article déjà vu.
	const [lead, ...rest] =
		page === 1 ? pickLead(rows) : [null as (typeof rows)[number] | null, ...rows];

	const tagCounts = new Map<string, number>();
	for (const r of allTags) {
		for (const t of r.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
	}
	const topTags = [...tagCounts.entries()].toSorted((a, b) => b[1] - a[1]).slice(0, 10);

	return (
		<PageShell rhythm="loose">
			<Breadcrumbs
				className="mb-8"
				items={[
					{ label: "Actualités", href: "/news" },
					...(page > 1 ? [{ label: `Page ${page}` }] : []),
				]}
			/>

			{/* Pont staff → back-office : un rédacteur qui relit l'index ouvre l'écran
			    de gestion sans repasser par la sidebar d'administration. */}
			<DomainBar domain="news" className="mb-8" actions={[{ href: "/admin/posts/new", label: "Écrire un article" }]} />

			<SectionHeading
				level={1}
				kicker={<T k="news.index.kicker" />}
				title={<T k="news.index.title" />}
				standfirst={<T k="news.index.standfirst" />}
				actions={
					<>
						<Link href={feedHref("tout")} className="toriyama-btn !text-[0.75rem]">
							<T k="news.index.viewFeed" />
						</Link>
						<a href="/news/rss.xml" className="toriyama-btn-secondary !text-[0.75rem]">
							<T k="news.index.rss" />
						</a>
					</>
				}
			/>

			<p className="mt-4 font-display text-[0.6875rem] uppercase tracking-[0.12em] text-white/40">
				{totalCount} article{totalCount > 1 ? "s" : ""} publié{totalCount > 1 ? "s" : ""}
			</p>

			{topTags.length > 0 && (
				<ChipRow className="mt-6">
					{topTags.map(([tag, count]) => (
						<Chip key={tag} href={`/news/theme/${encodeURIComponent(tag.toLowerCase())}`}>
							{tag} <span className="opacity-50">{count}</span>
						</Chip>
					))}
				</ChipRow>
			)}

			<Stack className="mt-12">
				{/* État vide sans onomatopée décorative : il dit ce qui manque et où
				    aller, il ne le meuble pas. */}
				{rows.length === 0 ? (
					<EmptyState
						title="Aucun article publié"
						description="La rédaction n'a encore rien mis en ligne. Le wiki, lui, est là : le manga, les épisodes et les films se parcourent dès maintenant."
						actions={[
							{ href: "/wiki/manga", label: "Lire le manga" },
							{ href: "/wiki", label: "Explorer le wiki" },
							{ href: DISCORD_INVITE, label: "Rejoindre le Discord", external: true },
						]}
					/>
				) : (
					<section>
						{lead && (
							<LeadArticle
								post={lead}
								likes={likes.get(lead.id) ?? 0}
								comments={comments.get(lead.id) ?? 0}
							/>
						)}

						{rest.length > 0 && (
							<CardGrid className={lead ? "mt-10" : ""}>
								{rest.map((post) => (
									<MangaCard
										key={post.id}
										href={`/news/${post.slug}`}
										title={post.title}
										badge="Article"
										excerpt={post.excerpt}
										image={post.cover}
										imageAlt={post.coverAlt}
										ratio="wide"
										meta={
											<>
												{post.publishedAt && (
													<time dateTime={post.publishedAt.toISOString()}>
														{format(post.publishedAt, "d MMM yyyy", { locale: fr })}
													</time>
												)}
												<span aria-hidden>·</span>
												<span>{post.readingMinutes} min</span>
											</>
										}
										footer={
											<SocialCounters
												likes={likes.get(post.id) ?? 0}
												comments={comments.get(post.id) ?? 0}
											/>
										}
									/>
								))}
							</CardGrid>
						)}

						{/* Bannière display en bas de liste — au-dessus de la pagination,
						    donc jamais confondue avec un article de la grille. */}
						<AdUnit placement="display" className="mt-14" />

						<LinkPager className="mt-12" page={page} pages={totalPages} href={journalHref} />
					</section>
				)}

				{/* ---- Le fil unifié ------------------------------------------------- */}
				{feed && feed.entries.length > 0 && (
					<section aria-labelledby="fil-actualite">
						<SectionHeading
							id="fil-actualite"
							kicker="En direct"
							title="Les dernières discussions"
							standfirst="Les dernières discussions de la communauté. Le fil complet vit sur sa propre page."
							actions={
								<Link href={feedHref("tout")} className="toriyama-btn-secondary !text-[0.75rem]">
									Tout le fil →
								</Link>
							}
						/>
						<TabNav
							className="mt-6"
							items={FEED_FILTERS.map((f) => ({
								href: feedHref(f),
								label: FEED_FILTER_LABELS[f],
							}))}
							active="/news"
							ariaLabel="Onglets du fil"
						/>
						<div className="mt-6">
							<FeedStream entries={feed.entries} />
						</div>
					</section>
				)}
			</Stack>
		</PageShell>
	);
}

/** Remonte l'article « à la une » en tête, à défaut le plus récent. */
function pickLead<T extends { featured: boolean }>(rows: T[]): [T | null, ...T[]] {
	if (rows.length === 0) return [null];
	const idx = rows.findIndex((r) => r.featured);
	const i = idx === -1 ? 0 : idx;
	return [rows[i], ...rows.slice(0, i), ...rows.slice(i + 1)];
}

type PostRow = {
	id: string;
	slug: string;
	title: string;
	excerpt: string;
	cover: string | null;
	coverAlt: string | null;
	publishedAt: Date | null;
	readingMinutes: number;
	tags: string[];
	author: { username: string; avatar: string | null } | null;
};

/** Compteurs de la carte — `SocialCounts` du kit, avec le même texte vide. */
function SocialCounters({ likes, comments }: { likes: number; comments: number }) {
	return <SocialCounts likes={likes} comments={comments} emptyLabel="Premier commentaire à écrire" />;
}

/** La une : carte large, vignette prioritaire (c'est l'image LCP de la page). */
function LeadArticle({
	post,
	likes,
	comments,
}: {
	post: PostRow;
	likes: number;
	comments: number;
}) {
	return (
		<MangaCard
			href={`/news/${post.slug}`}
			title={post.title}
			badge="À la une"
			excerpt={post.excerpt}
			image={post.cover}
			imageAlt={post.coverAlt}
			ratio="wide"
			priority
			sizes="(max-width: 1024px) 100vw, 1100px"
			className="lg:grid lg:grid-cols-[1.15fr_1fr] lg:items-stretch [&>a]:lg:h-full [&>a_div]:lg:h-full [&>a_div]:lg:aspect-auto"
			meta={
				<>
					{post.author?.username && <span>{post.author.username}</span>}
					{post.publishedAt && (
						<time dateTime={post.publishedAt.toISOString()}>
							{format(post.publishedAt, "d MMMM yyyy", { locale: fr })}
						</time>
					)}
					<span aria-hidden>·</span>
					<span>{post.readingMinutes} min</span>
				</>
			}
			footer={<SocialCounters likes={likes} comments={comments} />}
		/>
	);
}
