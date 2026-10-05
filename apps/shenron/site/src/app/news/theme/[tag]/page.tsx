import { db } from "@/lib/db";
import { posts as postsTable } from "@/db/schema";
import { and, desc, sql } from "drizzle-orm";
import { cache } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { dateCourte } from "@/lib/dates";
import type { Metadata } from "next";

import { publicPostFilter } from "@/lib/posts";
import { countCommentsBatch, reactionCounts } from "@/lib/social";
import { CardGrid, MangaCard, PageShell, SectionHeading, SocialCounts } from "@/components/kit";

export const revalidate = 300;

/**
 * Les thèmes sont stockés en `jsonb` (tableau de chaînes) sur l'article, avec la
 * casse choisie par la rédaction. L'URL, elle, est toujours en minuscules —
 * d'où la comparaison insensible à la casse, faite en SQL plutôt qu'en mémoire
 * pour ne pas rapatrier tout le journal à chaque page de thème.
 */
function hasTag(tag: string) {
	return sql`EXISTS (
		SELECT 1 FROM jsonb_array_elements_text(${postsTable.tags}) AS t(value)
		WHERE lower(t.value) = ${tag}
	)`;
}

/**
 * Retrouve la casse d'origine du thème pour l'afficher tel que rédigé.
 * Mémoïsé : `generateMetadata` et la page posent la même question dans le même
 * rendu, ce qui donnait deux fois la même requête par page générée.
 */
const resolveTagLabel = cache(async (tag: string): Promise<string | null> => {
	const rows = await db
		.select({ tags: postsTable.tags })
		.from(postsTable)
		.where(and(publicPostFilter(), hasTag(tag)))
		.limit(1);
	return rows[0]?.tags?.find((t) => t.toLowerCase() === tag) ?? null;
});

/**
 * Décodage tolérant du segment d'URL. `decodeURIComponent` **lève** sur une
 * séquence de pourcentage tronquée (`/news/theme/%E0%A4`) : non rattrapée,
 * l'exception rendait une erreur 500 sur une URL simplement malformée, là où la
 * bonne réponse est une 404.
 */
function decodeTag(raw: string): string | null {
	try {
		return decodeURIComponent(raw).toLowerCase();
	} catch {
		return null;
	}
}

export async function generateStaticParams() {
	const rows = await db
		.select({ tags: postsTable.tags })
		.from(postsTable)
		.where(publicPostFilter());
	const seen = new Set<string>();
	for (const r of rows) for (const t of r.tags ?? []) seen.add(t.toLowerCase());
	// Valeur BRUTE, non encodée : Next encode lui-même le segment au pré-rendu.
	// Encoder ici produirait un double encodage (« super-saiyan%2Fbleu »).
	return [...seen].map((tag) => ({ tag }));
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ tag: string }>;
}): Promise<Metadata> {
	const { tag } = await params;
	const decoded = decodeTag(tag);
	const label = decoded ? await resolveTagLabel(decoded) : null;
	if (!label || !decoded) return { title: "Thème introuvable" };

	return {
		title: `${label} — Le Journal`,
		description: `Tous les articles Dragon Ball classés sous « ${label} » : actualités, analyses et dossiers.`,
		alternates: { canonical: `/news/theme/${encodeURIComponent(decoded)}` },
	};
}

export default async function TagPage({ params }: { params: Promise<{ tag: string }> }) {
	const { tag } = await params;
	const decoded = decodeTag(tag);

	const label = decoded ? await resolveTagLabel(decoded) : null;
	// Un thème sans aucun article en ligne n'est pas une page vide : c'est une 404
	// (sinon on ouvre une infinité d'URL indexables et creuses).
	if (!label || !decoded) notFound();

	// Colonnes explicites : sans elles, les 60 articles d'un thème arrivaient
	// avec leur corps complet (`body` + `contentJson` + `contentHtml`) pour ne
	// rendre qu'une grille de titres et de chapôs.
	const rows = await db.query.posts.findMany({
		where: and(publicPostFilter(), hasTag(decoded)),
		orderBy: [desc(postsTable.publishedAt)],
		limit: 60,
		columns: {
			id: true,
			slug: true,
			title: true,
			excerpt: true,
			cover: true,
			coverAlt: true,
			publishedAt: true,
			readingMinutes: true,
		},
	});

	// Compteurs sociaux du lot, deux requêtes pour toute la grille : une catégorie
	// d'articles affiche les mêmes signaux qu'une catégorie du wiki.
	const ids = rows.map((r) => r.id);
	const [likes, comments] = await Promise.all([
		reactionCounts("post", ids).catch(() => new Map<string, number>()),
		countCommentsBatch("post", ids).catch(() => new Map<string, number>()),
	]);

	return (
		<PageShell rhythm="loose">
			<Breadcrumbs
				className="mb-8"
				items={[
					{ label: "Actualités", href: "/news" },
					{ label: "Thèmes", href: "/news" },
					{ label },
				]}
			/>

			{/* Même en-tête, mêmes cartes, même grille qu'une catégorie du wiki : une
			    catégorie d'articles n'est pas un parent pauvre de l'encyclopédie. */}
			<SectionHeading
				level={1}
				kicker="Thème"
				title={label}
				standfirst={`Tous les articles classés sous « ${label} », du plus récent au plus ancien.`}
				actions={
					<Link href="/news" className="toriyama-btn-secondary !text-[0.75rem]">
						Toutes les actualités
					</Link>
				}
			/>

			<p className="mt-4 font-display text-[0.6875rem] uppercase tracking-[0.12em] text-white/40">
				{rows.length} article{rows.length > 1 ? "s" : ""}
			</p>

			<CardGrid className="mt-10">
				{rows.map((post) => (
					<MangaCard
						key={post.id}
						href={`/news/${post.slug}`}
						title={post.title}
						badge={label}
						excerpt={post.excerpt}
						image={post.cover}
						imageAlt={post.coverAlt}
						ratio="wide"
						meta={
							<>
								{post.publishedAt && (
									<time dateTime={post.publishedAt.toISOString()}>
										{dateCourte(post.publishedAt)}
									</time>
								)}
								<span aria-hidden>·</span>
								<span>{post.readingMinutes} min</span>
							</>
						}
						footer={
							<SocialCounts
								likes={likes.get(post.id) ?? 0}
								comments={comments.get(post.id) ?? 0}
								emptyLabel="Premier commentaire à écrire"
							/>
						}
					/>
				))}
			</CardGrid>
		</PageShell>
	);
}
