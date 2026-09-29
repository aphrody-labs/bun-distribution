#!/usr/bin/env bun
/**
 * Prépare le corpus databooks pour une transcription OCR hors site.
 *
 * Le corpus brut fait **17 Gio pour 11 934 planches** (~1,5 Mio par image) :
 * intransportable tel quel, et inutilement lourd pour de l'OCR. Ce script en
 * produit des LOTS autonomes, chacun composé de :
 *   - `manifeste.json` — les pages du lot (id de fiche, n° de page, titre,
 *     chemin de l'image dans le lot) + le format de réponse attendu ;
 *   - `images/…` — les planches redimensionnées (1600 px de large par défaut,
 *     JPEG qualité 82), soit ~6× plus légères sans perte de lisibilité du texte.
 *
 * Reprise : les lots déjà écrits sont sautés (`--force` pour refaire).
 * Les pages DÉJÀ transcrites sont exclues par défaut (`--tout` pour les inclure).
 *
 * Usage :
 *   bun scripts/export-databooks-ocr.ts --sortie ~/ocr --taille 400
 *   bun scripts/export-databooks-ocr.ts --sortie ~/ocr --lot 3        # un seul lot
 *   bun scripts/export-databooks-ocr.ts --sortie ~/ocr --plan         # ne fait qu'estimer
 *   bun scripts/export-databooks-ocr.ts --sortie ~/ocr --databook 323,324
 *   bun scripts/export-databooks-ocr.ts --sortie ~/ocr --categorie "Saikyō Jump"
 *   bun scripts/export-databooks-ocr.ts --sortie ~/ocr --databook 465 --acquerir-references
 *
 * `--acquerir-references` est opt-in : il ne récupère que l'URL HTTPS exacte
 * déjà référencée en base, sur l'allowlist stricte des sources de scans.
 */
import { mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import postgres from "postgres";
import sharp from "sharp";
import { urlBase } from "./_databooks-base";
import { SITE_URL } from "../src/lib/config";
import { parseReferencedDatabookScan, referencedScanBasename } from "../src/lib/referenced-databook-scan";

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const SORTIE = opt("sortie", join(process.env.HOME ?? ".", "databooks-ocr"))!;
const TAILLE_LOT = Number(opt("taille", "400"));
const LOT_CIBLE = opt("lot") ? Number(opt("lot")) : null;
const LARGEUR = Number(opt("largeur", "1600"));
const QUALITE = Number(opt("qualite", "82"));
const TOUT = flag("tout");
const PLAN = flag("plan");
const FORCE = flag("force");
const ACQUERIR_REFERENCES = flag("acquerir-references");
/** Restreint l'export à certains ouvrages (`--databook 323,324`) ou à une catégorie. */
const DATABOOKS = (opt("databook") ?? "")
	.split(",")
	.map((v) => Number(v.trim()))
	.filter((v) => Number.isFinite(v) && v > 0);
const CATEGORIE = opt("categorie") ?? null;
const CONCURRENCE = 6;

/**
 * The referenced scan host rejects Bun's stock fetch in some deployments.
 * Keep the acquisition transport isolated to this opt-in path: BXC's
 * curl-impersonate client presents a browser TLS fingerprint while HTTP/1.1
 * avoids the upstream's flaky HTTP/2 responses.
 */
type BxcClient = {
	fetch(url: string, options: {
		headers: Record<string, string>;
		timeoutMs: number;
		followRedirects: boolean;
		httpVersion: "1.1";
	}): Promise<Response>;
	close(): void;
};

let bxcClient: BxcClient | null = null;

async function getBxcClient(): Promise<BxcClient> {
	if (bxcClient) return bxcClient;
	const bxcRoot = process.env.BXC_ROOT?.trim() || resolve(import.meta.dir, "..", "..", "..", "..", "aphrody-web", "apps", "bxc");
	const modulePath = join(bxcRoot, "src", "ffi", "curl-impersonate.ts");
	const { ImpersonatedClient } = await import(modulePath);
	bxcClient = new ImpersonatedClient({
		profile: "chrome131",
		httpVersion: "1.1",
		followRedirects: false,
		timeoutMs: 30_000,
	}) as BxcClient;
	return bxcClient;
}

/** Racine physique des planches (servies par nginx sous /wiki/databooks/). */
const RACINE_IMAGES = join(import.meta.dir, "..", "public", "wiki", "databooks");

const sql = postgres(await urlBase(), { max: 2 });

interface Planche {
	databookId: number;
	titre: string;
	kind: string;
	categorie: string | null;
	numero: number;
	fichier: string;
	imageReference: string;
	dejaTranscrite: boolean;
}

/** Hash the original scan and the exact normalized JPEG emitted for review. */
async function sha256File(path: string): Promise<string> {
	const digest = new Bun.CryptoHasher("sha256");
	digest.update(await Bun.file(path).arrayBuffer());
	return digest.digest("hex");
}

const rows = await sql<
	{ id: string; title: string; kind: string; category: string | null; pages: unknown }[]
>`select id, title, kind, category, pages
  from bot.db_databooks
  where visible and pages is not null
    ${DATABOOKS.length ? sql`and id in ${sql(DATABOOKS)}` : sql``}
    ${CATEGORIE ? sql`and category = ${CATEGORIE}` : sql``}
  order by id`;

const planches: Planche[] = [];
for (const r of rows) {
	if (!Array.isArray(r.pages)) continue;
	r.pages.forEach((p, i) => {
		if (!p || typeof p !== "object") return;
		const o = p as Record<string, unknown>;
		const image = typeof o.image === "string" ? o.image : null;
		if (!image) return;
		const texte = typeof o.text === "string" ? o.text.trim() : "";
		planches.push({
			databookId: Number(r.id),
			titre: r.title,
			kind: r.kind,
			categorie: r.category,
			numero: Number(o.number) || i + 1,
			fichier: referencedScanBasename(image) ?? basename(image),
			imageReference: image,
			dejaTranscrite: texte.length > 0,
		});
	});
}

const aFaire = TOUT ? planches : planches.filter((p) => !p.dejaTranscrite);
const lots = Math.ceil(aFaire.length / TAILLE_LOT);

console.log(
	`corpus : ${planches.length} planche(s) · ${planches.length - aFaire.length} déjà transcrite(s)\n` +
		`à exporter : ${aFaire.length} → ${lots} lot(s) de ${TAILLE_LOT}\n` +
		`sortie : ${SORTIE} · images ${LARGEUR}px q${QUALITE}`
);

if (PLAN) {
	// Estimation du poids : on mesure un échantillon plutôt que de tout ouvrir.
	const ech = aFaire.slice(0, 20);
	let brut = 0;
	let n = 0;
	for (const p of ech) {
		const chemin = join(RACINE_IMAGES, p.fichier);
		if (!existsSync(chemin)) continue;
		brut += (await stat(chemin)).size;
		n++;
	}
	const moyBrut = n ? brut / n : 0;
	console.log(
		`\nestimation (échantillon de ${n}) : ${(moyBrut / 1024).toFixed(0)} Kio/planche en brut → ` +
			`${((moyBrut * aFaire.length) / 1e9).toFixed(1)} Go bruts, ` +
			`~${((moyBrut * 0.17 * aFaire.length) / 1e9).toFixed(1)} Go après réduction`
	);
	await sql.end();
	process.exit(0);
}

async function pool<T>(items: T[], limite: number, fn: (t: T) => Promise<void>) {
	let i = 0;
	await Promise.all(
		Array.from({ length: Math.min(limite, items.length) }, async () => {
			while (i < items.length) await fn(items[i++]!);
		})
	);
}

let manquantes = 0;
let ecrites = 0;

async function acquireReferencedScan(p: Planche, target: string): Promise<boolean> {
	if (!ACQUERIR_REFERENCES || existsSync(target)) return existsSync(target);
	const url = parseReferencedDatabookScan(p.imageReference);
	if (!url) return false;
	const response = await (await getBxcClient()).fetch(url.href, {
		headers: {
			Referer: `${url.origin}/`,
			Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
			"Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
		},
		timeoutMs: 30_000,
		// Match the former `redirect: "error"`: a redirected URL is not an
		// approved scan reference and must not be persisted.
		followRedirects: false,
		httpVersion: "1.1",
	});
	if (!response.ok) throw new Error(`source HTTP ${response.status}`);
	const declaredLength = Number(response.headers.get("content-length") ?? 0);
	if (declaredLength > 25_000_000) throw new Error("scan supérieur à 25 Mo");
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength === 0 || bytes.byteLength > 25_000_000) throw new Error("taille de scan invalide");
	const metadata = await sharp(bytes).metadata();
	if (!metadata.width || !metadata.height || !["jpeg", "png", "webp"].includes(metadata.format ?? "")) {
		throw new Error("contenu image invalide");
	}
	await mkdir(RACINE_IMAGES, { recursive: true });
	const temporary = `${target}.part-${process.pid}`;
	try {
		await writeFile(temporary, bytes, { flag: "wx" });
		await rename(temporary, target);
	} catch (error) {
		await unlink(temporary).catch(() => undefined);
		throw error;
	}
	return true;
}

for (let lot = 1; lot <= lots; lot++) {
	if (LOT_CIBLE !== null && lot !== LOT_CIBLE) continue;
	const dossier = join(SORTIE, `lot-${String(lot).padStart(3, "0")}`);
	const dossierImages = join(dossier, "images");
	const manifestePath = join(dossier, "manifeste.json");

	if (!FORCE && existsSync(manifestePath)) {
		const existing = await Bun.file(manifestePath).json().catch(() => null) as {
			schemaVersion?: number;
			entrees?: Array<{ sourceSha256?: unknown; imageSha256?: unknown }>;
		} | null;
		const hasCandidateHashes = existing?.schemaVersion === 1 && Array.isArray(existing.entrees) &&
			existing.entrees.every((entry) =>
				typeof entry.sourceSha256 === "string" && /^[a-f0-9]{64}$/.test(entry.sourceSha256) &&
				typeof entry.imageSha256 === "string" && /^[a-f0-9]{64}$/.test(entry.imageSha256)
			);
		console.log(hasCandidateHashes
			? `  lot ${lot}/${lots} : déjà présent, sauté`
			: `  lot ${lot}/${lots} : ancien manifeste sans hashes v1, relancer avec --force pour le régénérer`);
		continue;
	}
	await mkdir(dossierImages, { recursive: true });

	const tranche = aFaire.slice((lot - 1) * TAILLE_LOT, lot * TAILLE_LOT);
	const entrees: Record<string, unknown>[] = [];

	await pool(tranche, CONCURRENCE, async (p) => {
		const source = join(RACINE_IMAGES, p.fichier);
		const nom = `${p.databookId}-${String(p.numero).padStart(4, "0")}.jpg`;
		const cible = join(dossierImages, nom);
		try {
			if (!(await acquireReferencedScan(p, source))) {
				manquantes++;
				return;
			}
			await sharp(source)
				.rotate() // respecte l'orientation EXIF : une planche pivotée est illisible en OCR
				.resize({ width: LARGEUR, withoutEnlargement: true })
				.jpeg({ quality: QUALITE, mozjpeg: true })
				.toFile(cible);
			const [sourceSha256, imageSha256] = await Promise.all([
				sha256File(source),
				sha256File(cible),
			]);
			entrees.push({
				databookId: p.databookId,
				page: p.numero,
				sourceSha256,
				imageSha256,
				titre: p.titre,
				kind: p.kind,
				categorie: p.categorie,
				image: `images/${nom}`,
			});
			ecrites++;
		} catch (e) {
			manquantes++;
			console.warn(`    ✗ ${p.fichier} : ${e instanceof Error ? e.message : e}`);
		}
	});

	entrees.sort(
		(a, b) =>
			(a.databookId as number) - (b.databookId as number) || (a.page as number) - (b.page as number)
	);

	// Un manifeste VIDE est pire que pas de manifeste : la reprise ne teste que
	// son existence, donc un run cassé (mauvais `RACINE_IMAGES`, disque non
	// monté) sème des lots vides que tous les lancements suivants sautent en
	// annonçant « déjà présent ». On ne l'écrit que s'il y a quelque chose
	// dedans, et on le dit.
	if (entrees.length === 0) {
		console.log(`  ✗ lot ${lot}/${lots} : aucune image copiée, manifeste non écrit`);
		continue;
	}

	await writeFile(
		manifestePath,
		JSON.stringify(
			{
				schemaVersion: 1,
				lot,
				lots,
				genere: "scripts/export-databooks-ocr.ts",
				planches: entrees.length,
				// Format ATTENDU en retour, à réinjecter via l'API.
				reponseAttendue: {
					endpoint: `POST ${SITE_URL}/api/databooks/<databookId>/transcription`,
					entetes: { Authorization: "Bearer <DATABOOKS_API_TOKEN>" },
					corps: {
						mode: "merge (défaut) | replace",
						pages: [{ number: 1, text: "texte transcrit de la planche…" }],
					},
				},
				entrees,
			},
			null,
			2
		),
		"utf8"
	);
	const taille = (await readdir(dossierImages)).length;
	console.log(
		`  ✓ lot ${lot}/${lots} — ${entrees.length} entrée(s), ${taille} image(s) → ${dossier}`
	);
}

console.log(
	`\n✓ ${ecrites} planche(s) exportée(s)${manquantes ? ` · ${manquantes} manquante(s)` : ""}`
);
await sql.end();
// TypeScript cannot observe the assignment performed inside `getBxcClient()`.
(bxcClient as BxcClient | null)?.close();
// Sortir 0 quoi qu'il arrive faisait avancer une automatisation « export → OCR
// → dépôt » sur des lots vides, sans le moindre signal. Un export qui n'a rien
// écrit alors qu'il avait du travail est un échec, et il doit le dire.
if (ecrites === 0 && aFaire.length > 0) {
	console.error(
		`✗ aucune planche exportée sur ${aFaire.length} à faire — vérifier RACINE_IMAGES (${RACINE_IMAGES})`
	);
	process.exit(1);
}
process.exit(0);
