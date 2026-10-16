/**
 * Rapatrie l'audience du second serveur (Achillea, ranked).
 *
 * POURQUOI UNE TÂCHE PLANIFIÉE
 * Historiquement servis par un autre VPS, `achillea.rosegriffon.fr` et
 * VPS (51.255.162.6) : leur journal nginx n'est pas lisible depuis celui-ci. La
 * page de statistiques lit un fichier local ; cette tâche le remplit en tirant
 * le journal distant par SSH, puis en l'agrégeant ICI.
 *
 * POURQUOI PAS UN POINT D'ENTRÉE HTTP SUR ACHILLEA
 * Il faudrait y déployer un service, l'exposer et l'authentifier — trois choses
 * à maintenir pour des chiffres de fréquentation. SSH existe déjà, la clé est
 * déjà en place, et rien de nouveau n'est publié sur l'internet.
 *
 * CE QUI TRANSITE
 * Uniquement les lignes du journal `rg_stats`, filtrées aux domaines Rose
 * Griffon : les autres sites hébergés sur ce serveur (dragonballfr) ne sont pas
 * rapatriés.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { syncSiteTelemetryAggregates, type SiteTelemetryAggregate } from "@rosegriffon/discord-sync";

/** Où la page de statistiques du site va lire le résultat. */
export const CHEMIN_CACHE = "/var/lib/rg/achillea-audience.json";

/**
 * Journal nginx à agréger.
 *
 * Il était lu par SSH sur le second VPS. Achilléa a depuis été rapatrié sur le
 * serveur principal : `achillea.rosegriffon.fr` et `ranked.rosegriffon.fr` sont
 * servis ici (`/etc/nginx/conf.d/achillea.rosegriffon.conf`) et leurs lignes
 * sont dans le journal LOCAL. Le SSH continuait de réussir — il tirait le
 * journal d'un serveur où ces domaines n'existent plus — et rendait donc un
 * agrégat vide sans jamais lever : `/var/lib/rg/achillea-audience.json`
 * contenait `"domaines": []`, et l'onglet Statistiques n'affichait rien.
 */
const JOURNAL_LOCAL = "/var/log/nginx/rg-stats.log";

/** Domaines rapatriés. Le second serveur en héberge d'autres, hors périmètre. */
const DOMAINES = new Set(["achillea.rosegriffon.fr", "ranked.rosegriffon.fr"]);

/** Fenêtre analysée, alignée sur celle de la page. */
const FENETRE_HEURES = 24;

/** Plafond de lignes tirées, pour borner le transfert. */
const MAX_LIGNES = 200_000;

interface Agregat {
	host: string;
	requetes: number;
	visiteurs: number;
	octets: number;
	erreurs4xx: number;
	erreurs5xx: number;
	medianeMs: number;
	p95Ms: number;
	topChemins: { chemin: string; requetes: number }[];
}

interface Acc {
	visiteurs: Set<string>;
	durees: number[];
	chemins: Map<string, number>;
	requetes: number;
	octets: number;
	erreurs4xx: number;
	erreurs5xx: number;
}

function centile(triees: number[], part: number): number {
	if (triees.length === 0) {
		return 0;
	}
	const i = Math.min(triees.length - 1, Math.floor(triees.length * part));
	return Math.round((triees[i] ?? 0) * 1000);
}

function normaliserChemin(chemin: string): string {
	return chemin
		.split("/")
		.map((s) => {
			if (!s) return s;
			if (/^\d+$/.test(s)) return ":n";
			if (/^[0-9a-f]{8,}$/i.test(s)) return ":id";
			return s;
		})
		.join("/");
}

export async function collecterAudienceAchillea(): Promise<{
	domaines: number;
	requetes: number;
}> {
	// `tail` borne la lecture : inutile de charger une journée entière de journal
	// pour n'en garder que les dernières heures. Le fichier appartient à
	// `nobody:adm` en mode 640 : il est lu grâce au groupe `adm`, que l'unité
	// accorde via `SupplementaryGroups=adm`.
	//
	// PAS de `sudo` ici. L'appel passait auparavant par `sudo -n`, ce qui ne pouvait
	// pas aboutir : `rg-cron.service` pose `NoNewPrivileges=true`,
	// `RestrictSUIDSGID=true` et un `CapabilityBoundingSet` vide, qui interdisent
	// l'élévation setuid. La tâche échouait à chaque passage sur « sudo: The "no new
	// privileges" flag is set ». Le groupe rend l'élévation inutile.
	const proc = Bun.spawn(["tail", "-n", String(MAX_LIGNES), JOURNAL_LOCAL], {
		stderr: "pipe",
		stdout: "pipe",
	});

	const sortie = await new Response(proc.stdout).text();
	const code = await proc.exited;
	if (code !== 0) {
		const erreur = await new Response(proc.stderr).text();
		throw new Error(`lecture du journal impossible (code ${code}) : ${erreur.trim().slice(0, 200)}`);
	}

	const debut = Date.now() - FENETRE_HEURES * 3600_000;
	const parDomaine = new Map<string, Acc>();
	const siteHours = new Map<string, SiteTelemetryAggregate>();
	let lignesVues = 0;

	for (const ligne of sortie.split("\n")) {
		if (ligne) lignesVues++;
		const champs = ligne.split("\t");
		if (champs.length < 12) {
			continue;
		}
		const [horodatage, host, , uri, statut, octets, duree, , , , , ip] = champs;
		const instantSite = Date.parse(horodatage ?? "");
		if (host && (host === "rosegriffon.fr" || host.endsWith(".rosegriffon.fr")) &&
			Number.isFinite(instantSite) && instantSite >= debut) {
			const windowStart = new Date(Math.floor(instantSite / 3600_000) * 3600_000).toISOString();
			const key = `${host}\t${windowStart}`;
			let bucket = siteHours.get(key);
			if (!bucket) {
				bucket = { host, windowStart, requests: 0, bytes: 0, errors4xx: 0, errors5xx: 0 };
				siteHours.set(key, bucket);
			}
			bucket.requests++;
			bucket.bytes += Number.parseInt(octets ?? "0", 10) || 0;
			const statusCode = Number.parseInt(statut ?? "0", 10) || 0;
			if (statusCode >= 500) bucket.errors5xx++;
			else if (statusCode >= 400) bucket.errors4xx++;
		}
		if (!host || !DOMAINES.has(host)) {
			continue;
		}
		const instant = Date.parse(horodatage ?? "");
		if (!Number.isFinite(instant) || instant < debut) {
			continue;
		}

		let acc = parDomaine.get(host);
		if (!acc) {
			acc = {
				chemins: new Map(),
				durees: [],
				erreurs4xx: 0,
				erreurs5xx: 0,
				octets: 0,
				requetes: 0,
				visiteurs: new Set(),
			};
			parDomaine.set(host, acc);
		}

		acc.requetes += 1;
		if (ip) acc.visiteurs.add(ip);
		acc.octets += Number.parseInt(octets ?? "0", 10) || 0;

		const code_ = Number.parseInt(statut ?? "0", 10) || 0;
		if (code_ >= 500) acc.erreurs5xx += 1;
		else if (code_ >= 400) acc.erreurs4xx += 1;

		const d = Number.parseFloat(duree ?? "");
		if (Number.isFinite(d)) acc.durees.push(d);

		const chemin = normaliserChemin(uri ?? "/");
		acc.chemins.set(chemin, (acc.chemins.get(chemin) ?? 0) + 1);
	}

	const domaines: Agregat[] = [...parDomaine.entries()].map(([host, acc]) => {
		const triees = acc.durees.sort((a, b) => a - b);
		return {
			erreurs4xx: acc.erreurs4xx,
			erreurs5xx: acc.erreurs5xx,
			host,
			medianeMs: centile(triees, 0.5),
			octets: acc.octets,
			p95Ms: centile(triees, 0.95),
			requetes: acc.requetes,
			topChemins: [...acc.chemins.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 8)
				.map(([chemin, requetes]) => ({ chemin, requetes })),
			visiteurs: acc.visiteurs.size,
		};
	});

	await mkdir(dirname(CHEMIN_CACHE), { recursive: true });
	await writeFile(
		CHEMIN_CACHE,
		JSON.stringify({ collecteLe: new Date().toISOString(), domaines }, null, "\t"),
		"utf8"
	);
	await syncSiteTelemetryAggregates([...siteHours.values()], lignesVues < MAX_LIGNES);

	return {
		domaines: domaines.length,
		requetes: domaines.reduce((s, d) => s + d.requetes, 0),
	};
}
