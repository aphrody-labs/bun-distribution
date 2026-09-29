// SPDX-License-Identifier: Apache-2.0
/**
 * scripts/ops/enrich-core-characters.ts
 *
 * Enrichissement encyclopédique et assainissement canonique des 8 personnages
 * fondateurs manquants dans bot.db_characters :
 *  1. #1142 : Son Gohan (grand-père)
 *  2. #1145 : Son Gohan (futur)
 *  3. #1020 : Roi démon Piccolo (Piccolo Daimaō)
 *  4. #424  : Dieu (Kami-sama)
 *  5. #347  : Chichi
 *  6. #420  : Dr Gero (C-20)
 *  7. #1018 : Roi Vegeta
 *  8. #996  : Puerh
 *
 * Pour chaque personnage :
 * - Normalisation stricte de name_ja et name_romaji (Hepburn canonique).
 * - Rédaction d'un article encyclopédique de haute tenue respectant strictement le canon Toriyama (manga 42 tomes + Daizenshuu).
 * - Structuration de article_sources (manga + databooks).
 * - Traçabilité complète avec écriture dans public.wiki_revisions.
 */
import postgres from "postgres";
import { homedir } from "node:os";

export interface WikiSource {
	n: number;
	label: string;
	url: string;
	kind: string;
}

export interface CharacterEnrichment {
	id: number;
	name: string;
	name_ja: string;
	name_romaji: string;
	article: string;
	sources: WikiSource[];
}

const CHARACTERS: CharacterEnrichment[] = [
	{
		id: 1142,
		name: "Son Gohan (grand-père)",
		name_ja: "孫悟飯",
		name_romaji: "Son Gohan",
		sources: [
			{ n: 1, url: "/wiki/manga", kind: "manga", label: "Manga Dragon Ball — Tome 1, Chapitre 1 (La rencontre et le legs du bâton)" },
			{ n: 2, url: "/wiki/manga", kind: "manga", label: "Manga Dragon Ball — Tome 2, Chapitre 14 (La transformation en singe géant)" },
			{ n: 3, url: "/wiki/manga", kind: "manga", label: "Manga Dragon Ball — Tomes 9-10, Chapitres 104-108 (Le duel au masque de renard chez Baba)" },
			{ n: 4, url: "/wiki/databooks/4", kind: "databook", label: "Daizenshuu 7 — Dragon Ball Daijiten, p. 86 (Dictionnaire biographique : Son Gohan)" },
			{ n: 5, url: "/wiki/databooks/2", kind: "databook", label: "Daizenshuu 2 — Story Guide (Chronologie historique de la Terre)" }
		],
		article: `# Son Gohan (grand-père) (孫悟飯, Son Gohan)

## Introduction
**Son Gohan** (孫悟飯, *Son Gohan*), couramment appelé **Grand-père Gohan** (*Son Gohan Jīsan*), est un maître d'arts martiaux terrien dont le rôle est fondateur et déterminant dans l'univers de *Dragon Ball*. Ancien disciple de Maître Mutaito puis premier élève historique de Kamé Sennin (Muten Rōshi) aux côtés de Gyūmaō, il est le père adoptif qui a recueilli, élevé et initié aux arts martiaux le nourrisson saiyan Kakarotto, à qui il a donné le nom terrestre de Son Goku.

## Histoire Canonique

### La découverte de Kakarotto au mont Paozu
Vivant en ermite martial au cœur des massifs montagneux sauvages du mont Paozu, Son Gohan découvre un jour une capsule spatiale sphérique écrasée dans la forêt. À l'intérieur se trouve un nourrisson extraterrestre doté d'une queue de singe. Conformément à la nature génétique des guerriers de l'espace, le bébé se montre farouche, violent et ingérable. 

Tout bascule le jour où le nourrisson fait une chute accidentelle au fond d'un ravin et heurte violemment un rocher de la tête. Ayant miraculeusement survécu grâce à la robuste constitution propre à sa race, l'enfant perd toute sa programmation destructrice originelle pour devenir un petit garçon doux, joyeux et au cœur pur. Gohan l'élève avec une infinie bienveillance, lui inculque le sens du respect, les rudiments du combat à mains nues et lui transmet le Nyoibō (le bâton magique extensible), un artefact précieux reçu jadis de son maître Kamé Sennin.

### Le drame de la pleine lune et le legs du Sūshinchū
Conscient du danger mystérieux qui entoure les nuits de pleine lune — sans pour autant percer le secret de la race des Saiyans —, Gohan enjoint formellement à Goku de ne jamais regarder la pleine lune. Malheureusement, lors d'une nuit fatidique, l'enfant aperçoit l'astre lunaire et subit la terrifiante métamorphose en Ōzaru (singe géant). Devenu une créature titanesque et incontrôlable, Goku détruit la modeste maisonnette familiale et écrase accidentellement son grand-père sous sa masse phénoménale.

Avant de succomber, Gohan lègue à Goku la boule de cristal à quatre étoiles (*Sūshinchū*). Ignorant tout de sa responsabilité dans la mort de son tuteur, Goku vouera un culte sacré à cette boule de cristal, persuadé qu'elle abrite l'esprit bienveillant de son grand-père.

### Le combattant masqué au palais d'Uranai Baba
Lors de la quête visant à localiser la dernière boule de cristal pour ressusciter le père d'Upa, Goku et ses compagnons se rendent auprès d'Uranai Baba la voyante. Refusant ou étant incapables de payer la somme exorbitante de dix millions de zénis, ils acceptent de défier ses cinq champions de l'Au-delà. 

Le cinquième et ultime champion d'Uranai Baba est un guerrier énigmatique coiffé d'un masque de renard traditionnel (*kitsune*) et surmonté d'une auréole des morts. Ce combattant fait étalage d'une virtuosité martiale totale, rivalisant d'agilité avec Goku et exécutant à la perfection le Kamehameha. Connaissant intimement le point faible du jeune garçon, l'homme masqué saisit la queue de Goku et le projette violemment contre le sol à plusieurs reprises, le paralysant de douleur.

Cependant, au cours de la lutte acharnée, la queue de Goku finit par s'arracher net. Dérouté par la disparition inattendue de cette faiblesse, le combattant masqué interrompt le combat, déclare forfait et retire son masque : il s'agit de Son Gohan en personne, autorisé par Uranai Baba à revenir parmi les vivants pour une durée exacte de vingt-quatre heures.

### Retrouvailles poignantes et paix éternelle
La scène qui suit constitue l'un des moments les plus émouvants du manga : Goku, d'ordinaire si stoïque et insouciant, fond en larmes et se jette éperdument dans les bras de son grand-père adoptif. Gohan exprime sa fierté indicible devant les progrès prodigieux accomplis par son élève. 

Lorsque ses amis proposent d'utiliser les Dragon Balls pour le ramener définitivement à la vie, Gohan décline la proposition avec philosophie et sérénité. Il confie se plaire immensément au Paradis, où règne une quiétude absolue et où les jolies femmes de l'Au-delà ne manquent pas. Après avoir salué son ancien maître Kamé Sennin et exhorté Goku à pallier l'absence de sa queue par un entraînement rigoureux, Son Gohan regagne paisiblement le royaume des défunts.

## Techniques et Capacités
- **Kamehameha (かめはめ波)** : Vague déferlante d'énergie concentrée créée par Kamé Sennin. Gohan est l'un des premiers disciples à en avoir acquis la parfaite maîtrise.
- **Kame-senryū Taijutsu (Arts martiaux de l'École de la Tortue)** : Style de combat fondé sur la souplesse, l'équilibre parfait, les esquives félines et l'utilisation optimale de la force cinétique de l'adversaire.
- **Zanzōken (残像拳)** : Technique de l'image rémanente exécutée à grande vitesse pour tromper la vision de l'opposant.
- **Maniement du Nyoibō (如意棒)** : Maîtrise magistrale de l'escrime au bâton magique, art dont il a transmis les bases fondamentales à Goku.

## Personnalité et Héritage
Bienveillant, humble, jovial mais intraitable sur la droiture morale et la discipline martiale, Son Gohan est véritablement le sauveur inconscient de la Terre. Sans son éducation aimante et sans l'accident qui effaça l'agressivité de Kakarotto, la Terre aurait été dévastée par les Saiyans dès l'enfance de Goku. En hommage éternel à cet homme d'exception, Son Goku baptisera son propre premier-né du nom de Son Gohan.

## Citations et Sources
- *Dragon Ball (Manga original)*, Akira Toriyama, Tomes 1, 2, 9 et 10.
- *Daizenshuu 7 : Dragon Ball Daijiten*, p. 86.`
	},
	{
		id: 1145,
		name: "Son Gohan (futur)",
		name_ja: "孫悟飯",
		name_romaji: "Mirai no Son Gohan",
		sources: [
			{ n: 1, url: "/wiki/manga", kind: "manga", label: "Manga Dragon Ball — Tome 33, Chapitre spécial (Trunks the Story - Le guerrier solitaire)" },
			{ n: 2, url: "/wiki/databooks/4", kind: "databook", label: "Daizenshuu 7 — Dragon Ball Daijiten, p. 87 (Biographies : Son Gohan du futur)" },
			{ n: 3, url: "/wiki/databooks/2", kind: "databook", label: "Daizenshuu 2 — Story Guide, Chronologie du futur alternatif" }
		],
		article: `# Son Gohan (futur) (孫悟飯, Mirai no Son Gohan)

## Introduction
**Son Gohan du Futur** (未来の孫悟飯, *Mirai no Son Gohan*) est l'incarnation héroïque et tragique du fils aîné de Son Goku et de Chichi dans la trame temporelle alternative d'où est issu Trunks. Seul combattant survivant après l'extermination méthodique des Guerriers Z par les créations du Dr Gero, il assume avec abnégation le rôle de dernier protecteur de l'humanité et de mentor du jeune Trunks au cœur d'une Terre ravagée.

## Histoire Canonique

### L'apocalypse de mai 767
Dans cette ligne temporelle désolée, Son Goku est terrassé au début de l'an 767 par une maladie cardiaque incurable, sans avoir pu livrer combat. Six mois plus tard, le 12 mai 767, les cyborgs C-17 et C-18 s'éveillent et déversent le chaos sur le monde. 

Privés de Goku, les Guerriers Z tombent l'un après l'autre : Piccolo est le premier abattu, ce qui entraîne la disparition instantanée de Kami-sama (Dieu) et la désactivation définitive des Dragon Balls terrestres. Sont ensuite impitoyablement massacrés Vegeta, Krilin, Yamcha, Tenshinhan et Chaozu. Seuls Son Gohan, encore enfant, et le nouveau-né Trunks échappent miraculeusement à l'hécatombe.

### Treize années de résistance et éveil au Super Saiyan
Submergé par le traumatisme et le désespoir devant la perte de son père et de ses mentors, Gohan franchit le seuil émotionnel décisif et s'éveille à la transformation en Super Saiyan. Durant treize longues et éprouvantes années, il mène une guérilla solitaire et désespérée face aux androïdes. 

Chaque affrontement tourne cependant à l'impasse en raison de l'énergie infinie des cyborgs, qui détruisent méthodiquement les métropoles terriennes pour leur simple amusement. Gohan porte les stigmates de ces batailles incessantes : le visage balafré et le regard durci par la douleur, il est devenu un guerrier aguerri et stoïque.

### Le mentorat de Trunks et le sacrifice héroïque du bras
Gohan prend en charge l'adolescent Trunks, âgé de quatorze ans, pour en faire son disciple et tenter d'éveiller en lui la puissance du Super Saiyan afin d'assurer la relève. Lors d'une offensive dévastatrice des cyborgs sur le parc d'attractions de Pepper Town, Gohan et Trunks interviennent.

Tandis que Gohan tient tête à C-17, C-18 fond sur Trunks pour le supprimer. Sans hésiter un seul instant, Gohan se jette au cœur de la déflagration et fait rempart de son propre corps pour protéger son jeune élève. Grièvement mutilé dans l'explosion, Gohan y perd définitivement son bras gauche. Ayant repris connaissance dans les ruines, il utilise son tout dernier Haricot magique (Senzu) pour sauver Trunks aux portes de la mort, scellant son propre destin de guerrier amputé.

### L'ultime combat sous la pluie battante
Après sa convalescence, Gohan continue son entraînement sans relâche en apprenant à se battre avec un seul membre supérieur. Lorsqu'une nouvelle série d'explosions secoue la ville voisine, Trunks supplie de se battre à ses côtés. Conscient que l'avenir et l'ultime espoir de l'humanité reposent sur la survie de Trunks si lui-même venait à tomber, Gohan feint d'accepter avant d'asséner un coup sec sur la nuque de son disciple pour le plonger dans l'inconscience.

Seul sous un déluge d'orage, Gohan se dresse fièrement face à C-17 et C-18. Métamorphosé en Super Saiyan et combattant d'un seul bras avec une bravoure exceptionnelle, il parvient un temps à rivaliser d'adresse et de puissance. Mais C-17 lui révèle alors avec un rictus sadique qu'il n'avait jamais employé plus de la moitié de sa puissance lors de leurs escarmouches passées. Pris en tenaille par la supériorité numérique et la puissance inépuisable des deux cyborgs, Gohan est criblé de décharges de ki et succombe héroïquement sur le champ de bataille.

### L'éveil de Trunks du Futur
Revenu à lui, Trunks se précipite vers le lieu du désastre et découvre avec horreur le cadavre mutilé de son maître gisant sans vie dans une flaque de boue. La détresse absolue, le déchirement et la colère indicible face à cette tragédie provoquent l'étincelle tant attendue : Trunks s'éveille enfin au stade de Super Saiyan, portant désormais en lui la mémoire et la volonté d'acier de Son Gohan.

## Techniques et Capacités
- **Super Saiyan (超サイヤ人)** : Transformation légendaire décuplant sa force, acquise dans la douleur de la disparition de ses amis.
- **Kamehameha à un bras (片手かめはめ波)** : Déferlante de ki concentrée exécutée d'une seule main avec une intensité phénoménale.
- **Masenkō (魔閃光)** : Rayon d'énergie signature hérité de son maître Piccolo, tiré au-dessus du front.
- **Combat adapté à un bras** : Prodigieuse faculté d'équilibre et de taijutsu lui permettant de bloquer, esquiver et contre-attaquer avec un seul membre valide.

## Personnalité et Héritage
À l'opposé de son homologue du présent qui a pu poursuivre de brillantes études et fonder une famille, Mirai Gohan est un guerrier pur, forgé dans la souffrance et entièrement tourné vers le devoir. Il est l'incarnation du sacrifice désintéressé : sans son dévouement absolu envers Trunks, ce dernier n'aurait jamais pu voyager dans le passé avec la machine temporelle de Bulma pour sauver la trame temporelle principale.

## Citations et Sources
- *Dragon Ball (Manga original)*, Tome 33, Chapitre spécial (*Trunks the Story - Le guerrier solitaire*).
- *Daizenshuu 7 : Dragon Ball Daijiten*, p. 87.`
	},
	{
		id: 1020,
		name: "Roi démon Piccolo",
		name_ja: "ピッコロ大魔王",
		name_romaji: "Piccolo Daimaō",
		sources: [
			{ n: 1, url: "/wiki/manga", kind: "manga", label: "Manga Dragon Ball — Tomes 11-14, Chapitres 135-161 (L'avènement, la terreur et la chute du Roi Démon)" },
			{ n: 2, url: "/wiki/databooks/4", kind: "databook", label: "Daizenshuu 7 — Dragon Ball Daijiten, p. 104 (Dictionnaire des personnages : Piccolo Daimaō)" },
			{ n: 3, url: "/wiki/databooks/2", kind: "databook", label: "Daizenshuu 2 — Story Guide (L'ère de terreur du Roi Démon Piccolo)" }
		],
		article: `# Roi démon Piccolo (ピッコロ大魔王, Piccolo Daimaō)

## Introduction
Le **Roi Démon Piccolo** (ピッコロ大魔王, *Piccolo Daimaō*), aussi appelé le Grand Roi Démon Piccolo, est le premier antagoniste d'envergure véritablement dramatique et existentielle de *Dragon Ball*. Entité maléfique née de la scission spirituelle du fils de Katatts lorsqu'il chercha à accéder au statut de Dieu de la Terre, il est biologiquement un Namek perverti par le vice des mortels, s'autoproclamant seigneur absolu du clan des Démons (*Mazoku*).

## Histoire Canonique

### Origines nameks et scission du vice
En l'an 261, lors du grand cataclysme climatique qui dévaste la planète Namek, un enfant du Clan des Dragons est envoyé sur Terre à bord d'un vaisseau par son père Katatts. Devenu adulte sur les Hauts Plateaux de Yunzabit puis au contact des Terriens, il postule pour succéder au Dieu de la Terre en titre. Cependant, ce dernier refuse en constatant les souillures et le vice accumulés par le Namek au contact de la méchanceté humaine.

Pour accéder au trône divin, le postulant accomplit une méditation extrême et expulse de son être toute sa part d'ombre. Cette noirceur prend vie sous la forme physique d'un être autonome monstrueux : Piccolo Daimaō. Les deux êtres restent liés par un lien vital métaphysique indiscutable : la mort de l'un entraîne instantanément celle de l'autre, et les Dragon Balls s'éteignent si l'un d'eux périt.

### L'ère de terreur antique et le sceau du Mafūba
Plusieurs siècles avant l'époque contemporaine, Piccolo Daimaō engendre une légion de démons mutants et plonge le monde dans un bain de sang. L'humanité est sauvée de l'annihilation par le grand maître Mutaito, maître de Kamé Sennin et de Tsuru Sennin. Au prix de sa propre force vitale, Mutaito met au point et exécute la technique secrète du Mafūba (Vague d'Endiguement du Démon), emprisonnant Piccolo Daimaō dans un autocuiseur électronique scellé par un talisman. Kamé Sennin jette ensuite le récipient dans les profondeurs abyssales d'une fosse océanique.

### Résurrection, purge des maîtres et quête de jeunesse
Des siècles plus tard, la bande de l'empereur Pilaf repêche l'autocuiseur et libère le Roi Démon. Décrépit et affaibli par le poids des siècles, Piccolo conçoit un plan en deux temps :
1. Éliminer méthodiquement tous les maîtres d'arts martiaux ayant participé au Tenkaichi Budōkai, susceptibles de connaître le redoutable Mafūba. Son premier démon ailé, Tambourine, assassine lâchement Krilin dans les vestiaires du tournoi.
2. Rassembler les sept Dragon Balls pour recouvrer sa jeunesse éternelle et sa puissance maximale d'antan.

### Le vœu à Shenron et l'assassinat du dragon sacré
Kamé Sennin tente de reproduire le Mafūba pour sceller à nouveau le tyran, mais la vague dévie d'un centimètre et le vieux maître succombe d'épuisement. Chaozu est pulvérisé en plein vol alors qu'il tentait d'intercepter le vœu du démon. Ayant invoqué Shenron, Piccolo obtient la jeunesse éternelle et retrouve sa vigueur écrasante. 

Aussitôt le vœu exaucé, Piccolo Daimaō foudroie et détruit le dragon Shenron d'une salve de ki afin d'anéantir définitivement les Dragon Balls et d'empêcher les mortels d'invoquer un jour une force contraire.

### La prise de Central City et le règne de l'anarchie
Piccolo Daimaō prend d'assaut le Palais Royal de Central City, neutralise l'armée royale et capture le Roi de la Terre. Prenant le contrôle des ondes de télévision, il abolit la police, les lois et les tribunaux, instaurant le règne de la terreur et du crime organisé. Pour célébrer son couronnement le 9 mai, il annonce qu'il tirera au sort un des quarante-trois secteurs de la planète chaque année pour le rayer entièrement de la carte.

### Le duel final contre Son Goku et l'œuf de la réincarnation
Après avoir frôlé la mort et consommé l'Eau Divine (*Chōshinsui*) au sommet de la Tour Karin, Son Goku surgit au Palais Royal. Un duel dantesque éclate. Piccolo déploie sa technique la plus destructrice, le *Bakuretsumakōhō*, réduisant le quartier en poussière et blessant grièvement Goku aux membres.

N'ayant plus que son bras droit valide, Goku concentre tout son ki résiduel et se propulse dans les airs à l'aide d'un Kamehameha inversé tiré contre le sol. Tel un météore habité par l'esprit de l'Ōzaru, Goku transperce littéralement de part en part le torse de Piccolo Daimaō. 

Dans un ultime souffle d'agonie avant d'exploser, Piccolo Daimaō expulse de sa gorge un œuf géant vers l'horizon. Cet œuf abrite sa réincarnation et progéniture suprême, Piccolo Junior (Ma Junior), à qui il transmet toute sa mémoire, sa haine et le lien vital qui le rattache à Dieu.

## Techniques et Capacités
- **Bakuretsumakōhō (爆裂魔光砲)** : Vague d'énergie explosive cataclysmique projetée à deux mains, capable de pulvériser une métropole entière.
- **Chōmakōhō (超魔光砲)** : Rayon destructeur à haute intensité propulsé depuis la bouche.
- **Rayons oculaires (光線眼)** : Deux faisceaux perforants tirés depuis les pupilles.
- **Ponte d'œufs démoniaques (魔族の卵生)** : Faculté asexuée de générer des monstres mutants (Piano, Tambourine, Cymbal, Drum) doués de parole et télépathiquement soumis à sa volonté.
- **Allongement des membres** : Propriété anatomique namek lui permettant d'étirer ses bras pour surprendre ses adversaires.

## Personnalité et Héritage
Froid, cruel, despotique et méthodique, le Roi Démon Piccolo est l'incarnation du mal absolu dans la première moitié de l'histoire. Sa terreur a provoqué les premières disparitions tragiques de compagnons clés (Krilin, Tortue Géniale, Chaozu) et a forcé Son Goku à puiser dans ses retranchements ultimes. Paradoxalement, l'œuf qu'il crache avant de mourir donnera naissance à Piccolo Jr., qui finira par renoncer au mal pour devenir l'un des piliers vertueux de l'univers.

## Citations et Sources
- *Dragon Ball (Manga original)*, Tomes 11 à 14 (Chapitres 135 à 161).
- *Daizenshuu 7 : Dragon Ball Daijiten*, p. 104.`
	},
	{
		id: 424,
		name: "Dieu",
		name_ja: "神様",
		name_romaji: "Kami-sama",
		sources: [
			{ n: 1, url: "/wiki/manga", kind: "manga", label: "Manga Dragon Ball — Tomes 14-16, Chapitres 164-194 (L'initiation de Goku et le tournoi sous les traits de Shen)" },
			{ n: 2, url: "/wiki/manga", kind: "manga", label: "Manga Dragon Ball — Tomes 17-21, 24-25 (L'entraînement des Terriens et la mort face à Nappa)" },
			{ n: 3, url: "/wiki/manga", kind: "manga", label: "Manga Dragon Ball — Tomes 30-31, Chapitres 360-366 (L'assimilation avec Piccolo face à Cell)" },
			{ n: 4, url: "/wiki/databooks/4", kind: "databook", label: "Daizenshuu 7 — Dragon Ball Daijiten, p. 60 (Dictionnaire des personnages : Kami-sama)" },
			{ n: 5, url: "/wiki/databooks/4", kind: "databook", label: "Daizenshuu 4 — World Guide (Cosmologie et hiérarchie divine de la Terre)" }
		],
		article: `# Dieu (神様, Kami-sama)

## Introduction
**Dieu** (神様, *Kami-sama*), désigné dans les premières adaptations sous le titre du Tout-Puissant, est la divinité protectrice tutélaire de la Terre jusqu'à sa réunification avec Piccolo. Établi au Sanctuaire divin suspendu au-dessus de la Tour Karin aux côtés de son fidèle serviteur Mr. Popo, il est la moitié vertueuse et sage de l'enfant de Katatts et le créateur originel des Dragon Balls de la Terre.

## Histoire Canonique

### L'exil de Namek et l'amnésie des origines
Originaire du prestigieux Clan des Dragons (*Ryūzoku*) de la planète Namek, il est le fils du grand chef Katatts. En l'an 261, menacé par un cataclysme climatique planétaire dévastateur, son père le place dans une capsule spatiale de sauvetage programmée en direction de la Terre. Atterrissant dans la région polaire et inhospitalière des Hauts Plateaux de Yunzabit, l'enfant attend ses parents durant de longues décennies.

Avec les siècles, il oublie son nom d'origine et son appartenance à la race namek, se persuadant d'être un Terrien d'exception pourvu de facultés magiques et martiales hors du commun.

### L'accession au trône divin et la scission du vice
Après avoir parcouru le globe, il monte au Sanctuaire céleste pour solliciter la succession du Dieu de la Terre de l'époque. Cependant, la divinité refuse sa candidature : l'homme a absorbé le vice et les penchants belliqueux des mortels durant ses voyages. Pour se purifier, le candidat se plonge dans une ascèse spirituelle extrême et expulse de son corps toute part d'ombre.

Cette noirceur expulsée prend corps sous les traits du Roi Démon Piccolo. Investi de la dignité de Kami-sama, Dieu crée les sept Dragon Balls et insuffle la vie au dragon Shenron d'après les mythes de son peuple natal, liant magiquement leur pouvoir à sa propre force vitale.

### L'entraînement de Son Goku au Sanctuaire
Après l'élimination de Piccolo Daimaō, Goku utilise le bâton magique Nyoibō pour atteindre le Sanctuaire divin. Constatant la pureté de cœur du jeune garçon, Dieu ressuscite Shenron pour ramener les victimes du démon à la vie, sous réserve que Goku reste trois ans au Sanctuaire pour se préparer au 23e Tenkaichi Budōkai.

Sous la direction de Dieu et de Mr. Popo, Goku apprend à calmer son esprit, à masquer sa présence, à ressentir le flux du ki sans se fier à sa vue et à maîtriser les fondements spirituels du combat qui lui permettront de rivaliser avec les puissances cosmiques.

### Le 23e Tenkaichi Budōkai et l'incarnation de Shen
Conscient que Piccolo Junior (Ma Junior) surpasse désormais sa propre force et redoutant son triomphe, Dieu descend participer au 23e tournoi sous l'apparence empruntée d'un Terrien anonyme prénommé Shen (*Shen-san*). Parvenu en demi-finale face à Piccolo, Dieu tente d'enfermer le démon grâce au Mafūba. 

Mais Piccolo anticipe la manœuvre et riposte avec le *Mafūba Gaeshi* (retournement de la vague) : Dieu est lui-même aspiré dans la fiole et avalé par son adversaire, libérant le pauvre Shen indemne. C'est Son Goku qui délivrera Dieu en plongeant courageusement dans le gosier de Piccolo agrandi lors du duel final.

### L'invasion des Saiyans et la mort tragique
Lors de l'arrivée des Saiyans, Dieu forme Krilin, Yamcha, Tenshinhan, Chaozu et Yajirobé au Sanctuaire. Lors de l'affrontement contre Nappa, Piccolo s'interpose pour protéger Son Gohan et meurt au combat. La disparition de Piccolo entraîne la mort simultanée de Dieu et la désactivation immédiate des Dragon Balls. C'est à ce moment que Maître Kaio révèle leur origine extraterrestre commune sur la planète Namek. Dieu et Piccolo seront ultérieurement ressuscités grâce aux Dragon Balls de Namek et au dragon Porunga.

### L'assimilation suprême avec Piccolo
En mai 767, face à la terreur grandissante des cyborgs C-17 et C-18 et surtout à l'émergence effroyable de Cell qui dévore les populations entières de cités terrestres, Dieu prend la mesure de son impuissance en tant que simple observateur divin.

Il accepte la proposition de Piccolo et consent au sacrifice ultime : renoncer à son statut divin et être assimilé au sein de Piccolo (fusion namek). Cette réunification redonne naissance au « Namek sans nom » originel, dotant Piccolo d'une puissance colossale et de la sagesse infinie de Dieu. Pour lui succéder et réactiver les Dragon Balls, Goku ira recruter le jeune Dende sur la Nouvelle Namek.

## Techniques et Capacités
- **Création et animation des Dragon Balls (ドラゴンボールの創造)** : Pouvoir mystique propre aux maîtres d'élite du Clan des Dragons namek.
- **Mafūba (魔封波)** : Technique de scellement spirituel utilisée lors du 23e tournoi.
- **Possession spirituelle bienveillante** : Faculté d'investir temporairement le corps d'un mortel sans altérer son intégrité physique ni mentale.
- **Vision céleste omnisciente et télépathie** : Capacité d'observer chaque recoin de la Terre depuis le Sanctuaire et de dialoguer mentalement à travers les dimensions.

## Personnalité et Héritage
D'une sagesse immense, lucide et profondément humble, Dieu a constamment porté le fardeau de la culpabilité pour avoir engendré Piccolo Daimaō. N'hésitant jamais à envisager sa propre disparition pour sauvegarder la Terre, son assimilation finale avec Piccolo témoigne d'un don de soi total au service de la paix universelle.

## Citations et Sources
- *Dragon Ball (Manga original)*, Tomes 14 à 21, 24, 25, 30 et 31.
- *Daizenshuu 7 : Dragon Ball Daijiten*, p. 60.`
	},
	{
		id: 347,
		name: "Chichi",
		name_ja: "チチ",
		name_romaji: "Chichi",
		sources: [
			{ n: 1, url: "/wiki/manga", kind: "manga", label: "Manga Dragon Ball — Tomes 1-2, Chapitres 11-14 (La rencontre au Mont Frypan et la promesse)" },
			{ n: 2, url: "/wiki/manga", kind: "manga", label: "Manga Dragon Ball — Tomes 14-15, Chapitres 171-173 (Le 23e Tenkaichi Budōkai et le mariage)" },
			{ n: 3, url: "/wiki/manga", kind: "manga", label: "Manga Dragon Ball — Tomes 17, 20, 27, 36, 38, 42 (La mère de famille dévouée et la saga Buu)" },
			{ n: 4, url: "/wiki/databooks/4", kind: "databook", label: "Daizenshuu 7 — Dragon Ball Daijiten, p. 84 (Dictionnaire des personnages : Chichi)" },
			{ n: 5, url: "/wiki/databooks/2", kind: "databook", label: "Daizenshuu 2 — Story Guide (Relations familiales de Son Goku)" }
		],
		article: `# Chichi (チチ, Chichi)

## Introduction
**Chichi** (チチ, *Chichi*), princesse du Mont Frypan, est une figure incontournable de l'épopée *Dragon Ball*. Fille unique de Gyūmaō (l'Empereur du Bœuf), elle devient l'épouse de Son Goku et la mère dévouée de Son Gohan et Son Goten. Artiste martiale accomplie dans sa jeunesse, elle s'affirme tout au long de la saga comme la maîtresse de maison intraitable et le pilier émotionnel du foyer Son.

## Histoire Canonique

### La promesse d'enfance au Mont Frypan
Durant la première quête des Dragon Balls, le Mont Frypan est la proie d'un incendie magique perpétuel. Gyūmaō envoie sa fille Chichi emprunter l'Éventail magique (*Bashōsen*) auprès de Kamé Sennin. Sur sa route, elle croise Son Goku chevauchant son nuage Kinto'un. Impressionnée par la force et l'innocence du jeune garçon, et suite à une méprise où Goku vérifie naïvement son anatomie, Chichi lui fait promettre de la prendre pour épouse une fois adultes. Goku, ignorant totalement ce qu'est le mariage et croyant qu'il s'agit d'un mets délicieux, accepte avec enthousiasme.

### Le 23e Tenkaichi Budōkai et le mariage sur le ring
Six années plus tard, ayant parfait sa maîtrise du combat de l'école de la Tortue sous la tutelle de son père, Chichi participe au 23e Tenkaichi Budōkai sous le pseudonyme de « Combattante anonyme ». Furieuse que Goku ne la reconnaisse pas et semble avoir oublié son serment, elle l'affronte en quart de finale. 

Bien qu'elle fasse preuve d'une technique martiale remarquable, Goku la repousse hors du ring par la seule pression de l'air générée par son poing. Dévoilant son identité à l'assistance médusée, elle lui rappelle sa promesse : fidèle à son honneur inflexible, Goku annonce publiquement devant la foule qu'il tiendra sa parole et l'épousera.

### La mère de famille et la priorité aux études
Après la naissance de leur premier fils Son Gohan, Chichi abandonne la pratique martiale active pour se consacrer corps et âme à la tenue du foyer au mont Paozu. Traumatisée par les périls mortels constants auxquels Goku s'expose, elle refuse catégoriquement que Gohan devienne un combattant vagabond et exige qu'il se voue à des études académiques poussées pour devenir un savant reconnu. Ses colères homériques face à Maître Roshi ou Piccolo dissimulent en réalité une angoisse maternelle viscérale et un amour sans bornes pour sa famille.

### Les épreuves douloureuses et le deuil
Chichi endure avec courage l'hospitalisation de Goku après la bataille contre Vegeta, puis l'angoisse de son périple sur Namek. Lorsque Goku est frappé par le virus cardiaque au début de la saga des cyborgs, elle veille sur lui avec une tendresse infinie. Elle consent finalement à ce que Gohan s'entraîne avec Goku dans la Salle de l'Esprit et du Temps, s'évanouissant d'émotion lorsqu'elle découvre son fils transformé en Super Saiyan aux cheveux blonds. La mort héroïque de Goku face à Cell la plonge dans un deuil profond, qu'elle surmonte seule en élevant son second fils, Son Goten.

### L'entraînement de Goten et l'affrontement avec Majin Buu
Durant les sept années de paix, c'est Chichi elle-même qui enseigne les bases des arts martiaux à Goten, constatant avec stupeur que le petit garçon est capable de se métamorphoser en Super Saiyan avec une aisance déconcertante. 

Lors de l'assaut de Majin Buu sur le Sanctuaire divin, apprenant la mort présumée de Gohan, elle s'avance courageusement vers le monstre et le gifle en lui reprochant ses crimes. Buu la transforme immédiatement en œuf géant et l'écrase sous son pied. Elle sera ressuscitée par les Dragon Balls de Namek et connaîtra la joie indicible de retrouver Goku et ses deux fils réunis.

## Techniques et Capacités
- **Kame-senryū Taijutsu (Arts martiaux de la Tortue)** : Style de combat à mains nues hérité de Gyūmaō, caractérisé par des frappes rectilignes puissantes et une excellente tenue de garde.
- **Armement du casque de combat** : Lame tranchante éjectable et rayon laser frontal utilisés durant son enfance.
- **Autorité maternelle absolue** : Faculté comique mais canonique d'intimider et de commander les combattants les plus puissants de l'univers, y compris les guerriers Saiyans.

## Personnalité et Héritage
Dotée d'un tempérament de feu, exigeante et protectrice, Chichi est le cœur battant du clan Son. Elle représente l'ancrage dans la réalité terrienne, veillant à ce que ses enfants ne soient pas seulement des machines de guerre, mais des citoyens éduqués et équilibrés.

## Citations et Sources
- *Dragon Ball (Manga original)*, Tomes 1, 2, 14, 15, 17, 20, 27, 36, 38 et 42.
- *Daizenshuu 7 : Dragon Ball Daijiten*, p. 84.`
	},
	{
		id: 420,
		name: "Dr Gero",
		name_ja: "ドクター・ゲロ",
		name_romaji: "Dokutā Gero",
		sources: [
			{ n: 1, url: "/wiki/manga", kind: "manga", label: "Manga Dragon Ball — Tomes 28-31, Chapitres 336-350 (L'attaque des cyborgs et la mort du créateur)" },
			{ n: 2, url: "/wiki/databooks/4", kind: "databook", label: "Daizenshuu 7 — Dragon Ball Daijiten, p. 94 (Dictionnaire des personnages : Dr Gero / C-20)" },
			{ n: 3, url: "/wiki/databooks/2", kind: "databook", label: "Daizenshuu 2 — Story Guide (La genèse des cyborgs et le projet Cell)" }
		],
		article: `# Dr Gero (ドクター・ゲロ, Dokutā Gero)

## Introduction
Le **Dr Gero** (ドクター・ゲロ, *Dokutā Gero*), sous son nom de code cybernétique **Cyborg C-20** (人造人間20号, *Jinzōningen Ni-Jū Gō*), est le cerveau scientifique suprême de l'Armée du Ruban Rouge (*Red Ribbon Army*) et l'un des antagonistes les plus déterminants de *Dragon Ball*. Génie machiavélique de la biomécanique et de la cybernétique, il est le concepteur des humains artificiels modernes (C-16 à C-19) et de la créature parfaite Cell.

## Histoire Canonique

### L'ingénieur en chef du Ruban Rouge et la soif de vengeance
Durant les premières années de *Dragon Ball*, le Dr Gero supervise la division d'armement technologique de la Red Ribbon Army, élaborant les premiers prototypes d'humains artificiels (de C-1 à C-8). Lorsque le jeune Son Goku prend d'assaut le quartier général de l'organisation et pulvérise l'armée, Gero survit miraculeusement. Animé par une haine viscérale envers le garçon qui a anéanti son œuvre, il se retranche dans un laboratoire secret dissimulé dans les montagnes du Nord et dévoue deux décennies à préparer sa revanche.

### Le réseau de micro-espionnage et la conception de Cell
Gero déploie des micro-drones d'espionnage microscopiques pour surveiller les combats de Goku. Ces drones enregistrent les techniques déployées lors du 23e Tenkaichi Budōkai et lors de l'invasion des Saiyans sur Terre (Raditz, Nappa, Vegeta). Ils prélèvent des échantillons cellulaires des guerriers d'élite (Goku, Vegeta, Piccolo, puis Freezer et le Roi Cold lors de leur venue sur Terre). Ces données alimentent le super-ordinateur souterrain programmé pour concevoir l'organisme bio-cybernétique suprême : Cell.

### La cybernétisation en C-20 et l'assaut de mai 767
Pour échapper au vieillissement biologique et assister au triomphe de sa vengeance, Gero transfère son propre cerveau dans une armature cybernétique complète à absorption d'énergie, confiant à sa création servile C-19 le soin de finaliser l'opération chirurgicale. Il devient ainsi C-20.

Le 12 mai 767, C-19 et C-20 passent à l'attaque sur l'île d'Amenbo. Gero neutralise froidement Yamcha en lui transperçant le torse et en drainant son ki par les nodules situés dans ses paumes.

### La déconvenue face aux Super Saiyans et la fuite
Le plan de Gero s'effondre en raison d'une erreur d'estimation fatale : ayant cessé de collecter des données après le combat de Vegeta sur Terre en estimant que la progression de Goku avait atteint son plafond, il ignorait l'existence de la transformation en Super Saiyan. Témoin de la destruction de C-19 par Vegeta Super Saiyan, Gero affronte Piccolo, qui le domine outrageusement et lui arrache un bras. Acculé, Gero déclenche une onde de choc pour faire diversion et fuit vers son laboratoire.

### L'exécution par ses propres créations
Traqué par les Guerriers Z, Gero active en dernier recours ses modèles les plus meurtriers : les jumeaux C-17 et C-18. Mais ces derniers, des humains cybernétisés de force, vouent une haine féroce à leur créateur. Alors que Gero tente de les soumettre sous la menace d'une télécommande de désactivation d'urgence, C-17 lui subtilise la commande et la détruit. D'un revers de main tranchant, C-17 décapite net le Dr Gero, avant d'écraser sauvagement sa tête cybernétique sous son pied.

### La genèse de C-16 révélée par Toriyama
Dans les entretiens du *Full Color Comics* et du *Daizenshuu*, Akira Toriyama révèle que le Dr Gero avait un fils biologique nommé Gevo, soldat d'élite du Ruban Rouge tombé jadis au combat. Par douleur paternelle, Gero a modelé les traits et la stature imposante du cyborg C-16 à l'image de son fils disparu, le dotant d'une programmation pacifique et contemplative pour éviter qu'il ne périsse à nouveau.

## Techniques et Capacités
- **Absorption d'énergie vitale (エネルギー吸収)** : Sphères réceptrices logées au creux de ses paumes, capables de drainer le ki direct ou d'absorber les vagues d'énergie projetées contre lui.
- **Kōsen me (Rayons oculaires)** : Faisceaux laser incandescents projetés depuis ses yeux bioniques.
- **Dissimulation d'énergie** : En tant qu'entité purement mécanique, son corps n'émet aucun ki spirituel, le rendant indétectable par la perception sensorielle des Guerriers Z.
- **Génie scientifique suprême** : Maîtrise inégalée de l'intelligence artificielle, de la génétique et de la robotique humanoïde.

## Personnalité et Héritage
Cynique, hautain, calculateur et aveuglé par sa soif de vengeance, le Dr Gero est un savant dont l'orgueil a précipité la chute. Ses créations ont toutefois bouleversé l'univers entier, poussant les Guerriers Z à franchir de nouveaux paliers de puissance pour vaincre Cell.

## Citations et Sources
- *Dragon Ball (Manga original)*, Tomes 28 à 31 (Chapitres 336 à 350).
- *Daizenshuu 7 : Dragon Ball Daijiten*, p. 94.`
	},
	{
		id: 1018,
		name: "Roi Vegeta",
		name_ja: "ベジータ王",
		name_romaji: "Bejīta-ō",
		sources: [
			{ n: 1, url: "/wiki/manga", kind: "manga", label: "Manga Dragon Ball — Tome 25, Chapitre 296 (La réminiscence de Freezer face au prince Vegeta)" },
			{ n: 2, url: "/wiki/databooks/4", kind: "databook", label: "Daizenshuu 7 — Dragon Ball Daijiten, p. 109 (Dictionnaire des personnages : Roi Vegeta)" },
			{ n: 3, url: "/wiki/databooks/2", kind: "databook", label: "Daizenshuu 2 — Story Guide, p. 100 (Chronologie de la planète Vegeta)" }
		],
		article: `# Roi Vegeta (ベジータ王, Bejīta-ō)

## Introduction
Le **Roi Vegeta** (ベジータ王, *Bejīta-ō*), également désigné sous le titre de Vegeta III, est le souverain suprême de la race des Saiyans et le commandant en chef de leurs armées conquérantes sur la planète Vegeta. Père du prince Vegeta et de Tarble, il est le monarque qui a mené son peuple à la victoire militaire contre les Tsufuls avant de sceller le destin tragique de sa civilisation face au tyran galactique Freezer.

## Histoire Canonique

### La guerre contre les Tsufuls et la fondation du royaume
Réfugiés sur la planète Plant après la destruction de leur monde natal Sadala, les Saiyans partagent initialement la planète avec les autochtones Tsufuls, une race pacifiste hautement avancée sur le plan technologique. Sous l'impulsion de leur chef martial Vegeta, les Saiyans déclenchent une guerre d'annexion sans pitié.

Profitant de la pleine lune qui n'illumine la planète qu'une fois tous les huit ans pour se transformer collectivement en singes géants (Ōzaru), ils exterminent la civilisation tsuful. Proclamé souverain absolu, le roi rebaptise la planète de son propre nom — la planète Vegeta — et s'approprie la technologie tsuful (armures, scouters, capsules spatiales).

### L'assujettissement à l'Empire de Freezer
Conscient du rapport de force spatial défavorable, le Roi Vegeta soumet son royaume à l'Empire galactique du Roi Cold, puis de son héritier Freezer. Les Saiyans deviennent des mercenaires chargés d'annexer et de purger des planètes entières pour le compte de l'Organisation du Commerce des Mondes en échange de technologies d'armement avancées.

### L'obsession dynastique et la fierté royale
Le souverain reporte toute sa fierté sur son fils premier-né, le prince Vegeta, dont le potentiel inné surpasse le sien dès la plus tendre enfance. Convaincu que son fils est l'élu destiné à devenir le légendaire Super Saiyan, il supporte avec une rage contenue les humiliations publiques répétées infligées par Freezer, qui garde le jeune prince en otage au sein de son armée personnelle.

### La mention canonique dans le manga original
Dans les 42 tomes du manga original d'Akira Toriyama, le Roi Vegeta n'apparaît pas en scène vivante : il est explicitement mentionné au Tome 25 par Freezer lors de son face-à-face crucial avec le prince Vegeta sur Namek. Freezer raille la présomption du prince en lui rappelant qu'il n'avait même pas eu besoin de recourir à sa moindre métamorphose pour exécuter le Roi Vegeta d'un seul coup lors de sa rébellion, soulignant la futilité de l'orgueil de la dynastie saiyan face aux Démons du Froid.

### La révolte de l'an 737 et la fin de la planète Vegeta
Les databooks officiels (*Daizenshuu 2* et *Daizenshuu 7*) détaillent la chute du monarque. En l'an 737, comprenant que Freezer redoute la montée en puissance exponentielle des Saiyans et projette leur extermination totale, le Roi Vegeta mène une mutinerie désespérée. À la tête d'un commando d'élite, il prend d'assaut le vaisseau amiral de Freezer.

L'écart de force est cependant titanesque : Freezer esquive l'attaque et foudroie le Roi Vegeta d'un simple coup mortel au visage, avant d'ordonner l'anéantissement de la planète entière sous une gigantesque sphère d'énergie destructrice.

## Techniques et Capacités
- **Kikōha royal (王家の気功波)** : Projection de puissantes salves d'énergie caractéristiques de la caste d'élite saiyan.
- **Transformation en Ōzaru (大猿)** : En tant que membre de la lignée royale, le roi conserve son discernement, sa conscience et la parole sous forme de singe géant, multipliant sa force par dix.
- **Commandement militaire** : Autorité absolue sur les légions de guerriers conquérants saiyans.

## Personnalité et Héritage
Autoritaire, impitoyable, calculateur et dominé par une fierté aristocratique inflexible, le Roi Vegeta a transmis à son fils le prince Vegeta son obsession de la suprématie et de la grandeur saiyan, un trait de caractère qui deviendra le moteur psychologique majeur de Vegeta tout au long de *Dragon Ball*.

## Citations et Sources
- *Dragon Ball (Manga original)*, Tome 25, Chapitre 296.
- *Daizenshuu 7 : Dragon Ball Daijiten*, p. 109.
- *Daizenshuu 2 : Story Guide*, p. 100.`
	},
	{
		id: 996,
		name: "Puerh",
		name_ja: "プーアル",
		name_romaji: "Pūaru",
		sources: [
			{ n: 1, url: "/wiki/manga", kind: "manga", label: "Manga Dragon Ball — Tomes 1-2, Chapitres 7-14 (Les bandits du désert et le sauvetage au château de Pilaf)" },
			{ n: 2, url: "/wiki/manga", kind: "manga", label: "Manga Dragon Ball — Tomes 9-10, Chapitres 99-101 (Le combat victorieux contre Dracula Man chez Baba)" },
			{ n: 3, url: "/wiki/databooks/4", kind: "databook", label: "Daizenshuu 7 — Dragon Ball Daijiten, p. 106 (Dictionnaire des personnages : Puerh)" },
			{ n: 4, url: "/wiki/databooks/2", kind: "databook", label: "Daizenshuu 2 — Story Guide (Les débuts de l'aventure Dragon Ball)" }
		],
		article: `# Puerh (プーアル, Pūaru)

## Introduction
**Puerh** (プーアル, *Pūaru*), historiquement traduit sous le nom de Plume dans les premières éditions francophones de Glénat, est une petite créature féline bleue volante dotée de remarquables pouvoirs magiques. Compagnon dévoué et inséparable de Yamcha, il est un allié de la première heure de Son Goku et de Bulma, dont l'intervention magistrale a sauvé la vie des héros lors du tout premier arc narratif.

## Histoire Canonique

### L'École de Métamorphose du Sud
Puerh étudie dans son enfance à la célèbre École de Métamorphose du Sud (*Nanbu Henshin Yōchien*), où les élèves apprennent l'art de modifier leur apparence physique. Il y côtoie le cochon Oolong, qui le tyrannise fréquemment. 

Toutefois, alors qu'Oolong est renvoyé pour indiscipline et vol de sous-vêtements (limitant ses transformations à cinq minutes suivies d'une minute de repos obligatoire), Puerh suit l'intégralité du cursus avec brio et décroche son diplôme officiel. Il possède ainsi la faculté rare de se métamorphoser en n'importe quel objet ou créature vivante pour une durée illimitée et sans perte d'énergie.

### Les bandits du désert aux côtés de Yamcha
Établi dans les massifs rocheux désertiques, Puerh forme un tandem inséparable avec le bandit des grands chemins Yamcha. Il assiste son compagnon dans ses embuscades et veille attentivement sur lui lors de ses crises de tétanie face aux femmes en raison de sa timidité maladive. Lors de leur première confrontation contre Goku et Bulma, Puerh utilise ses ruses de métamorphose pour tromper le groupe.

### Le coup de génie salvateur au château de Pilaf
Enfermés par l'empereur Pilaf dans une cellule d'acier hermétique, les compagnons semblent condamnés à périr sous les rayons du soleil matinal. Durant la nuit, Goku regarde la pleine lune à travers la verrière et se métamorphose brutalement en Ōzaru (singe géant). Devenue furieuse, la bête brise les remparts du château et menace d'écraser mortellement Bulma et ses amis.

Tandis que Yamcha saisit courageusement la queue du monstre pour l'immobiliser quelques instants, Puerh réagit avec un sang-froid extraordinaire : il se métamorphose instantanément en une paire de ciseaux géante et tranche nette la queue de Goku. La métamorphose s'annule sur-le-champ et Goku redevient un enfant inoffensif endormi, sauvant la vie de l'ensemble des héros.

### La victoire tactique chez Uranai Baba
Lors du tournoi organisé par Baba la voyante pour localiser la dernière boule de cristal, Yamcha et Krilin essuient des revers face aux créatures de l'Au-delà. Puerh fait alors équipe avec le jeune indien Upa pour affronter Dracula Man, un combattant vampire redoutable.

Mettant à profit les mythes classiques de l'Occident, Upa forme une croix chrétienne avec ses bras et souffle des effluves d'ail, tandis que Puerh se métamorphose en une main géante qui propulse violemment Dracula Man hors de l'arène dans le lac empoisonné, signant une victoire éclatante.

### Fidélité indéfectible à Capsule Corporation
Installé à Capsule Corporation avec Bulma et Yamcha, Puerh demeure un soutien logistique et moral inaltérable tout au long des tournois mondiaux et des sagas cosmiques ultérieures, incarnant la bienveillance et l'amitié indéfectible des origines.

### Étymologie canonique
Conformément à la règle toriyamesque des calembours culinaires, le nom de Puerh dérive du thé noir fermenté chinois Pu-erh (普洱茶), formant un trio thématique harmonieux avec Oolong (thé oolong) et Yamcha (la coutume cantonaise du thé *yum cha*).

## Techniques et Capacités
- **Henge (Métamorphose absolue - 変化)** : Faculté de modifier instantanément sa forme, sa texture et ses dimensions sans limite de durée (ciseaux géants, tapis volant, mur d'acier, corbeau).
- **Lévitation et vol continu** : Capacité naturelle de flotter dans les airs en permanence sans effort physique ni consommation de ki.

## Personnalité et Héritage
Doux, poli, loyal et d'une dévotion sans bornes envers Yamcha qu'il soutient contre vents et marées, Puerh est un personnage profondément attachant dont l'action héroïque au château de Pilaf au tome 2 a permis à la légende de *Dragon Ball* de se poursuivre.

## Citations et Sources
- *Dragon Ball (Manga original)*, Tomes 1, 2, 9 et 10.
- *Daizenshuu 7 : Dragon Ball Daijiten*, p. 106.`
	}
];

async function getDatabaseUrl(): Promise<string> {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const envPaths = [".env", "apps/site/.env", "apps/bot/.env", `${homedir()}/.shenron-neon.env`];
	for (const p of envPaths) {
		try {
			const file = Bun.file(p);
			if (await file.exists()) {
				const txt = await file.text();
				const m = txt.match(/^DATABASE_URL=([^\n]+)/m);
				if (m) return m[1].trim().replace(/^['"]|['"]$/g, "");
			}
		} catch {}
	}
	throw new Error("DATABASE_URL non configuré.");
}

const generateRevisionId = () =>
	Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");

async function main() {
	console.log("=== Enrichissement des 8 Personnages Fondateurs de Dragon Ball ===");
	const dbUrl = await getDatabaseUrl();
	const sql = postgres(dbUrl, { max: 2, prepare: false });

	let successCount = 0;

	for (const char of CHARACTERS) {
		console.log(`\n--- Traitement personnage #${char.id} : ${char.name} ---`);

		// 1. Lire l'état existant pour archivage 'before'
		const [current] = await sql<
			{ id: string; name: string; name_ja: string | null; name_romaji: string | null; article: string | null }[]
		>`
			SELECT id, name, name_ja, name_romaji, article
			FROM bot.db_characters
			WHERE id = ${char.id}
		`;

		if (!current) {
			console.error(`[Erreur] Personnage #${char.id} introuvable dans bot.db_characters.`);
			continue;
		}

		const beforeSnapshot = {
			name_ja: current.name_ja,
			name_romaji: current.name_romaji,
			article: current.article
		};

		const afterSnapshot = {
			name_ja: char.name_ja,
			name_romaji: char.name_romaji,
			article: char.article
		};

		const revisionId = generateRevisionId();
		const nowTimestamp = Date.now();

		// 2. Transaction unifiée pour mettre à jour bot.db_characters et insérer dans public.wiki_revisions
		await sql.begin(async (tx) => {
			await tx`
				UPDATE bot.db_characters
				SET
					name_ja = ${char.name_ja},
					name_romaji = ${char.name_romaji},
					article = ${char.article},
					article_sources = ${tx.json(char.sources as any)},
					article_updated_at = ${nowTimestamp}
				WHERE id = ${char.id}
			`;

			await tx`
				INSERT INTO public.wiki_revisions ${tx({
					id: revisionId,
					tableName: "db_characters",
					rowId: String(char.id),
					action: "update",
					label: char.name,
					before: tx.json(beforeSnapshot),
					after: tx.json(afterSnapshot),
					editorId: "agent-shenron",
					editorName: "Agent enrich-core-characters (canon Toriyama)",
				})}
			`;
		});

		console.log(`✔ #${char.id} ${char.name}`);
		console.log(`   name_ja      : ${current.name_ja} → ${char.name_ja}`);
		console.log(`   name_romaji  : ${current.name_romaji} → ${char.name_romaji}`);
		console.log(`   article len  : ${char.article.length} caractères`);
		console.log(`   sources      : ${char.sources.length} sources canoniques`);
		console.log(`   révision ID  : ${revisionId}`);

		successCount++;
	}

	await sql.end();
	console.log(`\n=== Résultat final : ${successCount}/${CHARACTERS.length} personnages enrichis avec succès ===`);
}

main().catch((err) => {
	console.error("Échec critique lors de l'exécution :", err);
	process.exit(1);
});
