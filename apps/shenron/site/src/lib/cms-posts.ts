/**
 * cms-posts — **le** chemin d'écriture des articles, partagé par l'administration
 * et par l'API des agents.
 *
 * Pourquoi cette extraction : la logique d'enregistrement vivait dans la Server
 * Action de `/admin/posts` (validation, rendu du document, unicité du slug,
 * programmation, purge du cache). Ouvrir l'écriture aux agents avec un second
 * chemin aurait dupliqué cinq règles non triviales — dont celle qui évite de
 * publier un brouillon par accident — et garanti qu'elles divergent. Ici, un
 * seul cœur ; l'appelant se contente de dire QUI écrit et avec quels droits.
 *
 * Ce que le cœur ne fait pas : décider des droits. `requireAdmin()` reste dans
 * l'action d'administration, la vérification de portée reste dans la route
 * d'agent. Un module d'écriture qui s'autoriserait lui-même serait impossible à
 * relire.
 *
 * Server-only.
 */
import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { posts, POST_STATUSES, type PostContentDoc, type PostStatus } from "@/db/schema";
import { autoExcerpt, computeReadingStats, renderPostDoc } from "@/lib/posts";
import { isValidSlug, slugify, uniqueSlug } from "@/lib/slug";

const TAG_MAX = 8;

const postInputSchema = z.object({
	id: z.string().trim().optional(),
	title: z.string().trim().min(3, "Le titre doit faire au moins 3 caractères.").max(180),
	slug: z.string().trim().max(80).optional(),
	excerpt: z.string().trim().max(320).optional(),
	doc: z.record(z.string(), z.unknown()).nullable(),
	cover: z.string().trim().max(600).optional(),
	coverAlt: z.string().trim().max(300).optional(),
	coverCaption: z.string().trim().max(300).optional(),
	tags: z.array(z.string().trim().min(1).max(40)).max(TAG_MAX).default([]),
	status: z.enum(POST_STATUSES),
	/** ISO 8601. Requis pour un article programmé. */
	publishedAt: z.string().trim().optional(),
	featured: z.boolean().default(false),
	seoTitle: z.string().trim().max(70).optional(),
	seoDescription: z.string().trim().max(180).optional(),
	ogImage: z.string().trim().max(600).optional(),
	canonicalUrl: z.string().trim().max(600).optional(),
	noindex: z.boolean().default(false),
});

export type PostInput = z.input<typeof postInputSchema>;
export type SaveResult = { ok: true; id: string; slug: string } | { ok: false; error: string };

/** Qui écrit : un membre du staff, ou un agent agissant sous la clé d'un staff. */
export interface PostAuthor {
	/** `User.id` porté au crédit de l'article (contrainte de clé étrangère). */
	userId: string;
	/**
	 * Nom de l'agent quand l'écriture vient de l'API. Stocké sur l'article : un
	 * texte écrit par une IA doit pouvoir être identifié comme tel, des années
	 * après, sans fouiller un journal d'audit.
	 */
	agentName?: string | null;
	/**
	 * L'appelant a-t-il le droit de METTRE EN LIGNE ? Un agent sans la portée
	 * `publish:articles` voit son `status` ramené à `draft` — il alimente la
	 * rédaction, il ne publie pas à sa place.
	 */
	canPublish: boolean;
}

/** Vide → NULL (une chaîne vide en base n'est pas « absent »). */
function nullify(v: string | undefined): string | null {
	const s = v?.trim();
	return s ? s : null;
}

/**
 * N'accepte que des URL http(s) — bloque `javascript:` / `data:` sur les champs
 * d'URL libres (couverture, image sociale, canonique).
 */
function safeUrl(v: string | undefined): string | null {
	const s = nullify(v);
	if (!s) return null;
	// Chemin d'asset relatif servi par le bot (`./assets/...`) : autorisé tel quel.
	if (s.startsWith("./") || s.startsWith("/")) return s;
	try {
		const u = new URL(s);
		return u.protocol === "http:" || u.protocol === "https:" ? s : null;
	} catch {
		return null;
	}
}

/** Normalise les tags : trim, minuscules, dédoublonnage en préservant l'ordre. */
function normalizeTags(tags: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of tags) {
		const tag = raw.trim().replace(/\s+/g, " ");
		const key = tag.toLowerCase();
		if (!tag || seen.has(key)) continue;
		seen.add(key);
		out.push(tag);
	}
	return out.slice(0, TAG_MAX);
}

/**
 * Enregistre (création ou mise à jour) un article.
 *
 * Le HTML publié est TOUJOURS régénéré ici depuis le document (`renderPostDoc`),
 * jamais repris d'un corps de requête : ni le navigateur d'un admin ni un agent
 * ne peuvent injecter du balisage arbitraire dans une page publique.
 */
export async function savePostRecord(input: PostInput, author: PostAuthor): Promise<SaveResult> {
	const parsed = postInputSchema.safeParse(input);
	if (!parsed.success) {
		return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
	}
	const data = parsed.data;
	const doc = (data.doc ?? null) as PostContentDoc | null;

	// --- Contenu : HTML, texte brut et statistiques dérivés du document -------
	const rendered = renderPostDoc(doc);
	if (!rendered.text.trim()) {
		return { ok: false, error: "L'article est vide — ajoutez du contenu avant d'enregistrer." };
	}

	// --- Slug : unique, stable, validé ---------------------------------------
	const desired = data.slug?.trim() ? data.slug.trim() : slugify(data.title);
	if (data.slug?.trim() && !isValidSlug(desired)) {
		return {
			ok: false,
			error: "Le slug ne peut contenir que des minuscules, des chiffres et des tirets.",
		};
	}
	// Slugs déjà pris, en excluant l'article courant (sinon chaque enregistrement
	// incrémenterait son propre suffixe : mon-article → mon-article-2 → -3…).
	const taken = await db
		.select({ slug: posts.slug })
		.from(posts)
		.where(data.id ? ne(posts.id, data.id) : undefined);
	const slug = uniqueSlug(
		desired,
		taken.map((r) => r.slug)
	);

	// --- Statut et date de parution ------------------------------------------
	// `published` = validé par la rédaction ; `publishedAt` = date d'entrée en
	// ligne. Un article programmé est donc « published » avec une date future :
	// il sort seul à la revalidation, sans tâche planifiée (cf. publicPostFilter).
	//
	// Le garde-fou des agents est ici : sans droit de publication, toute demande
	// de mise en ligne retombe en brouillon au lieu d'être refusée — l'agent a
	// quand même écrit, la rédaction tranche.
	const status: PostStatus = author.canPublish ? data.status : "draft";
	const now = new Date();
	let publishedAt: Date | null = null;
	if (status !== "draft") {
		const parsedDate = data.publishedAt ? new Date(data.publishedAt) : null;
		const valid = parsedDate && !Number.isNaN(parsedDate.getTime());
		publishedAt = valid ? parsedDate : now;
		if (status === "scheduled" && (!valid || parsedDate.getTime() <= now.getTime())) {
			return {
				ok: false,
				error: "Un article programmé demande une date de publication dans le futur.",
			};
		}
	}

	const excerpt = nullify(data.excerpt) ?? autoExcerpt(rendered.text);
	const stats = computeReadingStats(rendered.text);

	const values = {
		title: data.title,
		slug,
		excerpt,
		// `body` conserve le texte brut : recherche, repli d'affichage et
		// compatibilité avec les articles Markdown antérieurs à l'éditeur riche.
		body: rendered.text,
		contentJson: doc,
		contentHtml: rendered.html,
		cover: safeUrl(data.cover),
		coverAlt: nullify(data.coverAlt),
		coverCaption: nullify(data.coverCaption),
		tags: normalizeTags(data.tags),
		status,
		published: status !== "draft",
		publishedAt,
		featured: data.featured,
		seoTitle: nullify(data.seoTitle),
		seoDescription: nullify(data.seoDescription),
		ogImage: safeUrl(data.ogImage),
		canonicalUrl: safeUrl(data.canonicalUrl),
		noindex: data.noindex,
		readingMinutes: stats.readingMinutes,
		wordCount: stats.wordCount,
		agentName: author.agentName ?? null,
		updatedAt: now,
	};

	let id = data.id ?? "";
	if (id) {
		await db.update(posts).set(values).where(eq(posts.id, id));
	} else {
		const [created] = await db
			.insert(posts)
			.values({ ...values, authorId: author.userId })
			.returning({ id: posts.id });
		if (!created) return { ok: false, error: "L'enregistrement a échoué." };
		id = created.id;
	}

	revalidateArticleRoutes(slug);
	return { ok: true, id, slug };
}

/** Disponibilité d'un slug — témoin temps réel de l'éditeur et de l'API. */
export async function isSlugAvailable(
	slug: string,
	currentId?: string
): Promise<{ available: boolean; normalized: string }> {
	const normalized = slugify(slug);
	if (!normalized) return { available: false, normalized };

	const clash = await db.query.posts.findFirst({
		where: currentId
			? and(eq(posts.slug, normalized), ne(posts.id, currentId))
			: eq(posts.slug, normalized),
		columns: { id: true },
	});
	return { available: !clash, normalized };
}

/** Purge le cache de toutes les surfaces qui affichent des articles. */
export function revalidateArticleRoutes(slug?: string | null): void {
	revalidatePath("/admin/posts");
	revalidatePath("/news");
	revalidatePath("/news/fil");
	revalidatePath("/actualites");
	revalidatePath("/"); // la home affiche les derniers articles
	revalidatePath("/sitemap.xml");
	if (slug) {
		revalidatePath(`/news/${slug}`);
		revalidatePath(`/actualites/${slug}`);
		revalidatePath(`/post/${slug}`); // ancienne URL, redirigée en 308
	}
}
