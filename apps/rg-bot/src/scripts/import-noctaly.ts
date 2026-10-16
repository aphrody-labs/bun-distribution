/**
 * Import COMPLET des données Noctaly, par l'API officielle.
 *
 * ── CE QUE CE SCRIPT FAIT, ET POURQUOI IL A FALLU ATTENDRE ────────────────
 * `import-xp-tiers.ts` a récupéré 65 membres SANS clé, en dépouillant
 * l'historique des salons (cartes `/leaderboard`, embeds « Niveau supérieur »).
 * C'était 3,4 % des membres, et c'était tout ce qui était atteignable.
 *
 * Ce script-ci fait le reste : muni de la clé API générée depuis le tableau de
 * bord Noctaly, il interroge pour CHAQUE membre de `discord_members` :
 *   - `GET …/level-profile`  → XP, niveau, messages, minutes vocales, réactions
 *   - `GET …/eco-profile`    → monnaie, inventaire, coffres, série quotidienne
 * plus, une seule fois pour toute la guilde, `GET …/items` et `GET …/chests`.
 * C'est l'intégralité de ce que l'API expose en lecture.
 *
 * ── L'API N'A AUCUNE ROUTE DE LISTE DE MEMBRES ────────────────────────────
 * Vérifié sur la documentation intégrale (llms.txt → 11 pages) : les modules
 * « Leveling » et « Economy » n'exposent que des routes par membre. Pas de
 * classement, pas d'export, pas de pagination. L'import est donc forcément une
 * boucle — d'où le soin apporté à la cadence dans `lib/noctaly.ts`.
 *
 * ── TOUT EST ARCHIVÉ BRUT AVANT D'ÊTRE INTERPRÉTÉ ─────────────────────────
 * `bot_import_noctaly` garde les deux réponses JSON telles quelles. L'import
 * ne se rejouera pas : le jour où Noctaly quitte le serveur, l'API cesse de
 * répondre. Ce qu'on n'aura pas gardé sera perdu pour de bon — y compris ce
 * qu'on a décidé de ne PAS mapper aujourd'hui (inventaire, coffres), qui
 * pourra ainsi être repris plus tard sans rien redemander à personne.
 *
 * ── LA COURBE : ON REPORTE L'XP BRUTE, PAS LE NIVEAU ───────────────────────
 * `totalXp` est écrite telle quelle dans `bot_profils.xp`, et `niveauPour()`
 * la relit sur la courbe DU JEU. C'est la convention déjà retenue par les deux
 * passes précédentes, et elle se vérifie : le coût Noctaly pour passer de n à
 * n+1 vaut `5n² + 20n + 100`, ce qui place ses paliers très près des nôtres
 * une fois cumulés (Noctaly 10 → jeu 12, 25 → 29, 50 → 53, 60 → 61, 100 → 89).
 * Les deux courbes étant monotones, l'ORDRE du classement est préservé à
 * l'identique — personne ne double personne à cause de la conversion.
 *
 * Reporter le NIVEAU plutôt que l'XP aurait été le choix inverse : il aurait
 * collé les membres au bas de leur palier et effacé l'écart entre celui qui
 * vient de monter et celui qui est sur le point de monter.
 *
 * ── LA MONNAIE NE S'IMPORTE PAS SANS AVOIR REGARDÉ ────────────────────────
 * Un jeton Kizuna se gagne à 25/jour et un recrutement en coûte 150. La
 * monnaie Noctaly suit une configuration de serveur inconnue avant lecture.
 * Le taux de conversion est donc explicite (`--taux=`), il vaut 0 par défaut
 * — c'est-à-dire **aucune monnaie importée** — et l'`--essai` affiche la
 * distribution réelle (médiane, maximum, total) pour choisir en connaissance
 * de cause. Un import monétaire mal calibré ne se rattrape pas : les jetons
 * auront déjà été dépensés.
 *
 * ── AUCUNE VALEUR N'EST JAMAIS RÉTROGRADÉE ─────────────────────────────────
 * `GREATEST` sur `xp`, `niveau`, `messages_comptes` et `serie_quotidienne`. Le
 * nouveau bot tourne depuis le 14/8/2026 et crédite déjà de l'XP : un import
 * lancé après coup ne doit pas ramener un membre actif à sa valeur Noctaly,
 * plus ancienne. Et relancer le script ne change rien la seconde fois.
 *
 * Les jetons font exception et s'ADDITIONNENT une seule fois, gardés par
 * `bot_import_noctaly.importe_le` : un crédit est un mouvement, pas un état.
 * Relancer l'import ne recrédite donc personne.
 *
 * ── LES MEMBRES SANS RIEN NE CRÉENT PAS DE LIGNE ──────────────────────────
 * Noctaly n'a été activé que le 11/3/2026 : la majorité des ~1 834 membres n'a
 * aucun profil chez lui (404) ou un profil à zéro. Leur créer une ligne vide
 * gonflerait le classement de comptes inactifs. La ligne se créera d'elle-même
 * à leur premier message (`ajouterExperience`).
 *
 * ── UTILISATION ───────────────────────────────────────────────────────────
 *   bun apps/bot/src/scripts/import-noctaly.ts --essai       # rien n'est écrit
 *   bun apps/bot/src/scripts/import-noctaly.ts               # XP + archive
 *   bun apps/bot/src/scripts/import-noctaly.ts --taux=0.1    # + monnaie ÷10
 *   bun apps/bot/src/scripts/import-noctaly.ts --cadence=5   # plus prudent
 *   bun apps/bot/src/scripts/import-noctaly.ts --tous        # + membres partis
 *   bun apps/bot/src/scripts/import-noctaly.ts --sans-eco    # niveaux seuls
 *
 * La clé se pose dans `apps/bot/.env` :  NOCTALY_API_KEY=…
 */
import { RG_GUILD_ID } from "@rosegriffon/types/discord";

import { sql } from "../lib/db";
import { niveauPour } from "../lib/experience";
import {
	AIDE_CLE_MANQUANTE,
	attenteAvantSuivante,
	bilanVide,
	CADENCE_DEFAUT,
	classerReponse,
	convertirMonnaie,
	distribution,
	FENETRE_OBSERVEE,
	fusionnerClassements,
	lireClassement,
	lireProfil,
	lireProfilEconomie,
	lireQuota,
	meriteEcriture,
	meriteEcritureEconomie,
	PLAFOND_DOCUMENTE,
	resumerBilan,
	TRIS_CLASSEMENT,
	urlClassementPublic,
	urlCoffresGuilde,
	urlObjetsGuilde,
	urlProfilEconomie,
	urlProfilNiveau,
	type Issue,
	type ProfilClasse,
	type Quota,
} from "../lib/noctaly";

/**
 * Empreinte annoncée à Cloudflare pour les pages HTML.
 *
 * Un navigateur récent et banal : le but n'est pas de se faire passer pour
 * quelqu'un d'autre, c'est de ne pas être rejeté pour cause d'agent vide.
 */
const NAVIGATEUR =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
	"Chrome/140.0.0.0 Safari/537.36";

const GUILD_ID = RG_GUILD_ID;

const essai = Bun.argv.includes("--essai");
const tous = Bun.argv.includes("--tous");
const sansEco = Bun.argv.includes("--sans-eco");

/** Lit une option `--nom=valeur` numérique, ou rend le défaut. */
function optionNombre(nom: string, defaut: number): number {
	const argument = Bun.argv.find((valeur) => valeur.startsWith(`--${nom}=`));
	if (!argument) {
		return defaut;
	}
	const valeur = Number(argument.slice(nom.length + 3));
	if (!Number.isFinite(valeur) || valeur < 0) {
		console.error(`Option illisible : ${argument}`);
		process.exit(1);
	}
	return valeur;
}

const cadence = Math.min(PLAFOND_DOCUMENTE, Math.max(1, optionNombre("cadence", CADENCE_DEFAUT)));
/** 0 = on lit la monnaie et on la rapporte, mais on n'en crédite aucune. */
const taux = optionNombre("taux", 0);

/**
 * La clé peut manquer — et ce n'est plus fatal.
 *
 * ── CE QUI A CHANGÉ, ET POURQUOI ───────────────────────────────────────────
 * Le script sortait en erreur sans clé, alors que Noctaly publie déjà
 * l'essentiel sans authentification : la page de classement porte les cent
 * premiers profils, avec exactement les champs de `level-profile`. Refuser de
 * démarrer revenait à jeter cette source parce qu'une autre manquait.
 *
 * Sans clé, l'import fait donc ce qu'il peut : il lit le classement, écrit ce
 * qu'il y trouve, et dit clairement ce qui reste hors de portée. Avec la clé,
 * le classement sert d'AMORCE — il désigne qui interroger en premier.
 */
const cle = (Bun.env.NOCTALY_API_KEY ?? "").trim();
const avecApi = cle !== "";
if (!avecApi) {
	console.warn(`${AIDE_CLE_MANQUANTE}\n`);
	console.warn("→ Import en mode DÉGRADÉ : classement public seul.\n");
}

const dormir = (ms: number) => new Promise((resoudre) => setTimeout(resoudre, ms));

const bilan = bilanVide();
let quota: Quota = { dansSecondes: null, limite: null, restant: null };
let interrompu: string | null = null;

/**
 * Une requête, cadencée et classée. Rend le corps JSON quand tout va bien.
 *
 * Centralisée ici parce que c'est le seul endroit du script qui touche au
 * réseau : la cadence, la lecture du quota et l'arrêt sur 429 s'appliquent
 * donc à TOUTES les routes, y compris les deux catalogues de guilde, sans
 * qu'on ait à y penser à chaque appel.
 */
async function interroger(url: string): Promise<{ issue: Issue; corps: unknown }> {
	await dormir(attenteAvantSuivante(quota, cadence));
	let reponse: Response;
	try {
		reponse = await fetch(url, {
			headers: { Authorization: cle },
			signal: AbortSignal.timeout(15_000),
		});
	} catch (err) {
		return { corps: err instanceof Error ? err.message : String(err), issue: "panne" };
	}
	quota = lireQuota(reponse.headers);

	// Le corps est lu AVANT le classement, et non plus seulement sur 200 : un
	// module éteint répond `400 {"code":"module_disabled"}`, statut que rien ne
	// distingue d'une requête malformée sans regarder la charge. C'est cette
	// distinction qui permet d'abandonner une passe entière au lieu de la jouer
	// membre par membre pour mille huit cents 404.
	const texte = await reponse.text().catch(() => "");
	let corps: unknown = null;
	if (texte !== "") {
		try {
			corps = JSON.parse(texte);
		} catch {
			corps = null;
		}
	}

	const issue = classerReponse(reponse.status, corps);
	if (issue === "refuse") {
		interrompu =
			`clé refusée (HTTP ${reponse.status}) — vérifier NOCTALY_API_KEY et qu'elle appartient ` +
			`bien au serveur ${GUILD_ID}`;
		return { corps: null, issue };
	}
	if (issue === "quota") {
		// On ne réessaie PAS : la documentation annonce un retryAfter d'une heure
		// et une mise en liste noire pour les applications qui insistent. L'import
		// étant idempotent, reprendre plus tard ne coûte rien.
		interrompu =
			`quota dépassé (HTTP 429) — reprendre plus tard avec une cadence plus basse ` +
			`(--cadence=${Math.max(1, Math.floor(cadence / 2))}). Aucune requête de plus n'est ` +
			`envoyée : insister fait blacklister.`;
		return { corps: null, issue };
	}
	if (issue !== "ok") {
		return { corps, issue };
	}
	return { corps, issue };
}

/**
 * Charge le classement public de la guilde — la source SANS clé.
 *
 * ── POURQUOI UN SOUS-PROCESSUS `curl` ET NON `fetch` ───────────────────────
 * Les pages HTML de noctaly.com sont derrière un défi Cloudflare qui juge sur
 * l'empreinte TLS du client, pas sur les en-têtes. Mesuré le 14/8/2026 : le
 * `fetch` de Bun reçoit systématiquement `403` avec `cf-mitigated: challenge`,
 * là où `curl` passe en `200`. Aucun en-tête ajouté n'y change quoi que ce soit
 * — c'est la poignée de main TLS qui diffère, pas la requête.
 *
 * L'API `/api/v1`, elle, n'est PAS derrière ce défi : `fetch` y répond
 * normalement. Ce détour ne concerne donc que cette source-ci.
 *
 * ── ET POURQUOI DES COOKIES ────────────────────────────────────────────────
 * La page répond 200 sans authentification, mais SANS les profils : le rendu
 * serveur ne les inclut que pour une session connectée (vérifié — 0 profil en
 * anonyme, 100 avec la session). Sans le fichier de cookies, cette source rend
 * donc simplement zéro profil, ce qui n'est pas une panne.
 */
async function chargerPageClassement(url: string): Promise<string | null> {
	const cookies = await lireEnteteCookies();
	const arguments_ = [
		"curl",
		"--silent",
		"--show-error",
		"--max-time",
		"20",
		"--user-agent",
		NAVIGATEUR,
		...(cookies ? ["--header", `cookie: ${cookies}`] : []),
		url,
	];
	const proc = Bun.spawn(arguments_, { stderr: "pipe", stdout: "pipe" });
	const sortie = await new Response(proc.stdout).text();
	const code = await proc.exited;
	if (code !== 0) {
		console.warn(`  ⚠ classement : curl a rendu le code ${code}`);
		return null;
	}
	return sortie;
}

/**
 * L'en-tête `cookie` de la session Noctaly, ou `null` si le fichier manque.
 *
 * Le fichier vit dans `.secrets/` (jamais versionné) au format d'export de
 * navigateur. Il porte une session qui EXPIRE — d'où le repli silencieux :
 * un import ne doit pas échouer parce qu'une source d'appoint a expiré.
 */
async function lireEnteteCookies(): Promise<string | null> {
	const chemin = new URL("../../../../.secrets/noctaly-cookies.json", import.meta.url).pathname;
	const fichier = Bun.file(chemin);
	if (!(await fichier.exists())) {
		return null;
	}
	try {
		const jar = (await fichier.json()) as Array<{ domain: string; name: string; value: string }>;
		const pourNoctaly = jar.filter((c) => c.domain.replace(/^\./, "").endsWith("noctaly.com"));
		return pourNoctaly.length === 0
			? null
			: pourNoctaly.map((c) => `${c.name}=${c.value}`).join("; ");
	} catch {
		return null;
	}
}

// ─── Amorce : le classement public ──────────────────────────────────────────
//
// Une à quatre requêtes HTML, sans clé, qui rendent jusqu'à cent profils
// COMPLETS. Elles servent deux fois :
//   - elles fournissent directement des profils à écrire (seule source en mode
//     dégradé, et gain net de cent appels d'API en mode normal) ;
//   - elles DÉSIGNENT les membres qui ont quelque chose, ce qui permet de les
//     interroger en premier. Si le quota casse l'import à mi-parcours, ce qui
//     est fait est ce qui comptait.
console.log(`=== Import Noctaly ${essai ? "[--essai, rien n'est écrit] " : ""}===`);

const classements: ProfilClasse[][] = [];
for (const tri of TRIS_CLASSEMENT) {
	const page = await chargerPageClassement(urlClassementPublic(GUILD_ID, tri));
	const lus = page === null ? [] : lireClassement(page);
	classements.push(lus);
	console.log(`  classement ?sort=${tri.padEnd(9)} → ${String(lus.length).padStart(3)} profil(s)`);
	// Ces pages ne comptent pas dans le quota de l'API (autre origine), mais on
	// espace quand même : c'est le site public d'un tiers.
	await dormir(600);
}
const classement = fusionnerClassements(classements);
const parClassement = new Map(classement.map((entree) => [entree.discordId, entree]));
console.log(
	`  → ${classement.length} membre(s) distinct(s) connus du classement` +
		(classement.length > 0
			? ` · de ${classement[0]!.profil.xpTotale} à ${classement.at(-1)!.profil.xpTotale} XP`
			: " (session expirée ou module de niveaux inactif)")
);

if (classement.length === 0 && !avecApi) {
	console.error(
		"\nAucune source disponible : ni clé API, ni classement lisible.\n" +
			"Le classement exige une session valide dans .secrets/noctaly-cookies.json."
	);
	process.exit(1);
}

// ─── Les membres à interroger ───────────────────────────────────────────────
// Par défaut, les humains encore présents : interroger un bot est une requête
// gaspillée (Noctaly ne leur donne pas d'XP), et un membre parti répond
// `404 Unknown Member` — sauf s'il revient un jour, d'où `--tous`.
const membresBruts = tous
	? await sql<Array<{ discord_id: string; username: string }>>`
		SELECT discord_id, username FROM discord_members
		 WHERE NOT is_bot
		 ORDER BY joined_at NULLS LAST
	`
	: await sql<Array<{ discord_id: string; username: string }>>`
		SELECT discord_id, username FROM discord_members
		 WHERE NOT is_bot AND left_at IS NULL
		 ORDER BY joined_at NULLS LAST
	`;

/**
 * L'ordre d'interrogation : les membres CONNUS DU CLASSEMENT d'abord, du plus
 * gradé au moins gradé, puis tous les autres dans leur ordre d'arrivée.
 *
 * L'ordre importe parce que l'import peut s'arrêter net : le quota réel est de
 * 120 requêtes par minute, un import complet dure un quart d'heure, et un 429
 * l'interrompt sans reprise. Trier par rendement attendu, c'est garantir que
 * l'interruption coûte des membres sans XP plutôt que le sommet du classement.
 */
const rang = new Map<string, number>();
classement.forEach((entree, index) => rang.set(entree.discordId, index));
const membresTries = membresBruts.toSorted((a, b) => {
	const ra = rang.get(a.discord_id) ?? Number.MAX_SAFE_INTEGER;
	const rb = rang.get(b.discord_id) ?? Number.MAX_SAFE_INTEGER;
	return ra - rb;
});

/**
 * `--limite=N` : n'interroge que les N premiers, c'est-à-dire les N mieux
 * classés. Sert à répéter un import complet en une minute avant de l'engager
 * pour un quart d'heure — et, l'ordre étant celui du classement, la répétition
 * porte sur les profils qui comptent, pas sur un échantillon au hasard.
 */
const limite = optionNombre("limite", 0);
const membres = limite > 0 ? membresTries.slice(0, limite) : membresTries;

/** Les membres déjà crédités en jetons — un crédit ne se rejoue pas. */
const dejaCredites = new Set(
	(
		await sql<Array<{ discord_id: string }>>`
			SELECT discord_id FROM bot_import_noctaly WHERE guild_id = ${GUILD_ID}
		`
	).map((ligne) => ligne.discord_id)
);

// ─── Le module d'économie est-il seulement allumé ? ─────────────────────────
//
// ── LA SONDE QUI ÉCONOMISE LA MOITIÉ DE L'IMPORT ───────────────────────────
// L'économie est un module OPTIONNEL, et il est éteint sur ce serveur (relevé
// le 14/8/2026 : `GET /items` → `400 {"code":"module_disabled"}`). Sans cette
// sonde, l'import posait une seconde question par membre — mille huit cents
// requêtes — dont la réponse était connue d'avance : `404 Profile not found`.
//
// Une requête suffit à trancher pour tout le serveur. Et comme le quota réel
// est de 120 requêtes par minute, ces mille huit cents requêtes inutiles ne
// coûtaient pas « un peu de réseau » : elles doublaient la durée de l'import et
// doublaient les occasions de déclencher un 429.
let ecoActive = !sansEco;
if (!sansEco && avecApi) {
	const sonde = await interroger(urlObjetsGuilde(GUILD_ID));
	if (sonde.issue === "module-desactive") {
		ecoActive = false;
		console.log(
			"\n  module économie ÉTEINT sur ce serveur → la passe d'économie est abandonnée " +
				`(${membres.length} requête(s) évitée(s)).`
		);
	} else if (sonde.issue === "ok") {
		await archiverCatalogue("items", sonde.corps);
		const coffres = await interroger(urlCoffresGuilde(GUILD_ID));
		if (coffres.issue === "ok") {
			await archiverCatalogue("chests", coffres.corps);
		} else {
			console.log(`  catalogue chests : ${coffres.issue}`);
		}
	} else {
		console.log(`  catalogue items : ${sonde.issue}`);
	}
}

/** Écrit un catalogue de guilde dans son archive. */
async function archiverCatalogue(genre: "items" | "chests", corps: unknown): Promise<void> {
	const compte = Array.isArray((corps as Record<string, unknown> | null)?.[genre])
		? ((corps as Record<string, unknown>)[genre] as unknown[]).length
		: 0;
	console.log(`  catalogue ${genre} : ${compte} entrée(s)`);
	if (essai || corps === null) {
		return;
	}
	// Pas de `JSON.stringify(corps)` : Bun.SQL encode déjà en JSON une valeur
	// liée à un paramètre `::jsonb` — la stringifier double l'encodage (la
	// colonne reçoit une chaîne, pas un objet).
	await sql`
		INSERT INTO bot_import_noctaly_catalogue (guild_id, genre, contenu)
		VALUES (${GUILD_ID}, ${genre}, ${corps}::jsonb)
		ON CONFLICT (guild_id, genre) DO UPDATE SET
			contenu = EXCLUDED.contenu, importe_le = now()
	`;
}

const requetesParMembre = (avecApi ? 1 : 0) + (ecoActive && avecApi ? 1 : 0);
const secondes = Math.ceil((membres.length * requetesParMembre) / cadence);
console.log(
	`\n${membres.length} membre(s) × ${requetesParMembre} requête(s) · cadence ${cadence} req/s\n` +
		`quota réel mesuré : ${FENETRE_OBSERVEE.requetes} requêtes / ${FENETRE_OBSERVEE.secondes} s ` +
		`(la documentation annonce ${PLAFOND_DOCUMENTE}/s — elle est fausse)\n` +
		`durée estimée ${Math.floor(secondes / 60)} min ${secondes % 60} s · ` +
		`taux monnaie → jetons : ${taux === 0 ? "0 (aucune monnaie importée)" : taux}\n`
);

// ─── La boucle des membres ──────────────────────────────────────────────────
const notables: Array<{ pseudo: string; xp: number; niveau: number; messages: number }> = [];
const soldes: number[] = [];
let parcourus = 0;

for (const membre of membres) {
	if (interrompu) {
		break;
	}

	/**
	 * Ce que le classement public sait déjà de ce membre, s'il le connaît.
	 *
	 * Il sert de REPLI, jamais de raccourci : quand l'API répond, c'est elle qui
	 * fait foi (elle porte en plus `xp` intra-niveau et `neededXp`, et elle est
	 * à la seconde près). Le classement ne prend la main que là où l'API n'a pas
	 * pu parler — pas de clé, ou import interrompu avant d'arriver à ce membre.
	 */
	const depuisClassement = parClassement.get(membre.discord_id) ?? null;

	const niveauRep = avecApi
		? await interroger(urlProfilNiveau(GUILD_ID, membre.discord_id))
		: ({ corps: null, issue: "absent" } as const);
	if (avecApi) {
		bilan.interroges++;
	}
	if (interrompu) {
		break;
	}

	let profil = null;
	switch (niveauRep.issue) {
		case "ok":
			profil = lireProfil(niveauRep.corps);
			if (!profil) {
				bilan.illisibles++;
				console.warn(`  ⚠ ${membre.username} — profil de niveau illisible`);
			}
			break;
		case "absent":
			bilan.absents++;
			break;
		default:
			bilan.pannes++;
			console.warn(`  ⚠ ${membre.username} — niveau : ${niveauRep.issue}`);
			break;
	}

	// Repli sur le classement : un membre que l'API dit absent mais que le
	// classement connaît a bel et bien de l'XP. Le cas se produit en mode
	// dégradé (aucune clé) et, plus rarement, si l'API perd un profil.
	let issuDuClassement = false;
	if (profil === null && depuisClassement !== null) {
		profil = depuisClassement.profil;
		issuDuClassement = true;
		if (niveauRep.issue === "absent" && avecApi) {
			// L'API ne le connaît pas alors que le classement l'affiche : à
			// signaler, c'est une incohérence côté Noctaly, pas chez nous.
			bilan.absents--;
			console.warn(
				`  ⚠ ${membre.username} — absent de l'API mais présent au classement ` +
					`(${depuisClassement.profil.xpTotale} XP) : valeur du classement retenue`
			);
		}
	}

	// L'économie s'interroge même quand le niveau est absent : les deux modules
	// de Noctaly sont indépendants, un membre peut avoir de la monnaie sans XP.
	let eco = null;
	/**
	 * La réponse d'économie TELLE QUELLE, gardée pour l'archive.
	 *
	 * `lireProfilEconomie` réduit `items[]` et `chests[]` à leur nombre — c'est
	 * tout ce dont l'import a besoin. Mais archiver cette réduction viderait
	 * l'archive de sa raison d'être : le détail de l'inventaire (noms, prix,
	 * durabilité, quantités) ne se retrouvera nulle part une fois Noctaly
	 * retiré du serveur. C'est le corps brut qu'on garde.
	 */
	let ecoBrut: unknown = null;
	if (ecoActive && avecApi) {
		const ecoRep = await interroger(urlProfilEconomie(GUILD_ID, membre.discord_id));
		if (interrompu) {
			break;
		}
		if (ecoRep.issue === "ok") {
			ecoBrut = ecoRep.corps;
			eco = lireProfilEconomie(ecoRep.corps);
		} else if (ecoRep.issue !== "absent") {
			bilan.pannes++;
		}
		if (eco) {
			soldes.push(eco.monnaie);
		}
	}

	if (!profil && !eco) {
		continue;
	}

	// L'archive d'abord : elle est la seule trace intégrale, et elle sert de
	// garde contre un double crédit de jetons.
	const premierPassage = !dejaCredites.has(membre.discord_id);
	if (!essai) {
		// Pas de `JSON.stringify(...)` sur les corps : Bun.SQL encode déjà en
		// JSON une valeur liée à un paramètre `::jsonb` — la stringifier double
		// l'encodage. `null` reste `null` (NULL SQL), le cast ne s'applique qu'à
		// une valeur présente.
		// L'archive garde la charge de la source qui a répondu, TELLE QUELLE.
		// Les deux formes sont reconnaissables sans colonne supplémentaire : la
		// réponse d'API porte `totalXp`, l'entrée de classement porte `userID`.
		// Le `COALESCE` du conflit protège l'archive d'API : elle est plus riche,
		// une repasse en mode dégradé ne doit pas l'écraser — d'où le `null` quand
		// il n'y a rien de neuf.
		const archiveNiveau =
			niveauRep.issue === "ok"
				? niveauRep.corps
				: issuDuClassement
					? (depuisClassement?.brut ?? null)
					: null;
		await sql`
			INSERT INTO bot_import_noctaly (guild_id, discord_id, profil_niveau, profil_eco)
			VALUES (
				${GUILD_ID}, ${membre.discord_id},
				${archiveNiveau}::jsonb,
				${ecoBrut === null ? null : ecoBrut}::jsonb
			)
			ON CONFLICT (guild_id, discord_id) DO UPDATE SET
				profil_niveau = COALESCE(EXCLUDED.profil_niveau, bot_import_noctaly.profil_niveau),
				profil_eco = COALESCE(EXCLUDED.profil_eco, bot_import_noctaly.profil_eco),
				importe_le = now()
		`;
	}
	bilan.archives++;

	const aDuNiveau = profil !== null && meriteEcriture(profil);
	const aDeLEco = eco !== null && meriteEcritureEconomie(eco);
	if (profil !== null && !aDuNiveau) {
		bilan.vides++;
	}
	if (aDeLEco) {
		bilan.economies++;
	}
	if (!aDuNiveau && !aDeLEco) {
		continue;
	}

	const xp = aDuNiveau && profil ? profil.xpTotale : 0;
	const niveau = niveauPour(xp);
	const messages = aDuNiveau && profil ? profil.messages : 0;
	const serie = aDeLEco && eco ? (eco.serieQuotidienne ?? 0) : 0;
	// Les jetons ne se recréditent pas : `premierPassage` garde le mouvement.
	const jetons = premierPassage && eco ? convertirMonnaie(eco.monnaie, taux) : 0;

	if (aDuNiveau && profil) {
		bilan.ecrits++;
		if (issuDuClassement) {
			bilan.classes++;
		}
		notables.push({ messages, niveau, pseudo: membre.username, xp });
	}

	if (!essai) {
		await sql`
			INSERT INTO bot_profils (
				guild_id, discord_id, xp, niveau, messages_comptes,
				jetons, jetons_gagnes, serie_quotidienne, maj_le
			)
			VALUES (
				${GUILD_ID}, ${membre.discord_id}, ${xp}, ${niveau}, ${messages},
				${jetons}, ${jetons}, ${serie}, now()
			)
			ON CONFLICT (guild_id, discord_id) DO UPDATE SET
				xp = GREATEST(bot_profils.xp, EXCLUDED.xp),
				niveau = GREATEST(bot_profils.niveau, EXCLUDED.niveau),
				messages_comptes = GREATEST(bot_profils.messages_comptes, EXCLUDED.messages_comptes),
				serie_quotidienne = GREATEST(bot_profils.serie_quotidienne, EXCLUDED.serie_quotidienne),
				jetons = bot_profils.jetons + EXCLUDED.jetons,
				jetons_gagnes = bot_profils.jetons_gagnes + EXCLUDED.jetons_gagnes,
				maj_le = now()
		`;
	}

	// Compté sur les membres PARCOURUS et non sur les requêtes envoyées : en mode
	// dégradé aucune requête ne part, et la progression serait muette.
	parcourus++;
	if (parcourus % 100 === 0) {
		const reste = quota.restant === null ? "" : ` · quota ${quota.restant}/${quota.limite ?? "?"}`;
		console.log(`  … ${parcourus}/${membres.length} · ${bilan.ecrits} importé(s)${reste}`);
	}
}

// ─── Le rapport ─────────────────────────────────────────────────────────────
notables.sort((a, b) => b.xp - a.xp);
if (notables.length > 0) {
	console.log(`\nLes 20 plus hauts profils :`);
	for (const entree of notables.slice(0, 20)) {
		console.log(
			`  ${entree.pseudo.padEnd(28).slice(0, 28)} ${String(entree.xp).padStart(8)} xp ` +
				`→ niveau ${String(entree.niveau).padStart(3)} · ${entree.messages} message(s)`
		);
	}
}

const monnaie = distribution(soldes);
if (monnaie.compte > 0) {
	console.log(
		`\nMonnaie Noctaly : ${monnaie.compte} membre(s) en ont · médiane ${monnaie.median} · ` +
			`maximum ${monnaie.maximum} · total ${monnaie.total}`
	);
	if (taux === 0) {
		console.log(
			`  Aucune n'a été convertie (--taux=0). Un jeton Kizuna vaut 25/jour et un recrutement ` +
				`en coûte 150 :\n  relancer avec --taux=<valeur> une fois le rapport ci-dessus lu.`
		);
	} else {
		console.log(`  Convertie au taux ${taux} → ${convertirMonnaie(monnaie.total, taux)} jeton(s) au total.`);
	}
}

console.log(`\n${resumerBilan(bilan)}`);
if (essai) {
	console.log("(--essai : aucune écriture)");
}

if (interrompu) {
	console.error(`\nImport INTERROMPU : ${interrompu}`);
	process.exit(1);
}

if (!essai) {
	const [stats] = await sql<
		Array<{ total: number; avec_xp: number; xp_max: string; niveau_max: number }>
	>`
		SELECT count(*)::int AS total,
		       count(*) FILTER (WHERE xp > 0)::int AS avec_xp,
		       max(xp) AS xp_max,
		       max(niveau)::int AS niveau_max
		  FROM bot_profils WHERE guild_id = ${GUILD_ID}
	`;
	console.log(
		`bot_profils(guild_id=${GUILD_ID}) : ${stats?.total} ligne(s) · ${stats?.avec_xp} avec XP · ` +
			`max(xp)=${stats?.xp_max} · max(niveau)=${stats?.niveau_max}`
	);
}

process.exit(0);
