/**
 * Registre des services internes du monorepo, et client HTTP unique pour les
 * joindre.
 *
 * ── POURQUOI CE FICHIER ────────────────────────────────────────────────────
 * Le bot était la seule surface Discord d'un monorepo qui expose plusieurs
 * services en boucle locale. Chaque commande qui voulait en joindre un refaisait le même
 * travail dans son coin : un `fetch` sans délai d'expiration, une URL en dur, un
 * message d'erreur différent pour la même panne. Résultat, une commande pouvait
 * rester bloquée jusqu'à ce que Discord invalide son jeton (3 s pour la
 * première réponse, 15 min ensuite) sans jamais dire ce qui n'allait pas.
 *
 * Ici, un seul endroit décrit QUI existe, sur quel port, derrière quelle unité
 * systemd et sous quelle URL publique ; et une seule fonction sait appeler,
 * réessayer, abandonner et expliquer.
 *
 * ── PORTS : ALIGNÉS SUR LE CATALOGUE D'INFRASTRUCTURE ──────────────────────
 * Les ports et unités reprennent `config/service-catalog.json`,
 * seule source de vérité de la topologie du VPS. Ils sont surchargeables par
 * variable d'environnement, parce qu'un poste de développement n'a pas la même
 * topologie que le VPS.
 *
 * L'API de données Azalée est un montage de `rg-api` : il n'y a plus de daemon
 * headless ni de port dédié à superviser.
 */

/** Identifiants stables des services. Sert de clé partout ailleurs. */
export type NomService =
	| "rg-api"
	| "cdn"
	| "storage"
	| "realtime"
	| "wiki"
	| "site";

export interface DescriptionService {
	/** Clé stable. */
	readonly nom: NomService;
	/** Libellé lisible, affiché dans les embeds. */
	readonly titre: string;
	/** Base en boucle locale, sans barre oblique finale. */
	readonly base: string;
	/** Chemin de la sonde de santé. */
	readonly sante: string;
	/** URL publique correspondante, pour les liens des embeds. */
	readonly publique: string;
	/** Unité systemd, quand il y en a une — pour dire quoi regarder en panne. */
	readonly unite: string | null;
	/** À quoi sert ce service, en une ligne. */
	readonly role: string;
}

function local(port: number, variable: string): string {
	const brut = Bun.env[variable];
	return (brut && brut.trim().length > 0 ? brut : `http://127.0.0.1:${port}`).replace(/\/+$/, "");
}

function publique(variable: string, defaut: string): string {
	const brut = Bun.env[variable];
	return (brut && brut.trim().length > 0 ? brut : defaut).replace(/\/+$/, "");
}

export const SERVICES: Readonly<Record<NomService, DescriptionService>> = {
	"rg-api": {
		nom: "rg-api",
		titre: "API unifiée (Azalée inclus)",
		base: local(8800, "UNIFIED_API_URL"),
		sante: "/health",
		publique: publique("API_PUBLIC_URL", "https://api.rosegriffon.fr"),
		unite: "rg-api.service",
		role: "API Elysia + Kysely et montage /v1/azalee",
	},
	cdn: {
		nom: "cdn",
		titre: "CDN",
		base: local(8801, "CDN_API_URL"),
		sante: "/health",
		publique: publique("CDN_URL", "https://cdn.rosegriffon.fr"),
		unite: "rg-cdn.service",
		role: "images servies et téléversées",
	},
	storage: {
		nom: "storage",
		titre: "Stockage",
		base: local(8810, "STORAGE_URL"),
		sante: "/health",
		publique: `${publique("WEBSITE_URL", "https://rosegriffon.fr")}/storage/v1`,
		unite: "rg-storage.service",
		role: "fichiers des seaux publics et privés",
	},
	realtime: {
		nom: "realtime",
		titre: "Temps réel",
		base: local(8812, "REALTIME_URL"),
		sante: "/health",
		publique: `${publique("WEBSITE_URL", "https://rosegriffon.fr")}/realtime/v1`,
		unite: "rg-realtime.service",
		role: "flux SSE adossé à LISTEN/NOTIFY",
	},
	wiki: {
		nom: "wiki",
		titre: "Wiki Azalée",
		base: local(3004, "WEBSITE_INTERNAL_URL"),
		sante: "/api/health",
		publique: publique("AZALEE_URL", "https://azalee.rosegriffon.fr"),
		unite: "rg-website.service",
		role: "le wiki `/wiki` de l'application Website unifiée",
	},
	site: {
		nom: "site",
		titre: "Site Rose Griffon",
		base: local(3004, "WEBSITE_INTERNAL_URL"),
		sante: "/api/health",
		publique: publique("WEBSITE_URL", "https://rosegriffon.fr"),
		unite: "rg-website.service",
		role: "l'application Next du site principal",
	},
} as const;

/** Tous les services, dans un ordre d'affichage stable. */
export const TOUS_LES_SERVICES: readonly DescriptionService[] = Object.freeze(
	Object.values(SERVICES)
);

/**
 * Panne d'un service interne. Porte de quoi dire à un membre ce qui se passe
 * SANS lui montrer une pile d'appels, et à un administrateur quelle unité
 * systemd regarder.
 */
export class ServiceIndisponibleError extends Error {
	constructor(
		readonly service: NomService,
		message: string,
		readonly statut?: number
	) {
		super(message);
		this.name = "ServiceIndisponibleError";
	}

	/** Phrase prête à poser dans un embed. */
	get messageLisible(): string {
		const desc = SERVICES[this.service];
		const unite = desc.unite ? ` (unité \`${desc.unite}\`)` : "";
		return this.statut !== undefined
			? `${desc.titre} a répondu ${this.statut}${unite}.`
			: `${desc.titre} est injoignable${unite} — ${this.message}`;
	}
}

export interface OptionsAppel {
	/** Paramètres d'URL. Les valeurs `undefined` et `null` sont ignorées. */
	requete?: Record<string, string | number | boolean | undefined | null>;
	/** Verbe HTTP. `GET` par défaut. */
	methode?: string;
	/** Corps JSON. Pose `content-type` tout seul. */
	corps?: unknown;
	/** Délai d'expiration par tentative. 8 s par défaut. */
	delaiMs?: number;
	/** Nombre total de tentatives, la première comprise. 3 par défaut. */
	tentatives?: number;
	/** En-têtes additionnels. */
	entetes?: Record<string, string>;
}

const DELAI_DEFAUT_MS = 8_000;
const TENTATIVES_DEFAUT = 3;

/** Un 5xx ou une coupure réseau se réessaient ; un 4xx est une réponse, pas une panne. */
function reessayable(statut: number): boolean {
	return statut >= 500 || statut === 429;
}

function construireUrl(
	desc: DescriptionService,
	chemin: string,
	requete: OptionsAppel["requete"]
): string {
	const url = new URL(chemin.startsWith("/") ? chemin : `/${chemin}`, `${desc.base}/`);
	for (const [clef, valeur] of Object.entries(requete ?? {})) {
		if (valeur !== undefined && valeur !== null) {
			url.searchParams.set(clef, String(valeur));
		}
	}
	return url.toString();
}

/**
 * Appelle un service interne et renvoie sa réponse JSON.
 *
 * Le délai d'expiration n'est pas une précaution de style : sans lui, un service
 * qui accepte la connexion sans jamais répondre fige la commande jusqu'à
 * l'expiration du jeton d'interaction, et le membre ne voit qu'un « réfléchit… »
 * éternel. Ici l'appel abandonne, et la commande peut dire pourquoi.
 */
export async function appelService<T>(
	nom: NomService,
	chemin: string,
	options: OptionsAppel = {}
): Promise<T> {
	const desc = SERVICES[nom];
	const url = construireUrl(desc, chemin, options.requete);
	const tentatives = Math.max(1, options.tentatives ?? TENTATIVES_DEFAUT);
	const delaiMs = options.delaiMs ?? DELAI_DEFAUT_MS;

	const entetes = new Headers(options.entetes);
	entetes.set("accept", "application/json");
	let corps: string | undefined;
	if (options.corps !== undefined) {
		corps = JSON.stringify(options.corps);
		entetes.set("content-type", "application/json");
	}

	let derniere: unknown;
	for (let essai = 1; essai <= tentatives; essai++) {
		try {
			const reponse = await fetch(url, {
				method: options.methode ?? (corps === undefined ? "GET" : "POST"),
				headers: entetes,
				body: corps,
				signal: AbortSignal.timeout(delaiMs),
			});

			if (!reponse.ok) {
				if (reessayable(reponse.status) && essai < tentatives) {
					derniere = new ServiceIndisponibleError(nom, `HTTP ${reponse.status}`, reponse.status);
					await Bun.sleep(200 * 2 ** (essai - 1));
					continue;
				}
				throw new ServiceIndisponibleError(nom, `HTTP ${reponse.status}`, reponse.status);
			}

			const texte = await reponse.text();
			if (texte.length === 0) {
				return null as T;
			}
			try {
				return JSON.parse(texte) as T;
			} catch {
				throw new ServiceIndisponibleError(nom, "réponse illisible (JSON attendu)");
			}
		} catch (err) {
			if (err instanceof ServiceIndisponibleError && err.statut !== undefined) {
				throw err;
			}
			derniere = err;
			if (essai < tentatives) {
				await Bun.sleep(200 * 2 ** (essai - 1));
			}
		}
	}

	const raison =
		derniere instanceof Error
			? derniere.name === "TimeoutError"
				? `aucune réponse en ${delaiMs} ms`
				: derniere.message
			: String(derniere);
	throw new ServiceIndisponibleError(nom, raison);
}

/**
 * Récupère une réponse BRUTE (pas de JSON) — pour les téléchargements de
 * fichiers, où l'on veut l'octet et le type MIME, pas un objet.
 */
export async function fluxService(
	nom: NomService,
	chemin: string,
	options: Pick<OptionsAppel, "requete" | "delaiMs" | "entetes"> = {}
): Promise<Response> {
	const desc = SERVICES[nom];
	const url = construireUrl(desc, chemin, options.requete);
	try {
		const reponse = await fetch(url, {
			headers: new Headers(options.entetes),
			signal: AbortSignal.timeout(options.delaiMs ?? DELAI_DEFAUT_MS),
		});
		if (!reponse.ok) {
			throw new ServiceIndisponibleError(nom, `HTTP ${reponse.status}`, reponse.status);
		}
		return reponse;
	} catch (err) {
		if (err instanceof ServiceIndisponibleError) {
			throw err;
		}
		const raison = err instanceof Error ? err.message : String(err);
		throw new ServiceIndisponibleError(nom, raison);
	}
}

export interface SondeService {
	readonly service: DescriptionService;
	readonly ok: boolean;
	readonly latenceMs: number;
	/** Détail renvoyé par la sonde, quand elle en donne un. */
	readonly detail: string | null;
	readonly erreur: string | null;
}

/**
 * Sonde tous les services en parallèle.
 *
 * Une seule tentative et un délai court : ce n'est pas une commande de travail,
 * c'est un tableau de bord — mieux vaut afficher « injoignable » en deux
 * secondes que la vérité en trente.
 */
export async function sonderServices(
	services: readonly DescriptionService[] = TOUS_LES_SERVICES,
	delaiMs = 3_000
): Promise<SondeService[]> {
	return await Promise.all(
		services.map(async (service): Promise<SondeService> => {
			const debut = Bun.nanoseconds();
			try {
				const reponse = await fetch(`${service.base}${service.sante}`, {
					signal: AbortSignal.timeout(delaiMs),
				});
				const latenceMs = Math.round((Bun.nanoseconds() - debut) / 1e6);
				const texte = (await reponse.text()).trim();
				return {
					service,
					ok: reponse.ok,
					latenceMs,
					detail: resumerSonde(texte),
					erreur: reponse.ok ? null : `HTTP ${reponse.status}`,
				};
			} catch (err) {
				return {
					service,
					ok: false,
					latenceMs: Math.round((Bun.nanoseconds() - debut) / 1e6),
					detail: null,
					erreur:
						err instanceof Error
							? err.name === "TimeoutError"
								? `aucune réponse en ${delaiMs} ms`
								: err.message
							: String(err),
				};
			}
		})
	);
}

/**
 * Réduit la charge d'une sonde à une ligne. Les sondes ne renvoient pas la même
 * chose (`{ok, cpkFiles}`, `{ok, uptime}`, une page HTML) : on ne garde que les scalaires courts, et jamais plus de
 * trois, sinon l'embed devient illisible.
 */
function resumerSonde(texte: string): string | null {
	if (texte.length === 0) {
		return null;
	}
	let charge: unknown;
	try {
		charge = JSON.parse(texte);
	} catch {
		return null;
	}
	if (typeof charge !== "object" || charge === null) {
		return null;
	}
	const parts: string[] = [];
	for (const [clef, valeur] of Object.entries(charge as Record<string, unknown>)) {
		if (clef === "ok" || parts.length >= 3) {
			continue;
		}
		if (typeof valeur === "number" || typeof valeur === "boolean") {
			parts.push(`${clef} : ${valeur}`);
		} else if (typeof valeur === "string" && valeur.length <= 48) {
			parts.push(`${clef} : ${valeur}`);
		}
	}
	return parts.length > 0 ? parts.join(" · ") : null;
}
