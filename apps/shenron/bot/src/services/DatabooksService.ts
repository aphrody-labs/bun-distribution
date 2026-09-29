import { resolveSiteUrl } from "@shenron/config/public-urls";
import { singleton } from "tsyringe";
import { logger } from "~/lib/logger";

/**
 * Databooks — client de l'API du site.
 *
 * **Pourquoi HTTP et pas la base locale.** Le bot lit tout le reste du wiki dans
 * son SQLite, tenu à jour par le reverse-sync (`shenron-neon-pull`). Les
 * databooks n'y sont pas, et ce n'est pas un oubli à rattraper :
 *
 *   1. `db_databooks` ne fait pas partie de `WIKI_EDITORIAL`, donc la table
 *      n'existe pas côté SQLite ;
 *   2. surtout, les transcriptions vivent dans la colonne `pages` (jsonb), qui
 *      est **PostgreSQL-only** — comme `players`, `frames` ou `subtitles`. Même
 *      en ajoutant la table au sync, le texte des planches ne suivrait pas.
 *
 * Répliquer 9,5 Mo de jsonb dans le SQLite du bot pour afficher un extrait dans
 * un embed serait cher et redondant : le site expose déjà `/api/databooks` et
 * `/api/databooks/search` en lecture publique, adossés à l'index trigramme.
 *
 * Conséquence assumée : ces commandes dépendent du site. En cas
 * d'indisponibilité on renvoie un message clair plutôt qu'une trace — c'est le
 * même contrat de dégradation que le RAG face au sidecar d'embeddings.
 */

/** Une planche : image et/ou texte transcrit. */
interface DatabookPage {
	number: number;
	image: string | null;
	text: string | null;
}

export interface Databook {
	id: number;
	kind: string;
	title: string;
	title_ja: string | null;
	author: string | null;
	published_at: number | null;
	cover: string | null;
	description: string | null;
	source_url: string | null;
	category: string | null;
	visible: boolean;
	pages: DatabookPage[];
}

/** Une planche remontée par la recherche plein texte. */
export interface PlancheTrouvee {
	databookId: number;
	titre: string;
	categorie: string | null;
	cover: string | null;
	numero: number;
	image: string | null;
	texte: string;
}

const BASE = resolveSiteUrl(Bun.env);

/** L'autocomplete Discord doit répondre en moins de 3 s — au-delà, autant abandonner. */
const TIMEOUT_MS = 4_000;

/** Durée de vie du catalogue en mémoire (titres seuls, pour l'autocomplete). */
const TTL_CATALOGUE_MS = 5 * 60_000;

@singleton()
export class DatabooksService {
	/** Catalogue léger, rafraîchi à la demande : l'autocomplete tape à chaque frappe. */
	private catalogue: { at: number; items: Databook[] } | null = null;

	private async get<T>(chemin: string): Promise<T | null> {
		try {
			const r = await fetch(`${BASE}${chemin}`, {
				headers: { accept: "application/json" },
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (!r.ok) {
				logger.warn({ chemin, status: r.status }, "[databooks] réponse non-OK de l'API du site");
				return null;
			}
			return (await r.json()) as T;
		} catch (e) {
			logger.warn({ chemin, err: e }, "[databooks] appel à l'API du site en échec");
			return null;
		}
	}

	/**
	 * Catalogue complet (métadonnées + planches).
	 *
	 * `limit=200` est le plafond de l'API, et il y a 318 fiches : on pagine.
	 */
	async listAll(): Promise<Databook[]> {
		if (this.catalogue && Date.now() - this.catalogue.at < TTL_CATALOGUE_MS) {
			return this.catalogue.items;
		}
		const items: Databook[] = [];
		for (let offset = 0; offset < 1_000; offset += 200) {
			const page = await this.get<{ items: Databook[]; total: number }>(
				`/api/databooks?limit=200&offset=${offset}`
			);
			if (!page) return this.catalogue?.items ?? [];
			items.push(...page.items);
			if (items.length >= page.total || page.items.length === 0) break;
		}
		this.catalogue = { at: Date.now(), items };
		return items;
	}

	/** Fiches dont le titre, le titre japonais ou l'auteur contient `terme`. */
	async searchTitles(terme: string, limit = 25): Promise<Databook[]> {
		const tous = await this.listAll();
		const t = terme.trim().toLocaleLowerCase();
		if (!t) return tous.slice(0, limit);
		return tous
			.filter((d) =>
				[d.title, d.title_ja, d.author].some((v) => v?.toLocaleLowerCase().includes(t))
			)
			.slice(0, limit);
	}

	async get1(id: number): Promise<Databook | null> {
		return this.get<Databook>(`/api/databooks/${id}`);
	}

	/**
	 * Cherche une chaîne dans le TEXTE DES PLANCHES.
	 *
	 * C'est la seule chose que le bot ne pourrait pas faire seul : l'index qui
	 * rend cette requête possible (trigramme sur `bot.databook_pages_text`) est
	 * posé sur le PostgreSQL du site.
	 */
	async searchPages(
		terme: string,
		limit = 25
	): Promise<{ items: PlancheTrouvee[]; total: number; fiches: number } | null> {
		return this.get(
			`/api/databooks/search?q=${encodeURIComponent(terme)}&limit=${Math.min(100, limit)}`
		);
	}
}
