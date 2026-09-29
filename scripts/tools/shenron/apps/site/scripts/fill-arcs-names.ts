#!/usr/bin/env bun
/**
 * Fills `bot.db_arcs.name_ja` with the official Japanese arc names (…編) cited by the
 * Japanese Wikipedia articles of the anime, empty cells only.
 *
 * SIMULATION BY DEFAULT. Nothing is written without `--apply`; one revision per arc.
 *
 * The French arcs of the base are finer than the Japanese cut (« Arc Arrivée de Raditz »,
 * « Combat final contre Freezer »): most have no Japanese name at all, and inventing one
 * would be a translation, not a source. `PAIRS` therefore lists, by hand, only the arcs
 * whose name has a Japanese counterpart, and each pair carries a check the script runs
 * against the scrape before anything is proposed:
 *
 *   literal    the French name translates the Japanese one word for word (« Arc du 21e
 *              Tenkaichi Budokai » = 第21回天下一武道会編) and the token appears in the
 *              article as a section, a definition or a published title;
 *   episodes   the arc is the ONLY arc of its saga, and the Japanese section announces
 *              exactly the saga's episode range (« 第28話 - 第46話 » = saga 28–46);
 *   first-ep   the arc is the FIRST arc of its saga, and the first episode of the Japanese
 *              section's episode table is the saga's first episode.
 *
 * Scrape (~/.shenron-build-tmp/scrape/meta/arcs/):
 *   bxc wiki page "https://ja.wikipedia.org/w/index.php?title=<title>" --out ja-<title>.json
 *   for ドラゴンボール (アニメ), ドラゴンボールZ, ドラゴンボールGT, ドラゴンボール超
 *
 *   bun apps/site/scripts/fill-arcs-names.ts            # simulation
 *   bun apps/site/scripts/fill-arcs-names.ts --apply
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

type Check = "literal" | "episodes" | "first-ep";
type Pair = { id: number; slug: string; nameJa: string; article: string; anchor: string; check: Check };

const DB = "ドラゴンボール (アニメ)";
const DBZ = "ドラゴンボールZ";
const GT = "ドラゴンボールGT";
const DBS = "ドラゴンボール超";

const PAIRS: Pair[] = [
	{ id: 2, slug: "muscle-tower", nameJa: "レッドリボン軍編", article: DB, anchor: ";レッドリボン軍編", check: "literal" },
	{ id: 26, slug: "21-tenkaichi-budokai", nameJa: "第21回天下一武道会編", article: DB, anchor: ";第21回天下一武道会編", check: "literal" },
	{ id: 28, slug: "22-tenkaichi-budokai", nameJa: "第22回天下一武道会編", article: DB, anchor: ";第22回天下一武道会編", check: "literal" },
	{ id: 29, slug: "piccolo-daimao", nameJa: "ピッコロ大魔王編", article: DB, anchor: ";ピッコロ大魔王編", check: "literal" },
	{ id: 31, slug: "23-tenkaichi-budokai", nameJa: "第23回天下一武道会編", article: DB, anchor: ";第23回天下一武道会編", check: "literal" },
	{ id: 30, slug: "entrainement-kami", nameJa: "神殿での修行編", article: DB, anchor: ";神殿での修行編", check: "first-ep" },
	{ id: 39, slug: "garlic-jr", nameJa: "ガーリックJr.編", article: DBZ, anchor: "=== ガーリックJr.編 ===", check: "literal" },
	{ id: 35, slug: "freezer-arc", nameJa: "フリーザ編", article: DBZ, anchor: "=== フリーザ編 ===", check: "literal" },
	{ id: 12, slug: "cell-games", nameJa: "セルゲーム編", article: DBZ, anchor: "「ドラゴンボールZ セルゲーム編」", check: "literal" },
	{ id: 45, slug: "autre-monde", nameJa: "あの世一武道会編", article: DBZ, anchor: ";あの世一武道会編", check: "literal" },
	{ id: 56, slug: "super-c17", nameJa: "究極の人造人間編", article: GT, anchor: "; 究極の人造人間編", check: "episodes" },
	{ id: 18, slug: "beerus-arc", nameJa: "破壊神ビルス編", article: DBS, anchor: "=== 破壊神ビルス編 ===", check: "literal" },
	{ id: 20, slug: "u6-tournament", nameJa: "破壊神シャンパ編", article: DBS, anchor: "=== 破壊神シャンパ編 ===", check: "episodes" },
	{ id: 62, slug: "super-broly", nameJa: "ブロリー編", article: DBS, anchor: "=== ブロリー編 ===", check: "literal" },
];

type ArcRow = { id: number; slug: string; name: string; name_ja: string | null; saga_id: number | string; order_idx: number | string };
type SagaRow = { id: number | string; name: string; episode_start: number | string | null; episode_end: number | string | null };

const sql = await connect();
try {
	const arcs = (await sql`select id, slug, name, name_ja, saga_id, order_idx from bot.db_arcs where visible`) as unknown as ArcRow[];
	const sagas = (await sql`select id, name, episode_start, episode_end from bot.db_sagas`) as unknown as SagaRow[];
	const pages = new Map<string, WikiPage>();
	for (const title of [DB, DBZ, GT, DBS]) {
		pages.set(title, await readScrape<WikiPage>(`arcs/ja-${title.replace(/[ ()]/g, "_")}.json`));
	}

	const changes: FieldChange[] = [];
	const notes: string[] = [];
	for (const pair of PAIRS) {
		const arc = arcs.find((a) => Number(a.id) === pair.id);
		const label = `db_arcs#${pair.id}`;
		if (!arc || arc.slug !== pair.slug) {
			notes.push(`${label} — fiche absente ou slug changé (attendu ${pair.slug}) : écarté`);
			continue;
		}
		if (!isEmpty(arc.name_ja)) continue;
		const page = pages.get(pair.article)!;
		const w = page.wikitext ?? "";
		const at = w.indexOf(pair.anchor);
		if (at === -1 || !pair.anchor.includes(pair.nameJa)) {
			notes.push(`${label} « ${arc.name} » — « ${pair.anchor} » introuvable dans ${pair.article} : écarté`);
			continue;
		}
		const saga = sagas.find((s) => Number(s.id) === Number(arc.saga_id));
		const siblings = arcs.filter((a) => Number(a.saga_id) === Number(arc.saga_id));
		let proof = `« ${pair.anchor} »`;
		if (pair.check === "episodes") {
			const range = w.slice(at, at + 120).match(/第(\d+)話\s*[-–〜~]\s*第(\d+)話/);
			const ok =
				!!range &&
				!!saga &&
				siblings.length === 1 &&
				Number(range[1]) === Number(saga.episode_start) &&
				Number(range[2]) === Number(saga.episode_end);
			if (!ok) {
				notes.push(`${label} « ${arc.name} » — épisodes non concordants ou arc non unique dans sa saga : écarté`);
				continue;
			}
			proof += ` épisodes ${range![1]}–${range![2]} = saga « ${saga!.name} », seul arc de la saga`;
		} else if (pair.check === "first-ep") {
			const first = w.slice(at).match(/align="right"\|(\d+)/);
			const minOrder = Math.min(...siblings.map((a) => Number(a.order_idx)));
			const ok = !!first && !!saga && Number(first[1]) === Number(saga.episode_start) && Number(arc.order_idx) === minOrder;
			if (!ok) {
				notes.push(`${label} « ${arc.name} » — premier épisode non concordant ou arc non premier : écarté`);
				continue;
			}
			proof += ` premier épisode ${first![1]} = début de la saga « ${saga!.name} », premier arc de la saga`;
		} else proof += " (traduction littérale du nom français)";
		changes.push({
			table: "db_arcs",
			id: pair.id,
			label: arc.name,
			after: { name_ja: pair.nameJa },
			source: `ja.wikipedia « ${page.titre} » rév. ${page.revid} ; ${proof}`,
		});
	}

	printChanges(changes);
	const unmapped = arcs.filter((a) => isEmpty(a.name_ja) && !PAIRS.some((p) => p.id === Number(a.id)));
	console.log(`\n${changes.length} arc(s) ; ${unmapped.length} arc(s) sans nom japonais attesté dans les articles moissonnés`);
	if (notes.length) console.log(`\nÉcartés :\n  ${notes.join("\n  ")}`);
	if (!APPLY) console.log("\n(simulation — relancer avec --apply)");
	else {
		const done = await applyChanges(sql, changes, "fill-arcs-names");
		console.log(`\n✔ ${done.rows} arc(s), ${done.cells} cellule(s) écrites et versionnées.`);
	}
} finally {
	await sql.end();
}
