import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tierlists, tierlistVotes, type TierlistItem, type TierlistTier } from "@/db/schema";
import { botCharacters } from "@/db/bot-schema";

export type { TierlistItem, TierlistTier };

/**
 * Tierlists communautaires : un membre connecté range des « cartes » (images
 * fournies par le wiki) dans des tiers S/A/B/C/D, puis publie sa tierlist sur le
 * site (style forum). Le pool d'images vient d'un template (personnages, etc.) ;
 * la tierlist sauvegardée est un snapshot autonome (items figés en jsonb).
 */

export interface TierlistTemplate {
	key: string;
	title: string;
	description: string;
	/** Source du pool d'images : personnages du wiki, ou `none` (page blanche). */
	source: "characters" | "none";
	/** Filtre optionnel sur la race (ex: Saiyans). */
	race?: RegExp;
	/** Nombre max d'items dans le pool (les plus canoniques d'abord). */
	limit?: number;
}

export const TIERLIST_TEMPLATES: TierlistTemplate[] = [
	{
		key: "personnages",
		title: "Personnages Dragon Ball",
		description: "Classe les héros, dieux et vilains de toute la saga.",
		source: "characters",
		limit: 60,
	},
	{
		key: "saiyans",
		title: "Les Saiyans",
		description: "Range les guerriers de la race la plus fière de l'univers.",
		source: "characters",
		race: /saiyan|saïen|saiyen|saïan/i,
		limit: 40,
	},
	{
		key: "personnages-all",
		title: "Tout l'univers (avancé)",
		description: "Le pool complet des personnages avec illustration. Pour les puristes.",
		source: "characters",
		limit: 150,
	},
	{
		key: "libre",
		title: "Tierlist libre",
		description: "Pars d'une page blanche et ajoute tes propres images (upload ou URL).",
		source: "none",
	},
];

/** Tiers par défaut d'une nouvelle tierlist (vides). */
const DEFAULT_TIERS: Array<{ label: string; color: string }> = [
	{ label: "S", color: "#ff5252" },
	{ label: "A", color: "#ff9800" },
	{ label: "B", color: "#ffd54f" },
	{ label: "C", color: "#66bb6a" },
	{ label: "D", color: "#42a5f5" },
];

export function getTierlistTemplate(key: string): TierlistTemplate | undefined {
	return TIERLIST_TEMPLATES.find((t) => t.key === key);
}

/** Libellé de la catégorie « ajouts perso » (images uploadées / URL / texte). */
const CUSTOM_CATEGORY = "Mes ajouts";

/**
 * Range un personnage du wiki dans une catégorie française lisible à partir de
 * sa `race` (champ DB souvent en anglais/espagnol). Sert à regrouper le pool de
 * l'éditeur pour retrouver une carte rapidement (onglets de filtre).
 */
function categoryOf(race: string | null | undefined): string {
	const r = (race ?? "").toLowerCase();
	if (!r) return "Autres";
	if (r.includes("saiyan") || r.includes("saïen") || r.includes("saiyen")) return "Saiyans";
	if (r.includes("android") || r.includes("androïde") || r.includes("cyborg")) return "Androïdes";
	if (r.includes("namek")) return "Nameks";
	if (r.includes("frieza") || r.includes("freezer") || r.includes("freeza"))
		return "Race de Freezer";
	if (r.includes("majin")) return "Majins";
	if (r.includes("angel") || r.includes("ange")) return "Anges";
	if (r.includes("nucleico") || r.includes("kaio") || r.includes("kaïo"))
		return "Kaïos & divinités";
	if (r.includes("god") || r.includes("dieu") || r.includes("divin")) return "Dieux";
	if (r.includes("human") || r.includes("terrien") || r.includes("humain")) return "Humains";
	if (r.includes("jiren")) return "Univers 11";
	return "Autres";
}

export function emptyTiers(): TierlistTier[] {
	return DEFAULT_TIERS.map((t, i) => ({
		id: `tier-${i}`,
		label: t.label,
		color: t.color,
		items: [],
	}));
}

/** Charge le pool d'images d'un template depuis le wiki (Neon `bot.*`). */
export async function getTierlistPool(templateKey: string): Promise<TierlistItem[]> {
	const tpl = getTierlistTemplate(templateKey);
	if (!tpl || tpl.source !== "characters") return [];
	try {
		const rows = await db
			.select({
				id: botCharacters.id,
				name: botCharacters.name,
				image: botCharacters.image,
				// Portrait HQ Xenoverse 2 (carré, cadré visage) — icône idéale de tier list ;
				// préféré à l'artwork plein cadre quand il existe (les persos canoniques l'ont).
				portrait: botCharacters.portraitXv2,
				race: botCharacters.race,
			})
			.from(botCharacters)
			// Seules lectures de `botCharacters` du code qui omettaient ce filtre :
			// un personnage masqué depuis /admin/visibilite restait proposé (nom +
			// portrait) dans l'éditeur de tier list, page ouverte aux membres.
			.where(eq(botCharacters.visible, true))
			.orderBy(botCharacters.id);
		return rows
			.filter((c) => !!c.portrait || !!c.image)
			.filter((c) => (tpl.race ? !!c.race && tpl.race.test(c.race) : true))
			.slice(0, tpl.limit ?? 80)
			.map((c) => ({
				id: `char:${c.id}`,
				label: c.name,
				image: c.portrait || c.image,
				category: categoryOf(c.race),
			}));
	} catch (e) {
		console.error("getTierlistPool failed:", e);
		return [];
	}
}

function slugify(s: string): string {
	return s
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

export interface CreateTierlistInput {
	title: string;
	description?: string | null;
	templateKey?: string | null;
	tiers: TierlistTier[];
	authorId: string;
	/** Tier list officielle (créée par l'équipe). Défaut : false (communautaire). */
	official?: boolean;
	/** Épinglée / mise en avant. Défaut : false. */
	featured?: boolean;
	/** Visible publiquement. Défaut : true. */
	published?: boolean;
}

export async function createTierlist(input: CreateTierlistInput): Promise<{ slug: string }> {
	const base = slugify(input.title) || "tierlist";
	const slug = `${base}-${createId().slice(0, 6)}`;
	await db.insert(tierlists).values({
		slug,
		title: input.title.slice(0, 120),
		description: input.description?.slice(0, 500) ?? null,
		templateKey: input.templateKey ?? null,
		tiers: input.tiers,
		authorId: input.authorId,
		published: input.published ?? true,
		official: input.official ?? false,
		featured: input.featured ?? false,
	});
	return { slug };
}

/**
 * Pool complet des personnages du wiki (avec illustration), pour bâtir une tier
 * list **officielle** côté admin : pas de filtre de template, cap généreux.
 */
export async function getAdminCharacterPool(limit = 400): Promise<TierlistItem[]> {
	try {
		const rows = await db
			.select({
				id: botCharacters.id,
				name: botCharacters.name,
				image: botCharacters.image,
				portrait: botCharacters.portraitXv2,
				race: botCharacters.race,
			})
			.from(botCharacters)
			.where(eq(botCharacters.visible, true))
			.orderBy(botCharacters.id);
		return rows
			.filter((c) => !!c.portrait || !!c.image)
			.slice(0, limit)
			.map((c) => ({
				id: `char:${c.id}`,
				label: c.name,
				image: c.portrait || c.image,
				category: categoryOf(c.race),
			}));
	} catch (e) {
		console.error("getAdminCharacterPool failed:", e);
		return [];
	}
}

type TierlistWithAuthor = Awaited<ReturnType<typeof listTierlists>>[number];

export async function listTierlists(limit = 60) {
	return db.query.tierlists.findMany({
		where: eq(tierlists.published, true),
		// Mise en avant : featured d'abord, puis officielles, puis les plus récentes.
		orderBy: [desc(tierlists.featured), desc(tierlists.official), desc(tierlists.createdAt)],
		with: { author: true },
		limit,
	});
}

export async function getTierlistBySlug(slug: string) {
	return db.query.tierlists.findFirst({
		where: and(eq(tierlists.slug, slug), eq(tierlists.published, true)),
		with: { author: true },
	});
}

export async function listTierlistsByAuthor(authorId: string, limit = 30) {
	return db.query.tierlists.findMany({
		where: eq(tierlists.authorId, authorId),
		orderBy: desc(tierlists.createdAt),
		with: { author: true },
		limit,
	});
}

// ── Likes ───────────────────────────────────────────────────────────────────

async function countTierlistLikes(tierlistId: string): Promise<number> {
	const [r] = await db
		.select({ c: sql<number>`count(*)::int` })
		.from(tierlistVotes)
		.where(eq(tierlistVotes.tierlistId, tierlistId));
	return Number(r?.c ?? 0);
}

/** Toggle le like d'un user sur une tierlist. Throw si la tierlist n'existe pas (FK). */
export async function toggleTierlistLike(
	tierlistId: string,
	userId: string
): Promise<{ liked: boolean; count: number }> {
	const del = await db
		.delete(tierlistVotes)
		.where(and(eq(tierlistVotes.tierlistId, tierlistId), eq(tierlistVotes.userId, userId)))
		.returning({ id: tierlistVotes.id });
	let liked: boolean;
	if (del.length > 0) {
		liked = false;
	} else {
		await db.insert(tierlistVotes).values({ tierlistId, userId }).onConflictDoNothing();
		liked = true;
	}
	return { liked, count: await countTierlistLikes(tierlistId) };
}

export async function getTierlistLikeState(
	tierlistId: string,
	userId: string | null
): Promise<{ liked: boolean; count: number }> {
	const count = await countTierlistLikes(tierlistId);
	if (!userId) return { liked: false, count };
	const [r] = await db
		.select({ id: tierlistVotes.id })
		.from(tierlistVotes)
		.where(and(eq(tierlistVotes.tierlistId, tierlistId), eq(tierlistVotes.userId, userId)))
		.limit(1);
	return { liked: !!r, count };
}

/** Compte de likes pour un lot d'ids (index). */
export async function getLikeCountsFor(ids: string[]): Promise<Record<string, number>> {
	if (ids.length === 0) return {};
	const rows = await db
		.select({ id: tierlistVotes.tierlistId, c: sql<number>`count(*)::int` })
		.from(tierlistVotes)
		.where(inArray(tierlistVotes.tierlistId, ids))
		.groupBy(tierlistVotes.tierlistId);
	const map: Record<string, number> = {};
	for (const r of rows) map[r.id] = Number(r.c);
	return map;
}

/**
 * Supprime une tierlist. Autorisé seulement à son auteur (ou à un admin).
 * Retourne `true` si une ligne a été supprimée.
 */
export async function deleteTierlistOwned(
	id: string,
	authorId: string,
	isAdmin: boolean
): Promise<boolean> {
	const where = isAdmin
		? eq(tierlists.id, id)
		: and(eq(tierlists.id, id), eq(tierlists.authorId, authorId));
	const res = await db.delete(tierlists).where(where).returning({ id: tierlists.id });
	return res.length > 0;
}

// ── Administration (modération + curation) ───────────────────────────────────

export type TierlistAdminFilter = "all" | "official" | "community" | "featured" | "hidden";

export interface AdminTierlistRow {
	id: string;
	slug: string;
	title: string;
	description: string | null;
	templateKey: string | null;
	published: boolean;
	official: boolean;
	featured: boolean;
	itemCount: number;
	likeCount: number;
	authorName: string | null;
	authorId: string;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Liste TOUTES les tierlists (publiées ou masquées) pour la modération admin,
 * avec auteur, nombre de cartes et likes. Filtre + recherche par titre.
 */
export async function listAllTierlistsAdmin(
	opts: { q?: string; filter?: TierlistAdminFilter; limit?: number; offset?: number } = {}
): Promise<{ rows: AdminTierlistRow[]; total: number }> {
	const limit = Math.min(200, Math.max(1, opts.limit ?? 100));
	const offset = Math.max(0, opts.offset ?? 0);
	const filter = opts.filter ?? "all";
	const q = opts.q?.trim();

	const conds = [];
	if (filter === "official") conds.push(eq(tierlists.official, true));
	else if (filter === "community") conds.push(eq(tierlists.official, false));
	else if (filter === "featured") conds.push(eq(tierlists.featured, true));
	else if (filter === "hidden") conds.push(eq(tierlists.published, false));
	if (q) conds.push(ilike(tierlists.title, `%${q}%`));
	const where = conds.length ? and(...conds) : undefined;

	const lists = await db.query.tierlists.findMany({
		where,
		orderBy: [desc(tierlists.official), desc(tierlists.featured), desc(tierlists.createdAt)],
		with: { author: true },
		limit,
		offset,
	});

	const [countRow] = await db
		.select({ total: sql<number>`count(*)::int` })
		.from(tierlists)
		.where(where);

	const likeCounts = await getLikeCountsFor(lists.map((l) => l.id));

	const rows: AdminTierlistRow[] = lists.map((l) => ({
		id: l.id,
		slug: l.slug,
		title: l.title,
		description: l.description,
		templateKey: l.templateKey,
		published: l.published,
		official: l.official,
		featured: l.featured,
		itemCount: l.tiers.reduce((n, t) => n + t.items.length, 0),
		likeCount: likeCounts[l.id] ?? 0,
		authorName: l.author?.username ?? null,
		authorId: l.authorId,
		createdAt: l.createdAt,
		updatedAt: l.updatedAt,
	}));

	return { rows, total: Number(countRow?.total ?? 0) };
}

/** Charge une tierlist par id pour l'éditeur admin (tout état, publié ou non). */
export async function getTierlistForAdmin(id: string) {
	return db.query.tierlists.findFirst({
		where: eq(tierlists.id, id),
		with: { author: true },
	});
}

export interface UpdateTierlistAdminInput {
	title?: string;
	description?: string | null;
	tiers?: TierlistTier[];
	published?: boolean;
	official?: boolean;
	featured?: boolean;
}

/** Met à jour une tierlist (admin, sans contrainte d'auteur). Retourne true si modifiée. */
export async function updateTierlistAdmin(
	id: string,
	patch: UpdateTierlistAdminInput
): Promise<boolean> {
	const set: Partial<typeof tierlists.$inferInsert> = { updatedAt: new Date() };
	if (patch.title !== undefined) set.title = patch.title.slice(0, 120);
	if (patch.description !== undefined)
		set.description = patch.description ? patch.description.slice(0, 500) : null;
	if (patch.tiers !== undefined) set.tiers = patch.tiers;
	if (patch.published !== undefined) set.published = patch.published;
	if (patch.official !== undefined) set.official = patch.official;
	if (patch.featured !== undefined) set.featured = patch.featured;
	const res = await db
		.update(tierlists)
		.set(set)
		.where(eq(tierlists.id, id))
		.returning({ id: tierlists.id });
	return res.length > 0;
}

/** Suppression admin (sans contrainte d'auteur). Retourne true si supprimée. */
export async function deleteTierlistAdmin(id: string): Promise<boolean> {
	const res = await db
		.delete(tierlists)
		.where(eq(tierlists.id, id))
		.returning({ id: tierlists.id });
	return res.length > 0;
}
