/**
 * scans-couleur.ts — Résolution des planches « Full Color » hébergées sur le CDN
 * Discord.
 *
 * POURQUOI CE MODULE EXISTE (mesuré le 2026-09-02, pas supposé)
 * ------------------------------------------------------------
 * Les 7 954 planches couleur vivent en pièces jointes du forum « 📖・scan-db ».
 * Depuis 2024, une URL `cdn.discordapp.com/attachments/…` n'est servie QUE
 * signée. Les trois mesures qui commandent tout ce fichier :
 *
 *   (a) URL signée du manifeste ............................. HTTP 200
 *   (b) même URL privée de `?ex=&is=&hm=` ................... HTTP 404
 *   (c) POST /api/v10/attachments/refresh-urls (jeton bot) .. HTTP 200
 *
 * La signature porte sa propre fenêtre : `is` = début, `ex` = fin, en hexa,
 * **24 h d'écart exactement** sur les URL relevées. Une page ISR ne peut donc
 * pas pointer le CDN en dur : le HTML resterait en cache des heures après
 * l'expiration et le lecteur n'afficherait que des 404.
 *
 * D'où la redirection : le site pointe une URL STABLE de notre API
 * (`/api/public/manga/couleur/…`) et c'est nous qui, à chaque requête, rendons
 * un `302` vers une signature fraîche. Le HTML mis en cache reste valable
 * indéfiniment, et les 3,2 Go d'images ne transitent jamais par le VPS — c'est
 * le CDN de Discord qui sert l'octet.
 *
 * Trois détails du endpoint de rafraîchissement, tous mesurés :
 *   - il accepte **50 URL au maximum** par appel (au-delà : 400 `BASE_TYPE_BAD_LENGTH`) ;
 *   - il est plafonné à **10 appels par fenêtre** (`x-ratelimit-limit: 10`),
 *     soit 500 URL — d'où le regroupement des demandes en un seul appel ;
 *   - il rend la **même** signature tant qu'on est dans la fenêtre en cours.
 *     Rafraîchir plus souvent que la fenêtre ne sert donc à rien : on met en
 *     cache jusqu'à l'échéance réelle, lue dans `ex`.
 */
import { env } from "~/lib/env";
import { logger } from "~/lib/logger";

const API_DISCORD = "https://discord.com/api/v10";

/** Racine du CDN Discord. Toute URL résolue ici doit en descendre. */
const RACINE_CDN = "https://cdn.discordapp.com/attachments/";

/** Le endpoint refuse plus de 50 URL par appel (mesuré : 400 au-delà). */
const LOT_MAX = 50;

/**
 * Marge de sécurité avant l'échéance annoncée par `ex`.
 *
 * Une signature rendue à un client juste avant sa mort produirait une image
 * cassée après que notre `302` a été suivi. On la considère périmée 30 min
 * avant l'heure.
 */
const MARGE_MS = 30 * 60_000;

/** Échéance de repli quand l'URL rendue ne porte pas de `ex` lisible. */
const DUREE_DEFAUT_MS = 60 * 60_000;

/**
 * Où la chaîne d'ingestion dépose la liste des fils du forum autorisés.
 *
 * La redirection reconstruit l'URL CDN à partir de l'URL demandée, sans état :
 * c'est ce qui la rend simple et increvable, mais cela ferait aussi de nous un
 * rafraîchisseur d'URL Discord ouvert à tous. L'allowlist ferme la porte : seuls
 * les salons réellement indexés par `ingest-scans-couleur.ts` sont servis.
 * Fichier compact (une liste d'identifiants) : le manifeste complet pèse 3,8 Mo
 * et n'a rien à faire dans la mémoire de l'API.
 */
const CHEMIN_SALONS = new URL("../../data/scans-couleur-salons.json", import.meta.url).pathname;

/** Une signature en cours de validité, et l'instant où elle cesse de l'être. */
interface Signature {
	readonly url: string;
	readonly expireA: number;
}

const cache = new Map<string, Signature>();

/** Demandes en vol, regroupées par lot pour ne pas brûler le quota d'appels. */
let enAttente = new Map<string, Array<(sig: Signature | null) => void>>();
let minuteurLot: ReturnType<typeof setTimeout> | null = null;

let salons: Set<string> | null = null;
let salonsCharges = 0;

/** Les fils du forum autorisés, relus au plus une fois par minute. */
async function salonsAutorises(): Promise<Set<string>> {
	if (salons && Date.now() - salonsCharges < 60_000) return salons;
	try {
		const brut = (await Bun.file(CHEMIN_SALONS).json()) as unknown;
		const liste = Array.isArray(brut) ? brut : [];
		salons = new Set(liste.filter((x): x is string => typeof x === "string"));
	} catch {
		// Absent = chaîne couleur non ingérée sur cet hôte : on refuse tout,
		// plutôt que d'ouvrir la redirection à n'importe quel salon.
		salons = new Set<string>();
	}
	salonsCharges = Date.now();
	return salons;
}

/** L'échéance réelle d'une URL signée, lue dans `ex` (timestamp UNIX en hexa). */
function echeance(url: string): number {
	const ex = new URL(url).searchParams.get("ex");
	const secondes = ex ? Number.parseInt(ex, 16) : Number.NaN;
	if (!Number.isFinite(secondes)) return Date.now() + DUREE_DEFAUT_MS;
	return secondes * 1000;
}

/** Un appel de rafraîchissement pour un lot d'au plus 50 URL nues. */
async function rafraichitLot(urls: readonly string[]): Promise<Map<string, Signature>> {
	const sorti = new Map<string, Signature>();
	const res = await fetch(`${API_DISCORD}/attachments/refresh-urls`, {
		method: "POST",
		headers: {
			Authorization: `Bot ${env.DISCORD_TOKEN_GRAND_PRETRE}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ attachment_urls: urls }),
	});
	if (!res.ok) {
		logger.warn(`[scans-couleur] refresh-urls → HTTP ${res.status} (${urls.length} URL)`);
		return sorti;
	}
	const corps = (await res.json()) as {
		refreshed_urls?: Array<{ original?: string; refreshed?: string }>;
	};
	for (const item of corps.refreshed_urls ?? []) {
		if (!item.original || !item.refreshed) continue;
		sorti.set(item.original, { url: item.refreshed, expireA: echeance(item.refreshed) });
	}
	return sorti;
}

/** Vide la file d'attente en un minimum d'appels au endpoint. */
async function videLaFile(): Promise<void> {
	const file = enAttente;
	enAttente = new Map();
	minuteurLot = null;

	const urls = [...file.keys()];
	for (let i = 0; i < urls.length; i += LOT_MAX) {
		const lot = urls.slice(i, i + LOT_MAX);
		let resolus = new Map<string, Signature>();
		try {
			resolus = await rafraichitLot(lot);
		} catch (err) {
			logger.warn(`[scans-couleur] rafraîchissement en échec : ${String(err)}`);
		}
		for (const nue of lot) {
			const sig = resolus.get(nue) ?? null;
			if (sig) cache.set(nue, sig);
			for (const rendre of file.get(nue) ?? []) rendre(sig);
		}
	}
}

/**
 * Une URL signée et valide pour la pièce jointe donnée, ou `null`.
 *
 * Les demandes concurrentes sur des planches différentes (un lecteur ouvre une
 * page, le navigateur précharge la suivante) sont regroupées dans le même appel
 * réseau : sans cela, 20 planches = 20 appels, et le quota de 10 par fenêtre
 * saute au premier chapitre ouvert.
 */
export async function urlSignee(urlNue: string): Promise<string | null> {
	const connue = cache.get(urlNue);
	if (connue && connue.expireA - MARGE_MS > Date.now()) return connue.url;

	return new Promise<string | null>((resoudre) => {
		const rendre = (sig: Signature | null) => resoudre(sig?.url ?? null);
		const deja = enAttente.get(urlNue);
		if (deja) deja.push(rendre);
		else enAttente.set(urlNue, [rendre]);
		// Une fenêtre courte suffit à agréger la rafale de préchargement d'un
		// lecteur sans rien ajouter de perceptible à la latence de la 1re planche.
		minuteurLot ??= setTimeout(() => void videLaFile(), 15);
	});
}

/** Une pièce jointe du forum, telle que l'URL publique la décrit. */
export interface CiblePlanche {
	readonly salonId: string;
	readonly pieceJointeId: string;
	readonly fichier: string;
}

const ID = /^\d{17,20}$/;
/** Discord conserve le nom d'origine ; il fait partie de l'URL à rafraîchir. */
const FICHIER = /^[\w.-]{1,120}\.(jpg|jpeg|png|webp|gif)$/i;

/**
 * Valide une cible et rend l'URL CDN **nue** correspondante.
 *
 * `null` si la forme est invalide ou si le salon n'est pas un fil indexé — sans
 * quoi la route servirait de rafraîchisseur universel d'URL Discord.
 */
export async function urlNueDe(cible: CiblePlanche): Promise<string | null> {
	if (!ID.test(cible.salonId) || !ID.test(cible.pieceJointeId)) return null;
	if (!FICHIER.test(cible.fichier)) return null;
	if (!(await salonsAutorises()).has(cible.salonId)) return null;
	return `${RACINE_CDN}${cible.salonId}/${cible.pieceJointeId}/${cible.fichier}`;
}

/** Nombre de signatures actuellement en cache (sonde). */
function tailleCacheCouleur(): number {
	return cache.size;
}
