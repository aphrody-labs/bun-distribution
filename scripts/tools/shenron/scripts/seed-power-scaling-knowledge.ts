import { Database } from "bun:sqlite";

const dbPath =
	process.env.KNOWLEDGE_DB_PATH ||
	(process.platform === "win32"
		? "C:/Users/aphro/.aphrody/workspace/knowledge.db"
		: "/home/ubuntu/.aphrody/workspace/knowledge.db");
const db = new Database(dbPath);

const docs = [
	{
		filename: "power-scaling-sentoryoku-scouter-daizenshuu7.md",
		category: "power-scaling",
		title: "Niveaux de combat officiels (Sentōryoku, Scouters & Daizenshuu 7)",
		source_file: "Daizenshuu 7 : Dictionnaire de Dragon Ball (1996)",
		content: `# Niveaux de combat officiels (Sentōryoku, Scouters & Daizenshuu 7)

## Doctrine et Sources Canoniques
Dans l'univers créé par Akira Toriyama, les mesures numériques de puissance (BP ou *Sentōryoku*) ne sont valides que lorsqu'elles proviennent directement du manga original (via les détecteurs / scouters de l'armée de Freeza) ou du recueil officiel **Daizenshuu 7 : Dictionnaire de Dragon Ball** (p. 82-83) supervisé par Bird Studio.

## Relevés Officiels Canoniques
- **Fermier au fusil** : 5 (Manga Ch. 195)
- **Tortue Géniale (au repos)** : 139 (Manga Ch. 209)
- **Son Goku (vêtements lourds)** : 334 / Débarrassé : 416 (Manga Ch. 199)
- **Son Goku (Kamehameha max)** : 924 (Manga Ch. 201)
- **Piccolo (vêtements lourds)** : 322 / Makankosappo : 1 440 (Manga Ch. 201)
- **Son Gohan (colère contre Raditz)** : 1 307 (Manga Ch. 203)
- **Raditz** : 1 500 (Daizenshuu 7 / 1 200 Manga)
- **Saibaiman** : 1 200 (Manga Ch. 214)
- **Krilin (Saga Saiyans)** : 1 770 (Daizenshuu 7)
- **Yamcha (Saga Saiyans)** : 1 480 (Daizenshuu 7)
- **Tenshinhan (Saga Saiyans)** : 1 830 (Daizenshuu 7)
- **Chaozu (Saga Saiyans)** : 610 (Daizenshuu 7)
- **Piccolo (Saga Saiyans)** : 3 500 (Daizenshuu 7)
- **Nappa** : 4 000 (Daizenshuu 7)
- **Son Goku (retour Kaio)** : Plus de 8 000 (Manga Ch. 224)
- **Son Goku (Kaio-ken x3)** : 24 000 (Manga Ch. 229 / Daizenshuu 7)
- **Son Goku (Kaio-ken x4 Kamehameha)** : 32 000 (Manga Ch. 231 / Daizenshuu 7)
- **Vegeta (sur Terre)** : 18 000 (Manga Ch. 228 / Daizenshuu 7)
- **Vegeta (Oozaru x10)** : 180 000 (Daizenshuu 7)
- **Kiwi** : 18 000 (Manga Ch. 249)
- **Dodoria** : 22 000 (Daizenshuu 7)
- **Zarbon (Forme 1)** : 23 000 (Daizenshuu 7)
- **Vegeta (Zenkai Zarbon 2)** : 30 000 (Manga Ch. 265)
- **Nail** : 42 000 (Manga Ch. 286)
- **Son Goku (Arrivée Namek)** : 90 000 (Manga Ch. 279 / Daizenshuu 7)
- **Capitaine Ginyu** : 120 000 (Manga Ch. 284)
- **Son Goku (Kaio-ken vs Ginyu)** : 180 000 (Manga Ch. 284)
- **Freeza (Première Forme)** : 530 000 (Manga Ch. 286)
- **Freeza (Deuxième Forme)** : Plus d'un million (Manga Ch. 296)
- **Piccolo (fusion Nail)** : 1 200 000 (Daizenshuu 7)
- **Vegeta (Zenkai Final)** : 2 500 000 (Daizenshuu 7)
- **Son Goku (Base sortant du caisson)** : 3 000 000 (Daizenshuu 7)
- **Son Goku (Kaio-ken x10)** : 30 000 000 (Daizenshuu 7)
- **Son Goku (Kaio-ken x20 Kamehameha)** : 60 000 000 (Daizenshuu 7)
- **Freeza (Forme Finale 50%)** : 60 000 000 (Daizenshuu 7)
- **Freeza (Forme Finale 100%)** : 120 000 000 (Daizenshuu 7)
- **Son Goku (Super Saiyan SSJ1)** : 150 000 000 (Daizenshuu 7 p. 83)

## Règle de Clôture d'Akira Toriyama
Après le duel Goku SSJ1 (150M) vs Freeza 100% (120M), Akira Toriyama cesse délibérément de donner des chiffres de puissance. L'auteur a expliqué que les scouters servaient initialement à introduire le concept que les Terriens savent masquer et faire varier leur ki pour surprendre l'ennemi. Une fois ce ressort narratif épuisé, l'inflation numérique ne faisait que nuire à la dramaturgie des affrontements. Tout chiffre de fans pour l'arc Cyborgs/Cell ou Buu est APOCRYPHE et NON-CANON.`,
	},
	{
		filename: "power-scaling-multiplicateurs-super-saiyan-seg.md",
		category: "power-scaling",
		title: "Multiplicateurs officiels des transformations Saiyans (SEG & Daizenshuu 7)",
		source_file: "Super Exciting Guide : Story Volume (2009) & Daizenshuu 7",
		content: `# Multiplicateurs officiels des transformations Saiyans (SEG & Daizenshuu 7)

## Les Formes Saiyans et leurs Multiplicateurs Canoniques

### 1. Oozaru (Grand Singe) — Facteur x10
- **Source** : Manga Dragon Ball Chapitre 233, Daizenshuu 7.
- **Règle** : Lorsqu'un Saiyan possédant sa queue absorbe plus de 17 millions de zénos d'ondes Blutz (pleine lune ou boule de puissance créée avec de l'oxygène), sa force brute est multipliée par 10. Vegeta passe ainsi de 18 000 à 180 000 BP.

### 2. Kaio-ken — Facteur x2 à x20
- **Source** : Manga DB Chapitres 229 à 315.
- **Règle** : Technique inventée par Maître Kaio. Multiplie la force physique, la vitesse et le ki d'un coefficient précis choisi par l'utilisateur (x2, x3, x4, x10, x20). Au-delà de ce que le corps peut endurer, les fibres musculaires se déchirent.

### 3. Super Saiyan (SSJ1) — Facteur x50
- **Source** : Daizenshuu 7 (p. 83), Super Exciting Guide (2009).
- **Règle** : Éveil provoqué par une immense colère chez un Saiyan au cœur pur possédant suffisamment de Cellules S (S-Cells). Multiplie la force de base par 50 (Goku 3 000 000 → 150 000 000 BP).
- **Note d'Akira Toriyama** : L'auteur pensait initialement à un facteur x10 en dessinant la transformation, mais les guides officiels ont retenu le facteur x50 pour rester logique par rapport au Kaio-ken x20 utilisé juste avant.

### 4. Super Saiyan 2 (SSJ2) — Facteur x100 (2x SSJ1)
- **Source** : Super Exciting Guide : Story Volume (2009).
- **Règle** : Dépassement du Super Saiyan initié par Son Gohan contre Cell. Le SEG formalise son coefficient à 2 fois la puissance du SSJ1, soit 100 fois la forme de base.

### 5. Super Saiyan 3 (SSJ3) — Facteur x400 (4x SSJ2)
- **Source** : Super Exciting Guide : Story Volume (2009).
- **Règle** : Extirpation de chaque parcelle d'énergie cachée du corps Saiyan. Le SEG formalise son coefficient à 4 fois la puissance du Super Saiyan 2, soit 400 fois la forme de base. Cette forme consomme l'énergie vitale à un rythme insoutenable pour un corps vivant.

## Fusions : Métamol vs Potara
- **Fusion Métamol (Danse)** : Addition des forces parfaitement égalisées, suivie d'une multiplication/amplification d'une ampleur titanesque (Gogeta / Gotenks).
- **Fusion Potara (Boucles divines)** : Supérieure à la danse car aucune restriction d'alignement de taille ou de puissance n'est requise, bénéficie d'un bonus de rivalité (Goku x Vegeta), et le Super Exciting Guide formalise son résultat comme une multiplication synergique des puissances des deux combattants.`,
	},
	{
		filename: "power-scaling-unite-kiri-babidi-buu.md",
		category: "power-scaling",
		title: "L'Unité Kiri de Babidi et conversion en Sentōryoku",
		source_file: "Manga Dragon Ball Tome 38 & V-Jump (1994)",
		content: `# L'Unité Kiri de Babidi et conversion en Sentōryoku

## Mesure de Puissance dans l'Arc Majin Buu
Dans l'arc Majin Buu (Tome 38, chapitres 450 à 452), le sorcier Babidi utilise un capteur magique pour mesurer l'énergie de combat, exprimée en **Kiri** (キリ).

## Données Canoniques du Manga
- **Yakon** : 800 Kiri. Ce monstre du Royaume des Démons absorbe la lumière et s'avère capable de rivaliser avec Son Goku en Super Saiyan ordinaire.
- **Son Goku (Super Saiyan 2)** : 3 000 Kiri. Goku passe en SSJ2 face à Yakon pour saturer la capacité d'absorption du monstre et le faire exploser.
- **Seuil de destruction planétaire** : 200 à 300 Kiri. Babidi précise qu'une telle valeur suffit pour réduire une planète standard à néant.

## Taux de Conversion avec le Battle Power (BP)
D'après les analyses éditoriales du magazine **V-Jump** de décembre 1994 :
- 1 Kiri équivaut approximativement à **50 000 unités scouter (BP)**.
- Yakon (800 Kiri) équivaut ainsi à environ 40 000 000 BP.
- Goku SSJ2 (3 000 Kiri) équivaut à au moins 150 000 000 à 300 000 000 BP selon l'estimation de départ.
L'échelle en Kiri a permis à Akira Toriyama de redéfinir la puissance sans avoir recours aux centaines de millions ou aux milliards, réinstallant des repères clairs pour l'arc final.`,
	},
];

const now = new Date().toISOString();

const insertDoc = db.prepare(`
	INSERT INTO documents (filename, category, title, source_file, imported_at, content)
	VALUES (?, ?, ?, ?, ?, ?)
	ON CONFLICT(filename) DO UPDATE SET
		category = excluded.category,
		title = excluded.title,
		source_file = excluded.source_file,
		imported_at = excluded.imported_at,
		content = excluded.content
`);

const deleteFts = db.prepare(`DELETE FROM documents_fts WHERE filename = ?`);
const insertFts = db.prepare(`
	INSERT INTO documents_fts (rowid, filename, category, title, content)
	VALUES (?, ?, ?, ?, ?)
`);
const getDocId = db.prepare(`SELECT id FROM documents WHERE filename = ?`);

for (const d of docs) {
	insertDoc.run(d.filename, d.category, d.title, d.source_file, now, d.content);
	const row = getDocId.get(d.filename) as { id: number };
	deleteFts.run(d.filename);
	insertFts.run(row.id, d.filename, d.category, d.title, d.content);
	console.log(`✓ Inséré dans knowledge.db : ${d.filename} (${d.title})`);
}

console.log(`\nRecherche FTS5 test :`);
const testFts = db.query(`SELECT title, category FROM documents_fts WHERE documents_fts MATCH 'Sentōryoku OR Kiri OR "Super Saiyan 2"' LIMIT 5`).all();
console.log(testFts);
