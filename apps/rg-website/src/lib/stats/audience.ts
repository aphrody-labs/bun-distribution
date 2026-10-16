import "server-only";


/**
 * Agrégation de l'audience par domaine, lue depuis le journal nginx unifié.
 *
 * SOURCE
 * `/var/log/nginx/rg-stats.log`, alimenté par tous les vhosts Rose Griffon au
 * format `rg_stats` (cf. `infra/nginx/00-rg-stats.conf`). Une ligne par requête,
 * champs séparés par des tabulations — aucun des champs journalisés ne peut en
 * contenir, contrairement aux espaces et guillemets du format `combined`, qui
 * imposent une expression régulière fragile.
 *
 * LECTURE
 * `Bun.file().stream()` plutôt que `node:fs` + `node:readline` : le monorepo
 * impose les APIs Bun natives, et le découpage en lignes se fait ici sur le flux
 * décodé à la volée — mémoire bornée quelle que soit la taille du journal, là où
 * un `.text()` chargerait les douze mégaoctets d'une journée d'un coup.
 *
 * POURQUOI PAS DE BASE DE DONNÉES
 * Le journal EST la source. Recopier chaque requête en base coûterait plus cher
 * que de relire un fichier séquentiel, et introduirait un décalage. La lecture
 * est bornée (`MAX_LIGNES`) et le résultat mis en cache par la page.
 *
 * LIMITE ASSUMÉE
 * Seuls les domaines servis par CE serveur apparaissent. `achillea.rosegriffon.fr`
 * vit sur un second VPS (51.255.162.6) : son audience n'est pas visible ici, et
 * la page le dit plutôt que d'afficher un zéro trompeur.
 */

const CHEMIN_JOURNAL = "/var/log/nginx/rg-stats.log";
const CHEMIN_JOURNAL_PRECEDENT = "/var/log/nginx/rg-stats.log.1";

/** Plafond de lecture : au-delà, on tronque plutôt que de bloquer le rendu. */
const MAX_LIGNES = 400_000;

export interface StatsDomaine {
	host: string;
	requetes: number;
	visiteurs: number;
	octets: number;
	erreurs4xx: number;
	erreurs5xx: number;
	/** Millisecondes. Médiane et 95ᵉ centile du temps de réponse vu du client. */
	medianeMs: number;
	p95Ms: number;
	/** Part des réponses servies par le cache nginx, quand il est actif. */
	tauxCache: number | null;
	topChemins: { chemin: string; requetes: number }[];
	topReferents: { referent: string; requetes: number }[];
}

export interface RapportAudience {
	depuis: string;
	jusqua: string;
	lignesLues: number;
	tronque: boolean;
	journalDisponible: boolean;
	domaines: StatsDomaine[];
}

interface Accumulateur {
	requetes: number;
	visiteurs: Set<string>;
	octets: number;
	erreurs4xx: number;
	erreurs5xx: number;
	durees: number[];
	cacheHit: number;
	cacheTotal: number;
	chemins: Map<string, number>;
	referents: Map<string, number>;
}

function nouvelAccumulateur(): Accumulateur {
	return {
		cacheHit: 0,
		cacheTotal: 0,
		chemins: new Map(),
		durees: [],
		erreurs4xx: 0,
		erreurs5xx: 0,
		octets: 0,
		referents: new Map(),
		requetes: 0,
		visiteurs: new Set(),
	};
}

/**
 * Découpe un fichier en lignes, sans jamais le charger entièrement.
 *
 * `BunFile.stream()` livre des `Uint8Array` dont les frontières ne coïncident
 * pas avec les fins de ligne : le reste de chunk est donc conservé d'une
 * itération à l'autre. `TextDecoder` en mode `stream` gère au passage les
 * caractères multi-octets coupés en deux — un pseudo accentué à cheval sur deux
 * chunks produirait sinon un caractère de remplacement.
 */
async function* lignes(fichier: ReturnType<typeof Bun.file>): AsyncGenerator<string> {
	const decodeur = new TextDecoder();
	let reste = "";

	for await (const morceau of fichier.stream()) {
		reste += decodeur.decode(morceau as Uint8Array, { stream: true });
		let coupure = reste.indexOf("\n");
		while (coupure !== -1) {
			yield reste.slice(0, coupure);
			reste = reste.slice(coupure + 1);
			coupure = reste.indexOf("\n");
		}
	}

	reste += decodeur.decode();
	if (reste) {
		yield reste;
	}
}

/** Centile sur une série déjà triée. */
function centile(triees: number[], part: number): number {
	if (triees.length === 0) {
		return 0;
	}
	const index = Math.min(triees.length - 1, Math.floor(triees.length * part));
	return Math.round((triees[index] ?? 0) * 1000);
}

function meilleurs(compteur: Map<string, number>, combien: number) {
	return [...compteur.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, combien)
		.map(([cle, requetes]) => ({ cle, requetes }));
}

/**
 * Regroupe les chemins qui ne diffèrent que par un identifiant.
 *
 * Sans ça, les 250 000 fichiers du navigateur CPK et les milliers de fiches du
 * wiki produisent un « top » où chaque entrée vaut une requête — donc aucune
 * information. On remplace les segments qui ressemblent à un identifiant par un
 * marqueur : `/chara/abc123` et `/chara/def456` deviennent `/chara/:id`.
 */
function normaliserChemin(chemin: string): string {
	return chemin
		.split("/")
		.map((segment) => {
			if (!segment) {
				return segment;
			}
			if (/^\d+$/.test(segment)) {
				return ":n";
			}
			if (/^[0-9a-f]{8,}$/i.test(segment)) {
				return ":id";
			}
			if (/^0x[0-9a-f]+$/i.test(segment)) {
				return ":id";
			}
			// Slug très long ou mêlant chiffres et lettres de façon peu lisible.
			if (segment.length > 24 && /\d/.test(segment)) {
				return ":id";
			}
			return segment;
		})
		.join("/");
}

/** Domaine d'un référent, pour éviter un top d'URL complètes illisible. */
function domaineReferent(referent: string): string | null {
	if (!referent || referent === "-") {
		return null;
	}
	try {
		return new URL(referent).host;
	} catch {
		return null;
	}
}

/**
 * Lit le journal et agrège par domaine sur la fenêtre demandée.
 *
 * La lecture part du fichier courant puis, si la fenêtre remonte plus loin, du
 * fichier de la veille. Les fichiers compressés par logrotate ne sont pas lus :
 * au-delà de deux jours, la question relève d'un entrepôt, pas d'un `tail`.
 */
export async function lireAudience(heures = 24): Promise<RapportAudience> {
	const debut = Date.now() - heures * 3600_000;
	const parDomaine = new Map<string, Accumulateur>();
	let lignesLues = 0;
	let tronque = false;
	let journalDisponible = false;

	for (const chemin of [CHEMIN_JOURNAL_PRECEDENT, CHEMIN_JOURNAL]) {
		if (tronque) {
			break;
		}
		const fichier = Bun.file(chemin);
		if (!(await fichier.exists())) {
			continue;
		}
		journalDisponible = true;

		try {
			for await (const ligne of lignes(fichier)) {
				if (lignesLues >= MAX_LIGNES) {
					tronque = true;
					break;
				}
				const champs = ligne.split("\t");
				if (champs.length < 12) {
					continue;
				}
				const [
					horodatage,
					host,
					,
					uri,
					statut,
					octets,
					dureeRequete,
					,
					statutCache,
					referent,
					,
					ip,
				] = champs;

				const instant = Date.parse(horodatage ?? "");
				if (!Number.isFinite(instant) || instant < debut) {
					continue;
				}
				if (!host || host === "-") {
					continue;
				}

				lignesLues += 1;
				let acc = parDomaine.get(host);
				if (!acc) {
					acc = nouvelAccumulateur();
					parDomaine.set(host, acc);
				}

				acc.requetes += 1;
				if (ip) {
					acc.visiteurs.add(ip);
				}
				acc.octets += Number.parseInt(octets ?? "0", 10) || 0;

				const code = Number.parseInt(statut ?? "0", 10) || 0;
				if (code >= 500) {
					acc.erreurs5xx += 1;
				} else if (code >= 400) {
					acc.erreurs4xx += 1;
				}

				const duree = Number.parseFloat(dureeRequete ?? "");
				if (Number.isFinite(duree)) {
					acc.durees.push(duree);
				}

				// `-` signifie « pas de cache configuré sur cette route » : on ne
				// compte que les routes réellement cachables, sinon le taux d'un site
				// applicatif serait mécaniquement nul et sans signification.
				if (statutCache && statutCache !== "-") {
					acc.cacheTotal += 1;
					if (statutCache === "HIT") {
						acc.cacheHit += 1;
					}
				}

				const chemin = normaliserChemin(uri ?? "/");
				acc.chemins.set(chemin, (acc.chemins.get(chemin) ?? 0) + 1);

				const source = domaineReferent(referent ?? "");
				if (source) {
					acc.referents.set(source, (acc.referents.get(source) ?? 0) + 1);
				}
			}
		} catch (error) {
			console.error(`[stats] lecture de ${chemin} impossible`, error);
		}
	}

	const domaines: StatsDomaine[] = [...parDomaine.entries()]
		.map(([host, acc]) => {
			const triees = acc.durees.sort((a, b) => a - b);
			return {
				erreurs4xx: acc.erreurs4xx,
				erreurs5xx: acc.erreurs5xx,
				host,
				medianeMs: centile(triees, 0.5),
				octets: acc.octets,
				p95Ms: centile(triees, 0.95),
				requetes: acc.requetes,
				tauxCache: acc.cacheTotal > 0 ? acc.cacheHit / acc.cacheTotal : null,
				topChemins: meilleurs(acc.chemins, 8).map((e) => ({
					chemin: e.cle,
					requetes: e.requetes,
				})),
				topReferents: meilleurs(acc.referents, 5).map((e) => ({
					referent: e.cle,
					requetes: e.requetes,
				})),
				visiteurs: acc.visiteurs.size,
			};
		})
		.sort((a, b) => b.requetes - a.requetes);

	return {
		depuis: new Date(debut).toISOString(),
		domaines,
		journalDisponible,
		jusqua: new Date().toISOString(),
		lignesLues,
		tronque,
	};
}

/**
 * Audience des domaines servis par le SECOND serveur.
 *
 * `achillea.rosegriffon.fr` et `ranked.rosegriffon.fr` tournent sur un autre
 * VPS : leur journal n'est pas lisible d'ici. La tâche planifiée
 * `stats:achillea` le tire par SSH toutes les quinze minutes, l'agrège et écrit
 * le résultat dans ce fichier. On le lit tel quel plutôt que d'ouvrir une
 * connexion SSH depuis le rendu d'une page.
 */
const CHEMIN_DISTANT = "/var/lib/rg/achillea-audience.json";

export interface AudienceDistante {
	collecteLe: string;
	domaines: StatsDomaine[];
}

export async function lireAudienceDistante(): Promise<AudienceDistante | null> {
	try {
		const fichier = Bun.file(CHEMIN_DISTANT);
		if (!(await fichier.exists())) {
			return null;
		}
		const brut = (await fichier.json()) as {
			collecteLe?: string;
			domaines?: Partial<StatsDomaine>[];
		};
		return {
			collecteLe: brut.collecteLe ?? "",
			domaines: (brut.domaines ?? []).map((d) => ({
				erreurs4xx: d.erreurs4xx ?? 0,
				erreurs5xx: d.erreurs5xx ?? 0,
				host: d.host ?? "",
				medianeMs: d.medianeMs ?? 0,
				octets: d.octets ?? 0,
				p95Ms: d.p95Ms ?? 0,
				requetes: d.requetes ?? 0,
				// Le collecteur distant ne remonte ni référents ni statut de cache :
				// ils exigeraient de transférer bien plus de lignes pour une page qui
				// n'en affiche que le sommet.
				tauxCache: null,
				topChemins: d.topChemins ?? [],
				topReferents: [],
				visiteurs: d.visiteurs ?? 0,
			})),
		};
	} catch (error) {
		console.error("[stats] lecture de l'audience distante impossible", error);
		return null;
	}
}
