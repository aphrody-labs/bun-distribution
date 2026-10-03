/**
 * ingest-scans-couleur.ts — Les 520 chapitres « Full Color » du forum scan-db
 * deviennent des chapitres lisibles du wiki.
 *
 * CE QUI EXISTAIT DÉJÀ, ET POURQUOI ON NE LE PROLONGE PAS
 * -------------------------------------------------------
 * `ingest-fullcolor-manga.ts` visait la même idée par Sushi Scan, mais couvrait
 * **2 tomes** et n'a jamais atterri : 175 Mo dorment dans
 * `apps/shenron/bot/assets/manga/DB/fullcolor/`, et **zéro ligne** de
 * `bot.db_manga_chapters` ne pointe ce dossier (mesuré le 2026-09-02). Le
 * forum, lui, porte l'œuvre entière : 520 fils, 7 954 planches. On repart donc
 * de cette source-là, sans toucher à l'ancienne chaîne.
 *
 * D'OÙ VIENNENT LES URL
 * ---------------------
 * Pas du disque : les planches restent sur le CDN de Discord, et `pages`
 * enregistre l'URL STABLE de notre redirection
 * (`/api/public/manga/couleur/<salon>/<pièce>/<fichier>`). La raison est dans
 * `src/lib/scans-couleur.ts` : une URL CDN signée meurt en 24 h, une page ISR
 * non. `assetUrl()` côté site laisse passer tel quel ce qui commence par
 * `http`, donc le lecteur existant n'a rien à apprendre.
 *
 * D'OÙ VIENT LE RATTACHEMENT AU TOME
 * ----------------------------------
 * Il est **mesuré**, pas écrit à la main. La planche 2 de chaque tome porte son
 * sommaire, et l'OCR de `bot.db_manga_pages` l'a capté :
 *
 *     « Sommaire Chapitre 171 Le mariage de Son Goku Page 003 Chapitre 172… »
 *
 * On lit les 42 sommaires : 514 chapitres sur 519 sont ainsi rattachés, avec
 * **zéro conflit** et des plages parfaitement contiguës (vol1 1→13, vol2 14→26,
 * … vol42 503→519). Les 5 restants (3, 4, 6, 8, 9) sont ceux dont l'OCR a
 * mangé le NUMÉRO (« Chapitre Goku va a la mer Page 049 ») : ils tombent tous
 * strictement dans la plage mesurée du tome 1, bornée en dessous par le
 * chapitre 1 et au-dessus par le chapitre 14 du tome 2. Les fermer par
 * containment n'est donc pas une supposition, c'est la conséquence de la
 * monotonie déjà vérifiée. Tout ce qui ne se range pas ainsi est JOURNALISÉ et
 * laissé de côté.
 *
 * Piège attrapé en route : `\b` après le numéro échoue sur « Chapitre 183Echauffement »,
 * l'OCR collant le titre au numéro (« 3 » et « E » sont tous deux des \w, il n'y
 * a pas de frontière de mot). Cinq chapitres manquaient pour cette seule
 * raison. D'où `(\d{1,3})(?!\d)`.
 *
 * Usage :
 *   sudo systemd-run --pipe -p EnvironmentFile=~/.shenron-neon.env \
 *     --working-directory=apps/shenron/shenron/bot \
 *     bun scripts/ingest-scans-couleur.ts [--appliquer]
 *
 * Simulation par défaut. `--appliquer` écrit.
 */
import postgres from "postgres";
import { join } from "node:path";

const URL_BASE = process.env.DATABASE_URL;
if (!URL_BASE) {
	console.error("✗ DATABASE_URL requis (voir ~/.shenron-neon.env, DERNIÈRE ligne ^DATABASE_URL=).");
	process.exit(1);
}

const appliquer = process.argv.includes("--appliquer");

/** Base publique de l'API du bot, qui sert la redirection vers le CDN. */
const API_PUBLIQUE = (process.env.SHENRON_PUBLIC_API_URL ?? "https://bot.dragonballfr.com").replace(
	/\/+$/,
	""
);

/** Série réservée aux chapitres couleur. */
const SERIE = "DBFC";

/**
 * Base des identifiants. `bot.db_manga_chapters.id` n'a NI défaut NI identité
 * (vérifié) : il faut les poser. Une base réservée et déterministe
 * (`20000 + numéro`) rend le script rejouable — un second passage met à jour
 * les mêmes lignes au lieu d'en créer 520 de plus.
 */
const ID_BASE = 20_000;
/** Le hors-série (« Trunks the story ») n'a pas de numéro de chapitre. */
const ID_HORS_SERIE = 20_999;

const RACINE_SCANS = join(import.meta.dir, "..", "data", "scans-forum");
const CHEMIN_MANIFESTE = join(RACINE_SCANS, "manifeste.json");
const CHEMIN_SALONS = join(import.meta.dir, "..", "data", "scans-couleur-salons.json");

interface PlancheManifeste {
	readonly ordre: number;
	readonly fichier: string;
	readonly url: string;
	readonly largeur?: number | null;
	readonly hauteur?: number | null;
}
interface FilManifeste {
	readonly id: string;
	readonly nom: string;
	readonly dossier: string;
	readonly tags?: readonly string[];
	readonly planches: readonly PlancheManifeste[];
}
interface Manifeste {
	readonly forumId: string;
	readonly fils: readonly FilManifeste[];
}

const sql = postgres(URL_BASE, { max: 2, prepare: false });
/**
 * `sql.json()` et jamais `JSON.stringify(x)::jsonb` : le driver type le
 * paramètre d'après le cast et réencode la chaîne, la colonne recevant alors un
 * scalaire. Le cast local contourne le refus des types de postgres-js sur les
 * tableaux, qu'il sérialise pourtant très bien.
 */
const jsonb = (valeur: unknown) => sql.json(valeur as Parameters<typeof sql.json>[0]);

/**
 * Le numéro de chapitre porté par un nom de fil.
 *
 * Tolérant aux trois coquilles relevées sur les 520 fils (« Chapitres 293 »,
 * « Chapiter 494 ») ; `null` pour le hors-série, qui n'a pas de numéro.
 */
function numeroDeFil(nom: string): number | null {
	const m = /^\s*chapit(?:re|er)s?\b[^\d]{0,4}(\d{1,3})(?!\d)/i.exec(nom);
	return m ? Number(m[1]) : null;
}

/** Le titre du chapitre, débarrassé de son préfixe et de ses guillemets. */
function titreDeFil(nom: string): string {
	const sansPrefixe = nom.replace(/^\s*chapit(?:re|er)s?\b[^:]*:\s*/i, "").trim();
	return (sansPrefixe || nom).replace(/^["«»\s]+|["«»\s]+$/g, "").trim();
}

/** Le rattachement chapitre → tome, lu dans les sommaires OCR des 42 tomes. */
async function rattachementMesure(): Promise<{
	tomeDe: Map<number, string>;
	conflits: string[];
}> {
	const lignes = await sql<{ tome: string; text: string | null }[]>`
		select tome, text from bot.db_manga_pages
		where series = 'DB' and tome like 'vol%' and planche <= 6`;

	const tomeDe = new Map<number, string>();
	const conflits: string[] = [];
	for (const ligne of lignes) {
		const texte = ligne.text ?? "";
		if (!/sommaire/i.test(texte)) continue;
		// « Chapitre 171 Le mariage de Son Goku Page 003 ». Le titre peut être
		// collé au numéro : pas de `\b`, une anti-classe de chiffre.
		for (const m of texte.matchAll(/chapitre\s*(\d{1,3})(?!\d)[^]*?page\s*(\d{1,4})(?!\d)/gi)) {
			const n = Number(m[1]);
			const deja = tomeDe.get(n);
			if (deja && deja !== ligne.tome) conflits.push(`chapitre ${n} : ${deja} vs ${ligne.tome}`);
			else if (!deja) tomeDe.set(n, ligne.tome);
		}
	}
	return { tomeDe, conflits };
}

/**
 * Ferme les trous laissés par l'OCR, et seulement eux.
 *
 * Un chapitre sans sommaire lisible n'est rattaché que si les deux tomes qui
 * l'encadrent sont le MÊME tome mesuré — c'est-à-dire s'il tombe strictement à
 * l'intérieur d'une plage déjà établie. Un chapitre coincé entre deux tomes
 * différents reste sans tome : rien ne permet de trancher.
 */
function fermeLesTrous(tomeDe: Map<number, string>, max: number): number[] {
	const ouverts: number[] = [];
	for (let n = 1; n <= max; n++) {
		if (tomeDe.has(n)) continue;
		let avant: string | undefined;
		let apres: string | undefined;
		for (let i = n - 1; i >= 1 && !avant; i--) avant = tomeDe.get(i);
		for (let i = n + 1; i <= max && !apres; i++) apres = tomeDe.get(i);
		if (avant && avant === apres) tomeDe.set(n, avant);
		else ouverts.push(n);
	}
	return ouverts;
}

async function main(): Promise<void> {
	const manifeste = (await Bun.file(CHEMIN_MANIFESTE).json()) as Manifeste;
	const fils = manifeste.fils ?? [];
	const totalPlanches = fils.reduce((s, f) => s + f.planches.length, 0);
	console.log(`[couleur] manifeste : ${fils.length} fils, ${totalPlanches} planches`);

	const { tomeDe, conflits } = await rattachementMesure();
	if (conflits.length) {
		console.log(`[couleur] ⚠ ${conflits.length} conflits de sommaire :`);
		for (const c of conflits) console.log(`  - ${c}`);
	}
	const maxChapitre = Math.max(...tomeDe.keys());
	const litsDirects = tomeDe.size;
	const ouverts = fermeLesTrous(tomeDe, maxChapitre);
	console.log(
		`[couleur] rattachement : ${litsDirects} chapitres lus dans un sommaire, ` +
			`${tomeDe.size - litsDirects} fermés par containment, ${ouverts.length} sans tome` +
			(ouverts.length ? ` (${ouverts.join(", ")})` : "")
	);

	// Le tome OCR (« vol12 ») vers la ligne réelle de db_manga_volumes.
	const tomes = await sql<{ id: string; volume_number: string }[]>`
		select id, volume_number from bot.db_manga_volumes where series = 'DB'`;
	const idDeTome = new Map<string, number>();
	for (const t of tomes) idDeTome.set(`vol${Number(t.volume_number)}`, Number(t.id));

	interface Chapitre {
		id: number;
		numero: number;
		titre: string;
		volumeId: number | null;
		pages: string[];
	}
	const chapitres: Chapitre[] = [];
	const ecartes: string[] = [];

	for (const fil of fils) {
		if (!fil.planches.length) {
			ecartes.push(`${fil.nom} — aucune planche`);
			continue;
		}
		const numero = numeroDeFil(fil.nom);
		if (numero === null) {
			// Le hors-série est conservé, sans tome : c'est une lecture réelle,
			// simplement pas un chapitre de la numérotation.
			ecartes.push(`${fil.nom} — pas de numéro de chapitre (rangé en hors-série)`);
		}
		const tome = numero === null ? undefined : tomeDe.get(numero);
		const volumeId = tome ? (idDeTome.get(tome) ?? null) : null;
		if (numero !== null && volumeId === null) {
			ecartes.push(`${fil.nom} — aucun tome mesuré`);
		}
		const pages = fil.planches
			.toSorted((a, b) => a.ordre - b.ordre)
			.map((p) => {
				// Le nom d'origine fait partie de l'URL à rafraîchir : on le reprend
				// du chemin de l'URL CDN, pas du nom de fichier local (qui est
				// renuméroté « 001-<id>.jpg » par le dump).
				const chemin = new URL(p.url).pathname.split("/");
				const pieceJointeId = chemin[3] ?? "";
				const fichier = chemin[4] ?? "";
				return `${API_PUBLIQUE}/api/public/manga/couleur/${fil.id}/${pieceJointeId}/${fichier}`;
			});
		chapitres.push({
			id: numero === null ? ID_HORS_SERIE : ID_BASE + numero,
			numero: numero ?? 0,
			titre: titreDeFil(fil.nom),
			volumeId,
			pages,
		});
	}

	// Deux fils qui viseraient le même identifiant s'écraseraient en silence à
	// l'`upsert` : on refuse d'écrire plutôt que de perdre un chapitre.
	const vus = new Map<number, string>();
	for (const c of chapitres) {
		const deja = vus.get(c.id);
		if (deja) {
			console.error(`✗ identifiant ${c.id} revendiqué deux fois : « ${deja} » et « ${c.titre} »`);
			process.exitCode = 1;
			await sql.end();
			return;
		}
		vus.set(c.id, c.titre);
	}

	const avecTome = chapitres.filter((c) => c.volumeId !== null).length;
	console.log(
		`[couleur] ${chapitres.length} chapitres prêts, ${avecTome} rattachés à un tome ` +
			`(${((avecTome / chapitres.length) * 100).toFixed(1)} %), ` +
			`${chapitres.reduce((s, c) => s + c.pages.length, 0)} planches`
	);
	if (ecartes.length) {
		console.log(`[couleur] non apparié / à l'écart (${ecartes.length}) :`);
		for (const e of ecartes) console.log(`  - ${e}`);
	}

	if (!appliquer) {
		const ex = chapitres[0];
		console.log("\n[couleur] SIMULATION — rien n'est écrit. Exemple :");
		console.log(`  id=${ex?.id} n°${ex?.numero} « ${ex?.titre} » tome=${ex?.volumeId}`);
		console.log(`  page 1 : ${ex?.pages[0]}`);
		console.log("  → relancer avec --appliquer");
		await sql.end();
		return;
	}

	// L'allowlist de la redirection : sans elle, la route serait un
	// rafraîchisseur d'URL Discord ouvert à tous.
	await Bun.write(CHEMIN_SALONS, JSON.stringify(fils.map((f) => f.id)));
	console.log(`[couleur] allowlist écrite (${fils.length} salons) → ${CHEMIN_SALONS}`);

	let ecrits = 0;
	for (const c of chapitres) {
		await sql`
			insert into bot.db_manga_chapters
				(id, series, chapter_number, title, volume_id, cover, pages, visible)
			values (${c.id}, ${SERIE}, ${c.numero}, ${c.titre}, ${c.volumeId},
				${c.pages[0] ?? null}, ${jsonb(c.pages)}, true)
			on conflict (id) do update set
				series = excluded.series, chapter_number = excluded.chapter_number,
				title = excluded.title, volume_id = excluded.volume_id,
				cover = excluded.cover, pages = excluded.pages`;
		ecrits++;
	}
	console.log(`[couleur] ✓ ${ecrits} chapitres écrits en base (série ${SERIE}).`);
	await sql.end();
}

await main();
