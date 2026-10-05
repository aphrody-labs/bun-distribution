import "server-only";
import { and, asc, eq, like, ne, sql, inArray, count } from "drizzle-orm";
import { db } from "@/lib/db";
import {
	botCharacters,
	botCharacterTechniques,
	botCharacterVariants,
	botBattles,
	botEpisodes,
	botVoiceActors,
	botGames,
	botMangaChapters,
	botMangaVolumes,
	botMovies,
	botPlanets,
	botRaces,
	botTechniques,
	botSagas,
	botTransformations,
	botWikiSections,
	type VariantEvidence,
	type VariantKeyEpisode,
	type WikiSectionLink,
	type WikiSource,
} from "@/db/bot-schema";
import {
	normalizeSectionAccent,
	SECTION_ACCENT_SET,
	type SectionAccent,
} from "@/lib/wiki-section-accents";

export type { WikiSource };

/** Champs article communs (long-format + citations). */
interface WithArticle {
	/** Corps markdown long-format encyclopédique, ou null si pas encore rédigé. */
	article: string | null;
	/** Sources citées dans l'article (`[{ n, label, url, kind }]`). */
	articleSources: WikiSource[] | null;
}

// Base de l'API bot résolue par `@/lib/config` (source unique des URL). PAS
// dragonballfr.com (le site lui-même) → sinon les appels runtime boucleraient.
import { API_URL as SHENRON_API_URL } from "@/lib/config";
import { graphiesDeRace, slugDeRace } from "@/lib/races-alias";
import {
	CHARACTER_DUPLICATE_REDIRECTS,
	formatCharacterSlug,
	formatPlanetSlug,
	formatTransformationSlug,
	resolveCharacterParam,
	resolvePlanetParam,
	resolveTransformationParam,
} from "@/lib/wiki-slugs";

interface ShenronUser {
	discordId: string;
	username: string | null;
	avatar: string | null;
	avatarUrl: string | null;
	/** Rôle Discord le plus haut (hors @everyone) ; absent sur un bot pas encore redéployé. */
	topRole?: { id: string; name: string; color: string | null } | null;
	level: number;
	xp: number;
	zeni: number;
	xpProgress: {
		current: number;
		nextLevel: number;
		nextLevelXp: number;
		needed: number;
	} | null;
	banner: string | null;
	equipped: {
		card: string | null;
		badge: string | null;
		color: string | null;
		title: string | null;
		banner?: string | null;
	};
	achievements: Array<{ code: string; unlockedAt: string | number }>;
	inventory: Array<{ type: string; key: string }>;
	fusion: {
		partnerId: string;
		partnerName: string;
		createdAt: string | number;
	} | null;
}

export interface ShenronShopItem {
	key: string;
	type: "card" | "badge" | "color" | "title" | "banner";
	name: string;
	description: string | null;
	price: number;
	roleId: string | null;
	/** Couleur hex du rôle cosmétique (items color/title/badge) — aperçu swatch. */
	roleColor?: string;
	preview?: string; // URL relative CDN site (ex: /banners/banner-01.jpg)
	/** Prix du jour, indexé sur l'inflation (égal à `price` quand elle est inactive). */
	effectivePrice?: number;
}

/** Repère de prix canon, avec la planche qui l'imprime. */
export interface CanonPrice {
	key: string;
	label: string;
	zeni: number;
	source: { title: string; url: string };
}

/** État économique affiché par la boutique. */
export interface ShopEconomy {
	priceIndex: number;
	inflationEnabled: boolean;
	change7d: number;
	ceiling: number;
	canonPrices: CanonPrice[];
	parity: { ratio: number; source: { title: string; url: string } };
}

export interface LeaderboardEntry {
	rank: number;
	discordId: string;
	username: string | null;
	avatarUrl: string | null;
	xp: number;
	zeni: number;
	level: number;
}

interface PresenceMember {
	id: string;
	username: string;
	avatarUrl: string;
	status: string;
}
export interface ShenronPresence {
	total: number;
	online: number;
	members: PresenceMember[];
}

interface CharacterStat {
	label: string;
	value: string;
	accent?: string;
}

export interface DBCharacter extends WithArticle {
	id: number;
	slug: string;
	name: string;
	/** Nom japonais natif (孫悟空, ベジータ) — enrichi via AniList */
	nameJa: string | null;
	/** Translittération canon (Son Gokuu, Kuririn) — enrichi via AniList */
	nameRomaji: string | null;
	image: string;
	/** Portrait HQ Xenoverse 2 (fallback d'image quand `image` est cassée/404). */
	portraitXv2: string | null;
	ki: string | null;
	maxKi: string | null;
	race: string | null;
	gender: string | null;
	affiliation: string | null;
	description: string | null;
	originPlanetId: number | null;
	/** Stats scouter custom (CharacterStatsPanel). */
	stats: CharacterStat[] | null;
	debutEpisodeId: number | null;
	debutChapterId: number | null;
	debutSagaId: number | null;
}

export interface DBPlanet extends WithArticle {
	id: number;
	slug: string;
	name: string;
	nameJa: string | null;
	nameRomaji: string | null;
	image: string;
	isDestroyed: boolean;
	description: string | null;
}

export interface DBMovie {
	id: number;
	slug: string;
	title: string;
	titleJa: string | null;
	titleRomaji: string | null;
	series: string;
	releaseDate: string | number | null;
	durationMin: number | null;
	synopsis: string | null;
	poster: string | null;
	trailerUrl: string | null;
	malId: number | null;
}

interface DBTransformation {
	id: number;
	slug: string;
	name: string;
	image: string;
	ki: string | null;
	characterId: number;
}

export interface DBTechnique extends WithArticle {
	id: number;
	slug: string;
	name: string;
	nameJa?: string | null;
	nameRomaji?: string | null;
	description: string | null;
	type: string | null;
	creatorId: number | null;
	creatorSlug?: string | null;
	creatorName: string | null;
	creatorImage: string | null;
	/** Illustration de la technique (portrait XV2 d'un pratiquant). */
	image: string | null;
	battles?: CharacterBattle[];
	/** Personnages pratiquant cette technique (`bot.db_character_techniques`), au-delà du seul créateur/attribution. */
	practitioners?: RelatedCharacter[];
	/** Première apparition dans l'anime, si `debut_episode_id` est renseigné. */
	debutEpisode?: { id: number; numberInSeries: number | null; title: string | null } | null;
	/** Première apparition dans le manga, si `debut_chapter_id` est renseigné. */
	debutChapter?: { id: number; chapterNumber: number | null; title: string | null } | null;
	/** Transformations du même personnage pratiquant — pertinentes quand la technique est liée à une forme précise. */
	relatedTransformations?: Array<{
		id: number;
		slug: string;
		name: string;
		image: string | null;
		hasArticle: boolean;
	}>;
}

interface DBGame {
	id: number;
	slug: string;
	title: string;
	titleJa: string | null;
	platforms: string | null;
	releaseDate: string | number | null;
	publisher: string | null;
	developer: string | null;
	description: string | null;
	cover: string | null;
	officialUrl: string | null;
}

interface DBMangaVolume {
	id: number;
	series: string;
	volumeNumber: number;
	title: string | null;
	cover: string | null;
}

export interface DBRace extends WithArticle {
	id: number;
	slug: string;
	name: string;
	nameJa: string | null;
	description: string | null;
}

/** Personnage lié (version alternative ou allié) — carte minimale cliquable. */
export interface RelatedCharacter {
	id: number;
	slug: string;
	name: string;
	image: string | null;
	race: string | null;
}

interface CharacterBattle {
	id: number;
	slug: string;
	title: string;
	titleJa: string | null;
	series: string;
	winnerName: string | null;
	climaxSummary: string | null;
	location: string | null;
}

interface CharacterVoiceActor {
	id: number;
	slug: string;
	name: string;
	nameJa: string | null;
	nationality: string;
	roleNotes: string | null;
}

export interface CharacterWithRelations extends DBCharacter {
	transformations: DBTransformation[];
	originPlanet: DBPlanet | null;
	techniques: Array<{ technique: DBTechnique }>;
	/** Versions alternatives (même nom racine : `X`, `X (futur)`, `X (Xeno)`…). */
	versions: RelatedCharacter[];
	/** Personnages partageant la même affiliation (alliés / faction). */
	affiliates: RelatedCharacter[];
	battles: CharacterBattle[];
	voiceActors: CharacterVoiceActor[];
}

/** Retire les parenthèses de version en fin de nom : « Son Goku (GT) (Xeno) » → « Son Goku ». */
function stripVersionSuffix(name: string): string {
	return name.replace(/(?:\s*\([^)]*\))+\s*$/, "").trim();
}

/** Normalise (accents retirés, casse/espaces) pour comparer des noms racine. */
function foldName(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Affiliations « poubelle » (statut / fourre-tout) à ne jamais présenter comme
 * « personnages affiliés » : elles regrouperaient des persos sans lien réel.
 * Comparaison sur la forme normalisée (`foldName`).
 */
const AFFILIATION_BLOCKLIST = new Set([
	"decede",
	"decedee",
	"decedes",
	"decedees",
	"other",
	"others",
	"autre",
	"autres",
	"villain",
	"villains",
	"mechant",
	"mechants",
	"inconnu",
	"inconnue",
	"unknown",
	"n/a",
	"na",
	"aucun",
	"aucune",
	"none",
]);

/** Section de contenu éditorial d'une entité wiki (bloc markdown nommé). */
export interface WikiSectionData {
	id: number;
	key: string;
	label: string;
	accent: SectionAccent | null;
	body: string;
	/** Sous-catégorie parente (regroupement), ou null. */
	groupLabel: string | null;
	/** Pages wiki affiliées (cartes photo, liens internes). */
	links: WikiSectionLink[];
}

/**
 * Sections de contenu **visibles** d'une entité (personnage, planète, saga…),
 * triées par `sort_order`. Rendu en sélecteur de catégories sur la page détail.
 * Vides (body blanc) ignorées. Lecture seule, tolérante (jamais throw).
 */
export async function getWikiSections(
	entityType: string,
	entityId: number
): Promise<WikiSectionData[]> {
	try {
		const rows = await db
			.select()
			.from(botWikiSections)
			.where(
				and(
					eq(botWikiSections.entityType, entityType),
					eq(botWikiSections.entityId, entityId),
					eq(botWikiSections.visible, true)
				)
			)
			.orderBy(asc(botWikiSections.sortOrder), asc(botWikiSections.id));
		return (
			rows
				// On garde une section qui a du corps OU des pages affiliées (une section
				// purement « liens » — ex. une catégorie de renvois — reste valide).
				.filter((r) => (r.body ?? "").trim().length > 0 || (r.links?.length ?? 0) > 0)
				.map((r) => ({
					id: r.id,
					key: r.key,
					label: r.label,
					accent: (r.accent && SECTION_ACCENT_SET.has(r.accent)
						? normalizeSectionAccent(r.accent)
						: null) as WikiSectionData["accent"],
					body: r.body ?? "",
					groupLabel: r.groupLabel?.trim() ? r.groupLabel.trim() : null,
					links: Array.isArray(r.links) ? r.links.filter((l) => l && l.href && l.label) : [],
				}))
		);
	} catch (e) {
		console.error("[shenron] getWikiSections a échoué:", e);
		return [];
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Wiki Dragon Ball — lu DIRECTEMENT depuis Neon (schéma `bot`, miroir du
// SQLite du bot). Découplé de l'API REST du bot : les pages /wiki ne dépendent
// plus de la dispo du process bot. Lecture seule, ISR Vercel côté pages.
// Les mappers ci-dessous reproduisent à l'identique les shapes que servait
// l'API du bot (WikiService) pour ne rien casser côté pages.
// ─────────────────────────────────────────────────────────────────────────

type CharacterRow = typeof botCharacters.$inferSelect;
type PlanetRow = typeof botPlanets.$inferSelect;
type TransfoRow = typeof botTransformations.$inferSelect;

function mapCharacterStats(raw: unknown): CharacterStat[] | null {
	if (!Array.isArray(raw) || raw.length === 0) return null;
	const out: CharacterStat[] = [];
	for (const s of raw) {
		if (!s || typeof s !== "object") continue;
		const o = s as Record<string, unknown>;
		const label = typeof o.label === "string" ? o.label.trim() : "";
		const value = typeof o.value === "string" ? o.value.trim() : "";
		if (!label && !value) continue;
		out.push({
			label,
			value,
			accent: typeof o.accent === "string" && o.accent ? o.accent : undefined,
		});
	}
	return out.length ? out : null;
}

function mapCharacter(r: CharacterRow): DBCharacter {
	return {
		id: r.id,
		slug: formatCharacterSlug(r),
		name: r.name,
		nameJa: r.nameJa,
		nameRomaji: r.nameRomaji,
		image: r.image ?? "",
		portraitXv2: r.portraitXv2 ?? null,
		ki: r.ki,
		maxKi: r.maxKi,
		race: r.race,
		gender: r.gender,
		affiliation: r.affiliation,
		description: r.description,
		originPlanetId: r.originPlanetId,
		stats: mapCharacterStats(r.stats),
		debutEpisodeId: r.debutEpisodeId ?? null,
		debutChapterId: r.debutChapterId ?? null,
		debutSagaId: r.debutSagaId ?? null,
		article: r.article ?? null,
		articleSources: r.articleSources ?? null,
	};
}

function mapPlanet(r: PlanetRow): DBPlanet {
	return {
		id: r.id,
		slug: formatPlanetSlug(r),
		name: r.name,
		nameJa: r.nameJa,
		nameRomaji: r.nameRomaji,
		image: r.image ?? "",
		isDestroyed: !!r.isDestroyed,
		description: r.description,
		article: r.article ?? null,
		articleSources: r.articleSources ?? null,
	};
}

function mapTransfo(r: TransfoRow): DBTransformation {
	return {
		id: r.id,
		slug: formatTransformationSlug(r),
		name: r.name,
		image: r.image ?? "",
		ki: r.ki,
		characterId: r.characterId ?? 0,
	};
}

/**
 * Profil d'un membre, en distinguant les deux échecs.
 *
 * `getShenronUser` rendait `null` aussi bien pour « ce membre n'existe pas » que
 * pour « l'API du bot est injoignable », et la page appelante répondait 404 dans
 * les deux cas — un visiteur voyait donc « profil introuvable » pendant un
 * simple redémarrage du bot, et repartait en croyant son compte perdu.
 */
export type ShenronUserResult =
	| { status: "ok"; user: ShenronUser }
	| { status: "absent" }
	| { status: "unavailable" };

export async function getShenronUserResult(discordId: string): Promise<ShenronUserResult> {
	try {
		const res = await fetch(`${SHENRON_API_URL}/api/public/user/${discordId}`, {
			next: { revalidate: 60 },
			// Sans délai maximal, un bot qui accepte la connexion sans répondre
			// bloque le rendu de la page jusqu'au timeout par défaut.
			signal: AbortSignal.timeout(8_000),
		});
		if (res.status === 404) return { status: "absent" };
		if (!res.ok) return { status: "unavailable" };
		return { status: "ok", user: (await res.json()) as ShenronUser };
	} catch (e) {
		console.error("[shenron] getShenronUserResult a échoué:", e);
		return { status: "unavailable" };
	}
}

/** Variante historique : `null` couvre indistinctement absent et indisponible. */
async function getShenronUser(discordId: string): Promise<ShenronUser | null> {
	const r = await getShenronUserResult(discordId);
	return r.status === "ok" ? r.user : null;
}

async function getShenronShop(): Promise<ShenronShopItem[]> {
	try {
		const res = await fetch(`${SHENRON_API_URL}/api/public/shop`, {
			next: { revalidate: 60 },
		});
		if (!res.ok) return [];
		const data = await res.json();
		return data.items || [];
	} catch {
		return [];
	}
}

/** Catalogue + état économique (indice des prix, repères canon). */
export async function getShenronShopCatalog(): Promise<{
	items: ShenronShopItem[];
	economy: ShopEconomy | null;
}> {
	try {
		const res = await fetch(`${SHENRON_API_URL}/api/public/shop`, {
			next: { revalidate: 60 },
		});
		if (!res.ok) return { items: [], economy: null };
		const data = (await res.json()) as { items?: ShenronShopItem[]; economy?: ShopEconomy };
		return { items: data.items ?? [], economy: data.economy ?? null };
	} catch {
		return { items: [], economy: null };
	}
}

export async function getShenronLeaderboard(
	limit = 100,
	enrich = true,
	revalidateSec = 60,
	metric: "xp" | "zeni" = "xp",
	period: "general" | "month" = "general"
): Promise<LeaderboardEntry[]> {
	try {
		const res = await fetch(
			`${SHENRON_API_URL}/api/public/leaderboard?limit=${limit}&metric=${metric}&period=${period}${enrich ? "&enrich=1" : ""}`,
			{
				next: { revalidate: revalidateSec },
			}
		);
		if (!res.ok) return [];
		const data = await res.json();
		return data.leaderboard || [];
	} catch (e) {
		console.error("[shenron] getShenronLeaderboard a échoué:", e);
		return [];
	}
}

/**
 * Présence live du serveur (compteur en ligne + échantillon de membres) pour le
 * widget « connectés » de la home. Dégradation gracieuse en `{0,0,[]}`.
 */
export async function getShenronPresence(revalidateSec = 30): Promise<ShenronPresence> {
	try {
		const res = await fetch(`${SHENRON_API_URL}/api/public/presence`, {
			next: { revalidate: revalidateSec },
		});
		if (!res.ok) return { total: 0, online: 0, members: [] };
		const d = await res.json();
		return {
			total: Number(d.total ?? 0),
			online: Number(d.online ?? 0),
			members: Array.isArray(d.members) ? d.members : [],
		};
	} catch {
		return { total: 0, online: 0, members: [] };
	}
}

/** Colonnes strictement nécessaires à une grille / une liste de personnages. */
const CHARACTER_CARD_COLUMNS = {
	id: botCharacters.id,
	name: botCharacters.name,
	nameJa: botCharacters.nameJa,
	nameRomaji: botCharacters.nameRomaji,
	image: botCharacters.image,
	portraitXv2: botCharacters.portraitXv2,
	ki: botCharacters.ki,
	maxKi: botCharacters.maxKi,
	race: botCharacters.race,
	gender: botCharacters.gender,
	affiliation: botCharacters.affiliation,
	originPlanetId: botCharacters.originPlanetId,
} as const;

/** Personnage réduit à ce qu'une liste affiche (ni article, ni description). */
export type DBCharacterCard = {
	[K in keyof typeof CHARACTER_CARD_COLUMNS]: DBCharacter[K & keyof DBCharacter];
} & { slug: string };

/**
 * Personnages pour les LISTES — sans les colonnes de texte long.
 *
 * `getShenronCharacters()` faisait un `SELECT *` sur les 1 323 fiches : 1,34 Mio
 * transférés et désérialisés à chaque rendu, dont **767 Kio pour la seule
 * colonne `article`** (le corps rédactionnel de la fiche). Or aucune des cinq
 * pages appelantes n'affiche l'article : elles montrent un nom, une image, une
 * race. Le `generateStaticParams` de la fiche personnage, lui, n'avait besoin
 * que de l'`id` — et chargeait tout le corpus.
 */
export async function getShenronCharacterCards(query?: string): Promise<DBCharacterCard[]> {
	try {
		const q = query?.trim();
		const base = db.select(CHARACTER_CARD_COLUMNS).from(botCharacters);
		const rows = q
			? await base
					.where(
						and(
							like(sql`lower(${botCharacters.name})`, `%${q.toLowerCase()}%`),
							eq(botCharacters.visible, true)
						)
					)
					.limit(25)
			: await base.where(eq(botCharacters.visible, true));
		return rows.map((r) => (Object.assign(r, { slug: formatCharacterSlug(r) }))) as DBCharacterCard[];
	} catch (e) {
		console.error("[shenron] getShenronCharacterCards a échoué:", e);
		throw new Error("Character cards are temporarily unavailable.", { cause: e });
	}
}

/**
 * Identifiants des fiches visibles, dans l'ordre des identifiants.
 *
 * `generateStaticParams` n'a besoin que de ça. Il appelait
 * `getShenronCharacterCards()`, qui ramène douze colonnes des 1 323 fiches
 * visibles, pour n'en garder que cent identifiants : douze mille valeurs
 * transférées et désérialisées à chaque build, au moment précis où la machine
 * manque de mémoire (cf. `docs/pieges.md`).
 *
 * Le tri par identifiant n'est pas cosmétique : sans `order by`, PostgreSQL ne
 * garantit AUCUN ordre, donc le lot prérendu changeait d'un build à l'autre et
 * le cache repartait de zéro sans qu'on sache pourquoi.
 */
export async function getShenronCharacterIds(limite?: number): Promise<number[]> {
	try {
		const base = db
			.select({ id: botCharacters.id })
			.from(botCharacters)
			.where(eq(botCharacters.visible, true))
			.orderBy(asc(botCharacters.id));
		const rows = limite != null ? await base.limit(limite) : await base;
		return rows.map((r) => r.id);
	} catch (e) {
		console.error("[shenron] getShenronCharacterIds a échoué:", e);
		throw new Error("Character identifiers are temporarily unavailable.", { cause: e });
	}
}

/** Variante complète (articles compris). Réservée à ce qui lit vraiment l'article. */
async function getShenronCharacters(query?: string): Promise<DBCharacter[]> {
	try {
		const q = query?.trim();
		const rows = q
			? await db
					.select()
					.from(botCharacters)
					.where(
						and(
							like(sql`lower(${botCharacters.name})`, `%${q.toLowerCase()}%`),
							eq(botCharacters.visible, true)
						)
					)
					.limit(25)
			: await db.select().from(botCharacters).where(eq(botCharacters.visible, true));
		return rows.map(mapCharacter);
	} catch (e) {
		console.error("[shenron] getShenronCharacters a échoué:", e);
		return [];
	}
}

export async function getShenronMovies(): Promise<DBMovie[]> {
	try {
		return (await db.select().from(botMovies).where(eq(botMovies.visible, true))) as DBMovie[];
	} catch (e) {
		console.error("[shenron] getShenronMovies a échoué:", e);
		return [];
	}
}

async function getShenronMovie(id: number): Promise<DBMovie | null> {
	try {
		const [m] = await db
			.select()
			.from(botMovies)
			.where(and(eq(botMovies.id, id), eq(botMovies.visible, true)))
			.limit(1);
		return (m as DBMovie) ?? null;
	} catch (e) {
		console.error("[shenron] getShenronMovie a échoué:", e);
		return null;
	}
}

/**
 * Une version d'un personnage à une saga (`bot.db_character_variants`), déjà
 * jointe à sa saga pour l'affichage.
 */
export interface CharacterVariant {
	id: number;
	slug: string;
	label: string;
	displayName: string | null;
	nameJa: string | null;
	form: string | null;
	image: string | null;
	age: number | null;
	powerLevel: string | null;
	ki: string | null;
	maxKi: string | null;
	role: string | null;
	affiliation: string | null;
	summary: string | null;
	highlights: string[] | null;
	firstVolume: number | null;
	lastVolume: number | null;
	firstEpisode: number | null;
	lastEpisode: number | null;
	/** Épisodes de la saga dont le titre nomme le personnage. */
	keyEpisodes: VariantKeyEpisode[] | null;
	/** Série des épisodes de la saga (« DBZ », « DBGT »…) — la numérotation
	 *  repart à 1 d'une série à l'autre, l'afficher sans elle induirait en erreur. */
	episodeSeries: string | null;
	/** Méthode de mesure ("ocr-manga", "synopsis-episodes", les deux) ou "editorial". */
	origin: string | null;
	evidence: VariantEvidence | null;
	sagaId: number;
	sagaName: string;
	sagaSlug: string;
	sagaSeries: string | null;
	sagaImage: string | null;
}

/**
 * Versions d'un personnage saga par saga, dans l'ordre de la chronologie.
 *
 * Tri sur `db_sagas.order_idx` et non sur `sort_order` de la variante : l'ordre
 * qui compte est celui du récit, et il vit sur la saga. `sort_order` ne sert
 * qu'à départager deux variantes d'une même saga après une reprise éditoriale.
 */
export async function getShenronCharacterVariants(
	characterId: number
): Promise<CharacterVariant[]> {
	try {
		const rows = await db
			.select({ v: botCharacterVariants, s: botSagas })
			.from(botCharacterVariants)
			.innerJoin(botSagas, eq(botCharacterVariants.sagaId, botSagas.id))
			.where(
				and(
					eq(botCharacterVariants.characterId, characterId),
					eq(botCharacterVariants.visible, true)
				)
			)
			.orderBy(asc(botSagas.series), asc(botSagas.orderIdx), asc(botCharacterVariants.sortOrder));
		return rows.map(({ v, s }) => ({
			id: v.id,
			slug: v.slug,
			label: v.label,
			displayName: v.displayName,
			nameJa: v.nameJa,
			form: v.form,
			image: v.image,
			age: v.age,
			powerLevel: v.powerLevel,
			ki: v.ki,
			maxKi: v.maxKi,
			role: v.role,
			affiliation: v.affiliation,
			summary: v.summary,
			highlights: v.highlights ?? null,
			firstVolume: v.firstVolume,
			lastVolume: v.lastVolume,
			firstEpisode: v.firstEpisode,
			lastEpisode: v.lastEpisode,
			keyEpisodes: v.keyEpisodes ?? null,
			episodeSeries: s.episodeSeries,
			origin: v.origin,
			evidence: v.evidence ?? null,
			sagaId: s.id,
			sagaName: s.name,
			sagaSlug: s.slug,
			sagaSeries: s.series,
			sagaImage: s.image,
		}));
	} catch (e) {
		console.error("[shenron] getShenronCharacterVariants a échoué:", e);
		return [];
	}
}

/** Version d'un personnage, réduite à ce qu'affiche une carte de grille. */
export interface VariantCard {
	id: number;
	characterId: number;
	/** Nom du personnage, sans le suffixe de saga. */
	name: string;
	/** Libellé de la saga — affiché entre parenthèses derrière le nom. */
	saga: string;
	sagaId: number;
	slug: string;
	/** Image PROPRE à la version, `null` si elle hérite de celle du personnage. */
	image: string | null;
	/** Image du personnage, servant de repli. */
	characterImage: string | null;
	race: string | null;
	form: string | null;
}

/**
 * Toutes les versions par saga, pour la grille globale des personnages.
 *
 * Volontairement réduite aux champs d'une carte : la fiche détail a déjà
 * `getShenronCharacterVariants`, qui rend tout. Envoyer les 451 variantes
 * complètes dans la charge d'un index en doublerait le poids pour des données
 * que la grille n'affiche pas.
 *
 * L'image de la version prime, celle du personnage sert de repli : une variante
 * n'a pas forcément son illustration propre (au 2026-08-27, aucune ne
 * l'avait), et une carte vide serait pire que la même image répétée.
 */
export async function getShenronVariantCards(): Promise<VariantCard[]> {
	try {
		const rows = await db
			.select({
				id: botCharacterVariants.id,
				characterId: botCharacterVariants.characterId,
				slug: botCharacterVariants.slug,
				label: botCharacterVariants.label,
				form: botCharacterVariants.form,
				image: botCharacterVariants.image,
				sagaId: botSagas.id,
				sagaName: botSagas.name,
				name: botCharacters.name,
				race: botCharacters.race,
				characterImage: botCharacters.image,
			})
			.from(botCharacterVariants)
			.innerJoin(botSagas, eq(botCharacterVariants.sagaId, botSagas.id))
			.innerJoin(botCharacters, eq(botCharacterVariants.characterId, botCharacters.id))
			.where(and(eq(botCharacterVariants.visible, true), eq(botCharacters.visible, true)))
			.orderBy(asc(botCharacters.name), asc(botSagas.series), asc(botSagas.orderIdx));
		return rows.map((r) => ({
			id: r.id,
			characterId: r.characterId,
			name: r.name,
			saga: r.sagaName,
			sagaId: r.sagaId,
			slug: r.slug,
			image: r.image,
			characterImage: r.characterImage,
			race: r.race,
			form: r.form,
		}));
	} catch (e) {
		console.error("[shenron] getShenronVariantCards a échoué:", e);
		throw new Error("Character variants are temporarily unavailable.", { cause: e });
	}
}

/**
 * Nombre de versions par saga. Sert à décider si la bascule « Versions » a un
 * sens — la page n'a pas besoin des 451 lignes pour afficher un bouton.
 */
export async function countVariantCards(): Promise<number> {
	try {
		// Les deux jointures ne sont pas décoratives : ce compteur doit rendre
		// EXACTEMENT ce que `getShenronVariantCards` — la source de la grille —
		// finit par afficher, et cette lecture-là écarte les versions rattachées à
		// une fiche masquée comme celles dont la saga n'existe plus. Sans elles, le
		// compteur annonçait « 12 / 451 versions » pour une liste qui n'en contient
		// pas 451. Toute jointure ajoutée là-bas doit l'être ici aussi.
		const [r] = await db
			.select({ n: count() })
			.from(botCharacterVariants)
			.innerJoin(botSagas, eq(botCharacterVariants.sagaId, botSagas.id))
			.innerJoin(botCharacters, eq(botCharacterVariants.characterId, botCharacters.id))
			.where(and(eq(botCharacterVariants.visible, true), eq(botCharacters.visible, true)));
		return Number(r?.n ?? 0);
	} catch (e) {
		console.error("[shenron] countVariantCards a échoué:", e);
		throw new Error("Character variant count is temporarily unavailable.", { cause: e });
	}
}

/** Personnage relevé dans une saga (lecture inverse des variantes). */
export interface SagaCharacter {
	characterId: number;
	slug: string;
	name: string;
	image: string | null;
	race: string | null;
	form: string | null;
	role: string | null;
	firstVolume: number | null;
	lastVolume: number | null;
	/** Nombre de planches du manga où le nom a été relevé. */
	planches: number | null;
	/** Nombre de synopsis d'épisode où le nom a été relevé. */
	synopsis: number | null;
	/** Poids de preuve, toutes sources confondues — sert au tri. */
	poids: number;
}

/**
 * Qui apparaît dans cette saga — la lecture inverse de `getShenronCharacterVariants`.
 *
 * Trié par volume de preuve décroissant : sur une saga, les personnages relevés
 * sur cent planches sont ceux du récit, ceux relevés sur trois sont cités en
 * passant. Un tri alphabétique mettrait Bacterian avant Goku.
 */
export async function getShenronSagaCharacters(sagaId: number): Promise<SagaCharacter[]> {
	try {
		const rows = await db
			.select({ v: botCharacterVariants, c: botCharacters })
			.from(botCharacterVariants)
			.innerJoin(botCharacters, eq(botCharacterVariants.characterId, botCharacters.id))
			.where(
				and(
					eq(botCharacterVariants.sagaId, sagaId),
					eq(botCharacterVariants.visible, true),
					eq(botCharacters.visible, true)
				)
			);
		const tous = rows
			.map(({ v, c }) => ({
				characterId: c.id,
				slug: formatCharacterSlug(c),
				name: c.name,
				image: c.image,
				race: c.race,
				form: v.form,
				role: v.role,
				firstVolume: v.firstVolume,
				lastVolume: v.lastVolume,
				planches: v.evidence?.planches || null,
				synopsis: v.evidence?.synopsis || null,
				// Une saga sans manga (GT, Daima, Super) n'a QUE des synopsis : trier
				// sur les seules planches y mettrait tout le monde à zéro, donc dans
				// l'ordre alphabétique — Bébi après Baba.
				poids: (v.evidence?.planches ?? 0) + (v.evidence?.synopsis ?? 0) * 3,
			}))
			.toSorted((a, b) => b.poids - a.poids || a.name.localeCompare(b.name, "fr"));

		// La base porte des fiches en double pour plusieurs personnages majeurs
		// (« Goku » id 1 ET « Son Goku », « Gohan » ET « Son Gohan ») : mesurées
		// sur les mêmes graphies, elles produisent deux entrées identiques dans
		// la liste d'une saga. On n'en montre qu'une — celle qui porte le plus de
		// preuve, l'id le plus petit départageant. Ce n'est PAS un correctif du
		// doublon en base, seulement le refus de l'afficher deux fois.
		const vues = new Map<string, SagaCharacter>();
		for (const p of tous) {
			const cle = foldName(stripVersionSuffix(p.name).replace(/^son\s+/i, ""));
			const dejaLa = vues.get(cle);
			if (
				!dejaLa ||
				p.poids > dejaLa.poids ||
				(p.poids === dejaLa.poids && p.characterId < dejaLa.characterId)
			) {
				vues.set(cle, p);
			}
		}
		return [...vues.values()].toSorted(
			(a, b) => b.poids - a.poids || a.name.localeCompare(b.name, "fr")
		);
	} catch (e) {
		console.error("[shenron] getShenronSagaCharacters a échoué:", e);
		return [];
	}
}

export async function getShenronCharacter(
	idOrSlug: number | string
): Promise<CharacterWithRelations | null> {
	try {
		let id: number | null = null;
		if (typeof idOrSlug === "number") {
			id = idOrSlug;
		} else {
			const resolved = resolveCharacterParam(idOrSlug);
			if (resolved.id !== null) {
				id = resolved.id;
			}
		}

		let c: CharacterRow | undefined;
		if (id !== null) {
			[c] = await db
				.select()
				.from(botCharacters)
				.where(and(eq(botCharacters.id, id), eq(botCharacters.visible, true)))
				.limit(1);
		} else if (typeof idOrSlug === "string") {
			const all = await db
				.select()
				.from(botCharacters)
				.where(eq(botCharacters.visible, true));
			c = all.find((char) => formatCharacterSlug(char) === idOrSlug);
			if (c) id = c.id;
		}

		if (!c || id === null) return null;

		// Les cinq requêtes qui suivent ne dépendent QUE de la ligne `c` déjà
		// chargée, jamais les unes des autres — elles étaient pourtant enchaînées :
		// cinq allers-retours en série sur le chemin de rendu de CHAQUE fiche de
		// personnage. Un seul `Promise.all` ramène la latence à celle de la plus
		// lente. Les branches inutiles rendent un tableau vide sans toucher la base.
		const rootRaw = stripVersionSuffix(c.name);
		const selfRoot = foldName(rootRaw);
		const aff = (c.affiliation ?? "").trim();
		// Préfixe insensible casse+accents : « Végéta (futur) » est bien candidat de
		// « Vegeta ». `%`, `_` et l'antislash sont échappés pour LIKE.
		const versionPrefix = rootRaw.replace(/[\\%_]/g, (m) => `\\${m}`) + "%";

		const [
			transfoRows,
			planetRow,
			techRows,
			versionCandidates,
			affiliateRows,
			battleRows,
			allVoiceActors,
		] = await Promise.all([
			db
				.select()
				.from(botTransformations)
				.where(and(eq(botTransformations.characterId, id), eq(botTransformations.visible, true))),
			c.originPlanetId != null
				? db
						.select()
						.from(botPlanets)
						.where(and(eq(botPlanets.id, c.originPlanetId), eq(botPlanets.visible, true)))
						.limit(1)
				: Promise.resolve([]),
			db
				.select({ t: botTechniques })
				.from(botCharacterTechniques)
				.innerJoin(botTechniques, eq(botCharacterTechniques.techniqueId, botTechniques.id))
				.where(and(eq(botCharacterTechniques.characterId, id), eq(botTechniques.visible, true))),
			// Versions alternatives : « Freezer » ↔ « Freezer (futur) » / « (Xeno) ».
			// Candidats par préfixe (indexable), puis filtre sur le nom racine
			// normalisé côté JS — plus sûr qu'un regex en SQL.
			selfRoot.length >= 2
				? db
						.select({
							id: botCharacters.id,
							name: botCharacters.name,
							image: botCharacters.image,
							race: botCharacters.race,
						})
						.from(botCharacters)
						.where(
							and(
								eq(botCharacters.visible, true),
								ne(botCharacters.id, id),
								sql`unaccent(lower(${botCharacters.name})) like unaccent(lower(${versionPrefix}))`
							)
						)
						.orderBy(asc(botCharacters.name))
						.limit(80)
				: Promise.resolve([]),
			// Personnages affiliés : même affiliation (hors valeurs poubelle).
			aff && !AFFILIATION_BLOCKLIST.has(foldName(aff))
				? db
						.select({
							id: botCharacters.id,
							name: botCharacters.name,
							image: botCharacters.image,
							race: botCharacters.race,
						})
						.from(botCharacters)
						.where(
							and(
								eq(botCharacters.visible, true),
								ne(botCharacters.id, id),
								eq(botCharacters.affiliation, aff)
							)
						)
						.orderBy(asc(botCharacters.name))
						.limit(16)
				: Promise.resolve([]),
			// Combats légendaires impliquant ce personnage
			db
				.select({
					id: botBattles.id,
					slug: botBattles.slug,
					title: botBattles.title,
					titleJa: botBattles.titleJa,
					series: botBattles.series,
					winnerName: botBattles.winnerName,
					climaxSummary: botBattles.climaxSummary,
					location: botBattles.location,
				})
				.from(botBattles)
				.where(
					and(
						eq(botBattles.visible, true),
						sql`unaccent(lower(${botBattles.title})) like unaccent(lower(${'%' + rootRaw + '%'})) or unaccent(lower(${botBattles.winnerName})) like unaccent(lower(${'%' + rootRaw + '%'}))`
					)
				)
				.limit(12),
			// Casting et comédiens de doublage
			db
				.select({
					id: botVoiceActors.id,
					slug: botVoiceActors.slug,
					name: botVoiceActors.name,
					nameJa: botVoiceActors.nameJa,
					nationality: botVoiceActors.nationality,
					roles: botVoiceActors.roles,
				})
				.from(botVoiceActors)
				.where(eq(botVoiceActors.visible, true)),
		]);

		const transformations = transfoRows.map(mapTransfo);
		const originPlanet = planetRow[0] ? mapPlanet(planetRow[0]) : null;
		const versions: RelatedCharacter[] = versionCandidates
			.filter((r) => foldName(stripVersionSuffix(r.name)) === selfRoot)
			.slice(0, 16)
			.map((r) => ({
				id: r.id,
				slug: formatCharacterSlug(r),
				name: r.name,
				image: r.image,
				race: r.race,
			}));
		const affiliates: RelatedCharacter[] = affiliateRows.map((r) => ({
			id: r.id,
			slug: formatCharacterSlug(r),
			name: r.name,
			image: r.image,
			race: r.race,
		}));

		const techniques = techRows.map((r) => ({
			technique: {
				id: r.t.id,
				slug: r.t.slug,
				name: r.t.name,
				description: r.t.description,
				type: r.t.type,
				creatorId: r.t.creatorId,
				creatorName: null,
				creatorImage: null,
				image: r.t.image ?? null,
				article: r.t.article ?? null,
				articleSources: r.t.articleSources ?? null,
			} satisfies DBTechnique,
		}));

		const battles: CharacterBattle[] = battleRows.map((b) => ({
			id: b.id,
			slug: b.slug,
			title: b.title,
			titleJa: b.titleJa,
			series: b.series,
			winnerName: b.winnerName,
			climaxSummary: b.climaxSummary,
			location: b.location,
		}));

		const voiceActors: CharacterVoiceActor[] = allVoiceActors.flatMap((va) => {
			const matchingRole = va.roles.find((r) => {
				const rNorm = foldName(r.characterName);
				return rNorm.includes(selfRoot) || selfRoot.includes(rNorm);
			});
			if (!matchingRole) return [];
			return [
				{
					id: va.id,
					slug: va.slug,
					name: va.name,
					nameJa: va.nameJa,
					nationality: va.nationality,
					roleNotes: matchingRole.series || matchingRole.notes || null,
				},
			];
		});

		return {
			...mapCharacter(c),
			transformations,
			originPlanet,
			techniques,
			versions,
			affiliates,
			battles,
			voiceActors,
		};
	} catch (e) {
		console.error("[shenron] getShenronCharacter a échoué:", e);
		return null;
	}
}

export async function getShenronTechniques(): Promise<DBTechnique[]> {
	try {
		const rows = await db
			.select({ t: botTechniques, name: botCharacters.name, image: botCharacters.image })
			.from(botTechniques)
			.leftJoin(botCharacters, eq(botTechniques.creatorId, botCharacters.id))
			.where(eq(botTechniques.visible, true));
		return rows.map((r) => ({
			id: r.t.id,
			slug: r.t.slug,
			name: r.t.name,
			description: r.t.description,
			type: r.t.type,
			creatorId: r.t.creatorId,
			creatorName: r.name ?? null,
			creatorImage: r.image ?? null,
			// Illustration propre à la technique (portrait XV2). Distincte du
			// portrait du créateur, qui n'existe que sur 11 fiches.
			image: r.t.image ?? null,
			article: r.t.article ?? null,
			articleSources: r.t.articleSources ?? null,
		}));
	} catch (e) {
		console.error("[shenron] getShenronTechniques a échoué:", e);
		return [];
	}
}

export async function getShenronTechnique(slug: string): Promise<DBTechnique | null> {
	try {
		const [r] = await db
			.select({
				t: botTechniques,
				charId: botCharacters.id,
				charName: botCharacters.name,
				charNameJa: botCharacters.nameJa,
				charNameRomaji: botCharacters.nameRomaji,
				charImage: botCharacters.image,
				charVisible: botCharacters.visible,
			})
			.from(botTechniques)
			.leftJoin(botCharacters, eq(botTechniques.creatorId, botCharacters.id))
			.where(and(eq(botTechniques.slug, slug), eq(botTechniques.visible, true)))
			.limit(1);
		if (!r || !r.t) return null;

		let creatorId = r.t.creatorId;
		let creatorName = r.charName ?? null;
		let creatorImage = r.charImage ?? null;
		let creatorSlug: string | null = null;

		if (r.charId != null) {
			const targetRedirectId = CHARACTER_DUPLICATE_REDIRECTS[r.charId];
			if (targetRedirectId) {
				const [canonicalChar] = await db
					.select({
						id: botCharacters.id,
						name: botCharacters.name,
						nameJa: botCharacters.nameJa,
						nameRomaji: botCharacters.nameRomaji,
						image: botCharacters.image,
					})
					.from(botCharacters)
					.where(and(eq(botCharacters.id, targetRedirectId), eq(botCharacters.visible, true)))
					.limit(1);
				if (canonicalChar) {
					creatorId = canonicalChar.id;
					creatorName = canonicalChar.name;
					creatorImage = canonicalChar.image;
					creatorSlug = formatCharacterSlug(canonicalChar);
				}
			} else if (r.charVisible) {
				creatorSlug = formatCharacterSlug({
					id: r.charId,
					name: r.charName ?? "",
					nameJa: r.charNameJa,
					nameRomaji: r.charNameRomaji,
				});
			} else {
				creatorId = null;
				creatorName = null;
				creatorImage = null;
			}
		}

		let battles: CharacterBattle[] = [];
		try {
			const allBattles = await db.select().from(botBattles).where(eq(botBattles.visible, true));
			const techNameLower = r.t.name.toLowerCase();
			battles = allBattles
				.filter((b) => {
					if (b.techniquesUsed && Array.isArray(b.techniquesUsed)) {
						if (b.techniquesUsed.some((tu) => typeof tu === "string" && (tu.toLowerCase().includes(techNameLower) || techNameLower.includes(tu.toLowerCase())))) {
							return true;
						}
					}
					if (b.climaxSummary && b.climaxSummary.toLowerCase().includes(techNameLower)) {
						return true;
					}
					return false;
				})
				.map((b) => ({
					id: b.id,
					slug: b.slug,
					title: b.title,
					titleJa: b.titleJa,
					series: b.series,
					winnerName: b.winnerName,
					climaxSummary: b.climaxSummary,
					location: b.location,
				}));
		} catch {}

		// Pratiquants, première apparition et transformations liées — indépendants
		// les uns des autres, un seul aller-retour.
		const [practitionerRows, debutEpisodeRows, debutChapterRows, relatedTransfoRows] =
			await Promise.all([
				db
					.select({
						id: botCharacters.id,
						name: botCharacters.name,
						nameJa: botCharacters.nameJa,
						nameRomaji: botCharacters.nameRomaji,
						image: botCharacters.image,
						race: botCharacters.race,
					})
					.from(botCharacterTechniques)
					.innerJoin(botCharacters, eq(botCharacterTechniques.characterId, botCharacters.id))
					.where(
						and(eq(botCharacterTechniques.techniqueId, r.t.id), eq(botCharacters.visible, true))
					),
				r.t.debutEpisodeId != null
					? db
							.select({
								id: botEpisodes.id,
								numberInSeries: botEpisodes.numberInSeries,
								title: botEpisodes.title,
							})
							.from(botEpisodes)
							.where(eq(botEpisodes.id, r.t.debutEpisodeId))
							.limit(1)
					: Promise.resolve([]),
				r.t.debutChapterId != null
					? db
							.select({
								id: botMangaChapters.id,
								chapterNumber: botMangaChapters.chapterNumber,
								title: botMangaChapters.title,
							})
							.from(botMangaChapters)
							.where(eq(botMangaChapters.id, r.t.debutChapterId))
							.limit(1)
					: Promise.resolve([]),
				creatorId != null
					? db
							.select({
								id: botTransformations.id,
								name: botTransformations.name,
								image: botTransformations.image,
								article: botTransformations.article,
							})
							.from(botTransformations)
							.where(and(eq(botTransformations.characterId, creatorId), eq(botTransformations.visible, true)))
					: Promise.resolve([]),
			]);

		const practitioners: RelatedCharacter[] = practitionerRows.map((p) => ({
			id: p.id,
			slug: formatCharacterSlug(p),
			name: p.name,
			image: p.image,
			race: p.race,
		}));

		return {
			id: r.t.id,
			slug: r.t.slug,
			name: r.t.name,
			nameJa: r.t.nameJa ?? null,
			nameRomaji: r.t.nameRomaji ?? null,
			description: r.t.description,
			type: r.t.type,
			creatorId,
			creatorSlug,
			creatorName,
			creatorImage,
			// Illustration propre à la technique (portrait XV2). Distincte du
			// portrait du créateur, qui n'existe que sur 11 fiches.
			image: r.t.image ?? null,
			article: r.t.article ?? null,
			articleSources: r.t.articleSources ?? null,
			battles,
			practitioners,
			debutEpisode: debutEpisodeRows[0]
				? {
						id: debutEpisodeRows[0].id,
						numberInSeries: debutEpisodeRows[0].numberInSeries,
						title: debutEpisodeRows[0].title,
					}
				: null,
			debutChapter: debutChapterRows[0]
				? {
						id: debutChapterRows[0].id,
						chapterNumber: debutChapterRows[0].chapterNumber,
						title: debutChapterRows[0].title,
					}
				: null,
			relatedTransformations: relatedTransfoRows.map((t) => ({
				id: t.id,
				slug: formatTransformationSlug(t),
				name: t.name,
				image: t.image,
				// Même seuil que `getShenronTransformation` : une forme sans article
				// n'a pas de page, le lien serait un 404.
				hasArticle: !!t.article && t.article.trim().length > 50,
			})),
		};
	} catch (e) {
		console.error("[shenron] getShenronTechnique a échoué:", e);
		return null;
	}
}

async function getShenronGames(): Promise<DBGame[]> {
	try {
		return (await db.select().from(botGames).where(eq(botGames.visible, true))) as DBGame[];
	} catch (e) {
		console.error("[shenron] getShenronGames a échoué:", e);
		return [];
	}
}

/**
 * Fiche de jeu par slug. Le filtre `visible` n'est pas décoratif : c'est la
 * suppression logique du wiki (jamais de DELETE éditorial). Sans lui, cette
 * fonction était la seule lecture par clé de tout le module à rendre une fiche
 * masquée — tous ses voisins (`getShenronMovie`, `getShenronTechnique`,
 * `getShenronRace`, `getShenronPlanet`) le portent, comme `dbUniverse.game`.
 */
async function getShenronGame(slug: string): Promise<DBGame | null> {
	try {
		const [g] = await db
			.select()
			.from(botGames)
			.where(and(eq(botGames.slug, slug), eq(botGames.visible, true)))
			.limit(1);
		return (g as DBGame) ?? null;
	} catch (e) {
		console.error("[shenron] getShenronGame a échoué:", e);
		return null;
	}
}

async function getShenronManga(): Promise<DBMangaVolume[]> {
	try {
		const rows = await db
			.select()
			.from(botMangaVolumes)
			.where(and(eq(botMangaVolumes.series, "DB"), eq(botMangaVolumes.visible, true)))
			.orderBy(asc(botMangaVolumes.volumeNumber));
		return rows.map((r) => ({
			id: r.id,
			series: r.series,
			volumeNumber: r.volumeNumber ?? 0,
			title: r.title,
			cover: r.cover,
		}));
	} catch (e) {
		console.error("[shenron] getShenronManga a échoué:", e);
		return [];
	}
}

export async function getShenronRaces(): Promise<DBRace[]> {
	try {
		return (await db.select().from(botRaces).where(eq(botRaces.visible, true))) as DBRace[];
	} catch (e) {
		console.error("[shenron] getShenronRaces a échoué:", e);
		return [];
	}
}

/** Transformation avec son article, son personnage porteur et ses sœurs. */
export interface DBTransformationDetail {
	id: number;
	slug: string;
	name: string;
	image: string | null;
	ki: string | null;
	article: string | null;
	articleSources: unknown;
	character: { id: number; slug: string; name: string; image: string | null } | null;
	/** Autres transformations du même personnage, pour naviguer entre les formes. */
	voisines: Array<{ id: number; slug: string; name: string; image: string | null; aArticle: boolean }>;
}

/**
 * Transformations qui MÉRITENT une page : celles qui portent un article.
 *
 * 23 des 81 en ont un — « Super Saiyan » fait 3 175 caractères — et aucun
 * n'était lisible nulle part : l'index regroupe par nom et renvoie vers la
 * fiche du personnage, sans jamais afficher le texte. Générer les 81 pages
 * produirait en revanche 58 pages quasi vides, c'est-à-dire du contenu mince
 * annoncé à un moteur de recherche.
 */
export async function getTransformationsAvecArticle(): Promise<Array<{ id: number; slug: string }>> {
	try {
		const rows = await db
			.select({ id: botTransformations.id, name: botTransformations.name })
			.from(botTransformations)
			.where(
				and(
					eq(botTransformations.visible, true),
					sql`length(trim(coalesce(${botTransformations.article}, ''))) > 50`
				)
			);
		return rows.map((r) => ({
			id: r.id,
			slug: formatTransformationSlug(r),
		}));
	} catch (e) {
		console.error("[shenron] getTransformationsAvecArticle a échoué:", e);
		return [];
	}
}

/**
 * TOUTES les transformations visibles (id + slug), pour prérendre la rubrique
 * en entier — pas seulement les 23 qui portent un article. Une fiche sans
 * article rend désormais le même état vide que les autres rubriques
 * (`WikiFicheVide`) plutôt qu'un 404 : `getTransformationsAvecArticle` reste
 * utilisée là où seule l'existence d'un texte compte (index, cartes).
 */
async function getShenronTransformationIds(): Promise<Array<{ id: number; slug: string }>> {
	try {
		const rows = await db
			.select({ id: botTransformations.id, name: botTransformations.name })
			.from(botTransformations)
			.where(eq(botTransformations.visible, true));
		return rows.map((r) => ({ id: r.id, slug: formatTransformationSlug(r) }));
	} catch (e) {
		console.error("[shenron] getShenronTransformationIds a échoué:", e);
		return [];
	}
}

export async function getShenronTransformation(
	idOrSlug: number | string
): Promise<DBTransformationDetail | null> {
	try {
		let id: number | null = null;
		if (typeof idOrSlug === "number") {
			id = idOrSlug;
		} else {
			const resolved = resolveTransformationParam(idOrSlug);
			if (resolved.id !== null) {
				id = resolved.id;
			}
		}

		let row: { t: TransfoRow; c: CharacterRow | null } | undefined;
		if (id !== null) {
			[row] = await db
				.select({ t: botTransformations, c: botCharacters })
				.from(botTransformations)
				.leftJoin(botCharacters, eq(botTransformations.characterId, botCharacters.id))
				.where(and(eq(botTransformations.id, id), eq(botTransformations.visible, true)))
				.limit(1);
		} else if (typeof idOrSlug === "string") {
			const all = await db
				.select({ t: botTransformations, c: botCharacters })
				.from(botTransformations)
				.leftJoin(botCharacters, eq(botTransformations.characterId, botCharacters.id))
				.where(eq(botTransformations.visible, true));
			row = all.find((r) => formatTransformationSlug(r.t) === idOrSlug);
			if (row) id = row.t.id;
		}

		if (!row || id === null) return null;

		const voisines = row.t.characterId
			? await db
					.select({
						id: botTransformations.id,
						name: botTransformations.name,
						image: botTransformations.image,
						article: botTransformations.article,
					})
					.from(botTransformations)
					.where(
						and(
							eq(botTransformations.characterId, row.t.characterId),
							eq(botTransformations.visible, true),
							ne(botTransformations.id, id)
						)
					)
			: [];

		return {
			id: row.t.id,
			slug: formatTransformationSlug(row.t),
			name: row.t.name,
			image: row.t.image,
			ki: row.t.ki,
			article: row.t.article ?? null,
			articleSources: row.t.articleSources ?? null,
			character: row.c
				? {
						id: row.c.id,
						slug: formatCharacterSlug(row.c),
						name: row.c.name,
						image: row.c.image,
					}
				: null,
			voisines: voisines.map((v) => ({
				id: v.id,
				slug: formatTransformationSlug(v),
				name: v.name,
				image: v.image,
				// Une forme sans article n'a pas de page : le lien serait un 404.
				aArticle: !!v.article && v.article.trim().length > 50,
			})),
		};
	} catch (e) {
		console.error("[shenron] getShenronTransformation a échoué:", e);
		return null;
	}
}

export async function getShenronRace(
	slug: string
): Promise<(DBRace & { characters: DBCharacter[]; homePlanet: DBPlanet | null }) | null> {
	try {
		const [r] = await db
			.select()
			.from(botRaces)
			.where(and(eq(botRaces.slug, slug), eq(botRaces.visible, true)))
			.limit(1);
		if (!r) return null;

		// Deux temps : la requête ramène les personnages dont la graphie brute est
		// candidate, puis `slugDeRace` trie — la désambiguïsation Kaïo/Kaïoshin se
		// joue sur le NOM du personnage (`Nucleico` étiquette les deux races), ce
		// qu'aucun `where` sur la seule colonne `race` ne peut faire.
		const rawRaces = graphiesDeRace(r.slug, r.name);
		const characters = (
			await db
				.select()
				.from(botCharacters)
				.where(and(inArray(botCharacters.race, rawRaces), eq(botCharacters.visible, true)))
		)
			.filter((c) => slugDeRace(c.race, c.name) === r.slug)
			.map(mapCharacter);

		let homePlanet: DBPlanet | null = null;
		if (r.homePlanetId) {
			const [p] = await db
				.select()
				.from(botPlanets)
				.where(and(eq(botPlanets.id, r.homePlanetId), eq(botPlanets.visible, true)))
				.limit(1);
			if (p) {
				homePlanet = mapPlanet(p);
			}
		}

		return { ...(r as DBRace), characters, homePlanet };
	} catch (e) {
		console.error("[shenron] getShenronRace a échoué:", e);
		return null;
	}
}

async function getShenronPlanets(): Promise<DBPlanet[]> {
	try {
		return (await db.select().from(botPlanets).where(eq(botPlanets.visible, true))).map(mapPlanet);
	} catch (e) {
		console.error("[shenron] getShenronPlanets a échoué:", e);
		return [];
	}
}

export async function getShenronPlanet(
	idOrSlug: number | string
): Promise<(DBPlanet & { characters: DBCharacter[] }) | null> {
	try {
		let id: number | null = null;
		if (typeof idOrSlug === "number") {
			id = idOrSlug;
		} else {
			const resolved = resolvePlanetParam(idOrSlug);
			if (resolved.id !== null) {
				id = resolved.id;
			}
		}

		let p: PlanetRow | undefined;
		if (id !== null) {
			[p] = await db
				.select()
				.from(botPlanets)
				.where(and(eq(botPlanets.id, id), eq(botPlanets.visible, true)))
				.limit(1);
		} else if (typeof idOrSlug === "string") {
			const all = await db.select().from(botPlanets).where(eq(botPlanets.visible, true));
			p = all.find((planet) => formatPlanetSlug(planet) === idOrSlug);
			if (p) id = p.id;
		}

		if (!p || id === null) return null;
		const characters = (
			await db
				.select()
				.from(botCharacters)
				.where(and(eq(botCharacters.originPlanetId, id), eq(botCharacters.visible, true)))
		).map(mapCharacter);
		return { ...mapPlanet(p), characters };
	} catch (e) {
		console.error("[shenron] getShenronPlanet a échoué:", e);
		return null;
	}
}

/** Races dont le monde d'origine (`db_races.home_planet_id`) est cette planète. */
async function getShenronPlanetRaces(planetId: number): Promise<DBRace[]> {
	try {
		return (await db
			.select()
			.from(botRaces)
			.where(and(eq(botRaces.homePlanetId, planetId), eq(botRaces.visible, true)))) as DBRace[];
	} catch (e) {
		console.error("[shenron] getShenronPlanetRaces a échoué:", e);
		return [];
	}
}

/** Bornes manga/anime d'une saga (`bot.db_sagas`) — non portées par `dbUniverse.saga()`. */
interface SagaBounds {
	mangaVolumeStart: number | null;
	mangaVolumeEnd: number | null;
	mangaChapterStart: number | null;
	mangaChapterEnd: number | null;
	episodeSeries: string | null;
	episodeStart: number | null;
	episodeEnd: number | null;
}

async function getShenronSagaBounds(sagaId: number): Promise<SagaBounds | null> {
	try {
		const [s] = await db
			.select({
				mangaVolumeStart: botSagas.mangaVolumeStart,
				mangaVolumeEnd: botSagas.mangaVolumeEnd,
				mangaChapterStart: botSagas.mangaChapterStart,
				mangaChapterEnd: botSagas.mangaChapterEnd,
				episodeSeries: botSagas.episodeSeries,
				episodeStart: botSagas.episodeStart,
				episodeEnd: botSagas.episodeEnd,
			})
			.from(botSagas)
			.where(and(eq(botSagas.id, sagaId), eq(botSagas.visible, true)))
			.limit(1);
		return s ?? null;
	} catch (e) {
		console.error("[shenron] getShenronSagaBounds a échoué:", e);
		return null;
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Runtime du bot (XP/zeni/shop/personas live) — reste sur l'API REST : ces
// données changent en continu et n'ont pas de sens à miroiter (le miroir a
// 30 min de retard, inacceptable pour un leaderboard).
// ─────────────────────────────────────────────────────────────────────────

export interface PersonaInfo {
	id: string;
	name: string;
	username: string | null;
	avatar: string | null;
	online: boolean;
	wsPing: number;
	intents: number;
	guildCount: number;
	commandCount: number;
}

export interface CommandInfo {
	name: string;
	description: string;
	type: number;
	options?: Array<{
		name: string;
		description?: string;
		type: number;
		required?: boolean;
	}>;
}

export interface ShenronStats {
	users: number;
	totalXp: number;
	totalZeni: number;
	achievementsUnlocked: number;
	shopItems: number;
	inventoryItems: number;
}

/**
 * Statistiques du bot.
 *
 * `revalidateSec` est un PARAMÈTRE parce que la fraîcheur utile dépend de la
 * page : sur `/stats` elle est le sujet, sur l'accueil elle est remplacée par
 * le suivi temps réel dès l'hydratation. Et en Next, le `revalidate` le plus
 * court d'une route l'emporte sur tous les autres — un `fetch` à 30 s ici
 * annulait silencieusement le `revalidate = 900` déclaré par la page d'accueil,
 * qui continuait donc à se régénérer toutes les 30 secondes.
 */
export async function getShenronStats(revalidateSec = 30): Promise<ShenronStats> {
	const fallback: ShenronStats = {
		users: 0,
		totalXp: 0,
		totalZeni: 0,
		achievementsUnlocked: 0,
		shopItems: 0,
		inventoryItems: 0,
	};
	try {
		const res = await fetch(`${SHENRON_API_URL}/api/public/stats`, {
			next: { revalidate: revalidateSec },
		});
		if (!res.ok) return fallback;
		return { ...fallback, ...(await res.json()) };
	} catch {
		return fallback;
	}
}

export async function getShenronPersonas(revalidateSec = 30): Promise<PersonaInfo[]> {
	try {
		const res = await fetch(`${SHENRON_API_URL}/api/public/personas`, {
			next: { revalidate: revalidateSec },
		});
		if (!res.ok) return [];
		const data = await res.json();
		return data.personas || [];
	} catch {
		return [];
	}
}

export async function getShenronCommands(): Promise<Record<string, CommandInfo[]>> {
	try {
		const res = await fetch(`${SHENRON_API_URL}/api/public/commands`, {
			next: { revalidate: 300 },
		});
		if (!res.ok) return {};
		const data = await res.json();
		return data.commands || {};
	} catch {
		return {};
	}
}
