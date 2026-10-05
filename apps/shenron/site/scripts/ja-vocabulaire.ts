/**
 * Extrait du corpus le vocabulaire japonais qui manque à notre lexique.
 *
 *   bun apps/shenron/site/scripts/ja-vocabulaire.ts [--min N] [--json fichier]
 *
 * Le détecteur de fautes et cet outil lisent le MÊME signal — une graphie que ni
 * le dictionnaire morphologique, ni JMdict, ni notre lexique ne connaissent — et
 * le lisent en sens inverse :
 *
 *   - **rare** et proche d'un terme connu → faute de lecture (`ja-analyser.ts`) ;
 *   - **fréquente**, stable d'un ouvrage à l'autre, proche de rien → ce n'est
 *     pas une faute, c'est du vocabulaire qui nous manque.
 *
 * Le besoin est concret : nos 825 techniques n'ont AUCUN nom japonais en base.
 * Ni かめはめ波, ni 界王拳, ni ギャリック砲. Résultat, « ギャリック » (de
 * ギャリック砲, le Galick Gun) se fait « corriger » en « ガーリック » (Garlic,
 * un personnage) — le détecteur n'a rien d'autre à quoi le rattacher.
 *
 * La sortie est une proposition à relire, jamais une écriture : ces graphies
 * viennent d'une lecture automatique, elles peuvent être fautives elles-mêmes.
 */
import postgres from "postgres";
import { exigerRessources, graphiesJmdict, segmenter } from "../src/lib/ja/dictionnaire";
import { indexerLexique, suggerer, trierLexique, type TermeLexique } from "../src/lib/ja/anomalies";
import { contientJaponais, normaliserJa } from "../src/lib/ja/normalisation";

function argument(nom: string): string | undefined {
	const i = process.argv.indexOf(`--${nom}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

/** En deçà, une graphie inconnue est plus probablement une faute isolée. */
const MIN = Number(argument("min") ?? 8) || 8;
/** Un candidat vu dans plusieurs ouvrages est bien du vocabulaire, pas un accident. */
const MIN_OUVRAGES = 2;
const SORTIE = argument("json");

await exigerRessources();

const url = (await Bun.file(new URL("../.env", import.meta.url)).text())
	.split("\n")
	.find((l) => l.startsWith("DATABASE_URL="))
	?.slice("DATABASE_URL=".length)
	.replace(/^"|"$/g, "")
	.trim();
if (!url) throw new Error("DATABASE_URL introuvable dans apps/shenron/site/.env");
const sql = postgres(url, { max: 2 });

const brut = await sql<{ ja: string; fr: string; kind: string }[]>`
	SELECT name_ja AS ja, name AS fr, 'personnage' AS kind FROM bot.db_characters WHERE name_ja IS NOT NULL
	UNION ALL SELECT name_ja, name, 'planete'   FROM bot.db_planets    WHERE name_ja IS NOT NULL
	UNION ALL SELECT name_ja, name, 'race'      FROM bot.db_races      WHERE name_ja IS NOT NULL
	UNION ALL SELECT name_ja, name, 'saga'      FROM bot.db_sagas      WHERE name_ja IS NOT NULL
	UNION ALL SELECT name_ja, name, 'arc'       FROM bot.db_arcs       WHERE name_ja IS NOT NULL
	UNION ALL SELECT name_ja, name, 'technique' FROM bot.db_techniques WHERE name_ja IS NOT NULL
`;
const vus = new Set<string>();
const termes: TermeLexique[] = [];
for (const l of brut) {
	for (const v of String(l.ja).split(/[,、;]/)) {
		const ja = v
			.trim()
			.replace(/^[（(]+|[）)]+$/g, "")
			.trim();
		if (ja.length < 2 || !contientJaponais(ja) || vus.has(ja)) continue;
		vus.add(ja);
		termes.push({ ja, fr: String(l.fr ?? ""), kind: l.kind });
	}
}
const lexTrie = trierLexique(termes);
const index = indexerLexique(lexTrie);
const jmdict = await graphiesJmdict();
console.log(`lexique : ${termes.length} termes · JMdict : ${jmdict.size} graphies\n`);

const planches = await sql<{ titre: string; texte: string }[]>`
	SELECT d.title AS titre, p ->> 'text' AS texte
	FROM bot.db_databooks d, LATERAL jsonb_array_elements(d.pages) p
	WHERE nullif(btrim(p ->> 'text'), '') IS NOT NULL
`;
console.log(`${planches.length} planches\n· analyse…`);

const candidats = new Map<string, { n: number; ouvrages: Set<string>; exemples: string[] }>();
for (const [i, p] of planches.entries()) {
	if (i > 0 && i % 1000 === 0) console.log(`  ${i}/${planches.length}…`);
	for (const t of await segmenter(p.texte)) {
		if (!t.inconnu || !contientJaponais(t.surface)) continue;
		const norme = normaliserJa(t.surface);
		if (norme.length < 3) continue;
		if (jmdict.has(t.surface) || index.exacts.has(norme) || index.fragments.has(norme)) continue;
		const c = candidats.get(t.surface) ?? { n: 0, ouvrages: new Set<string>(), exemples: [] };
		c.n++;
		c.ouvrages.add(p.titre);
		if (c.exemples.length < 2) {
			// Un extrait de contexte : c'est ce qui permet à un relecteur de dire
			// « ça, c'est une technique » plutôt que de deviner sur un mot isolé.
			const pos = p.texte.indexOf(t.surface);
			if (pos >= 0)
				c.exemples.push(p.texte.slice(Math.max(0, pos - 25), pos + 35).replace(/\n/g, " "));
		}
		candidats.set(t.surface, c);
	}
}

// Le corpus entier sert de poids : à distance égale, le voisin le plus écrit
// l'emporte — c'est le même arbitrage que dans `ja-analyser.ts`.
const corpus = normaliserJa(planches.map((p) => p.texte).join("\n"));
const cacheOcc = new Map<string, number>();
function occurrences(graphie: string): number {
	const cle = normaliserJa(graphie);
	const vu = cacheOcc.get(cle);
	if (vu !== undefined) return vu;
	const n = cle ? corpus.split(cle).length - 1 : 0;
	cacheOcc.set(cle, n);
	return n;
}

// Deux familles se cachent derrière « inconnu partout », et il faut les séparer
// pour que la liste serve à quelque chose : celles qui ressemblent à un terme
// connu sont des fautes de lecture (« プロリー » pour ブロリー) et relèvent de
// `ja-analyser.ts` ; les autres sont du vocabulaire qui nous manque vraiment
// (« スカウター », le scouter, vu 477 fois dans 19 ouvrages).
const frequents = [...candidats.entries()]
	.filter(([, c]) => c.n >= MIN && c.ouvrages.size >= MIN_OUVRAGES)
	.toSorted((a, b) => b[1].n - a[1].n);

const vocabulaire: typeof frequents = [];
const fautes: { mot: string; vers: string; fr: string; n: number }[] = [];
for (const entree of frequents) {
	const [mot, c] = entree;
	const proche = suggerer(mot, lexTrie, index, occurrences);
	// Une faute suppose que la forme correcte soit, elle, réellement écrite.
	if (proche && occurrences(proche.attendu) > occurrences(mot)) {
		fautes.push({ mot, vers: proche.attendu, fr: proche.fr, n: c.n });
	} else {
		vocabulaire.push(entree);
	}
}

console.log(`\n${candidats.size} graphies inconnues · ${frequents.length} fréquentes`);
console.log(`  → ${vocabulaire.length} candidats de VOCABULAIRE (à ajouter au lexique)`);
console.log(`  → ${fautes.length} plutôt des FAUTES de lecture (cf. ja-analyser.ts)\n`);
console.log(`— vocabulaire manquant (vu ≥ ${MIN} fois, dans ≥ ${MIN_OUVRAGES} ouvrages) —`);
for (const [mot, c] of vocabulaire.slice(0, 40)) {
	console.log(
		`${String(c.n).padStart(4)}×  ${mot.padEnd(14)} ${String(c.ouvrages.size).padStart(2)} ouvrages   « ${(c.exemples[0] ?? "").slice(0, 60)} »`
	);
}
console.log(`\n— écartés, car probablement des fautes —`);
for (const f of fautes.slice(0, 12)) {
	console.log(`${String(f.n).padStart(4)}×  ${f.mot.padEnd(14)} → ${f.vers.padEnd(12)} ${f.fr}`);
}
const retenus = vocabulaire;

if (SORTIE) {
	await Bun.write(
		SORTIE,
		JSON.stringify(
			retenus.map(([mot, c]) => ({
				ja: mot,
				occurrences: c.n,
				ouvrages: [...c.ouvrages],
				exemples: c.exemples,
			})),
			null,
			2
		)
	);
	console.log(`\n→ ${SORTIE}`);
}
await sql.end();
