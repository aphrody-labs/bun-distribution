/**
 * Canonical technique lexicon: what the databooks say about the techniques of
 * the manga (and a few documented anime/film ones), keyed by `bot.db_techniques`.
 *
 * PURE DATA — no side effect, no database access. It is shared by
 * `ja-techniques.ts` (name_ja, name_romaji) and `fill-technique-debuts.ts`
 * (debut_chapter_id, creator_id), which both re-verify every value against the
 * corpus before writing anything.
 *
 * Why an explicit, id-keyed table rather than a name match:
 * - 802 of the 825 rows are video-game skills (Xenoverse/Dokkan localisation
 *   labels). Only rows whose identity with a databook headword is unambiguous
 *   are listed here; game variants ("Attaque Garric", "Explosion finale",
 *   "Kaioken x3") are deliberately absent.
 * - `name` is kept as a guard: if the row has been renamed since, the entry is
 *   skipped instead of landing on the wrong technique.
 *
 * Evidence rules (enforced by the scripts, documented here):
 * - `quote` evidence: the whitespace-stripped transcription of the planche must
 *   contain the whitespace-stripped quote, and the planche must not be judged
 *   faulty by `defautDePlanche`.
 * - `scan` evidence: a value read on the scan itself because the transcription
 *   is wrong (the two dictionaries' OCR drops digits: Daizenshuu 7 gives
 *   其之二百十六 for the Kaiōken, the scan and two other books say 226).
 * - A debut chapter needs two agreeing evidences from two different books.
 *   Where the books disagree, the value is left out (see DIVERGENCES).
 *
 * Sources: Daizenshuu 7 技事典 (databook 4, planches 120-160), Chōzenshū 4
 * 技事典 (databook 19, planches 133-175), Super Exciting Guide — Character
 * Volume, "Battle Skill" pages (databook 6, planches 74-87).
 */

export type Evidence =
	| { book: number; page: number; quote: string }
	| { book: number; page: number; scan: string }
	/** A planche of the manga corpus (`bot.db_manga_pages`, series DB): `tome` is e.g. "vol10". */
	| { manga: string; page: number; quote: string };

export interface TechniqueEntry {
	/** `bot.db_techniques.id` */
	id: number;
	/** Exact current `name` in base — identity guard. */
	name: string;
	/** Japanese headword as the databooks write it. */
	ja: string;
	/**
	 * Kana reading, words separated by single spaces (segmentation is only
	 * presentational). Must be attested in the corpus unless the headword is
	 * itself pure kana. Omitted when no planche attests the reading of a kanji.
	 */
	reading?: string;
	/** Manga chapter number (tankōbon numbering 其之N, series DBFC). */
	debutChapter?: { number: number; evidence: Evidence[] };
	/** `bot.db_characters.id` of the inventor, on an explicit "編み出した"-type sentence. */
	creator?: { characterId: number; evidence: Evidence[] };
}

export const BOOK_LABELS: Record<number, string> = {
	4: "Daizenshuu 7 — Dragon Ball Daijiten",
	6: "Super Exciting Guide — Character Volume",
	19: "Chōzenshū 4 — Super Encyclopedia",
};

/** Technique-dictionary planches: a name_ja must be a headword found there. */
export const DICTIONARY_PAGES: { book: number; from: number; to: number }[] = [
	{ book: 4, from: 120, to: 160 },
	{ book: 19, from: 133, to: 175 },
	{ book: 6, from: 74, to: 87 },
];

export const TECHNIQUES: TechniqueEntry[] = [
	{
		id: 114,
		name: "Kamehameha",
		ja: "かめはめ波",
		reading: "かめはめは",
		debutChapter: {
			number: 14,
			evidence: [
				{ book: 4, page: 127, quote: "初【其之十四【系】気功" },
				{ book: 19, page: 141, quote: "かめはめ波韧14柔気功人亀仙人" },
				{ book: 6, page: 74, quote: "代表技：かめはめ波初登場：01巻其之十四" },
			],
		},
	},
	{
		id: 115,
		name: "Super Kamehameha",
		ja: "超かめはめ波",
		debutChapter: {
			number: 185,
			evidence: [
				{ book: 19, page: 142, quote: "超かめはめ波初185系気功人孫悟空" },
				{ book: 4, page: 127, quote: "超初其之百八十五【人】孫悟空特天界での神様との修行" },
			],
		},
	},
	{
		id: 128,
		name: "Genkidama",
		ja: "元気玉",
		reading: "げんきだま",
		debutChapter: {
			number: 212,
			evidence: [
				{ book: 4, page: 135, quote: "元気玉【初】其之二百十二【系】気功【人】孫悟空" },
				{ book: 6, page: 80, quote: "代表技：元気玉初登場：15巻其之二百十二" },
			],
		},
	},
	{
		id: 129,
		name: "Téléportation",
		ja: "瞬間移動",
		reading: "しゅんかん いどう",
		debutChapter: {
			number: 336,
			evidence: [
				{ book: 19, page: 153, quote: "瞬間移動初336系移動人孫悟空、セル" },
				{ book: 6, page: 82, quote: "瞬間移動初登場：23巻其之三百三十六" },
			],
		},
	},
	{ id: 136, name: "Kamehameha x10", ja: "10倍かめはめ波" },
	{
		id: 144,
		name: "Kamekameha",
		ja: "かめかめ波",
		reading: "かめかめは",
		debutChapter: {
			number: 434,
			evidence: [
				{ book: 4, page: 126, quote: "かめかめ波【初】其之四百三十四【系】気功" },
				{ book: 19, page: 141, quote: "かめかめ波韧434柔気功人孫悟天" },
			],
		},
	},
	{
		id: 147,
		name: "Masenko",
		ja: "魔閃光",
		reading: "ませんこう",
		debutChapter: {
			number: 223,
			evidence: [
				{ book: 19, page: 173, quote: "魔閃光初223系気功人孫悟飯" },
				{ book: 6, page: 75, quote: "魔閃光初登場：15巻其之二百二十三" },
			],
		},
	},
	{
		id: 159,
		name: "Kienzan",
		ja: "気円斬",
		reading: "きえんざん",
		debutChapter: {
			number: 221,
			evidence: [
				{ book: 6, page: 77, quote: "代表技：気円斬初登場：15巻其之二百二十一" },
				{
					book: 4,
					page: 128,
					scan: "entrée 気円斬 lue sur le scan : 【初】其之二百二十一 (la transcription porte 二百十一)",
				},
			],
		},
	},
	{
		id: 166,
		name: "Technique du loup",
		ja: "狼牙風風拳",
		reading: "ろうが ふうふうけん",
		debutChapter: {
			number: 8,
			evidence: [
				{ book: 6, page: 84, quote: "代表技：狼牙風風拳初登場：01巻其之八" },
				{ book: 19, page: 175, quote: "初8系体術人ヤムチャ、ゴテンクス特盗賊だったヤムチャが、独自に編み出した" },
				{ book: 4, page: 160, quote: "【初】其之八【系】体術【人】ヤムチャ【特】盗賊だったヤムチャが" },
			],
		},
	},
	{
		id: 171,
		name: "Image rémanente",
		ja: "残像拳",
		reading: "ざんぞうけん",
		debutChapter: {
			number: 43,
			evidence: [
				{ book: 4, page: 138, quote: "残像拳【初】其之四十三【系】" },
				{ book: 19, page: 151, quote: "残像拳初43系体術人ジャッキー・チューン" },
				{ book: 6, page: 86, quote: "残像拳初登場：03巻其之四十三" },
			],
		},
	},
	{
		id: 173,
		name: "Dodompa",
		ja: "どどん波",
		debutChapter: {
			number: 86,
			evidence: [
				{ book: 4, page: 148, quote: "どどん波【初】其之八十六【系】気功【人】桃白白" },
				{ book: 6, page: 79, quote: "どどん波初登場：06巻其之八十六" },
			],
		},
		creator: {
			characterId: 1238,
			evidence: [{ book: 4, page: 148, quote: "鶴仙人が編み出した鶴仙流暗殺奥義" }],
		},
	},
	{
		id: 174,
		name: "Kikoho",
		ja: "気功砲",
		reading: "きこうほう",
		debutChapter: {
			number: 133,
			evidence: [
				{ book: 19, page: 145, quote: "気功砲初133系気功丸天津飯" },
				{ book: 6, page: 76, quote: "代表技：気功砲初登場：09巻其之百三十三" },
			],
		},
	},
	{
		id: 175,
		name: "Attaque volley-ball",
		ja: "排球拳",
		debutChapter: {
			number: 129,
			evidence: [
				{ book: 4, page: 150, quote: "排球拳【初】其之百二十九" },
				{ book: 19, page: 164, quote: "排球拳初129系体術人天津飯" },
				{ book: 6, page: 84, quote: "排球拳初登場：09巻其之百二十九" },
			],
		},
	},
	{
		id: 176,
		name: "Morsure du soleil",
		ja: "太陽拳",
		reading: "たいようけん",
		debutChapter: {
			number: 124,
			evidence: [
				{ book: 19, page: 159, quote: "太陽拳初124系気功人天津飯" },
				{ book: 4, page: 145, quote: "太陽拳【初】其之百二十四" },
				{ book: 6, page: 81, quote: "太陽拳初登場：09巻其之百二十四" },
			],
		},
	},
	{
		id: 188,
		name: "Canon Garric",
		ja: "ギャリック砲",
		reading: "ぎゃりっく ほう",
		debutChapter: {
			number: 231,
			evidence: [
				{ book: 19, page: 146, quote: "ギャリック砲初231系気功Ⓐベジータ" },
				{ book: 6, page: 75, quote: "ギャリック砲初登場：16巻其之二百三十一" },
			],
		},
	},
	{
		id: 201,
		name: "Recoom Eraser Gun",
		ja: "リクームイレイザーガン",
		reading: "リクーム イレイザー ガン",
		debutChapter: {
			number: 277,
			evidence: [
				{ book: 19, page: 174, quote: "リクームイレイザーガン初277" },
				{ book: 6, page: 79, quote: "リクームイレイザーガン初登場：19巻其之二百七十七" },
			],
		},
	},
	{
		id: 202,
		name: "Recoom Kick",
		ja: "リクームキック",
		reading: "リクーム キック",
		debutChapter: {
			number: 275,
			evidence: [
				{ book: 19, page: 175, quote: "リクームキック初275系体術人リクーム" },
				{ book: 4, page: 159, quote: "キック【初】其之二百七十五【系】体術" },
			],
		},
	},
	{ id: 215, name: "Rayon mortel", ja: "デスビーム", reading: "デス ビーム" },
	{
		id: 262,
		name: "Big bang",
		ja: "ビッグバンアタック",
		reading: "ビッグ バン アタック",
		debutChapter: {
			number: 344,
			evidence: [
				{ book: 19, page: 167, quote: "ビッグバンアタック初344系気功人ベジータ" },
				{ book: 6, page: 75, quote: "ビッグバンアタック初登場：23巻其之三百四十四" },
			],
		},
	},
	{ id: 286, name: "Big Bang Kamehameha", ja: "ビッグバンかめはめ波" },
	{
		id: 337,
		name: "Néo-technique du loup",
		ja: "新狼牙風風拳",
		debutChapter: {
			number: 117,
			evidence: [
				{ book: 4, page: 160, quote: "新【初】其之百十七【人】ヤムチャ" },
				// The manga shows the new version inside chapter 117: planche 71 names it,
				// and the table of contents of the same tome places pages 63-77 in chapter 117.
				{ manga: "vol10", page: 71, quote: "LE NOUVEAU ROGA FUFU KEN" },
				{ manga: "vol10", page: 2, quote: "Chapitre 117Le Kamé Hamé Ha de Yamcha Page 063 Chapitre 118" },
			],
		},
	},
	{
		id: 454,
		name: "Final flash",
		ja: "ファイナルフラッシュ",
		reading: "ファイナル フラッシュ",
		debutChapter: {
			number: 384,
			evidence: [
				{ book: 19, page: 168, quote: "ファイナルフラッシュ初384" },
				{ book: 6, page: 75, quote: "ファイナルフラッシュ初登場：26巻其之三百八十四" },
				{ book: 4, page: 153, quote: "ファイナルフラッシュ【初】其之三百八十四【系】気功" },
			],
		},
	},
	{
		id: 494,
		name: "Makankosappo",
		ja: "魔貫光殺砲",
		debutChapter: {
			number: 201,
			evidence: [
				{ book: 19, page: 172, quote: "魔貫光殺砲初201系気功人ピッコロ、セル" },
				{ book: 6, page: 79, quote: "代表技：魔貫光殺砲初登場：14巻其之二百一" },
			],
		},
	},
	{
		id: 558,
		name: "Super Genkidama",
		ja: "超元気玉",
		debutChapter: {
			number: 514,
			evidence: [
				{ book: 19, page: 149, quote: "超元気玉初514" },
				{ book: 4, page: 136, quote: "超元気玉光線眼攻撃跳ね返しきつ【初】其之五百十四" },
			],
		},
	},
	{
		id: 567,
		name: "Sokidan",
		ja: "操気弾",
		reading: "そうきだん",
		debutChapter: {
			number: 175,
			evidence: [
				{ book: 19, page: 158, quote: "繰気弾初175系気功人ヤムチャ" },
				{ book: 6, page: 78, quote: "操気弾初登場：12巻其之百七十五" },
			],
		},
	},
	{
		id: 580,
		name: "Échange des corps",
		ja: "ボディチェンジ",
		reading: "ボディ チェンジ",
		debutChapter: {
			number: 286,
			evidence: [
				{ book: 19, page: 172, quote: "ボディチェンジ初286系特殊人ギニュー" },
				{ book: 6, page: 87, quote: "代表技：ボディチェンジ初登場：20巻其之二百八十六" },
				{ book: 4, page: 156, quote: "ボディチェンジ【初】其之二百八十六【系】特殊【人】ギニュー" },
			],
		},
	},
	{
		id: 596,
		name: "Super fantômes kamikazes",
		ja: "スーパーゴーストカミカゼアタック",
		reading: "スーパー ゴースト カミカゼ アタック",
		debutChapter: {
			number: 490,
			evidence: [
				{ book: 6, page: 78, quote: "代表技：スーパーゴーストカミカゼアタック初登場：33巻其之四百九十" },
				{ book: 19, page: 155, quote: "カミカゼアタック初490系気功" },
			],
		},
	},
	{ id: 620, name: "Poing du dragon", ja: "龍拳", reading: "りゅうけん" },
	{ id: 56, name: "Power Ball", ja: "パワーボール", reading: "パワー ボール" },
];

/**
 * Disagreements between the books, kept out of the base on purpose. Reported
 * by `fill-technique-debuts.ts` so nobody "fixes" them by picking one.
 */
export const DIVERGENCES: { id: number; note: string }[] = [
	{
		id: 201,
		note: "Daizenshuu 7 pl.159 donne 其之二百七十六 ; Chōzenshū 4 pl.174 et Super Exciting Guide pl.79 donnent 277 (retenu).",
	},
	{
		id: 56,
		note: "Daizenshuu 7 pl.152 seul lisible (其之二百三十一) ; l'entrée du Chōzenshū 4 pl.166 a perdu son numéro : non écrit.",
	},
];

/** Whitespace and layout marks removed before comparing a quote with a transcription. */
export function normalizeForQuote(text: string): string {
	return text.normalize("NFC").replace(/[\s*#▲▼◀▶　]/g, "");
}

/** Katakana → hiragana (the prolonged sound mark ー is kept). */
export function toHiragana(text: string): string {
	return text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** Only the kana of a text, folded to hiragana — furigana become contiguous. */
export function kanaProjection(text: string): string {
	return toHiragana(text.replace(/[^ぁ-ゖァ-ヺー]/g, ""));
}

const DIGRAPHS: Record<string, string> = {
	きゃ: "kya", きゅ: "kyu", きょ: "kyo", しゃ: "sha", しゅ: "shu", しょ: "sho", しぇ: "she",
	ちゃ: "cha", ちゅ: "chu", ちょ: "cho", ちぇ: "che", にゃ: "nya", にゅ: "nyu", にょ: "nyo",
	ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo", みゃ: "mya", みゅ: "myu", みょ: "myo",
	りゃ: "rya", りゅ: "ryu", りょ: "ryo", ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
	じゃ: "ja", じゅ: "ju", じょ: "jo", じぇ: "je", びゃ: "bya", びゅ: "byu", びょ: "byo",
	ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo", てぃ: "ti", でぃ: "di", でゅ: "dyu", とぅ: "tu",
	ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo", うぃ: "wi", うぇ: "we", うぉ: "wo",
	つぁ: "tsa", ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo",
};

const MONOGRAPHS: Record<string, string> = {
	あ: "a", い: "i", う: "u", え: "e", お: "o", か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
	さ: "sa", し: "shi", す: "su", せ: "se", そ: "so", た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
	な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no", は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
	ま: "ma", み: "mi", む: "mu", め: "me", も: "mo", や: "ya", ゆ: "yu", よ: "yo",
	ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro", わ: "wa", を: "o",
	が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go", ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
	だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do", ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
	ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po", ゔ: "vu",
	ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o", ゃ: "ya", ゅ: "yu", ょ: "yo",
};

const MACRON: Record<string, string> = { a: "ā", i: "ī", u: "ū", e: "ē", o: "ō" };

/** One kana word → modified Hepburn with macrons (かいおうけん → kaiōken). */
function wordToHepburn(word: string): string {
	const kana = toHiragana(word);
	let out = "";
	let geminate = false;
	for (let i = 0; i < kana.length; i++) {
		const pair = kana.slice(i, i + 2);
		const ch = kana[i]!;
		let syllable: string;
		if (DIGRAPHS[pair]) {
			syllable = DIGRAPHS[pair]!;
			i++;
		} else if (ch === "っ") {
			geminate = true;
			continue;
		} else if (ch === "ん") {
			const next = kana[i + 1];
			const nextRoman = next ? (MONOGRAPHS[next] ?? "") : "";
			syllable = /^[aiueoy]/.test(nextRoman) ? "n'" : "n";
		} else if (ch === "ー") {
			const last = out.slice(-1);
			if (MACRON[last]) out = out.slice(0, -1) + MACRON[last];
			continue;
		} else if (MONOGRAPHS[ch]) {
			syllable = MONOGRAPHS[ch]!;
			// Long vowels: おう / おお → ō, うう → ū (within the word).
			const last = out.slice(-1);
			if ((ch === "う" && (last === "o" || last === "u")) || (ch === "お" && last === "o")) {
				out = out.slice(0, -1) + MACRON[last]!;
				continue;
			}
		} else {
			throw new Error(`kana non romanisable : « ${ch} » dans « ${word} »`);
		}
		if (geminate) {
			out += syllable.startsWith("ch") ? "t" : syllable[0];
			geminate = false;
		}
		out += syllable;
	}
	return out;
}

/** Spaced kana reading → capitalised Hepburn words. */
export function toHepburn(reading: string): string {
	return reading
		.trim()
		.split(/\s+/)
		.map((w) => {
			const r = wordToHepburn(w);
			return r.charAt(0).toUpperCase() + r.slice(1);
		})
		.join(" ");
}
