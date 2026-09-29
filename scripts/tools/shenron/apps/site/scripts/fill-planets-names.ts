#!/usr/bin/env bun
/**
 * Fills `bot.db_planets.name_ja` and `name_romaji` from the Japanese Wikipedia article
 * « ドラゴンボールの地理 » (bxc scrape), empty cells only.
 *
 * SIMULATION BY DEFAULT. Nothing is written without `--apply`; one revision per planet.
 *
 * The Japanese article gives names, never the French ones, so the bridge is phonetic and
 * deliberately narrow. Each Japanese entry (`; ナメック星` under 天体, the per-series planet
 * lists, 第N宇宙…) is stripped of 惑星/小惑星/星/の星, transliterated, and reduced to a
 * consonant skeleton; the French name (« Planète Konats ») is reduced the same way
 * (r before a consonant dropped — the Japanese long vowel —, l→r, v→b, ph→f…).
 * `コナッツ星` → konattsu → knts = Konats. A planet is filled only when:
 *
 *   - exactly ONE Japanese name has that skeleton (after the universe filter: a French
 *     « (Univers 6) » demands an entry listed under 第6宇宙);
 *   - exactly ONE French row claims it — « Planète Litt » and « Planète Ritto » share
 *     `rt`, so neither is filled.
 *
 * Four names are translations, not transcriptions, and cannot be bridged by sound; they
 * are listed in `TRANSLATIONS` and the Japanese form must still exist in the article.
 * Names written in kanji the table below does not read get no `name_romaji`.
 *
 * `name_romaji` follows the existing rows: long vowels doubled (`Bejiita-sei`,
 * `Chikyuu`), `星` → `-sei`, `惑星X` → `Wakusei X`, `Xの星` → `X no Hoshi`.
 *
 * Scrape: ~/.shenron-build-tmp/scrape/meta/planets/ja-geo.json
 *   bxc wiki page "https://ja.wikipedia.org/w/index.php?title=ドラゴンボールの地理" --out ja-geo.json
 *
 *   bun apps/site/scripts/fill-planets-names.ts            # simulation
 *   bun apps/site/scripts/fill-planets-names.ts --apply
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

type PlanetRow = { id: number; name: string; name_ja: string | null; name_romaji: string | null };
type Entry = { ja: string; universes: Set<number | null>; sections: Set<string> };

/** French core name (accents dropped, lower case) → Japanese name, for names that are translated. */
const TRANSLATIONS: Record<string, string> = {
	terre: "地球",
	jupiter: "木星",
	"sans nom": "名前のない星",
	"royaume des demons": "魔界",
};
/** Readings of the kanji names, standard dictionary readings. */
const KANJI_READINGS: Record<string, string> = {
	地球: "Chikyuu",
	木星: "Mokusei",
	魔界: "Makai",
	名前のない星: "Namae no Nai Hoshi",
};

const DIGRAPHS: Record<string, string> = {
	キャ: "kya", キュ: "kyu", キョ: "kyo", シャ: "sha", シュ: "shu", ショ: "sho", チャ: "cha",
	チュ: "chu", チョ: "cho", ニャ: "nya", ニュ: "nyu", ニョ: "nyo", ヒャ: "hya", ヒュ: "hyu",
	ヒョ: "hyo", ミャ: "mya", ミュ: "myu", ミョ: "myo", リャ: "rya", リュ: "ryu", リョ: "ryo",
	ギャ: "gya", ギュ: "gyu", ギョ: "gyo", ジャ: "ja", ジュ: "ju", ジョ: "jo", ビャ: "bya",
	ビュ: "byu", ビョ: "byo", ピャ: "pya", ピュ: "pyu", ピョ: "pyo", ファ: "fa", フィ: "fi",
	フェ: "fe", フォ: "fo", ティ: "ti", ディ: "di", デュ: "dyu", トゥ: "tu", ドゥ: "du",
	ウィ: "wi", ウェ: "we", ウォ: "wo", シェ: "she", ジェ: "je", チェ: "che", ヴァ: "va",
	ヴィ: "vi", ヴェ: "ve", ヴォ: "vo", ツァ: "tsa",
};
const SINGLES: Record<string, string> = {
	ア: "a", イ: "i", ウ: "u", エ: "e", オ: "o", カ: "ka", キ: "ki", ク: "ku", ケ: "ke", コ: "ko",
	サ: "sa", シ: "shi", ス: "su", セ: "se", ソ: "so", タ: "ta", チ: "chi", ツ: "tsu", テ: "te",
	ト: "to", ナ: "na", ニ: "ni", ヌ: "nu", ネ: "ne", ノ: "no", ハ: "ha", ヒ: "hi", フ: "fu",
	ヘ: "he", ホ: "ho", マ: "ma", ミ: "mi", ム: "mu", メ: "me", モ: "mo", ヤ: "ya", ユ: "yu",
	ヨ: "yo", ラ: "ra", リ: "ri", ル: "ru", レ: "re", ロ: "ro", ワ: "wa", ヲ: "wo", ン: "n",
	ガ: "ga", ギ: "gi", グ: "gu", ゲ: "ge", ゴ: "go", ザ: "za", ジ: "ji", ズ: "zu", ゼ: "ze",
	ゾ: "zo", ダ: "da", ヂ: "ji", ヅ: "zu", デ: "de", ド: "do", バ: "ba", ビ: "bi", ブ: "bu",
	ベ: "be", ボ: "bo", パ: "pa", ピ: "pi", プ: "pu", ペ: "pe", ポ: "po", ヴ: "vu", ァ: "a",
	ィ: "i", ゥ: "u", ェ: "e", ォ: "o",
};

/** Kana (and embedded ASCII) → rōmaji with doubled long vowels; null on any kanji. */
function kanaToRomaji(input: string): string | null {
	const text = input.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
	let out = "";
	let geminate = false;
	let lastWasKana = false;
	for (let i = 0; i < text.length; ) {
		const ch = text[i]!;
		if (/[A-Za-z0-9.]/.test(ch)) {
			if (lastWasKana) out += " ";
			out += ch;
			lastWasKana = false;
			i++;
			continue;
		}
		if (ch === "ッ") {
			geminate = true;
			i++;
			continue;
		}
		if (ch === "ー") {
			const vowel = out.match(/[aeiou]$/)?.[0];
			if (!vowel) return null;
			out += vowel;
			i++;
			continue;
		}
		const syllable = DIGRAPHS[text.slice(i, i + 2)] ?? SINGLES[ch];
		if (!syllable) return null;
		if (geminate) out += syllable[0];
		if (out.endsWith("n") && lastWasKana && text[i - 1] === "ン" && /^[aeiouy]/.test(syllable)) out += "'";
		out += syllable;
		geminate = false;
		lastWasKana = true;
		i += DIGRAPHS[text.slice(i, i + 2)] ? 2 : 1;
	}
	return out || null;
}

/** Japanese name without the generic planet words. */
function jaCore(ja: string): { prefix: string; core: string; suffix: string } {
	let core = ja;
	let prefix = "";
	let suffix = "";
	for (const [p, r] of [["小惑星", "Shouwakusei "], ["新惑星", "Shin Wakusei "], ["惑星", "Wakusei "]] as const) {
		if (core.startsWith(p) && core.length > p.length) {
			prefix = r;
			core = core.slice(p.length);
			break;
		}
	}
	if (core.endsWith("の星") && core.length > 2) {
		suffix = " no Hoshi";
		core = core.slice(0, -2);
	} else if (core.endsWith("星") && core.length > 1) {
		suffix = "-sei";
		core = core.slice(0, -1);
	}
	return { prefix, core, suffix };
}

function romajiOf(ja: string): string | null {
	if (KANJI_READINGS[ja]) return KANJI_READINGS[ja]!;
	const { prefix, core, suffix } = jaCore(ja);
	const r = kanaToRomaji(core);
	if (!r) return null;
	return `${prefix}${r.charAt(0).toUpperCase()}${r.slice(1)}${suffix}`;
}

/** Consonants of a name, each with the vowel that follows it (null when none is written). */
type Phonetic = { lead: string | null; units: { c: string; v: string | null }[] };

/**
 * Phonetic units shared by a Latin spelling (`latinSpelling`) and a Hepburn transcription.
 * The Latin side drops what Japanese writes as a long vowel or does not hear: r before a
 * consonant (« Yardrat », « Shartsu »), word-final e (« Freezer » → friz), and reads the
 * French/English vowel digraphs (au → o, eu → u, ee/ea → i, ai → e).
 */
function phonetic(input: string, latinSpelling: boolean): Phonetic {
	let s = input.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
	s = s.replace(/\bn[o°]\.?\s*(?=\d)/g, "");
	if (latinSpelling) {
		s = s.replace(/r(?=[^aeiouy]|$)/g, "");
		s = s.replace(/eau|au/g, "o").replace(/eu|ou/g, "u").replace(/ee|ea/g, "i").replace(/ai/g, "e");
		s = s.replace(/([a-z]{3,})e\b/g, "$1");
	}
	s = s
		.replace(/ph/g, "f")
		.replace(/l/g, "r")
		.replace(/v/g, "b")
		.replace(/c(?=[eiy])/g, "s")
		.replace(/ck|c(?!h)|q/g, "k")
		.replace(/x/g, "ks")
		.replace(/g(?=[eiy])/g, "j")
		.replace(/m(?=[pb])/g, "n")
		.replace(/[^a-z0-9]/g, "");
	const out: Phonetic = { lead: null, units: [] };
	const isVowel = (ch: string | undefined) => !!ch && /[aeiou]/.test(ch);
	let i = 0;
	while (i < s.length && isVowel(s[i])) {
		out.lead ??= s[i]!;
		i++;
	}
	while (i < s.length) {
		const c = /^(sh|ch)/.test(s.slice(i)) ? s.slice(i, i + 2) : s[i]!;
		i += c.length;
		let v: string | null = null;
		while (i < s.length && isVowel(s[i])) {
			v ??= s[i]!;
			i++;
		}
		const last = out.units[out.units.length - 1];
		// A doubled consonant (ッ, « tt ») is one unit; « Babari » keeps its two b.
		if (last && last.c === c && last.v === null) last.v = v;
		else out.units.push({ c, v });
	}
	return out;
}
const skeleton = (p: Phonetic) => p.units.map((u) => u.c).join("");
/** Written vowels must agree where both spellings write one (« Zalt » ≠ ゾリート). */
const vowelsAgree = (fr: Phonetic, ja: Phonetic) =>
	(!fr.lead || !ja.lead || fr.lead === ja.lead) &&
	fr.units.every((u, k) => !u.v || !ja.units[k]?.v || u.v === ja.units[k]!.v);

const frKey = (s: string) =>
	s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

function parseEntries(wikitext: string): Map<string, Entry> {
	const entries = new Map<string, Entry>();
	let section = "";
	const add = (raw: string, sec: string) => {
		const ja = raw
			.replace(/<ref[^>]*\/>/g, "")
			.replace(/<ref[\s\S]*?(<\/ref>|$)/g, "")
			.replace(/<\/?span[^>]*>/g, "")
			.replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, "$1")
			.replace(/\[\[([^\]]+)\]\]/g, "$1")
			.replace(/[\s　]+/g, "")
			.trim();
		if (!ja) return;
		const universe = sec.match(/第(\d+)宇宙/)?.[1];
		const e = entries.get(ja) ?? { ja, universes: new Set<number | null>(), sections: new Set<string>() };
		e.universes.add(universe ? Number(universe) : null);
		e.sections.add(sec);
		entries.set(ja, e);
	};
	for (const line of wikitext.split("\n")) {
		const heading = line.match(/^(=+)\s*(.+?)\s*\1\s*$/);
		if (heading) {
			section = heading[2]!;
			if (/^魔界$|の星$/.test(section)) add(section, section);
			continue;
		}
		if (!/天体|に登場した惑星|^第\d+宇宙$|12宇宙とは異なる空間/.test(section)) continue;
		const item = line.match(/^:?;\s*(.+)$/);
		if (item) add(item[1]!, section);
	}
	return entries;
}

const sql = await connect();
try {
	const page = await readScrape<WikiPage>("planets/ja-geo.json");
	const entries = parseEntries(page.wikitext ?? "");
	const bySkeleton = new Map<string, { entry: Entry; sound: Phonetic }[]>();
	for (const e of entries.values()) {
		const r = kanaToRomaji(jaCore(e.ja).core);
		if (!r) continue;
		const sound = phonetic(r, false);
		const k = skeleton(sound);
		if (k) bySkeleton.set(k, [...(bySkeleton.get(k) ?? []), { entry: e, sound }]);
	}

	const rows = (await sql`
		select id, name, name_ja, name_romaji from bot.db_planets where visible order by id
	`) as unknown as PlanetRow[];

	type Proposal = { row: PlanetRow; entry: Entry; claim: string; how: string };
	const proposals: Proposal[] = [];
	const notes: string[] = [];
	for (const row of rows) {
		if (!isEmpty(row.name_ja)) continue;
		const universe = row.name.match(/\(Univers (\d+)\)\s*$/)?.[1];
		const core = row.name
			.replace(/\s*\(Univers \d+\)\s*$/, "")
			.replace(/^(Planètes?|Étoile)\s+(de\s+|du\s+|d'|l')?/i, "")
			.trim();
		const translated = TRANSLATIONS[frKey(core)];
		const sound = phonetic(core, true);
		const key = translated ? `tr:${translated}` : `sk:${skeleton(sound)}`;
		let candidates = translated
			? [...entries.values()].filter((e) => e.ja === translated)
			: (bySkeleton.get(skeleton(sound)) ?? [])
					.filter((c) => vowelsAgree(sound, c.sound))
					// 新惑星ベジータ is the « nouvelle » planet Vegeta, not planet Vegeta itself.
					.filter((c) => !c.entry.ja.startsWith("新") || /nouvelle/i.test(row.name))
					.map((c) => c.entry);
		if (universe) candidates = candidates.filter((e) => e.universes.has(Number(universe)));
		if (candidates.length !== 1) {
			notes.push(`db_planets#${row.id} « ${row.name} » — ${candidates.length === 0 ? "aucune entrée japonaise" : `${candidates.length} entrées japonaises (${candidates.map((c) => c.ja).join(", ")})`}`);
			continue;
		}
		proposals.push({
			row,
			entry: candidates[0]!,
			claim: `${key}|${universe ?? ""}`,
			how: translated ? `traduction « ${core} » = ${translated}` : `phonétique « ${skeleton(sound)} », voyelles concordantes`,
		});
	}

	const claimCount = new Map<string, number>();
	for (const p of proposals) claimCount.set(p.claim, (claimCount.get(p.claim) ?? 0) + 1);
	const changes: FieldChange[] = [];
	for (const p of proposals) {
		if ((claimCount.get(p.claim) ?? 0) > 1) {
			notes.push(`db_planets#${p.row.id} « ${p.row.name} » — ${p.how} revendiqué par plusieurs fiches : écarté`);
			continue;
		}
		const after: Record<string, string> = { name_ja: p.entry.ja };
		const romaji = romajiOf(p.entry.ja);
		if (isEmpty(p.row.name_romaji) && romaji) after.name_romaji = romaji;
		if (!romaji) notes.push(`db_planets#${p.row.id} « ${p.row.name} » — name_romaji : lecture de ${p.entry.ja} non établie`);
		changes.push({
			table: "db_planets",
			id: p.row.id,
			label: p.row.name,
			after,
			source: `ja.wikipedia « ${page.titre} » rév. ${page.revid}, section ${[...p.entry.sections].join(" / ")} ; ${p.how}`,
		});
	}

	printChanges(changes);
	console.log(`\n${changes.length} planète(s) : name_ja ${changes.length}, name_romaji ${changes.filter((c) => c.after.name_romaji).length}`);
	if (notes.length) console.log(`\nLaissés vides :\n  ${notes.join("\n  ")}`);
	if (!APPLY) console.log("\n(simulation — relancer avec --apply)");
	else {
		const done = await applyChanges(sql, changes, "fill-planets-names");
		console.log(`\n✔ ${done.rows} planète(s), ${done.cells} cellule(s) écrites et versionnées.`);
	}
} finally {
	await sql.end();
}
