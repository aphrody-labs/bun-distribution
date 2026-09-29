// SPDX-License-Identifier: Apache-2.0

/**
 * Databooks — **juges de la traduction japonais → français** (module pur).
 *
 * Pendant du juge des transcriptions (`databooks-defauts.ts`), et volontairement
 * SÉPARÉ de lui : `classerDefaut` gouverne l'avertissement affiché au lecteur et
 * les comptes du back-office. Y fusionner les signatures ci-dessous poserait un
 * bandeau « planche mal lue » sur 2 131 fiches de plus — c'est un autre débat,
 * celui de ce qu'on montre, pas de ce qu'on traduit.
 *
 * Deux jugements, aux deux bouts de la chaîne :
 *   - `intraduisible()` — en entrée : la transcription est-elle assez saine pour
 *     qu'on paie sa lecture ?
 *   - `refus()` — en sortie : la traduction produite est-elle fidèle à sa source ?
 */
import { compteRemplacements, contientAlphabetEtranger, contientBoucle } from "./databooks-defauts";
import { proportionJaponais } from "./ja/normalisation";

/**
 * Sinogrammes simplifiés qui n'existent pas en japonais : la sortie a dérivé
 * vers du chinois. `classerDefaut` ne voit que le cas total (des idéogrammes
 * sans un seul kana) ; ici la planche garde ses kana autour et passe au travers.
 */
const SIMPLIFIES = /[个陆这说见门东车马鸟贝长风飞龙业习乡书买卖]/;

/**
 * Bruit latin greffé en plein mot japonais : « のability », « じolation », « がindo ».
 *
 * MINUSCULES seulement, et c'est le fruit d'une mesure : en majuscules ce sont
 * des sigles parfaitement légitimes, omniprésents dans les V-Jump et les guides
 * de jeux — « 年WJNo », « ISBNコ », « 王OCG », « をGET ». Les compter écartait
 * 3 468 planches au lieu de ~1 500 : un quart du corpus jeté pour rien.
 *
 * Le `(?<![A-Za-z])` n'est pas décoratif : sans lui, « Switch版 » se fait
 * écarter parce que la regex y voit « witch » + japonais. Le mot latin doit être
 * jugé ENTIER — s'il porte une majuscule, c'est un mot, pas du bruit.
 */
const LATIN_COLLE = /[぀-ヿ一-鿿][a-z]{3,}|(?<![A-Za-z])[a-z]{3,}[぀-ヿ一-鿿]/;

/**
 * Boucle NON consécutive : le même bloc revient trois fois dans la planche sans
 * se suivre. La `BOUCLE` du juge des transcriptions exige la répétition
 * d'affilée (`\1{2,}`) et rate ce cas, fréquent sur les tableaux (« ADVENTURE
 * HISTORY ») où le modèle reprend un paragraphe entier après une insertion.
 */
export function boucleDispersee(texte: string): boolean {
	for (let i = 0; i + 30 <= texte.length; i += 15) {
		const bloc = texte.slice(i, i + 30);
		if (!/[぀-ヿ一-鿿]/.test(bloc)) continue;
		let n = 0;
		let j = 0;
		while ((j = texte.indexOf(bloc, j)) !== -1) {
			n++;
			j += 30;
		}
		if (n >= 3) return true;
	}
	return false;
}

/** Signatures d'échec qui rendent une transcription intraduisible. */
export type Intraduisible = "chinois-simplifie" | "latin-colle" | "boucle-dispersee";

/**
 * La planche vaut-elle d'être traduite, ou `null` si rien ne cloche.
 *
 * Ces trois signatures, les traducteurs de la première passe les ont écartées À
 * LA MAIN, après lecture — donc après avoir payé la lecture. Mesuré : 2 131
 * planches sur 9 356, soit 23 % du travail restant.
 */
export function intraduisible(texte: string): Intraduisible | null {
	if (SIMPLIFIES.test(texte)) return "chinois-simplifie";
	if (LATIN_COLLE.test(texte)) return "latin-colle";
	if (boucleDispersee(texte)) return "boucle-dispersee";
	return null;
}

/**
 * Part de japonais tolérée dans la sortie française. Zéro serait faux : une
 * bonne traduction de databook garde souvent la graphie d'origine en regard
 * (« Kaïō-ken (界王拳) »). Au-delà, le modèle a recopié au lieu de traduire.
 */
const PART_JA_MAX = 0.15;

/** Pourquoi une traduction est refusée au dépôt, ou `null` si elle passe. */
export function refus(fr: string, ja: string): string | null {
	const texte = fr.trim();
	if (!texte) return "vide";
	const part = proportionJaponais(texte);
	if (part > PART_JA_MAX) return `${Math.round(part * 100)} % de japonais résiduel (non traduit)`;
	// On applique les détecteurs UN À UN, et non `classerDefaut` en bloc : ce juge
	// note du japonais, et deux de ses verdicts n'ont aucun sens sur du français.
	//   - « han-sans-kana » se déclenche sur TOUTE sortie française qui garde une
	//     graphie en kanji — donc sur « Kaïō-ken (界王拳) », qui est justement la
	//     bonne pratique. Mesuré : deux dépôts corrects refusés à ce titre lors de
	//     la première passe, que le traducteur a cru être de sa faute.
	//   - « courte » est un verdict de transcription : une planche qui ne porte
	//     qu'un titre rend légitimement dix signes. C'est le rapport de longueur,
	//     plus bas, qui juge une sortie tronquée.
	if (compteRemplacements(texte) > 0) return "défaut remplacement";
	if (contientAlphabetEtranger(texte)) return "défaut etranger";
	if (contientBoucle(texte)) return "défaut boucle";
	if (texte.length > ja.length * 3.5)
		return `${texte.length} signes pour ${ja.length} en japonais (glose)`;
	if (texte.length * 6 < ja.length)
		return `${texte.length} signes pour ${ja.length} en japonais (tronqué)`;
	return null;
}

/**
 * Forme repliée servant d'index d'appariement entre la graphie du lexique et
 * celle de la planche. Elle efface ce que l'OCR mange ou ajoute le plus souvent :
 * le signe d'allongement `ー` (« ターレス » lu « タレス ») et les points médians
 * (les trois existent en Unicode et se mélangent dans les sources).
 *
 * Repli délibérément agressif : il ne SUBSTITUE rien, il propose une entrée de
 * lexique au traducteur, qui garde l'arbitrage. Une collision (deux termes
 * distincts pliés pareil) coûte une ligne de lexique en trop, jamais une
 * traduction fausse.
 */
export const replier = (s: string) => s.replace(/[・･·\s]/g, "").replace(/ー/g, "");

/**
 * Noyaux d'une graphie de lexique : `未来のダーブラ` et `ダーブラ：ゼノ` désignent
 * le même nom, que la planche écrit nu. Sans ce dépouillement, le terme n'entre
 * jamais dans le lexique d'un lot — et le traducteur, privé de forme officielle,
 * rend « Dâburâ » au lieu de « Dâbra ».
 */
export function noyaux(ja: string): string[] {
	const formes = new Set([ja]);
	const nu = ja
		.replace(/^(未来の|少年|幼少期の)/, "")
		.replace(/[：:][ゼ][ノ]$/, "")
		.replace(/[（(][^）)]*[）)]$/, "")
		.trim();
	if (nu.length >= 2) formes.add(nu);
	return [...formes];
}
