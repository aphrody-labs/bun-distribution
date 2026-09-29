import type { SQL } from "bun";
import { inject, singleton } from "tsyringe";
import { PgService, resolveBotDatabaseUrl } from "~/db/pg";
import { logger } from "~/lib/logger";

/**
 * Épisodes — lecture des lecteurs VF/VOSTFR, côté PostgreSQL du site.
 *
 * ── POURQUOI PAS LE SQLITE DU BOT (vérifié, pas supposé) ────────────────────
 * `db_episodes` EST bien répliquée dans `apps/shenron/bot/data/bot.db` (826 lignes au
 * 2026-09-02) — mais la table SQLite n'a que 15 colonnes, et ni `players` ni
 * `synopsis_fr` n'en font partie : ce sont des colonnes **PostgreSQL-only**,
 * comme `subtitles` ou `stream_*` (cf. CLAUDE.md, « pièges DB site »). Le
 * reverse-sync ne les fait donc pas descendre, et lire le replica local
 * donnerait un embed sans le seul contenu qui justifie ce menu : les liens.
 *
 * On tape donc le PostgreSQL, avec un **cache mémoire court** : un fil de forum
 * se parcourt par rafales (un membre clique dix épisodes d'affilée), et un
 * aller-retour par clic sur une base qui vit sur la même machine reste inutile
 * dès le second clic. Le cache est volontairement court — un `players` remis à
 * jour par `shenron-refresh-players.timer` doit se voir dans la minute.
 *
 * ── LA CONNEXION N'EST PAS DANS `apps/shenron/bot/.env` ─────────────────────────────
 * Le bot n'a jamais eu besoin de PostgreSQL : son unit ne charge que
 * `apps/shenron/bot/.env`. Plutôt que d'y ajouter un secret (fichier gitignoré, édition
 * bloquée par un hook), on lit `~/.shenron-neon.env` — le fichier que tous les
 * scripts du dépôt utilisent déjà — en prenant la **DERNIÈRE** ligne
 * `^DATABASE_URL=` : la première est l'ancienne URL Neon, laissée en
 * commentaire mais qu'un `grep | head -1` attrape (piège documenté).
 * `DATABASE_URL` dans l'environnement du process reste prioritaire.
 * Cette résolution vit désormais dans `~/db/pg` (`loadDatabaseUrl`), et le
 * pool est celui, partagé et paresseux, de `PgService` (B2).
 */

/** Un lecteur intégré, tel qu'il est stocké dans le jsonb `players`. */
export interface LecteurEpisode {
	readonly lang?: "vf" | "vostfr" | null;
	readonly name?: string | null;
	readonly provider?: string | null;
	readonly embedUrl?: string | null;
}

/** Un épisode, réduit à ce qu'un embed affiche. */
export interface EpisodeComplet {
	readonly id: number;
	readonly series: string;
	readonly numero: number | null;
	readonly titre: string | null;
	readonly titreJa: string | null;
	readonly dateDiffusion: number | null;
	readonly synopsis: string | null;
	readonly image: string | null;
	readonly players: readonly LecteurEpisode[];
}

/** Ligne brute : postgres-js/Bun rendent les `bigint` en chaînes. */
interface LigneEpisode {
	id: string | number;
	series: string;
	number_in_series: string | number | null;
	title: string | null;
	title_ja: string | null;
	air_date: string | number | null;
	synopsis: string | null;
	image: string | null;
	players: unknown;
}

/** Assez long pour absorber une rafale de clics, assez court pour ne rien figer. */
const TTL_MS = 60_000;

/** Plafond du cache : un fil de saga fait ~40 épisodes, cinq fils en tiennent large. */
const TAILLE_CACHE = 500;

function nombre(v: string | number | null | undefined): number | null {
	if (v === null || v === undefined) return null;
	const n = typeof v === "number" ? v : Number.parseInt(v, 10);
	return Number.isFinite(n) ? n : null;
}

/** L'URL de la base du site, ou `null` si la machine n'en a pas. */
function urlBaseSite(): string | null {
	return resolveBotDatabaseUrl();
}

@singleton()
export class EpisodesService {
	private sqlSignale = false;
	private readonly cache = new Map<number, { at: number; episode: EpisodeComplet | null }>();

	constructor(@inject(PgService) private readonly pg: PgService) {}

	/** Connexion paresseuse : un bot sans accès PostgreSQL doit démarrer quand même. */
	private connexion(): SQL | null {
		const handle = this.pg.get();
		if (handle) return handle.sql;
		if (!this.sqlSignale) {
			this.sqlSignale = true;
			logger.warn("[episodes] aucune DATABASE_URL : les menus d'épisodes seront muets");
		}
		return null;
	}

	private normalise(ligne: LigneEpisode): EpisodeComplet {
		const brut = ligne.players;
		const players = Array.isArray(brut)
			? (brut as LecteurEpisode[])
			: typeof brut === "string"
				? (() => {
						// Un jsonb écrit sans `sql.json()` ressort en scalaire chaîne
						// (piège documenté dans CLAUDE.md) : on le rattrape en lecture.
						try {
							const v: unknown = JSON.parse(brut);
							return Array.isArray(v) ? (v as LecteurEpisode[]) : [];
						} catch {
							return [];
						}
					})()
				: [];
		return {
			id: nombre(ligne.id) ?? 0,
			series: ligne.series,
			numero: nombre(ligne.number_in_series),
			titre: ligne.title,
			titreJa: ligne.title_ja,
			dateDiffusion: nombre(ligne.air_date),
			synopsis: ligne.synopsis,
			image: ligne.image,
			players: players.filter((p) => p && typeof p === "object"),
		};
	}

	/** Un épisode par son identifiant, `null` s'il est inconnu ou masqué. */
	async parId(id: number): Promise<EpisodeComplet | null> {
		const enCache = this.cache.get(id);
		if (enCache && Date.now() - enCache.at < TTL_MS) return enCache.episode;

		const sql = this.connexion();
		if (!sql) return null;
		try {
			const lignes = (await sql`
				select id, series, number_in_series, title, title_ja, air_date,
				       coalesce(synopsis_fr, synopsis) as synopsis, image, players
				  from bot.db_episodes
				 where id = ${id} and visible
				 limit 1
			`) as LigneEpisode[];
			const episode = lignes[0] ? this.normalise(lignes[0]) : null;
			if (this.cache.size >= TAILLE_CACHE) this.cache.clear();
			this.cache.set(id, { at: Date.now(), episode });
			return episode;
		} catch (e) {
			logger.warn({ err: e, id }, "[episodes] lecture PostgreSQL en échec");
			return enCache?.episode ?? null;
		}
	}
}
