import "server-only";

/**
 * Index Redis des databooks — miroir de lecture, jamais source de vérité.
 *
 * Postgres reste la référence. Redis sert ici de cache consultable :
 *   - `dbfr:databook:<id>` (hash) — la fiche complète, sérialisée ;
 *   - `dbfr:databook:<id>:textes` (hash) — les transcriptions, une planche par
 *     champ (`<n>` pour le japonais, `<n>:fr` pour la traduction déposée) ;
 *   - `dbfr:databooks:kind:<kind>` (set) — les identifiants par genre ;
 *   - `dbfr:databooks:category:<slug>` (set) — les identifiants par catégorie ;
 *   - `dbfr:databooks:all` (set) — tous les identifiants publiés.
 *
 * Écrit à chaque création/mise à jour/suppression via `lib/databooks.ts`, et
 * reconstructible d'un bloc par `scripts/index-databooks-redis.ts`.
 *
 * **Tolérance aux pannes assumée** : si Redis est absent ou tombe, toutes les
 * fonctions échouent en silence. Le site n'en dépend pour rien — l'indexation
 * est un bonus de lecture, pas un chemin critique. Un `throw` ici ferait échouer
 * une écriture Postgres pourtant réussie.
 */

import { transcriptionsDe } from "@/lib/databooks-index-shared";
import { resolveRedisUrl } from "@shenron/config/services";

/** Base 4 : 0/1/3 sont prises par le bot (indexeur, files, mémoire LLM). */
const DB_INDEX = 4;
const PREFIXE = "dbfr:databook";

/**
 * Client minimal — juste ce que ce module utilise de `Bun.RedisClient`.
 *
 * Le type est déclaré à la main et l'import du module `bun` est DYNAMIQUE : ce
 * module est chargé par le collecteur de Next au build, et un
 * `import { RedisClient } from "bun"` en tête de fichier a fait échouer un build
 * le 2026-08-21 (`Cannot find module 'bun'`, le build tournait alors sous Node).
 * Le build est repassé sous Bun depuis, mais l'import différé reste le bon choix :
 * il garde ce module chargeable par n'importe quel outil d'analyse, et le client
 * n'est ouvert qu'au premier accès réel à l'index.
 */
interface ClientRedis {
	onclose: ((err: Error) => void) | null;
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<unknown>;
	del(key: string): Promise<unknown>;
	sadd(key: string, member: string): Promise<unknown>;
	srem(key: string, member: string): Promise<unknown>;
	scard(key: string): Promise<number>;
	/** Commande brute : les opérations de hash ne sont pas toutes exposées. */
	send(command: string, args: string[]): Promise<unknown>;
}

let client: ClientRedis | null = null;
let chargement: Promise<ClientRedis | null> | null = null;
let indisponible = false;

async function redis(): Promise<ClientRedis | null> {
	if (indisponible) return null;
	if (client) return client;
	if (chargement) return chargement;
	chargement = (async () => {
		try {
			const { RedisClient } = (await import("bun")) as unknown as {
				RedisClient: new (url: string, opts: Record<string, unknown>) => ClientRedis;
			};
			const url = new URL(resolveRedisUrl(process.env));
			url.pathname = `/${DB_INDEX}`;
			const c = new RedisClient(url.toString(), {
				autoReconnect: true,
				maxRetries: 20,
				enableOfflineQueue: false,
			});
			// Client jetable : à la fermeture, la commande suivante en rebâtit un.
			// (Le singleton `bun.redis` abandonne définitivement après `maxRetries` —
			// panne vécue côté bot le 2026-08-21, 8 500 erreurs en douze heures.)
			c.onclose = () => {
				if (client === c) client = null;
				chargement = null;
			};
			client = c;
			return c;
		} catch {
			indisponible = true;
			return null;
		} finally {
			chargement = null;
		}
	})();
	return chargement;
}

interface FicheIndexable {
	id: number;
	kind: string;
	title: string;
	title_ja: string | null;
	author: string | null;
	published_at: number | null;
	cover: string | null;
	description: string | null;
	category: string | null;
	visible: boolean;
	pages: unknown[];
}

const cleFiche = (id: number) => `${PREFIXE}:${id}`;
const cleTextes = (id: number) => `${PREFIXE}:${id}:textes`;

/**
 * Écrit le hash des transcriptions d'un ouvrage.
 *
 * `DEL` puis `HSET` : sans le `DEL`, une planche retirée de l'ouvrage resterait
 * lisible dans l'index pour toujours. La fenêtre où le hash est vide n'est pas
 * un problème — la lecture retombe sur Postgres dès qu'un champ demandé manque.
 * Les champs partent par lots : un `HSET` de 600 arguments est refusé par
 * certains proxys, et rien n'oblige à tout envoyer d'un coup.
 */
async function ecrisTranscriptions(r: ClientRedis, id: number, champs: string[]): Promise<void> {
	const cle = cleTextes(id);
	await r.del(cle);
	if (champs.length === 0) return;
	const LOT = 200; // 100 planches par appel (champ + valeur)
	for (let i = 0; i < champs.length; i += LOT) {
		await r.send("HSET", [cle, ...champs.slice(i, i + LOT)]);
	}
}

/**
 * Transcriptions indexées pour les planches demandées.
 *
 * Rend `null` — et non un objet partiel — dès qu'UNE planche demandée manque à
 * l'index : un lot incomplet ferait croire à l'appelant que la planche n'a pas
 * de transcription, alors qu'elle en a une en base. L'appelant retombe alors sur
 * Postgres pour le lot entier.
 */
export async function readIndexedTextes(
	id: number,
	numeros: number[],
	langue: "ja" | "fr" = "ja"
): Promise<Record<string, string> | null> {
	if (numeros.length === 0) return {};
	const r = await redis();
	if (!r) return null;
	try {
		const champs = numeros.map((n) => (langue === "fr" ? `${n}:fr` : String(n)));
		const brut = (await r.send("HMGET", [cleTextes(id), ...champs])) as (string | null)[] | null;
		if (!Array.isArray(brut) || brut.length !== champs.length) return null;
		const textes: Record<string, string> = {};
		for (let i = 0; i < brut.length; i++) {
			const v = brut[i];
			if (v == null) return null;
			if (v.trim()) textes[String(numeros[i])] = v;
		}
		return textes;
	} catch {
		return null;
	}
}
const cleGenre = (kind: string) => `${PREFIXE}s:kind:${kind}`;
const cleCategorie = (cat: string) => `${PREFIXE}s:category:${cat}`;
const CLE_TOUS = `${PREFIXE}s:all`;

/** Indexe (ou réindexe) une fiche. Retire de l'index si elle est masquée. */
export async function indexDatabook(fiche: FicheIndexable): Promise<void> {
	const r = await redis();
	if (!r) return;
	try {
		if (!fiche.visible) {
			await forgetDatabook(fiche.id);
			return;
		}
		const id = String(fiche.id);
		// Valeur précédente lue AVANT l'écrasement : sans elle, requalifier une
		// fiche (« Interview » → « Art Book ») l'ajoutait au nouveau set sans
		// jamais la retirer de l'ancien. Elle restait donc listée dans les deux
		// catégories jusqu'à un rebuild complet de l'index.
		const ancienBrut = await r.get(cleFiche(fiche.id));
		const pages = Array.isArray(fiche.pages) ? fiche.pages : [];
		const { champs, transcrites, traduites, fautives } = transcriptionsDe(pages);
		await r.set(
			cleFiche(fiche.id),
			JSON.stringify({
				id: fiche.id,
				kind: fiche.kind,
				title: fiche.title,
				title_ja: fiche.title_ja,
				author: fiche.author,
				published_at: fiche.published_at,
				cover: fiche.cover,
				description: fiche.description,
				category: fiche.category,
				pageCount: pages.length,
				transcrites,
				traduites,
				fautives,
			})
		);
		await ecrisTranscriptions(r, fiche.id, champs);
		if (ancienBrut) {
			try {
				const ancien = JSON.parse(ancienBrut) as { kind?: string; category?: string | null };
				if (ancien.kind && ancien.kind !== fiche.kind) await r.srem(cleGenre(ancien.kind), id);
				if (ancien.category && ancien.category !== fiche.category) {
					await r.srem(cleCategorie(ancien.category), id);
				}
			} catch {
				/* entrée d'index illisible : le `sadd` qui suit la remet d'aplomb */
			}
		}
		await r.sadd(CLE_TOUS, id);
		await r.sadd(cleGenre(fiche.kind), id);
		if (fiche.category) await r.sadd(cleCategorie(fiche.category), id);
	} catch {
		/* index best-effort */
	}
}

/** Retire une fiche de l'index (suppression ou passage en masqué). */
export async function forgetDatabook(id: number): Promise<void> {
	const r = await redis();
	if (!r) return;
	try {
		const brut = await r.get(cleFiche(id));
		await r.del(cleFiche(id));
		await r.del(cleTextes(id));
		await r.srem(CLE_TOUS, String(id));
		if (brut) {
			const f = JSON.parse(brut) as { kind?: string; category?: string | null };
			if (f.kind) await r.srem(cleGenre(f.kind), String(id));
			if (f.category) await r.srem(cleCategorie(f.category), String(id));
		}
	} catch {
		/* index best-effort */
	}
}

/** Lit une fiche indexée. `null` si absente ou si Redis est indisponible. */
async function readIndexedDatabook(id: number): Promise<Record<string, unknown> | null> {
	const r = await redis();
	if (!r) return null;
	try {
		const brut = await r.get(cleFiche(id));
		return brut ? (JSON.parse(brut) as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** Compte des entrées indexées — sonde de santé de l'index. */
async function databookIndexStats(): Promise<{ total: number; disponible: boolean }> {
	const r = await redis();
	if (!r) return { total: 0, disponible: false };
	try {
		const n = await r.scard(CLE_TOUS);
		return { total: Number(n) || 0, disponible: true };
	} catch {
		return { total: 0, disponible: false };
	}
}
