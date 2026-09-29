#!/usr/bin/env bun
/**
 * Fills `bot.db_sagas.manga_chapter_start` / `manga_chapter_end` from the arc pages of
 * the Kanzenshuu manga guide (« Corresponding: Dragon Ball Chapters 195 – 241 »), empty
 * cells only.
 *
 * SIMULATION BY DEFAULT. Nothing is written without `--apply`; one revision per saga.
 *
 * Numbering follows what the base already holds: DB/DBZ sagas use the continuous
 * numbering 1–519 of the original series (`db_manga_chapters`, series `DBFC`), DBS sagas
 * the numbering of Dragon Ball Super (series `DBS`), as the five DBS sagas already filled.
 *
 * A saga ↔ Kanzenshuu arc pairing is written by hand in `ARCS` (the names differ: « Saga
 * de Pilaf » is Kanzenshuu's « Son Goku arc »), then CHECKED against the base: the tankōbon
 * volumes of the first and last chapter (read in `db_manga_chapters`) must both fall
 * within one volume of the saga's `manga_volume_start` / `manga_volume_end`. The existing
 * volume bounds overlap at saga boundaries, hence the one-volume tolerance; a larger gap
 * means the two sources cut the story differently (measured: « Saga Cyborg » ends in
 * volume 33 where Kanzenshuu's Artificial Human arc ends in volume 30) and the saga is
 * left empty. Sagas without manga (GT, Daima, films, OAV, Resurrection F — « 漫画：未登場 »
 * on ja.wikipedia) have no entry.
 *
 * Scrape: ~/.shenron-build-tmp/scrape/meta/sagas/kz-<series>_<arc>/http.html
 *   bxc recon https://www.kanzenshuu.com/manga/<series>/<arc>/ --snapshot-dir kz-<series>_<arc>
 *
 *   bun apps/shenron/site/scripts/fill-sagas-chapters.ts            # simulation
 *   bun apps/shenron/site/scripts/fill-sagas-chapters.ts --apply
 */
import {
	APPLY,
	applyChanges,
	connect,
	type FieldChange,
	printChanges,
	readScrapeText,
} from "./_fill-meta";

/** Saga slug → Kanzenshuu arc page (`/manga/<path>/`). */
const ARCS: Record<string, string> = {
	pilaf: "db/son-goku",
	"tournament-21": "db/21st-budokai",
	"red-ribbon": "db/rr-army",
	"uranai-baba": "db/uranai-baba",
	"tournament-22b": "db/22nd-budokai",
	"piccolo-daimao": "db/demon-king-piccolo",
	"tournament-23": "db/23rd-budokai",
	saiyan: "db/saiyan",
	namek: "db/namek",
	saga_freezer: "db/freeza",
	androids: "db/artificial-human",
	cell: "db/cell",
	"great-saiyaman": "db/great-saiyaman",
	buu: "db/majin-boo",
	god: "super/battle-of-gods",
	champa: "super/champa",
	"future-trunks": "super/future-trunks",
	"tournament-of-power": "super/universe-survival",
	moro: "super/galactic-patrol",
	granolah: "super/granolla",
	"super-hero": "super/super-hero",
};

type SagaRow = {
	id: number;
	slug: string;
	name: string;
	series: string;
	manga_volume_start: number | string | null;
	manga_volume_end: number | string | null;
	manga_chapter_start: number | string | null;
	manga_chapter_end: number | string | null;
};

const sql = await connect();
try {
	const sagas = (await sql`
		select id, slug, name, series, manga_volume_start, manga_volume_end, manga_chapter_start, manga_chapter_end
		from bot.db_sagas where visible order by order_idx, id
	`) as unknown as SagaRow[];
	const chapterVolumes = (await sql`
		select c.series, c.chapter_number, v.volume_number
		from bot.db_manga_chapters c join bot.db_manga_volumes v on v.id = c.volume_id
		where c.series in ('DBFC', 'DBS')
	`) as unknown as { series: string; chapter_number: number | string; volume_number: number | string }[];
	// postgres-js returns bigint as strings: Number() everything (docs/wiki-editorial.md).
	const volumeOf = new Map(chapterVolumes.map((c) => [`${c.series}:${Number(c.chapter_number)}`, Number(c.volume_number)]));

	const changes: FieldChange[] = [];
	const notes: string[] = [];
	for (const saga of sagas) {
		const needStart = saga.manga_chapter_start === null;
		const needEnd = saga.manga_chapter_end === null;
		const path = ARCS[saga.slug];
		if (!path) {
			if (needStart || needEnd) notes.push(`db_sagas#${saga.id} « ${saga.name} » — aucun arc Kanzenshuu correspondant`);
			continue;
		}
		const html = await readScrapeText(`sagas/kz-${path.replace("/", "_")}/http.html`);
		const text = html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&#8217;/g, "’").replace(/\s+/g, " ");
		const arcName = text.match(/Dragon Ball(?: Super)?: ([^:]{3,60}? arc) Arc Information/)?.[1] ?? path;
		const m = text.match(/Corresponding: ?Dragon Ball( Super)? Chapters (\d+) [–-] (\d+) \(/);
		if (!m) {
			notes.push(`db_sagas#${saga.id} « ${saga.name} » — bornes absentes de la page Kanzenshuu ${path}`);
			continue;
		}
		const isSuper = !!m[1];
		const start = Number(m[2]);
		const end = Number(m[3]);
		const series = isSuper ? "DBS" : "DBFC";
		if (isSuper !== saga.series.startsWith("DBS")) {
			notes.push(`db_sagas#${saga.id} « ${saga.name} » — série ${saga.series} incompatible avec ${path}`);
			continue;
		}
		const report = `Kanzenshuu ${start}–${end}, base ${saga.manga_chapter_start ?? "∅"}–${saga.manga_chapter_end ?? "∅"}`;
		if (!needStart && !needEnd) {
			if (Number(saga.manga_chapter_start) !== start || Number(saga.manga_chapter_end) !== end)
				notes.push(`db_sagas#${saga.id} « ${saga.name} » — déjà rempli, divergence ${report} (non modifié)`);
			continue;
		}
		const vStart = volumeOf.get(`${series}:${start}`);
		const vEnd = volumeOf.get(`${series}:${end}`);
		const vs = saga.manga_volume_start === null ? null : Number(saga.manga_volume_start);
		const ve = saga.manga_volume_end === null ? null : Number(saga.manga_volume_end);
		if (vStart === undefined || vEnd === undefined || vs === null || ve === null) {
			notes.push(`db_sagas#${saga.id} « ${saga.name} » — contrôle par les tomes impossible (chapitres ${start}/${end} ou tomes absents)`);
			continue;
		}
		if (Math.abs(vStart - vs) > 1 || Math.abs(vEnd - ve) > 1) {
			notes.push(`db_sagas#${saga.id} « ${saga.name} » — découpage différent : « ${arcName} » = tomes ${vStart}–${vEnd}, saga = tomes ${vs}–${ve}`);
			continue;
		}
		const after: Record<string, number> = {};
		if (needStart) after.manga_chapter_start = start;
		if (needEnd) after.manga_chapter_end = end;
		changes.push({
			table: "db_sagas",
			id: saga.id,
			label: saga.name,
			after,
			source: `kanzenshuu.com/manga/${path}/ « ${arcName} » chapitres ${start}–${end} ; tomes ${vStart}–${vEnd} (db_manga_chapters ${series}) contre ${vs}–${ve}`,
		});
	}

	printChanges(changes);
	console.log(`\n${changes.length} saga(s)`);
	if (notes.length) console.log(`\nLaissés vides ou signalés :\n  ${notes.join("\n  ")}`);
	if (!APPLY) console.log("\n(simulation — relancer avec --apply)");
	else {
		const done = await applyChanges(sql, changes, "fill-sagas-chapters");
		console.log(`\n✔ ${done.rows} saga(s), ${done.cells} cellule(s) écrites et versionnées.`);
	}
} finally {
	await sql.end();
}
