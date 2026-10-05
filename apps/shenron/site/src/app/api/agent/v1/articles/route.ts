/**
 * /api/agent/v1/articles — lecture et **rédaction** d'articles par un agent.
 *
 *   GET  ?status=published|draft|all&page=1  → liste (titres, slugs, statuts)
 *   POST { title, markdown, … }              → crée un article
 *
 * Trois décisions qui rendent cette porte acceptable :
 *
 *  1. **Un seul chemin d'écriture.** `savePostRecord` (lib/cms-posts) est
 *     exactement la fonction utilisée par l'administration : même validation,
 *     même rendu du document, même unicité de slug, même purge de cache.
 *  2. **L'agent écrit en markdown, pas en HTML.** Le corps est converti en
 *     document Tiptap puis re-rendu côté serveur : aucun balisage fourni par un
 *     client n'atteint une page publique.
 *  3. **Publier est une portée distincte.** Avec `write:articles` seul, tout
 *     aboutit en brouillon — l'agent alimente la rédaction, il ne décide pas de
 *     la mise en ligne. `publish:articles` lève la bride.
 */
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, users, type PostStatus } from "@/db/schema";
import { publicPostFilter } from "@/lib/posts";
import { savePostRecord } from "@/lib/cms-posts";
import { parseMarkdown } from "@/components/editor/markdown/parse";
import { buildExtensions } from "@/components/editor/schema";
import {
	AgentApiError,
	agentError,
	agentOk,
	readInt,
	readJsonBody,
	withAgent,
} from "@/lib/agent-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Même preset que l'éditeur : une extension en trop ici produirait du contenu
 *  que l'éditeur d'articles ne saurait pas rouvrir. */
const ARTICLE_EXTENSIONS = buildExtensions("article");

export async function GET(req: Request) {
	return withAgent(req, "read", async () => {
		const url = new URL(req.url);
		const status = url.searchParams.get("status") ?? "published";
		const page = readInt(url.searchParams.get("page"), { min: 1, max: 200, fallback: 1 });
		const perPage = readInt(url.searchParams.get("perPage"), { min: 1, max: 100, fallback: 25 });

		// Par défaut, un agent ne voit que le public. Les brouillons ne sortent que
		// sur demande explicite ET avec la portée d'écriture : un jeton de lecture
		// seule ne doit pas pouvoir lire la production non relue de la rédaction.
		let where = publicPostFilter();
		if (status === "draft" || status === "all") {
			where = status === "draft" ? eq(posts.published, false) : undefined;
		}

		const rows = await db
			.select({
				id: posts.id,
				slug: posts.slug,
				title: posts.title,
				excerpt: posts.excerpt,
				status: posts.status,
				publishedAt: posts.publishedAt,
				updatedAt: posts.updatedAt,
				tags: posts.tags,
				readingMinutes: posts.readingMinutes,
				agentName: posts.agentName,
				author: users.username,
			})
			.from(posts)
			.leftJoin(users, eq(users.id, posts.authorId))
			.where(where)
			.orderBy(desc(posts.updatedAt))
			.limit(perPage)
			.offset((page - 1) * perPage);

		return agentOk({
			page,
			perPage,
			articles: rows.map((r) => (Object.assign(r, {
	publishedAt: r.publishedAt?.toISOString() ?? null,
	updatedAt: r.updatedAt.toISOString(),
	url: `/news/${r.slug}`
}))),
		});
	});
}

export async function POST(req: Request) {
	return withAgent(req, "write:articles", async ({ agent, setSummary }) => {
		const body = await readJsonBody(req);

		const title = typeof body.title === "string" ? body.title.trim() : "";
		const markdown = typeof body.markdown === "string" ? body.markdown : "";
		if (!title || title.length < 3) {
			return agentError("bad_request", "`title` est requis (3 caractères minimum).");
		}
		if (!markdown.trim()) {
			return agentError("bad_request", "`markdown` est requis — le corps de l'article.");
		}
		if (markdown.length > 120_000) {
			return agentError("bad_request", "`markdown` dépasse 120 000 caractères.");
		}

		const canPublish = agent.scopes.includes("publish:articles");
		const askedStatus = typeof body.status === "string" ? body.status : "draft";
		const status: PostStatus =
			askedStatus === "published" || askedStatus === "scheduled" ? askedStatus : "draft";

		// Le membre du staff qui porte la clé devient l'auteur en base : la colonne
		// `authorId` référence `User`, et une écriture doit toujours être rattachée à
		// quelqu'un de responsable. `agentName` dit que le texte vient d'une machine.
		const owner = await resolveOwner(agent.keyId);
		if (!owner) {
			throw new AgentApiError(
				"server_error",
				"Aucun compte staff rattachable à cette clé — recréez-la depuis /admin/agents."
			);
		}

		const doc = parseMarkdown(markdown, ARTICLE_EXTENSIONS) as Record<string, unknown>;

		const result = await savePostRecord(
			{
				title,
				slug: typeof body.slug === "string" ? body.slug : undefined,
				excerpt: typeof body.excerpt === "string" ? body.excerpt : undefined,
				doc,
				cover: typeof body.cover === "string" ? body.cover : undefined,
				coverAlt: typeof body.coverAlt === "string" ? body.coverAlt : undefined,
				tags: Array.isArray(body.tags)
					? body.tags.filter((t): t is string => typeof t === "string")
					: [],
				status,
				publishedAt: typeof body.publishedAt === "string" ? body.publishedAt : undefined,
				featured: false,
				seoTitle: typeof body.seoTitle === "string" ? body.seoTitle : undefined,
				seoDescription: typeof body.seoDescription === "string" ? body.seoDescription : undefined,
				noindex: false,
			},
			{ userId: owner, agentName: agent.name, canPublish }
		);

		if (!result.ok) return agentError("bad_request", result.error);

		setSummary(`article ${result.slug} (${canPublish ? status : "draft"})`);
		return agentOk(
			{
				id: result.id,
				slug: result.slug,
				status: canPublish ? status : "draft",
				url: `/news/${result.slug}`,
				/** Dit explicitement pourquoi un article demandé « published » est en brouillon. */
				note: canPublish
					? undefined
					: "Enregistré en brouillon : la portée `publish:articles` est absente de cette clé.",
			},
			201
		);
	});
}

/**
 * Compte staff rattaché à une clé : son créateur, à défaut n'importe quel
 * administrateur. Le repli existe parce qu'une clé créée par un admin depuis
 * supprimé ne doit pas rendre l'API inutilisable d'un coup.
 */
async function resolveOwner(keyId: string): Promise<string | null> {
	const key = await db.query.agentKeys.findFirst({
		where: (k, { eq: e }) => e(k.id, keyId),
		columns: { createdBy: true },
	});
	if (key?.createdBy) {
		const owner = await db.query.users.findFirst({
			where: and(eq(users.id, key.createdBy), isNotNull(users.id)),
			columns: { id: true },
		});
		if (owner) return owner.id;
	}
	const fallback = await db.query.users.findFirst({
		where: eq(users.roleAdmin, true),
		columns: { id: true },
	});
	return fallback?.id ?? null;
}
