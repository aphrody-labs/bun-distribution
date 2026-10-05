/**
 * Propose un nom japonais pour les techniques du wiki, chaque valeur adossée
 * à une planche de databook.
 *
 *   bun apps/shenron/site/scripts/ja-appariement.ts [--simulation]     # simulation — seul mode
 *   bun apps/shenron/site/scripts/ja-appariement.ts --json p.json      # sortie vérifiable
 *   bun apps/shenron/site/scripts/ja-appariement.ts --limite 30        # échantillon
 *   bun apps/shenron/site/scripts/ja-appariement.ts --tout             # inclut les rejets
 *   bun apps/shenron/site/scripts/ja-appariement.ts --champs           # faisabilité par table
 *
 * **Ce script n'écrit rien**, et `--simulation` est son seul mode : `--apply`
 * est refusé explicitement. Une graphie japonaise fausse sur une fiche publique
 * se recopie, alors qu'un champ vide se complète — 193 valeurs posées d'un coup
 * sans relecture, ce serait 193 erreurs possibles publiées d'un coup. La sortie
 * est une proposition, avec pour chaque valeur l'ouvrage, la planche et
 * l'extrait qui la portent.
 *
 * ## Ce qu'il fait, et pourquoi dans cet ordre
 *
 * 1. **Hypothèse.** Le corpus Xenoverse 2 du RAG (`apps/shenron/bot/data/rag/corpus-xv2.json`,
 *    extrait des `msg` FR+JP du jeu) associe un nom français à une graphie
 *    japonaise par identifiant de compétence. C'est la seule passerelle sans
 *    approximation dont on dispose — cf. `src/lib/ja/appariement.ts` pour les
 *    deux autres, mesurées et écartées.
 * 2. **Preuve.** La graphie n'est retenue que si les databooks l'écrivent.
 *    Le jeu invente : 491 des 701 graphies qu'il propose n'apparaissent dans
 *    aucune des 9 384 planches transcrites. Elles sont rejetées.
 * 3. **Arbitrage.** Une graphie attestée mais qui est aussi un mot japonais
 *    courant (突撃, 挑発, 自爆) passe en `a_verifier` : le databook l'écrit,
 *    mais rien ne dit qu'il y désigne la technique.
 *
 * Le fichier Xenoverse 2 n'est pas dans le dépôt (données extraites du jeu).
 * Sans lui le script tourne quand même : il se rabat sur le seul index de
 * techniques des databooks, qui apparie moins mais ne dépend que de sources
 * officielles.
 */
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import {
	cleNom,
	compterOccurrences,
	extraireCandidatsXv2,
	extraireIndexTechniques,
	graphieEspacee,
	grouperCandidats,
	juger,
	porteeSource,
	type EntreeIndex,
	type Niveau,
	type Portee,
} from "../src/lib/ja/appariement";
import { graphiesJmdict } from "../src/lib/ja/dictionnaire";
import { normaliserJa } from "../src/lib/ja/normalisation";

function argument(nom: string): string | undefined {
	const i = process.argv.indexOf(`--${nom}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

const SORTIE = argument("json");
const LIMITE = Number(argument("limite") ?? 0) || 0;
const TOUT = process.argv.includes("--tout");
const CHAMPS = process.argv.includes("--champs");
if (process.argv.includes("--apply")) {
	console.error(
		"Ce script ne sait pas écrire, et c'est voulu : une graphie fausse sur une fiche\n" +
			"publique se recopie. Relire la sortie --json, puis écrire par /api/wiki-admin,\n" +
			"qui versionne chaque modification dans public.wiki_revisions."
	);
	process.exit(2);
}
const XV2 =
	argument("xv2") ?? new URL("../../bot/data/rag/corpus-xv2.json", import.meta.url).pathname;

// `pop()` et non `find()` : `apps/shenron/site/.env` porte DEUX lignes DATABASE_URL, la
// Neon d'avant migration (commentée) précédant la locale. Ancrer sur la
// dernière évite de lire une base décommissionnée.
const url = (await Bun.file(new URL("../.env", import.meta.url)).text())
	.split("\n")
	.filter((l) => l.startsWith("DATABASE_URL="))
	.pop()
	?.slice("DATABASE_URL=".length)
	.replace(/^"|"$/g, "")
	.trim();
if (!url) throw new Error("DATABASE_URL introuvable dans apps/shenron/site/.env");
const sql = postgres(url, { max: 2 });

console.log("· lecture des transcriptions…");
const planches = await sql<
	{ ouvrage: number; titre: string; categorie: string | null; numero: number; texte: string }[]
>`
	SELECT d.id AS ouvrage, d.title AS titre, d.category AS categorie,
	       (p ->> 'number')::int AS numero, p ->> 'text' AS texte
	FROM bot.db_databooks d, LATERAL jsonb_array_elements(d.pages) p
	WHERE nullif(btrim(p ->> 'text'), '') IS NOT NULL
	ORDER BY d.id, numero
`;
const corpus = planches.map((p) => p.texte).join("\n");
console.log(`  ${planches.length} planches · ${corpus.length.toLocaleString("fr-FR")} signes`);

// L'index de techniques des databooks : la corroboration la plus forte, parce
// qu'elle vient du manga (tome + chapitre de première apparition) et pas d'un jeu.
const index = extraireIndexTechniques(planches);
const parGraphieIndex = new Map<string, EntreeIndex>();
for (const e of index) if (!parGraphieIndex.has(e.ja)) parGraphieIndex.set(e.ja, e);
console.log(`  ${index.length} entrées d'index de techniques (${parGraphieIndex.size} graphies)`);

let candidats = new Map<string, { id: string; fr: string; ja: string }[]>();
if (existsSync(XV2)) {
	const docs = JSON.parse(readFileSync(XV2, "utf-8")).docs as { id: string; markdown: string }[];
	candidats = grouperCandidats(extraireCandidatsXv2(docs));
	console.log(`  ${candidats.size} noms français outillés par le catalogue Xenoverse 2`);
} else {
	console.log(`  (${XV2} absent — seul l'index des databooks servira d'hypothèse)`);
}

const jmdict = await graphiesJmdict();
if (jmdict.size === 0) {
	console.log("  ⚠ JMdict absent : impossible de distinguer un mot courant d'un nom propre.");
	console.log("    Lancer `bun apps/shenron/site/scripts/ja-preparer.ts` pour un verdict fiable.");
}

/**
 * Plafond de faisabilité, table par table.
 *
 * La question n'est pas « peut-on remplir `name_ja` ? » mais « le corpus
 * contient-il seulement de quoi le faire ? ». On la mesure sur les valeurs DÉJÀ
 * renseignées : si les databooks n'écrivent que les deux tiers des noms
 * japonais que l'on connaît, ils n'en écriront pas davantage pour ceux qui
 * manquent. C'est un plafond, pas une prédiction.
 */
if (CHAMPS) {
	const tables = [
		["db_characters", "personnages"],
		["db_planets", "planètes"],
		["db_races", "races"],
		["db_sagas", "sagas"],
		["db_arcs", "arcs"],
		["db_techniques", "techniques"],
	] as const;
	const corpusNorme = normaliserJa(corpus);
	console.log("\n— plafond de faisabilité (attestation des name_ja déjà connus) —");
	for (const [table, libelle] of tables) {
		const lignes = (await sql.unsafe(
			`SELECT name, name_ja, description FROM bot.${table}`
		)) as unknown as { name: string; name_ja: string | null; description: string | null }[];
		const avec = lignes.filter((l) => l.name_ja);
		let attestes = 0;
		for (const l of avec) {
			const v = normaliserJa(
				String(l.name_ja)
					.split(/[,、;]/)[0]
					.trim()
			);
			if (v.length >= 2 && corpusNorme.includes(v)) attestes++;
		}
		const part = avec.length > 0 ? Math.round((attestes / avec.length) * 100) : 0;
		// Défaut « un signe, une espace » : compté ici parce que ces valeurs sont
		// invisibles au corpus, donc comptées comme non attestées sans qu'on sache
		// pourquoi. Les voir séparément évite de conclure à un trou de source.
		const defauts = avec.filter((l) => graphieEspacee(String(l.name_ja)));
		console.log(
			`  ${libelle.padEnd(12)} ${String(lignes.length).padStart(5)} fiches · ` +
				`name_ja : ${String(avec.length).padStart(4)} (${String(lignes.length - avec.length).padStart(4)} vides) · ` +
				`attestés dans les databooks : ${String(attestes).padStart(4)} (${part} %) · ` +
				`sans description : ${String(lignes.filter((l) => !l.description).length).padStart(4)} · ` +
				`écriture défectueuse : ${defauts.length}`
		);
		for (const d of defauts) console.log(`      ⚠ ${d.name} : « ${d.name_ja} »`);
	}
	await sql.end();
	process.exit(0);
}

const techniques = await sql<
	{ id: number; name: string; name_ja: string | null; type: string | null }[]
>`
	SELECT id, name, name_ja, type FROM bot.db_techniques ORDER BY id
`;

interface Proposition {
	id: number;
	nom: string;
	valeurActuelle: string | null;
	/** La valeur déjà en base porte le défaut « un signe, une espace ». */
	defautEcriture: boolean;
	japonais: string | null;
	niveau: Niveau;
	motif: string;
	/** Ce que l'attestation prouve du statut de la technique (manga / ouvrage / périodique). */
	portee: Portee | null;
	attestations: number;
	planches: number;
	source: { ouvrage: string; categorie: string | null; planche: number; extrait: string } | null;
	/** Première apparition selon l'index d'un databook, telle qu'imprimée. */
	debutManga: string | null;
	usagers: string | null;
	origineHypothese: "xenoverse2" | "index-databook" | null;
}

/**
 * Localise une planche qui écrit la graphie, pour pouvoir la citer.
 *
 * Les ouvrages de catégorie « Databook » (Daizenshuu, Chōzenshū, guides
 * officiels) sont cherchés d'abord : ils décrivent l'œuvre. Les V-Jump et les
 * guides de jeux de cartes citent les mêmes mots, mais pour vendre une carte —
 * une attestation qui ne dit rien du manga. Le repli ne les exclut pas, il les
 * relègue, et la catégorie est reportée pour que la relecture le voie.
 */
function citer(
	ja: string
): { ouvrage: string; categorie: string | null; planche: number; extrait: string } | null {
	const trouver = (filtre: (p: { categorie: string | null; titre: string }) => boolean) => {
		for (const p of planches) {
			if (!filtre(p)) continue;
			const i = p.texte.indexOf(ja);
			if (i < 0) continue;
			return {
				ouvrage: p.titre,
				categorie: p.categorie,
				planche: p.numero,
				extrait: p.texte
					.slice(Math.max(0, i - 50), i + ja.length + 50)
					.replace(/\s+/g, " ")
					.trim(),
			};
		}
		return null;
	};
	return (
		trouver(
			(p) =>
				porteeSource({ categorie: p.categorie, titre: p.titre, dansIndexTechniques: false }) ===
				"ouvrage"
		) ?? trouver(() => true)
	);
}

const props: Proposition[] = [];

for (const t of techniques) {
	const groupe = candidats.get(cleNom(t.name)) ?? [];
	const graphies = [...new Set(groupe.map((g) => g.ja))];
	const ja = graphies.length === 1 ? graphies[0] : null;
	if (!ja) {
		props.push({
			id: t.id,
			nom: t.name,
			valeurActuelle: t.name_ja,
			defautEcriture: t.name_ja ? graphieEspacee(t.name_ja) : false,
			japonais: null,
			niveau: "rejete",
			motif: graphies.length > 1 ? "plusieurs graphies pour ce nom" : "aucune hypothèse de graphie",
			portee: null,
			attestations: 0,
			planches: 0,
			source: null,
			debutManga: null,
			usagers: null,
			origineHypothese: null,
		});
		continue;
	}
	const occurrences = compterOccurrences(corpus, ja);
	const nbPlanches = occurrences > 0 ? planches.filter((p) => p.texte.includes(ja)).length : 0;
	const entree = parGraphieIndex.get(ja) ?? null;
	const verdict = juger({
		ja,
		ambigu: false,
		occurrences,
		motCourant: jmdict.has(ja) || jmdict.has(normaliserJa(ja)),
		dansIndexTechniques: entree !== null,
	});
	const source = occurrences > 0 ? citer(ja) : null;
	props.push({
		id: t.id,
		nom: t.name,
		valeurActuelle: t.name_ja,
		defautEcriture: t.name_ja ? graphieEspacee(t.name_ja) : false,
		japonais: ja,
		niveau: verdict.niveau,
		motif: verdict.motif,
		portee:
			occurrences > 0
				? porteeSource({
						categorie: source?.categorie ?? null,
						titre: source?.ouvrage ?? "",
						dansIndexTechniques: entree !== null,
					})
				: null,
		attestations: occurrences,
		planches: nbPlanches,
		source,
		debutManga: entree?.debut ?? null,
		usagers: entree?.usagers ?? null,
		origineHypothese: "xenoverse2",
	});
}

const surs = props.filter((p) => p.niveau === "sur");
const aVerifier = props.filter((p) => p.niveau === "a_verifier");
const rejetes = props.filter((p) => p.niveau === "rejete");
const nouveaux = surs.filter((p) => !p.valeurActuelle);
// Comparaison normalisée : sans elle, une valeur en base écrite « ジ ー ミ ズ »
// se lirait comme un désaccord de graphie alors que c'est un défaut d'écriture.
// Les deux se traitent, mais pas de la même façon — l'un s'arbitre, l'autre se répare.
const divergents = surs.filter(
	(p) => p.valeurActuelle && normaliserJa(p.valeurActuelle) !== normaliserJa(p.japonais ?? "")
);
const defectueux = props.filter((p) => p.defautEcriture);

console.log(`\n${props.length} techniques examinées`);
console.log(
	`  sûres ......... ${surs.length}  (dont ${nouveaux.length} à renseigner, ${divergents.length} en désaccord avec la base)`
);
console.log(`  à vérifier .... ${aVerifier.length}`);
console.log(`  rejetées ...... ${rejetes.length}`);
if (defectueux.length > 0) {
	console.log(
		`  ⚠ ${defectueux.length} valeur(s) déjà en base écrites « un signe, une espace » : ` +
			defectueux.map((p) => `#${p.id} ${p.valeurActuelle}`).join(", ")
	);
}
for (const portee of ["manga", "ouvrage", "periodique"] as const) {
	const n = surs.filter((p) => p.portee === portee).length;
	const quoi = {
		manga: "corroborées par l'index de techniques d'un databook (chapitre du manga)",
		ouvrage: "attestées dans un ouvrage de référence",
		periodique: "attestées seulement dans un périodique ou un guide de jeu",
	}[portee];
	console.log(`    ${String(n).padStart(4)} ${quoi}`);
}

// Les plus attestées d'abord : ce sont les techniques du manga, et c'est là que
// `--limite` doit couper si l'on ne veut relire qu'un échantillon.
const montrer = (TOUT ? props : [...nouveaux, ...divergents, ...aVerifier]).toSorted(
	(a, b) => b.attestations - a.attestations
);
console.log(`\n— propositions —`);
for (const p of LIMITE ? montrer.slice(0, LIMITE) : montrer) {
	const marque = p.niveau === "sur" ? "✓" : p.niveau === "a_verifier" ? "?" : "×";
	const actuel = p.valeurActuelle ? ` (base : ${p.valeurActuelle})` : "";
	console.log(
		`${marque} ${String(p.attestations).padStart(4)}×  ${(p.japonais ?? "—").padEnd(16)} → « ${p.nom} »${actuel}`
	);
	if (p.source)
		console.log(
			`        [${p.portee}] ${p.source.ouvrage} p.${p.source.planche} · …${p.source.extrait}…`
		);
	if (p.debutManga)
		console.log(`        index databook : ${p.debutManga}${p.usagers ? ` · ${p.usagers}` : ""}`);
	if (p.niveau !== "sur") console.log(`        ${p.motif}`);
}

if (SORTIE) {
	await Bun.write(
		SORTIE,
		JSON.stringify({ genere: new Date().toISOString(), propositions: props }, null, 2)
	);
	console.log(`\n→ ${SORTIE}`);
}
console.log(
	"\nSimulation : rien n'a été écrit. L'écriture passe par la relecture humaine\n" +
		"puis /api/wiki-admin (versionné dans public.wiki_revisions)."
);

await sql.end();
