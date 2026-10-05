import { db } from "@/lib/db";
import { posts as postsTable } from "@/db/schema";
import { and, desc, eq, ne } from "drizzle-orm";
import { cache } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { dateCourte, dateLongue } from "@/lib/dates";
import type { Metadata } from "next";
import type { Article, WithContext } from "schema-dts";

import { JsonLd } from "@/components/JsonLd";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdUnit } from "@/components/ads/AdUnit";
import { SITE_URL } from "@/lib/config";
import { assetUrl } from "@/lib/assets";
import { headingsFromHtml, publicPostFilter } from "@/lib/posts";
import { listComments, reactionState } from "@/lib/social";
import { CommentThread } from "@/components/social/CommentThread";
import { LikeButton } from "@/components/social/LikeButton";
import { DomainBar, PageShell } from "@/components/kit";
import { ReadingProgress } from "./ReadingProgress";

export const revalidate = 300;

/**
 * OBLIGATOIRE pour le cache : sous Next 16, une route à segment dynamique sans
 * `generateStaticParams` est rendue dynamiquement (`no-store`) malgré
 * `revalidate` — cf. le piège documenté dans CLAUDE.md.
 */
export async function generateStaticParams() {
	const rows = await db
		.select({ slug: postsTable.slug })
		.from(postsTable)
		.where(publicPostFilter());
	return rows.map((r) => ({ slug: r.slug }));
}

/**
 * Charge un article visible publiquement (brouillons et programmés exclus).
 *
 * Mémoïsé par `cache()` : `generateMetadata` et le composant de page demandent
 * le MÊME article dans le même rendu. Sans mémoïsation, la requête — article
 * complet + auteur + tous les commentaires — était exécutée deux fois par page
 * générée, à chaque revalidation ISR comme à chaque build.
 *
 * Les colonnes d'auteur sont restreintes à ce qui est réellement affiché : la
 * relation `true` ramenait toute la ligne `User` (dont `discordId` et
 * `roleAdmin`) pour n'en écrire que le pseudo et l'avatar.
 */
const getPost = cache(async (slug: string) => {
	return db.query.posts.findFirst({
		where: and(eq(postsTable.slug, slug), publicPostFilter()),
		with: {
			author: { columns: { username: true, avatar: true } },
		},
	});
});

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const { slug } = await params;
	const post = await getPost(slug);
	if (!post) return { title: "Article introuvable" };

	// `assetUrl` d'abord : une couverture téléversée à l'admin est un chemin brut
	// (`./assets/wiki/articles/…`), servi par l'hôte d'assets et non par le site.
	const absolute = (u: string | null) => {
		const url = assetUrl(u);
		return url ? (url.startsWith("http") ? url : new URL(url, SITE_URL).toString()) : undefined;
	};
	// Déclarer `openGraph` sur une page REMPLACE l'objet hérité du layout, carte de
	// marque comprise (fait mesuré, cf. `lib/og.ts`) : un article sans couverture ni
	// `ogImage` partait donc sur Discord ou X sans la moindre vignette. On pointe
	// explicitement la carte générée par `app/opengraph-image.tsx` (1200×630).
	const social = absolute(post.ogImage ?? post.cover) ?? `${SITE_URL}/opengraph-image`;
	const description = post.seoDescription ?? post.excerpt;

	return {
		title: post.seoTitle ?? post.title,
		description,
		// Une canonique externe n'est posée que si l'article est republié depuis
		// ailleurs ; sinon la page est sa propre référence.
		alternates: { canonical: post.canonicalUrl ?? `/news/${post.slug}` },
		robots: post.noindex ? { index: false, follow: true } : undefined,
		authors: post.author?.username ? [{ name: post.author.username }] : undefined,
		openGraph: {
			type: "article",
			title: post.seoTitle ?? post.title,
			description,
			url: `/news/${post.slug}`,
			publishedTime: post.publishedAt?.toISOString(),
			modifiedTime: post.updatedAt.toISOString(),
			authors: post.author?.username ? [post.author.username] : undefined,
			tags: post.tags ?? undefined,
			images: [{ url: social, alt: post.coverAlt ?? post.title }],
		},
		twitter: {
			card: "summary_large_image",
			title: post.seoTitle ?? post.title,
			description,
			images: [social],
		},
	};
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const post = await getPost(slug);
	if (!post) notFound();

	const headings = post.contentHtml ? headingsFromHtml(post.contentHtml) : [];
	const url = `${SITE_URL}/news/${post.slug}`;

	// Fil de discussion et compteur de « j'aime » rendus côté serveur : données
	// PUBLIQUES uniquement (aucune lecture de session ici, sinon la page perdrait
	// son cache CDN). L'état personnel du lecteur est résolu par les îlots clients.
	const [thread, reactions] = await Promise.all([
		listComments({ kind: "post", id: post.id }, { page: 1, sort: "recent" }).catch(() => ({
			target: `post:${post.id}`,
			sort: "recent" as const,
			page: 1,
			pages: 1,
			total: 0,
			comments: [],
		})),
		reactionState({ kind: "post", id: post.id }, null).catch(() => ({ likes: 0, liked: false })),
	]);
	const likes = reactions.likes;

	// Colonnes explicites : la sélection par défaut rapatriait `body`,
	// `contentJson` et `contentHtml` — l'article ENTIER, trois fois — pour
	// n'afficher qu'un titre, une vignette et une date.
	const related = await db.query.posts.findMany({
		where: and(publicPostFilter(), ne(postsTable.id, post.id)),
		orderBy: [desc(postsTable.publishedAt)],
		limit: 3,
		columns: {
			id: true,
			slug: true,
			title: true,
			cover: true,
			coverAlt: true,
			publishedAt: true,
			readingMinutes: true,
		},
	});

	const coverUrl = assetUrl(post.cover);

	const articleSchema: WithContext<Article> = {
		"@context": "https://schema.org",
		"@type": "Article",
		headline: post.title,
		description: post.seoDescription ?? post.excerpt,
		// Même résolution que la couverture affichée : un chemin brut donnait
		// `https://dragonballfr.com./assets/…`.
		image: coverUrl
			? [coverUrl.startsWith("http") ? coverUrl : `${SITE_URL}${coverUrl}`]
			: undefined,
		datePublished: post.publishedAt?.toISOString(),
		dateModified: post.updatedAt.toISOString(),
		wordCount: post.wordCount || undefined,
		keywords: post.tags?.length ? post.tags.join(", ") : undefined,
		inLanguage: "fr-FR",
		author: post.author?.username
			? { "@type": "Person", name: post.author.username }
			: { "@type": "Organization", name: "Dragon Ball France" },
		publisher: {
			"@type": "Organization",
			name: "Dragon Ball France",
			logo: { "@type": "ImageObject", url: `${SITE_URL}/favicon-96.png` },
		},
		mainEntityOfPage: { "@type": "WebPage", "@id": url },
	};

	return (
		<>
			<JsonLd data={articleSchema} />
			<ReadingProgress />

			{/* Même colonne et même rythme vertical que le reste du site
			    (`PageShell`) : l'article gardait sa largeur et ses marges propres,
			    et le contenu sautait de quelques dizaines de pixels en passant de
			    l'index à la fiche. */}
			<PageShell rhythm="default">
				{/* Pont staff → édition de CET article, sans repasser par la sidebar. */}
				<DomainBar
					domain="news"
					className="ed-no-print mb-8"
					actions={[{ href: `/admin/posts/${post.id}`, label: "Éditer cet article" }]}
				/>

				<Breadcrumbs
					className="ed-no-print mb-10"
					items={[
						{ label: "Actualités", href: "/news" },
						...(post.tags?.length
							? [
									{
										label: post.tags[0],
										href: `/news/theme/${encodeURIComponent(post.tags[0].toLowerCase())}`,
									},
								]
							: []),
						{ label: post.title },
					]}
				/>

				{/* ---- Titraille ------------------------------------------------- */}
				<header className="mx-auto max-w-[46rem]">
					{post.tags?.length > 0 && (
						<p className="ed-kicker">
							<Link
								href={`/news/theme/${encodeURIComponent(post.tags[0].toLowerCase())}`}
								className="hover:underline"
							>
								{post.tags[0]}
							</Link>
						</p>
					)}
					<h1 className="ed-title mt-3">{post.title}</h1>
					{post.excerpt && <p className="ed-standfirst mt-5">{post.excerpt}</p>}

					<div className="ed-meta mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-[color:var(--ed-rule)] py-4">
						{post.author?.username && <span>Par {post.author.username}</span>}
						{post.publishedAt && (
							<time dateTime={post.publishedAt.toISOString()}>
								{dateLongue(post.publishedAt)}
							</time>
						)}
						<span aria-hidden>·</span>
						<span>{post.readingMinutes} min de lecture</span>
					</div>
				</header>

				{/* ---- Couverture -------------------------------------------------- */}
				{coverUrl && (
					<figure className="mx-auto mt-10 max-w-[62rem]">
						<div className="relative aspect-[16/9] overflow-hidden rounded-sm bg-[color:var(--ed-paper-sunken)]">
							<Image
								src={coverUrl}
								alt={post.coverAlt ?? ""}
								fill
								sizes="(max-width: 1024px) 100vw, 992px"
								className="object-cover"
								priority
							/>
						</div>
						{post.coverCaption && (
							<figcaption className="ed-meta mt-3 normal-case tracking-normal">
								{post.coverCaption}
							</figcaption>
						)}
					</figure>
				)}

				{/* ---- Corps + sommaire -------------------------------------------- */}
				<div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,46rem)_1fr] lg:justify-center">
					<article className="min-w-0">
						{post.contentHtml ? (
							// HTML régénéré côté serveur depuis le document Tiptap
							// (`lib/posts.ts`) — jamais du balisage venu du navigateur.
							<div className="ed-prose" dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
						) : (
							// Repli : articles antérieurs à l'éditeur riche, encore en Markdown.
							<div className="ed-prose">
								<ReactMarkdown remarkPlugins={[remarkGfm]}>{post.body}</ReactMarkdown>
							</div>
						)}

						{/* Annonce native en fin de lecture — après le corps de l'article,
						    jamais insérée au milieu du texte (règle AdSense : l'annonce ne
						    doit pas être confondue avec le contenu éditorial). */}
						<AdUnit placement="article" className="mt-12" />

						{post.tags?.length > 0 && (
							<div className="ed-no-print mt-14 flex flex-wrap items-center gap-2 border-t border-[color:var(--ed-rule)] pt-6">
								<span className="ed-meta">Thèmes</span>
								{post.tags.map((tag) => (
									<Link
										key={tag}
										href={`/news/theme/${encodeURIComponent(tag.toLowerCase())}`}
										className="rounded-full border border-[color:var(--ed-rule-strong)] px-3 py-1 text-[0.8125rem] transition-colors hover:border-[color:var(--ed-accent)] hover:text-[color:var(--ed-accent)]"
									>
										{tag}
									</Link>
								))}
							</div>
						)}

						{/* ---- Participer : j'aime + discussion ---------------------- */}
						{/* Le fil est rendu ici avec sa PREMIÈRE PAGE déjà remplie côté
						    serveur (`initial`) : les commentaires restent indexables et la
						    page ne saute pas à l'hydratation. Tout le reste (tri, page 2,
						    droits du lecteur) passe par `/api/social/*`, ce qui laisse la
						    page statique/ISR cacheable par le CDN. */}
						<div className="ed-no-print mt-16 flex flex-wrap items-center gap-4 border-t border-[color:var(--ed-rule)] pt-8">
							<LikeButton
								target={`post:${post.id}`}
								initialLikes={likes}
								callbackURL={`/news/${post.slug}`}
								label="J'aime cet article"
							/>
							<span className="text-[0.8125rem] text-[color:var(--ed-ink-muted)]">
								{thread.total > 0
									? `${thread.total} message${thread.total > 1 ? "s" : ""} dans la discussion`
									: "Aucun message pour l'instant"}
							</span>
						</div>

						<CommentThread
							className="mt-10"
							target={`post:${post.id}`}
							initial={thread}
							callbackURL={`/news/${post.slug}`}
							title="Discussion"
						/>
					</article>

					{/* ---- Sommaire collant -------------------------------------------- */}
					{headings.length > 1 && (
						<aside className="ed-no-print hidden lg:block">
							<div className="sticky top-24">
								<p className="ed-meta border-b border-[color:var(--ed-rule)] pb-2">Sommaire</p>
								<nav className="mt-3">
									<ol className="space-y-2">
										{headings.map((h) => (
											<li key={h.id} style={{ paddingInlineStart: `${(h.level - 2) * 0.85}rem` }}>
												<a
													href={`#${h.id}`}
													className="block text-[0.875rem] leading-snug text-[color:var(--ed-ink-muted)] transition-colors hover:text-[color:var(--ed-accent)]"
												>
													{h.text}
												</a>
											</li>
										))}
									</ol>
								</nav>
							</div>
						</aside>
					)}
				</div>

				{/* ---- À lire ensuite ---------------------------------------------- */}
				{related.length > 0 && (
					<section className="ed-no-print mt-24 border-t-2 border-[color:var(--ed-ink)] pt-8">
						<h2 className="ed-kicker">À lire ensuite</h2>
						<div className="mt-6 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
							{related.map((p) => (
								<article key={p.id}>
									{p.cover && (
										<Link
											href={`/news/${p.slug}`}
											className="group relative mb-3 block aspect-[16/10] overflow-hidden rounded-sm bg-[color:var(--ed-paper-sunken)]"
										>
											<Image
												src={assetUrl(p.cover)}
												alt={p.coverAlt ?? ""}
												fill
												sizes="(max-width: 640px) 100vw, 340px"
												className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
											/>
										</Link>
									)}
									<h3 className="text-[1.125rem] font-semibold leading-snug tracking-[-0.01em]">
										<Link
											href={`/news/${p.slug}`}
											className="transition-colors hover:text-[color:var(--ed-accent)]"
										>
											{p.title}
										</Link>
									</h3>
									<p className="ed-meta mt-2">
										{p.publishedAt && dateCourte(p.publishedAt)} ·{" "}
										{p.readingMinutes} min
									</p>
								</article>
							))}
						</div>
					</section>
				)}

				{/* Multiplex « contenus associés » — bas de page uniquement, après le
				    contenu éditorial et les recommandations internes. */}
				<AdUnit placement="multiplex" className="mt-20" label={null} />
			</PageShell>
		</>
	);
}
