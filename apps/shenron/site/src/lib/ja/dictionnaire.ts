/**
 * Japonais — dictionnaire général (JMdict) et analyse morphologique (kuromoji).
 *
 * Pas de `server-only` ici, contrairement à `lexique.ts` : ce module ne touche
 * pas la base, il lit deux fichiers. La garde `server-only` existe pour empêcher
 * `postgres` de fuir dans le bundle client ; l'imposer ici interdirait en prime
 * aux scripts de traitement en masse d'utiliser le même code que le site, ce qui
 * est exactement ce qu'on veut éviter. Les imports `node:path` / `Bun.file`
 * suffisent à ce que Next refuse ce module côté client.
 *
 * Deux ressources externes, chargées paresseusement et gardées en mémoire. Elles
 * ne sont PAS dans le dépôt (18 Mo pour le dictionnaire morphologique, 113 Mo
 * pour JMdict) : `scripts/ja-preparer.ts` les installe dans `.ja-data/`, comme
 * `apps/shenron/bot/.models` le fait pour les modèles du RAG.
 *
 * **JMdict** (EDRDG, ~218 000 entrées) est la base de jisho.org. Il sert ici à
 * une seule chose, mais décisive : dire si une graphie est un mot japonais réel.
 * L'analyseur morphologique s'appuie sur IPADIC, qui ignore la plupart des
 * emprunts à l'anglais — sans JMdict, « コミックス » (comics), « バーサス »
 * (versus) et « スライム » (slime) étaient signalés comme des fautes de lecture.
 *
 * **kuromoji** découpe le japonais, qui ne met pas d'espaces entre les mots, et
 * rend pour chaque token sa nature, sa lecture (donc le furigana) et sa forme de
 * base. Mesuré : 1 s de chargement, 6 407 phrases par seconde ensuite.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Racine des données préparées — hors dépôt, cf. `scripts/ja-preparer.ts`.
 *
 * Résolue **paresseusement**, et par essais successifs, parce que ce module est
 * chargé dans deux mondes qui ne s'accordent sur rien :
 *
 *  - un script Bun lancé depuis la racine du monorepo (`bun apps/shenron/site/scripts/…`)
 *    a pour répertoire courant `~/shenron` ;
 *  - le serveur Next a pour répertoire courant `apps/shenron/site`.
 *
 * Deux pièges déjà rencontrés, chacun ayant cassé un côté en réparant l'autre :
 * `process.cwd()` seul faisait chercher les ressources un cran trop haut depuis
 * un script — l'analyse rendait « 0 anomalie sur 5 912 planches », un faux
 * résultat rassurant. Et `import.meta.dir`, qui corrigeait cela, est une API Bun
 * : elle vaut `undefined` sous Turbopack, et le build échouait sur un
 * `join(undefined, …)` au moment de collecter la configuration des routes.
 *
 * D'où la résolution à l'appel, jamais à l'évaluation du module.
 */
const CANDIDATS = [".ja-data", "apps/shenron/site/.ja-data", "../.ja-data"];

let racineResolue: string | null = null;

function dossierDonnees(): string {
	if (racineResolue) return racineResolue;
	const force = process.env.JA_DATA_DIR;
	if (force) {
		racineResolue = force;
		return force;
	}
	const base = process.cwd();
	for (const c of CANDIDATS) {
		const chemin = join(/* turbopackIgnore: true */ base, c);
		// `existsSync` plutôt qu'une vérification asynchrone : la fonction est
		// appelée depuis des chemins synchrones, et le coût est celui d'un stat.
		if (
			existsSync(join(chemin, "jmdict-graphies.txt")) ||
			existsSync(join(chemin, "kuromoji-dict"))
		) {
			racineResolue = chemin;
			return chemin;
		}
	}
	// Rien trouvé : on renvoie le candidat le plus probable, pour que le message
	// d'erreur nomme un chemin utile plutôt que « undefined ».
	racineResolue = join(base, ".ja-data");
	return racineResolue;
}

export interface Token {
	surface: string;
	/** Nature grammaticale telle que rendue par IPADIC (名詞, 動詞, 助詞…). */
	pos: string;
	/** Lecture en katakana, ou `null` si le dictionnaire ne la connaît pas. */
	lecture: string | null;
	/** Forme de base (lemme) — « 使う » pour « 使っ ». */
	base: string | null;
	/** Le token est absent du dictionnaire morphologique. */
	inconnu: boolean;
}

type KuromojiToken = {
	surface_form: string;
	pos: string;
	reading?: string;
	basic_form?: string;
	word_type?: string;
};

export interface Analyseur {
	tokenize(s: string): KuromojiToken[];
}

let tokenizer: Analyseur | null = null;
let chargementTokenizer: Promise<Analyseur | null> | null = null;

/**
 * Analyseur morphologique, chargé une seule fois.
 *
 * Renvoie `null` si le dictionnaire n'est pas installé : l'appelant retombe sur
 * un traitement dégradé plutôt que de planter. C'est le même contrat que le RAG
 * face à son sidecar d'embeddings — une ressource absente dégrade, elle ne casse pas.
 */
export async function analyseur(): Promise<Analyseur | null> {
	if (tokenizer) return tokenizer;
	if (chargementTokenizer) return chargementTokenizer;
	chargementTokenizer = (async () => {
		try {
			const kuromoji = (await import("@sglkc/kuromoji")).default;
			tokenizer = await new Promise<Analyseur>((res, rej) =>
				kuromoji
					.builder({ dicPath: join(dossierDonnees(), "kuromoji-dict") })
					.build((e: Error | null, t: Analyseur) => (e ? rej(e) : res(t)))
			);
			return tokenizer;
		} catch (e) {
			console.warn(
				`[ja] analyseur morphologique indisponible (${dossierDonnees()}) :`,
				(e as Error).message
			);
			return null;
		}
	})();
	return chargementTokenizer;
}

/** Découpe un texte japonais. Tableau vide si l'analyseur n'est pas installé. */
export async function segmenter(texte: string): Promise<Token[]> {
	const tk = await analyseur();
	if (!tk) return [];
	return tk.tokenize(texte).map((t) => ({
		surface: t.surface_form,
		pos: t.pos,
		// IPADIC écrit « * » pour un champ qu'il ne connaît pas.
		lecture: t.reading && t.reading !== "*" ? t.reading : null,
		base: t.basic_form && t.basic_form !== "*" ? t.basic_form : null,
		inconnu: t.word_type === "UNKNOWN",
	}));
}

let graphies: Set<string> | null = null;

/**
 * Graphies connues de JMdict.
 *
 * Un `Set` de chaînes plutôt qu'une base indexée : 464 819 entrées tiennent en
 * mémoire pour quelques mégaoctets, et la question posée est toujours la même —
 * « ce mot existe-t-il ? ». Renvoie un ensemble vide si le fichier n'a pas été
 * préparé, ce qui revient à ne plus absoudre personne : le détecteur redevient
 * bruyant, mais il fonctionne.
 */
export async function graphiesJmdict(): Promise<Set<string>> {
	if (graphies) return graphies;
	// `node:fs` plutôt que `Bun.file` : ce module traverse le bundler de Next,
	// et s'en tenir aux API Node évite d'y introduire une dépendance au runtime
	// — c'est exactement ce genre de raccourci qui a fait échouer un build.
	const chemin = join(dossierDonnees(), "jmdict-graphies.txt");
	if (!existsSync(chemin)) {
		console.warn("[ja] JMdict absent — lancer `bun apps/shenron/site/scripts/ja-preparer.ts`");
		graphies = new Set();
		return graphies;
	}
	graphies = new Set((await readFile(chemin, "utf8")).split("\n").filter(Boolean));
	return graphies;
}

/**
 * Vérifie que les ressources sont installées, ou lève.
 *
 * Le mode dégradé (analyseur absent → aucun token) convient à une page web, qui
 * doit rester debout. Il ne convient PAS à un traitement par lot : l'analyse du
 * corpus a rendu « 0 anomalie sur 5 912 planches » alors qu'elle n'avait rien
 * analysé du tout. Les scripts appellent donc ceci en préambule et refusent de
 * démarrer plutôt que de produire un résultat faussement rassurant.
 */
export async function exigerRessources(): Promise<void> {
	const manquantes: string[] = [];
	if (!(await analyseur())) manquantes.push("dictionnaire kuromoji");
	if ((await graphiesJmdict()).size === 0) manquantes.push("index JMdict");
	if (manquantes.length > 0) {
		throw new Error(
			`ressources japonaises absentes (${manquantes.join(", ")}) dans ${dossierDonnees()}.\n` +
				"Lancer : bun apps/shenron/site/scripts/ja-preparer.ts"
		);
	}
}
