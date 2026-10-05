#!/usr/bin/env bun
/**
 * Fills the empty metadata of `bot.db_games` — `title_ja`, `platforms`, `release_date`,
 * `developer`, `official_url` — from bxc scrapes of Wikipedia (EN, JA, FR) and of the
 * official sites.
 *
 * SIMULATION BY DEFAULT. Nothing is written without `--apply`. Empty cells only,
 * one `public.wiki_revisions` entry per game (see `_fill-meta.ts`).
 *
 * Matching is strict, because a mismatched game is worse than an empty cell. A row is
 * paired with an English article only when its title equals, once normalised, the label
 * or the target of exactly ONE entry of the navbox `Template:Dragon Ball video games` —
 * the navbox the short titles of this table (« Budokai », « Origins 2 ») come from. The
 * pairing must then be confirmed by the YEAR: the infobox release year has to match the
 * French list « Liste de jeux vidéo Dragon Ball » when the game is listed there, or else
 * a year cited by the row's own description. No year witness, no Wikipedia field.
 *
 *   release_date  earliest full date of the infobox (reprints / « The Best » excluded),
 *                 midnight UTC in seconds like the existing rows; refused when a partial
 *                 date (« June 1994 ») could be earlier.
 *   developer     infobox `developer`; must share a studio with the French list if listed.
 *   platforms     infobox `platforms`, each link mapped to the CSV abbreviations already
 *                 in use (`PS4,XBO,Switch,PC`). One unknown platform, and the cell stays
 *                 empty. Articles covering several titles (Supersonic Warriors 1 and 2)
 *                 give no platforms.
 *   title_ja      `{{nihongo}}` of the English lead, kept if ja.wikipedia has an article of
 *                 that exact title (its spelling then wins), or if the lead ties it to the
 *                 Japanese release. A value claimed by two games is dropped.
 *   official_url  `bxc recon` answered 200 and the page <title> names the game.
 *
 * Series articles (`Infobox video game series`) are never used: Budokai Tenkaichi 2, 3
 * and Tenkaichi Tag Team redirect to the series page and would all inherit its platforms.
 *
 * Scrape (bxc 0.9.11, under ~/.shenron-build-tmp/scrape/meta/games/):
 *   en-navbox.json     bxc wiki page https://en.wikipedia.org/w/index.php?title=Template:Dragon_Ball_video_games
 *   en/<Article>.json  bxc wiki page of each navbox entry (same URL form)
 *   fr-list-page.json  bxc wiki page https://fr.wikipedia.org/w/index.php?title=Liste_de_jeux_vidéo_Dragon_Ball
 *   stage2.json        bxc wiki search on ja.wikipedia for each Japanese title
 *   official.json      bxc recon --plain of each official-site candidate
 * `bxc wiki` needs the `/w/index.php?title=` form on Wikipedia: `/wiki/<Title>` makes it
 * query `/api.php`, which Wikipedia does not serve (measured 2026-09-12).
 *
 *   bun apps/shenron/site/scripts/fill-games-metadata.ts            # simulation
 *   bun apps/shenron/site/scripts/fill-games-metadata.ts --apply
 */
import {
	APPLY,
	applyChanges,
	connect,
	type FieldChange,
	isEmpty,
	printChanges,
	readScrape,
	type WikiPage,
} from "./_fill-meta";

type NavItem = { article: string; label: string };
type Stage2Entry = { article: string; titleJaEn: string | null; jaSearch: string[] };
type OfficialCheck = {
	label: string;
	url: string;
	status: number;
	finalUrl: string | null;
	title: string | null;
};
type FrList = { tableaux: { entetes: string[]; lignes: string[][] }[] };
type FrRow = { year: number; title: string; developer: string };
type GameRow = {
	id: number;
	title: string;
	title_ja: string | null;
	platforms: string | null;
	release_date: number | string | null;
	developer: string | null;
	description: string | null;
	official_url: string | null;
};

/** Wikipedia link target → abbreviation used by `db_games.platforms`. */
const PLATFORMS: Record<string, string> = {
	"PlayStation (console)": "PS1",
	PlayStation: "PS1",
	"PlayStation 2": "PS2",
	"PlayStation 3": "PS3",
	"PlayStation 4": "PS4",
	"PlayStation 5": "PS5",
	"PlayStation Portable": "PSP",
	"PlayStation Vita": "PS Vita",
	"Xbox (console)": "Xbox",
	Xbox: "Xbox",
	"Xbox 360": "X360",
	"Xbox One": "XBO",
	"Xbox Series X/S": "XSX",
	GameCube: "GameCube",
	Wii: "Wii",
	"Nintendo Switch": "Switch",
	"Nintendo Switch 2": "Switch 2",
	"Nintendo DS": "DS",
	"Nintendo 3DS": "3DS",
	"Game Boy": "GB",
	"Game Boy Color": "GBC",
	"Game Boy Advance": "GBA",
	"Super Nintendo Entertainment System": "SNES",
	"Nintendo Entertainment System": "NES",
	"Sega Saturn": "Saturn",
	"Sega Mega Drive": "Mega Drive",
	"PC Engine Super CD-ROM²": "PC Engine",
	"Microsoft Windows": "PC",
	Windows: "PC",
	"Arcade game": "Arcade",
	"Android (operating system)": "Android",
	iOS: "iOS",
	iPadOS: "iPadOS",
	"Google Stadia": "Stadia",
};
/** Platform names as they appear in the bold headings of an infobox `released` field. */
const PLATFORM_HEADINGS = new Set(
	[...Object.keys(PLATFORMS), ...Object.values(PLATFORMS), "Switch", "Arcade", "Stadia"].map((p) =>
		p.toLowerCase()
	)
);
const MONTHS = [
	"january",
	"february",
	"march",
	"april",
	"may",
	"june",
	"july",
	"august",
	"september",
	"october",
	"november",
	"december",
];

const latinKey = (s: string) =>
	s
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/\(video game\)/g, "")
		.replace(/[^a-z0-9]+/g, "");
const jaKey = (s: string) =>
	s
		.normalize("NFKC")
		.toLowerCase()
		.replace(/\s*\([^)]*\)\s*$/, "")
		.replace(/[\s:：・･\-‐－]/g, "");
const fileKey = (article: string) => article.replace(/[^\p{L}\p{N}]+/gu, "_");

/** Index just past the `}}` closing the template opened at `start`. */
function templateEnd(text: string, start: number): number {
	let depth = 0;
	for (let j = start; j < text.length; ) {
		if (text.startsWith("{{", j)) {
			depth++;
			j += 2;
		} else if (text.startsWith("}}", j)) {
			depth--;
			j += 2;
			if (depth === 0) return j;
		} else j++;
	}
	return text.length;
}

/** Top-level arguments of the template opened at `start` (index 0 is its name). */
function templateArgs(text: string, start: number): string[] {
	const inner = text.slice(start + 2, templateEnd(text, start) - 2);
	const args: string[] = [];
	let depth = 0;
	let current = "";
	for (let j = 0; j < inner.length; j++) {
		const two = inner.slice(j, j + 2);
		if (two === "{{" || two === "[[") {
			depth++;
			current += two;
			j++;
		} else if (two === "}}" || two === "]]") {
			depth--;
			current += two;
			j++;
		} else if (inner[j] === "|" && depth === 0) {
			args.push(current);
			current = "";
		} else current += inner[j];
	}
	args.push(current);
	return args;
}

/** Removes every `{{name…}}` template (nesting-aware) whose name matches. */
function dropTemplates(text: string, name: RegExp): string {
	let out = "";
	let i = 0;
	while (i < text.length) {
		const start = text.indexOf("{{", i);
		if (start === -1) {
			out += text.slice(i);
			break;
		}
		out += text.slice(i, start);
		const head = (text.slice(start + 2, start + 80).split(/[|}]/)[0] ?? "").trim();
		if (name.test(head)) i = templateEnd(text, start);
		else {
			out += "{{";
			i = start + 2;
		}
	}
	return out;
}

const stripNoise = (text: string) =>
	dropTemplates(
		text
			.replace(/<!--[\s\S]*?-->/g, "")
			.replace(/<ref[^>]*\/>/g, "")
			.replace(/<ref[\s\S]*?<\/ref>/g, ""),
		/^(efn|refn|sfn|cn|citation needed)$/i
	);

const cleanWiki = (s: string) =>
	s
		.replace(/\{\{\s*ruby\s*\|([^|}]+)\|[^}]*\}\}/gi, "$1")
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
		.replace(/\[\[([^\]]+)\]\]/g, "$1")
		.replace(/'{2,}/g, "")
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim();

type FoundDate = { y: number; m: number | null; d: number | null };

function datesIn(block: string): FoundDate[] {
	const text = block.replace(/\{\{\s*start date\s*\|([^}]*)\}\}/gi, (_all, a: string) => {
		const [y, m, d] = a.split("|").map((x) => x.trim());
		return `@${y ?? ""}-${m ?? ""}-${d ?? ""}@`;
	});
	const month = MONTHS.join("|");
	const re = new RegExp(
		`@(\\d{4})-(\\d{0,2})-(\\d{0,2})@|\\b(${month})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b|\\b(\\d{1,2})\\s+(${month}),?\\s+(\\d{4})\\b|\\b(${month})\\s+(\\d{4})\\b|(?<![\\d@-])(\\d{4})(?![\\d-])`,
		"gi"
	);
	const found: FoundDate[] = [];
	for (const m of text.matchAll(re)) {
		const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
		if (/^\s*(?:<small>)?\s*\([^)]*(best|reprint|greatest|re-?release|\bhd\b|remaster)/i.test(tail))
			continue;
		const mon = (name: string | undefined) => (name ? MONTHS.indexOf(name.toLowerCase()) + 1 : null);
		if (m[1]) found.push({ y: Number(m[1]), m: m[2] ? Number(m[2]) : null, d: m[3] ? Number(m[3]) : null });
		else if (m[4]) found.push({ y: Number(m[6]), m: mon(m[4]), d: Number(m[5]) });
		else if (m[7]) found.push({ y: Number(m[9]), m: mon(m[8]), d: Number(m[7]) });
		else if (m[10]) found.push({ y: Number(m[11]), m: mon(m[10]), d: null });
		else if (m[12]) found.push({ y: Number(m[12]), m: null, d: null });
	}
	return found.filter((f) => f.y >= 1980 && f.y <= 2035 && (f.m === null || (f.m >= 1 && f.m <= 12)));
}

/** Earliest full date, or null when a partial date could precede it. */
function earliestDate(found: FoundDate[]): { y: number; m: number; d: number } | null {
	const full = found
		.filter((f): f is { y: number; m: number; d: number } => f.m !== null && f.d !== null)
		.toSorted((a, b) => a.y - b.y || a.m - b.m || a.d - b.d);
	const first = full[0];
	if (!first) return null;
	for (const p of found) {
		if (p.m !== null && p.d !== null) continue;
		if (p.y < first.y) return null;
		if (p.y === first.y && (p.m === null || p.m <= first.m)) return null;
	}
	return first;
}

function parsePlatforms(raw: string): string | null {
	const text = stripNoise(raw);
	const links = [...text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1]!.trim());
	const leftover = text
		.replace(/\[\[[^\]]*\]\]/g, "")
		.replace(/\{\{\s*(ubl|unbulleted list|plainlist|flatlist)\s*\|?/gi, "")
		.replace(/<br\s*\/?>|[{}|,*\s]/gi, "");
	if (leftover.length > 0 || links.length === 0) return null;
	const out: string[] = [];
	for (const link of links) {
		const abbr = PLATFORMS[link];
		if (!abbr) return null;
		if (!out.includes(abbr)) out.push(abbr);
	}
	return out.join(",");
}

function cleanDeveloper(propre: string | undefined): string | null {
	if (!propre) return null;
	const value = propre
		.replace(/\s*·\s*/g, ", ")
		.replace(/\s*\/\s*/g, ", ")
		.replace(/\s+/g, " ")
		.replace(/^,\s*|,\s*$/g, "")
		.trim();
	return value && !/[{}|[\]]/.test(value) ? value : null;
}

const studioTokens = (s: string) =>
	s
		.split(/,|\/|·|&| et | and /i)
		.map(latinKey)
		.map((t) => t.replace(/(inc|corp|corporation|technologies|company|co|ltd)$/g, ""))
		.filter((t) => t.length >= 3);
const studiosAgree = (a: string, b: string) =>
	studioTokens(a).some((x) => studioTokens(b).some((y) => x === y || x.includes(y) || y.includes(x)));

/** First `{{nihongo}}` of the lead, with the text around it. */
function leadNihongo(wikitext: string): { en: string; ja: string; before: string; after: string } | null {
	// Footnotes are kept: the Japanese title often sits in `{{efn|Known in Japan as {{nihongo…}}}}`.
	const lead = dropTemplates(wikitext.split(/\n==[^=]/)[0] ?? "", /^(infobox|short description|use )/i)
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<ref[^>]*\/>/g, "")
		.replace(/<ref[\s\S]*?<\/ref>/g, "");
	const start = lead.search(/\{\{\s*nihongo(?: foot)?\s*\|/i);
	if (start === -1) return null;
	const args = templateArgs(lead, start);
	const en = cleanWiki(args[1] ?? "");
	const ja = cleanWiki(args[2] ?? "");
	if (!ja || !/[\p{Script=Katakana}\p{Script=Hiragana}\p{Script=Han}]/u.test(ja)) return null;
	return {
		en,
		ja,
		before: lead.slice(Math.max(0, start - 80), start),
		after: lead.slice(templateEnd(lead, start), templateEnd(lead, start) + 30),
	};
}

const sql = await connect();
try {
	const nav = await readScrape<WikiPage>("games/en-navbox.json");
	const items: NavItem[] = [
		...(nav.wikitext ?? "").matchAll(/^\s*\*\s*''\[\[([^\]|]+)(?:\|([^\]]+))?\]\]''/gm),
	].map((m) => ({ article: m[1]!.trim(), label: (m[2] ?? m[1]!).trim() }));
	const stage2 = new Map(
		(await readScrape<Stage2Entry[]>("games/stage2.json")).map((e) => [e.article, e])
	);
	const officials = await readScrape<OfficialCheck[]>("games/official.json");
	const frPage = await readScrape<FrList>("games/fr-list-page.json");
	const frRows: FrRow[] = (
		frPage.tableaux.find((t) => t.entetes.join("|") === "Année|Titre|Développeur|Éditeur|Genre|Plate-forme")
			?.lignes ?? []
	).map((l) => ({ year: Number(l[0]), title: l[1] ?? "", developer: l[2] ?? "" }));

	const rows = (await sql`
		select id, title, title_ja, platforms, release_date, developer, description, official_url
		from bot.db_games where visible order by id
	`) as unknown as GameRow[];

	// A navbox entry claimed by two rows pairs with neither.
	const claims = new Map<string, number>();
	const matchOf = (row: GameRow) =>
		items.filter((it) => latinKey(it.label) === latinKey(row.title) || latinKey(it.article) === latinKey(row.title));
	for (const row of rows) {
		const m = matchOf(row);
		if (m.length === 1) claims.set(m[0]!.article, (claims.get(m[0]!.article) ?? 0) + 1);
	}

	const changes: FieldChange[] = [];
	const notes: string[] = [];
	const titleJaSource = new Map<number, string>();

	for (const row of rows) {
		const needs = {
			title_ja: isEmpty(row.title_ja),
			platforms: isEmpty(row.platforms),
			release_date: row.release_date === null,
			developer: isEmpty(row.developer),
			official_url: isEmpty(row.official_url),
		};
		if (!Object.values(needs).some(Boolean)) continue;

		const after: Record<string, string | number> = {};
		const sources: string[] = [];
		const skipped: string[] = [];
		const matches = matchOf(row);
		const item = matches.length === 1 && claims.get(matches[0]!.article) === 1 ? matches[0]! : null;

		if (needs.official_url) {
			const label = item?.label ?? row.title;
			const nameKey = latinKey(item?.article ?? row.title);
			const ok = officials
				.filter((o) => o.label === label && o.status === 200 && o.finalUrl && o.title)
				.filter((o) => latinKey(o.title!).includes(nameKey))
				.toSorted((a, b) => Number(b.finalUrl!.includes("bandainamcoent.eu")) - Number(a.finalUrl!.includes("bandainamcoent.eu")));
			const taken = new Set(rows.map((r) => r.official_url).filter(Boolean));
			const pick = ok.find((o) => !taken.has(o.finalUrl));
			if (pick) {
				after.official_url = pick.finalUrl!;
				sources.push(`bxc recon ${pick.finalUrl} → 200 « ${pick.title} »`);
			} else skipped.push("official_url : aucun site officiel vérifié");
		}

		const wikiNeeds = needs.title_ja || needs.platforms || needs.release_date || needs.developer;
		if (wikiNeeds && !item) {
			skipped.push(matches.length > 1 ? "plusieurs articles du navbox" : "aucun article du navbox");
		} else if (wikiNeeds && item) {
			const page = await readScrape<WikiPage>(`games/en/${fileKey(item.article)}.json`).catch(() => null);
			const w = page?.wikitext ?? "";
			const lead = w.split(/\n==[^=]/)[0] ?? "";
			if (!page) skipped.push(`article non moissonné : ${item.article}`);
			else if (/\{\{\s*Infobox video game series/i.test(w) || /\bis a series of\b/i.test(lead)) {
				skipped.push(`« ${page.titre} » décrit une série`);
			} else {
				const ib = page.infobox?.[0] ?? {};
				const released = stripNoise(ib.released?.brut ?? ib.release?.brut ?? "");
				const parts = released.split(/'''(.+?)'''/);
				const blocks = [{ heading: null as string | null, text: parts[0] ?? "" }];
				for (let i = 1; i < parts.length; i += 2) blocks.push({ heading: cleanWiki(parts[i]!), text: parts[i + 1] ?? "" });
				// Punctuation kept on purpose: « J-Stars Victory VS+ » is another game than « J-Stars Victory VS ».
				const headKey = (s: string) =>
					s.normalize("NFKC").toLowerCase().replace(/\s*\(video game\)/, "").replace(/\s+/g, " ").trim();
				const ownTitle = (h: string) => [item.label, item.article, row.title].some((t) => headKey(t) === headKey(h));
				const isPlatform = (h: string) =>
					h.split(",").every((p) => p.trim() !== "" && PLATFORM_HEADINGS.has(p.trim().toLowerCase()));
				const multiTitle = blocks.some((b) => b.heading && !isPlatform(b.heading) && !ownTitle(b.heading));
				const usable = multiTitle ? blocks.filter((b) => b.heading && ownTitle(b.heading)) : blocks;
				const found = usable.flatMap((b) => datesIn(b.text));
				const date = earliestDate(found);
				const yearRef = date?.y ?? (found.length ? Math.min(...found.map((f) => f.y)) : null);

				const frMatches = frRows.filter(
					(r) => latinKey(r.title) === latinKey(item.article) || latinKey(r.title) === latinKey(row.title)
				);
				const fr = frMatches.length === 1 ? frMatches[0]! : null;
				const descYears = [...(row.description ?? "").matchAll(/\b(19[89]\d|20[0-3]\d)\b/g)].map((m) => Number(m[1]));
				const witness =
					yearRef === null
						? null
						: fr
							? fr.year === yearRef
								? `fr.wikipedia « Liste de jeux vidéo Dragon Ball » ${fr.year}`
								: null
							: descYears.includes(yearRef)
								? `année ${yearRef} citée par la description`
								: null;

				if (!witness) {
					skipped.push(
						yearRef === null
							? "aucune année dans l'infobox : appariement non confirmé"
							: `année ${yearRef} non corroborée${fr ? ` (liste FR : ${fr.year})` : ""}`
					);
				} else {
					sources.push(`en.wikipedia « ${page.titre} » rév. ${page.revid}`, witness);

					if (needs.release_date) {
						if (date) after.release_date = Date.UTC(date.y, date.m - 1, date.d) / 1000;
						else skipped.push("release_date : pas de date complète sans ambiguïté");
					}
					if (needs.platforms) {
						const p = multiTitle ? null : parsePlatforms(ib.platforms?.brut ?? ib.platform?.brut ?? "");
						if (p) after.platforms = p;
						else skipped.push(multiTitle ? "platforms : article de plusieurs jeux" : "platforms : plateforme non reconnue ou absente");
					}
					if (needs.developer) {
						const dev = cleanDeveloper(ib.developer?.propre);
						if (!dev) skipped.push("developer : absent de l'infobox");
						else if (fr && fr.developer && fr.developer !== "—" && !studiosAgree(dev, fr.developer))
							skipped.push(`developer : « ${dev} » (EN) contredit « ${fr.developer} » (FR)`);
						else after.developer = dev;
					}
					if (needs.title_ja) {
						const n = leadNihongo(w);
						const s2 = stage2.get(item.article);
						const wpJa =
							n && s2 && s2.titleJaEn && jaKey(s2.titleJaEn) === jaKey(n.ja)
								? s2.jaSearch.find((t) => jaKey(t) === jaKey(n.ja))
								: undefined;
						const tiedToJapan =
							!!n && (/japan|japanese/i.test(n.before) || /^\s*in japan/i.test(n.after));
						const sameTitle =
							!!n && [item.article, item.label, row.title].some((t) => latinKey(t) === latinKey(n.en));
						const jpRelease = /\|\s*JP\s*\|/.test(released);
						if (n && wpJa) {
							after.title_ja = wpJa.replace(/\s*\([^)]*\)\s*$/, "");
							titleJaSource.set(row.id, `ja.wikipedia « ${wpJa} »`);
						} else if (n && (tiedToJapan || (sameTitle && jpRelease))) {
							after.title_ja = n.ja.replace(/\s*[:：]\s*/g, " ").replace(/\s+/g, " ").trim();
							titleJaSource.set(row.id, "{{nihongo}} de l'article anglais");
						} else skipped.push(n ? "title_ja : titre japonais non rattaché à une sortie japonaise" : "title_ja : aucun {{nihongo}}");
					}
				}
			}
		}

		if (Object.keys(after).length) {
			changes.push({ table: "db_games", id: row.id, label: row.title, after, source: sources.join(" ; ") });
		}
		if (skipped.length) notes.push(`db_games#${row.id} « ${row.title} » — ${skipped.join(" ; ")}`);
	}

	// A Japanese title claimed twice (or already carried by another row) is dropped everywhere.
	const existingJa = new Map(rows.filter((r) => !isEmpty(r.title_ja)).map((r) => [jaKey(r.title_ja!), r.id]));
	const proposedJa = new Map<string, number>();
	for (const c of changes) if (typeof c.after.title_ja === "string") {
		const k = jaKey(c.after.title_ja);
		proposedJa.set(k, (proposedJa.get(k) ?? 0) + 1);
	}
	for (const c of changes) {
		if (typeof c.after.title_ja !== "string") continue;
		const k = jaKey(c.after.title_ja);
		if ((proposedJa.get(k) ?? 0) > 1 || existingJa.has(k)) {
			notes.push(`db_games#${c.id} « ${c.label} » — title_ja « ${c.after.title_ja} » partagé avec un autre jeu : écarté`);
			delete c.after.title_ja;
		} else c.source += ` ; title_ja : ${titleJaSource.get(c.id)}`;
	}
	const kept = changes.filter((c) => Object.keys(c.after).length > 0);

	printChanges(kept);
	const perColumn: Record<string, number> = {};
	for (const c of kept) for (const col of Object.keys(c.after)) perColumn[col] = (perColumn[col] ?? 0) + 1;
	console.log(`\n${kept.length} jeu(x), cellules par colonne : ${JSON.stringify(perColumn)}`);
	if (notes.length) console.log(`\nLaissés vides :\n  ${notes.join("\n  ")}`);

	if (!APPLY) console.log("\n(simulation — relancer avec --apply)");
	else {
		const done = await applyChanges(sql, kept, "fill-games-metadata");
		console.log(`\n✔ ${done.rows} jeu(x), ${done.cells} cellule(s) écrites et versionnées.`);
	}
} finally {
	await sql.end();
}
