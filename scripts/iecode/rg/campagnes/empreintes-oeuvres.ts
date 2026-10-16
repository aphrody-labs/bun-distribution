// Mesure les empreintes des créations d'une campagne et remplit `public.x_campagne_oeuvres`.
//
// ── POURQUOI CE SCRIPT EXISTE ──────────────────────────────────────────────────
// Une ŒUVRE, pas une publication, porte un ticket de tirage : le même dessin posté sur Discord
// puis sur X ne donne qu'une chance. `x_campagne_oeuvres` est la table qui fait autorité là-dessus,
// et le site REFUSE d'engager un tirage tant qu'une création retenue n'y est rattachée à rien
// (`reconstruireRoster` → `creationsSansOeuvre`, `tirage-queries.ts`). Quatre messages du code
// renvoyaient à `bun scripts/campagnes/empreintes-oeuvres.ts` — un fichier qui N'EXISTAIT PAS.
// Les 16 œuvres d'IERG Day avaient été posées à la main le 23/8/2026 ; à la création suivante,
// le tirage se serait bloqué sur une commande introuvable. Le voici.
//
// ── CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS ────────────────────────────────────
// IL MESURE : sha256 du fichier, dHash et pHash perceptuels, dimensions réelles, pour chaque
// fichier des créations RETENUES (mêmes clauses de visibilité que le roster — `SQL_CREATIONS`,
// module partagé). Il n'invente rien : un fichier illisible est signalé, pas deviné.
//
// IL NE REGROUPE QUE SUR PREUVE FORTE : deux créations ne deviennent une seule œuvre que si
// leurs empreintes sont quasi identiques (sha256 égal, ou dHash ET pHash à `SEUIL_FORT` ou moins).
// Au-delà, il crée deux œuvres et le DIT : c'est un humain qui tranche, avec la preuve sous les
// yeux, comme l'a fait `exporter-participants.ts` pour les quatre regroupements d'IERG Day.
// Fusionner à tort retire une chance à quelqu'un ; séparer à tort en ajoute une. Le second
// défaut se voit sur la galerie, le premier ne se voit jamais.
//
// IL NE TOUCHE À AUCUNE ŒUVRE EXISTANTE. Il n'ajoute que ce qui manque. Un regroupement décidé
// par un humain, un `motif_regroupement` écrit à la main, un master choisi à l'œil : rien de tout
// cela n'est réécrit par une passe automatique.
//
// IL NE CRÉE AUCUN PARTICIPANT : `x_campagne_oeuvres.cle` porte une clé étrangère vers
// `x_campagne_participants`. Une identité inconnue fait donc échouer l'écriture AVANT toute
// modification, avec la marche à suivre : reconstruire le roster (écran d'admin) crée la ligne
// canonique à zéro compteur, puis ce script rattache l'œuvre, puis une seconde reconstruction met
// les compteurs à jour.
//
// ── LES DEUX EMPREINTES, ET POURQUOI IL EN FAUT DEUX ──────────────────────────
// X ré-encode systématiquement en JPEG : sur les 27 fichiers d'IERG Day, 27 sha256 DISTINCTS,
// donc zéro doublon trouvé et quatre chances de trop. Le dHash (gradient horizontal) et le pHash
// (DCT) survivent au ré-encodage et au redimensionnement. Les deux algorithmes reproduisent
// BIT POUR BIT les valeurs déjà en base (vérifié le 26/8/2026 sur trois œuvres d'IERG Day) : une
// mesure neuve est donc comparable aux mesures posées à la main.
//
// ── USAGE ──────────────────────────────────────────────────────────────────────
//   bun scripts/campagnes/empreintes-oeuvres.ts [--campagne <slug>] [--dry] [--tout]
//
// Défauts : campagne `iergday`, écriture réelle. `--dry` mesure et montre sans rien écrire.
// `--tout` remesure aussi les créations DÉJÀ couvertes (contrôle : les empreintes de la base
// doivent retomber sur les mêmes valeurs) sans jamais les réécrire.

import { createBunSql } from "@rosegriffon/db/bun-sql";

import { SQL_CREATIONS } from "../../../../apps/rg-website/src/lib/x-campagnes/sql-creations";

/*
 * ⚠ `${valeur}::jsonb` avec la valeur JS BRUTE, tableau compris — JAMAIS
 * `${JSON.stringify(valeur)}::jsonb`.
 *
 * Bun.SQL encode déjà en JSON toute valeur liée à un paramètre casté `::jsonb` : stringifier
 * avant coup l'encode une SECONDE fois, et la colonne reçoit une CHAÎNE contenant du JSON.
 * Ici la base l'a refusé net (`x_campagne_oeuvres_creations_tableau`, `jsonb_typeof <> 'array'`),
 * ce qui est une chance : ailleurs dans le dépôt, le même geste avait corrompu des réglages en
 * silence (cf. CLAUDE.md, `bot_reglages_guilde.valeurs`). La règle inverse, documentée dans
 * `tirage-queries.ts`, ne vaut QUE pour node-postgres — deux pilotes, deux comportements.
 */

/** Racine du Storage self-host : le fichier est lu sur disque, jamais retéléchargé. */
const RACINE_STOCKAGE = "/var/www/rg-storage";

/** Préfixes des URL publiques du Storage, par bucket. */
const PREFIXE_ASSETS = "/storage/v1/object/public/assets/";
const PREFIXE_TWEETS = "/storage/v1/object/public/tweets/";

/**
 * Distance de Hamming maximale, sur les DEUX empreintes à la fois, pour qu'un
 * regroupement soit prononcé sans humain.
 *
 * Deux, pas huit. Les quatre doublons mesurés d'IERG Day tombent tous à 2 ou
 * moins sur le dHash ET à 2 ou moins sur le pHash, ré-encodage JPEG de X compris,
 * y compris le groupe le plus réduit (1720×2428 → 850×1200). Le seuil de 8 utilisé
 * pour PROPOSER un rapprochement à un humain est bien trop lâche pour DÉCIDER : à
 * cette distance, deux illustrations différentes du même personnage se ressemblent.
 */
const SEUIL_FORT = 2;

interface LigneCreation {
	source: "x" | "discord" | "instagram";
	identifiant: string;
	cle_identite: string | null;
	auteur_nom: string | null;
	auteur_pseudo: string | null;
	horodatage: Date | string | null;
	nb_images: number;
	permalien: string | null;
	motif_ecart: string | null;
}

interface LigneOeuvre {
	oeuvre_id: string;
	cle: string;
	creations: unknown;
	sha256: string | null;
	dhash: string | null;
	phash: string | null;
}

/** Un fichier d'une création, tel qu'on sait aller le lire. */
interface FichierCreation {
	index: number;
	/** Chemin sur disque quand notre copie existe — le cas normal. */
	chemin: string | null;
	/** Chemin dans le bucket, tel qu'écrit en base (`campagnes/…`). */
	cheminBucket: string | null;
	/** URL d'origine, seul recours quand la copie manque (X surtout). */
	url: string | null;
	kind: "image" | "video";
	largeurAnnoncee: number | null;
	hauteurAnnoncee: number | null;
}

/** Ce qu'on a réellement mesuré sur un fichier. */
interface Mesure {
	index: number;
	sha256: string;
	/** `null` pour une vidéo : aucune empreinte perceptuelle n'a de sens sur un flux. */
	dhash: string | null;
	phash: string | null;
	largeur: number | null;
	hauteur: number | null;
	octets: number;
	kind: "image" | "video";
	cheminBucket: string | null;
	url: string | null;
}

// ───────────────────────── Empreintes ─────────────────────────

function bitsVersHex(bits: readonly number[]): string {
	let sortie = "";
	for (let position = 0; position < bits.length; position += 4) {
		sortie += (
			(bits[position] << 3) |
			(bits[position + 1] << 2) |
			(bits[position + 2] << 1) |
			bits[position + 3]
		).toString(16);
	}
	return sortie;
}

/**
 * dHash 64 bits : 9×8 en niveaux de gris, chaque bit compare un pixel à son voisin de DROITE.
 *
 * C'est un GRADIENT, pas une luminosité : il encaisse un changement de contraste ou de
 * compression, et deux images redimensionnées différemment donnent la même empreinte.
 */
async function dhash(sharp: SharpModule, octets: Uint8Array): Promise<string> {
	const brut = await sharp(octets).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
	const bits: number[] = [];
	for (let y = 0; y < 8; y++) {
		for (let x = 0; x < 8; x++) {
			bits.push(brut[y * 9 + x] > brut[y * 9 + x + 1] ? 1 : 0);
		}
	}
	return bitsVersHex(bits);
}

/**
 * pHash 64 bits : DCT-II sur 32×32 gris, bloc 8×8 de basses fréquences, seuil médian.
 *
 * ⚠ DEUX DÉTAILS NE SONT PAS NÉGOCIABLES — ils sont ce qui rend une mesure d'aujourd'hui
 * comparable aux valeurs posées en base le 23/8/2026 (vérifié bit pour bit sur trois œuvres) :
 *  1. le coefficient continu (u=v=0) est FORCÉ à 0, il ne participe pas au seuil ;
 *  2. le seuil est la demi-somme des 31ᵉ et 32ᵉ plus petits des 63 coefficients restants.
 * Une « vraie » médiane sur 63 valeurs (le 32ᵉ élément seul) donne une empreinte différente de
 * quelques bits — assez pour qu'un doublon cesse d'en être un.
 */
async function phash(sharp: SharpModule, octets: Uint8Array): Promise<string> {
	const cote = 32;
	const brut = await sharp(octets).grayscale().resize(cote, cote, { fit: "fill" }).raw().toBuffer();

	const cosinus: number[][] = [];
	for (let u = 0; u < cote; u++) {
		cosinus[u] = [];
		for (let x = 0; x < cote; x++) {
			cosinus[u][x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * cote));
		}
	}

	const coefficients: number[] = [];
	for (let u = 0; u < 8; u++) {
		for (let v = 0; v < 8; v++) {
			let somme = 0;
			for (let x = 0; x < cote; x++) {
				for (let y = 0; y < cote; y++) {
					somme += cosinus[u][x] * cosinus[v][y] * brut[x * cote + y];
				}
			}
			const cu = u === 0 ? Math.SQRT1_2 : 1;
			const cv = v === 0 ? Math.SQRT1_2 : 1;
			coefficients.push(0.25 * cu * cv * somme);
		}
	}

	const sansContinu = coefficients.slice(1).sort((a, b) => a - b);
	const seuil = (sansContinu[30] + sansContinu[31]) / 2;
	return bitsVersHex(coefficients.map((valeur, position) => (position === 0 ? 0 : valeur > seuil ? 1 : 0)));
}

/** Distance de Hamming entre deux empreintes hexadécimales de même longueur. */
export function distance(a: string | null, b: string | null): number | null {
	if (!a || !b || a.length !== b.length) {
		return null;
	}
	let total = 0;
	for (let position = 0; position < a.length; position++) {
		let reste = Number.parseInt(a[position], 16) ^ Number.parseInt(b[position], 16);
		while (reste) {
			total += reste & 1;
			reste >>= 1;
		}
	}
	return total;
}

// ───────────────────────── Lecture des fichiers ─────────────────────────

type SharpModule = (entree: Uint8Array | string) => {
	grayscale(): ReturnType<SharpModule>;
	resize(l: number, h: number, o: { fit: "fill" }): ReturnType<SharpModule>;
	raw(): ReturnType<SharpModule>;
	toBuffer(): Promise<Buffer>;
	metadata(): Promise<{ width?: number; height?: number }>;
};

/**
 * `sharp` vit dans les dépendances du site, pas à la racine.
 *
 * Un script de `scripts/` ne le résout donc pas tout seul (mesuré : « Cannot find package
 * 'sharp' »). On le résout depuis `apps/website`, où il est bel et bien installé, plutôt que
 * d'ajouter une dépendance racine pour un seul script lancé à la main.
 */
async function chargerSharp(): Promise<SharpModule> {
	const racine = new URL("../..", import.meta.url).pathname;
	try {
		const chemin = Bun.resolveSync("sharp", `${racine}apps/website`);
		return ((await import(chemin)) as { default: SharpModule }).default;
	} catch (erreur) {
		throw new Error(
			`sharp introuvable (${erreur instanceof Error ? erreur.message : String(erreur)}) — ` +
				"lancer `bun install` à la racine du dépôt."
		);
	}
}

function cheminDisque(urlOuChemin: string): string | null {
	if (urlOuChemin.startsWith("campagnes/")) {
		return `${RACINE_STOCKAGE}/assets/${urlOuChemin}`;
	}
	const position = urlOuChemin.indexOf(PREFIXE_ASSETS);
	if (position >= 0) {
		return `${RACINE_STOCKAGE}/assets/${urlOuChemin.slice(position + PREFIXE_ASSETS.length)}`;
	}
	const positionTweets = urlOuChemin.indexOf(PREFIXE_TWEETS);
	if (positionTweets >= 0) {
		return `${RACINE_STOCKAGE}/tweets/${urlOuChemin.slice(positionTweets + PREFIXE_TWEETS.length)}`;
	}
	return null;
}

function tableau(valeur: unknown): unknown[] {
	if (Array.isArray(valeur)) return valeur;
	if (typeof valeur === "string") {
		try {
			const analyse: unknown = JSON.parse(valeur);
			return Array.isArray(analyse) ? analyse : [];
		} catch {
			return [];
		}
	}
	return [];
}

function texte(valeur: unknown): string | null {
	return typeof valeur === "string" && valeur.trim().length > 0 ? valeur.trim() : null;
}

function nombre(valeur: unknown): number | null {
	return typeof valeur === "number" && Number.isFinite(valeur) ? Math.trunc(valeur) : null;
}

/** Les fichiers d'une création Discord ou Instagram (même forme de stockage). */
function fichiersDepuisImages(brut: unknown): FichierCreation[] {
	const fichiers: FichierCreation[] = [];
	let index = 0;
	for (const entree of tableau(brut)) {
		if (!entree || typeof entree !== "object") continue;
		const item = entree as Record<string, unknown>;
		const cheminBucket = texte(item.chemin);
		const typeMime = texte(item.type_mime) ?? "";
		const kind = texte(item.kind) === "video" || typeMime.startsWith("video/") ? "video" : "image";
		fichiers.push({
			chemin: cheminBucket ? cheminDisque(cheminBucket) : null,
			cheminBucket,
			hauteurAnnoncee: nombre(item.hauteur),
			index,
			kind,
			largeurAnnoncee: nombre(item.largeur),
			url: texte(item.url_origine),
		});
		index++;
	}
	return fichiers;
}

/** Les fichiers d'un tweet : seules les PHOTOS comptent (cf. `extraireImages` côté site). */
function fichiersDepuisTweet(brut: unknown): FichierCreation[] {
	const fichiers: FichierCreation[] = [];
	let index = 0;
	for (const entree of tableau(brut)) {
		if (!entree || typeof entree !== "object") continue;
		const item = entree as Record<string, unknown>;
		if (texte(item.type) !== "photo") continue;
		const stockage = texte(item.storage_url);
		const origine = texte(item.original_url) ?? texte(item.url) ?? texte(item.preview_url);
		fichiers.push({
			chemin: stockage ? cheminDisque(stockage) : null,
			cheminBucket: stockage,
			hauteurAnnoncee: nombre(item.height),
			index,
			kind: "image",
			largeurAnnoncee: nombre(item.width),
			// `?name=orig` : X sert la variante « medium » (1200 px) sans ce suffixe.
			url: origine ? (origine.includes("?name=") ? origine : `${origine}?name=orig`) : null,
		});
		index++;
	}
	return fichiers;
}

async function lireOctets(fichier: FichierCreation): Promise<Uint8Array | null> {
	if (fichier.chemin) {
		const surDisque = Bun.file(fichier.chemin);
		if (await surDisque.exists()) {
			return new Uint8Array(await surDisque.arrayBuffer());
		}
	}
	if (fichier.url) {
		const reponse = await fetch(fichier.url).catch(() => null);
		if (reponse?.ok) {
			return new Uint8Array(await reponse.arrayBuffer());
		}
	}
	return null;
}

async function mesurer(sharp: SharpModule, fichier: FichierCreation): Promise<Mesure | null> {
	const octets = await lireOctets(fichier);
	if (!octets) return null;

	const sha256 = new Bun.CryptoHasher("sha256").update(octets).digest("hex");
	if (fichier.kind === "video") {
		// Aucune empreinte perceptuelle sur une vidéo : `sharp` ne la décode pas, et hacher une
		// frame arbitraire donnerait une valeur qui ne veut rien dire. Les dimensions annoncées
		// par Discord sont, elles, mesurées — par Discord.
		return {
			cheminBucket: fichier.cheminBucket,
			dhash: null,
			hauteur: fichier.hauteurAnnoncee,
			index: fichier.index,
			kind: "video",
			largeur: fichier.largeurAnnoncee,
			octets: octets.byteLength,
			phash: null,
			sha256,
			url: fichier.url,
		};
	}

	const meta = await sharp(octets).metadata();
	return {
		cheminBucket: fichier.cheminBucket,
		dhash: await dhash(sharp, octets),
		hauteur: meta.height ?? fichier.hauteurAnnoncee,
		index: fichier.index,
		kind: "image",
		largeur: meta.width ?? fichier.largeurAnnoncee,
		octets: octets.byteLength,
		phash: await phash(sharp, octets),
		sha256,
		url: fichier.url,
	};
}

// ───────────────────────── Programme ─────────────────────────

function option(nom: string): string | undefined {
	const position = Bun.argv.indexOf(nom);
	return position === -1 ? undefined : Bun.argv[position + 1];
}

const SLUG = option("--campagne") ?? "iergday";
const TOUT = Bun.argv.includes("--tout");
/*
 * `--tout` N'ÉCRIT JAMAIS, et ce n'est pas une timidité : remesurer une création déjà couverte
 * pour la réécrire ferait entrer une seconde fois la même publication dans la liste `creations`
 * de son œuvre — donc, au prochain calcul du roster, une chance de plus à quelqu'un. C'est un
 * mode de CONTRÔLE : il vérifie que les empreintes recalculées retombent sur celles de la base
 * (mesuré le 26/8/2026 sur IERG Day : 19 créations sur 19, au bit près, regroupements compris).
 */
const DRY = Bun.argv.includes("--dry") || TOUT;

const URL_BASE = Bun.env.DATABASE_URL;
if (!URL_BASE) throw new Error("DATABASE_URL manquant");
const sql = createBunSql({ url: URL_BASE });
const sharp = await chargerSharp();

const creations = (await sql.unsafe(SQL_CREATIONS, [SLUG])) as unknown as LigneCreation[];
const retenues = creations.filter((creation) => creation.motif_ecart === null);
const oeuvres = (await sql`
	select oeuvre_id, cle, creations, sha256, dhash, phash
	  from public.x_campagne_oeuvres
	 where campagne_slug = ${SLUG}`) as LigneOeuvre[];

const couvertes = new Set<string>();
for (const oeuvre of oeuvres) {
	for (const entree of tableau(oeuvre.creations)) {
		if (!entree || typeof entree !== "object") continue;
		const item = entree as Record<string, unknown>;
		couvertes.add(`${texte(item.source)}:${texte(item.identifiant)}`);
	}
}

const aTraiter = retenues.filter(
	(creation) => TOUT || !couvertes.has(`${creation.source}:${creation.identifiant}`)
);

console.log(
	`empreintes campagne=${SLUG} retenues=${retenues.length} couvertes=${couvertes.size} ` +
		`a_mesurer=${aTraiter.length} oeuvres_en_base=${oeuvres.length}` +
		`${TOUT ? " mode=controle (aucune ecriture)" : DRY ? " mode=simulation" : ""}`
);

if (aTraiter.length === 0) {
	console.log("rien a faire : chaque creation retenue porte deja une oeuvre");
	process.exit(0);
}

/** Les fichiers d'une création, quelle qu'en soit la source. */
async function fichiersDe(creation: LigneCreation): Promise<FichierCreation[]> {
	if (creation.source === "x") {
		const lignes = (await sql`select media from public.tweets where id = ${creation.identifiant}`) as Array<{
			media: unknown;
		}>;
		return fichiersDepuisTweet(lignes[0]?.media);
	}
	if (creation.source === "discord") {
		const lignes = (await sql`
			select images from public.campagne_creations_discord
			 where campagne_slug = ${SLUG} and message_id = ${creation.identifiant}`) as Array<{ images: unknown }>;
		return fichiersDepuisImages(lignes[0]?.images);
	}
	const lignes = (await sql`
		select images from public.campagne_creations_instagram
		 where campagne_slug = ${SLUG} and shortcode = ${creation.identifiant}`) as Array<{ images: unknown }>;
	return fichiersDepuisImages(lignes[0]?.images);
}

interface Candidate {
	creation: LigneCreation;
	mesures: Mesure[];
	master: Mesure;
	/** Œuvre existante à laquelle la preuve rattache cette création, s'il y en a une. */
	rattachement: LigneOeuvre | null;
	preuve: string | null;
}

const candidates: Candidate[] = [];
const illisibles: string[] = [];

for (const creation of aTraiter) {
	const fichiers = await fichiersDe(creation);
	const mesures: Mesure[] = [];
	for (const fichier of fichiers) {
		const mesure = await mesurer(sharp, fichier);
		if (mesure) mesures.push(mesure);
		else illisibles.push(`${creation.source}:${creation.identifiant}#${fichier.index}`);
	}
	if (mesures.length === 0) {
		console.warn(`illisible ${creation.source}:${creation.identifiant} — aucun fichier mesurable, ignoree`);
		continue;
	}

	// Le master est le fichier le mieux défini de la création : c'est lui qu'on sert en pleine
	// résolution, et lui dont l'empreinte représente l'œuvre.
	const master = mesures.reduce((meilleur, mesure) =>
		(mesure.largeur ?? 0) * (mesure.hauteur ?? 0) > (meilleur.largeur ?? 0) * (meilleur.hauteur ?? 0)
			? mesure
			: meilleur
	);

	let rattachement: LigneOeuvre | null = null;
	let preuve: string | null = null;
	for (const oeuvre of oeuvres) {
		if (oeuvre.sha256 && oeuvre.sha256 === master.sha256) {
			rattachement = oeuvre;
			preuve = `sha256 identique (${master.sha256.slice(0, 16)}…) : le fichier est le même octet pour octet.`;
			break;
		}
		const dd = distance(oeuvre.dhash, master.dhash);
		const dp = distance(oeuvre.phash, master.phash);
		if (dd !== null && dp !== null && dd <= SEUIL_FORT && dp <= SEUIL_FORT) {
			rattachement = oeuvre;
			preuve = `dHash=${dd} et pHash=${dp}, sous le seuil fort de ${SEUIL_FORT} : même dessin republié.`;
			break;
		}
	}

	candidates.push({ creation, master, mesures, preuve, rattachement });

	const proches = oeuvres
		.map((oeuvre) => ({ dd: distance(oeuvre.dhash, master.dhash), dp: distance(oeuvre.phash, master.phash), oeuvre }))
		.filter((item) => item.dd !== null && item.dp !== null && item.dd <= 8 && item.dp <= 8 && item.oeuvre !== rattachement);
	for (const proche of proches) {
		console.warn(
			`a verifier a la main ${creation.source}:${creation.identifiant} vs ${proche.oeuvre.oeuvre_id} — ` +
				`dHash=${proche.dd} pHash=${proche.dp} : ressemblant SANS etre une preuve. Aucune fusion prononcee.`
		);
	}

	console.log(
		`mesure ${creation.source}:${creation.identifiant} fichiers=${mesures.length} kind=${master.kind} ` +
			`${master.largeur}x${master.hauteur} sha256=${master.sha256.slice(0, 12)} ` +
			`dhash=${master.dhash ?? "-"} phash=${master.phash ?? "-"} ` +
			`${rattachement ? `rattachee=${rattachement.oeuvre_id}` : "oeuvre=nouvelle"}`
	);
}

if (illisibles.length > 0) {
	console.warn(`fichiers illisibles=${illisibles.length} : ${illisibles.join(", ")}`);
}

// Les identités doivent PRÉEXISTER : la clé étrangère de `x_campagne_oeuvres` l'exige, et créer
// un participant ici court-circuiterait la reconstruction du roster, seul endroit qui sait fusionner
// deux identités d'une même personne.
const clesRequises = [
	...new Set(candidates.filter((c) => !c.rattachement).map((c) => c.creation.cle_identite ?? "")),
].filter(Boolean);
const connues = new Set(
	(
		(await sql`
			select cle from public.x_campagne_participants
			 where campagne_slug = ${SLUG}`) as Array<{ cle: string }>
	).map((ligne) => ligne.cle)
);
const manquantes = clesRequises.filter((cle) => !connues.has(cle));
if (manquantes.length > 0 && !DRY) {
	console.error(
		`ARRET : ${manquantes.length} identite(s) absente(s) de x_campagne_participants : ${manquantes.join(", ")}.\n` +
			"  Reconstruire le roster d'abord (/admin/iergday, « Reconstruire »), qui cree la ligne canonique a zero\n" +
			"  compteur, puis relancer ce script, puis reconstruire une seconde fois pour mettre les compteurs a jour."
	);
	process.exit(1);
}

if (DRY) {
	console.log(
		`simulation : ${candidates.filter((c) => !c.rattachement).length} oeuvre(s) seraient creee(s), ` +
			`${candidates.filter((c) => c.rattachement).length} rattachee(s) a une oeuvre existante. Rien ecrit.`
	);
	process.exit(0);
}

// Un engagement ouvert a déjà publié l'empreinte du roster : y ajouter une œuvre rendrait le
// tirage invérifiable. Même garde que `reconstruireRoster`.
const engagement = (await sql`
	select numero from public.x_campagne_tirages
	 where campagne_slug = ${SLUG} and graine is null and annule_le is null
	 limit 1`) as Array<{ numero: number }>;
if (engagement.length > 0) {
	console.error(
		`ARRET : un engagement est ouvert (tirage n°${engagement[0].numero}) et son roster est gele. ` +
			"L'annuler avant d'ajouter une oeuvre, sinon la verification du tirage echouera."
	);
	process.exit(1);
}

let creees = 0;
let rattachees = 0;
for (const candidate of candidates) {
	const { creation, master } = candidate;
	if (candidate.rattachement) {
		// Rattachement à une œuvre existante : on n'ajoute QUE la création à sa liste, sans toucher
		// ni au master, ni au motif, ni à la création gardée — ces choix-là ont été arbitrés.
		const liste = tableau(candidate.rattachement.creations) as Array<Record<string, unknown>>;
		if (liste.some((entree) => texte(entree.identifiant) === creation.identifiant)) {
			// Déjà dans la liste : ne jamais l'y remettre. Une publication comptée deux fois dans
			// une œuvre, c'est `nb_creations` faussé et un ticket qui apparaît de nulle part.
			continue;
		}
		liste.push({
			auteur: creation.auteur_pseudo ?? creation.auteur_nom,
			identifiant: creation.identifiant,
			publieLe: creation.horodatage,
			source: creation.source,
		});
		await sql`
			update public.x_campagne_oeuvres
			   set creations = ${liste}::jsonb,
			       nb_creations = ${liste.length},
			       motif_regroupement = coalesce(motif_regroupement, ${candidate.preuve})
			 where campagne_slug = ${SLUG} and oeuvre_id = ${candidate.rattachement.oeuvre_id}`;
		rattachees++;
		continue;
	}

	const oeuvreId = `${creation.source}:${creation.identifiant}`;
	await sql`
		insert into public.x_campagne_oeuvres
		       (campagne_slug, oeuvre_id, cle, creation_gardee_source, creation_gardee_id,
		        creations, nb_creations, sha256, dhash, phash, largeur, hauteur,
		        image_master_source, image_master_id, image_master_index, image_master_chemin, image_master_url)
		values (${SLUG}, ${oeuvreId}, ${creation.cle_identite}, ${creation.source}, ${creation.identifiant},
		        ${[
					{
						auteur: creation.auteur_pseudo ?? creation.auteur_nom,
						identifiant: creation.identifiant,
						publieLe: creation.horodatage,
						source: creation.source,
					},
				]}::jsonb,
		        1, ${master.sha256}, ${master.dhash}, ${master.phash}, ${master.largeur}, ${master.hauteur},
		        ${creation.source}, ${creation.identifiant}, ${master.index},
		        ${master.cheminBucket}, ${master.url})
		on conflict (campagne_slug, oeuvre_id) do nothing`;
	creees++;
}

console.log(
	`ecrit campagne=${SLUG} oeuvres_creees=${creees} creations_rattachees=${rattachees} ` +
		`oeuvres_total=${oeuvres.length + creees}`
);
console.log("reconstruire le roster (/admin/iergday) pour mettre les compteurs des participants a jour");
process.exit(0);
