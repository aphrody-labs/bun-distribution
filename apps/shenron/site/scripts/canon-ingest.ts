#!/usr/bin/env bun
/**
 * Ingestion continue du corpus de canonicité → `public.canon_references`.
 *
 * Remplace `canon-charge-aphrody.ts` et `canon-charge-planches.ts`, qui
 * écrivaient les citations dans le blob JSON de `CanonConfig` (plafonné à 120
 * planches pour ne pas noyer l'éditeur). Ici chaque preuve est une LIGNE :
 * la page, l'API `/api/canon`, le MCP et l'éditeur lisent la table ; la
 * doctrine (rangs, règles, sujets tranchés) reste dans `CanonConfig`.
 *
 * Sources ingérées, toutes hébergées, aucune requête sortante :
 *   - `aphrody`   : déclarations d'Akira Toriyama du corpus local `.aphrody`
 *                   (interviews Daizenshuu, introductions des tankōbon, SEG…),
 *                   garde-fou `REFUSÉ` contre tout miroir de wiki de fans ;
 *   - `databooks` : toutes les planches de databooks transcrites ET traduites
 *                   (`bot.db_databooks.pages[].text_fr`), sans plafond ;
 *   - `manuel`    : saisies dans `/admin/canon` — jamais touchées ici.
 *
 * Idempotent : l'identifiant est stable, un `hash` du contenu évite les
 * réécritures inutiles ; une référence qui disparaît de sa source est masquée
 * (`visible=false`), jamais supprimée. Chaque passage laisse une ligne dans
 * `canon_ingest_runs`.
 *
 * Usage :
 *   bun scripts/canon-ingest.ts                  # une passe, toutes sources
 *   bun scripts/canon-ingest.ts --source databooks
 *   bun scripts/canon-ingest.ts --boucle [--intervalle 900]   # service 24h/24
 *   bun scripts/canon-ingest.ts --simuler        # rapport sans écriture
 */
import postgres from "postgres";
import { join } from "node:path";
import { homedir } from "node:os";
import { readdir } from "node:fs/promises";
import { slugCanon, type CanonReference } from "../src/lib/canon-engine";
import { defautCertain } from "../src/lib/databooks-audit-traductions";
import { DOCUMENTS, PARSEURS, REFUSÉ, motsCles, normaliser } from "./_aphrody-corpus";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, def?: string) => {
	const i = args.indexOf(`--${n}`);
	return i >= 0 ? (args[i + 1] ?? def) : def;
};
const SIMULER = flag("simuler");
const BOUCLE = flag("boucle");
const INTERVALLE = Math.max(60, Number(opt("intervalle", "900")) || 900);
const SOURCE = opt("source", "toutes")!;

type Provenance = "aphrody" | "databooks" | "manga";

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	// La DERNIÈRE : `.env` porte l'ancienne URL Neon en commentaire AVANT la locale.
	const valeur = texte
		.split("\n")
		.filter((l) => l.startsWith("DATABASE_URL="))
		.at(-1)
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) throw new Error("DATABASE_URL introuvable");
	return valeur;
}

async function corpusDir(): Promise<string | null> {
	const candidats = [
		process.env.APHRODY_HOME,
		join(homedir(), ".aphrody", "workspace"),
		join(homedir(), ".aphrody", "workspaces", "dbfr"),
	].filter((c): c is string => Boolean(c));
	for (const base of candidats) {
		if (await Bun.file(join(base, "ai.json")).exists()) return join(base, "memory");
	}
	return null;
}

const sql = postgres(await urlBase(), { max: 2, prepare: false });

/** Le lexique d'appariement : les entités que le wiki connaît réellement. */
async function lexiqueWiki(): Promise<string[]> {
	const entites = (await sql`
		select name from bot.db_characters where visible = true and length(name) >= 4
		union
		select name from bot.db_planets where visible = true and length(name) >= 4
		union
		select name from bot.db_races where visible = true and length(name) >= 4
		union
		select name from bot.db_techniques where visible = true and length(name) >= 4 and name_ja is not null
	`) as unknown as { name: string }[];
	const EXCLU = new Set([
		"king", "north", "west", "east", "south", "great", "grand", "monde", "terre",
		"dieu", "dieux", "demon", "time", "name", "kaio", "namek",
	]);
	return [...new Set(entites.map((e) => e.name.trim()))]
		.filter((n) => n.length >= 4 && !/\d/.test(n) && !EXCLU.has(normaliser(n)))
		.toSorted((a, b) => b.length - a.length);
}

function coupePropre(texte: string, maximum: number): string {
	if (texte.length <= maximum) return texte;
	const morceau = texte.slice(0, maximum);
	const fin = Math.max(morceau.lastIndexOf(". "), morceau.lastIndexOf("! "), morceau.lastIndexOf("? "));
	return fin > maximum * 0.5 ? `${morceau.slice(0, fin + 1)} …` : `${morceau.trimEnd()} …`;
}

function texteDePlanche(brut: string): string {
	return brut
		.split("\n")
		.map((l) => l.replace(/^#{1,6}\s*/, "").replace(/^[-*]\s+/, "· ").trimEnd())
		.filter((l, i, all) => l !== "" || all[i - 1] !== "")
		.join("\n")
		.slice(0, 1200)
		.trim();
}

function hashDe(r: CanonReference): string {
	const h = new Bun.CryptoHasher("sha1");
	h.update(
		[r.subject, r.text, r.textFr ?? "", r.source, r.year ?? "", r.href ?? "", r.keywords.join("|")].join(" ")
	);
	return h.digest("hex");
}

// ── Collecte ────────────────────────────────────────────────────────────────

async function collecteAphrody(lexique: string[]): Promise<CanonReference[]> {
	const memoire = await corpusDir();
	if (!memoire) {
		console.warn("corpus .aphrody introuvable, source ignorée");
		return [];
	}
	const fichiers = await readdir(memoire);
	const out: CanonReference[] = [];
	const vus = new Set<string>();
	for (const doc of DOCUMENTS) {
		const fichier = fichiers.find((f) => f.startsWith(doc.motif) && f.endsWith(".md"));
		if (!fichier || REFUSÉ.test(fichier)) continue;
		const md = await Bun.file(join(memoire, fichier)).text();
		for (const extrait of doc.parseurs.flatMap((p) => PARSEURS[p](md))) {
			const texte = coupePropre(extrait.texte, 1800);
			const cles = motsCles(extrait.sujet, texte, lexique);
			if (cles.length === 0) continue;
			const empreinte = normaliser(texte).slice(0, 120);
			if (vus.has(empreinte)) continue;
			vus.add(empreinte);
			const annee = extrait.annee ?? doc.annee;
			const source = (
				!extrait.precision
					? doc.source
					: normaliser(extrait.precision).startsWith(normaliser(doc.source.split(" ")[0]!))
						? extrait.precision
						: `${doc.source} — ${extrait.precision}`
			).slice(0, 300);
			const subject = extrait.sujet.slice(0, 300);
			out.push({
				// Même identifiant que l'ancien blob (slug du sujet) : les traductions
				// versionnées dans `inventaires/canon-citations-fr.json` se réattachent.
				id: slugCanon(subject, `reference-${out.length + 1}`),
				subject,
				keywords: cles,
				text: texte,
				source,
				...(annee ? { year: annee } : {}),
				document: fichier,
				lang: doc.lang,
				provenance: "aphrody",
			});
		}
	}
	// Deux extraits peuvent partager un sujet : suffixe déterministe.
	const parId = new Map<string, number>();
	for (const r of out) {
		const n = (parId.get(r.id) ?? 0) + 1;
		parId.set(r.id, n);
		if (n > 1) r.id = `${r.id}-${n}`;
	}
	// Les traductions relues et versionnées : par identifiant, sinon par texte.
	const versionnees = (await Bun.file(join(import.meta.dir, "inventaires", "canon-citations-fr.json"))
		.json()
		.catch(() => [])) as { id: string; text: string; textFr: string }[];
	const parTexte = new Map(versionnees.map((m) => [normaliser(m.text).slice(0, 120), m.textFr]));
	const parIdFr = new Map(versionnees.map((m) => [m.id, m.textFr]));
	for (const r of out) {
		const fr = parIdFr.get(r.id) ?? parTexte.get(normaliser(r.text).slice(0, 120));
		if (fr && fr.length / Math.max(r.text.length, 1) >= 0.6) r.textFr = fr;
	}
	return out;
}

async function collecteDatabooks(lexique: string[]): Promise<CanonReference[]> {
	const planches = (await sql`
		select d.id, d.title, (p->>'number')::int as numero, p->>'text' as texte,
		       p->>'text_fr' as texte_fr, coalesce((p->>'verifiee')::bool, false) as verifiee
		from bot.db_databooks d, jsonb_array_elements(d.pages) p
		where d.visible and coalesce(p->>'text_fr', '') <> '' and length(p->>'text_fr') >= 120
	`) as unknown as {
		id: number;
		title: string;
		numero: number;
		texte: string | null;
		texte_fr: string;
		verifiee: boolean;
	}[];
	const out: CanonReference[] = [];
	for (const p of planches) {
		if (!Number.isFinite(p.numero)) continue;
		// Garde-fou : une traduction portant un défaut CERTAIN (jeton de masquage
		// non réinjecté, copie de la source japonaise) n'est jamais publiée comme
		// preuve de canon — elle reste masquée même si un écrivain la redépose.
		if (defautCertain(p.texte_fr, p.texte ?? "")) continue;
		const sujet = `${p.title} — planche ${p.numero}`;
		// Les mots-clés se tirent de la TRADUCTION : les questions arrivent en français.
		const cles = motsCles(sujet, texteDePlanche(p.texte_fr), lexique);
		if (cles.length === 0) continue;
		out.push({
			id: `planche-${p.id}-${p.numero}`,
			subject: sujet,
			keywords: cles,
			text: texteDePlanche(p.texte ?? p.texte_fr),
			...(p.texte ? { textFr: texteDePlanche(p.texte_fr) } : {}),
			source: `${p.title}, planche ${p.numero}${p.verifiee ? " (transcription relue)" : ""}`,
			document: p.title,
			lang: p.texte ? "ja" : "fr",
			provenance: "databooks",
			href: `/wiki/databooks/${p.id}#planche-${p.numero}`,
		});
	}
	return out;
}

async function collecteManga(lexique: string[]): Promise<CanonReference[]> {
	const out: CanonReference[] = [];

	// 1. Les 66 tomes du manga (42 Dragon Ball originaux + 24 Dragon Ball Super)
	const volumes = (await sql`
		select id, series, volume_number, title, title_ja, published_at, cover
		from bot.db_manga_volumes
		where visible
		order by series, volume_number
	`) as unknown as {
		id: number;
		series: string;
		volume_number: number;
		title: string | null;
		title_ja: string | null;
		published_at: number | null;
		cover: string | null;
	}[];

	for (const v of volumes) {
		const isDb = v.series === "DB";
		const nomSerie = isDb ? "Dragon Ball" : "Dragon Ball Super";
		const titreAffiche = v.title || v.title_ja || `Tome ${v.volume_number}`;
		const sujet = `${nomSerie} Tome ${v.volume_number} — ${titreAffiche}`;
		const baseCles = [
			`tome ${v.volume_number}`,
			`volume ${v.volume_number}`,
			`vol ${v.volume_number}`,
			`vol. ${v.volume_number}`,
			isDb ? "manga dragon ball" : "manga dragon ball super",
		];
		const clesTexte = motsCles(sujet, titreAffiche, lexique);
		const cles = [...new Set([...baseCles, ...clesTexte])];
		const annee = v.published_at ? new Date(Number(v.published_at) * 1000).getFullYear() : undefined;

		out.push({
			id: `manga-vol-${v.series.toLowerCase()}-${v.volume_number}`,
			subject: sujet,
			keywords: cles,
			text: v.title_ja || v.title || sujet,
			...(v.title ? { textFr: `${nomSerie} Tome ${v.volume_number} : ${v.title}` } : {}),
			source: `Manga ${nomSerie} Tome ${v.volume_number} (${isDb ? "Akira Toriyama" : "Toyotaro & Akira Toriyama"}, Shueisha)`,
			...(annee ? { year: annee } : {}),
			document: isDb ? "Dragon Ball (manga original 42 tomes)" : "Dragon Ball Super (Jump Comics)",
			lang: v.title_ja ? "ja" : "fr",
			provenance: "manga",
			href: `/wiki/manga/volume/${v.id}`,
		});
	}

	// 2. Les chapitres manga du canon (520 chapitres DB Full Color + 103 chapitres DBS)
	const chapitres = (await sql`
		select id, series, chapter_number, title, title_ja, volume_id, published_at, cover
		from bot.db_manga_chapters
		where visible and ((series = 'DBFC' and coalesce(title, '') <> '') or (series = 'DBS' and coalesce(title, '') <> ''))
		order by series, chapter_number
	`) as unknown as {
		id: number;
		series: string;
		chapter_number: number;
		title: string;
		title_ja: string | null;
		volume_id: number | null;
		published_at: number | null;
		cover: string | null;
	}[];

	// Repères canoniques clés pour injecter des mots-clés de doctrine
	const REPERES_CANON: Record<number, string[]> = {
		1: ["bulma", "rencontre goku bulma", "nyoibo", "dragon ball"],
		195: ["raditz", "scouter", "saiyan", "kakarotto", "fermier au fusil"],
		199: ["vetements lourds", "makankosappo", "piccolo goku"],
		201: ["mort de goku", "sacrifice goku", "raditz", "makankosappo"],
		214: ["saibaimen", "saibaiman", "mort de yamcha"],
		224: ["over 8000", "plus de 8000", "retour de goku"],
		228: ["goku contre vegeta", "galick ho", "kaio-ken x3", "kaio-ken x4"],
		233: ["oozaru vegeta", "grand singe vegeta", "queue de saiyan"],
		249: ["kiwi", "vegeta 24000", "zenkai"],
		284: ["ginyu", "capitaine ginyu 120000", "goku kaio-ken 180000"],
		286: ["freezer premiere forme 530000", "nail 42000"],
		296: ["freezer deuxieme forme", "un million de puissance"],
		307: ["bardock", "flashback bardock", "pere de goku", "case bardock manga"],
		315: ["kaio-ken x20", "kamehameha kaio-ken x20"],
		317: ["super saiyan", "eveil super saiyan", "mort de krilin", "goku super saiyan namek"],
		330: ["trunks du futur", "mecha freezer", "roi cold", "epee de trunks"],
		415: ["kamehameha pere fils", "gohan ssj2", "mort de cell", "cell parfait"],
		450: ["kiri", "unite kiri", "yakon", "babidi", "goku ssj2 kiri"],
		452: ["dabra", "gohan contre dabra"],
		503: ["potara", "boucles potaras", "vieux kaioshin"],
		504: ["vegetto", "fusion potara", "papa fusionne le plus fort"],
		516: ["genkidama final", "mort de kid buu", "mort de kid boo"],
		519: ["uub", "oob", "bye bye dragon world", "fin du manga original"],
	};

	const REPERES_DBS: Record<number, string[]> = {
		6: ["zalama", "super dragon balls", "chant des dieux", "zunama"],
		7: ["super shenron", "tournoi univers 6"],
		19: ["zamasu", "goku black"],
		42: ["fin tournoi pouvoir", "jiren", "c17 voeu"],
		66: ["uub", "oob", "ki divin uub", "moro", "grand kaioshin"],
		87: ["black freezer", "gas", "granolah", "mort d elec"],
		88: ["super hero arc", "goten trunks super heros"],
		103: ["gohan beast vs goku ui", "heritage toriyama toyotaro"],
	};

	for (const c of chapitres) {
		const isDb = c.series === "DBFC";
		const nomSerie = isDb ? "Dragon Ball" : "Dragon Ball Super";
		const sujet = `${nomSerie} Chapitre ${c.chapter_number} — ${c.title}`;
		const baseCles = [
			`chapitre ${c.chapter_number}`,
			`ch ${c.chapter_number}`,
			`ch. ${c.chapter_number}`,
			`chapitre ${c.chapter_number} manga`,
			isDb ? "manga dragon ball" : "manga dragon ball super",
		];
		const reperes = isDb ? REPERES_CANON[c.chapter_number] : REPERES_DBS[c.chapter_number];
		const clesSujet = motsCles(sujet, c.title, lexique);
		const cles = [...new Set([...baseCles, ...(reperes ?? []), ...clesSujet])];

		let annee: number | undefined;
		if (c.published_at) {
			annee = new Date(Number(c.published_at) * 1000).getFullYear();
		} else if (isDb) {
			annee =
				c.chapter_number <= 194
					? 1984 + Math.floor(c.chapter_number / 40)
					: 1989 + Math.floor((c.chapter_number - 195) / 50);
		} else {
			annee = 2015 + Math.floor(c.chapter_number / 12);
		}

		out.push({
			id: `manga-chap-${isDb ? "db" : "dbs"}-${c.chapter_number}`,
			subject: sujet,
			keywords: cles,
			text: c.title_ja || c.title,
			...(c.title ? { textFr: `${nomSerie} Chapitre ${c.chapter_number} : ${c.title}` } : {}),
			source: `Manga ${nomSerie} Chapitre ${c.chapter_number} (${isDb ? "Akira Toriyama" : "Toyotaro & Akira Toriyama"}, Shueisha)`,
			...(annee ? { year: annee } : {}),
			document: isDb ? "Dragon Ball (manga original)" : "Dragon Ball Super (manga)",
			lang: c.title_ja ? "ja" : "fr",
			provenance: "manga",
			href: `/wiki/manga/${c.id}`,
		});
	}

	return out;
}

// ── Écriture ────────────────────────────────────────────────────────────────

interface Bilan {
	inserted: number;
	updated: number;
	unchanged: number;
	hidden: number;
}

async function ecrire(provenance: Provenance, refs: CanonReference[]): Promise<Bilan> {
	const bilan: Bilan = { inserted: 0, updated: 0, unchanged: 0, hidden: 0 };
	const existants = new Map(
		(
			(await sql`
				select id, hash, visible from public.canon_references where provenance = ${provenance}
			`) as unknown as { id: string; hash: string; visible: boolean }[]
		).map((r) => [r.id, r])
	);
	const ids = new Set<string>();
	for (const r of refs) {
		ids.add(r.id);
		const hash = hashDe(r);
		const avant = existants.get(r.id);
		if (avant && avant.hash === hash && avant.visible) {
			bilan.unchanged++;
			continue;
		}
		if (SIMULER) {
			if (avant) bilan.updated++;
			else bilan.inserted++;
			continue;
		}
		// Une traduction posée à la main sur une citation aphrody survit tant que
		// le texte source n'a pas bougé (même hash) ; sinon elle est abandonnée.
		await sql`
			insert into public.canon_references
				(id, subject, keywords, text, text_fr, source, year, document, lang, provenance, href, hash, visible, seen_at, updated_at)
			values (${r.id}, ${r.subject}, ${sql.json(r.keywords)}, ${r.text}, ${r.textFr ?? null}, ${r.source},
			        ${r.year ?? null}, ${r.document}, ${r.lang}, ${provenance}, ${r.href ?? null}, ${hash}, true, now(), now())
			on conflict (id) do update set
				subject = excluded.subject, keywords = excluded.keywords, text = excluded.text,
				text_fr = coalesce(excluded.text_fr,
					case when public.canon_references.text = excluded.text then public.canon_references.text_fr else null end),
				source = excluded.source, year = excluded.year, document = excluded.document, lang = excluded.lang,
				href = excluded.href, hash = excluded.hash, visible = true, seen_at = now(), updated_at = now()
		`;
		if (avant) bilan.updated++;
		else bilan.inserted++;
	}
	const disparus = [...existants.values()].filter((e) => e.visible && !ids.has(e.id)).map((e) => e.id);
	bilan.hidden = disparus.length;
	if (!SIMULER && disparus.length > 0) {
		await sql`update public.canon_references set visible = false, updated_at = now() where id = any(${disparus})`;
	}
	if (!SIMULER && bilan.unchanged > 0) {
		await sql`update public.canon_references set seen_at = now() where provenance = ${provenance} and id = any(${[...ids]})`;
	}
	return bilan;
}

/**
 * Première passe : les citations aphrody/databooks encore rangées dans le blob
 * de `CanonConfig` en sont retirées (elles vivent désormais en table). Les
 * traductions manuelles qu'elles portaient sont reportées sur la ligne.
 */
async function migrerBlob(): Promise<void> {
	const [ligne] = (await sql`
		select data from public."CanonConfig" where id = 'default'
	`) as unknown as { data: { references?: CanonReference[] } }[];
	const refs = ligne?.data?.references ?? [];
	const anciennes = refs.filter((r) => r.provenance !== "manuel");
	if (anciennes.length === 0) return;
	if (SIMULER) {
		console.log(`  ${anciennes.length} citations du blob à migrer`);
		return;
	}
	let reportees = 0;
	for (const r of anciennes) {
		if (!r.textFr) continue;
		const res = await sql`
			update public.canon_references set text_fr = ${r.textFr}, updated_at = now()
			where id = ${r.id} and text_fr is null
		`;
		reportees += res.count;
	}
	const manuelles = refs.filter((r) => r.provenance === "manuel");
	await sql`
		update public."CanonConfig"
		set data = jsonb_set(data, '{references}', ${sql.json(manuelles as unknown as Parameters<typeof sql.json>[0])}),
		    "updatedBy" = 'canon-ingest', "updatedAt" = now()
		where id = 'default'
	`;
	console.log(
		`  blob CanonConfig allégé : ${anciennes.length} citations retirées, ${manuelles.length} manuelles conservées, ${reportees} traductions reportées`
	);
}

async function passe(): Promise<void> {
	const lexique = await lexiqueWiki();
	const sources: Provenance[] =
		SOURCE === "toutes" ? ["aphrody", "databooks", "manga"] : [SOURCE as Provenance];
	for (const source of sources) {
		const [run] = SIMULER
			? [{ id: 0 }]
			: ((await sql`insert into public.canon_ingest_runs (source) values (${source}) returning id`) as unknown as {
					id: number;
				}[]);
		try {
			const refs =
				source === "aphrody"
					? await collecteAphrody(lexique)
					: source === "databooks"
						? await collecteDatabooks(lexique)
						: await collecteManga(lexique);
			const b = await ecrire(source, refs);
			console.log(
				`[${new Date().toISOString()}] ${source}: ${refs.length} lues, +${b.inserted} ~${b.updated} =${b.unchanged} masquées ${b.hidden}${SIMULER ? " (simulation)" : ""}`
			);
			if (!SIMULER)
				await sql`
					update public.canon_ingest_runs
					set finished_at = now(), inserted = ${b.inserted}, updated = ${b.updated}, unchanged = ${b.unchanged}, hidden = ${b.hidden}
					where id = ${run!.id}
				`;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error(`✗ ${source}: ${msg}`);
			if (!SIMULER)
				await sql`update public.canon_ingest_runs set finished_at = now(), error = ${msg.slice(0, 2000)} where id = ${run!.id}`;
		}
	}
	await migrerBlob();
}

await passe();
if (BOUCLE) {
	console.log(`boucle active, intervalle ${INTERVALLE}s`);
	let stop = false;
	process.on("SIGTERM", () => {
		stop = true;
	});
	process.on("SIGINT", () => {
		stop = true;
	});
	while (!stop) {
		await Bun.sleep(INTERVALLE * 1000);
		if (stop) break;
		await passe();
	}
}
await sql.end();
