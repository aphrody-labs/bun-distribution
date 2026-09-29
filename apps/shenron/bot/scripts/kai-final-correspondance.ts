#!/usr/bin/env bun
/**
 * kai-final-correspondance.ts — Table « fiche Kai Final → épisode japonais »,
 * écrite dans `data/kai-final-correspondance.json`. Source unique pour tout ce
 * qui doit savoir QUEL épisode japonais une fiche DBZ_KAI_FINAL décrit.
 *
 * Le problème. La base suit le découpage international des Final Chapters
 * (70 fiches). La diffusion japonaise en compte 61, numérotées en continu 99→159
 * (« 98 » pour l'épisode inédit). voir-anime numérote Kai VF selon l'international
 * (1→167) et Kai VOSTFR selon le japonais (1→159). `import-kai-voiranime.ts` a
 * appliqué « 97 + n » aux deux : juste pour la VF, faux pour la VOSTFR.
 * Mesuré le 2026-09-13 par trace.moe : la VOSTFR de la fiche 40 montre Kai (2014)
 * ép. 39, sa VF l'ép. 32 — celui de son titre (similarité 0,936).
 *
 * La méthode, sans rien supposer :
 *   1. Titres de diffusion japonais lus dans ja.wikipedia « ドラゴンボール改 »
 *      (Wikipédia n'établit que la correspondance ; rien n'en est republié).
 *   2. Une fiche est appariée si son `title_ja` est identique et unique côté
 *      Wikipédia, et que son n° japonais n'est revendiqué par aucune autre fiche
 *      (quatre paires de titres dupliqués en base — signalement #15).
 *   3. On garde la plus longue sous-suite strictement croissante.
 *   4. Interpolation à pas ÉGAL seulement : entre deux ancrages (n1→J1) et
 *      (n2→J2) où n2 − n1 == J2 − J1, chaque fiche intermédiaire n'a qu'un seul
 *      épisode possible. Là où les écarts diffèrent, la base a scindé un épisode
 *      japonais en plusieurs fiches : aucune n'est placée.
 *   5. Dates de diffusion japonaise lues dans en.wikipedia « List of Dragon Ball
 *      Z Kai episodes » : l'épisode international N = 97 + n y porte la date de
 *      sa diffusion au Japon, ou aucune s'il n'y a pas été diffusé. Les 61 dates
 *      distinctes, triées, donnent 99→159. Elles doivent confirmer CHAQUE
 *      placement des étapes 1 à 4 — un seul désaccord et rien n'est écrit —, puis
 *      placent les fiches restantes dont l'épisode japonais est encore libre
 *      (titres dupliqués en base : 8→102, 10→103, 17→107 le 2026-09-13).
 *
 * Usage : bun apps/shenron/bot/scripts/kai-final-correspondance.ts   (DATABASE_URL requis)
 */
import postgres from "postgres";

const SORTIE = new URL("../data/kai-final-correspondance.json", import.meta.url).pathname;
const UA = "shenron-dragonballfr/1.0 (+https://dragonballfr.com)";
/** Épisodes de la diffusion japonaise des Final Chapters (99→159). */
const EPISODES_JP = 61;

type Entree = { n: number; id: number; jp: number; methode: "titre" | "interpolation" | "date" };

function cleTitreJa(t: string): string {
	return t
		.replace(/&amp;/g, "&")
		.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
		.replace(/<ref[^>]*>[\s\S]*?<\/ref>|<[^>]+>|\{\{[^}]*\}\}/g, "")
		.normalize("NFKC")
		.replace(/[\s\p{P}\p{S}]/gu, "");
}

async function wikitexte(hote: string, page: string): Promise<string> {
	const params = new URLSearchParams({
		action: "parse",
		page,
		prop: "wikitext",
		format: "json",
		formatversion: "2",
		redirects: "1",
	});
	const url = `https://${hote}/w/api.php?${params}`;
	const proc = Bun.spawn(["curl", "-sS", "-m", "40", "-A", UA, "--compressed", url], {
		stdout: "pipe",
		stderr: "ignore",
	});
	const texte = await new Response(proc.stdout).text();
	await proc.exited;
	return (JSON.parse(texte) as { parse?: { wikitext?: string } }).parse?.wikitext ?? "";
}

const parTitre = new Map<string, number[]>();
for (const m of (await wikitexte("ja.wikipedia.org", "ドラゴンボール改")).matchAll(
	/style="text-align:right;"\|(\d{1,3})(?:<br\s*\/?>[^|]*)?\|\|([^|\n]+)\|\|/g
)) {
	const cle = cleTitreJa(m[2]);
	if (cle.length >= 5) parTitre.set(cle, [...(parTitre.get(cle) ?? []), Number(m[1])]);
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL requis");
const sql = postgres(url, { max: 1 });
const fiches = await sql<{ id: number; n: number; title_ja: string | null }[]>`
	select id, number_in_series as n, title_ja from bot.db_episodes where series = 'DBZ_KAI_FINAL' order by number_in_series`;
await sql.end();

const nonApparies = new Map<number, string>();
const paires: { n: number; id: number; jp: number }[] = [];
for (const f of fiches) {
	const numeros = f.title_ja ? parTitre.get(cleTitreJa(f.title_ja)) : undefined;
	if (!numeros)
		nonApparies.set(Number(f.n), f.title_ja ? "titre absent de Wikipédia" : "title_ja vide");
	else if (numeros.length > 1) nonApparies.set(Number(f.n), "titre ambigu");
	else paires.push({ n: Number(f.n), id: Number(f.id), jp: numeros[0] });
}
const revendications = new Map<number, number[]>();
for (const p of paires) revendications.set(p.jp, [...(revendications.get(p.jp) ?? []), p.n]);
const uniques = paires.filter((p) => {
	const qui = revendications.get(p.jp) ?? [];
	if (qui.length > 1)
		nonApparies.set(
			p.n,
			`titre dupliqué en base (n° JP ${p.jp} aussi sur ${qui.filter((x) => x !== p.n).join("/")})`
		);
	return qui.length === 1;
});
const longueur = uniques.map(() => 1);
const precedent = uniques.map(() => -1);
for (let i = 0; i < uniques.length; i++)
	for (let j = 0; j < i; j++)
		if (uniques[j].jp < uniques[i].jp && longueur[j] + 1 > longueur[i]) {
			longueur[i] = longueur[j] + 1;
			precedent[i] = j;
		}
const chaine: typeof uniques = [];
for (let k = longueur.indexOf(Math.max(0, ...longueur)); k >= 0; k = precedent[k])
	chaine.unshift(uniques[k]);
for (const p of uniques)
	if (!chaine.includes(p)) nonApparies.set(p.n, `hors de la suite croissante (→ ${p.jp})`);

const entrees: Entree[] = chaine.map((p) => ({ ...p, methode: "titre" as const }));
const idParN = new Map(fiches.map((f) => [Number(f.n), Number(f.id)]));
for (let i = 0; i + 1 < chaine.length; i++) {
	const a = chaine[i];
	const b = chaine[i + 1];
	if (b.n - a.n > 1 && b.n - a.n === b.jp - a.jp) {
		for (let n = a.n + 1; n < b.n; n++) {
			entrees.push({
				n,
				id: idParN.get(n) as number,
				jp: a.jp + (n - a.n),
				methode: "interpolation",
			});
			nonApparies.delete(n);
		}
	}
}

// 5. Dates de diffusion japonaise : recoupement, puis placement des fiches restantes.
const dateParN = new Map<number, string>();
for (const m of (
	await wikitexte("en.wikipedia.org", "List of Dragon Ball Z Kai episodes")
).matchAll(/\{\{Episode list([\s\S]*?)\n\}\}/g)) {
	const champ = (k: string) =>
		m[1].match(new RegExp(`\\|\\s*${k}\\s*=\\s*([^\\n]*)`))?.[1]?.trim() ?? "";
	const N = Number(champ("EpisodeNumber").replace(/\D.*$/, ""));
	const d = champ("OriginalAirDate").match(/Start date\|(\d{4})\|(\d{1,2})\|(\d{1,2})/);
	if (N >= 99 && N <= 97 + fiches.length && d)
		dateParN.set(N, `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}`);
}
const datesJp = [...new Set(dateParN.values())].toSorted();
if (datesJp.length !== EPISODES_JP || dateParN.size !== EPISODES_JP) {
	throw new Error(
		`en.wikipedia : ${dateParN.size} épisodes datés pour ${datesJp.length} dates distinctes, ${EPISODES_JP} attendus — rien n'est écrit`
	);
}
const jpParDate = (n: number): number | undefined => {
	if (n + 97 === 98) return 98; // l'inédit, hors diffusion numérotée
	const d = dateParN.get(n + 97);
	return d ? 99 + datesJp.indexOf(d) : undefined;
};
const desaccords = entrees
	.filter((e) => jpParDate(e.n) !== e.jp)
	.map((e) => `${e.n}→${e.jp} (${e.methode}) ≠ ${jpParDate(e.n) ?? "non diffusé au Japon"}`);
if (desaccords.length)
	throw new Error(
		`titres et dates de diffusion en désaccord, rien n'est écrit : ${desaccords.join(" | ")}`
	);
const placeeSur = new Map(entrees.map((e) => [e.jp, e.n]));
for (const [n, raison] of nonApparies) {
	const jp = jpParDate(n);
	if (jp === undefined)
		nonApparies.set(
			n,
			`${raison} · épisode international ${n + 97} non diffusé au Japon (en.wikipedia)`
		);
	else if (placeeSur.has(jp))
		nonApparies.set(n, `${raison} · date → n° JP ${jp}, déjà sur la fiche ${placeeSur.get(jp)}`);
	else {
		entrees.push({ n, id: idParN.get(n) as number, jp, methode: "date" });
		placeeSur.set(jp, n);
		nonApparies.delete(n);
	}
}
entrees.sort((x, y) => x.n - y.n);
const rupture = entrees.find((e, i) => i > 0 && e.jp <= entrees[i - 1].jp);
if (rupture)
	throw new Error(
		`suite non croissante à la fiche ${rupture.n} (→ ${rupture.jp}) — rien n'est écrit`
	);

const precedente = (await Bun.file(SORTIE)
	.json()
	.catch(() => null)) as { entrees?: Entree[]; lecteursRealignes?: boolean } | null;
const identique = JSON.stringify(precedente?.entrees ?? null) === JSON.stringify(entrees);
const doc = {
	description: "Fiche DBZ_KAI_FINAL (découpage international) → n° de diffusion japonais (98→159)",
	source:
		"ja.wikipedia « ドラゴンボール改 » (titres de diffusion) + interpolation à pas égal, recoupés et complétés par en.wikipedia « List of Dragon Ball Z Kai episodes » (dates de diffusion japonaise)",
	verifications:
		"trace.moe 2026-09-13 : fiche 40 VF → Kai (2014) ép. 32 ; VOSTFR fiches 12/18/40 → ép. 11/17/39 (= 97 + n, décalage de l'import)",
	genere: new Date().toISOString(),
	lecteursRealignes: identique ? (precedente?.lecteursRealignes ?? false) : false,
	entrees,
	nonApparies: [...nonApparies.entries()]
		.toSorted((x, y) => x[0] - y[0])
		.map(([n, raison]) => ({ n, id: idParN.get(n), raison })),
};
await Bun.write(SORTIE, `${JSON.stringify(doc, null, "\t")}\n`);
const parMethode = (m: Entree["methode"]) => entrees.filter((e) => e.methode === m);
console.log(
	`${entrees.length} fiches placées (${parMethode("titre").length} par titre, ${parMethode("interpolation").length} par interpolation, ${parMethode("date").length} par date) · ${doc.nonApparies.length} non placées · ${entrees.length - parMethode("date").length} placements confirmés par les dates`
);
console.log(
	"interpolées :",
	parMethode("interpolation")
		.map((e) => `${e.n}→${e.jp}`)
		.join(" ")
);
console.log(
	"par date :",
	parMethode("date")
		.map((e) => `${e.n}→${e.jp}`)
		.join(" ") || "∅"
);
console.log("non placées :", doc.nonApparies.map((x) => x.n).join(","));
console.log(
	`lecteursRealignes : ${doc.lecteursRealignes}${identique ? "" : " (table modifiée — relancer kai-final-realigner-vostfr.ts)"}`
);
console.log(`→ ${SORTIE}`);
