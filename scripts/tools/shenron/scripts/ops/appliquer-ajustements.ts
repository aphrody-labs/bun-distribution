// SPDX-License-Identifier: Apache-2.0
/**
 * Ajustements ponctuels de traductions (livre 2 p.62, livre 23 p.112-113).
 *
 * Corrigé le 2026-09-14 : les tables de jetons étaient prises dans
 * `lot-pure-ja-20.json` PAR POSITION (`[17]`, `[18]`) — si le lot avait été
 * régénéré, la table d'une autre planche démasquait ces textes, et les noms
 * réinjectés appartenaient à une autre page. Les tables sont maintenant
 * retrouvées par (databookId, pageNumber), et leur `texteJa` doit être celui
 * de la planche en base. L'écriture passe par `deposerTraduction` (juge unique,
 * écriture atomique par planche) et exige `--appliquer`.
 *
 *   bun scripts/ops/appliquer-ajustements.ts             # simulation
 *   bun scripts/ops/appliquer-ajustements.ts --appliquer
 */
import {
	arretSiGel,
	connecte,
	deposerTraduction,
	jugerTraduction,
	texteDePlanche,
	traductionDePlanche,
	type PlancheBrute,
} from "../../apps/site/scripts/_databooks-base";
import { demasquerVocabulaireStrict } from "../../apps/site/src/lib/ja/lexique-canonique";

// Gel des écrivains : sortie 3 avant toute connexion si .coord/FREEZE-databooks.json existe.
arretSiGel("appliquer-ajustements");

type TokenMap = Map<string, { ja: string; fr: string; kind: string }>;

const APPLIQUER = process.argv.includes("--appliquer");
const SIGNATURE = "traducteur-officiel-shenron";

// Book 2 p.62 (Saga Freezer summary)
const b2_62_masked = `# Chronologie de la Zeta001

Tableau synoptique des confrontations sur la planète Namek :
- Krilin voit son potentiel libéré et protège la Dragon Ball.
- Vegeta récupère ses forces et son endurance dans la cuve médicale.
- Confrontation fatidique : Vegeta localise et affronte Zeta002.
- Combat sans merci : Vegeta élimine définitivement Zeta002 sous sa forme métamorphosée.
- Rencontre fortuite entre Son Gohan et Vegeta dissimulant les sphères.
- Arrivée providentielle de Goku à bord de sa capsule spatiale pour secourir ses amis en détresse.`;

const b2_62_map: TokenMap = new Map([
	["Zeta001", { ja: "フリーザ編", fr: "Saga Freezer", kind: "saga" }],
	["Zeta002", { ja: "ザーボン", fr: "Zabon", kind: "personnage" }],
]);

// Book 23 p.112 (Dictionnaire des Personnages: So à Te)
const b23_112_masked = `# Dictionnaire des Personnages (Section So à Te)

## Section So
- **Zeta055** : Le second fils de Goku. Meilleur ami inséparable de Zeta011, il ressemble trait pour trait à son père enfant. En grandissant, il adopte une coupe de cheveux courts. (Voix : Masako Nozawa)
- **Zeta056** : Le fils aîné de Goku. Doté d'un potentiel latent colossal dès son plus jeune âge, il a été initié aux arts martiaux par Zeta027 avant de terrasser Zeta060. (Voix : Masako Nozawa)
- **Grand-père Son Gohan** : Le père adoptif ayant recueilli et élevé Goku. Premier disciple émérite de Zeta050. Après sa mort, il a guidé les âmes vers Zeta036. (Voix : Osamu Saka)

## Section Ta
- **Zeta039** : L'un des quatre généraux démoniaques aux ordres de Garlic Jr. Il surgit du sol et combat en duo avec Zeta038. (Voix : Masaharu Satō)
- **Zeta018** : Le souverain du Zeta070 des ténèbres. Tombé sous l'emprise maléfique du sorcier Zeta024, il possède une force comparable à Zeta060. (Voix : Ryūzaburō Ōtomo)
- **Zeta053** : La divinité suprême régnant sur les quatre Zeta066 des points cardinaux. D'un tempérament désinvolte et amateur de tenues branchées, il a organisé le tournoi d'arts martiaux de Zeta036. (Voix : Yūji Machi)
- **Zeta033** : La vénérable divinité suprême absorbée autrefois par Zeta035. Sa bonté naturelle a permis d'adoucir le tempérament du monstre. (Voix : Masato Tsujimura)

## Section Chi & Te
- **Zeta057** : Le redoutable tueur à gages ayant affronté Goku par le passé. Reconstruit sous forme de cyborg, il est devenu le garde du corps de Zeta023. (Voix : Yukimasa Kishino)
- **Zeta061** : Fille du roi Gyumao et épouse de Goku. Mère dévouée et intraitable sur l'éducation de ses enfants. (Voix : Mayumi Shō / Naoko Watanabe)
- **Zeta067** : Combattant de l'école de la Grue expert en pouvoirs télékinésiques. Avec Zeta054, il s'est affranchi de l'enseignement corrompu de Zeta059. (Voix : Hiroko Emori)
- **Zeta001** : Le commentateur et arbitre officiel du Zeta008, professionnel irréprochable ayant officié de la 21e à la 28e édition. (Voix : Hirotaka Suzuoki)`;

// Book 23 p.113 (Dictionnaire des Personnages: Hi à Fu)
const b23_113_masked = `# Dictionnaire des Personnages (Section Hi à Fu)

## Section Hi & Bi
- **Zeta021** : Fille de Mr. Satan et épouse de Zeta054. Dotée d'un fort tempérament, ses talents martiaux surpassent largement ceux de son père. Elle a donné naissance à Zeta049. (Voix : Yūko Minaguchi)
- **Mère de Zeta021** : Défunte épouse de Satan. Sa fille Zeta021 ayant hérité de ses traits, tout porte à croire qu'elle était une femme d'une grande beauté.
- **Zeta035** : Divinité veillant sur le quart oriental du cosmos.

## Section Pi
- **Zeta022** : L'alter ego démoniaque séparé du Tout-Puissant de la Terre, qui a fini par fusionner à nouveau avec lui pour ne faire qu'un lors de l'invasion des cyborgs. (Voix : Toshio Furukawa)
- **Zeta025** : Disciple colosse de Mr. Satan se proclamant l'homme le plus fort du monde, facilement mis hors de combat au tournoi. (Voix : Hisao Egawa)
- **Zeta026** : Compagnon félin métamorphe de Zeta033, issu de la prestigieuse école de métamorphose du Sud. (Voix : Naoko Watanabe)

## Section Fu
- **Zeta013** : Soldat d'élite de Zeta027 envoyé avec Rasberry pour chercher les Dragon Ball sur Namek. (Voix : Masaharu Satō)
- **Zeta050** : Fille cadette de Zeta028 et Zeta039, petite sœur de Zeta011, dotée d'une personnalité vive et coquette. (Voix : Hiromi Tsuru)
- **Zeta027** : Le redoutable empereur de l'univers ayant asservi et conquis d'innombrables galaxies avant de chuter face à Goku. (Voix : Ryūsei Nakao)`;

const sql = await connecte();

/** La planche portant EXACTEMENT ce numéro (null si absente ou ambiguë). */
async function planche(databookId: number, numero: number): Promise<PlancheBrute | null> {
	const [livre] = await sql<{ pages: PlancheBrute[] | null }[]>`
		SELECT pages FROM bot.db_databooks WHERE id = ${databookId}`;
	const trouvees = (livre?.pages ?? []).filter((p) => Number(p.number) === numero);
	return trouvees.length === 1 ? trouvees[0]! : null;
}

/** Table de jetons du lot, retrouvée par identité de planche et non par position. */
async function tableDuLot(databookId: number, numero: number, texteJa: string): Promise<TokenMap | null> {
	const lot = (await Bun.file("data/databooks-translation/lot-pure-ja-20.json").json()) as Array<{
		databookId: number;
		pageNumber: number;
		texteJa?: string;
		tokenMap: Record<string, { ja: string; fr: string; kind: string }>;
	}>;
	const entree = lot.find((e) => Number(e.databookId) === databookId && Number(e.pageNumber) === numero);
	if (!entree) return null;
	if ((entree.texteJa ?? "").trim() !== texteJa.trim()) return null;
	return new Map(Object.entries(entree.tokenMap));
}

const ajustements: Array<{ databookId: number; numero: number; masque: string; table: () => Promise<TokenMap | null> }> = [
	{ databookId: 2, numero: 62, masque: b2_62_masked, table: async () => b2_62_map },
];
for (const [numero, masque] of [
	[112, b23_112_masked],
	[113, b23_113_masked],
] as const) {
	ajustements.push({
		databookId: 23,
		numero,
		masque,
		table: async () => {
			const p = await planche(23, numero);
			return p ? tableDuLot(23, numero, texteDePlanche(p)) : null;
		},
	});
}

console.log("Validation conformité :");
for (const a of ajustements) {
	const p = await planche(a.databookId, a.numero);
	if (!p) {
		console.log(`  Book ${a.databookId} p.${a.numero} : ✗ planche absente ou numéro ambigu`);
		continue;
	}
	const table = await a.table();
	if (!table) {
		console.log(`  Book ${a.databookId} p.${a.numero} : ✗ table de jetons introuvable pour CETTE planche`);
		continue;
	}
	const { texte, residuels } = demasquerVocabulaireStrict(a.masque, table);
	if (residuels.length) {
		console.log(`  Book ${a.databookId} p.${a.numero} : ✗ jetons non restaurés (${residuels.slice(0, 3).join(", ")})`);
		continue;
	}
	const travail = {
		databookId: a.databookId,
		numero: a.numero,
		image: p.image ?? null,
		source: texteDePlanche(p),
		traduction: texte,
	};
	const verdict = jugerTraduction(travail);
	if (!verdict.ok) {
		console.log(`  Book ${a.databookId} p.${a.numero} : ✗ ${verdict.motif}`);
		continue;
	}
	console.log(`  Book ${a.databookId} p.${a.numero} : ✓ Valide`);
	if (!APPLIQUER) continue;
	// Ajustement d'une traduction existante : la garde porte sur la valeur lue.
	const res = await deposerTraduction(sql, {
		...travail,
		par: SIGNATURE,
		traductionAttendue: traductionDePlanche(p),
	});
	console.log(`    -> ${res.statut}${res.motif ? ` (${res.motif})` : ""}`);
}

if (!APPLIQUER) console.log("\n(simulation — relancer avec --appliquer)");

await sql.end();
