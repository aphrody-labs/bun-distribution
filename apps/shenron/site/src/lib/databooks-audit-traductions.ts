// SPDX-License-Identifier: Apache-2.0

/**
 * Databooks — **audit a posteriori des traductions françaises** (module pur).
 *
 * `refus()` (databooks-traduction.ts) juge une traduction AU DÉPÔT, seule face à
 * sa source. Il a laissé passer, le 2026-09-14, des milliers de planches
 * corrompues par des écrivains automatiques :
 *   - jetons de masquage jamais réinjectés (« Zêta010 » pour 亀仙人) ;
 *   - entrées courtes du lexique appliquées au milieu d'un mot (セル dans
 *     カプセル → « Capsule Cell Corporation », ディス dans ディスクロス →
 *     « Croix Dispo ») ;
 *   - bruit d'OCR traduit mot à mot (« 的 あ 无 そ » → « cible Ah Non Cela ») ;
 *   - textes rédigés de mémoire, sans rapport avec la planche (titres, dates et
 *     personnages absents de la source) ;
 *   - copies brutes de la source dans le champ de traduction.
 *
 * Chaque détecteur rend des `Signal` pondérés et déterministes ; `auditerPlanche`
 * les somme en un verdict. Seuls les verdicts `corrompu` sont mis en quarantaine
 * par le script `scripts/audit-traductions-databooks.ts` ; `suspect` reste un
 * signalement à relire.
 */
import { proportionJaponais, katakanaVersHiragana } from "./ja/normalisation";

export interface Signal {
	code: string;
	poids: number;
	detail: string;
	/** Défaut établi à lui seul (pas une présomption) : quarantaine directe. */
	certain?: boolean;
}

type Niveau = "sain" | "suspect" | "corrompu";

export interface VerdictPlanche {
	score: number;
	niveau: Niveau;
	signaux: Signal[];
}

export interface EntreeLexique {
	ja: string;
	fr: string;
	kind: string;
}

/** Au-delà : quarantaine. Calibré sur le corpus du 2026-09-14 (voir le script). */
export const SEUIL_CORROMPU = 6;
/** Au-delà : signalé pour relecture, sans action. */
export const SEUIL_SUSPECT = 3;

// ── Normalisations ──────────────────────────────────────────────────────────

/** Minuscules, sans accents, ponctuation réduite à des espaces simples. */
function plier(s: string): string {
	return ` ${s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()} `;
}

/** Forme d'appariement japonaise : sans espaces, points médians, allongements ; kana unifiés. */
function plierJa(s: string): string {
	return katakanaVersHiragana(s.replace(/[・･·\s]/g, "").replace(/ー/g, ""));
}

const KANA = /[぀-ゟ゠-ヿ]/g;
const HAN = /[一-鿿]/g;

/** Texte en caractères chinois sans kana : ni le lexique japonais ni les lectures ne s'y appliquent. */
function estSourceChinoise(src: string): boolean {
	const kana = src.match(KANA)?.length ?? 0;
	const han = src.match(HAN)?.length ?? 0;
	return han >= 20 && kana / (kana + han) < 0.05;
}

/** La source est-elle du japonais (ou du chinois), par opposition à un OCR français ? */
function estSourceAsiatique(src: string): boolean {
	return proportionJaponais(src) >= 0.2;
}

// ── Nombres ─────────────────────────────────────────────────────────────────

const CHIFFRES_KANJI: Record<string, number> = {
	〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const UNITES_KANJI: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** « 二百五十七 » → 257, « 三十六 » → 36, « 一九九〇 » → 1990. `null` si ce n'est pas un nombre. */
export function kanjiVersNombre(s: string): number | null {
	if (!s || !/^[〇零一二三四五六七八九十百千万]+$/.test(s)) return null;
	if (!/[十百千万]/.test(s)) {
		// Notation positionnelle (一九九〇).
		return Number([...s].map((c) => CHIFFRES_KANJI[c]).join(""));
	}
	let total = 0;
	let bloc = 0;
	let chiffre = 0;
	for (const c of s) {
		if (c in CHIFFRES_KANJI) chiffre = CHIFFRES_KANJI[c]!;
		else if (c === "万") {
			total += (bloc + chiffre) * 10000;
			bloc = 0;
			chiffre = 0;
		} else {
			bloc += (chiffre || 1) * UNITES_KANJI[c]!;
			chiffre = 0;
		}
	}
	return total + bloc + chiffre;
}

/** Nombres d'au moins deux chiffres cités par un texte (chiffres pleine chasse, cerclés et kanji compris). */
export function nombresDe(texte: string): Set<number> {
	const t = texte
		.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
		.replace(/[①-⑳]/g, (c) => ` ${c.charCodeAt(0) - 0x245f} `)
		.replace(/(\d)[ .,  ](\d{3})(?!\d)/g, "$1$2");
	const out = new Set<number>();
	for (const m of t.matchAll(/\d+/g)) {
		const n = Number(m[0]);
		if (m[0].length >= 2 && Number.isFinite(n)) out.add(n);
	}
	for (const m of texte.matchAll(/[〇零一二三四五六七八九十百千万]{2,}/g)) {
		const n = kanjiVersNombre(m[0]);
		if (n !== null && n >= 10) out.add(n);
	}
	return out;
}

/** Un nombre français est-il justifié par la source (années abrégées '87 ↔ 1987 comprises) ? */
function nombreJustifie(n: number, source: Set<number>): boolean {
	if (source.has(n)) return true;
	if (n >= 1900 && n < 2100 && source.has(n % 100)) return true;
	if (n < 100 && (source.has(1900 + n) || source.has(2000 + n))) return true;
	return false;
}

// ── Détecteurs ──────────────────────────────────────────────────────────────

/** Jeton de masquage du lexique jamais réinjecté (`Zeta010`, `Zêta001`, `Yuni002`). */
const JETON_MASQUAGE = /(?<![\p{L}\d])(?:z[eêéèë]ta|yuni)[ _-]?\d{3}(?!\d)/giu;

export function signalJetons(fr: string, src: string): Signal | null {
	const jetons = [...new Set(fr.match(JETON_MASQUAGE) ?? [])];
	const legitimes = jetons.filter((j) => src.includes(j));
	const fuites = jetons.filter((j) => !legitimes.includes(j));
	if (fuites.length === 0) return null;
	return {
		code: "jeton-masquage",
		poids: 10,
		certain: true,
		detail: `jeton(s) de masquage non réinjecté(s) : ${fuites.slice(0, 5).join(", ")}`,
	};
}

/** Mot répété d'affilée sur une même ligne (« Terre Terre »), absent de la source. */
export function signalMotsDoubles(fr: string, src: string, nomsReduplicatifs: Set<string> = new Set()): Signal | null {
	const doubles = new Set<string>();
	for (const m of fr.matchAll(/(?<![\p{L}\d])(\p{L}{3,})[ \t]+\1(?![\p{L}\d])/giu)) {
		const mot = m[1]!;
		// Onomatopées et répétitions voulues (« Non non », « Allez allez ») : minuscules
		// tolérées ; l'artefact de substitution touche des NOMS (majuscule initiale).
		if (!/^\p{Lu}/u.test(mot)) continue;
		// Noms officiellement redoublés (« Tao Pai Pai ») : ce n'est pas un artefact.
		if (nomsReduplicatifs.has(plier(`${mot} ${mot}`).trim())) continue;
		// Une source latine qui porte déjà la répétition la justifie.
		if (new RegExp(`(?<![\\p{L}])${mot}[ \\t]+${mot}(?![\\p{L}])`, "iu").test(src)) continue;
		doubles.add(mot);
	}
	if (doubles.size === 0) return null;
	return {
		code: "mot-double",
		poids: Math.min(4, 2 * doubles.size),
		detail: `nom répété d'affilée : ${[...doubles].slice(0, 4).join(", ")}`,
	};
}

/**
 * Artefacts connus de la substitution du lexique : une entrée courte appliquée
 * au milieu d'un mot. La liste est un filet explicite ; `signalSousChaines`
 * couvre le cas général.
 */
const ARTEFACTS_CONNUS: { motif: RegExp; libelle: string }[] = [
	{ motif: /Capsule\s+Cell\s+Corporation/i, libelle: "Capsule Cell Corporation" },
	{ motif: /Croix\s+Dispo|Dispo\s+Croix/i, libelle: "Croix Dispo (ディスクロス)" },
	{ motif: /(?<![\p{L}])Terre\s+Terre(?![\p{L}])/iu, libelle: "Terre Terre" },
	{ motif: /Comic\s+Cus\b/i, libelle: "Comic Cus (コミックス)" },
	{ motif: /\bGure\s+Son\s+Gohan\b/i, libelle: "Gure Son Gohan (グレートサイヤマン)" },
];

export function signalArtefactsConnus(fr: string): Signal | null {
	const trouves = ARTEFACTS_CONNUS.filter((a) => a.motif.test(fr)).map((a) => a.libelle);
	if (trouves.length === 0) return null;
	return {
		code: "artefact-lexique",
		poids: 3 + trouves.length,
		detail: `artefact(s) de substitution : ${trouves.join(", ")}`,
	};
}

const KATAKANA_CAR = /[゠-ヿ]/;

/**
 * Entrée COURTE du lexique (≤ 3 signes, katakana) dont la forme française est
 * dans la traduction alors que, dans la source, la graphie n'apparaît qu'au
 * milieu d'un mot katakana plus long (セル dans カプセル) : la substitution a
 * découpé un mot. Chaque occurrence couverte par une entrée plus longue du
 * lexique (セルジュニア) est légitime.
 */
export function signalSousChaines(
	fr: string,
	src: string,
	courtes: EntreeLexique[],
	longues: EntreeLexique[]
): Signal | null {
	const frPlie = plier(fr);
	const fautifs: EntreeLexique[] = [];
	for (const e of courtes) {
		if (!src.includes(e.ja)) continue;
		const cible = plier(e.fr).trim();
		if (cible.length < 3 || !frPlie.includes(` ${cible} `)) continue;
		let isolee = false;
		let collee = 0;
		for (let i = src.indexOf(e.ja); i !== -1; i = src.indexOf(e.ja, i + 1)) {
			const avant = src[i - 1] ?? "";
			const apres = src[i + e.ja.length] ?? "";
			const couverte = longues.some((l) => {
				const k = src.lastIndexOf(l.ja, i);
				return k !== -1 && k + l.ja.length >= i + e.ja.length && l.ja.includes(e.ja);
			});
			if (couverte) {
				isolee = true;
				continue;
			}
			if (KATAKANA_CAR.test(avant) || KATAKANA_CAR.test(apres)) collee++;
			else isolee = true;
		}
		if (!isolee && collee > 0) fautifs.push(e);
	}
	if (fautifs.length === 0) return null;
	// Calibration (2026-09-14) : un traducteur soigneux écrit légitimement « Cell
	// Game », « Karin » ou « fin » là où la source porte セルゲーム, カリン塔 ou
	// フィニッシュ — un ou deux cas isolés ne prouvent rien. La substitution
	// aveugle, elle, laisse des formes que personne n'écrit (« Pan (Xeno) »,
	// « OG72-I », « Aca ») et en sème plusieurs par planche.
	const exotiques = fautifs.filter((e) => /[\d()（）]/.test(e.fr) && fr.includes(e.fr));
	const poids =
		(fautifs.length >= 3 ? 5 : fautifs.length) + Math.min(4, 4 * exotiques.length);
	return {
		code: "lexique-sous-chaine",
		poids: Math.min(8, poids),
		detail: `entrée courte appliquée dans un mot plus long : ${fautifs
			.slice(0, 4)
			.map((e) => `${e.ja}→${e.fr}`)
			.join(", ")}${exotiques.length ? ` (formes exotiques : ${exotiques.map((e) => e.fr).join(", ")})` : ""}`,
	};
}

/** Part de lignes « miettes » (≤ 2 signes utiles) d'une source : l'OCR n'a rien lu. */
function bruitSourceJa(src: string): { lignes: number; miettes: number; part: number } {
	const lignes = src
		.split("\n")
		.map((l) => l.replace(/[\s#*>\-–—|・、。!！?？…()（）「」『』]/g, ""))
		.filter((l) => l.length > 0);
	const miettes = lignes.filter((l) => [...l].length <= 2).length;
	return { lignes: lignes.length, miettes, part: lignes.length ? miettes / lignes.length : 0 };
}

/** Transcription inexploitable traduite quand même. */
export function signalSourceBruitee(fr: string, src: string): Signal | null {
	if (!estSourceAsiatique(src)) return null;
	const b = bruitSourceJa(src);
	if (b.lignes < 6 || b.part < 0.5) return null;
	// Les planches de listes chiffrées (« 2 / 3 / 4 … ») ne sont pas du bruit.
	const chiffrees = src.split("\n").filter((l) => /^\s*[\d０-９①-⑳]+\s*$/.test(l)).length;
	const part = (b.miettes - chiffrees) / Math.max(1, b.lignes - chiffrees);
	if (b.lignes - chiffrees < 6 || part < 0.5) return null;
	// Calibration : une grille de carte (« BP / 攻 / 守 / マ ») a des lignes courtes
	// légitimes et se traduit étiquette par étiquette sans rien corrompre. Le bruit
	// véritable sème des KANA isolés (« あ / そ / な ») qui ne veulent rien dire ;
	// le traduire ligne à ligne produit « Ah / Cela / Na ».
	const kanaIsoles = src.split("\n").filter((l) => /^\s*[ぁ-ゟ]\s*$/.test(l)).length;
	const lignesFr = fr.split("\n").filter((l) => l.trim()).length;
	const motAMot = kanaIsoles >= 3 && lignesFr >= 0.6 * (b.lignes - chiffrees);
	const poids = (part >= 0.75 ? 3 : 2) + (motAMot ? 3 : 0);
	return {
		code: "source-bruitee",
		poids,
		detail: `${Math.round(part * 100)} % des ${b.lignes - chiffrees} lignes de la source font ≤ 2 signes (OCR inexploitable)${motAMot ? `, ${kanaIsoles} kana isolés traduits ligne à ligne` : ""}`,
	};
}

/** Copie de la source dans le champ de traduction. */
export function signalCopie(fr: string, src: string): Signal | null {
	const a = fr.replace(/\s+/g, " ").trim();
	const b = src.replace(/\s+/g, " ").trim();
	if (!a || a !== b) return null;
	if (estSourceAsiatique(src)) {
		return { code: "copie-source", poids: 10, certain: true, detail: "traduction identique à la source japonaise" };
	}
	const bruit = bruitOcrFr(src);
	const poids = bruit >= 0.12 ? 8 : bruit >= 0.06 ? 5 : 2;
	return {
		code: "copie-ocr-fr",
		poids,
		detail: `copie brute de l'OCR français (${Math.round(bruit * 100)} % de jetons parasites)`,
	};
}

const MOTS_COURTS_FR = new Set(
	"a à y ô au aux ce ci de des du en et il ils je la le les lui ma me mes mon ne ni nu on ou où pa sa se ses si son ta te tes toi ton tu un une va vu eh oh ah hé ha ho là l d j m n s t c qu".split(
		" "
	)
);

/** Part de jetons parasites d'un OCR français : symboles, lettres isolées, mélanges chiffres-lettres. */
export function bruitOcrFr(texte: string): number {
	const jetons = texte.split(/\s+/).filter(Boolean);
	if (jetons.length === 0) return 0;
	let parasites = 0;
	for (const j of jetons) {
		const nu = j.replace(/^[«"“'([]+|[»"”')\].,;:!?…]+$/g, "");
		if (!nu) continue;
		if (/[{}\\|®©~_^<>=€£$]/.test(nu)) parasites++;
		else if (/\p{L}/u.test(nu) && /\d/.test(nu) && !/^\d+(e|er|ème|eme|re|n°)$/i.test(nu)) parasites++;
		else if (/^\p{L}{1,2}$/u.test(nu) && !MOTS_COURTS_FR.has(nu.toLowerCase())) parasites++;
		else if (/^[^\p{L}\d]+$/u.test(nu) && !/^[-–—•●◆▲▼→←↑↓/]+$/.test(nu)) parasites++;
	}
	return parasites / jetons.length;
}

/** Rapport de longueur hors norme entre la traduction et une source japonaise. */
function signalLongueur(fr: string, src: string): Signal | null {
	if (!estSourceAsiatique(src)) return null;
	const nSrc = [...src.replace(/\s+/g, "")].length;
	const nFr = fr.replace(/\s+/g, " ").trim().length;
	if (nSrc < 30) return null;
	const r = nFr / nSrc;
	if (r > 6) return { code: "longueur-glose", poids: r > 10 ? 4 : 3, detail: `${nFr} signes pour ${nSrc} en source (×${r.toFixed(1)})` };
	if (r < 0.25 && nSrc >= 120)
		return { code: "longueur-tronquee", poids: 2, detail: `${nFr} signes pour ${nSrc} en source (×${r.toFixed(2)})` };
	return null;
}

/** Nombres (dates, numéros, épisodes) de la traduction introuvables dans la source. */
export function signalNombresInventes(fr: string, src: string): Signal | null {
	const nf = nombresDe(fr);
	if (nf.size < 3) return null;
	const ns = nombresDe(src);
	const inventes = [...nf].filter((n) => !nombreJustifie(n, ns));
	const part = inventes.length / nf.size;
	if (inventes.length < 3 || part < 0.6) return null;
	return {
		code: "nombres-inventes",
		poids: part >= 0.85 && inventes.length >= 4 ? 4 : 3,
		detail: `${inventes.length}/${nf.size} nombres absents de la source (${inventes.slice(0, 6).join(", ")})`,
	};
}

// ── Entités (lexique du site) ───────────────────────────────────────────────

export interface IndexEntites {
	/** Formes françaises pliées qui contiennent un mot redoublé (« tao pai pai »). */
	reduplicatifs: Set<string>;
	/** Forme française pliée → graphies japonaises (pliées) qui la justifient. */
	parFr: Map<string, string[]>;
	/** Graphie japonaise brute → formes françaises pliées acceptées. */
	parJa: Map<string, string[]>;
	/** Entrées courtes katakana (≤ 3 signes), pour le détecteur de sous-chaînes. */
	courtes: EntreeLexique[];
	/** Entrées plus longues, qui légitiment une occurrence courte. */
	longues: EntreeLexique[];
}

const KINDS_ENTITES = new Set(["personnage", "technique", "planete", "race"]);
/** Formes françaises trop communes pour témoigner d'une entité. */
const FR_COMMUNS = new Set(
	["ange", "demon", "inconnu", "sirene", "alligator", "les chiens", "homme garou", "majin", "oats", "planete sacree", "roi de la terre", "colonel black"].map(
		(s) => s
	)
);

/** Forme française sans sa glose : « Kaio du Nord (Kaito) » → « Kaio du Nord ». */
function frNu(fr: string): string {
	return fr.replace(/\s*[(（][^)）]*[)）]\s*$/, "").trim();
}

export function indexerEntites(lexique: EntreeLexique[]): IndexEntites {
	const parFr = new Map<string, string[]>();
	const parJa = new Map<string, string[]>();
	const courtes: EntreeLexique[] = [];
	const longues: EntreeLexique[] = [];
	const reduplicatifs = new Set<string>();
	for (const e of lexique) {
		if (!e.ja || !e.fr) continue;
		for (const m of plier(e.fr).matchAll(/(?<= )([a-z]{3,}) \1(?= )/g)) reduplicatifs.add(`${m[1]} ${m[1]}`);
		const n = [...e.ja].length;
		if (n <= 3 && /^[゠-ヿ]+$/.test(e.ja)) courtes.push(e);
		else if (n > 3) longues.push(e);
		if (!KINDS_ENTITES.has(e.kind) || n < 3 || /\d/.test(e.fr)) continue;
		const cle = plier(frNu(e.fr)).trim();
		if (cle.length < 5 || FR_COMMUNS.has(cle)) continue;
		parFr.set(cle, [...(parFr.get(cle) ?? []), plierJa(e.ja)]);
		parJa.set(e.ja, [...(parJa.get(e.ja) ?? []), cle]);
	}
	return { reduplicatifs, parFr, parJa, courtes, longues };
}

/** La graphie (ou son noyau : 孫悟空 → 悟空) figure-t-elle dans la source pliée ? */
function graphiePresente(ja: string, srcPlie: string): boolean {
	if (srcPlie.includes(ja)) return true;
	const c = [...ja];
	if (c.length >= 3) {
		if (srcPlie.includes(c.slice(1).join(""))) return true;
		if (srcPlie.includes(c.slice(0, -1).join(""))) return true;
	}
	return false;
}

/** Entités françaises de la traduction sans aucune graphie japonaise dans la source. */
function signalEntitesInventees(fr: string, src: string, index: IndexEntites): Signal | null {
	if (!estSourceAsiatique(src) || estSourceChinoise(src)) return null;
	const frPlie = plier(fr);
	const srcPlie = plierJa(src);
	const presentes: string[] = [];
	const absentes: string[] = [];
	for (const [nom, graphies] of index.parFr) {
		if (!frPlie.includes(` ${nom} `)) continue;
		// Un nom plus long qui contient celui-ci l'a déjà compté (« son goku » ⊃ « goku »).
		(graphies.some((g) => graphiePresente(g, srcPlie)) ? presentes : absentes).push(nom);
	}
	const total = presentes.length + absentes.length;
	if (absentes.length < 3 || absentes.length / total < 0.6) return null;
	return {
		code: "entites-inventees",
		poids: absentes.length >= 5 && absentes.length / total >= 0.8 ? 4 : 3,
		detail: `${absentes.length}/${total} entités citées sans graphie dans la source (${absentes.slice(0, 5).join(", ")})`,
	};
}

/** Noms japonais de la source dont aucune forme française n'est dans la traduction. */
function signalEntitesManquantes(fr: string, src: string, index: IndexEntites): Signal | null {
	if (!estSourceAsiatique(src) || estSourceChinoise(src)) return null;
	const frPlie = plier(fr);
	const presentes: string[] = [];
	const manquantes: string[] = [];
	for (const [ja, formes] of index.parJa) {
		if ([...ja].length < 3 || !src.includes(ja)) continue;
		const vue = formes.some((f) => frPlie.includes(` ${f} `) || f.split(" ").some((mot) => mot.length >= 5 && frPlie.includes(` ${mot} `)));
		(vue ? presentes : manquantes).push(ja);
	}
	const total = presentes.length + manquantes.length;
	if (manquantes.length < 3 || manquantes.length / total < 0.6) return null;
	return {
		code: "entites-manquantes",
		poids: 2,
		detail: `${manquantes.length}/${total} noms de la source absents de la traduction (${manquantes.slice(0, 5).join(", ")})`,
	};
}

// ── Alignement ──────────────────────────────────────────────────────────────

/** Ancres vérifiables d'une source : nombres, mots latins, entités du lexique. */
function ancresDe(src: string, index: IndexEntites): Set<string> {
	const ancres = new Set<string>();
	for (const n of nombresDe(src)) ancres.add(`#${n}`);
	for (const m of src.matchAll(/[A-Za-z]{4,}/g)) ancres.add(plier(m[0]).trim());
	for (const [ja, formes] of index.parJa) if ([...ja].length >= 3 && src.includes(ja)) ancres.add(`@${formes[0]}`);
	return ancres;
}

/** Part des ancres d'une source retrouvées dans une traduction. */
function couverture(fr: string, ancres: Set<string>): number {
	if (ancres.size === 0) return 0;
	const frPlie = plier(fr);
	const nf = nombresDe(fr);
	let vues = 0;
	for (const a of ancres) {
		if (a.startsWith("#")) {
			if (nf.has(Number(a.slice(1)))) vues++;
		} else if (a.startsWith("@")) {
			if (frPlie.includes(` ${a.slice(1)} `)) vues++;
		} else if (frPlie.includes(` ${a} `)) vues++;
	}
	return vues / ancres.size;
}

/**
 * La traduction ignore-t-elle les ancres de sa propre source ?
 *
 * Présomption seulement : mesuré sur machine:sonnet, 13 planches sur 1 080
 * tombent sous le seuil sans être fausses (listes de chapitres dont les numéros
 * sont écrits en toutes lettres, sources illisibles honnêtement signalées). Le
 * poids reste donc sous le seuil de quarantaine ; il n'y conduit qu'associé à
 * des nombres ou des entités inventés.
 */
function signalCouvertureFaible(fr: string, src: string, index: IndexEntites): Signal | null {
	if (!estSourceAsiatique(src) || estSourceChinoise(src)) return null;
	const ancres = ancresDe(src, index);
	const c = couverture(fr, ancres);
	if (ancres.size >= 8 && c <= 0.2) {
		return {
			code: "couverture-faible",
			poids: 3,
			detail: `${Math.round(c * 100)} % des ${ancres.size} ancres de la source (nombres, noms, mots latins) retrouvées`,
		};
	}
	return null;
}

/** La traduction colle-t-elle mieux à la source d'une planche voisine qu'à la sienne ? */
function signalDesalignement(
	fr: string,
	src: string,
	voisines: { numero: number; src: string }[],
	index: IndexEntites
): Signal | null {
	const propres = ancresDe(src, index);
	const cPropre = couverture(fr, propres);
	let meilleure: { numero: number; c: number; n: number } | null = null;
	for (const v of voisines) {
		if (!v.src.trim()) continue;
		const a = ancresDe(v.src, index);
		// Calibration : avec 4 ancres (« 1994 », « DRAGON », « BALL »), deux couvertures
		// de magazine se ressemblent toutes ; une liste de staff fidèle (#111 p5) était
		// déclarée désalignée. Il faut une voisine riche en ancres, et bien couverte.
		if (a.size < 8) continue;
		const c = couverture(fr, a);
		if (!meilleure || c > meilleure.c) meilleure = { numero: v.numero, c, n: a.size };
	}
	if (!meilleure || meilleure.c < 0.6 || meilleure.c - cPropre < 0.4) return null;
	return {
		code: "desalignement",
		poids: 5,
		detail: `couvre ${Math.round(meilleure.c * 100)} % des ancres de la planche ${meilleure.numero} contre ${Math.round(cPropre * 100)} % de la sienne`,
	};
}

// ── Verdict ─────────────────────────────────────────────────────────────────

export interface PlancheAuditee {
	fr: string;
	src: string;
	voisines?: { numero: number; src: string }[];
	/** Signaux établis hors texte (relecture du scan), ajoutés tels quels. */
	extras?: Signal[];
}

/**
 * Défaut CERTAIN, sans lexique ni voisinage : ce qu'une chaîne d'ingestion peut
 * vérifier à chaque passe pour ne jamais republier une traduction corrompue.
 */
export function defautCertain(fr: string, src: string): Signal | null {
	const jeton = signalJetons(fr, src);
	if (jeton) return jeton;
	const copie = signalCopie(fr, src);
	return copie?.certain ? copie : null;
}

export function auditerPlanche(p: PlancheAuditee, index: IndexEntites): VerdictPlanche {
	const { fr, src } = p;
	const signaux = [
		signalJetons(fr, src),
		signalCopie(fr, src),
		signalArtefactsConnus(fr),
		signalSousChaines(fr, src, index.courtes, index.longues),
		signalMotsDoubles(fr, src, index.reduplicatifs),
		signalSourceBruitee(fr, src),
		signalLongueur(fr, src),
		signalNombresInventes(fr, src),
		signalEntitesInventees(fr, src, index),
		signalEntitesManquantes(fr, src, index),
		signalCouvertureFaible(fr, src, index),
		p.voisines?.length ? signalDesalignement(fr, src, p.voisines, index) : null,
		...(p.extras ?? []),
	].filter((s): s is Signal => s !== null);
	const score = signaux.reduce((t, s) => t + s.poids, 0);
	const niveau: Niveau =
		signaux.some((s) => s.certain) || score >= SEUIL_CORROMPU
			? "corrompu"
			: score >= SEUIL_SUSPECT
				? "suspect"
				: "sain";
	return { score, niveau, signaux };
}
