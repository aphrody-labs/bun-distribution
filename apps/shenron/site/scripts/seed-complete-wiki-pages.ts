import postgres from "postgres";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");
const sql = postgres(connectionString);

interface CategoryDef {
	id: string;
	slug: string;
	name: string;
	order: number;
}

interface PageDef {
	id: string;
	categoryId: string;
	title: string;
	slug: string;
	order: number;
	body: string;
}

const CATEGORIES: CategoryDef[] = [
	{
		id: "cat_cosmologie",
		slug: "cosmologie-et-macrocosme",
		name: "Cosmologie & Macrocosme",
		order: 1,
	},
	{
		id: "cat_chronologie",
		slug: "chronologie-et-histoire",
		name: "Chronologie & Histoire Galactique",
		order: 2,
	},
	{
		id: "cat_lore_peuples",
		slug: "peuples-et-civilisations",
		name: "Peuples & Civilisations",
		order: 3,
	},
	{
		id: "cat_arts_martiaux",
		slug: "ki-et-arts-martiaux",
		name: "Ki & Arts Martiaux",
		order: 4,
	},
	{
		id: "cat_transformations_lore",
		slug: "lore-des-transformations",
		name: "Généalogie des Formes & Transformations",
		order: 5,
	},
	{
		id: "cat_databooks_guides",
		slug: "guides-et-databooks",
		name: "Guides & Databooks Officiels",
		order: 6,
	},
	{
		id: "cat_toriyama_archive",
		slug: "archives-akira-toriyama",
		name: "Archives Akira Toriyama",
		order: 7,
	},
];

const PAGES: PageDef[] = [
	{
		id: "page_structure_macrocosme",
		categoryId: "cat_cosmologie",
		title: "Structure du Macrocosme (Uchū) — L'Univers Sphérique de Dragon Ball",
		slug: "structure-du-macrocosme-uchu",
		order: 1,
		body: `# Structure du Macrocosme (Uchū)

D'après le **Daizenshuu 4 : World Guide** et le **Daizenshuu 7 : Daijiten**, le monde habité dans Dragon Ball ne correspond pas à un univers infini standard, mais à une sphère dimensionnelle close et gigantesque nommée le **Macrocosme** (*Uchū*), entourée d'un vide dimensionnel.

## Organisation Géographique et Spirituelle

Le macrocosme est rigoureusement structuré en strates hiérarchiques :

1. **Le Royaume des Kaiōshin (*Kaiōshin-kai*) :**
   - Situé en orbite extérieure autour de la sphère macrocosmique.
   - C'est un royaume divin sacré, inaccessible par les moyens physiques conventionnels (seul le déplacement instantané ou les portails magiques divins permettent de s'y rendre).
   - Abrite la [Planète Sacrée](/wiki/cosmologie/planete-sacree) des Dieux de la Création.

2. **L'Au-delà (*Ano-yo*, Hémisphère Supérieur) :**
   - Plan spirituel transcendantal où transitent et résident les âmes.
   - **Le Palais d'Enma-daïō (*Enma-daïō no Yakata*) :** Le centre judiciaire où chaque âme défunte est jugée d'après le registre karmique.
   - **Le Chemin du Serpent (*Hebi no Michi*) :** Voie de 1 million de kilomètres reliant le palais d'Enma à la [Planète Kaio](/wiki/cosmologie/planete-kaio) du Nord.
   - **Le Paradis (*Gokuraku*) :** Monde gigantesque où reposent les âmes pures et méritantes.

3. **Le Monde des Vivants (*Kono-yo*, Hémisphère Inférieur) :**
   - Espace matériel comprenant la [Terre](/wiki/cosmologie/terre), [Namek](/wiki/cosmologie/namek), [Planète Vegeta](/wiki/cosmologie/planete-vegeta) et des milliards d'astres.
   - Divisé administrativement en quatre galaxies cardinales (Nord, Sud, Est, Ouest), chacune surveillée par un Kaïō.

4. **Les Enfers (*Jigoku*) :**
   - Situés au tréfonds de la sphère macrocosmique, sous le monde matériel.
   - Lieu de châtiment et de purification spirituelle pour les âmes chargées de crimes.

5. **Le Royaume des Démons (*Makai*) :**
   - Domaine dimensionnel scellé, foyer originel de la magie noire et des Démons comme Dabra.
`,
	},
	{
		id: "page_hierarchie_divine",
		categoryId: "cat_cosmologie",
		title: "La Hiérarchie Divine : Kaïō, Kaïōshin, Hakaïshin et Anges",
		slug: "hierarchie-divine-kaioshin-hakaishin-anges",
		order: 2,
		body: `# La Hiérarchie Divine dans l'Univers Dragon Ball

L'équilibre du monde repose sur un dualisme sacré entre la Création et la Destruction, chapeauté par une autorité omnipotente.

## Les Ordres Divins

### 1. Les Dieux de la Création (*Kaiōshin*)
Les Kaiōshin sont issus des fruits de l'Arbre Sacré du Monde Divin (*Kaijū*). Ils veillent sur la germination des planètes et l'éclosion des civilisations.
- **Grand Kaïōshin (*Dai Kaiōshin*) :** Guide suprême des créateurs.
- **Kaïōshin Cardinaux :** Est, Ouest, Nord et Sud.
- Leur existence est liée par un pacte de vie vitale (*Soul-link*) au Dieu de la Destruction de leur univers respectif.

### 2. Les Dieux de la Destruction (*Hakaïshin*)
Incarnés notamment par [Beerus](/wiki/personnages/beerus) pour l'Univers 7 et [Champa](/wiki/personnages/champa) pour l'Univers 6.
- Mission : Éliminer les menaces, les planètes stagnantes ou malveillantes afin de permettre le renouvellement cosmique.
- Utilisent l'énergie divine du *Hakaï* (Destruction absolue).

### 3. Les Anges (*Tenshi*)
Êtres célestes immortels au service du Grand Prêtre et de Zeno.
- [Whis](/wiki/personnages/whis), [Vados](/wiki/personnages/vados), [Marcarita](/wiki/personnages/marcarita-angel).
- Servent de maîtres d'arts martiaux et d'assistants impartiaux aux Hakaïshin. Maîtres parfaits du Réflexe Transcendantal (*Ultra Instinct*).

### 4. Le Grand Prêtre (*Daishinkan*) et Zeno (*Zen'ō*)
- **Zeno :** Roi Absolu des 12 Univers, capable d'effacer des réalités entières en un instant.
- **Le Grand Prêtre :** Père des anges et administrateur omniscient de l'ensemble du multivers.
`,
	},
	{
		id: "page_chronologie_canonique",
		categoryId: "cat_chronologie",
		title: "Chronologie Canonique — De l'Ère Cosmique à l'An 784",
		slug: "chronologie-canonique-ere-cosmique-an-784",
		order: 1,
		body: `# Chronologie Canonique de Dragon Ball

La chronologie officielle de Dragon Ball est établie d'après la datation standard de la Terre (l'Année Cosmique), consolidée dans les **Daizenshuu 7** et le **Chōzenshū**.

## Grandes Époques de l'Histoire

### L'Ère Antique (Avant l'An 0)
- **- 75 000 000 :** Le [Vieux Kaiōshin](/wiki/personnages/vieux-kaioshin) est scellé dans la Z-Sword par Beerus suite à un différend.
- **- 5 000 000 :** Le sorcier Bibidi réveille Majin Buu. Massacre des Kaïōshin du Nord et de l'Ouest, absorption du Kaïōshin du Sud et du Grand Kaïōshin, donnant naissance à [Majin Buu](/wiki/personnages/majin-buu).
- **- 238 :** Apparition du Super Saiyan légendaire originel (Yamoshi), qui détruit une partie de la galaxie avant de succomber.

### L'Ère Saiyan et l'Avènement de Freezer
- **An 737 :** 
  - Naissance de Kakarot ([Son Goku](/wiki/personnages/son-goku)) et de [Broly](/wiki/personnages/broly).
  - Rébellion de [Baddack](/wiki/personnages/baddack).
  - Destruction de la [Planète Vegeta](/wiki/cosmologie/planete-vegeta) par [Freezer](/wiki/personnages/freezer).
  - Envoi de la capsule de Goku vers la Terre.

### L'Épopée Terrestre et les Quêtes des Dragon Balls
- **An 749 :** Rencontre historique entre [Bulma](/wiki/personnages/bulma) et Son Goku dans les montagnes de Paozu. Début de la première quête des 7 Dragon Balls.
- **An 750 :** 21e Tournoi d'Arts Martiaux (*Tenkaichi Budōkai*). Victoire de Jackie Chun ([Tortue Géniale](/wiki/personnages/tortue-geniale)). Destruction de l'Armée du Ruban Rouge par Goku.
- **An 753 :** 22e Tournoi d'Arts Martiaux. Apparition de Piccolo Daimaō. Goku élimine le démon ; naissance de Piccolo Jr ([Piccolo](/wiki/personnages/piccolo)).

### L'Ère Z : Saiyans, Namek, Cyborgs et Buu
- **An 761 :** Arrivée de [Raditz](/wiki/personnages/raditz) sur Terre. Mort de Goku et Raditz. Entraînement de Goku chez Kaïō.
- **An 762 :** Bataille contre [Vegeta](/wiki/personnages/vegeta) et [Nappa](/wiki/personnages/nappa). Départ pour Namek. Défaite du commando Ginyū et avènement du [Super Saiyan](/wiki/transformations/super-saiyan) face à Freezer.
- **An 764 :** Retour de Freezer Mecha et du Roi Cold. Arrivée de [Trunks](/wiki/personnages/trunks) du futur.
- **An 767 :** Les Cyborgs ([C-16](/wiki/personnages/c-16), [C-17](/wiki/personnages/c-17), [C-18](/wiki/personnages/c-18)) et l'éveil de [Cell](/wiki/personnages/cell). Cell Games : sacrifice de Goku, éveil du [Super Saiyan 2](/wiki/transformations/super-saiyan-2) chez [Son Gohan](/wiki/personnages/son-gohan).
- **An 774 :** Réveil de Majin Buu. Fusion ([Vegetto](/wiki/personnages/vegetto), [Gotenks](/wiki/personnages/gotenks)), [Super Saiyan 3](/wiki/transformations/super-saiyan-3), et Genkidama final sur le Kaiōshin-kai.
- **An 784 :** 28e Tenkaichi Budōkai. Rencontre avec Uub et départ de Goku pour l'entraîner.
`,
	},
	{
		id: "page_histoire_saiyans",
		categoryId: "cat_lore_peuples",
		title: "Histoire et Physiologie des Saiyans — Du Sadala originel à la destruction de Vegeta",
		slug: "histoire-et-physiologie-des-saiyans",
		order: 1,
		body: `# Histoire et Physiologie des Saiyans

Les Saiyans (*Saiya-jin*) sont une race guerrière au cœur de la mythologie de Dragon Ball.

## 1. Origines et Migration
- Originaires de la Planète Sadala (détruite par des luttes intestines dans l'Univers 7, mais toujours florissante dans l'Univers 6).
- Réfugiés sur la Planète Plant (habitée par les Tsufurs technologiquement avancés).
- Menés par le [Roi Vegeta](/wiki/personnages/roi-vegeta), les Saiyans massacrent les Tsufurs lors d'une nuit de pleine lune grâce à la transformation en Oozaru, rebaptisant la planète « Planète Vegeta ».

## 2. Caractéristiques Biologiques
- **La Queue de Singe :** Catalyseur des ondes Bruits (*Blutz Waves*) réfléchies par la pleine lune (17 millions de zenos). Permet la métamorphose en singe géant (multipliant la puissance par 10).
- **Le Zenkai (*Zenkai Power*) :** Capacité génétique exceptionnelle permettant au Saiyan de voir sa puissance augmenter de manière exponentielle après avoir frôlé la mort et guéri.
- **Longévité Combative :** Les Saiyans conservent une jeunesse prolongée jusqu'à environ 80 ans afin de rester de redoutables guerriers jusqu'au crépuscule de leur vie.
- **Les Cellules S (*S-Cells*) :** Découvertes dans les interviews d'Akira Toriyama (*Saikyō Jump 2018*), ces cellules déterminent la prédisposition génétique au Super Saiyan. Elles se développent par un esprit doux et un entraînement intensif.
`,
	},
	{
		id: "page_mecanique_du_ki",
		categoryId: "cat_arts_martiaux",
		title: "La Mécanique du Ki : Genki, Yūki et Shōki dans les Arts Martiaux",
		slug: "mecanique-du-ki-genki-yuki-shoki",
		order: 1,
		body: `# La Mécanique du Ki (*Kikō*)

Dans la doctrine d'Akira Toriyama explicitée dans le **Super Exciting Guide**, le *Ki* (氣) ne se résume pas à de l'énergie physique brute. Il est la somme de trois composantes fondamentales :

## Les Trois Piliers du Ki

1. **Le Genki (元気 - L'Énergie Vitale) :**
   - L'énergie de la vie et du corps. C'est elle que puise Son Goku pour façonner le *Genkidama*.
   - Présente chez tous les êtres vivants, les plantes, la terre et le soleil.

2. **Le Yūki (勇気 - Le Courage) :**
   - La détermination mentale et l'audace au combat. Un guerrier terrifié voit son Ki chuter dramatiquement car son Yūki s'effondre.

3. **Le Shōki (正気 - La Clarté d'Esprit) :**
   - La conscience pure, la concentration et le contrôle des émotions. Permet la maîtrise des flux d'énergie sans dispersion néfaste.

## Applications Martiales Supérieures
- **La Maîtrise du Ki Divin (*God Ki*) :** Contrairement au Ki ordinaire qui fuit naturellement du corps sous forme d'aura explosive, le Ki divin est scellé et comprimé à l'intérieur du corps sans aucune déperdition.
- **L'Ultra Instinct (*Migatte no Goku'i*) :** État ultime enseigné par les Anges où le corps réagit indépendamment des signaux du cerveau, abolissant le temps de latence de la pensée.
`,
	},
	{
		id: "page_guide_databooks_reference",
		categoryId: "cat_databooks_guides",
		title: "Guide Exhaustif des Databooks Officiels : Daizenshuu, Chōzenshū et SEG",
		slug: "guide-exhaustif-databooks-daizenshuu-chozenshu",
		order: 1,
		body: `# Les Databooks de Référence de Dragon Ball

Pour analyser le canon et le lore officiel, plusieurs séries de guides d'archives ont été publiées par Shūeisha sous la supervision directe d'Akira Toriyama.

## 1. Les Daizenshuu (1995-1996) — Les 7 Tomes Cardinaux
- **Vol. 1 : Complete Illustrations** (Artworks officiels de la prépublication).
- **Vol. 2 : Story Guide** (Découpage des sagas et chronologie canonique).
- **Vol. 3 : TV Animation Part 1** (Adaptation animée, fiches fillers et épisodes).
- **Vol. 4 : World Guide** (La bible absolue de la géographie du Macrocosme, de la technologie Capsule Corp et des artefacts).
- **Vol. 5 : TV Animation Part 2** (Films et téléfilms).
- **Vol. 6 : Movies & TV Specials** (Visuels d'animation et conception des OAV).
- **Vol. 7 : Dragon Ball Encyclopedia (Daijiten)** (Le grand dictionnaire : plus de 800 personnages, techniques, objets et lexique historique).

## 2. Super Exciting Guide (2009)
- **Character Volume & Story Volume** : Contient les interviews fondamentales de Toriyama sur l'origine du Super Saiyan, la formule des puissances et le fonctionnement des cellules S.

## 3. Chōzenshū (2013)
- Version remastérisée et mise à jour en 4 volumes des Daizenshuu intégrant les éléments modernes de l'histoire.
`,
	},
];

async function main() {
	console.log("=== INGESTION COMPLETE DU WIKI DRAGON BALL ===");

	// 1. Insertion des catégories
	for (const cat of CATEGORIES) {
		await sql`
			INSERT INTO "WikiCategory" (id, slug, name, "order")
			VALUES (${cat.id}, ${cat.slug}, ${cat.name}, ${cat.order})
			ON CONFLICT (id) DO UPDATE
			SET slug = EXCLUDED.slug, name = EXCLUDED.name, "order" = EXCLUDED."order"
		`;
		console.log(`[CAT] ${cat.name} (${cat.slug}) upserted`);
	}

	// 2. Insertion des pages wiki
	for (const p of PAGES) {
		await sql`
			INSERT INTO "WikiPage" (id, "categoryId", title, slug, body, "order", "updatedAt")
			VALUES (${p.id}, ${p.categoryId}, ${p.title}, ${p.slug}, ${p.body}, ${p.order}, NOW())
			ON CONFLICT (slug) DO UPDATE
			SET "categoryId" = EXCLUDED."categoryId",
			    title = EXCLUDED.title,
			    body = EXCLUDED.body,
			    "order" = EXCLUDED."order",
			    "updatedAt" = NOW()
		`;
		console.log(`[PAGE] ${p.title} (${p.slug}) upserted`);
	}

	const [count] = await sql`SELECT count(*)::int AS total FROM "WikiPage"`;
	console.log(`=== SUCCES : Total de ${count.total} pages wiki encyclopédiques désormais actives en base ===`);
	await sql.end();
}

main().catch((err) => {
	console.error("Erreur ingestion wiki:", err);
	process.exit(1);
});
