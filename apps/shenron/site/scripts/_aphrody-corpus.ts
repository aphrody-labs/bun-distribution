/**
 * Le corpus `.aphrody` : lecture, tri et extraction.
 *
 * Séparé de `canon-ingest.ts` pour être testable sans base de données
 * ni corpus installé — les formats de ces documents (guides traduits par
 * Kanzenshuu, notes françaises curées, introductions de tankōbon) sont ce qui
 * peut dériver silencieusement, et une extraction qui rend zéro citation ne se
 * voit pas autrement qu'en la rejouant sur un échantillon figé.
 *
 * Ce module ne parle ni à Postgres ni au réseau : il transforme du markdown en
 * extraits datés et sourcés.
 */
import type { CanonReference } from "../src/lib/canon-engine";

// ── Corpus ──────────────────────────────────────────────────────────────────

type Parseur = "citations" | "faits" | "tankobon" | "sections";

export interface Document {
	/** Motif de nom de fichier dans `<corpus>/memory` (préfixe suffisant). */
	motif: string;
	/** Le libellé de source affiché au lecteur. */
	source: string;
	annee?: number;
	lang: CanonReference["lang"];
	/** Un document peut porter deux formes : des citations ET de la synthèse. */
	parseurs: Parseur[];
}

/**
 * Les documents admis, et eux seuls.
 *
 * Chaque ligne est une source d'auteur ou un guide édité par Shueisha, traduit
 * par Kanzenshuu. Ni wiki de fans, ni forum, ni agrégateur : le corpus
 * `.aphrody` en contient, ils ne sont pas listés ici et le garde-fou plus bas
 * refuse de les lire même si quelqu'un les ajoutait.
 */
export const DOCUMENTS: Document[] = [
	{
		motif: "toriyama_toriyama-interviews",
		source: "Daizenshuu — Super Interviews d'Akira Toriyama",
		lang: "fr",
		parseurs: ["citations", "faits"],
	},
	{
		motif: "toriyama_toriyama-databook-seg",
		source: "Super Exciting Guide : Character Volume",
		annee: 2009,
		lang: "fr",
		parseurs: ["citations", "faits"],
	},
	{
		motif: "toriyama_akira-toriyama-tankobon-introductions",
		source: "Introductions des tankōbon par Akira Toriyama (trad. Kanzenshuu)",
		lang: "en",
		parseurs: ["tankobon"],
	},
	{
		motif: "toriyama_dragon-ball-forever-toriyama",
		source: "Dragon Ball Forever — interview d'Akira Toriyama (trad. Kanzenshuu)",
		annee: 2004,
		lang: "en",
		parseurs: ["sections"],
	},
	{
		motif: "shenron_seg-character-volume",
		source: "Super Exciting Guide : Character Volume (trad. Kanzenshuu)",
		annee: 2009,
		lang: "en",
		parseurs: ["sections"],
	},
	{
		motif: "shenron_seg-story-volume",
		source: "Super Exciting Guide : Story Volume (trad. Kanzenshuu)",
		annee: 2009,
		lang: "en",
		parseurs: ["sections"],
	},
	{
		motif: "shenron_daizenshuu-1-shenlong-times",
		source: "Daizenshuu 1 — Shenlong Times (trad. Kanzenshuu)",
		annee: 1995,
		lang: "en",
		parseurs: ["sections"],
	},
];

/** Un document dont le nom porte ça ne sera pas lu, quoi qu'il arrive. */
export const REFUSÉ = /(fandom|wikia|wiki-db|wiki-dbz|wiki-dbsuper|wikipedia|reddit|quora)/i;

// ── Utilitaires de texte ────────────────────────────────────────────────────

export const normaliser = (t: string) =>
	t
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");

// Le trait d'union colle deux mots : « Round-Table » ne nomme pas Table.
const CARACTERE_DE_MOT = /[\p{L}\p{N}-]/u;

/**
 * `sensible: true` compare sans passer par les minuscules.
 *
 * C'est ce qui distingue le personnage **Long** du mot anglais « long », et
 * **Apple** de « apple ». Dans ces guides, les noms propres sont capitalisés :
 * la casse est l'indice, et l'ignorer collait « husky », « week » et « table »
 * comme mots-clés Dragon Ball sur la moitié du corpus.
 */
export function contientMot(texteNormalise: string, mot: string, sensible = false): boolean {
	const cle = sensible ? mot.trim() : normaliser(mot).trim();
	if (!cle) return false;
	for (let i = texteNormalise.indexOf(cle); i !== -1; i = texteNormalise.indexOf(cle, i + 1)) {
		const avant = texteNormalise[i - 1];
		const apres = texteNormalise[i + cle.length];
		if (
			(avant === undefined || !CARACTERE_DE_MOT.test(avant)) &&
			(apres === undefined || !CARACTERE_DE_MOT.test(apres))
		) {
			return true;
		}
	}
	return false;
}

/** Retire le balisage qui ne veut rien dire une fois la phrase citée. */
function nettoie(texte: string): string {
	return texte
		// Les appels de note des guides (`<sup>11</sup>`) renvoient à un appareil
		// critique que nous n'affichons pas : gardés, ils s'écriraient en clair au
		// milieu d'une phrase de Toriyama. Le NUMÉRO part avec la balise — l'ôter
		// seule laissait « (anagramme d'akuma.)11 » en plein texte.
		.replace(/<sup\b[^>]*>[^<]*<\/sup>/gi, "")
		.replace(/<\/?[a-z][^>]*>/gi, "")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/[*_`]{1,3}/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

const STOPWORDS = new Set(
	[
		"avec","dans","pour","plus","tout","tous","cette","cela","elle","elles","leur","leurs","mais","donc","sans","sous","chez","fait","faire","être","avoir","dont","quoi","quel","quelle","quels","quelles","comme","alors","ainsi","entre","depuis","apres","avant","encore","aussi","meme","memes","toujours","jamais","quand","parce","pourquoi","comment","celui","ceux","celle","celles","votre","notre","vous","nous","them","that","this","with","from","have","has","was","were","what","when","which","while","would","could","should","about","there","their","they","your","you","the","and","for","are","but","not","did","does","how","why","who","whom","into","just","like","make","made","much","over","said","some","such","than","then","very","will","been","being","upon","onto","also","only","other","after","before","because","think","thought","really","things","thing","time","times","story","dragon","ball","manga","anime","chapter","volume","tome","serie","series","come","came","gets","many","much","sort","best","real","feel","touch","idea","kind","lots","want","went","take","took","give","given","know","knew","look","find","found","first","second","third","last","next","need","used","using","using","around","again","still","even","ever","never","away","back","down","here","where","those","these","them","well","more","most","many","less","little","great",
	].map((m) => m)
);

/**
 * Le pont anglais → français des mots qui portent les questions de canonicité.
 *
 * Les guides sont traduits en anglais par Kanzenshuu ; les lecteurs demandent
 * « pourquoi les cheveux de Goku deviennent blonds ». Sans ce pont, la réponse
 * de Toriyama à cette question exacte ne remonte jamais : seuls les noms
 * propres franchissent la barrière de langue.
 *
 * Ce pont n'affecte que l'INDEX — il ne traduit aucune citation, ne réécrit
 * aucun texte et ne crée aucun fait. Une citation reste affichée dans sa langue
 * d'origine, avec sa source.
 */
const PONT_EN_FR: Record<string, string[]> = {
	hair: ["cheveux"],
	gold: ["blond", "dore"],
	name: ["nom"],
	names: ["noms"],
	born: ["naissance", "ne"],
	birth: ["naissance"],
	death: ["mort"],
	power: ["puissance"],
	strongest: ["fort", "puissant"],
	technique: ["technique"],
	techniques: ["techniques"],
	transformation: ["transformation"],
	training: ["entrainement"],
	planet: ["planete"],
	planets: ["planetes"],
	god: ["dieu"],
	gods: ["dieux"],
	universe: ["univers"],
	cosmos: ["cosmos", "univers"],
	design: ["design", "conception"],
	author: ["auteur"],
	editor: ["editeur"],
	movie: ["film"],
	movies: ["films"],
	fusion: ["fusion"],
	tail: ["queue"],
	moon: ["lune"],
	wish: ["voeu", "souhait"],
	wishes: ["voeux", "souhaits"],
	race: ["race"],
	saiyans: ["saiyens", "saiyan"],
	namekians: ["namekiens", "nameks"],
	age: ["age", "vieillissement"],
	young: ["jeune", "jeunesse"],
	money: ["argent"],
	favorite: ["prefere", "favori"],
	strength: ["force"],
	sword: ["epee"],
	dragon: ["dragon"],
	ending: ["fin"],
	serialization: ["serialisation"],
};

/**
 * Les mots-clés d'une référence : les entités Dragon Ball qu'elle nomme.
 *
 * L'ordre compte — le lexique (personnages, planètes, races du wiki) d'abord,
 * les mots du titre ensuite. Une référence sans entité reconnue garde les mots
 * de son titre : elle ne remontera que sur une question qui les reprend, ce qui
 * est exactement le comportement voulu pour un propos général.
 */
export function motsCles(sujet: string, texte: string, lexique: string[]): string[] {
	const foin = `${sujet} ${texte}`;
	const cles: string[] = [];
	for (const nom of lexique) {
		if (cles.length >= 8) break;
		if (contientMot(foin, nom, true)) cles.push(nom.toLowerCase());
	}
	for (const mot of normaliser(sujet).split(/[^\p{L}\p{N}]+/u)) {
		if (cles.length >= 8) break;
		if (mot.length > 3 && !STOPWORDS.has(mot) && !cles.includes(mot)) cles.push(mot);
	}
	// Le pont de langue s'ajoute APRÈS le plafond des mots propres : il complète
	// l'index, il ne prend la place de rien.
	for (const cle of cles) {
		for (const fr of PONT_EN_FR[cle] ?? []) {
			if (cles.length >= 12) break;
			if (!cles.includes(fr)) cles.push(fr);
		}
	}
	return cles;
}

// ── Parseurs ────────────────────────────────────────────────────────────────

export interface Extrait {
	sujet: string;
	texte: string;
	annee?: number;
	/** Précision de source propre à l'extrait (« Daizenshuu 2 (1995) »). */
	precision?: string;
}

/** Frontmatter YAML (il y en a deux : celui d'import, celui du document). */
function sansFrontmatter(md: string): string {
	let reste = md;
	for (let i = 0; i < 2; i++) {
		const m = /^---\n[\s\S]*?\n---\n/.exec(reste);
		if (!m) break;
		reste = reste.slice(m[0].length);
	}
	return reste;
}

/**
 * Documents français curés : les citations entre guillemets, avec leur ligne
 * d'attribution `— Akira Toriyama, Daizenshuu 2 (1995)`.
 */
function parseCitations(md: string): Extrait[] {
	const lignes = sansFrontmatter(md).split("\n");
	const extraits: Extrait[] = [];
	let titre = "";
	let bloc: string[] = [];

	const vider = () => {
		if (bloc.length === 0) return;
		const brut = nettoie(bloc.join(" "));
		bloc = [];
		// L'attribution est la queue de la citation : « … » — Akira Toriyama, X (année)
		const attribution = /—\s*Akira Toriyama\s*[,:]?\s*(.*)$/i.exec(brut);
		const corps = attribution ? brut.slice(0, attribution.index) : brut;
		const texte = corps.replace(/^[«"“\s]+|[»"”\s]+$/g, "").trim();
		if (texte.length < 40) return;
		const precision = attribution?.[1]?.trim().replace(/[,;:.\s]+$/, "");
		const annee = precision ? Number(/\((\d{4})\)/.exec(precision)?.[1] ?? "") : NaN;
		extraits.push({
			sujet: titre,
			texte,
			...(Number.isFinite(annee) ? { annee } : {}),
			...(precision ? { precision } : {}),
		});
	};

	for (const ligne of lignes) {
		const entete = /^#{2,4}\s+(.*)$/.exec(ligne);
		if (entete) {
			vider();
			titre = nettoie(entete[1]!).replace(/^[^\p{L}\p{N}]+/u, "");
			continue;
		}
		const citation = /^\s*>\s?(.*)$/.exec(ligne);
		if (citation) {
			if (citation[1]!.trim()) bloc.push(citation[1]!);
			continue;
		}
		vider();
	}
	vider();
	return extraits;
}

/** Les 42 introductions de tankōbon : une par tome, datée. */
function parseTankobon(md: string): Extrait[] {
	const texte = sansFrontmatter(md);
	const motif =
		/\[Dragon Ball Volume (\d+):\s*([^\]]+)\]\([^)]*\)\s*\/\s*\(([^)]*)\)\s*\n+([^\n]+)/g;
	const extraits: Extrait[] = [];
	for (const m of texte.matchAll(motif)) {
		const corps = nettoie(m[4]!);
		if (corps.length < 60) continue;
		const annee = Number(/(\d{4})/.exec(m[3]!)?.[1] ?? "");
		extraits.push({
			sujet: `Tome ${m[1]!.padStart(2, "0")} — ${nettoie(m[2]!)}`,
			texte: corps,
			...(Number.isFinite(annee) ? { annee } : {}),
			precision: `introduction du tome ${Number(m[1])}`,
		});
	}
	return extraits;
}

/**
 * Guides traduits par Kanzenshuu : une question (ou un intertitre) suivie de la
 * réponse de Toriyama. On garde la question comme sujet et la réponse comme
 * citation.
 */
function parseSections(md: string): Extrait[] {
	const lignes = sansFrontmatter(md).split("\n");
	const extraits: Extrait[] = [];
	let sujet = "";
	let corps: string[] = [];

	const estBruit = (t: string) =>
		!t ||
		/^(translations archive|main navigation|kanzentai|welcome to)/i.test(t) ||
		/^https?:/i.test(t) ||
		t.length < 3;

	const vider = () => {
		const texte = nettoie(corps.join(" "));
		corps = [];
		if (!sujet || texte.length < 120) return;
		extraits.push({ sujet, texte: texte.slice(0, 1400) });
	};

	for (let i = 0; i < lignes.length; i++) {
		const brute = lignes[i]!;
		const ligne = nettoie(brute);
		const soulignee = /^[=-]{4,}\s*$/.test(nettoie(lignes[i + 1] ?? ""));
		const entete = /^#{1,6}\s+/.test(brute);
		const question = ligne.length <= 140 && ligne.endsWith("?");

		if (entete || soulignee || question) {
			vider();
			sujet = estBruit(ligne.replace(/^#{1,6}\s+/, "")) ? "" : ligne.replace(/^#{1,6}\s+/, "");
			if (soulignee) i++;
			continue;
		}
		if (estBruit(ligne)) {
			// Une ligne vide sépare deux paragraphes ; deux séparent deux propos.
			if (!ligne && corps.length > 0) corps.push("");
			continue;
		}
		corps.push(ligne);
	}
	vider();
	return extraits;
}

/**
 * Documents français curés, versant synthèse : ce que la section **affirme**,
 * hors citation.
 *
 * Les révélations du Super Exciting Guide ne sont pas des phrases entre
 * guillemets mais des faits mis en forme (origine des Kaïoshin, noms civils de
 * C-17 et C-18…). Les citations, elles, sont déjà prises par `parseCitations` :
 * on saute donc les lignes `>` pour ne pas ressortir deux fois le même propos.
 * Les tableaux sont sautés aussi — un tableau aplati en une ligne de tuyaux
 * n'est pas une phrase citable.
 */
function parseFaits(md: string): Extrait[] {
	const lignes = sansFrontmatter(md).split("\n");
	const extraits: Extrait[] = [];
	let titre = "";
	let corps: string[] = [];

	const vider = () => {
		const texte = nettoie(corps.join(" ")).replace(/\s*[-–]\s+/g, " — ");
		corps = [];
		if (!titre || texte.length < 120) return;
		extraits.push({ sujet: titre, texte: texte.slice(0, 1400), precision: titre.slice(0, 120) });
	};

	for (const ligne of lignes) {
		const entete = /^#{2,4}\s+(.*)$/.exec(ligne);
		if (entete) {
			vider();
			titre = nettoie(entete[1]!).replace(/^[^\p{L}\p{N}]+/u, "");
			continue;
		}
		const t = ligne.trim();
		if (!t || t.startsWith(">") || t.startsWith("|") || t.startsWith("---") || t.startsWith("![")) {
			continue;
		}
		corps.push(nettoie(t.replace(/^[-*]\s+/, "")));
	}
	vider();
	return extraits;
}

export const PARSEURS: Record<Parseur, (md: string) => Extrait[]> = {
	citations: parseCitations,
	faits: parseFaits,
	tankobon: parseTankobon,
	sections: parseSections,
};

