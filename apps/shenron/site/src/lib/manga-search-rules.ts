/**
 * manga-search-rules — normalisation et classement de la recherche dans les
 * transcriptions du manga. Client-safe et pur : `manga-api.ts` est
 * `server-only` et rendrait ces règles intestables.
 *
 * Pourquoi un algorithme plutôt qu'un `ILIKE` : mesuré le 2026-09-12 sur les
 * 12 593 planches transcrites, `ILIKE '%kamehameha%'` trouvait 3 planches, la
 * similarité de trigrammes 79. L'OCR écrit « KAMÉHAMÉHA », « KAMEHAME HA »,
 * « KAMEHA-MEHA » ; une faute de frappe (« kamehameah ») donnait 0 résultat.
 * Le rappel se fait donc en SQL (trigrammes, ou sous-chaîne pour le japonais que
 * les trigrammes ne découpent pas), et le CLASSEMENT se fait ici, sur des
 * critères qu'un lecteur reconnaît : l'expression exacte d'abord, puis tous les
 * mots présents et rapprochés, puis la fréquence.
 */

/** Minuscules, sans diacritiques latins, espaces compactés. Préserve les marques sonores japonaises. */
export function normaliser(texte: string): string {
	return texte
		.normalize("NFD")
		.replace(/[\u0300-\u036f]+/g, "")
		.normalize("NFC")
		.toLowerCase()
		.replace(/[\s　]+/g, " ")
		.trim();
}

/** Kana, kanji ou pleine chasse : les trigrammes Postgres n'y voient rien. */
export function estCjk(texte: string): boolean {
	return /[぀-ヿ㐀-鿿＀-￯]/.test(texte);
}

/**
 * Forme compacte : lettres et chiffres seulement. « KAMEHAME HA » et
 * « KAMEHA-MEHA » deviennent « kamehameha » — les coupures de bulle de l'OCR
 * ne cassent plus la correspondance exacte.
 */
export function compacter(texte: string): string {
	return normaliser(texte).replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Mots de la requête (≥ 2 caractères), dédoublonnés. */
export function motsDe(requete: string): string[] {
	return [...new Set(normaliser(requete).split(/[^\p{L}\p{N}]+/u))].filter((m) => m.length >= 2);
}

/** Distance d'édition bornée : au-delà de `max`, on s'arrête. */
function distanceBornee(a: string, b: string, max: number): number {
	if (Math.abs(a.length - b.length) > max) return max + 1;
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const cur = [i];
		let minLigne = i;
		for (let j = 1; j <= b.length; j++) {
			const v = Math.min(
				prev[j]! + 1,
				cur[j - 1]! + 1,
				prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
			);
			cur.push(v);
			if (v < minLigne) minLigne = v;
		}
		if (minLigne > max) return max + 1;
		prev = cur;
	}
	return prev[b.length]!;
}

/** Un mot de la requête est-il présent, à une faute près pour les mots longs ? */
function motPresent(mot: string, motsTexte: readonly string[]): boolean {
	for (const m of motsTexte) {
		if (m.includes(mot)) return true;
		const maxLen = Math.max(mot.length, m.length);
		const tolerance = maxLen >= 8 ? 2 : maxLen >= 5 ? 1 : 0;
		if (tolerance > 0 && distanceBornee(mot, m, tolerance) <= tolerance) return true;
	}
	return false;
}

export type DetailScore = {
	score: number;
	exact: boolean;
	couverture: number;
	occurrences: number;
};

/**
 * Score d'une planche pour une requête, dans [0, 100].
 *
 *  - 50 : l'expression entière apparaît (forme compacte, coupures d'OCR comprises) ;
 *  - 30 : part des mots de la requête présents (fautes tolérées sur les mots longs) ;
 *  - 10 : fréquence de l'expression, amortie (dix « Kamehameha » ≠ dix fois mieux) ;
 *  - 10 : similarité de trigrammes fournie par Postgres (départage fin).
 *
 * Une planche où l'OCR n'a presque rien lu est pénalisée : une bulle de cinq
 * caractères qui « contient » la requête est plus souvent un artefact qu'un
 * dialogue.
 */
export function scorer(texte: string, requete: string, similarite = 0): DetailScore {
	const q = normaliser(requete);
	if (!q) return { score: 0, exact: false, couverture: 0, occurrences: 0 };

	if (estCjk(q)) {
		const qClean = q.replace(/[、。！？・「」『』（）～〜【】\p{P}\p{S}\s　]+/gu, "");
		const texteNorm = normaliser(texte);
		const texteClean = texteNorm.replace(/[、。！？・「」『』（）～〜【】\p{P}\p{S}\s　]+/gu, "");
		if (!qClean) return { score: 0, exact: false, couverture: 0, occurrences: 0 };
		const occurrences = qClean && texteClean.includes(qClean) ? texteClean.split(qClean).length - 1 : 0;
		const exact = occurrences > 0;

		const segments = q.split(/[\s　、。！？・「」『』（）～〜【】\p{P}\p{S}]+/gu).filter((s) => s.length >= 1);
		const segmentsTrouves = segments.filter((s) => texteClean.includes(s)).length;
		const couverture = segments.length > 0 ? segmentsTrouves / segments.length : exact ? 1 : 0;

		let score = exact ? 60 + Math.min(10, Math.log2(occurrences + 1) * 5) : couverture * 50;
		score += Math.max(0, Math.min(1, similarite)) * 10;
		if (texteClean.length < 6) score *= 0.6;
		return { score: Math.round(Math.min(100, score) * 10) / 10, exact, couverture, occurrences };
	}

	const texteCompact = compacter(texte);
	const qCompact = compacter(requete);
	if (qCompact.length < 2) {
		return { score: 0, exact: false, couverture: 0, occurrences: 0 };
	}

	const mots = motsDe(requete);
	const motsTexte = normaliser(texte).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

	// Pour les mots courts (<= 3 lettres), l'exactitude requiert le mot entier plutôt
	// qu'une sous-chaîne compactée quelconque pour éviter les faux positifs (ex: "ki" dans "kinto").
	const exact =
		qCompact.length <= 3
			? motsTexte.includes(qCompact)
			: Boolean(qCompact && texteCompact.includes(qCompact));

	const occurrences = exact
		? qCompact.length <= 3
			? motsTexte.filter((m) => m === qCompact).length
			: texteCompact.split(qCompact).length - 1
		: 0;

	const trouves = mots.filter((m) => motPresent(m, motsTexte)).length;
	const couverture = mots.length ? trouves / mots.length : exact ? 1 : 0;

	let score =
		(exact ? 50 : 0) +
		couverture * 30 +
		Math.min(10, Math.log2(occurrences + 1) * 5) +
		Math.max(0, Math.min(1, similarite)) * 10;

	if (texteCompact.length < 12) score *= 0.6;
	return { score: Math.round(Math.min(100, score) * 10) / 10, exact, couverture, occurrences };
}

/** Position du mot du texte le plus proche d'un mot de la requête (faute tolérée). */
function positionApprochee(texteNorm: string, requeteNorm: string): number {
	let meilleure = { pos: -1, dist: Infinity };
	for (const mot of motsDe(requeteNorm)) {
		for (const m of texteNorm.matchAll(/[\p{L}\p{N}]+/gu)) {
			const motTexte = m[0];
			const maxLen = Math.max(mot.length, motTexte.length);
			const tolerance = maxLen >= 8 ? 2 : maxLen >= 5 ? 1 : 0;
			if (tolerance === 0) continue;
			const d = distanceBornee(mot, motTexte, tolerance);
			if (d <= tolerance && d < meilleure.dist) meilleure = { pos: m.index ?? -1, dist: d };
		}
	}
	return meilleure.pos;
}

function echapperRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Met en valeur les termes de la requête dans un extrait avec des balises `<mark>`.
 * Préserve scrupuleusement la casse et la ponctuation d'origine du texte.
 */
export function surlignerExtrait(texte: string, requete: string): string {
	if (!texte || !requete.trim()) return texte;

	const normChars: string[] = [];
	const origine: number[] = [];
	for (let i = 0; i < texte.length; i++) {
		const n = normaliser(texte[i]!);
		const s = n.length ? n : texte[i] === " " ? " " : "";
		for (const c of s) {
			normChars.push(c);
			origine.push(i);
		}
	}
	const texteNorm = normChars.join("");

	const termes: string[] = [];
	if (estCjk(requete)) {
		const segments = requete
			.split(/[\s　、。！？・「」『』（）～〜【】\p{P}\p{S}]+/gu)
			.map((s) => normaliser(s))
			.filter((s) => s.length >= 1);
		termes.push(...segments);
		const fullCjk = requete.replace(/[\s　、。！？・「」『』（）～〜【】\p{P}\p{S}]+/gu, "");
		if (fullCjk && !termes.includes(fullCjk)) termes.push(fullCjk);
	} else {
		const propre = normaliser(requete).replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "");
		if (propre.length >= 2) termes.push(propre);
		for (const m of motsDe(requete)) {
			if (!termes.includes(m)) termes.push(m);
		}
	}

	termes.sort((a, b) => b.length - a.length);

	const intervalles: Array<[number, number]> = [];

	for (const terme of termes) {
		if (!terme) continue;

		let idx = 0;
		while ((idx = texteNorm.indexOf(terme, idx)) !== -1) {
			const start = origine[idx]!;
			const end = origine[idx + terme.length - 1]! + 1;
			intervalles.push([start, end]);
			idx += terme.length;
		}

		if (!estCjk(terme) && terme.length >= 4) {
			const pattern = terme
				.split("")
				.map((c) => echapperRegex(c))
				.join("[-\\s]*");
			try {
				const regex = new RegExp(pattern, "gi");
				for (const match of texteNorm.matchAll(regex)) {
					const mIndex = match.index ?? -1;
					if (mIndex >= 0 && match[0].length > 0) {
						const start = origine[mIndex]!;
						const end = origine[mIndex + match[0].length - 1]! + 1;
						intervalles.push([start, end]);
					}
				}
			} catch {
				// repli silencieux si regex invalide
			}
		}
	}

	if (intervalles.length === 0) return texte;

	intervalles.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const fusionnes: Array<[number, number]> = [intervalles[0]!];
	for (let i = 1; i < intervalles.length; i++) {
		const dernier = fusionnes[fusionnes.length - 1]!;
		const courant = intervalles[i]!;
		if (courant[0] <= dernier[1]) {
			dernier[1] = Math.max(dernier[1], courant[1]);
		} else {
			fusionnes.push(courant);
		}
	}

	let res = "";
	let dernierPos = 0;
	for (const [start, end] of fusionnes) {
		res += texte.slice(dernierPos, start) + "<mark>" + texte.slice(start, end) + "</mark>";
		dernierPos = end;
	}
	res += texte.slice(dernierPos);
	return res;
}

export type OptionsExtrait = {
	largeur?: number;
	surligner?: boolean;
};

/**
 * Extrait de ~160 caractères centré sur la première occurrence, retrouvée
 * malgré les accents, la casse et la ponctuation (la position est cherchée sur
 * le texte normalisé caractère par caractère, pour rester alignée sur l'original).
 */
export function extraitAutour(
	texte: string,
	requete: string,
	largeurOuOptions: number | OptionsExtrait = 160
): string {
	const largeur = typeof largeurOuOptions === "number" ? largeurOuOptions : largeurOuOptions.largeur ?? 160;
	const surligner = typeof largeurOuOptions === "object" && Boolean(largeurOuOptions.surligner);

	const cible = normaliser(requete);
	if (!cible) {
		const brut = texte.slice(0, largeur);
		return surligner ? surlignerExtrait(brut, requete) : brut;
	}

	const norm: string[] = [];
	const origine: number[] = [];
	for (let i = 0; i < texte.length; i++) {
		const n = normaliser(texte[i]!);
		for (const c of n.length ? n : texte[i] === " " ? " " : "") {
			norm.push(c);
			origine.push(i);
		}
	}
	const texteNorm = norm.join("");
	let pos = texteNorm.indexOf(cible);

	// Épuration des guillemets et de la ponctuation périphérique
	const cibleClean = cible.replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "");
	if (pos < 0 && cibleClean) {
		pos = texteNorm.indexOf(cibleClean);
	}

	// Pour le japonais : repli sur les segments kana/kanji si l'expression globale n'a pas matché
	if (pos < 0 && estCjk(requete)) {
		const segments = cible
			.split(/[\s　、。！？・「」『』（）～〜【】\p{P}\p{S}]+/gu)
			.filter((s) => s.length >= 1);
		for (const seg of segments) {
			const p = texteNorm.indexOf(seg);
			if (p >= 0) {
				pos = p;
				break;
			}
		}
	}

	// Requête fautive (« kamehameah ») : on centre sur le mot le plus proche,
	// celui qui a justifié la correspondance, plutôt que sur le début du texte.
	if (pos < 0) pos = positionApprochee(texteNorm, cibleClean || cible);
	if (pos < 0) {
		const brut = texte.slice(0, largeur).trim() + (texte.length > largeur ? "…" : "");
		return surligner ? surlignerExtrait(brut, requete) : brut;
	}

	const centre = origine[pos] ?? 0;
	const debut = Math.max(0, centre - Math.floor(largeur * 0.35));
	const fin = Math.min(texte.length, debut + largeur);
	const extrait = `${debut > 0 ? "…" : ""}${texte.slice(debut, fin).trim()}${fin < texte.length ? "…" : ""}`;
	return surligner ? surlignerExtrait(extrait, requete) : extrait;
}
