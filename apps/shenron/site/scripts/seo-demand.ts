/**
 * Measures what people actually type into Google around Dragon Ball, and says
 * which of those searches our site answers with a page.
 *
 *   bun apps/shenron/site/scripts/seo-demand.ts                 # small run, report to stdout
 *   bun apps/shenron/site/scripts/seo-demand.ts --apply         # also write docs/seo-demande.md
 *   bun apps/shenron/site/scripts/seo-demand.ts --seeds 60      # widen the seed list
 *
 * Source: `bxc google suggest`, the keyless autocomplete endpoint. It returns
 * the completions Google offers for a prefix, which is the closest honest proxy
 * for demand we can read without a Search Console property. No volume figure is
 * produced here: autocomplete ranks, it does not count, and inventing a number
 * would be exactly the kind of plausible value this repo forbids.
 *
 * Coverage is decided against our own tables, not against a guess: a suggestion
 * is covered when it names an entity we hold a page for, or falls under a
 * section of the launch registry. Anything else is listed as a gap — a subject
 * readers look for and we do not serve.
 */
import postgres from "postgres";
import path from "node:path";

async function databaseUrl(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const text = await Bun.file(path.join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	const value = text
		.split("\n")
		.filter((l) => l.startsWith("DATABASE_URL="))
		.at(-1)
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!value) {
		console.error("✗ DATABASE_URL introuvable.");
		process.exit(1);
	}
	return value;
}

const sql = postgres(await databaseUrl(), { max: 2, prepare: false });

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const seedLimit = Number(args[args.indexOf("--seeds") + 1]) || 40;
const viaBxc = args.includes("--via-bxc");
const locale = (args.includes("--locale") ? args[args.indexOf("--locale") + 1] : "fr") || "fr";

/**
 * Comparison form: no diacritics, no punctuation, single spaces.
 *
 * Both halves matter. « Kaméhaméha » must meet « kamehameha », and our row
 * « Mr. Satan » must meet the « mr satan » people actually type — the dot alone
 * was hiding six real searches behind a false gap.
 */
function fold(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[.,;:!?'’"()[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

type Entity = { name: string; href: string; kind: string };

/**
 * Pages we can point a searcher at. Only visible rows: a hidden row is a
 * logical delete, and sending SEO traffic to a 404 is worse than a gap.
 */
async function entities(): Promise<Entity[]> {
	const tables: { table: string; route: string; kind: string }[] = [
		{ table: "db_characters", route: "/wiki/personnages", kind: "personnage" },
		{ table: "db_techniques", route: "/wiki/techniques", kind: "technique" },
		{ table: "db_planets", route: "/wiki/cosmologie", kind: "planète" },
		{ table: "db_transformations", route: "/wiki/transformations", kind: "transformation" },
		{ table: "db_races", route: "/wiki/races", kind: "race" },
	];
	const out: Entity[] = [];
	for (const t of tables) {
		const rows = (await sql.unsafe(
			`select id, name from bot.${t.table} where visible and name is not null and name <> ''`
		)) as unknown as { id: number; name: string }[];
		for (const r of rows) out.push({ name: r.name, href: `${t.route}/${r.id}`, kind: t.kind });
	}
	// Longest names first: « Super Saiyan Blue » must win over « Super Saiyan ».
	return out.toSorted((a, b) => b.name.length - a.name.length);
}

/**
 * Seeds are prefixes, not questions: autocomplete completes what is being
 * typed. Sections come first because they map to pages we already publish; the
 * rest are the characters our editorial work has invested in, which is where a
 * ranking gain is worth the most.
 */
async function seeds(): Promise<string[]> {
	const sections = [
		"dragon ball ",
		"dragon ball z ",
		"dragon ball super ",
		"dragon ball daima ",
		"dragon ball personnage ",
		"dragon ball technique ",
		"dragon ball transformation ",
		"dragon ball saga ",
		"dragon ball episode ",
		"dragon ball film ",
		"dragon ball manga tome ",
		"dragon ball databook ",
		"akira toriyama ",
		"dragon ball canon ",
	];
	const rows = (await sql.unsafe(
		`select name from bot.db_characters
		 where visible and article is not null and length(article) > 400
		 order by length(article) desc limit ${Math.max(0, seedLimit - sections.length)}`
	)) as unknown as { name: string }[];
	return [...sections, ...rows.map((r) => `${r.name.toLowerCase()} `)];
}

/**
 * One autocomplete call. Failures are reported, never silently emptied.
 *
 * Two callers for the same endpoint, and the default is not `bxc`:
 * `bxc google suggest` sends no `hl`/`gl`, so Google answers in the locale it
 * infers from the server's IP. Measured from this VPS, a third of the results
 * came back in Russian — noise for a French site. `--via-bxc` keeps the CLI
 * path for when its stealth profile matters more than the locale.
 */
async function suggest(prefix: string): Promise<string[]> {
	if (viaBxc) {
		const proc = Bun.spawn(["bxc", "google", "suggest", prefix], { stdout: "pipe", stderr: "pipe" });
		const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
		if (code !== 0) throw new Error(`bxc google suggest a échoué (code ${code}) sur « ${prefix} »`);
		const parsed: unknown = JSON.parse(out.trim() || "[]");
		if (!Array.isArray(parsed)) throw new Error(`réponse inattendue sur « ${prefix} »`);
		return parsed.filter((s): s is string => typeof s === "string");
	}
	const url =
		"https://suggestqueries.google.com/complete/search" +
		`?client=chrome&hl=${locale}&gl=${locale.toUpperCase()}&q=${encodeURIComponent(prefix)}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`autocomplétion HTTP ${res.status} sur « ${prefix} »`);
	/**
	 * The endpoint answers `charset=ISO-8859-1` for `hl=fr`, and decoding those
	 * bytes as UTF-8 turns « épisode » into « \uFFFDpisode ». Honour the header.
	 */
	const charset = /charset=([\w-]+)/i.exec(res.headers.get("content-type") ?? "")?.[1] ?? "utf-8";
	const body: unknown = JSON.parse(new TextDecoder(charset).decode(await res.arrayBuffer()));
	if (!Array.isArray(body) || !Array.isArray(body[1]))
		throw new Error(`réponse inattendue sur « ${prefix} »`);
	return (body[1] as unknown[]).filter((s): s is string => typeof s === "string");
}

const known = await entities();
const folded = known.map((e) => (Object.assign(e, { needle: fold(e.name) })));

/** Section-level fallback: no fiche, but a hub that answers the intent. */
const SECTIONS: { needle: RegExp; href: string; label: string }[] = [
	{ needle: /\bepisode|\bepisodes\b/, href: "/wiki/episodes", label: "épisodes" },
	{ needle: /\bfilm|\bfilms\b/, href: "/wiki/films", label: "films" },
	{ needle: /\btome|\bmanga\b|\bchapitre/, href: "/wiki/manga", label: "manga" },
	{ needle: /\bdatabook|daizenshuu|zenshu/, href: "/wiki/databooks", label: "databooks" },
	{ needle: /\bsaga|\barc\b/, href: "/wiki/sagas", label: "sagas" },
	{ needle: /\bcanon\b/, href: "/wiki/canon", label: "canon" },
	{ needle: /toriyama/, href: "/wiki/toriyama", label: "Toriyama" },
	{ needle: /\bpersonnage/, href: "/wiki/personnages", label: "personnages" },
	{ needle: /\btechnique/, href: "/wiki/techniques", label: "techniques" },
	{ needle: /\btransformation/, href: "/wiki/transformations", label: "transformations" },
	{ needle: /\bdata ?book|\bdatabase\b/, href: "/wiki/databooks", label: "databooks" },
	{ needle: /tier ?list/, href: "/tierlists", label: "tierlists" },
	{ needle: /\bchronologie|\btimeline\b/, href: "/wiki/chronologie", label: "chronologie" },
	{
		needle: /\bjeu|\bjeux\b|xenoverse|sparking|budokai|tenkaichi|kakarot|fighterz|dokkan|legends|kakumei/,
		href: "/wiki/jeux",
		label: "jeux",
	},
	{ needle: /\bdragon ball (z|super|gt|daima|kai)\b|\bsérie|\bserie\b/, href: "/wiki/sagas", label: "séries" },
];

type Hit = { query: string; from: string[]; href: string | null; why: string };

/** Bounded edit distance — we only care whether it stays under three. */
function distance(a: string, b: string): number {
	if (Math.abs(a.length - b.length) > 2) return 3;
	let prev = [...Array(b.length + 1).keys()];
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) {
			row[j] = Math.min(
				prev[j] + 1,
				row[j - 1] + 1,
				prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
			);
		}
		prev = row;
	}
	return prev[b.length];
}

/**
 * A gap that is really a spelling divergence: the page exists, under a name
 * nobody types. Measured case: readers search « Vermoud », our row says
 * « Vermoudh », and the fiche is invisible to all of them.
 */
function nearMiss(query: string): Entity | null {
	const words = fold(query).split(" ");
	for (const w of words) {
		if (w.length < 5) continue;
		const near = folded.find((e) => !e.needle.includes(" ") && distance(e.needle, w) <= 2 && e.needle !== w);
		if (near) return near;
	}
	return null;
}

function cover(query: string): { href: string | null; why: string } {
	const q = fold(query);
	const entity = folded.find((e) => e.needle.length >= 4 && q.includes(e.needle));
	if (entity) return { href: entity.href, why: `${entity.kind} « ${entity.name} »` };
	const section = SECTIONS.find((s) => s.needle.test(q));
	if (section) return { href: section.href, why: `rubrique ${section.label}` };
	return { href: null, why: "aucune page ne répond" };
}

const hits = new Map<string, Hit>();
const list = await seeds();
let failures = 0;

for (const [i, seed] of list.entries()) {
	try {
		for (const query of await suggest(seed)) {
			const existing = hits.get(query);
			if (existing) {
				if (!existing.from.includes(seed)) existing.from.push(seed);
				continue;
			}
			hits.set(query, { query, from: [seed], ...cover(query) });
		}
	} catch (e) {
		failures++;
		console.error(`  ! ${(e as Error).message}`);
	}
	if (i % 10 === 9) console.error(`  … ${i + 1}/${list.length} graines`);
	// Autocomplete is public but not a free-for-all; one call at a time, spaced.
	await Bun.sleep(350);
}

const all = [...hits.values()];
/**
 * A bare character name is an ambiguous prefix: « Kabuto » completes to Naruto
 * and to a beetle, « Cel » to cel shading. Those are not gaps in our coverage —
 * they are not our subject. Counted, then set aside.
 */
const HORS_UNIVERS = (h: Hit) => !h.href && !/dragon ?ball|\bdb[zs]?\b|saiyan|super/.test(fold(h.query));
const strangers = all.filter(HORS_UNIVERS);
const gaps = all.filter((h) => !h.href && !HORS_UNIVERS(h));
const covered = all.filter((h) => h.href);

console.log(
	`${all.length} requêtes réelles sur ${list.length} graines — ` +
		`${covered.length} couvertes, ${gaps.length} sans page, ${strangers.length} hors univers` +
		(failures ? `, ${failures} graine(s) en échec` : "")
);
for (const g of gaps.slice(0, 25)) console.log(`  ✗ ${g.query}`);

if (!apply) {
	console.log("(lecture seule — relancer avec --apply pour écrire docs/seo-demande.md)");
	process.exit(0);
}

const lines = [
	"# Demande de recherche mesurée",
	"",
	"Ce que les gens tapent réellement dans Google autour de Dragon Ball, relevé",
	"par `bun apps/shenron/site/scripts/seo-demand.ts --apply` via l'autocomplétion",
	"publique (`bxc google suggest`).",
	"",
	"**Ce que ce tableau ne dit pas** : aucun volume de recherche. L'autocomplétion",
	"classe des requêtes, elle n'en compte aucune. Une ligne haute n'est pas une",
	"ligne populaire, c'est une ligne que Google propose tôt.",
	"",
	`Relevé sur ${list.length} graines, ${all.length} requêtes distinctes, dont ` +
		`${strangers.length} écartées comme hors univers (un nom seul comme « Kabuto » ` +
		"complète vers Naruto ou vers un insecte).",
	"",
	`## Sans page (${gaps.length})`,
	"",
	"Des sujets cherchés que le site ne sert pas.",
	"",
	"| Requête | Tapée après | Graphie proche en base |",
	"| --- | --- | --- |",
	...gaps.map((g) => {
		const near = nearMiss(g.query);
		const hint = near ? `${near.kind} « ${near.name} » → \`${near.href}\`` : "—";
		return `| ${g.query} | ${g.from.map((s) => `\`${s.trim()}\``).join(", ")} | ${hint} |`;
	}),
	"",
	`## Couvertes (${covered.length})`,
	"",
	"| Requête | Page | Pourquoi |",
	"| --- | --- | --- |",
	...covered.map((c) => `| ${c.query} | \`${c.href}\` | ${c.why} |`),
	"",
];

const target = path.resolve(import.meta.dir, "../../../docs/seo-demande.md");
await Bun.write(target, `${lines.join("\n")}\n`);
console.log(`→ ${path.relative(process.cwd(), target)}`);
process.exit(0);
