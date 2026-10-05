#!/usr/bin/env bun
/**
 * Fill the empty identity fields of `bot.db_characters` — only what a source proves.
 *
 *   bun apps/shenron/site/scripts/fill-character-identity.ts                 # simulation (default)
 *   bun apps/shenron/site/scripts/fill-character-identity.ts --fetch         # refresh the bridge caches first
 *   bun apps/shenron/site/scripts/fill-character-identity.ts --json out.json # proposals + proofs, for review
 *   bun apps/shenron/site/scripts/fill-character-identity.ts --apply --ids 79,117
 *
 * WHAT IS WRITTEN: `name_ja`, and nothing else.
 *
 * Editorial doctrine (docs/wiki-editorial.md): the wiki is written on the manga
 * and the databooks only. Kanzenshuu and Wikipedia are NOT sources. They are used
 * here the way `ja-appariement.ts` uses the Xenoverse 2 files: as a BRIDGE that
 * proposes "this Latin name ↔ this Japanese spelling". A spelling enters the wiki
 * only if healthy planches of a reference databook print it (`defautDePlanche`
 * null, reference works only — card catalogues and magazines excluded).
 *
 * Why the other columns stay empty (measured, reported, never written):
 *   - `race`, `gender`, `origin_planet_id`: the bridges state them, the databooks
 *     cannot be matched to a row mechanically (a race word on a planche does not
 *     say WHOSE race it is). Filling them from Kanzenshuu would copy a fan site.
 *   - `name_romaji`: no databook prints a romanization; transliterating a name
 *     ourselves is an invention (ヴァドス → Vadosu ? Vados ?).
 *   - `debut_chapter_id` / `debut_episode_id`: "a citation is not an appearance";
 *     the Story Guide 初登場 pages give volumes in noisy OCR, not chapter ids.
 *
 * Matching is strict, because a Japanese name on the wrong character is worse
 * than an empty cell (it becomes the duplicate judge of doublons-personnages.ts):
 *   1. exact normalized equality between the row `name` and the bridge name
 *      (title, infobox name, or a redirect to that page) — never `name_romaji`,
 *      a catch-all column that also holds dub names;
 *   2. the normalized name must be carried by ONE row of the whole table (visible
 *      or not): `Abra` (Neko Majin) vs `Âbra` (demon) is exactly this trap;
 *   3. all bridges must agree on a single spelling;
 *   4. the spelling must not already be the `name_ja` of another row;
 *   5. attestation in the databooks, as a word (a katakana spelling inside a
 *      longer katakana word does not count: キャベ inside キャベツ);
 *   6. a common JMdict word (シンバル, ヒット), or a pairing that only the
 *      Wikipedia list makes (it also lists groups and concepts: 超神龍 is
 *      attested for Porunga, not for the Super-era dragon), is downgraded to
 *      `a_verifier` — the databook prints the word, not the person.
 *
 * `--apply` REQUIRES `--ids`: the output is a proposal, a human picks the rows.
 * Only `sur` rows can be applied; every write records a `public.wiki_revisions`
 * row (before `{name_ja: null}`), so it is reversible from /admin/wiki/history.
 * The UPDATE re-checks emptiness in SQL: a value typed meanwhile is never overwritten.
 */
import { mkdirSync } from "node:fs";
import { homedir, loadavg } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { defautDePlanche } from "../src/lib/databooks-defauts";
import { graphieSuspecte } from "../src/lib/ja/appariement";
import { graphiesJmdict } from "../src/lib/ja/dictionnaire";
import { normaliserJa } from "../src/lib/ja/normalisation";
import { SITE_URL } from "../src/lib/config";
import { texteDePlanche, urlBase } from "./_databooks-base";
import { attestedAt } from "./_ja-attestation";

const args = process.argv.slice(2);
const opt = (name: string) => {
	const i = args.indexOf(`--${name}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);

const APPLY = flag("apply");
const FETCH = flag("fetch");
const JSON_OUT = opt("json");
const IDS = opt("ids")
	?.split(",")
	.map((s) => Number(s.trim()))
	.filter(Number.isFinite);
if (APPLY && !IDS?.length) {
	console.error("✗ --apply requires --ids: read the simulation, then name the rows to write.");
	process.exit(2);
}

const CACHE = join(homedir(), ".shenron-build-tmp", "scrape", "characters");
const KZ_API = "https://www.kanzenshuu.com/mediawiki/api.php";
const WP_EN_LIST =
	"https://en.wikipedia.org/w/index.php?title=List_of_Dragon_Ball_characters&action=raw";
const USER_AGENT = `dbfr-wiki-identity/1.0 (${new URL(SITE_URL).host})`;

/** Same filter as reancre-sources-wiki.ts: reference works, not magazines nor card catalogues. */
const REFERENCE_WORKS =
	/(daizenshuu|daizenshū|chozenshu|chōzenshū|daijiten|world guide|story guide|super exciting guide|landmark|dragon ball forever|adventure special|super history|anime illustration|complete illustration)/i;
const CARD_CATALOGUES = /\b(SDBH|DBH)\b/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A build and a crawl share the VPS: wait while the 1-minute load is above 8. */
async function waitForLoad(): Promise<void> {
	while (loadavg()[0]! > 8) {
		console.log(`  · load ${loadavg()[0]!.toFixed(1)} > 8, pause 30 s`);
		await sleep(30_000);
	}
}

/** Comparison key of a Latin name: accents, case and punctuation dropped, the rest must match. */
export function nameKey(s: string | null | undefined): string {
	return (s ?? "")
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

/** Japanese spelling out of a bridge value: markup, refs and the romaji tail removed. */
export function cleanSpelling(raw: string): string {
	const first = raw
		.replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
		.split(/<br\s*\/?>/i)[0]!
		.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
		.replace(/\s*[(（].*$/, "")
		.replace(/·/g, "・")
		.trim();
	return normaliserJa(first);
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
	const res = await fetch(url, { ...init, headers: { "user-agent": USER_AGENT } });
	if (!res.ok) throw new Error(`${res.status} ${url}`);
	return res.text();
}

/** Refresh the two bridge caches. Sequential, paced: one request at a time. */
async function refreshCaches(): Promise<void> {
	mkdirSync(CACHE, { recursive: true });
	await waitForLoad();
	await Bun.write(join(CACHE, "wp-en-list.wikitext"), await fetchText(WP_EN_LIST));

	const members = async (category: string) => {
		const out: { title: string; ns: number }[] = [];
		let cont: string | undefined;
		do {
			const q = new URLSearchParams({
				action: "query",
				list: "categorymembers",
				cmtitle: category,
				cmlimit: "500",
				format: "json",
				...(cont ? { cmcontinue: cont } : {}),
			});
			const j = JSON.parse(await fetchText(`${KZ_API}?${q}`));
			out.push(...j.query.categorymembers);
			cont = j.continue?.cmcontinue;
			await sleep(1500);
		} while (cont);
		return out;
	};
	const root = await members("Category:Character");
	const titles = new Set(root.filter((m) => m.ns === 0).map((m) => m.title));
	for (const sub of root.filter((m) => m.ns === 14)) {
		await waitForLoad();
		for (const m of await members(sub.title)) if (m.ns === 0) titles.add(m.title);
	}
	const list = [...titles].toSorted();
	await Bun.write(join(CACHE, "kz-character-titles.txt"), list.join("\n"));

	const lines: string[] = [];
	for (let i = 0; i < list.length; i += 50) {
		await waitForLoad();
		const body = new URLSearchParams({
			action: "query",
			prop: "revisions",
			rvprop: "content",
			rvslots: "main",
			redirects: "1",
			titles: list.slice(i, i + 50).join("|"),
			format: "json",
		});
		lines.push(await fetchText(KZ_API, { method: "POST", body }));
		await sleep(2000);
	}
	await Bun.write(join(CACHE, "kz-pages.jsonl"), `${lines.join("\n")}\n`);
	console.log(`✓ caches refreshed: ${list.length} Kanzenshuu pages, Wikipedia EN list`);
}

export { attestedAt };

interface Bridge {
	source: "kanzenshuu" | "wikipedia-en";
	label: string;
	url: string;
	ja: string;
	classify?: string;
	/** Stated by the bridge, reported only — never written. */
	species?: string;
	gender?: string;
	mangaDebut?: string;
}

/** Kanzenshuu infobox field; `[ \t]*` so that an empty field does not swallow the next line. */
const infoboxField = (text: string, key: string) =>
	new RegExp(`^\\|[ \\t]*${key}[ \\t]*=[ \\t]*(.*)$`, "mi").exec(text)?.[1]?.trim() ?? "";

async function loadBridges(): Promise<Map<string, Bridge[]>> {
	const byKey = new Map<string, Bridge[]>();
	const add = (key: string, b: Bridge) => {
		if (!key || !b.ja) return;
		const list = byKey.get(key) ?? [];
		if (!list.some((x) => x.source === b.source && x.ja === b.ja)) list.push(b);
		byKey.set(key, list);
	};

	const kz = Bun.file(join(CACHE, "kz-pages.jsonl"));
	if (await kz.exists()) {
		const batches = (await kz.text())
			.split("\n")
			.filter((l) => l.trim())
			.map((l) => JSON.parse(l));
		const redirects: { from: string; to: string }[] = batches.flatMap(
			(b) => b.query?.redirects ?? []
		);
		const byTitle = new Map<string, Bridge>();
		for (const b of batches) {
			for (const p of Object.values(b.query?.pages ?? {}) as {
				title: string;
				revisions?: { slots?: { main?: { "*"?: string } } }[];
			}[]) {
				const text = p.revisions?.[0]?.slots?.main?.["*"] ?? "";
				if (!/\{\{Infobox character/i.test(text)) continue;
				const bridge: Bridge = {
					source: "kanzenshuu",
					label: p.title,
					url: `https://www.kanzenshuu.com/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
					ja: cleanSpelling(infoboxField(text, "jpn_name")),
					classify: infoboxField(text, "classify").replace(/\[\[|\]\]/g, ""),
					species: infoboxField(text, "species").replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1"),
					gender: infoboxField(text, "gender")
						.replace(/<ref[\s\S]*$/i, "")
						.replace(/\[\[|\]\]/g, ""),
					mangaDebut: infoboxField(text, "manga_debut").replace(/\[\[|\]\]/g, ""),
				};
				byTitle.set(p.title, bridge);
				add(nameKey(p.title), bridge);
				add(nameKey(infoboxField(text, "name")), bridge);
			}
		}
		for (const r of redirects) {
			const target = byTitle.get(r.to);
			if (target) add(nameKey(r.from), target);
		}
	} else {
		console.log("  (Kanzenshuu cache missing — run with --fetch)");
	}

	const wp = Bun.file(join(CACHE, "wp-en-list.wikitext"));
	if (await wp.exists()) {
		const text = await wp.text();
		for (const m of text.matchAll(/\{\{nihongo4?\|([^|{}]*)\|([^|{}]*)(?:\|([^|{}]*))?/gi)) {
			const label = m[1]!.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]|''|"/g, "$1").trim();
			const ja = cleanSpelling(m[2]!);
			if (!/[぀-ヿ一-鿿]/.test(ja)) continue;
			add(nameKey(label), {
				source: "wikipedia-en",
				label,
				url: "https://en.wikipedia.org/wiki/List_of_Dragon_Ball_characters",
				ja,
			});
		}
	} else {
		console.log("  (Wikipedia EN cache missing — run with --fetch)");
	}
	return byKey;
}

type Level = "sur" | "a_verifier" | "rejete";
interface Proof {
	databook: number;
	title: string;
	page: number;
	excerpt: string;
}
interface Proposal {
	id: number;
	name: string;
	race: string | null;
	ja: string | null;
	level: Level;
	reason: string;
	bridges: Bridge[];
	proofs: Proof[];
}

if (FETCH) await refreshCaches();

const sql = postgres(await urlBase(), { max: 2, prepare: false });
/** The DB tunnel refuses a connection now and then: retry the first round-trip with backoff. */
for (let attempt = 1; ; attempt++) {
	try {
		await sql`SELECT 1`;
		break;
	} catch (err) {
		if (attempt >= 8) throw err;
		console.log(`  · database unreachable (${(err as Error).message}), retry ${attempt}/7`);
		await sleep(2000 * attempt);
	}
}
try {
	await waitForLoad();
	const bridges = await loadBridges();
	console.log(`· bridges: ${bridges.size} Latin keys`);

	const rows = await sql<
		{
			id: number;
			name: string;
			name_ja: string | null;
			race: string | null;
			gender: string | null;
			name_romaji: string | null;
			origin_planet_id: number | null;
			debut_chapter_id: number | null;
			visible: boolean;
		}[]
	>`SELECT id::int, name, name_ja, race, gender, name_romaji, origin_planet_id, debut_chapter_id, visible
	  FROM bot.db_characters ORDER BY id`;

	const rowsByKey = new Map<string, number[]>();
	for (const r of rows) {
		const k = nameKey(r.name);
		rowsByKey.set(k, [...(rowsByKey.get(k) ?? []), r.id]);
	}
	/** Spellings already carried: the duplicate judge must never see two rows with the same one. */
	const carried = new Map<string, number>();
	for (const r of rows) {
		const v = normaliserJa((r.name_ja ?? "").split(/[,、;(（]/)[0]!.trim());
		if (/[぀-ヿ一-鿿]/.test(v)) carried.set(v, r.id);
	}

	console.log("· reading healthy databook planches…");
	await waitForLoad();
	const books = await sql<{ id: number; title: string; category: string | null; pages: unknown }[]>`
		SELECT id::int, title, category, pages FROM bot.db_databooks WHERE pages IS NOT NULL ORDER BY id`;
	const planches: { databook: number; title: string; page: number; raw: string; norm: string }[] =
		[];
	for (const b of books) {
		if (!REFERENCE_WORKS.test(b.title) || CARD_CATALOGUES.test(b.title)) continue;
		for (const p of Array.isArray(b.pages) ? (b.pages as Record<string, unknown>[]) : []) {
			const raw = texteDePlanche(p);
			if (!raw.trim() || defautDePlanche(p, raw)) continue;
			planches.push({
				databook: b.id,
				title: b.title,
				page: Number(p.number),
				raw,
				norm: normaliserJa(raw),
			});
		}
	}
	console.log(`  ${planches.length} healthy planches from reference works`);
	const jmdict = await graphiesJmdict();
	if (jmdict.size === 0)
		console.log(
			"  ⚠ JMdict missing (bun apps/shenron/site/scripts/ja-preparer.ts): common words not detected"
		);

	const proposals: Proposal[] = [];
	const bridgeStats = { race: 0, gender: 0, debut: 0 };
	for (const r of rows) {
		if (!r.visible) continue;
		if (IDS?.length && !IDS.includes(r.id)) continue;
		const key = nameKey(r.name);
		const found = bridges.get(key) ?? [];
		if (found.length === 0) continue;

		const kz = found.find((b) => b.source === "kanzenshuu");
		if (kz && !r.race && kz.species) bridgeStats.race++;
		if (kz && !r.gender && /^(Male|Female)$/.test(kz.gender ?? "")) bridgeStats.gender++;
		if (kz && !r.debut_chapter_id && kz.mangaDebut) bridgeStats.debut++;

		if ((r.name_ja ?? "").trim()) continue;
		const base = { id: r.id, name: r.name, race: r.race, bridges: found, proofs: [] as Proof[] };
		const spellings = [...new Set(found.map((b) => b.ja))];
		const reject = (reason: string, ja: string | null = null) =>
			proposals.push({ ...base, ja, level: "rejete", reason });

		if ((rowsByKey.get(key) ?? []).length > 1) {
			reject(`name shared by rows ${rowsByKey.get(key)!.join(", ")}`);
			continue;
		}
		if (spellings.length > 1) {
			reject(`bridges disagree: ${spellings.join(" / ")}`);
			continue;
		}
		const ja = spellings[0]!;
		if (graphieSuspecte(ja)) {
			reject("unreadable or too short spelling", ja);
			continue;
		}
		const owner = carried.get(ja);
		if (owner !== undefined && owner !== r.id) {
			reject(`spelling already carried by row ${owner}`, ja);
			continue;
		}
		const proofs: Proof[] = [];
		for (const p of planches) {
			// Boundaries are judged on the RAW text: normalisation drops whitespace, which
			// glues list items together (ドスコイ\n\nウドー → ドスコイウドー) and made a
			// real occurrence fail. The normalised text is only a fallback for spellings
			// the raw text does not contain at all (middle-dot variants).
			const inRaw = p.raw.includes(ja);
			if ((inRaw ? attestedAt(p.raw, ja) : attestedAt(p.norm, ja)) === -1) continue;
			const i = Math.max(0, p.raw.indexOf(ja) - 60);
			proofs.push({
				databook: p.databook,
				title: p.title,
				page: p.page,
				excerpt: p.raw.slice(i, i + 160).replace(/\s+/g, " "),
			});
		}
		if (proofs.length === 0) {
			proposals.push({
				...base,
				ja,
				level: "rejete",
				reason: "spelling absent from the databooks",
			});
			continue;
		}
		const common = jmdict.has(ja);
		const wikipediaOnly = found.every((b) => b.source === "wikipedia-en");
		proposals.push({
			...base,
			ja,
			proofs,
			level: common || wikipediaOnly ? "a_verifier" : "sur",
			reason: common
				? `common Japanese word (JMdict), ${proofs.length} planche(s)`
				: wikipediaOnly
					? `only the Wikipedia list pairs this name (it also lists groups and concepts), ${proofs.length} planche(s)`
					: `${proofs.length} planche(s) in reference databooks`,
		});
	}

	const byLevel = (l: Level) => proposals.filter((p) => p.level === l);
	for (const level of ["sur", "a_verifier", "rejete"] as const) {
		const list = byLevel(level);
		console.log(`\n— ${level}: ${list.length} —`);
		for (const p of list) {
			console.log(
				`  #${p.id} « ${p.name} »${p.race ? ` [${p.race}]` : ""} → ${p.ja ?? "∅"}  (${p.reason}; ${p.bridges
					.map((b) => `${b.source}:${b.label}${b.classify ? ` {${b.classify}}` : ""}`)
					.join(", ")})`
			);
			for (const pr of p.proofs.slice(0, 2))
				console.log(
					`      ${pr.title} — planche ${pr.page} (sources-wiki.ts planche ${pr.databook} ${pr.page}) … ${pr.excerpt} …`
				);
		}
	}
	const visible = rows.filter((r) => r.visible);
	const empty = (k: keyof (typeof rows)[number]) =>
		visible.filter((r) => r[k] === null || String(r[k]).trim() === "").length;
	console.log(
		`\nNot written (no databook proof can be matched to a row): bridges state race for ${bridgeStats.race}, ` +
			`gender for ${bridgeStats.gender}, manga debut for ${bridgeStats.debut} empty visible rows.`
	);
	console.log(
		`Visible rows still empty: name_ja ${empty("name_ja")}, name_romaji ${empty("name_romaji")}, race ${empty("race")}, ` +
			`gender ${empty("gender")}, origin_planet_id ${empty("origin_planet_id")}, debut_chapter_id ${empty("debut_chapter_id")}.`
	);

	if (JSON_OUT) {
		await Bun.write(
			JSON_OUT,
			JSON.stringify({ generatedAt: new Date().toISOString(), proposals }, null, 1)
		);
		console.log(`✓ proposals written to ${JSON_OUT}`);
	}

	if (!APPLY) {
		console.log("\nSimulation. To write, pick `sur` rows after review: --apply --ids <id,id>");
	} else {
		const toWrite = byLevel("sur");
		const refused = IDS!.filter((id) => !toWrite.some((p) => p.id === id));
		if (refused.length) console.log(`\n✗ not applicable (not \`sur\`): ${refused.join(", ")}`);
		let written = 0;
		for (const p of toWrite) {
			await sql.begin(async (tx) => {
				const done = await tx`
					UPDATE bot.db_characters SET name_ja = ${p.ja}
					WHERE id = ${p.id} AND coalesce(btrim(name_ja), '') = '' RETURNING id`;
				if (done.length === 0) return;
				await tx`INSERT INTO public.wiki_revisions ${tx({
					id: Array.from(
						{ length: 24 },
						() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
					).join(""),
					tableName: "db_characters",
					rowId: String(p.id),
					action: "update",
					label: p.name,
					before: tx.json({ name_ja: null }),
					after: tx.json({ name_ja: p.ja }),
					editorId: "agent",
					editorName: `Agent dbfr-wiki (fill-character-identity: ${p.proofs
						.slice(0, 3)
						.map((x) => `${x.title} p.${x.page}`)
						.join(" ; ")})`.slice(0, 480),
				})}`;
				written++;
			});
		}
		console.log(
			`\n✓ ${written} name_ja written, one revision each (reverse-sync propagates to the bot SQLite).`
		);
	}
} finally {
	await sql.end();
}
