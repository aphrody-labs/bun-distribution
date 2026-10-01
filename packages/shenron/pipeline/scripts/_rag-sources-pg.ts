/**
 * _rag-sources-pg.ts — rendu des chunks RAG depuis PostgreSQL, partagé.
 *
 * PostgreSQL (`shenron_site`) est la source de vérité éditoriale ; le réplica
 * SQLite du bot n'en porte qu'une projection (ni `article`, ni `visible` sur les
 * personnages, ni les sections de fiches, ni les références canon). Indexer le
 * réplica laissait donc hors du RAG l'essentiel de ce que le site publie, et y
 * gardait des fiches masquées.
 *
 * Chaque source rend des chunks de la même forme que `rag-build.ts` (même
 * découpage, mêmes URL que les routes réelles du site), pour que
 * `rag-resync-entites.ts` (différentiel à chaud) et le build complet produisent
 * un index identique.
 *
 * Règles communes :
 *   - seules les lignes visibles sont indexées (suppression logique respectée) ;
 *   - l'URL est la route canonique du site (slug), jamais une URL qui redirige ;
 *   - une ligne sans texte exploitable ne produit aucun chunk.
 */
import type postgres from "postgres";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadDatabaseUrl } from "@shenron/db/env";
import { createSql } from "@shenron/db/sql";
import { chunkDocument } from "./_rag-chunk";
import { defautDePlanche } from "@shenron/config/databooks-defauts";
import {
	CHARACTER_DUPLICATE_REDIRECTS,
	formatCharacterSlug,
	formatPlanetSlug,
	formatTransformationSlug,
} from "@shenron/config/wiki-slugs";

type Sql = postgres.Sql;
type Row = Record<string, unknown>;

/** Un chunk tel qu'il sera écrit dans `rag_chunks`. */
export interface SourceChunk {
	kind: string;
	title: string;
	url: string;
	content: string;
	lang: string;
	entity: string;
}

const ROOT = new URL("../../../../apps/shenron/bot/", import.meta.url).pathname;
const CHUNK_CHARS = 1400;
const CHUNK_OVERLAP = 0.15;

export const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
export const propre = (t: string) => t.replace(/\s+/g, " ").trim();
const VISIBLE = "coalesce(visible::int, 1) <> 0";

// ── Résolution d'entité ─────────────────────────────────────────────────────

/**
 * Table d'alias commune au build et à la resynchronisation. Les clés numériques
 * ou trop courtes (« 16 » → Android 16, « 11 » → Univers 11) sont écartées :
 * elles étiquetaient comme « Android 16 » tout passage contenant le nombre 16,
 * ce qui faussait le filtre `entity=` de l'API.
 */
const aliasMap: Record<string, { canonical: string }> = await Bun.file(
	join(ROOT, "data/rag/alias-map.json")
)
	.json()
	.catch(() => ({}));
const aliasPatterns = Object.keys(aliasMap)
	.filter((k) => k.length >= 4 && !/^\d+$/.test(k))
	.toSorted((a, b) => b.length - a.length)
	.map((k) => ({
		key: k,
		re: new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
		canonical: aliasMap[k]!.canonical,
	}));

export function normalizeKey(str: string): string {
	return str
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function resolveEntity(text: string): string {
	const norm = normalizeKey(text);
	for (const { key, re, canonical } of aliasPatterns) {
		if (norm.includes(key) && re.test(norm)) return canonical;
	}
	return "";
}

// ── Rendu ───────────────────────────────────────────────────────────────────

interface Base {
	kind: string;
	title: string;
	url: string;
	lang?: string;
	entity?: string;
}

/** Découpe `markdown` comme `rag-build` et pousse les chunks dans `out`. */
function pousse(out: SourceChunk[], base: Base, markdown: string): void {
	const texte = markdown.trim();
	if (texte.length < 12) return;
	for (const c of chunkDocument(texte, CHUNK_CHARS, CHUNK_OVERLAP)) {
		const content = propre(c.content);
		if (content.length < 12) continue;
		out.push({
			kind: base.kind,
			title: base.title,
			url: base.url,
			content,
			lang: base.lang ?? "fr",
			entity: base.entity || resolveEntity(base.title) || resolveEntity(content),
		});
	}
}

/** Phrase « Libellé : valeur » seulement si la valeur existe. */
const champ = (label: string, v: unknown) => (s(v).trim() ? `${label} : ${s(v).trim()}.` : "");

/** Les dates sont stockées en secondes Unix : « 637027200 » n'apprend rien à un lecteur. */
function date(v: unknown): string {
	const n = Number(v);
	if (!s(v).trim() || !Number.isFinite(n) || n <= 0) return s(v);
	return new Date(n * 1000).toLocaleDateString("fr-FR", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});
}
const lignes = (...parts: string[]) => parts.filter((p) => p.trim()).join("\n");

/** Tableau JSON stocké en texte ou en jsonb → liste de chaînes. */
function liste(v: unknown, cle?: string): string[] {
	if (typeof v === "string") {
		try {
			const parsed = JSON.parse(v);
			if (Array.isArray(parsed)) {
				return parsed
					.map((x) => (cle && x && typeof x === "object" ? s((x as Row)[cle]) : s(x)))
					.map((x) => x.trim())
					.filter(Boolean);
			}
		} catch {
			return v.trim() ? [v.trim()] : [];
		}
	}
	if (!Array.isArray(v)) return [];
	return v
		.map((x) => (cle && x && typeof x === "object" ? s((x as Row)[cle]) : s(x)))
		.map((x) => x.trim())
		.filter(Boolean);
}

const fourchette = (label: string, a: unknown, b: unknown) => {
	if (!s(a)) return "";
	return s(b) && s(b) !== s(a) ? `${label} ${s(a)} à ${s(b)}` : `${label} ${s(a)}`;
};

// ── Personnages ─────────────────────────────────────────────────────────────

interface Personnage {
	id: number;
	name: string;
	slug: string;
}

/** Personnages visibles, avec l'URL de fiche vers laquelle le site les sert. */
async function personnages(sql: Sql): Promise<Map<number, Personnage>> {
	const rows = await sql.unsafe(
		`SELECT id, name, name_ja, name_romaji FROM bot.db_characters WHERE ${VISIBLE}`
	);
	const map = new Map<number, Personnage>();
	for (const r of rows) {
		const id = Number(r.id);
		map.set(id, {
			id,
			name: s(r.name),
			slug: formatCharacterSlug({ id, name: s(r.name), nameRomaji: s(r.name_romaji) || null }),
		});
	}
	return map;
}

/** Une fiche doublon redirige vers sa fiche conservée : on ne l'indexe pas. */
const estDoublon = (id: number) => CHARACTER_DUPLICATE_REDIRECTS[id] !== undefined;

/** Clés des neuf rubriques de profil de puissance, communes à toutes les fiches. */
const CLES_PROFIL = new Set([
	"force",
	"force-de-frappe",
	"force-de-soulever",
	"vitesse",
	"vitesse-de-deplacement",
	"durabilite",
	"portee",
	"intelligence",
	"faiblesse",
]);

async function renduPersonnages(sql: Sql): Promise<SourceChunk[]> {
	const rows = await sql.unsafe(`
		SELECT c.id, c.name, c.name_ja, c.name_romaji, c.race, c.gender, c.affiliation, c.ki, c.max_ki,
			c.description, p.name AS planete
		FROM bot.db_characters c
		LEFT JOIN bot.db_planets p ON p.id = c.origin_planet_id
		ORDER BY c.id
	`);
	const out: SourceChunk[] = [];
	for (const c of rows) {
		const id = Number(c.id);
		if (estDoublon(id)) continue;
		const name = s(c.name);
		const url = `/wiki/personnages/${formatCharacterSlug({ id, name, nameRomaji: s(c.name_romaji) || null })}`;
		const noms = [s(c.name_ja), s(c.name_romaji)].filter(Boolean).join(" / ");
		const fiche = lignes(
			`${name}${noms ? ` (${noms})` : ""}.`,
			champ("Race", c.race),
			champ("Genre", c.gender),
			champ("Affiliation", c.affiliation),
			champ("Planète d'origine", c.planete),
			champ("Ki", c.ki),
			champ("Ki maximal", c.max_ki),
			s(c.description)
		);
		pousse(out, { kind: "character", title: name, url, entity: name }, fiche);
	}
	return out;
}

async function renduSectionsPersonnages(sql: Sql): Promise<SourceChunk[]> {
	const persos = await personnages(sql);
	const rows = await sql.unsafe(`
		SELECT entity_id, key, label, body, sort_order
		FROM bot.db_wiki_sections
		WHERE entity_type = 'character' AND ${VISIBLE} AND length(coalesce(body, '')) > 0
		ORDER BY entity_id, sort_order, id
	`);
	const out: SourceChunk[] = [];
	const profils = new Map<number, { key: string; md: string[] }>();
	for (const r of rows) {
		const id = Number(r.entity_id);
		const perso = persos.get(id);
		if (!perso || estDoublon(id)) continue;
		const key = s(r.key);
		if (CLES_PROFIL.has(key)) {
			// Les neuf rubriques de profil sont courtes et parallèles : un chunk
			// par rubrique noierait l'index sous 12 000 fragments quasi identiques.
			// Pas de titre markdown : `chunkDocument` couperait à chaque rubrique.
			const p = profils.get(id) ?? { key, md: [] };
			p.md.push(`${s(r.label)} : ${propre(s(r.body).replace(/\*\*/g, ""))}`);
			profils.set(id, p);
			continue;
		}
		pousse(
			out,
			{
				kind: "character_section",
				title: `${perso.name} — ${s(r.label)}`,
				url: `/wiki/personnages/${perso.slug}#${key}`,
				entity: perso.name,
			},
			s(r.body)
		);
	}
	for (const [id, p] of profils) {
		const perso = persos.get(id)!;
		pousse(
			out,
			{
				kind: "power_profile",
				title: `${perso.name} — profil de puissance`,
				url: `/wiki/personnages/${perso.slug}#${p.key}`,
				entity: perso.name,
			},
			p.md.join("\n\n")
		);
	}
	return out;
}

async function renduVariantes(sql: Sql): Promise<SourceChunk[]> {
	const persos = await personnages(sql);
	const rows = await sql.unsafe(`
		SELECT v.*, sg.name AS saga
		FROM bot.db_character_variants v
		LEFT JOIN bot.db_sagas sg ON sg.id = v.saga_id
		WHERE ${VISIBLE.replace("visible", "v.visible")}
		ORDER BY v.character_id, v.sort_order, v.id
	`);
	const out: SourceChunk[] = [];
	for (const v of rows) {
		const perso = persos.get(Number(v.character_id));
		if (!perso) continue;
		const titre = s(v.display_name) || `${perso.name} — ${s(v.label)}`;
		const texte = lignes(
			`${titre}${s(v.name_ja) ? ` (${s(v.name_ja)})` : ""}.`,
			champ("Saga", v.saga || v.label),
			champ("Forme", v.form),
			champ("Rôle", v.role),
			champ("Affiliation", v.affiliation),
			champ("Âge", v.age),
			champ("Puissance de combat", v.power_level),
			champ("Ki", v.ki),
			champ("Ki maximal", v.max_ki),
			s(v.summary),
			liste(v.highlights).length ? `Faits marquants : ${liste(v.highlights).join(" ; ")}.` : "",
			fourchette("Tomes", v.first_volume, v.last_volume),
			fourchette("Épisodes", v.first_episode, v.last_episode),
			champ("Origine", v.origin)
		);
		pousse(
			out,
			{
				kind: "character_variant",
				title: titre,
				url: `/wiki/personnages/${perso.slug}#sagas`,
				entity: perso.name,
			},
			texte
		);
	}
	return out;
}

// ── Encyclopédie ────────────────────────────────────────────────────────────

/** Rend une table « fiche + article » dont l'URL se déduit de la ligne. */
async function renduFiches(
	sql: Sql,
	opts: {
		kind: string;
		requete: string;
		titre: (r: Row) => string;
		url: (r: Row) => string;
		fiche: (r: Row) => string;
		article?: (r: Row) => string;
		entity?: (r: Row) => string;
		lang?: (r: Row) => string;
	}
): Promise<SourceChunk[]> {
	const out: SourceChunk[] = [];
	for (const r of await sql.unsafe(opts.requete)) {
		const title = opts.titre(r);
		if (!title.trim()) continue;
		const base = {
			kind: opts.kind,
			title,
			url: opts.url(r),
			entity: opts.entity?.(r) ?? "",
			lang: opts.lang?.(r),
		};
		pousse(out, base, opts.fiche(r));
		const article = opts.article?.(r) ?? "";
		if (article.trim()) pousse(out, { ...base, title: `${title} — article` }, article);
	}
	return out;
}

const renduTechniques = (sql: Sql) =>
	renduFiches(sql, {
		kind: "technique",
		// Les utilisateurs viennent de la table de liaison : « qui maîtrise le
		// Kienzan ? » n'avait aucune réponse tant que la fiche ne les nommait pas.
		requete: `SELECT t.*, c.name AS createur,
				(SELECT string_agg(u.name, ', ' ORDER BY u.id) FROM (
					SELECT DISTINCT ch.id, ch.name FROM bot.db_character_techniques ct
					JOIN bot.db_characters ch ON ch.id = ct.character_id
					WHERE ct.technique_id = t.id AND ${VISIBLE.replace("visible", "ch.visible")}
					ORDER BY ch.id LIMIT 15
				) u) AS utilisateurs
			FROM bot.db_techniques t
			LEFT JOIN bot.db_characters c ON c.id = t.creator_id
			WHERE ${VISIBLE.replace("visible", "t.visible")} ORDER BY t.id`,
		titre: (t) => s(t.name),
		url: (t) => `/wiki/techniques/${s(t.slug)}`,
		fiche: (t) =>
			lignes(
				`Technique ${s(t.name)}${[s(t.name_ja), s(t.name_romaji)].filter(Boolean).length ? ` (${[s(t.name_ja), s(t.name_romaji)].filter(Boolean).join(" / ")})` : ""}.`,
				champ("Type", t.type),
				champ("Créateur", t.createur),
				champ("Utilisée par", t.utilisateurs),
				s(t.description)
			),
		article: (t) => s(t.article),
		entity: (t) => s(t.name),
	});

const renduPlanetes = (sql: Sql) =>
	renduFiches(sql, {
		kind: "planet",
		requete: `SELECT * FROM bot.db_planets WHERE ${VISIBLE} ORDER BY id`,
		titre: (p) => s(p.name),
		url: (p) => `/wiki/cosmologie/${formatPlanetSlug({ id: Number(p.id), name: s(p.name) })}`,
		fiche: (p) =>
			lignes(
				`Planète ${s(p.name)}${s(p.name_ja) ? ` (${s(p.name_ja)})` : ""}.`,
				p.is_destroyed ? "Planète détruite." : "",
				s(p.description)
			),
		article: (p) => s(p.article),
		entity: (p) => s(p.name),
	});

const renduRaces = (sql: Sql) =>
	renduFiches(sql, {
		kind: "race",
		requete: `SELECT r.*, p.name AS planete FROM bot.db_races r
			LEFT JOIN bot.db_planets p ON p.id = r.home_planet_id
			WHERE ${VISIBLE.replace("visible", "r.visible")} ORDER BY r.id`,
		titre: (r) => s(r.name),
		url: (r) => `/wiki/races/${s(r.slug)}`,
		fiche: (r) =>
			lignes(
				`Race ${s(r.name)}${s(r.name_ja) ? ` (${s(r.name_ja)})` : ""}.`,
				champ("Planète d'origine", r.planete),
				s(r.description)
			),
		article: (r) => s(r.article),
		entity: (r) => s(r.name),
	});

const renduTransformations = (sql: Sql) =>
	renduFiches(sql, {
		kind: "transformation",
		requete: `SELECT t.*, c.name AS personnage FROM bot.db_transformations t
			LEFT JOIN bot.db_characters c ON c.id = t.character_id
			WHERE ${VISIBLE.replace("visible", "t.visible")} ORDER BY t.id`,
		titre: (t) => s(t.name),
		url: (t) =>
			`/wiki/transformations/${formatTransformationSlug({ id: Number(t.id), name: s(t.name) })}`,
		fiche: (t) =>
			lignes(`Transformation ${s(t.name)}.`, champ("Personnage", t.personnage), champ("Ki", t.ki)),
		article: (t) => s(t.article),
		entity: (t) => s(t.name),
	});

const renduSagas = (sql: Sql) =>
	renduFiches(sql, {
		kind: "saga",
		requete: `SELECT * FROM bot.db_sagas WHERE ${VISIBLE} ORDER BY order_idx, id`,
		titre: (g) => s(g.name),
		url: (g) => (s(g.slug) ? `/wiki/sagas/${s(g.slug)}` : "/wiki/sagas"),
		fiche: (g) =>
			lignes(
				`Saga ${s(g.name)}${s(g.name_ja) ? ` (${s(g.name_ja)})` : ""} — ${s(g.series)}.`,
				fourchette("Manga : tomes", g.manga_volume_start, g.manga_volume_end),
				fourchette("Chapitres", g.manga_chapter_start, g.manga_chapter_end),
				fourchette(`Épisodes ${s(g.episode_series)}`.trim(), g.episode_start, g.episode_end),
				s(g.description)
			),
		article: (g) => s(g.article),
		entity: (g) => s(g.name),
	});

const renduArcs = (sql: Sql) =>
	renduFiches(sql, {
		kind: "arc",
		requete: `SELECT a.*, sg.name AS saga FROM bot.db_arcs a
			LEFT JOIN bot.db_sagas sg ON sg.id = a.saga_id
			WHERE ${VISIBLE.replace("visible", "a.visible")} ORDER BY a.order_idx, a.id`,
		titre: (a) => s(a.name),
		url: (a) => (s(a.slug) ? `/wiki/arcs/${s(a.slug)}` : "/wiki/arcs"),
		fiche: (a) =>
			lignes(
				`Arc narratif ${s(a.name)}${s(a.name_ja) ? ` (${s(a.name_ja)})` : ""}${s(a.saga) ? ` de la saga ${s(a.saga)}` : ""}.`,
				s(a.description)
			),
		article: (a) => s(a.article),
		entity: (a) => s(a.name),
	});

const renduFilms = (sql: Sql) =>
	renduFiches(sql, {
		kind: "movie",
		requete: `SELECT id, slug, title, title_ja, title_romaji, series, release_date, duration_min, synopsis, synopsis_fr
			FROM bot.db_movies WHERE ${VISIBLE} ORDER BY id`,
		titre: (m) => s(m.title),
		url: (m) => `/wiki/films/${s(m.slug)}`,
		fiche: (m) =>
			lignes(
				`Film ${s(m.title)}${s(m.title_ja) ? ` (${s(m.title_ja)})` : ""} — ${s(m.series)}.`,
				champ("Sortie", date(m.release_date)),
				champ("Durée (min)", m.duration_min),
				s(m.synopsis_fr) || s(m.synopsis)
			),
		entity: (m) => s(m.title),
	});

const renduJeux = (sql: Sql) =>
	renduFiches(sql, {
		kind: "game",
		requete: `SELECT slug, title, title_ja, platforms, release_date, publisher, developer, description
			FROM bot.db_games WHERE ${VISIBLE} ORDER BY id`,
		titre: (g) => s(g.title),
		url: (g) => (s(g.slug) ? `/wiki/jeux/${s(g.slug)}` : "/wiki/jeux"),
		fiche: (g) =>
			lignes(
				`Jeu ${s(g.title)}${s(g.title_ja) ? ` (${s(g.title_ja)})` : ""}.`,
				champ("Plateformes", g.platforms),
				champ("Sortie", date(g.release_date)),
				champ("Éditeur", g.publisher),
				champ("Développeur", g.developer),
				s(g.description)
			),
		entity: (g) => s(g.title),
	});

const renduEpisodes = (sql: Sql) =>
	renduFiches(sql, {
		kind: "episode",
		requete: `SELECT e.id, e.series, e.number_in_series, e.title, e.title_ja, e.air_date, e.synopsis, e.synopsis_fr, a.name AS arc
			FROM bot.db_episodes e LEFT JOIN bot.db_arcs a ON a.id = e.arc_id
			WHERE ${VISIBLE.replace("visible", "e.visible")}
				AND length(coalesce(e.synopsis_fr, e.synopsis, '')) > 0
			ORDER BY e.id`,
		titre: (e) => `${s(e.series)} ${s(e.number_in_series)} — ${s(e.title)}`,
		url: (e) => `/wiki/episodes/${s(e.id)}`,
		fiche: (e) =>
			lignes(
				`Épisode ${s(e.series)} n° ${s(e.number_in_series)} : ${s(e.title)}${s(e.title_ja) ? ` (${s(e.title_ja)})` : ""}.`,
				champ("Arc", e.arc),
				champ("Première diffusion", date(e.air_date)),
				s(e.synopsis_fr) || s(e.synopsis)
			),
	});

const renduTomes = (sql: Sql) =>
	renduFiches(sql, {
		kind: "manga_volume",
		requete: `SELECT id, series, volume_number, title, title_ja, isbn, published_at FROM bot.db_manga_volumes WHERE ${VISIBLE} ORDER BY id`,
		titre: (v) => `${s(v.series)} — tome ${s(v.volume_number)}${s(v.title) ? ` : ${s(v.title)}` : ""}`,
		url: (v) => `/wiki/manga/volume/${s(v.id)}`,
		fiche: (v) =>
			lignes(
				`Tome ${s(v.volume_number)} du manga ${s(v.series)}${s(v.title) ? ` intitulé ${s(v.title)}` : ""}${s(v.title_ja) ? ` (${s(v.title_ja)})` : ""}.`,
				champ("ISBN", v.isbn)
			),
	});

const renduChapitres = (sql: Sql) =>
	renduFiches(sql, {
		kind: "manga_chapter",
		requete: `SELECT c.id, c.series, c.chapter_number, c.title, c.title_ja, v.volume_number
			FROM bot.db_manga_chapters c LEFT JOIN bot.db_manga_volumes v ON v.id = c.volume_id
			WHERE ${VISIBLE.replace("visible", "c.visible")} ORDER BY c.id`,
		titre: (c) => `${s(c.series)} — chapitre ${s(c.chapter_number)}${s(c.title) ? ` : ${s(c.title)}` : ""}`,
		url: (c) => `/wiki/manga/${s(c.id)}`,
		fiche: (c) =>
			`Chapitre ${s(c.chapter_number)} du manga ${s(c.series)}${s(c.volume_number) ? ` (tome ${s(c.volume_number)})` : ""}${s(c.title) ? ` intitulé ${s(c.title)}` : ""}${s(c.title_ja) ? ` (${s(c.title_ja)})` : ""}.`,
	});

const renduOutils = (sql: Sql) =>
	renduFiches(sql, {
		kind: "tool",
		requete: "SELECT id, slug, name, description, author, language, category, stars FROM bot.db_tools ORDER BY id",
		titre: (t) => s(t.name),
		url: () => "/wiki/tools",
		fiche: (t) =>
			`Outil ou ressource communautaire ${s(t.name)} (${s(t.category)}). Créateur : ${s(t.author)}. Langue : ${s(t.language)}. Étoiles : ${s(t.stars)}. ${s(t.description)}`,
		// Un dépôt anglophone indexé en `fr` sortirait du filtre `lang=` de l'API.
		lang: (t) => (s(t.language).toLowerCase().includes("en") ? "en" : "fr"),
		entity: (t) => s(t.name),
	});

// ── Piliers : combats, objets, dragons, vœux, chronologie, puissances ───────

const renduCombats = (sql: Sql) =>
	renduFiches(sql, {
		kind: "battle",
		requete: `SELECT b.*, sg.name AS saga, a.name AS arc FROM bot.db_battles b
			LEFT JOIN bot.db_sagas sg ON sg.id = b.saga_id
			LEFT JOIN bot.db_arcs a ON a.id = b.arc_id
			WHERE ${VISIBLE.replace("visible", "b.visible")} ORDER BY b.id`,
		titre: (b) => s(b.title),
		url: (b) => `/wiki/combats/${s(b.slug)}`,
		fiche: (b) =>
			lignes(
				`Combat ${s(b.title)}${s(b.title_ja) ? ` (${s(b.title_ja)})` : ""} — ${s(b.series)}.`,
				liste(b.combatants, "name").length ? `Combattants : ${liste(b.combatants, "name").join(" contre ")}.` : "",
				champ("Vainqueur", b.winner_name),
				champ("Lieu", b.location),
				champ("Saga", b.saga),
				champ("Arc", b.arc),
				fourchette("Manga : tomes", b.manga_volume_start, b.manga_volume_end),
				fourchette("Chapitres", b.manga_chapter_start, b.manga_chapter_end),
				fourchette("Épisodes", b.episode_start, b.episode_end),
				liste(b.techniques_used).length ? `Techniques employées : ${liste(b.techniques_used).join(", ")}.` : "",
				Number(b.canon) === 0 ? "Combat hors canon manga." : "",
				s(b.climax_summary)
			),
		article: (b) => s(b.article),
	});

const renduObjets = (sql: Sql) =>
	renduFiches(sql, {
		kind: "item",
		requete: `SELECT * FROM bot.db_items WHERE ${VISIBLE} ORDER BY id`,
		titre: (i) => s(i.name),
		url: (i) => `/wiki/objets/${s(i.slug)}`,
		fiche: (i) =>
			lignes(
				`Objet ${s(i.name)}${[s(i.name_ja), s(i.name_romaji)].filter(Boolean).length ? ` (${[s(i.name_ja), s(i.name_romaji)].filter(Boolean).join(" / ")})` : ""}.`,
				champ("Catégorie", i.category),
				champ("Créateur", i.creator),
				champ("Première apparition (manga)", i.debut_chapter),
				champ("Première apparition (anime)", i.debut_episode),
				s(i.description)
			),
		article: (i) => s(i.article),
		entity: (i) => s(i.name),
	});

const renduDragons = (sql: Sql) =>
	renduFiches(sql, {
		kind: "dragon",
		requete: `SELECT * FROM bot.db_dragons WHERE ${VISIBLE} ORDER BY id`,
		titre: (d) => s(d.name),
		url: (d) => `/wiki/dragons#${s(d.slug)}`,
		fiche: (d) =>
			lignes(
				`Dragon sacré ${s(d.name)}${s(d.name_ja) ? ` (${s(d.name_ja)})` : ""}.`,
				champ("Créateur", d.creator),
				champ("Planète ou royaume", d.planet_realm),
				champ("Nombre de Dragon Balls", d.balls_count),
				champ("Diamètre des boules", d.balls_diameter),
				champ("Formule d'invocation", d.summon_phrase),
				champ("Formule japonaise", d.summon_phrase_ja),
				champ("Vœux par invocation", d.wishes_count),
				champ("Délai de réutilisation", d.cooldown),
				champ("Règles", d.rules)
			),
		article: (d) => s(d.article),
		entity: (d) => s(d.name),
	});

const renduVoeux = (sql: Sql) =>
	renduFiches(sql, {
		kind: "wish",
		requete: `SELECT * FROM bot.db_wishes WHERE ${VISIBLE} ORDER BY dragon_id, id`,
		titre: (w) => `Vœu exaucé par ${s(w.dragon_name)} — ${s(w.saga)}`,
		url: (w) => `/wiki/dragons#voeu-${s(w.id)}`,
		fiche: (w) =>
			lignes(
				`Vœu adressé à ${s(w.dragon_name)}${s(w.wish_number_in_summon) ? ` (vœu n° ${s(w.wish_number_in_summon)} de l'invocation)` : ""}.`,
				champ("Demandé par", w.whisperer),
				champ("Saga", w.saga),
				champ("Chapitre du manga", w.manga_chapter),
				champ("Épisode", w.episode_number),
				`Vœu : ${s(w.wish_text)}`,
				Number(w.granted) === 0 ? "Ce vœu n'a pas été exaucé." : "Vœu exaucé.",
				Number(w.canon) === 0 ? "Hors canon manga." : ""
			),
		entity: (w) => s(w.dragon_name),
	});

const renduChronologie = (sql: Sql) =>
	renduFiches(sql, {
		kind: "timeline_event",
		requete: `SELECT * FROM bot.db_timeline_events WHERE ${VISIBLE} ORDER BY order_idx, id`,
		titre: (e) => `An ${s(e.age_year)} — ${s(e.title)}`,
		url: (e) => `/wiki/chronologie#evenement-${s(e.id)}`,
		fiche: (e) =>
			lignes(
				`Chronologie, an ${s(e.age_year)}${s(e.age_month) ? `, mois ${s(e.age_month)}` : ""}${s(e.age_day) ? `, jour ${s(e.age_day)}` : ""} : ${s(e.title)}${s(e.title_ja) ? ` (${s(e.title_ja)})` : ""}.`,
				champ("Ère", e.era),
				s(e.description),
				liste(e.characters_involved).length ? `Personnages : ${liste(e.characters_involved).join(", ")}.` : "",
				champ("Source", e.source_ref),
				Number(e.canon) === 0 ? "Événement hors canon manga." : ""
			),
	});

const renduPuissances = (sql: Sql) =>
	renduFiches(sql, {
		kind: "power_level",
		requete: `SELECT * FROM bot.db_power_levels WHERE ${VISIBLE} ORDER BY id`,
		titre: (p) =>
			`${s(p.character_name)}${s(p.form) ? ` (${s(p.form)})` : ""} — ${s(p.battle_power_display) || s(p.battle_power)}`,
		url: (p) => `/wiki/puissances#niveau-${s(p.id)}`,
		fiche: (p) =>
			lignes(
				`Puissance de combat de ${s(p.character_name)}${s(p.form) ? ` en ${s(p.form)}` : ""} : ${s(p.battle_power_display) || s(p.battle_power)}.`,
				champ("Saga", p.saga_name),
				champ("Appareil de mesure", p.scouter_device),
				champ("Type de source", p.source_kind),
				champ("Référence", p.source_page),
				Number(p.canon) === 0 ? "Valeur hors canon manga." : "Valeur canonique.",
				s(p.notes)
			),
		entity: (p) => s(p.character_name),
	});

const renduLieux = (sql: Sql) =>
	renduFiches(sql, {
		kind: "location",
		requete: `SELECT * FROM bot.db_locations WHERE ${VISIBLE} ORDER BY id`,
		titre: (l) => s(l.name),
		url: (l) => `/wiki/lieux/${s(l.slug)}`,
		fiche: (l) =>
			lignes(
				`Lieu ${s(l.name)}${[s(l.name_ja), s(l.name_romaji)].filter(Boolean).length ? ` (${[s(l.name_ja), s(l.name_romaji)].filter(Boolean).join(" / ")})` : ""}.`,
				champ("Royaume", l.realm_type),
				champ("Planète", l.planet),
				champ("Première apparition (manga)", l.debut_chapter),
				champ("Première apparition (anime)", l.debut_episode),
				s(l.description),
				liste(l.key_events, "title").length
					? `Événements marquants : ${(Array.isArray(l.key_events) ? l.key_events : JSON.parse(s(l.key_events) || "[]"))
							.map((e: Row) => `${s(e.title)} — ${s(e.description)}`)
							.join(" ; ")}.`
					: ""
			),
		article: (l) => s(l.article),
		entity: (l) => s(l.name),
	});

const renduTournois = (sql: Sql) =>
	renduFiches(sql, {
		kind: "tournament",
		requete: `SELECT * FROM bot.db_tournaments WHERE ${VISIBLE} ORDER BY id`,
		titre: (t) => s(t.name),
		url: (t) => `/wiki/tournois/${s(t.slug)}`,
		fiche: (t) => {
			const matchs = Array.isArray(t.notable_matches)
				? (t.notable_matches as Row[])
				: (JSON.parse(s(t.notable_matches) || "[]") as Row[]);
			return lignes(
				`Tournoi ${s(t.name)}${s(t.name_ja) ? ` (${s(t.name_ja)})` : ""}.`,
				champ("Type", t.tournament_type),
				champ("Saga", t.saga),
				champ("Lieu", t.location),
				champ("Vainqueur", t.winner_name),
				champ("Finaliste", t.runner_up_name),
				champ("Participants", t.participants_count),
				champ("Règles", t.rules_summary),
				matchs.length
					? `Matchs notables : ${matchs
							.map((m) => `${s(m.round)} : ${s(m.fighterA)} contre ${s(m.fighterB)}, vainqueur ${s(m.winner)}${s(m.techniqueOrClimax) ? ` (${s(m.techniqueOrClimax)})` : ""}`)
							.join(" ; ")}.`
					: "",
				t.canon === false ? "Tournoi hors canon manga." : ""
			);
		},
		article: (t) => s(t.article),
		entity: (t) => s(t.name),
	});

const renduDoubleurs = (sql: Sql) =>
	renduFiches(sql, {
		kind: "voice_actor",
		requete: `SELECT * FROM bot.db_voice_actors WHERE ${VISIBLE} ORDER BY id`,
		titre: (v) => s(v.name),
		url: (v) => `/wiki/voix/${s(v.slug)}`,
		fiche: (v) => {
			const roles = Array.isArray(v.roles) ? (v.roles as Row[]) : (JSON.parse(s(v.roles) || "[]") as Row[]);
			return lignes(
				`Comédien de doublage ${s(v.name)}${s(v.name_ja) ? ` (${s(v.name_ja)})` : ""}.`,
				champ("Nationalité", v.nationality === "ja" ? "japonaise" : v.nationality === "fr" ? "française" : v.nationality),
				champ("Naissance", v.birth_date),
				roles.length
					? `Rôles : ${roles.map((r) => `${s(r.characterName)}${s(r.series) ? ` (${s(r.series)})` : ""}${s(r.notes) ? ` — ${s(r.notes)}` : ""}`).join(" ; ")}.`
					: "",
				s(v.biography)
			);
		},
		article: (v) => s(v.article),
		entity: (v) => s(v.name),
	});

const renduMusiques = (sql: Sql) =>
	renduFiches(sql, {
		kind: "soundtrack",
		requete: `SELECT * FROM bot.db_soundtracks WHERE ${VISIBLE} ORDER BY id`,
		titre: (m) => s(m.title),
		url: (m) => `/wiki/musiques#${s(m.slug)}`,
		fiche: (m) =>
			lignes(
				`Musique ${s(m.title)}${[s(m.title_ja), s(m.title_romaji)].filter(Boolean).length ? ` (${[s(m.title_ja), s(m.title_romaji)].filter(Boolean).join(" / ")})` : ""}.`,
				champ("Type", m.track_type),
				champ("Série", m.series),
				champ("Interprète", m.artist),
				champ("Compositeur", m.composer),
				champ("Parolier", m.lyricist),
				champ("Épisodes", m.episodes_range),
				champ("Année", m.release_year),
				s(m.description)
			),
		article: (m) => s(m.article),
		entity: (m) => s(m.title),
	});

// ── Refonte : Contributeurs, Médias & Graphe Narratif ───────────────────────

const renduContributeurs = (sql: Sql) =>
	renduFiches(sql, {
		kind: "contributor",
		requete: `SELECT c.*,
			COALESCE(
				json_agg(
					json_build_object('role', cr.role, 'scope', cr.credit_scope)
				) FILTER (WHERE cr.id IS NOT NULL), '[]'
			) as credits
			FROM bot.contributors c
			LEFT JOIN bot.contributor_credits cr ON cr.contributor_id = c.id AND cr.visible = true
			WHERE ${VISIBLE.replace("visible", "c.visible")}
			GROUP BY c.id
			ORDER BY COALESCE(c.spotlight_rank, 999), c.id`,
		titre: (c) => s(c.name),
		url: (c) => `/wiki/contributeurs/${s(c.slug)}`,
		fiche: (c) => {
			const credits = Array.isArray(c.credits) ? (c.credits as Row[]) : (JSON.parse(s(c.credits) || "[]") as Row[]);
			return lignes(
				`Contributeur ${s(c.name)}${[s(c.name_ja), s(c.name_romaji)].filter(Boolean).length ? ` (${[s(c.name_ja), s(c.name_romaji)].filter(Boolean).join(" / ")})` : ""} — Catégorie : ${s(c.category)}.`,
				Number(c.spotlight_rank) === 0 ? "Auteur original et créateur démiurge de Dragon Ball." : "",
				champ("Date de naissance", c.birth_date),
				champ("Date de décès", c.death_date),
				credits.length ? `Crédits officiels : ${credits.map((cr) => `${s(cr.role)} (${s(cr.scope)})`).join(" ; ")}.` : "",
				s(c.biography_fr)
			);
		},
		article: (c) => s(c.biography_fr),
		entity: (c) => s(c.name),
	});

const renduMediaWorks = (sql: Sql) =>
	renduFiches(sql, {
		kind: "media_work",
		requete: `SELECT w.*,
			COALESCE(
				json_agg(
					json_build_object('edition', e.edition, 'label', e.label, 'language', e.language, 'page_color', e.page_color)
				) FILTER (WHERE e.id IS NOT NULL), '[]'
			) as editions
			FROM bot.media_works w
			LEFT JOIN bot.media_editions e ON e.work_id = w.id AND e.visible = true
			WHERE ${VISIBLE.replace("visible", "w.visible")}
			GROUP BY w.id
			ORDER BY w.id`,
		titre: (w) => s(w.title),
		url: () => "/wiki/manga",
		fiche: (w) => {
			const eds = Array.isArray(w.editions) ? (w.editions as Row[]) : (JSON.parse(s(w.editions) || "[]") as Row[]);
			return lignes(
				`Œuvre ${s(w.title)}${[s(w.title_ja), s(w.title_romaji)].filter(Boolean).length ? ` (${[s(w.title_ja), s(w.title_romaji)].filter(Boolean).join(" / ")})` : ""} — Série : ${s(w.series)}, Format : ${s(w.kind)}.`,
				eds.length ? `Éditions disponibles : ${eds.map((e) => `${s(e.label)} (${s(e.edition)}, ${s(e.language)}, ${s(e.page_color)})`).join(" ; ")}.` : "",
				s(w.synopsis_fr)
			);
		},
		article: (w) => s(w.synopsis_fr),
		entity: (w) => s(w.title),
	});

const renduNarrativeTimelines = (sql: Sql) =>
	renduFiches(sql, {
		kind: "narrative_timeline",
		requete: `SELECT * FROM bot.narrative_timelines WHERE ${VISIBLE} ORDER BY id`,
		titre: (t) => s(t.label),
		url: () => "/wiki/combats",
		fiche: (t) =>
			`Continuité narrative Dragon Ball : ${s(t.label)} (slug : ${s(t.slug)}, type : ${s(t.kind)}). Sépare rigoureusement les trames canoniques des continuités animées, films et jeux vidéo.`,
		entity: (t) => s(t.label),
	});

const renduNarrativeEvents = (sql: Sql) =>
	renduFiches(sql, {
		kind: "narrative_event",
		requete: `SELECT e.*, t.slug as timeline_slug, t.label as timeline_label
			FROM bot.narrative_events e
			JOIN bot.narrative_timelines t ON t.id = e.timeline_id
			WHERE ${VISIBLE.replace("visible", "e.visible")}
			ORDER BY e.start_order NULLS LAST, e.id`,
		titre: (e) => s(e.title),
		url: (e) => (e.kind === "battle" ? `/wiki/combats/${s(e.slug)}` : e.kind === "tournament" ? `/wiki/tournois/${s(e.slug)}` : `/wiki/chronologie`),
		fiche: (e) =>
			lignes(
				`Événement narratif ${s(e.title)}${[s(e.title_ja), s(e.title_romaji)].filter(Boolean).length ? ` (${[s(e.title_ja), s(e.title_romaji)].filter(Boolean).join(" / ")})` : ""} — Type : ${s(e.kind)}.`,
				champ("Continuité / Timeline", e.timeline_label),
				champ("Statut canonique", e.canon === "absolute" ? "Canon absolu manga" : e.canon === "supervised" ? "Canon supervisé (Toriyama)" : e.canon),
				s(e.synopsis_fr)
			),
		article: (e) => s(e.synopsis_fr),
		entity: (e) => s(e.title),
	});

// ── Canon & pages éditoriales ───────────────────────────────────────────────

async function renduCanon(sql: Sql): Promise<SourceChunk[]> {
	const rows = await sql.unsafe(`
		SELECT id, subject, keywords, text, text_fr, source, year, document, lang, provenance, href
		FROM public.canon_references WHERE visible ORDER BY id
	`);
	const out: SourceChunk[] = [];
	for (const r of rows) {
		const fr = s(r.text_fr).trim();
		const original = s(r.text).trim();
		const lang = fr ? "fr" : s(r.lang) || "fr";
		// La provenance d'abord : c'est elle qui fait d'un passage une pièce à
		// conviction, et elle doit rester dans le premier chunk d'un texte long.
		const texte = lignes(
			`Source : ${s(r.source)}${s(r.year) ? ` (${s(r.year)})` : ""}${s(r.document) ? ` — ${s(r.document)}` : ""}.`,
			liste(r.keywords).length ? `Mots-clés : ${liste(r.keywords).join(", ")}.` : "",
			fr || original,
			fr && original && fr !== original ? `Texte original (${s(r.lang)}) : ${original}` : ""
		);
		pousse(
			out,
			{
				kind: "canon",
				title: s(r.subject) || s(r.source),
				url: s(r.href) || `/wiki/canon#${s(r.id)}`,
				lang,
			},
			texte
		);
	}
	return out;
}

async function renduPagesWiki(sql: Sql): Promise<SourceChunk[]> {
	const rows = await sql.unsafe(`SELECT title, slug, body FROM public."WikiPage" ORDER BY "order", id`);
	const out: SourceChunk[] = [];
	for (const p of rows) {
		pousse(out, { kind: "article", title: s(p.title), url: `/wiki/${s(p.slug)}` }, s(p.body));
	}
	return out;
}

// ── Manga : une planche = un passage citable ────────────────────────────────

/** Même lecture du numéro de fichier que `apps/shenron/site/src/lib/manga-api.ts`. */
function numeroDePlanche(chemin: string, index: number): number {
	const fichier = chemin.split("?")[0]!.split("/").pop() ?? "";
	const groupes = fichier.replace(/\.[a-z0-9]+$/i, "").match(/\d+/g);
	const n = groupes?.length ? Number(groupes[groupes.length - 1]) : Number.NaN;
	return Number.isFinite(n) && n > 0 ? n : index + 1;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** Bruit OCR : filigranes de scantrad, domaines, bulles sans lettres. */
function nettoieOcr(lines: unknown, texte: string): string {
	const bulles = liste(lines).length ? liste(lines) : texte.split(/\s{2,}|\n/);
	return bulles
		.map((l) =>
			l
				.replace(/\b(?:WWW\.|HTTPS?:\/\/)\S+/gi, " ")
				.replace(/\b[A-Z0-9][A-Z0-9-]*\.(?:NET|FR|COM|ORG|MX|TO|IO|CC|ME)\b/gi, " ")
				.replace(/\b(?:SCANTRAD|BLEACH-?MX|VOIRANIME|MANGA-?SCAN|LELSCAN|JATSCAN)\S*/gi, " ")
				.replace(/\s+/g, " ")
				.trim()
		)
		.filter((l) => CJK.test(l) || (l.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2)
		.join(" ");
}

async function renduPlanchesManga(sql: Sql): Promise<SourceChunk[]> {
	const chapitres = new Map<string, { id: number; numero: number; pages: string[] }>();
	for (const c of await sql.unsafe(
		`SELECT id, series, chapter_number, pages FROM bot.db_manga_chapters WHERE ${VISIBLE}`
	)) {
		const pages = Array.isArray(c.pages) ? (c.pages as string[]) : [];
		// Coordonnées OCR → chapitre du site, comme `chercherPlanches` : `vol{N}`
		// désigne le chapitre DB de numéro N, `ch{id}` le chapitre d'identifiant id.
		const cle = s(c.series) === "DB" ? `DB:vol${s(c.chapter_number)}` : `ch${s(c.id)}`;
		chapitres.set(cle, { id: Number(c.id), numero: Number(c.chapter_number), pages });
	}

	const out: SourceChunk[] = [];
	const rows = await sql.unsafe(
		"SELECT series, tome, planche, lines, text, lang FROM bot.db_manga_pages ORDER BY series, tome, planche"
	);
	for (const r of rows) {
		const series = s(r.series);
		const tome = s(r.tome);
		const numero = Number(r.planche);
		const chap = chapitres.get(series === "DB" ? `DB:${tome}` : tome);
		// Sans chapitre du site, la planche n'a pas d'adresse de lecture : une
		// citation qui ne mène nulle part ne vaut pas mieux que pas de citation.
		if (!chap) continue;
		const texte = nettoieOcr(r.lines, s(r.text));
		if (texte.replace(/[^\p{L}\p{N}]/gu, "").length < 24) continue;
		const idx = chap.pages.findIndex((chemin, i) => numeroDePlanche(chemin, i) === numero);
		const rang = idx >= 0 ? idx + 1 : numero;
		const serie = series === "DB" ? "Dragon Ball" : "Dragon Ball Super";
		const repere = series === "DB" ? `tome ${chap.numero}` : `chapitre ${chap.numero}`;
		out.push({
			kind: "manga_page",
			title: `${serie} — ${repere}, planche ${numero}`,
			url: `/wiki/manga/${chap.id}?planche=${rang}`,
			content: propre(texte),
			lang: CJK.test(texte) && !/[a-zà-ÿ]{3,}/i.test(texte) ? "ja" : s(r.lang) || "fr",
			entity: resolveEntity(texte),
		});
	}
	return out;
}

// ── Databooks : planches japonaises et leurs traductions ────────────────────

/**
 * Le corpus porte DEUX formes de transcription, héritées de deux passes de
 * dépôt : la chaîne nue, et `{ kind, markdown }`. Toute lecture accepte les deux.
 */
function texteDePlanche(valeur: unknown): string {
	if (typeof valeur === "string") return valeur;
	if (valeur && typeof valeur === "object" && "markdown" in valeur) {
		const md = (valeur as { markdown?: unknown }).markdown;
		if (typeof md === "string") return md;
	}
	return "";
}

/**
 * Règle dure : une planche que `defautDePlanche` juge fautive n'est PAS indexée.
 * Indexer une hallucination reviendrait à la faire ressortir comme une source.
 */
async function renduDatabooks(sql: Sql): Promise<SourceChunk[]> {
	const ouvrages = await sql.unsafe(`
		SELECT id, kind, title, title_ja, author, published_at, description, category, pages
		FROM bot.db_databooks WHERE visible ORDER BY id
	`);
	const out: SourceChunk[] = [];
	for (const o of ouvrages) {
		const id = Number(o.id);
		const url = `https://dragonballfr.com/wiki/databooks/${id}`;
		const title = s(o.title);

		// Fiche de l'ouvrage : sans elle, « Daizenshuu 7 » ne ramène que des
		// planches, jamais l'ouvrage qui les porte.
		const fiche = [
			o.title_ja ? `Titre japonais : ${s(o.title_ja)}` : "",
			o.author ? `Auteur / éditeur : ${s(o.author)}` : "",
			o.published_at ? `Publication : ${date(o.published_at)}` : "",
			o.kind ? `Type : ${s(o.kind)}` : "",
			o.category ? `Catégorie : ${s(o.category)}` : "",
			s(o.description).trim(),
		]
			.filter(Boolean)
			.join("\n");
		if (propre(fiche).length > 12) pousse(out, { kind: "databook", title, url }, fiche);

		const pages = Array.isArray(o.pages)
			? (o.pages as { number?: unknown; text?: unknown; text_fr?: unknown }[])
			: [];
		for (const p of pages) {
			const numero = Number(p.number);
			if (!Number.isSafeInteger(numero) || numero <= 0) continue;
			const ja = texteDePlanche(p.text).trim();
			if (!ja || defautDePlanche(p, ja) !== null) continue;
			const base = { kind: "databook", url: `${url}#planche-${numero}` };
			pousse(out, { ...base, title: `${title} — planche ${numero}`, lang: "ja" }, ja);
			// La traduction n'est déposée que sur une planche saine : on ne la
			// rejuge pas, mais elle disparaît si sa source est écartée.
			const fr = texteDePlanche(p.text_fr).trim();
			if (fr) pousse(out, { ...base, title: `${title} — planche ${numero} (traduction)` }, fr);
		}
	}
	return out;
}

// ── Registre ────────────────────────────────────────────────────────────────

/**
 * Sources rendues depuis PostgreSQL, par `source_id`. L'ordre est celui du
 * build : les fiches d'abord, les passages longs ensuite.
 */
export const PG_SOURCES: Record<string, (sql: Sql) => Promise<SourceChunk[]>> = {
	db_characters: renduPersonnages,
	db_wiki_sections: renduSectionsPersonnages,
	db_character_variants: renduVariantes,
	db_planets: renduPlanetes,
	db_races: renduRaces,
	db_techniques: renduTechniques,
	db_transformations: renduTransformations,
	db_sagas: renduSagas,
	db_arcs: renduArcs,
	db_movies: renduFilms,
	db_games: renduJeux,
	db_episodes: renduEpisodes,
	db_manga_volumes: renduTomes,
	db_manga_chapters: renduChapitres,
	db_tools: renduOutils,
	db_battles: renduCombats,
	db_items: renduObjets,
	db_dragons: renduDragons,
	db_wishes: renduVoeux,
	db_timeline_events: renduChronologie,
	db_power_levels: renduPuissances,
	db_locations: renduLieux,
	db_tournaments: renduTournois,
	db_voice_actors: renduDoubleurs,
	db_soundtracks: renduMusiques,
	contributors: renduContributeurs,
	media_works: renduMediaWorks,
	narrative_timelines: renduNarrativeTimelines,
	narrative_events: renduNarrativeEvents,
	canon_references: renduCanon,
	wiki_pages: renduPagesWiki,
	manga: renduPlanchesManga,
	databooks: renduDatabooks,
};

/**
 * URL PostgreSQL : `DATABASE_URL` de l'environnement, puis `apps/shenron/site/.env`,
 * puis `~/.shenron-neon.env` (repli conservé jusqu'à INFRA-3).
 * `apps/shenron/site/.env` porte DEUX `DATABASE_URL` (l'ancienne Neon avant la locale) :
 * la DERNIÈRE ligne active fait foi (`loadDatabaseUrl`).
 */
export async function urlPostgres(): Promise<string> {
	const result = loadDatabaseUrl({
		fallbackFiles: [
			{ path: join(ROOT, "..", "site", ".env") },
			{ path: join(process.env.HOME || homedir(), ".shenron-neon.env") },
		],
	});
	if (!result.ok) {
		throw new Error(`DATABASE_URL introuvable (env, apps/shenron/site/.env, ~/.shenron-neon.env). ${result.reason}`);
	}
	return result.url;
}

/**
 * Pool postgres-js brut (`sql.json` conserve ses sérialiseurs) sur `urlPostgres()`.
 * Aucune connexion avant la première requête ; à fermer par l'appelant.
 */
export async function connexionPostgres(options: {
	max?: number;
	prepare?: boolean;
	applicationName?: string;
} = {}): Promise<Sql> {
	return createSql({
		url: await urlPostgres(),
		max: options.max ?? 2,
		prepare: options.prepare ?? false,
		applicationName: options.applicationName ?? "shenron-rag-pipeline",
	});
}
