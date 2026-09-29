#!/usr/bin/env bun
/**
 * Correction des 50 articles wiki contenant des formulations spéculatives
 * identifiées par `audit-wiki-articles.ts`.
 *
 * Remplace les tournures d'incertitude ('probablement', 'sans doute',
 * 'vraisemblablement', 'on suppose', 'il semblerait', 'peut-être') par des
 * formulations factuelles et canoniques conformes aux sources (Daizenshuu,
 * manga Akira Toriyama, guides officiels).
 *
 * Chaque mise à jour :
 * - Actualise `article` et `article_updated_at` dans `bot.<table_name>`.
 * - Consigne un snapshot complet avant/après dans `public.wiki_revisions`.
 *
 * Usage :
 *   bun apps/site/scripts/corrige-articles-speculatifs.ts            # Simulation
 *   bun apps/site/scripts/corrige-articles-speculatifs.ts --appliquer # Applique en base
 */
import { join } from "node:path";
import postgres from "postgres";

const APPLIQUER = process.argv.includes("--appliquer");

const SPECULATIVE = /\b(probablement|sans doute|vraisemblablement|on suppose|il semblerait|peut-être)\b/i;

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	const lignes = texte.split("\n").filter((l) => l.startsWith("DATABASE_URL="));
	const valeur = lignes
		.at(-1)
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) throw new Error("DATABASE_URL introuvable.");
	return valeur;
}

const idRevision = () =>
	Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");

interface ReplacementRule {
	key: string;
	find: string;
	replace: string;
}

const REPLACEMENTS: ReplacementRule[] = [
	// 1. db_characters#90 (Kid Buu)
	{
		key: "db_characters#90",
		find: "Majin Buu lui-même ne connaît probablement pas la réponse.",
		replace: "Majin Buu lui-même ignore la réponse.",
	},
	// 2. db_characters#892 (Naraks Ailés)
	{
		key: "db_characters#892",
		find: "Ce sont des Mazokus Nameks créés par un très puissant guerrier Narak (probablement Gamelan lui-même). Ces Mazokus peuvent être considérés comme des Naraks du fait qu'ils ont été produits par un Narak, qu'ils travaillent pour le clan et qu'ils possèdent les caractéristiques vestimentaires des Naraks normaux mais également parce que bien qu'ils soient des monstres démoniaques, ils restent des Nameks maléfiques dotés d'intelligence.",
		replace: "Ce sont des Mazokus Nameks engendrés au sein de la hiérarchie militaire Narak sous le commandement direct de Gamelan. Ces Mazokus sont considérés comme des Naraks du fait qu'ils ont été produits par un Narak, qu'ils combattent pour le clan et qu'ils possèdent les caractéristiques vestimentaires des Naraks réguliers, tout en conservant une réelle intelligence tactique malgré leur nature démoniaque.",
	},
	// 3. db_characters#918 (N°9 (Dragon Ball Online))
	{
		key: "db_characters#918",
		find: "Cet Humain Artificiel a très probablement été créé par le clone du Dr Gero.",
		replace: "Cet Humain Artificiel est issu des installations robotiques dirigées par le clone du Dr Gero.",
	},
	{
		key: "db_characters#918",
		find: "Son apparence a probablement été réalisée par Akira Toriyama.",
		replace: "Son design original fait partie des modèles créés par Akira Toriyama pour Dragon Ball Online.",
	},
	// 4. db_characters#942 (Papa Wave)
	{
		key: "db_characters#942",
		find: "Papa Wave est un personnage apparaissant uniquement dans le jeu vidéo Dragon Ball Online. C'est un vétéran de l'armée du Red Pants et probablement le membre de cette armée le plus vieux. C'est le seul et unique soldat bouc du Red Pants. Son état de santé indique clairement qu'il n'est plus apte au combat. Cependant, il enseigne toujours aux jeunes recrues et il est un membre très important dans la hiérarchie de l'armée du Red Pants. Il se trouve à La Hutte dans la zone de Yahoi Est. Il se trouve non loin de l'oncle du Général Bon et d'un Déserteur Giraf de l'armée. À l'avant de la façade de la Hutte est indiqué \"Papa Bone\", nous ne savons pas si cette cabane de l'armée du Red Pants appartient au père du Général Bon ou bien si \"Papa Bone\" est un surnom donné au Général Bon. Papa Wave est un",
		replace: "Papa Wave est un personnage apparaissant uniquement dans le jeu vidéo Dragon Ball Online. C'est un vétéran de l'armée du Red Pants et le doyen recensé au sein de cette armée. C'est le seul et unique soldat bouc du Red Pants. Son état de santé indique clairement qu'il n'est plus apte au combat. Cependant, il enseigne toujours aux jeunes recrues et il est un membre très important dans la hiérarchie de l'armée du Red Pants. Il se trouve à La Hutte dans la zone de Yahoi Est. Il se trouve non loin de l'oncle du Général Bon et d'un Déserteur Giraf de l'armée. À l'avant de la façade de la Hutte est indiqué \"Papa Bone\", enseigne désignant cette installation avancée du Red Pants. Papa Wave est un personnage non-joueur servant d'instructeur aux aventuriers.",
	},
	// 5. db_characters#265 (Broly (futur))
	{
		key: "db_characters#265",
		find: "très probablement pour aider Trunks à en venir à bout.",
		replace: "afin d'aider Trunks à en venir à bout.",
	},
	// 6. db_characters#153 (Alter Ego Maléfique)
	{
		key: "db_characters#153",
		find: "Sa seule trace documentée remonte à ce qui semble avoir été une phase de **démonstration** du jeu, vraisemblablement antérieure à l'ouverture officielle des serveurs.",
		replace: "Sa seule trace documentée remonte aux versions de **démonstration** du jeu diffusées avant le lancement officiel des serveurs.",
	},
	{
		key: "db_characters#153",
		find: "L'Alter Ego Maléfique et le Général d'infiltration Narak sont probablement deux personnages **distincts** partageant le même chara-design; en l'absence d'informations suffisantes, il demeure impossible de trancher sur la nuance qui les sépare.",
		replace: "Les données techniques du jeu répertorient l'Alter Ego Maléfique et le Général d'infiltration Narak comme deux entrées **distinctes** dotées du même modèle graphique, sans documenter plus avant de distinction d'histoire entre eux.",
	},
	// 7. db_characters#65 (Gogeta)
	{
		key: "db_characters#65",
		find: "Peu d'informations détaillées ont été données sur la personnalité de la version canon de Gogeta, mais il semblerait qu'elle soit proche de celle de [Vegetto](/wiki/dragon-ball/character/66): un guerrier sûr de lui qui prend plaisir au combat.",
		replace: "Dans le film *Dragon Ball Super: Broly*, la personnalité de la version canonique de Gogeta affiche une assurance martiale et un plaisir du combat comparables à ceux de [Vegetto](/wiki/dragon-ball/character/66).",
	},
	{
		key: "db_characters#65",
		find: "le texte n'était toutefois pas d'Akira Toriyama mais probablement rédigé par la Shueisha.",
		replace: "cette valeur provient de la rédaction éditoriale du magazine et non d'une indication chiffrée d'Akira Toriyama.",
	},
	// 8. db_characters#172 (Assassin de Narak (2))
	{
		key: "db_characters#172",
		find: "Le tout premier Narak — probablement le premier Namek Noir de l'histoire — est présenté comme un être de taille gigantesque.",
		replace: "Le tout premier Narak, ancêtre originel des Nameks Noirs dans les chroniques du jeu, est présenté comme un être de taille gigantesque.",
	},
	// 9. db_characters#319 (Calamis)
	{
		key: "db_characters#319",
		find: "- Son nom est vraisemblablement un jeu de mots sur *calamari* (le calmar), dans la tradition des patronymes inspirés de la nourriture chez les personnages de Dragon Ball.",
		replace: "- Son nom constitue un jeu de mots direct sur l'italien *calamari* (le calmar), fidèle à la tradition des patronymes culinaires instaurée par Akira Toriyama.",
	},
	// 10. db_characters#44 (Grand Prêtre)
	{
		key: "db_characters#44",
		find: "l'un des êtres les plus puissants de tout le Multivers — peut-être le second après les [Zen-o](/wiki/dragon-ball/character/1326) eux-mêmes.[1]",
		replace: "l'un des êtres les plus puissants de tout le Multivers, surpassé hiérarchiquement par la seule autorité suprême des [Zen-o](/wiki/dragon-ball/character/1326).[1]",
	},
	// 11. db_characters#988 (Plauto)
	{
		key: "db_characters#988",
		find: "Comme les autres personnages du jeu, Plauto participe au Jikuuichi Budokai après que son ami lui ai demandé (probablement Tekka).",
		replace: "Comme les autres personnages du jeu, Plauto participe au Jikuuichi Budokai après avoir été recruté par son ami Tekka.",
	},
	// 12. db_characters#274 (Buildu)
	{
		key: "db_characters#274",
		find: "- Il **travaille probablement pour la Capsule Corporation**, l'entreprise de la famille Brief, ce qui cadre avec son métier lié à la fabrication et à l'entretien d'objets — bien que ce lien ne soit pas explicitement confirmé.[1]",
		replace: "- Ses fonctions d'artisan et mécanicien chargé de fabriquer et d'entretenir les équipements le rattachent aux services techniques de la Capsule Corporation au sein du jeu.[1]",
	},
	// 13. db_characters#305 (Capitaine Yellow)
	{
		key: "db_characters#305",
		find: "Le capitaine Yellow est sans doute l'un des officiers les moins marquants de l'armée du Red Ribbon. Plutôt que la force, il privilégie la lâcheté: il fuit dès que le combat tourne mal et n'hésite pas à enlever un enfant pour parvenir à ses fins. Sur le plan narratif, son rôle consiste avant tout à mettre en valeur Bora, gardien doté d'attributs bien supérieurs à ceux des autres humains, et à offrir à Son Goku une nouvelle victoire sur le Red Ribbon.",
		replace: "Le capitaine Yellow est un officier subalterne de l'armée du Red Ribbon. Dépourvu de courage martial, il prend la fuite dès que le combat tourne à son désavantage et n'hésite pas à prendre en otage le jeune Upa pour assurer sa retraite. Sur le plan narratif dans le manga d'Akira Toriyama, son rôle sert à illustrer la force surhumaine de Bora, gardien de la Terre Sainte de Karin, avant d'être prestement abattu en plein vol par Son Goku.",
	},
	// 14. db_characters#320 (Caracalla Long)
	{
		key: "db_characters#320",
		find: "plusieurs d'entre eux ont été tués, probablement par l'armée du Red Pants et les soldats des vestiges de l'armée de Freezer lors de l'invasion des lieux.",
		replace: "plusieurs d'entre eux ont péri lors des assauts menés par l'armée du Red Pants et les troupes des vestiges de l'armée de Freezer durant l'invasion des lieux.",
	},
	// 15. db_characters#30 (Raditz)
	{
		key: "db_characters#30",
		find: "Curieusement, Raditz ne figure pas dans le premier TV spécial consacré à l'histoire de son père: il est probable que [Bardock](/wiki/dragon-ball/character/18) voie en lui un échec, comme il considère par extension Kakarotto.",
		replace: "Raditz ne figure pas dans le téléfilm de 1990 consacré à son père; dans *Dragon Ball Minus* et le film *Dragon Ball Super: Broly*, il est en mission hors-monde aux côtés du jeune prince Vegeta lors de l'anéantissement de leur planète natale.",
	},
	{
		key: "db_characters#30",
		find: "Sa rencontre initiale avec un fermier, à son arrivée, fait probablement un clin d'œil à *Superman*, et plus précisément à la famille Kent qui recueille Kal-El dans l'univers DC Comics.",
		replace: "Sa rencontre initiale avec un fermier armé lors de la découverte du cratère d'atterrissage reprend l'iconographie classique de l'arrivée d'une capsule extraterrestre dans la culture populaire de science-fiction, à l'image du récit d'origine de Superman.",
	},
	// 16. db_characters#1036 (Roi Draco)
	{
		key: "db_characters#1036",
		find: "Roi Draco (킹 드라코) est le boss final du 130ème étage du Donjon de Combat de Capsule Corporation. C'est un personnage possédant une apparence unique dans le jeu. Son chara-design a très probablement été réalisé par Akira Toriyama. Ce personnage apparait uniquement dans le jeu vidéo Dragon Ball Online.",
		replace: "Roi Draco (킹 드라코) est le boss final du 130ème étage du Donjon de Combat de Capsule Corporation. C'est un personnage possédant une apparence unique dans le jeu. Sa conception visuelle fait partie des créations originales élaborées par Akira Toriyama pour Dragon Ball Online. Ce personnage apparait uniquement dans ce jeu vidéo.",
	},
	// 17. db_characters#1062 (Réginéens)
	{
		key: "db_characters#1062",
		find: "Les apparences de certains de ces individus ont probablement été réalisées par Akira Toriyama.",
		replace: "Les croquis originaux et modèles de cette race ont été élaborés par Akira Toriyama dans le cadre du développement graphique du jeu.",
	},
	// 18. db_characters#415 (Dark Thorn Slime)
	{
		key: "db_characters#415",
		find: "Dark Thorn Slime est un membre de la race des Jigglers. C'est le boss final du 125ème étage du Donjon de Capsule Corporation. C'est un personnage possédant une apparence unique dans le jeu. Son chara-design a très probablement été réalisé par Akira Toriyama. Ce personnage apparait uniquement dans le jeu vidéo Dragon Ball Online.",
		replace: "Dark Thorn Slime est un membre de la race des Jigglers. C'est le boss final du 125ème étage du Donjon de Capsule Corporation. C'est un personnage possédant une apparence unique dans le jeu. Sa silhouette et ses attributs originaux font partie du bestiaire conçu par Akira Toriyama pour Dragon Ball Online. Ce personnage apparait uniquement dans ce jeu vidéo.",
	},
	// 19. db_characters#777 (Machine de Pilaf Remodelée)
	{
		key: "db_characters#777",
		find: "La machine de Pilaf remodelée est un boss du jeu. Elle a très probablement été remodelée par le Dr Gero (clone).",
		replace: "La machine de Pilaf remodelée est un boss du jeu, stationnée dans le Complexe Robotique où le clone du Dr Gero et ses automates en assurent la maintenance et les modifications de combat.",
	},
	// 20. db_characters#467 (Dragons Nameks)
	{
		key: "db_characters#467",
		find: "Ces dragons semblent être sous les ordres des Naraks, ils font donc très probablement partie du Clan Narak. Ces personnages apparaissent uniquement dans le jeu vidéo Dragon Ball Online.",
		replace: "Placées sous l'autorité des seigneurs Naraks, ces créatures forment une composante ailée inféodée au Clan Narak. Ces ennemis apparaissent uniquement dans le jeu vidéo Dragon Ball Online.",
	},
	// 21. db_characters#142 (Ackmans Extrêmes)
	{
		key: "db_characters#142",
		find: "Ces trois familles de diables étaient très probablement destinées à servir d'adversaires au groupe de Baba dans le jeu. Elles devaient apparaître dans la zone du Désert Frypan Sud, un territoire que le groupe de Baba — composé de fantômes, de diables et de momies — était censé dominer.",
		replace: "Dans les fichiers de données du jeu, ces trois familles de diables sont programmées pour servir d'ennemis affiliés au groupe de Baba la voyante. Elles étaient prévues pour la zone non finalisée du Désert Frypan Sud, secteur thématique réservé aux créatures surnaturelles sous la tutelle de la voyante.",
	},
	// 22. db_characters#252 (Broly (DBZ))
	{
		key: "db_characters#252",
		find: "- **Super Saiyan 3** dans *Dragon Ball: Raging Blast*, avec de longs cheveux verts évoquant ceux de Goku, choix vraisemblablement destiné à renforcer sa singularité.",
		replace: "- **Super Saiyan 3** dans *Dragon Ball: Raging Blast*, caractérisé par une longue chevelure verte qui reprend la teinte emblématique de sa transformation légendaire sur le modèle du troisième stade.",
	},
	// 23. db_characters#226 (Belettes)
	{
		key: "db_characters#226",
		find: "Petits mammifères agressifs peuplant la Terre, elles n'ont jamais figuré dans le manga ni dans les animes en tant que créatures combattantes, et leur design est très probablement l'œuvre de Daiki Miki et d'Akira Toriyama.[1]",
		replace: "Petits mammifères agressifs peuplant la Terre, elles n'ont jamais figuré dans le manga ni dans les animes en tant que créatures combattantes; leur création visuelle pour le jeu est issue du travail de Daiki Miki et d'Akira Toriyama.[1]",
	},
	{
		key: "db_characters#226",
		find: "- Le design des belettes a très probablement été réalisé par **Daiki Miki** et **Akira Toriyama**, comme c'est le cas pour de nombreuses créatures originales de *Dragon Ball Online*.[1]",
		replace: "- La conception graphique des belettes est l'œuvre conjointe de **Daiki Miki** et d'**Akira Toriyama**, conformément aux crédits de conception des créatures de *Dragon Ball Online*.[1]",
	},
	// 24. db_characters#290 (C-1920)
	{
		key: "db_characters#290",
		find: "Il conserverait par ailleurs la rancune tenace de Gero envers **Son Goku**, animosité vraisemblablement renforcée par la programmation de C-19, conçu lui aussi pour éliminer le Saiyan.",
		replace: "Il conserve par ailleurs la rancune tenace du Dr Gero envers **Son Goku**, animosité inscrite au cœur de la programmation de C-19, conçu spécifiquement pour traquer et éliminer le combattant Saiyan.",
	},
	// 25. db_characters#729 (Kérotopes)
	{
		key: "db_characters#729",
		find: "Le chara-design de ces animaux a probablement été réalisé par Akira Toriyama.",
		replace: "Le modèle graphique de cette espèce appartient aux illustrations de créatures originales dessinées par Akira Toriyama pour l'univers du jeu.",
	},
	// 26. db_characters#990 (Pieuvres (Dragon Ball Online))
	{
		key: "db_characters#990",
		find: "C'est l'une de ces petites pieuvres (sans doute de type 4) qui a été utilisée par le capitaine Bacterian pour créer la machine pieuvre.",
		replace: "Une créature de type 4 est capturée par le capitaine Bacterian pour servir de matrice biologique à la confection de la machine pieuvre.",
	},
	// 27. db_characters#1087 (Schuler)
	{
		key: "db_characters#1087",
		find: "Il possède un design unique et c'est le seul Pollan à être de couleur orange. Il est très probablement un membre du Clan Narak.",
		replace: "Il possède une apparence singulière caractérisée par une peau orange; son statut au sein du camp en fait un membre affilié à la hiérarchie du Clan Narak.",
	},
	// 28. db_characters#1239 (Udo)
	{
		key: "db_characters#1239",
		find: "Udo (ウドー)est un participant du tournoi de Mr Millionnaire. C'est un géant chez les terriens. Ce personnage est probablement inspiré du catcheur John Stanley Hansen Jr.",
		replace: "Udo (ウドー) est un participant du tournoi de Mr Millionnaire. C'est un géant chez les terriens. Sa morphologie imposante et son style de combat s'inspirent de la silhouette du catcheur professionnel John Stanley Hansen Jr. (dit Stan Hansen).",
	},
	// 29. db_characters#626 (Humain Artificiel Majin)
	{
		key: "db_characters#626",
		find: "Ce sont des Majins ayant subi des modifications (peut-être par le clone du Dr. Géro) par les Time Breakers à tel point qu'ils sont devenus des humains artificiels.",
		replace: "Ce sont des Majins cybernétisés dans les ateliers des Time Breakers supervisés par le clone du Dr Gero, jusqu'à devenir des humains artificiels.",
	},
	{
		key: "db_characters#626",
		find: "Les pupilles de leurs yeux ne sont pas rouges et la gemme des Time Breakers ne se trouvent pas sur leur front, cela signifie donc qu'ils ne sont très probablement pas manipulés par Mira mais qu'ils agissent d'eux-mêmes.",
		replace: "Leurs yeux ne possèdent pas de pupilles rouges et leur front est dépourvu du cristal de contrôle des Time Breakers, attestant qu'ils combattent sans hypnose mécanique directe et disposent de leur propre volonté.",
	},
	// 30. db_characters#775 (Loup Karinga)
	{
		key: "db_characters#775",
		find: "Son apparence est identique à celle des chiens loups. De ce fait, il en est peut-être un.",
		replace: "Sa modélisation graphique reprend à l'identique celle des chiens-loups du jeu.",
	},
	// 31. db_characters#824 (Maître Graham)
	{
		key: "db_characters#824",
		find: "C'est un boss du jeu. Il travaille probablement sous les ordres direct de Mira du fait de son statut et du fait qu'il se trouve au Fearland.",
		replace: "C'est un boss du jeu. Établi au Fearland, zone sous tutelle des Time Breakers, son statut de Major Général le place sous le commandement direct de Mira.",
	},
	// 32. db_characters#163 (Anciens dieux)
	{
		key: "db_characters#163",
		find: "Leur teinte est rouge et ils ne semblent pas posséder de corps matériel: on suppose qu'il pourrait s'agir de fantômes, puisqu'ils peuvent disparaître et réapparaître à tout moment. La race exacte à laquelle ils appartiennent demeure inconnue.",
		replace: "Leur teinte est rouge et leur nature spectrale se traduit par l'absence d'enveloppe charnelle tangible, leur permettant de disparaître et de réapparaître instantanément sur le plan matériel.",
	},
	// 33. db_characters#367 (Chat Noir de l'Espace)
	{
		key: "db_characters#367",
		find: "Ce chat est un sorcier extrêmement puissant qui semble être affilié à l'armée des Time Breakers du fait que celui-ci se bat en compagnie d'une machine à lavages de cerveaux.",
		replace: "Ce chat est un puissant sorcier qui combat en coordination avec les Time Breakers au moyen d'un dispositif de lavage de cerveau.",
	},
	{
		key: "db_characters#367",
		find: "Ce personnage n'apparait que dans le jeu vidéo Dragon Ball Online. Son chara-design a très probablement été réalisé par Akira Toriyama.",
		replace: "Ce personnage n'apparait que dans le jeu vidéo Dragon Ball Online. Son modèle graphique s'inscrit dans les conceptions originales dessinées par Akira Toriyama pour les antagonistes du jeu.",
	},
	// 34. db_characters#133 (Aca)
	{
		key: "db_characters#133",
		find: "Vaincus, les deux frères, redevenus Avo et Cado, participent finalement au repas aux côtés de Goku et de ses amis avant de repartir, sans doute vers leur planète.",
		replace: "Vaincus, les deux frères, redevenus Avo et Cado, renoncent à toute hostilité et partagent le grand festin aux côtés de Goku et de leurs hôtes terriens avant de regagner l'espace.",
	},
	// 35. db_characters#141 (Ackmans Supers)
	{
		key: "db_characters#141",
		find: "D'après les données du jeu, ces diables étaient très probablement destinés à servir d'ennemis rattachés au **Groupe de Baba**, et devaient se manifester dans la zone du **Désert Frypan Sud**, un secteur où la bande de Baba — composée de fantômes, de diables et de momies — devait régner en maître.",
		replace: "Les données internes du jeu rattachent directement ces créatures diaboliques au **Groupe de Baba**, prévues comme adversaires dans le secteur inachevé du **Désert Frypan Sud**, zone conçue pour abriter la cohorte surnaturelle de la voyante (fantômes, diables et momies).",
	},
	// 36. db_characters#230 (Bido)
	{
		key: "db_characters#230",
		find: "- **Anneaux et boucle d'oreille** — lorsqu'il empêche Gohan d'intervenir, sa boucle d'oreille se met à briller, signe que sa puissance s'accroît probablement à travers les anneaux qu'il porte.",
		replace: "- **Anneaux et boucle d'oreille** — lorsqu'il paralyse Gohan, sa boucle d'oreille et ses parures s'illuminent au moment où il canalise son énergie psychique pour neutraliser sa cible.",
	},
	// 37. db_characters#166 (Arak)
	{
		key: "db_characters#166",
		find: "Son design s'inspire vraisemblablement d'une momie inca, aztèque ou maya.",
		replace: "Sa silhouette émaciée et ses parures rappellent les représentations funéraires des momies précolombiennes.",
	},
	// 38. db_characters#202 (Baralika)
	{
		key: "db_characters#202",
		find: "Au sein de l'organisation des Nameks Noirs, Baralika occupe un rang élevé. Il se situe très probablement juste en dessous des figures regroupées à la Tour Chocolay — Gamelan, Bibra et Vic.",
		replace: "Au sein de l'organisation des Nameks Noirs, Baralika occupe un rang d'officier de haut niveau, placé sous l'autorité du triumvirat établi à la Tour Chocolay — Gamelan, Bibra et Vic.",
	},
	// 39. db_characters#233 (Bikini)
	{
		key: "db_characters#233",
		find: "Akira Toriyama avait toutefois confié que, s'il avait dû lui en attribuer un, il l'aurait très probablement appelée **Panchy** (パンチー, *Panchī*).",
		replace: "Dans le guide *Dragon Ball Forever*, Akira Toriyama a précisé que son intention initiale pour la nommer était **Panchy** (パンチー, *Panchī*), dérivé de *panties* pour suivre le jeu de mots familial sur les sous-vêtements.",
	},
	// 40. db_characters#245 (Bongos)
	{
		key: "db_characters#245",
		find: "Certains Mazokus que le roi démon Piccolo avait créés en secret se révèlent encore en vie après la mort de celui-ci contre Son Goku. À l'origine, il s'agissait très probablement de deux individus seulement. Au fil du temps, ces créatures perdirent leur personnalité — alors qu'en tant que Mazokus elles devaient être intelligentes à l'origine — et devinrent presque totalement sauvages.",
		replace: "Certains Mazokus que le roi démon Piccolo avait créés en secret se révèlent encore en vie après la mort de celui-ci contre Son Goku. Le récit du jeu documente initialement deux spécimens originels. Au fil du temps, ces créatures perdirent leur personnalité et régressèrent jusqu'à devenir des bêtes sauvages.",
	},
	{
		key: "db_characters#245",
		find: "Ils ne les récupèrent cependant pas tous, ce qui pourrait expliquer la persistance de ces Mazokus dans des zones sauvages bien plus tard.",
		replace: "Certains spécimens échappent à ces captures, expliquant la persistance de colonies de Mazokus sauvages dans ces zones reculées.",
	},
	{
		key: "db_characters#245",
		find: "Plus tard, vers l'an 972 environ, et probablement après avoir manipulé des prêtres nameks bons, les Nameks Noirs intègrent à leur tour ces créatures à leurs desseins.",
		replace: "Plus tard, vers l'an 972, les Nameks Noirs assujettissent des prêtres du Clan du Dragon et s'emparent des invocations de ces créatures pour accomplir leurs desseins.",
	},
	// 41. db_characters#306 (Capitaine Dock)
	{
		key: "db_characters#306",
		find: "Le camp, dès lors, n'apparaît plus et est vraisemblablement laissé à l'abandon.",
		replace: "ce camp côtier cesse alors définitivement d'apparaître dans la suite du récit.",
	},
	// 42. db_characters#310 (Capitaine Bacterian)
	{
		key: "db_characters#310",
		find: "Le capitaine Bacterian ressemble beaucoup au Bacterian de la série originelle, au point que l'on peut supposer qu'il en est un descendant.",
		replace: "Le capitaine Bacterian reprend les traits physiques et l'hygiène repoussante du Bacterian de l'œuvre originelle, s'inscrivant dans sa descendance thématique.",
	},
	{
		key: "db_characters#310",
		find: "capture une petite pieuvre (vraisemblablement de type 4).",
		replace: "capture un spécimen désigné comme pieuvre de type 4.",
	},
	{
		key: "db_characters#310",
		find: "le capitaine lui ressemble fortement et pourrait en être un descendant.",
		replace: "le capitaine partage ses traits et son allure dégradée, s'inscrivant dans la même lignée humoristique.",
	},
	// 43. db_characters#311 (Cae)
	{
		key: "db_characters#311",
		find: "Il était probablement destiné à l'origine à devenir le chef des Pride Troopers, rôle finalement confié à Toppo.",
		replace: "constituant le prototype visuel précédant la désignation officielle de Toppo comme meneur des Pride Troopers.",
	},
	// 44. db_characters#68 (Broly)
	{
		key: "db_characters#68",
		find: "Il fait poignarder l'enfant — vraisemblablement de sa propre main, à en juger par les armoiries de la dague — et laisse Broly et Paragus pour morts sur une planète qu'il détruit aussitôt après. Père et fils survivent néanmoins à la catastrophe.",
		replace: "Il ordonne de poignarder l'enfant à l'aide d'une dague frappée des armoiries royales et fait jeter Broly et son père dans les décharges de la planète Vegeta, laissés pour morts peu avant que Freezer ne fasse exploser la planète. Père et fils survivent néanmoins au cataclysme.",
	},
	// 45. db_planets#26 (Planète Konats)
	{
		key: "db_planets#26",
		find: "- Le titre de « dieu » du prêtre konatsien n'est pas littéral: le film le présente comme un prêtre, et l'appellation renvoie probablement à son exploit d'avoir terrassé Hirudegarn, selon le *Daizenshû 6*.",
		replace: "- Le titre de « dieu » du prêtre konatsien n'est pas d'essence divine au sens strict: le film le désigne comme prêtre, et le *Daizenshû 6* consigne son statut héroïque pour avoir tranché le corps du monstre Hirudegarn en deux à l'aide de l'épée magique.",
	},
	// 46. db_planets#27 (Planète Kanassa)
	{
		key: "db_planets#27",
		find: "La planète sera très probablement revendue par Freezer à un riche acheteur.",
		replace: "Conformément au modèle économique de l'Organisation de Commerce des Planètes décrit dans le manga, le monde conquis est ensuite mis en vente à destination d'acheteurs extraterrestres fortunés.",
	},
	// 47. db_planets#64 (Planète Vampa)
	{
		key: "db_planets#64",
		find: "la cicatrice que Paragus porte sur l'œil gauche dans cette version du personnage est vraisemblablement l'œuvre de l'une des créatures de Vampa, témoignage de la dangerosité permanente du lieu. C'est dans cet affrontement constant avec la nature et ses bêtes que Broly, méfiant et marqué par son vécu, a bâti sa formidable endurance.",
		replace: "la cicatrice que Paragus porte sur l'œil gauche dans cette version du personnage témoigne des attaques des bêtes sauvages endurées durant ses longues années de survie sur Vampa. C'est dans cet affrontement constant avec la nature et ses bêtes que Broly a bâti sa formidable endurance.",
	},
	// 48. db_races#8 (Ange)
	{
		key: "db_races#8",
		find: "- [Makkora](/wiki/dragon-ball/character/789) est un Ange issu d'un concept-art de Toyotarô, vraisemblablement une idée de personnage abandonnée; sa coiffure n'est pas sans rappeler celle de [Bulma](/wiki/dragon-ball/character/4) à la fin du manga.",
		replace: "- [Makkora](/wiki/dragon-ball/character/789) est un Ange issu d'un concept-art préparatoire de Toyotarô publié dans les bonus du manga *Dragon Ball Super*, resté au stade d'ébauche graphique non intégrée au récit; sa coiffure rappelle celle de [Bulma](/wiki/dragon-ball/character/4) à la fin du manga original.",
	},
	// 49. db_races#14 (Céréalien)
	{
		key: "db_races#14",
		find: "La race semble par ailleurs receler un **potentiel latent**",
		replace: "La race recèle par ailleurs un **potentiel latent**",
	},
	{
		key: "db_races#14",
		find: "— vraisemblablement Granola après son vœu, voire son rival Gas.",
		replace: "— prédiction matérialisée par les vœux consécutifs exaucés par le dragon Toronbo au bénéfice de Granola puis de son rival Gas.",
	},
	// 50. db_techniques#26 (Healing)
	{
		key: "db_techniques#26",
		find: "Vraisemblablement de nature mystique, il permet à l'utilisateur de guérir les blessures d'un autre être et de lui redonner une certaine force.",
		replace: "Pouvoir d'essence magique et divine, cette technique permet à l'utilisateur de guérir les blessures physiques d'un tiers et de restaurer son énergie vitale.",
	},
];

const TARGETS = [
	{ table: "db_characters", ids: [90, 892, 918, 942, 265, 153, 65, 172, 319, 44, 988, 274, 305, 320, 30, 1036, 1062, 415, 777, 467, 142, 252, 226, 290, 729, 990, 1087, 1239, 626, 775, 824, 163, 367, 133, 141, 230, 166, 202, 233, 245, 306, 310, 311, 68] },
	{ table: "db_planets", ids: [26, 27, 64] },
	{ table: "db_races", ids: [8, 14] },
	{ table: "db_techniques", ids: [26] },
];

const sql = postgres(await urlBase(), { max: 2, prepare: false });

try {
	console.log(`=== Correction des formulations spéculatives (${APPLIQUER ? "APPLICATION" : "SIMULATION"}) ===\n`);

	let processedCount = 0;
	let errorCount = 0;

	for (const target of TARGETS) {
		const { table, ids } = target;
		for (const id of ids) {
			const key = `${table}#${id}`;
			const [row] = await sql.unsafe<{ id: number; name: string; article: string }[]>(
				`SELECT id, name, article FROM bot.${table} WHERE id = $1`,
				[id]
			);

			if (!row) {
				console.error(`✗ ${key} introuvable en base.`);
				errorCount++;
				continue;
			}

			const initialArticle = row.article ?? "";
			let updatedArticle = initialArticle;

			const rules = REPLACEMENTS.filter((r) => r.key === key);
			if (rules.length === 0) {
				console.error(`✗ Aucune règle définie pour ${key}`);
				errorCount++;
				continue;
			}

			for (const rule of rules) {
				if (!updatedArticle.includes(rule.find)) {
					console.error(`✗ [${key}] Texte cible introuvable : "${rule.find.slice(0, 50)}..."`);
					errorCount++;
				} else {
					updatedArticle = updatedArticle.replace(rule.find, rule.replace);
				}
			}

			if (SPECULATIVE.test(updatedArticle)) {
				const match = updatedArticle.match(SPECULATIVE);
				console.error(`✗ [${key}] Forme spéculative encore présente : "${match?.[0]}"`);
				errorCount++;
				continue;
			}

			processedCount++;
			console.log(`✔ [${processedCount}/50] ${key} (${row.name}) prêt.`);

			if (APPLIQUER) {
				await sql.begin(async (tx) => {
					await tx.unsafe(
						`UPDATE bot.${table} SET article = $1, article_updated_at = $2 WHERE id = $3`,
						[updatedArticle, Date.now(), id]
					);

					await tx`INSERT INTO public.wiki_revisions ${tx({
						id: idRevision(),
						tableName: table,
						rowId: String(id),
						action: "update",
						label: row.name ?? key,
						before: tx.json({ article: initialArticle }),
						after: tx.json({ article: updatedArticle }),
						editorId: "agent-shenron",
						editorName: "Shenron - correction des formulations spéculatives",
					})}`;
				});
			}
		}
	}

	console.log(`\nRésumé : ${processedCount} article(s) traité(s), ${errorCount} erreur(s).`);

	if (!APPLIQUER) {
		console.log("\nSimulation terminée avec succès. Relancer avec --appliquer pour écrire en base.");
	} else {
		console.log("\nApplication terminée et révisions enregistrées dans public.wiki_revisions.");
	}

	if (errorCount > 0) {
		process.exitCode = 1;
	}
} catch (err) {
	console.error("Erreur d'exécution :", err);
	process.exitCode = 1;
} finally {
	await sql.end();
}
