// SPDX-License-Identifier: Apache-2.0

/**
 * Transcriptions de databooks — **classement des défauts** (module pur).
 *
 * Sert de juge commun à tout ce qui touche la qualité d'une transcription :
 * la file de relecture (`scripts/planches-a-relire.ts`) et la reprise des lots
 * OCR d'origine (`scripts/meilleure-source-ocr.ts`) doivent noter un texte
 * EXACTEMENT de la même façon, sinon l'une redéposerait ce que l'autre vient de
 * signaler comme fautif.
 *
 * Le classement ne corrige rien et ne devine rien : il constate des signatures
 * mécaniques d'échec du modèle d'OCR, observées sur le corpus réel (11 778
 * planches, dont 2 223 fautives au 2026-08-25) :
 *
 *   - un alphabet sans rapport (cyrillique, arabe, thaï, coréen) au milieu du
 *     japonais n'est jamais une lecture, c'est une hallucination ;
 *   - des idéogrammes sans un seul kana sur une page japonaise = du chinois
 *     inventé (une page de databook a toujours des kana) ;
 *   - un segment répété en rafale = le modèle a bouclé jusqu'à sa limite ;
 *   - « � » = sortie coupée en plein caractère UTF-8.
 *
 * Aucune de ces signatures ne dépend de la langue du contenu attendu : une page
 * réellement anglaise (crédits, ISBN) ne déclenche rien.
 */

/** Défauts, du plus certain au plus discutable. */
export type Defaut = "remplacement" | "etranger" | "han-sans-kana" | "boucle" | "courte" | "vide";

const ETRANGER = /[Ѐ-ӿ؀-ۿ฀-๿가-힯]/;
const KANA = /[぀-ヿ]/;
const HAN = /[一-鿿]/;
/**
 * Caractères qui sont de bons marqueurs d'une édition chinoise traditionnelle,
 * mais qui ne constituent pas une preuve lorsqu'ils apparaissent seuls. Le
 * juge ne lève donc `han-sans-kana` que si une graphie vraiment distinctive
 * apparaît dans un texte assez long. Cela évite de traiter comme « faux
 * chinois » les pages réellement chinoises de Dragon Ball Landmark/Forever et
 * leurs légendes, sans acquitter un simple titre court ambigu.
 */
const CHINOIS_TRADITIONNEL_FORTS =
	/[們嗎與傳發為這來國臺萬專業廣畫學書圖貼冊卷歐戰關號總從經裏體實變戰擊頭稱參數組織極歡樂駕滅敵聽處讓對]/u;
/**
 * Segment de 4 à 40 signes répété au moins trois fois d'affilée — le segment
 * devant compter au moins DEUX signes distincts. Une file d'un même caractère
 * (`★★★★★★`, une notation en étoiles ; `\u3000\u3000\u3000\u3000\u3000\u3000`, les cases d'un
 * bulletin-réponse) est une mise en page, pas une boucle : mesuré sur les
 * 11 285 planches transcrites, AUCUNE des 285 signalées ne l'est par cette
 * seule signature, alors qu'elle frappe les magazines à répétition.
 */
const BOUCLE = /(.{4,40}?)\1{2,}/gs;
/** Filet : une file d'un même signe assez longue reste une sortie emballée. */
const BOUCLE_MONOSIGNE = /(.)\1{39,}/s;

/**
 * Détecteurs unitaires — exportés pour que le diagnostic détaillé du relecteur
 * (`databooks-format.ts`) parle des MÊMES défauts que la file de relecture et
 * que l'avertissement public. Tant qu'ils vivaient chacun de leur côté, le
 * back-office annonçait 116 planches à vérifier là où il y en avait 1 911 :
 * il ne connaissait que le caractère de remplacement.
 */
export const contientAlphabetEtranger = (texte: string): boolean => ETRANGER.test(texte);
/**
 * Une page en chinois traditionnel n'est pas une hallucination japonaise.
 * Cette heuristique est volontairement stricte : une seule graphie partagée
 * avec le japonais ne suffit jamais à lever le signal.
 */
export const estChinoisTraditionnel = (texte: string): boolean => {
	if (!HAN.test(texte) || KANA.test(texte)) return false;
	const graphies = new Set(Array.from(texte).filter((c) => CHINOIS_TRADITIONNEL_FORTS.test(c)));
	return graphies.size >= 1 && Array.from(texte).length >= 20;
};

/** Idéogrammes sans un seul kana : du chinois inventé sur une page japonaise. */
export const estHanSansKana = (texte: string): boolean =>
	HAN.test(texte) && !KANA.test(texte) && !estChinoisTraditionnel(texte);
/**
 * Séparateur de tableau markdown (`|---|---|---|`) : c'est une répétition
 * LÉGITIME, et la seule que produise une transcription correcte. Sans ce
 * retrait, toute planche portant un tableau de trois colonnes ou plus est
 * déclarée « bouclée » — mesuré sur les catalogues de cartes du Saikyō Jump,
 * où 5 planches sur 30 tombaient à tort.
 */
const SEPARATEUR_TABLEAU = /^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)+\|?[ \t]*$/gm;

/** Les points de suspension imprimés ne sont pas une boucle de génération. */
const MOTIF_PONCTUATION = /^[\s・･、。…‥ー—–\-~～]+$/u;

/**
 * Un bloc répété composé uniquement de petites lignes est typique d'une
 * grille, d'un tableau de cartes ou d'une colonne de magazine. Le signal est
 * conservé pour les répétitions inline et les paragraphes suffisamment longs,
 * où la boucle du modèle reste réellement discriminante.
 */
function motifDeMiseEnPage(motif: string): boolean {
	if (MOTIF_PONCTUATION.test(motif)) return true;
	if (motif.trim() === "次Pへ") return true;
	const lignes = motif
		.split("\n")
		.map((ligne) => ligne.trim())
		.filter(Boolean);
	return lignes.length >= 2 && lignes.every((ligne) => Array.from(ligne).length <= 15);
}

/** Le modèle a bouclé : un même segment rendu en rafale. */
export const contientBoucle = (texte: string): boolean => {
	const sansTableau = texte.replace(SEPARATEUR_TABLEAU, "");
	const monosigne = BOUCLE_MONOSIGNE.exec(sansTableau);
	if (monosigne && /[\p{L}\p{N}]/u.test(monosigne[1]!)) return true;
	BOUCLE.lastIndex = 0;
	for (let m = BOUCLE.exec(sansTableau); m; m = BOUCLE.exec(sansTableau)) {
		const motif = m[1];
		if (!motif) continue;
		// Un motif fait d'un seul signe répété est une mise en page, pas une
		// boucle — on continue de chercher au lieu de conclure.
		if (!/^(.)\1*$/s.test(motif) && !motifDeMiseEnPage(motif)) {
			BOUCLE.lastIndex = 0;
			return true;
		}
	}
	return false;
};
/** Signes que le modèle n'a pas su lire (U+FFFD). */
export const compteRemplacements = (texte: string): number => (texte.match(/�/g) ?? []).length;

/** Longueur en dessous de laquelle une planche transcrite est jugée avortée. */
export const SEUIL_COURT = 15;

/** Le défaut d'un texte, ou `null` s'il ne porte aucune signature d'échec. */
export function classerDefaut(texte: string): Defaut | null {
	if (texte === "") return "vide";
	if (texte.includes("�")) return "remplacement";
	if (contientAlphabetEtranger(texte)) return "etranger";
	if (estHanSansKana(texte)) return "han-sans-kana";
	if (contientBoucle(texte)) return "boucle";
	if (texte.length < SEUIL_COURT) return "courte";
	return null;
}

/**
 * Note de qualité, pour départager deux transcriptions de la MÊME planche
 * (base contre lot d'origine). Plus c'est haut, mieux c'est.
 *
 * Un texte sans défaut bat tout texte fautif ; à défaut égal, le plus long
 * gagne — sur ce corpus, une sortie plus courte que sa rivale est presque
 * toujours une sortie qui a abandonné en route.
 */
export function noteQualite(texte: string): number {
	const defaut = classerDefaut(texte);
	const rang: Record<Defaut, number> = {
		vide: 0,
		remplacement: 1,
		boucle: 1,
		"han-sans-kana": 2,
		etranger: 2,
		courte: 3,
	};
	const base = defaut === null ? 10 : rang[defaut];
	// La longueur ne départage qu'à l'intérieur d'un même rang (facteur borné).
	return base * 1_000_000 + Math.min(texte.length, 999_999);
}

/** Nombre de signes fautifs — sert à trier « le pire d'abord » dans la file. */
export function gravite(texte: string, defaut: Defaut): number {
	if (defaut === "remplacement") return compteRemplacements(texte);
	if (defaut === "etranger") return (texte.match(/[Ѐ-ӿ؀-ۿ฀-๿가-힯]/g) ?? []).length;
	return 1;
}

/**
 * Clé du drapeau « relue à l'image, le texte est bon » posée sur la planche.
 *
 * Les signatures ci-dessus sont mécaniques, donc elles se trompent : une
 * couverture de V Jump ne porte que « 3月号 » et « COVER » — neuf signes, des
 * idéogrammes sans un seul kana. Deux défauts levés (« courte »,
 * « han-sans-kana ») sur une transcription pourtant EXACTE, que le relecteur
 * n'avait aucun moyen d'acquitter : la planche restait à jamais dans la file
 * « À vérifier » et le lecteur public gardait son bandeau d'avertissement.
 *
 * Le drapeau ne modifie ni le texte ni le juge : il dit qu'un humain a comparé
 * la transcription au scan. Il est donc porté par la planche (`verifiee`,
 * `verifiee_par`, `verifiee_le` dans le jsonb), à côté de sa source, et se
 * retire aussi facilement qu'il se pose.
 */
export const CLE_VERIFIEE = "verifiee";

/** Cette planche a-t-elle été acquittée à la main par un relecteur ? */
export function estPlancheVerifiee(planche: unknown): boolean {
	if (!planche || typeof planche !== "object") return false;
	return (planche as Record<string, unknown>)[CLE_VERIFIEE] === true;
}

/**
 * Défaut d'une planche, drapeau de relecture compris.
 *
 * À préférer à `classerDefaut` partout où l'on dispose de l'objet planche :
 * une planche acquittée est saine, quoi qu'en disent les signatures — c'est
 * tout l'objet du drapeau. Une planche VIDE reste vide : acquitter un texte
 * absent n'en crée pas un, et la file « à transcrire » doit continuer de la
 * voir.
 */
export function defautDePlanche(planche: unknown, texte: string): Defaut | null {
	const defaut = classerDefaut(texte);
	if (defaut === "vide") return defaut;
	return estPlancheVerifiee(planche) ? null : defaut;
}
