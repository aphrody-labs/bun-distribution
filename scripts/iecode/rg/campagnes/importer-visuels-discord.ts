// Import des visuels des campagnes `/iergday` depuis Discord vers le Storage.
//
// POURQUOI
// Les cinq campagnes archivées (`inazuma-rg`, `inatober-rg-2023`, `inazuma-rg-2`,
// `inatober-rg-2024`, `inatober-rg-2025`) n'avaient aucun visuel : leurs affiches
// n'existent que dans les annonces Discord de `🚨〡annonces`. Ce script recopie ces
// pièces jointes dans notre Storage self-host, seul endroit qui les rende durables
// (les URL Discord sont signées et expirent) et servable par `next/image` depuis
// l'origine du site.
//
// SOURCE DE VÉRITÉ
// La table `VISUELS` ci-dessous ne contient QUE des valeurs mesurées dans
// `public.discord_messages` le 12/8/2026 : identifiant de message, position de la
// pièce jointe, nom de fichier exact. Le nom de fichier sert de garde-fou : si
// Discord renvoie autre chose à cette position, le visuel est refusé plutôt
// qu'importé de travers. Les titres et légendes reprennent ce que les annonces
// écrivent — rien n'est inventé.
//
// USAGE
//   bun scripts/campagnes/importer-visuels-discord.ts [--dry-run] [--force]
//                                                     [--slug <slug>] [--json]
//
// Le script est idempotent : un visuel déjà présent dans `storage.objects` ET
// servi par le service Storage n'est ni re-téléchargé ni ré-encodé (`--force`
// pour l'y contraindre).
import { checkoutRoot } from "@aphrody/paths";
import { createBunSql } from "@rosegriffon/db/bun-sql";

// ───────────────────────── Table de description ─────────────────────────

interface Visuel {
	/** Slug de la campagne dans `public.x_campagnes`. */
	slug: string;
	/** Message d'origine dans `public.discord_messages`. */
	messageId: string;
	/** Position de la pièce jointe dans `discord_messages.attachments` (0 = première). */
	piece: number;
	/** Nom de fichier MESURÉ à cette position — garde-fou contre un décalage d'ordre. */
	fichier: string;
	/** Clé de stockage : `campagnes/<slug>/<cle>.webp`. */
	cle: string;
	/** Titre court, pour l'interface. */
	titre: string;
	/** Légende factuelle, adossée au texte de l'annonce. */
	legende: string;
}

const VISUELS: readonly Visuel[] = [
	// ── inazuma-rg — 1ʳᵉ édition, août 2023 ──
	{
		slug: "inazuma-rg",
		messageId: "1136329183199514734",
		piece: 0,
		fichier: "exp0.png",
		cle: "affiche",
		titre: "Annonce de lancement du #inazumaRG",
		legende: "Visuel de l'annonce du 2 août 2023 ouvrant le premier challenge communautaire.",
	},
	{
		slug: "inazuma-rg",
		messageId: "1150448205956382815",
		piece: 0,
		fichier: "RG_challenge_banniere.png",
		cle: "couverture",
		titre: "Illustration bannière du #inazumaRG",
		legende:
			"Illustration publiée le 10 septembre 2023 : quatre participants tirés au sort à la clôture, dessinés avec Roy, Gaëlle et les OC du staff.",
	},
	{
		slug: "inazuma-rg",
		messageId: "1149788549563031603",
		piece: 0,
		fichier: "inazuma_affiche_remerciement_rg.png",
		cle: "fresque",
		titre: "Affiche finale du #inazumaRG",
		legende: "Affiche réunissant toutes les participations, révélée le 9 septembre 2023 avec la fresque interactive.",
	},
	// Les huit fonds du trailer, republiés en bonne qualité le 4 août 2023. L'ordre
	// des pièces jointes n'est PAS celui des numéros : la position mesurée fait foi.
	{
		slug: "inazuma-rg",
		messageId: "1137058997879443498",
		piece: 2,
		fichier: "BG_39_modele.png",
		cle: "maillot-bg-39",
		titre: "Fond BG_39",
		legende: "Fond couleur du trailer, republié en bonne qualité le 4 août 2023.",
	},
	{
		slug: "inazuma-rg",
		messageId: "1137058997879443498",
		piece: 1,
		fichier: "BG_40.png",
		cle: "maillot-bg-40",
		titre: "Fond BG_40",
		legende: "Fond couleur du trailer, republié en bonne qualité le 4 août 2023.",
	},
	{
		slug: "inazuma-rg",
		messageId: "1137058997879443498",
		piece: 4,
		fichier: "BG_41_modele.png",
		cle: "maillot-bg-41",
		titre: "Fond BG_41",
		legende: "Fond couleur du trailer, republié en bonne qualité le 4 août 2023.",
	},
	{
		slug: "inazuma-rg",
		messageId: "1137058997879443498",
		piece: 3,
		fichier: "BG_42.png",
		cle: "maillot-bg-42",
		titre: "Fond BG_42",
		legende: "Fond couleur du trailer, republié en bonne qualité le 4 août 2023.",
	},
	{
		slug: "inazuma-rg",
		messageId: "1137058997879443498",
		piece: 0,
		fichier: "BG_43_modele.png",
		cle: "maillot-bg-43",
		titre: "Fond BG_43",
		legende: "Fond couleur du trailer, republié en bonne qualité le 4 août 2023.",
	},
	{
		slug: "inazuma-rg",
		messageId: "1137058997879443498",
		piece: 7,
		fichier: "BG_44_modele.png",
		cle: "maillot-bg-44",
		titre: "Fond BG_44",
		legende: "Fond couleur du trailer, republié en bonne qualité le 4 août 2023.",
	},
	{
		slug: "inazuma-rg",
		messageId: "1137058997879443498",
		piece: 6,
		fichier: "BG_45_modele.png",
		cle: "maillot-bg-45",
		titre: "Fond BG_45",
		legende: "Fond couleur du trailer, republié en bonne qualité le 4 août 2023.",
	},
	{
		slug: "inazuma-rg",
		messageId: "1137058997879443498",
		piece: 5,
		fichier: "BG_46_modele.png",
		cle: "maillot-bg-46",
		titre: "Fond BG_46",
		legende: "Fond couleur du trailer, republié en bonne qualité le 4 août 2023.",
	},

	// ── inatober-rg-2023 — octobre 2023 ──
	{
		slug: "inatober-rg-2023",
		messageId: "1157981993494130838",
		piece: 0,
		fichier: "F6FH69rXIAA6gzp.png",
		cle: "affiche",
		titre: "Liste des thèmes de l'InatoberRG2023",
		legende:
			"Affiche des thèmes du mois, publiée à l'ouverture le 1er octobre 2023 : thèmes en jaune liés à Inazuma Eleven, thèmes en bleu plus globaux.",
	},

	// ── inazuma-rg-2 — 2ᵉ édition, août 2024 ──
	{
		slug: "inazuma-rg-2",
		messageId: "1268993998148603950",
		piece: 0,
		fichier: "RG2v3.png",
		cle: "affiche",
		titre: "Affiche de lancement du #InazumaRG2",
		legende: "Affiche de la seconde édition, publiée le 2 août 2024 pour l'anniversaire du premier challenge.",
	},
	{
		slug: "inazuma-rg-2",
		messageId: "1288530466428944385",
		piece: 0,
		fichier: "RG_TRIPTYQUE_ERWAN_ETHAN_YAFLIN_WATERMARK.png",
		cle: "fresque",
		titre: "Triptyque du #InazumaRG2",
		legende:
			"Triptyque publié le 25 septembre 2024, en même temps que le lien du Mural réunissant toutes les participations.",
	},
	// ⚠ PAS D'ENTRÉE `cloture` POUR CETTE CAMPAGNE, et ce n'est pas un oubli.
	// L'annonce du dernier jour (message 1279380328368046112) joint bien une image
	// nommée `01_Annonce.png`, mais l'association y a REPUBLIÉ son affiche de
	// lancement : les deux fichiers sont identiques octet pour octet, md5
	// c4b23c150c22832ff16b29175a363491 des deux côtés (téléchargés depuis Discord
	// après rafraîchissement des URL signées, le 13/8/2026). L'importer aurait
	// écrit 5,5 Mo en double dans le Storage, et la page aurait montré deux fois
	// la même affiche sous deux titres différents.

	// ── inatober-rg-2024 — octobre 2024 ──
	{
		slug: "inatober-rg-2024",
		messageId: "1290343058793173042",
		piece: 0,
		fichier: "20240930_inatober.png",
		cle: "affiche",
		titre: "Liste des thèmes de l'InatoberRG2024",
		legende: "Affiche des thèmes centrés sur la saison 2, publiée le 30 septembre 2024.",
	},

	// ── inatober-rg-2025 — octobre 2025 ──
	{
		slug: "inatober-rg-2025",
		messageId: "1422662293027815515",
		piece: 0,
		fichier: "inatober_fr.png",
		cle: "affiche",
		titre: "Liste des thèmes de l'inatoberRG2025",
		legende: "Affiche des thèmes centrés sur la saison 3 (FFI), publiée le 30 septembre 2025.",
	},
] as const;

// ───────────────────────── Réglages ─────────────────────────

const BUCKET = "assets";
/** Largeur maximale du rendu servi par les pages (le jumeau `-original` garde la pleine définition). */
const LARGEUR_RENDU = 1600;
const QUALITE_RENDU = 82;
const QUALITE_ORIGINAL = 90;

const RACINE_REPO = Bun.env.RG_REPO_ROOT ?? checkoutRoot("rg");
/** Service Storage self-host (`apps/storage/server.ts`). */
const STORAGE_INTERNE = Bun.env.RG_STORAGE_INTERNAL_URL ?? "http://127.0.0.1:8810";
/**
 * Origine publique : celle du SITE, où nginx expose `/storage/v1/` via
 * `supabase-compat.inc`. C'est la forme déjà stockée dans `x_campagnes` pour
 * `iergday` — ne pas dévier vers `storage.rosegriffon.fr` (préflight CORS inutile).
 */
const ORIGINE_PUBLIQUE = Bun.env.RG_STORAGE_PUBLIC_ORIGIN ?? "https://rosegriffon.fr";
/** L'écriture dans `storage.objects` est réservée au `service_role`. */
const CLE_SERVICE = Bun.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
/** Le jeton s'appelle `DISCORD_BOT_TOKEN` dans le `.env` du dépôt. */
const JETON_DISCORD = Bun.env.DISCORD_BOT_TOKEN ?? Bun.env.DISCORD_TOKEN ?? "";

const args = Bun.argv.slice(2);
const DRY = args.includes("--dry-run") || args.includes("--dry");
const FORCE = args.includes("--force");
const JSON_SORTIE = args.includes("--json");
const SLUG_FILTRE = args.includes("--slug") ? args[args.indexOf("--slug") + 1] : null;

// ───────────────────────── Outils ─────────────────────────

type SharpModule = typeof import("sharp");

/**
 * `sharp` n'est déclaré que dans les apps Next (catalog) : on le résout d'abord
 * normalement, sinon depuis le store hoisté `node_modules/.bun` du monorepo.
 * Même stratégie que `apps/cdn-variants/server.ts`.
 */
async function chargerSharp(): Promise<SharpModule> {
	try {
		return (await import("sharp")).default as unknown as SharpModule;
	} catch {
		const motif = new Bun.Glob("sharp@*/node_modules/sharp/lib/index.js");
		const store = `${RACINE_REPO}/node_modules/.bun`;
		for await (const rel of motif.scan({ cwd: store, onlyFiles: true })) {
			const mod = await import(`${store}/${rel}`);
			return (mod.default ?? mod) as SharpModule;
		}
		throw new Error("sharp introuvable (ni résolution standard ni store .bun)");
	}
}

function ko(octets: number): string {
	return `${Math.round(octets / 1024)}ko`;
}

interface PieceJointe {
	url?: string;
	filename?: string;
	content_type?: string;
	size?: number;
	width?: number;
	height?: number;
}

interface Objet {
	slug: string;
	cle: string;
	name: string;
	url: string;
	http: number;
	octets: number;
	largeur: number;
	hauteur: number;
}

// ───────────────────────── Discord ─────────────────────────

/**
 * Rafraîchit des URL de pièces jointes signées.
 *
 * Les URL stockées en base portent une signature `?ex=…&is=…&hm=…` qui expire :
 * s'y fier ferait échouer l'import sans prévenir le jour où elles périment. Le
 * point d'entrée officiel les régénère à partir de l'URL périmée elle-même.
 */
async function rafraichirUrls(urls: string[]): Promise<Map<string, string>> {
	const carte = new Map<string, string>();
	// Par lots : l'API borne la taille du tableau.
	for (let i = 0; i < urls.length; i += 25) {
		const lot = urls.slice(i, i + 25);
		const reponse = await fetch("https://discord.com/api/v10/attachments/refresh-urls", {
			method: "POST",
			headers: { authorization: `Bot ${JETON_DISCORD}`, "content-type": "application/json" },
			body: JSON.stringify({ attachment_urls: lot }),
		});
		if (!reponse.ok) {
			throw new Error(`refresh-urls ${reponse.status} : ${(await reponse.text()).slice(0, 200)}`);
		}
		const corps = (await reponse.json()) as { refreshed_urls?: Array<{ original: string; refreshed: string }> };
		for (const { original, refreshed } of corps.refreshed_urls ?? []) carte.set(original, refreshed);
	}
	return carte;
}

// ───────────────────────── Storage ─────────────────────────

function urlPublique(nom: string): string {
	return `${ORIGINE_PUBLIQUE}/storage/v1/object/public/${BUCKET}/${nom}`;
}

/**
 * Téléverse un WebP. Le service écrit le fichier sur disque ET indexe la ligne
 * `storage.objects` avec un `metadata` jsonb OBJET (mimetype lisible via
 * `metadata->>'mimetype'`) : on lui passe donc le corps brut avec le bon
 * `content-type`, jamais un multipart bricolé.
 */
async function televerser(nom: string, octets: Uint8Array): Promise<void> {
	const reponse = await fetch(`${STORAGE_INTERNE}/object/${BUCKET}/${nom}`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${CLE_SERVICE}`,
			"content-type": "image/webp",
			"x-upsert": "true",
		},
		// Corps BRUT (pas de multipart) : le service lit alors `content-type` tel quel
		// et indexe `mimetype: "image/webp"`. `.slice()` → copie `Uint8Array<ArrayBuffer>`,
		// seul `BlobPart` valide pour préserver les octets décodés.
		body: new Blob([octets.slice()]),
	});
	if (!reponse.ok) {
		throw new Error(`téléversement ${nom} : ${reponse.status} ${(await reponse.text()).slice(0, 200)}`);
	}
}

/**
 * Renvoie les octets d'un objet déjà stocké, ou null s'il manque.
 * On interroge le service (et non le disque) pour valider d'un coup la présence
 * du fichier ET son accessibilité réelle.
 */
async function lireObjet(nom: string): Promise<Uint8Array | null> {
	const reponse = await fetch(`${STORAGE_INTERNE}/object/public/${BUCKET}/${encodeURI(nom)}`);
	if (!reponse.ok) return null;
	return new Uint8Array(await reponse.arrayBuffer());
}

/** Statut HTTP de l'URL publique (à travers nginx) — vérification de bout en bout. */
async function statutPublic(nom: string): Promise<number> {
	try {
		const reponse = await fetch(urlPublique(nom), { method: "HEAD" });
		return reponse.status;
	} catch {
		return 0;
	}
}

// ───────────────────────── Programme ─────────────────────────

const URL_BASE = Bun.env.DATABASE_URL;
if (!URL_BASE) throw new Error("DATABASE_URL manquant");
const sql = createBunSql({ url: URL_BASE });
const sharp = await chargerSharp();

const aTraiter = VISUELS.filter((v) => !SLUG_FILTRE || v.slug === SLUG_FILTRE);
if (!DRY && !CLE_SERVICE) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquant");

// 1. Pièces jointes : une lecture par message source (dix messages au plus).
const messages = new Map<string, PieceJointe[]>();
for (const id of new Set(aTraiter.map((v) => v.messageId))) {
	const lignes: Array<{ attachments: PieceJointe[] }> =
		await sql`select attachments from public.discord_messages where message_id = ${id}`;
	if (!lignes.length) throw new Error(`message ${id} absent de discord_messages`);
	messages.set(id, lignes[0].attachments ?? []);
}

// 2. Ce qui manque réellement — l'idempotence évite tout téléchargement inutile.
interface Tache {
	visuel: Visuel;
	piece: PieceJointe;
	nomRendu: string;
	nomOriginal: string;
	dejaLa: boolean;
}

const taches: Tache[] = [];
const echecs: string[] = [];

for (const visuel of aTraiter) {
	const pieces = messages.get(visuel.messageId) ?? [];
	const piece = pieces[visuel.piece];
	const repere = `${visuel.slug}/${visuel.cle}`;
	if (!piece) {
		echecs.push(`${repere} : pièce jointe #${visuel.piece} absente du message ${visuel.messageId}`);
		continue;
	}
	// Garde-fou : la position seule ne suffit pas, le nom mesuré doit correspondre.
	if (piece.filename !== visuel.fichier) {
		echecs.push(`${repere} : attendu ${visuel.fichier}, trouvé ${piece.filename ?? "?"} — import refusé`);
		continue;
	}
	if (!piece.url) {
		echecs.push(`${repere} : pièce jointe sans URL`);
		continue;
	}
	const nomRendu = `campagnes/${visuel.slug}/${visuel.cle}.webp`;
	const nomOriginal = `campagnes/${visuel.slug}/${visuel.cle}-original.webp`;
	const indexes: Array<{ n: number }> = FORCE
		? []
		: await sql`select count(*)::int as n from storage.objects
		            where bucket_id = ${BUCKET} and name in (${nomRendu}, ${nomOriginal})`;
	const dejaLa = !FORCE && (indexes[0]?.n ?? 0) === 2 && (await lireObjet(nomRendu)) !== null;
	taches.push({ visuel, piece, nomRendu, nomOriginal, dejaLa });
}

// 3. Une seule requête de rafraîchissement pour toutes les URL à télécharger.
const aTelecharger = taches.filter((t) => !t.dejaLa);
let urlsFraiches = new Map<string, string>();
if (aTelecharger.length && !DRY) {
	if (!JETON_DISCORD) throw new Error("DISCORD_BOT_TOKEN manquant");
	urlsFraiches = await rafraichirUrls(aTelecharger.map((t) => t.piece.url as string));
}

// 4. Traitement, visuel par visuel.
const objets: Objet[] = [];

for (const tache of taches) {
	const { visuel, piece, nomRendu, nomOriginal } = tache;
	const repere = `${visuel.slug}/${visuel.cle}`;
	try {
		if (DRY) {
			console.log(
				`${repere} source=${piece.filename} dim=${piece.width}x${piece.height} ` +
					`${tache.dejaLa ? "deja" : "a-importer"}`
			);
			continue;
		}

		let rendu: Uint8Array;
		let original: Uint8Array;

		if (tache.dejaLa) {
			// Déjà en place : on relit ce qui est stocké pour en rapporter les mesures.
			const [r, o] = await Promise.all([lireObjet(nomRendu), lireObjet(nomOriginal)]);
			if (!r || !o) throw new Error("objet indexé mais illisible");
			rendu = r;
			original = o;
		} else {
			const source = urlsFraiches.get(piece.url as string) ?? (piece.url as string);
			const reponse = await fetch(source);
			if (!reponse.ok) throw new Error(`téléchargement ${reponse.status}`);
			const brut = new Uint8Array(await reponse.arrayBuffer());
			if (!brut.byteLength) throw new Error("téléchargement vide");
			// Le rendu tient dans 1600px de large ; l'original garde sa définition.
			rendu = new Uint8Array(
				await sharp(brut)
					.resize({ width: LARGEUR_RENDU, fit: "inside", withoutEnlargement: true })
					.webp({ quality: QUALITE_RENDU })
					.toBuffer()
			);
			original = new Uint8Array(await sharp(brut).webp({ quality: QUALITE_ORIGINAL }).toBuffer());
			await televerser(nomRendu, rendu);
			await televerser(nomOriginal, original);
		}

		const [mesureRendu, mesureOriginal] = await Promise.all([
			sharp(rendu).metadata(),
			sharp(original).metadata(),
		]);
		const [httpRendu, httpOriginal] = await Promise.all([statutPublic(nomRendu), statutPublic(nomOriginal)]);

		objets.push({
			slug: visuel.slug,
			cle: visuel.cle,
			name: nomRendu,
			url: urlPublique(nomRendu),
			http: httpRendu,
			octets: rendu.byteLength,
			largeur: mesureRendu.width ?? 0,
			hauteur: mesureRendu.height ?? 0,
		});
		objets.push({
			slug: visuel.slug,
			cle: `${visuel.cle}-original`,
			name: nomOriginal,
			url: urlPublique(nomOriginal),
			http: httpOriginal,
			octets: original.byteLength,
			largeur: mesureOriginal.width ?? 0,
			hauteur: mesureOriginal.height ?? 0,
		});

		if (httpRendu !== 200 || httpOriginal !== 200) {
			echecs.push(`${repere} : URL publique ${httpRendu}/${httpOriginal}`);
		}
		console.log(
			`${repere} taille=${ko(rendu.byteLength)} dim=${mesureRendu.width}x${mesureRendu.height} ` +
				`${tache.dejaLa ? "deja" : "ok"}`
		);
	} catch (erreur) {
		const message = erreur instanceof Error ? erreur.message : String(erreur);
		echecs.push(`${repere} : ${message}`);
		console.log(`${repere} echec=${message}`);
	}
}

if (JSON_SORTIE) console.log(JSON.stringify({ objets, echecs }, null, 2));
console.log(`total visuels=${taches.length} objets=${objets.length} echecs=${echecs.length}`);
for (const echec of echecs) console.log(`echec ${echec}`);

await sql.end();
if (echecs.length) process.exitCode = 1;
