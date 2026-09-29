#!/usr/bin/env bun
/**
 * enrich-wiki-transformations.ts — Enrichissement encyclopédique et canonique
 * des transformations dans bot.db_transformations (Daizenshuu 7 / Chōzenshū 4 / Akira Toriyama).
 */
import postgres from "postgres";

const sql = postgres(process.env.REMOTE_DATABASE_URL!, { max: 1 });

const ENRICHMENTS = [
	{
		id: 4,
		name: "Super Saiyan 4",
		ki: "Forme Primale Dépassée",
		article: `**Le Super Saiyan 4** (超サイヤ人4, *Chō Saiyajin Fō*) est la transformation ultime introduite dans la série animée *Dragon Ball GT*, conçue graphiquement par le character designer en chef **Katsuyoshi Nakatsuru** avec la validation et des esquisses d'Akira Toriyama.\n\n## Nature & Origine\n\nContrairement aux stades 1 à 3 qui reposent sur l'amplification du ki divin ou doré, le Super Saiyan 4 puise dans les racines animales primitives des Saiyans. Elle nécessite une queue de singe fonctionnelle, le passage par le stade de **Grand Singe Doré** (*Ōzaru Doré*), et la reprise totale du contrôle de la raison par la volonté face à la folie destructrice.\n\n## Caractéristiques Physiques\n\nLe guerrier retrouve une chevelure noire ou brune abondante, un torse recouvert d'une fourrure écarlate, des yeux cerclés de rouge et une aura enflammée bicolore. Cette forme permit à Son Gokū puis à Vegeta de tenir tête à Baby Vegeta, Super C-17 et aux Dragons Maléfiques.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/databooks/27#planche-108", kind: "databook", label: "Dragon Ball 30th Anniversary Super History Book" },
			{ n: 2, url: "/wiki/series/dragon-ball-gt", kind: "canon", label: "Dragon Ball GT — Épisodes 34-35" }
		])
	},
	{
		id: 5,
		name: "Super Saiyan God",
		ki: "Ki Divin (Transcendance)",
		article: `**Le Super Saiyan God** (超サイヤ人ゴッド, *Chō Saiyajin Goddo*, ou Super Saiyan Divin) est l'état légendaire de divinité saiyan introduit dans le film canonique *Dragon Ball Z: Battle of Gods* (2013), écrit par Akira Toriyama.\n\n## Le rituel des six Saiyans au cœur pur\n\nSelon les révélations du dragon Shenron, cet état d'illumination divine fut autrefois invoqué par une poignée de Saiyans justes sur la planète originelle Sadala pour éliminer les guerriers corrompus. Pour réveiller le Dieu, cinq Saiyans au cœur pur doivent insuffler leur esprit vertueux dans un sixième. Son Gokū y parvient grâce à l'aide de Vegeta, Gohan, Goten, Trunks et du fœtus de Pan porté par Videl.\n\n## Attributs du Ki Divin\n\nPhysiquement, la silhouette s'affine, les yeux s'agrandissent avec des pupilles rubis et la chevelure adopte une teinte magenta incandescente entourée d'une aura de flammes solaires ondulantes. Le ki émis est de nature divine (*Kami no Ki*), indétectable pour les mortels et conférant des réflexes prodigieux ainsi qu'une régénération passive des blessures face au Dieu de la Destruction Beerus.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/films/dragon-ball-z-battle-of-gods", kind: "canon", label: "Film Dragon Ball Z: Battle of Gods (2013)" },
			{ n: 2, url: "/wiki/databooks/50#planche-19", kind: "databook", label: "Battle of Gods Pamphlet Officiel" }
		])
	},
	{
		id: 6,
		name: "Super Saiyan Blue",
		ki: "Super Saiyan God Super Saiyan",
		article: `**Le Super Saiyan Blue** (超サイヤ人ブルー, *Chō Saiyajin Burū*), officiellement baptisé à ses débuts **Super Saiyan God Super Saiyan** (SSGSS), est l'évolution directe du Super Saiyan Divin combiné à l'état de Super Saiyan classique.\n\n## Genèse et Maîtrise\n\nIntroduit dans le film *La Résurrection de « F »* (2015) puis développé dans *Dragon Ball Super*, cet état est atteint par Son Gokū et Vegeta après un entraînement draconien auprès de l'ange **Whis** sur la planète de Beerus. Le principe fondamental repose sur le contrôle absolu du ki : au lieu de laisser l'énergie fuiter vers l'extérieur comme dans les formes dorées explosives, le combattant scelle l'intégralité de son flux divin à l'intérieur de son propre corps.\n\n## Puissance et Déclinaisons\n\nLa forme se manifeste par une chevelure et des sourcils bleu azur lumineux avec une aura double étincelante. Dans l'anime, Gokū réussit à y superposer le **Kaiōken** jusqu'au facteur x20, tandis que dans le manga de Toyotarō, Vegeta et Gokū développent le **Super Saiyan Blue Parfait** (*Kansei Super Saiyan Blue*), qui élimine l'épuisement d'énergie au prix d'une pression interne colossale.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/films/dragon-ball-z-resurrection-f", kind: "canon", label: "Film Dragon Ball Z: La Résurrection de « F » (2015)" },
			{ n: 2, url: "/wiki/manga/volume/151", kind: "manga_volume", label: "Dragon Ball Super — Tome 2, Chapitre 13" }
		])
	},
	{
		id: 7,
		name: "Super Saiyan Rosé",
		ki: "Ki Divin Démoniaque Purifié",
		article: `**Le Super Saiyan Rosé** (超サイヤ人 ロゼ, *Chō Saiyajin Rozé*) est la transposition divine exclusive du Super Saiyan Blue propre à **Goku Black** (l'apprenti Kaïô Shin Zamasu occupant le corps volé de Son Gokū).\n\n## Une signature divine unique\n\nLorsqu'un esprit divin authentique (celui d'une divinité de la création) assimile et maîtrise le potentiel physique d'un corps de Saiyan, la transcendance en Super Saiyan n'émet pas une lueur azur mais une flamme rose violacée éclatante bordée d'un halo pourpre sombre. Selon le mangaka Toyotarō et Akira Toriyama, cette nuance traduit la nature divine innée de Zamasu couplée à sa noirceur d'âme.\n\n## Capacités et Lames de Ki\n\nCette forme confère à Goku Black une montée en puissance continue à chaque blessure subie grâce aux cellules saiyans. Elle lui permet de matérialiser son ki sous forme d'armes blanches tranchantes létales : l'Épée de Ki (*Violent Fierce God Slicer*) et la faux géante fissurant le tissu spatio-temporel.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/152", kind: "manga_volume", label: "Dragon Ball Super — Tome 3, Chapitres 19-25" },
			{ n: 2, url: "/wiki/databooks/19#planche-116", kind: "databook", label: "Dragon Ball Chōzenshū 4" }
		])
	},
	{
		id: 8,
		name: "Fusion Potara",
		ki: "Multiplication Exponentielle + Boost de Rivalité",
		article: `**La Fusion Potara** (ポタラの合体, *Potara no Gattai*) est l'union sacrée des Kaïô Shin permettant la fusion instantanée et irréversible de deux êtres portant chacun l'une des boucles d'oreilles Potara sur une oreille opposée.\n\n## Révélations du Doyen Kaïô Shin\n\nIntroduite au tome 41 du manga canonique pour contrer Majin Boo ayant absorbé Gotenks et Gohan, cette méthode surpasse largement la danse Métamol. Selon les explications du Vieux Kaïô Shin, la fusion Potara ne requiert aucun ajustement de taille ou de puissance entre les partenaires, et leur alliance crée un être doté d'une puissance infiniment supérieure à la simple addition de leurs forces.\n\n## L'avènement de Vegetto\n\nLorsque Son Gokū et Vegeta unissent leurs corps pour créer **Vegetto**, l'effet multiplicateur est décuplé par leur statut d'éternels rivaux (le *Rivalry Boost*). Dans *Dragon Ball Super*, Gowasu précise que pour des mortels ne détenant pas le statut officiel de Kaïô Shin, la fusion n'est pas permanente mais limitée à une durée d'une heure, écourtée si la dépense de ki divin est trop massive (comme lors de l'usage du Final Kamehameha en Super Saiyan Blue).`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/41", kind: "manga_volume", label: "Manga Dragon Ball — Tome 41, Chapitre 501-505" },
			{ n: 2, url: "/wiki/databooks/7#planche-64", kind: "databook", label: "Daizenshuu 7 — Daijiten" }
		])
	},
	{
		id: 9,
		name: "Fusion Métamol",
		ki: "Harmonie Parfaite (Danse Fusion)",
		article: `**La Fusion Métamol** (フュージョン, *Fyūjon*) est une danse martiale sacrée enseignée à Son Gokū par les extraterrestres du peuple Métamol lors de son séjour dans l'Autre Monde.\n\n## La rigueur de la Danse de Fusion\n\nPour réussir cette prouesse, deux guerriers de gabarit et de puissance ki strictement équivalents doivent accomplir une chorégraphie symétrique rigoureuse et millimétrée terminée par le contact précis des index. Toute asymétrie corporelle ou décalage de posture engendre une fusion défectueuse et grotesque : un guerrier obèse incapable de courir ou un vieillard squelettique souffreteux, contraints d'attendre l'écoulement des 30 minutes réglementaires pour se séparer.\n\n## Gotenks et Gogeta\n\nMaîtrisée avec brio par **Son Goten** et **Trunks** pour former **Gotenks**, puis par Son Gokū et Vegeta pour donner naissance à **Gogeta** (dans le film *Fusions* puis officialisé dans le film *Dragon Ball Super: Broly*), cette technique octroie une tenue traditionnelle propre aux Métamols (gilet sans manches à col rembourré et ceinture de soie) et libère une force de frappe dévastatrice.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/40", kind: "manga_volume", label: "Manga Dragon Ball — Tome 40, Chapitres 469-472" },
			{ n: 2, url: "/wiki/databooks/7#planche-62", kind: "databook", label: "Daizenshuu 7 — Daijiten" }
		])
	},
	{
		id: 10,
		name: "Ultra Instinct",
		ki: "Réflexe Divin Absolu (Migatte no Gokui)",
		article: `**L'Ultra Instinct** (身勝手の極意, *Migatte no Gokui*, littéralement « Le secret de l'égoïsme du corps ») est l'état martial suprême des Anges et du Grand Prêtre, transcendant la notion même de transformation conventionnelle.\n\n## Au-delà de la pensée\n\nEnseigné à demi-mot par Whis dès le film *La Résurrection de « F »*, cet enseignement stipule que le temps de transmission de l'influx nerveux entre le cerveau et les membres constitue une perte d'efficacité fatale face aux adversaires divins. L'Ultra Instinct permet à chaque cellule et à chaque muscle du corps de percevoir, esquiver et riposter de manière entièrement autonome et instantanée sans passer par la conscience réflexive.\n\n## Éveil et Maîtrise de Son Gokū\n\nSon Gokū manifeste pour la première fois les prémices de cet état (**Ultra Instinct Omen / Signe**) lors de l'épisode 110 de *Dragon Ball Super* face à Jiren. Il atteint ensuite la forme achevée (**Ultra Instinct Maîtrisé / Silver**), arborant des cheveux et des iris blanc argenté étincelants. Dans l'arc Moro du manga de Toyotarō, Gokū apprend auprès de l'ange Merus à activer cet état à volonté sans dépendre d'une situation de mort imminente.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/153", kind: "manga_volume", label: "Dragon Ball Super — Tomes 8 à 15 (Arcs Tournoi du Pouvoir & Moro)" },
			{ n: 2, url: "/wiki/databooks/19#planche-122", kind: "databook", label: "Dragon Ball Chōzenshū 4" }
		])
	},
	{
		id: 11,
		name: "Ultra Ego",
		ki: "Puissance de Destruction Illimitée (Wagamama no Gokui)",
		article: `**L'Ultra Ego** (我儘の極意, *Wagamama no Gokui*, « Le secret de l'égocentrisme ») est la réponse martiale et philosophique forgée par **Vegeta** pour rivaliser avec l'Ultra Instinct de Son Gokū sans renier sa nature de guerrier saiyan.\n\n## La doctrine de la Destruction de Beerus\n\nIncapable d'adopter le calme intérieur et la sérénité requise par l'enseignement angélique de Whis, Vegeta s'entraîne directement auprès du Dieu de la Destruction **Beerus**. Ce dernier lui enseigne que le pouvoir de la Destruction (*Hakai*) s'alimente au contraire de l'instinct pur, de la fierté sans entrave et de la focalisation totale sur le combat présent.\n\n## Caractéristiques et Montée en puissance\n\nIntroduit au chapitre 74 du manga *Dragon Ball Super* face à Granolah, l'Ultra Ego modifie l'anatomie de Vegeta : ses sourcils disparaissent (rappelant l'arcade proéminente du Super Saiyan 3), sa chevelure vire au violet profond et son regard s'enflamme d'une détermination sauvage. Sa particularité la plus effrayante réside dans son mécanisme d'amplification : plus Vegeta subit de dégâts physiques et encaisse les assauts ennemis, plus son esprit guerrier s'échauffe et décuple la puissance destructive de son ki.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/161", kind: "manga_volume", label: "Dragon Ball Super — Tomes 16 & 17, Chapitres 74-76" }
		])
	},
	{
		id: 12,
		name: "Gohan Beast",
		ki: "Éveil Primal Déchaîné (Beast)",
		article: `**Gohan Beast** (孫悟飯ビースト, *Son Gohan Bīsuto*) est la transformation ultime de Son Gohan, introduite dans le long-métrage canonique *Dragon Ball Super: Super Hero* (2022), écrit et scénarisé par Akira Toriyama.\n\n## La bête intérieure libérée\n\nSelon les notes de conception d'Akira Toriyama, cet état représente le réveil de la « bête sauvage » tapie au plus profond de Son Gohan depuis sa tendre enfance. Face à la quasi-mort de son mentor Piccolo sous les coups du gigantesque monstre bio-mécanique **Cell Max**, Gohan subit un traumatisme psychologique miroir de la mort de C-16 au Cell Game, brisant le dernier verrou émotionnel de sa conscience.\n\n## Attributs Physiques & Puissance\n\nLa forme se caractérise par une immense chevelure argentée dressée vers le ciel rappelant la silhouette mythique du Super Saiyan 2 de son adolescence, des yeux aux iris pourpres perçants avec des pupilles noires contrastées, et une aura bleutée striée d'éclairs magenta. Dans cet état, Gohan encaisse un coup de poing direct de Cell Max sans broncher d'un millimètre et l'extermine d'un Makankōsappō dévastateur. Toriyama a confirmé que cette forme plaçait Gohan au sommet de la hiérarchie des guerriers mortels, rivalisant avec Gokū et Vegeta.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/films/dragon-ball-super-super-hero", kind: "canon", label: "Film Dragon Ball Super: Super Hero (2022)" },
			{ n: 2, url: "/wiki/manga/volume/167", kind: "manga_volume", label: "Dragon Ball Super — Tomes 22-23 (Arc Super Hero)" }
		])
	},
	{
		id: 18,
		name: "Golden Freezer",
		ki: "Évolution Dorée Impériale",
		article: `**Golden Freezer** (ゴールデンフリーザ, *Gōruden Furīza*) est l'évolution transcendante développée par le tyran galactique Freezer après sa résurrection par les Dragon Balls terriennes dans le film *La Résurrection de « F »*.\n\n## Quatre mois d'entraînement prodigieux\n\nNé avec un génie martial inné et une puissance naturelle colossale, Freezer n'avait jamais accompli le moindre jour d'entraînement de toute son existence. Conscient que Son Gokū avait terrassé Majin Boo et éveillé le ki divin, Freezer se soumet à quatre mois d'entraînement intensif sous les ordres de Tagoma. Ce conditionnement débloque un potentiel latent effroyable, lui permettant de passer d'un niveau inférieur au Super Saiyan de Namek à une force rivalisant avec le Super Saiyan Blue.\n\n## Le choix de la couleur d'or\n\nPar pure ironie et vanité royale, Freezer choisit délibérément de colorer sa peau de plaques d'or scintillant pour narguer l'aura dorée des Super Saiyans qui l'avaient jadis déchu de son trône impérial.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/films/dragon-ball-z-resurrection-f", kind: "canon", label: "Film Dragon Ball Z: La Résurrection de « F » (2015)" },
			{ n: 2, url: "/wiki/manga/volume/151", kind: "manga_volume", label: "Dragon Ball Super — Tome 2" }
		])
	},
	{
		id: 19,
		name: "Black Freezer",
		ki: "Suprématie des 10 Ans d'Entraînement",
		article: `**Black Freezer** (ブラックフリーザ, *Burakku Furīza*) est la forme suprême terrifiante révélée par Freezer au dénouement de l'arc Granolah dans le chapitre 87 du manga *Dragon Ball Super*.\n\n## Dix années dans la Chambre de l'Esprit et du Temps\n\nAprès avoir découvert une Salle de l'Esprit et du Temps sur l'une des planètes sous son contrôle dans un monde conquis, Freezer s'y enferme pour accomplir l'équivalent de **dix années entières d'entraînement continu**. Cette discipline d'acier lui permet d'éliminer définitivement les faiblesses d'endurance de sa forme Golden et d'atteindre un stade de puissance écrasant l'entendement.\n\n## Démonstration de force absolue\n\nRevêtu d'une pigmentation noire ébène et d'une armure d'argent poli, Black Freezer apparaît sur la planète Cereal où il extermine Gas d'un seul revers de main, avant d'assommer simultanément Son Gokū en Ultra Instinct et Vegeta en Ultra Ego d'un unique coup au plexus, s'affirmant comme l'être le plus puissant de l'Univers 7.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/164", kind: "manga_volume", label: "Dragon Ball Super — Tome 20, Chapitre 87" }
		])
	},
	{
		id: 26,
		name: "Orange Piccolo",
		ki: "Bénédiction Divine de Shenron",
		article: `**Orange Piccolo** (オレンジ・ピッコロ, *Orenji Pikkoro*) est la transcendance physique et mystique accordée à Piccolo par le dragon sacré Shenron dans le film canonique *Dragon Ball Super: Super Hero* (2022).\n\n## Le cadeau bonus du Dragon Sacré\n\nAyant demandé à Shenron de libérer son potentiel latent à l'instar du rituel accompli par le Grand Chef de Namek, le dragon réalise le souhait mais précise malicieusement avoir ajouté **« un petit bonus supplémentaire »**. Lors de l'assaut contre les cyborgs Gamma de la renaissance du Red Ribbon, Piccolo invoque ce surcroît de grâce divine.\n\n## Métamorphose Namek\n\nLa peau du guerrier namekien prend une teinte orange vive éclatante, ses antennes se dressent vers le ciel, sa musculature devient herculéenne et le symbole namek de l'arbre Ajissa s'illumine sur son dos. Cette forme permet à Piccolo de pulvériser Gamma 2 d'une pichenette et de tenir tête au titanesque Cell Max en gigantifiant son corps. Akira Toriyama a déclaré qu'il était ravi d'avoir enfin offert à Piccolo une force rivalisant avec celle de Gokū et ses pairs.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/films/dragon-ball-super-super-hero", kind: "canon", label: "Film Dragon Ball Super: Super Hero (2022)" },
			{ n: 2, url: "/wiki/manga/volume/167", kind: "manga_volume", label: "Dragon Ball Super — Tome 22" }
		])
	},
	{
		id: 27,
		name: "Potentiel Éveillé (Ultimate Gohan)",
		ki: "Libération Totale Sans Transformation",
		article: `**Le Potentiel Éveillé** (潜在能力解放, *Senzai Nōryoku Kaihō*), communément désigné sous le titre d'**Ultimate Gohan** ou **Mystic Gohan**, est l'état parfait débloqué par le doyen des dieux, le Vieux Kaïô Shin (*Rō Kaiōshin*), au tome 41 du manga.\n\n## Le rituel des 25 heures\n\nLibéré de l'Épée Z brisée par Gohan, le Vieux Kaïô Shin accomplit une danse magique excentrique de 5 heures suivie d'une méditation de 20 heures. Ce rituel télépathique unique extrait l'intégralité du potentiel latent du métis saiyan bien au-delà de ses limites naturelles sans exiger de transformation énergivore en Super Saiyan.\n\n## L'apogée d'un guerrier\n\nEn concentrant son énergie comme pour passer Super Saiyan, Gohan conserve sa chevelure noire naturelle bordée d'une unique mèche frontale, un regard sévère souligné et une aura d'argent immaculée. Dans cet état, il surclasse et humilie complètement **Super Boo**, affirmant la suprématie de la pureté du ki sur les transformations mécaniques.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/41", kind: "manga_volume", label: "Manga Dragon Ball — Tome 41, Chapitres 495-498" },
			{ n: 2, url: "/wiki/databooks/7#planche-60", kind: "databook", label: "Daizenshuu 7 — Daijiten" }
		])
	},
	{
		id: 24,
		name: "Ōzaru (Grand Singe)",
		ki: "x10 (Puissance Décuplée)",
		article: `**L'Ōzaru** (大猿, littéralement « Grand Singe ») est la métamorphose animale originelle et destructrice propre à la race des Saiyans possédant leur queue intacte.\n\n## Les ondes Bruits et la Pleine Lune\n\nSelon les explications scientifiques fournies par Vegeta au chapitre 232 du manga, la métamorphose est provoquée lorsque la rétine du Saiyan absorbe au moins **17 millions de zenos d'ondes Bruits** (*Bruits Waves*), émises par la lumière solaire réfléchie par un astre céleste tel que la pleine lune. Le corps grandit alors démesurément pour atteindre une quinzaine de mètres de haut, recouvert d'un épais pelage brun, et sa puissance de combat (*Battle Power*) est multipliée par dix selon le *Daizenshuu 7*.\n\n## Contrôle de l'esprit\n\nTandis que les Saiyans de basse classe comme Son Gokū ou Son Gohan perdent tout contrôle de leur raison et cèdent à une furie sanguinaire aveugle, les guerriers d'élite comme le Prince Vegeta conservent l'intégralité de leur intellect, de leur capacité d'élocution et de leur maîtrise martiale. Le point faible critique de la créature demeure sa queue, dont la préhension ou l'ablation provoque l'évanouissement ou la régression instantanée vers la forme humanoïde.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/20", kind: "manga_volume", label: "Manga Dragon Ball — Tome 20, Chapitre 232" },
			{ n: 2, url: "/wiki/databooks/7#planche-58", kind: "databook", label: "Daizenshuu 7 — Daijiten" }
		])
	}
];

console.log(`Enrichissement de ${ENRICHMENTS.length} transformations majeures...`);

for (const t of ENRICHMENTS) {
	await sql`
		UPDATE bot.db_transformations SET
			name = ${t.name},
			ki = ${t.ki},
			article = ${t.article},
			article_sources = ${t.article_sources},
			article_updated_at = ${Math.floor(Date.now() / 1000)}
		WHERE id = ${t.id};
	`;
	console.log(`  ✓ Transformation enrichie : ${t.name} (id: ${t.id})`);
}

console.log("Terminé avec succès.");
await sql.end();
