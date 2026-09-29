/**
 * Japonais — appariement d'un nom du wiki à sa graphie japonaise. Règles pures.
 *
 * Le problème posé par `name_ja` n'est pas de traduire : c'est d'apparier. La
 * base nomme les techniques en français (« Attaque Garric ») ou en anglais
 * (« Wild Sense »), et les databooks n'écrivent que du japonais (ギャリック砲).
 * Rien ne relie les deux dans les données — et pour cause : les deux seuls
 * alimentateurs de `bot.db_techniques` n'ont jamais porté de champ japonais.
 * Le catalogue Xenoverse 2 en a été extrait côté `msg` FR, les anciens ingests ne
 * couvre que personnages, planètes et lieux. D'où 0 `name_ja` sur 825 fiches
 * avant le 2026-08-22, et 17 après une passe manuelle.
 *
 * Trois passerelles ont été mesurées sur le corpus des databooks (9 384
 * planches transcrites, mesure du 2026-08-23) :
 *
 *  1. **L'identifiant de compétence Xenoverse 2** — la seule qui tienne. Les
 *     fichiers `msg` du jeu existent en FR et en JP, indexés par la même clé
 *     (`spe_skill_0000`). L'appariement est alors une égalité de clé, pas une
 *     ressemblance : 701 des 825 fiches y trouvent une graphie unique, 6 en
 *     trouvent deux (et sont écartées comme ambiguës), 118 aucune.
 *  2. **La lecture** (romaji du nom français → kana → graphie du corpus). Elle
 *     échoue en pratique : l'analyseur morphologique ignore les composés de la
 *     série et rend 界王拳 par « サカイオウコブシ » au lieu de « カイオウケン ».
 *     Mesuré 8 lectures justes sur 15 techniques canoniques : 気円斬 se lit
 *     « キエンキ », 舞空術 « マイソラジュツ », 操気弾 « ミサオキダン ».
 *     Inexploitable seule, et rien ici ne s'en sert.
 *  3. **L'index de techniques des databooks** — le Super Exciting Guide donne,
 *     pages 74 à 89, une entrée par technique avec sa graphie, son chapitre de
 *     première apparition et ses utilisateurs. 66 entrées : trop peu pour
 *     couvrir la base, mais c'est la corroboration la plus forte qui existe,
 *     puisqu'elle vient du manga et non d'un jeu.
 *
 * La graphie proposée par (1) reste une **hypothèse issue d'un jeu vidéo**.
 * C'est le corpus des databooks qui l'atteste ou la rejette — un nom que les
 * ouvrages officiels n'écrivent nulle part n'entre pas au wiki.
 */

/** Un candidat de graphie, tel que le jeu l'indexe. */
export interface CandidatXv2 {
	/** Identifiant de la compétence dans les fichiers du jeu (`spe_skill_0000`). */
	id: string;
	/** Nom tel que la localisation française l'écrit. */
	fr: string;
	/** Graphie japonaise correspondante, même identifiant côté `msg` JP. */
	ja: string;
}

/** Une entrée de l'index de techniques d'un databook. */
export interface EntreeIndex {
	ja: string;
	/** Première apparition, telle qu'imprimée : « 16巻 其之二百三十一 ». */
	debut: string | null;
	/** Numéro de chapitre déduit de `debut`, ou `null` si illisible. */
	chapitre: number | null;
	/** Utilisateurs cités, tels qu'imprimés. */
	usagers: string | null;
}

/**
 * Clé de comparaison d'un nom du wiki.
 *
 * Accents, casse et ponctuation sautent : la base écrit « Attaque Garric » et
 * le catalogue « Attaque Garric », mais aussi « Kaméhaméha » contre
 * « Kamehameha », « Big bang » contre « Big Bang ». Ce qui reste doit coïncider
 * exactement — un appariement approximatif poserait une graphie japonaise sur
 * la mauvaise technique, ce qui est pire qu'un champ vide.
 */
export function cleNom(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

/**
 * Lit les paires FR ↔ JA du corpus Xenoverse 2 du RAG.
 *
 * Les documents y sont rédigés sur un gabarit fixe — « Nom (graphie) est une
 * compétence … » — parce qu'ils ont été générés depuis les `msg` du jeu, FR et
 * JP côte à côte. On ne retient la parenthèse que si elle contient réellement
 * du japonais : quelques compétences n'ont pas de nom JP et referment sur une
 * parenthèse latine, qu'il ne faut pas prendre pour une graphie.
 */
export function extraireCandidatsXv2(docs: { id: string; markdown: string }[]): CandidatXv2[] {
	const out: CandidatXv2[] = [];
	for (const d of docs) {
		if (!d.id.startsWith("xv2-skill-")) continue;
		const m = /^(.+?) \(([^)]+)\) est une compétence/.exec(d.markdown);
		if (!m) continue;
		const [, fr, ja] = m;
		if (!/[ぁ-ゟ゠-ヿ一-鿿]/.test(ja)) continue;
		out.push({ id: d.id.slice("xv2-skill-".length), fr: fr.trim(), ja: ja.trim() });
	}
	return out;
}

/**
 * Regroupe les candidats par nom français.
 *
 * Une même localisation française sert parfois deux compétences distinctes du
 * jeu : « Makankosappo » vaut 魔貫光殺砲 pour Piccolo et 魔弾光殺砲 pour sa
 * variante. Six cas mesurés. On conserve les deux graphies plutôt que d'en
 * choisir une : c'est à l'appelant de refuser l'appariement ambigu.
 */
export function grouperCandidats(cands: CandidatXv2[]): Map<string, CandidatXv2[]> {
	const m = new Map<string, CandidatXv2[]>();
	for (const c of cands) {
		const k = cleNom(c.fr);
		const deja = m.get(k);
		if (!deja) m.set(k, [c]);
		else if (!deja.some((x) => x.ja === c.ja)) deja.push(c);
	}
	return m;
}

/**
 * Nombre d'occurrences d'une graphie dans un texte.
 *
 * `split` plutôt qu'une expression régulière : les graphies contiennent des
 * parenthèses et des points médians, que l'échappement rendrait fragile.
 */
export function compterOccurrences(texte: string, graphie: string): number {
	if (!graphie) return 0;
	return texte.split(graphie).length - 1;
}

/**
 * La graphie porte-t-elle le défaut d'écriture « un signe, une espace » ?
 *
 * Défaut connu du wiki, pas un accident isolé : `ジ ー ミ ズ` au lieu de
 * `ジーミズ`, `コ リ ー 博士` au lieu de `コリー博士`. Le japonais ne sépare pas
 * ses signes — une valeur ainsi écrite est **invisible à toute recherche dans
 * le corpus**, donc impossible à attester, donc silencieusement inutile.
 * 13 cas relevés dans `bot.db_characters.name_ja` le 2026-08-23 (8 corrigés par
 * la passe de cohérence, 5 restants dont la fin du mot n'était pas espacée et
 * que son détecteur laissait passer).
 *
 * Le motif exigé est **au moins trois signes isolés d'affilée**, et non « une
 * espace entre deux signes japonais » : ce dernier critère condamnerait des
 * valeurs parfaitement légitimes, où l'espace sépare des mots et non des signes
 * — `ドラゴンボール レジェンズ`, `魔人ブウ 純粋`, ou les titres d'épisodes.
 * Mesuré : 92 valeurs portent une espace entre deux signes, 5 seulement portent
 * le défaut.
 */
const SIGNES_ISOLES = /(?:[ぁ-ゟ゠-ヿ一-鿿] ){2,}[ぁ-ゟ゠-ヿ一-鿿]/;

export function graphieEspacee(s: string): boolean {
	return SIGNES_ISOLES.test(s);
}

/**
 * La graphie est-elle inexploitable telle quelle ?
 *
 * Quatre cas, tous vus dans le corpus, dans les données du jeu ou dans la base :
 * le caractère de remplacement `�` que le modèle de vision laisse sur un signe
 * illisible, une graphie sans le moindre signe japonais, les graphies d'un seul
 * signe — qui s'apparient partout et ne prouvent rien —, et le défaut
 * « un signe, une espace ».
 *
 * Ce dernier ne peut pas venir du jeu, dont les `msg` sont propres. Il est ici
 * pour que le prochain remplissage ne le réintroduise pas : la garde vaut pour
 * toute valeur qui traverse ce module, d'où qu'elle vienne.
 */
export function graphieSuspecte(ja: string): boolean {
	if (!ja || ja.includes("�")) return true;
	if (!/[ぁ-ゟ゠-ヿ一-鿿]/.test(ja)) return true;
	if (graphieEspacee(ja)) return true;
	return [...ja].length < 2;
}

/** Verdict porté sur une proposition de graphie. */
export type Niveau = "sur" | "a_verifier" | "rejete";

export interface Verdict {
	niveau: Niveau;
	motif: string;
}

/**
 * Décide du sort d'une proposition.
 *
 * Deux garde-fous distincts, et il faut les deux :
 *
 * - **l'attestation** — la graphie doit être écrite quelque part dans les
 *   databooks. 491 des 701 graphies proposées par le jeu ne le sont jamais :
 *   ce sont des compétences inventées pour Xenoverse, qui n'ont pas leur place
 *   dans le lexique d'une œuvre ;
 * - **JMdict** — l'attestation ne suffit pas pour un mot japonais courant.
 *   « 突撃 » (charge), « 挑発 » (provocation), « 自爆 » (autodestruction)
 *   apparaissent des dizaines de fois dans les databooks sans y désigner une
 *   technique. 23 propositions sur 210 sont dans ce cas ; elles passent en
 *   relecture au lieu d'être admises. À l'inverse, une graphie absente de
 *   JMdict est du vocabulaire de la série, et son attestation vaut preuve.
 *
 * L'index de techniques d'un databook, quand il cite la graphie, l'emporte sur
 * JMdict : c'est le manga qui parle, pas une coïncidence de vocabulaire.
 */
export function juger(p: {
	ja: string;
	ambigu: boolean;
	occurrences: number;
	motCourant: boolean;
	dansIndexTechniques: boolean;
}): Verdict {
	if (graphieSuspecte(p.ja)) return { niveau: "rejete", motif: "graphie illisible ou trop courte" };
	if (p.ambigu) return { niveau: "rejete", motif: "plusieurs graphies pour ce nom" };
	if (p.occurrences === 0) return { niveau: "rejete", motif: "graphie absente des databooks" };
	if (p.dansIndexTechniques) return { niveau: "sur", motif: "index de techniques d'un databook" };
	if (p.motCourant) return { niveau: "a_verifier", motif: "mot japonais courant (JMdict)" };
	return { niveau: "sur", motif: `${p.occurrences} attestation(s) dans les databooks` };
}

/**
 * Ce que l'attestation prouve du statut de la technique — pas de sa graphie.
 *
 * Deux questions distinctes, que le rapport doit garder séparées : « la graphie
 * est-elle la bonne ? » (c'est `juger`) et « cette technique relève-t-elle du
 * manga ? ». Une compétence inventée pour un jeu de cartes a une graphie
 * japonaise parfaitement exacte ; elle n'a pas sa place dans une fiche
 * présentée comme canon.
 *
 * Mesuré sur 193 propositions retenues : 31 sont corroborées par l'index de
 * techniques d'un databook, 51 citent un ouvrage de référence, 111 ne trouvent
 * leur graphie que dans un périodique ou un guide de cartes — c'est-à-dire, le
 * plus souvent, dans une publicité, où le mot est imprimé sans rien dire de
 * l'œuvre.
 */
export type Portee = "manga" | "ouvrage" | "periodique";

/**
 * La catégorie `Databook` de la base range côte à côte le Daizenshuu 7 et les
 * guides anniversaires de Super Dragon Ball Heroes, qui sont des catalogues de
 * cartes à jouer. Les seconds sont donc écartés par leur titre : ils décrivent
 * un jeu, pas l'œuvre.
 */
const CATALOGUES_DE_CARTES = /\b(SDBH|DBH)\b/i;

export function porteeSource(p: {
	categorie: string | null;
	titre: string;
	dansIndexTechniques: boolean;
}): Portee {
	if (p.dansIndexTechniques) return "manga";
	if (p.categorie !== "Databook") return "periodique";
	return CATALOGUES_DE_CARTES.test(p.titre) ? "periodique" : "ouvrage";
}

const CHIFFRES: Record<string, number> = {
	〇: 0,
	零: 0,
	一: 1,
	二: 2,
	三: 3,
	四: 4,
	五: 5,
	六: 6,
	七: 7,
	八: 8,
	九: 9,
};
const RANGS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/**
 * Numéral japonais → entier. `null` si la chaîne n'en est pas un.
 *
 * Les databooks numérotent les chapitres en toutes lettres : « 其之二百二十六 »
 * pour le chapitre 226. Sans cette conversion, l'index de techniques ne rend
 * qu'une chaîne, inutilisable pour rapprocher un chapitre de la base.
 *
 * Le japonais écrit les rangs, pas les positions : 二百二十六 se lit
 * « deux-cent deux-dix six ». Un rang sans chiffre devant vaut un (十四 = 14).
 */
export function nombreKanji(s: string): number | null {
	const t = s.trim();
	if (!t) return null;
	let total = 0;
	let courant = 0;
	let vu = false;
	for (const c of t) {
		if (c in CHIFFRES) {
			courant = CHIFFRES[c];
			vu = true;
		} else if (c in RANGS) {
			total += (courant || 1) * RANGS[c];
			courant = 0;
			vu = true;
		} else {
			return null;
		}
	}
	if (!vu) return null;
	return total + courant;
}

/**
 * Extrait l'index de techniques d'un ouvrage transcrit.
 *
 * Le gabarit est celui du Super Exciting Guide : le nom de la technique, puis
 * une ligne « 初登場： 16巻 其之二百三十一 », puis parfois « 使用者： ベジータ ».
 * La transcription conserve les puces Markdown de l'énumération, qu'il faut
 * retirer — et le nom peut être préfixé de « 代表技： » sur les têtes de
 * rubrique.
 *
 * Le filtre décisif est le format de la ligne d'apparition : elle doit citer un
 * tome ET un chapitre. Sans lui, le mot 初登場 remonte 382 fois dans le corpus,
 * dont l'essentiel en prose (« depuis sa première apparition… ») et en légendes
 * d'illustration — du bruit qui ferait entrer des phrases entières comme noms
 * de techniques.
 */
export function extraireIndexTechniques(planches: { texte: string }[]): EntreeIndex[] {
	const out: EntreeIndex[] = [];
	for (const p of planches) {
		const lignes = p.texte.split("\n");
		for (let i = 0; i < lignes.length; i++) {
			if (!lignes[i].includes("初登場")) continue;
			const debut = nettoyerPuce(lignes[i])
				.replace(/^初登場[回]?[：:]\s*/, "")
				.trim();
			const chap = /其之([一二三四五六七八九十百千]+)/.exec(debut);
			if (!/^\d+巻/.test(debut) || !chap) continue;
			let ja = "";
			for (let j = i - 1; j >= 0 && !ja; j--)
				ja = nettoyerPuce(lignes[j])
					.replace(/^代表技[：:]\s*/, "")
					.trim();
			if (!ja) continue;
			const suivante = nettoyerPuce(lignes[i + 1] ?? "");
			out.push({
				ja,
				debut,
				chapitre: nombreKanji(chap[1]),
				usagers: suivante.startsWith("使用者")
					? suivante.replace(/^使用者[：:]\s*/, "").trim()
					: null,
			});
		}
	}
	return out;
}

function nettoyerPuce(l: string): string {
	return l.replace(/^[\s*•・-]+/, "").trim();
}
