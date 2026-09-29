import { writeFileSync } from "node:fs";

// Mapping des 32 planches vers leurs traductions fidèles en français de haute précision
interface TranslationEntry {
	databookId: number;
	page: number;
	text_fr: string;
}

const translations: TranslationEntry[] = [
	// === Databook #76 (V-Jump Août 1994) ===
	{
		databookId: 76,
		page: 1,
		text_fr: `V-Jump
Numéro d'août 1994
Prix fixe : 450 yens (taxes incluses)

Couverture Dragon Ball Z
Contient le grand dossier estival sur les jeux vidéo et mangas sérialisés !`
	},
	{
		databookId: 76,
		page: 2,
		text_fr: `Dragon Ball Z : Super Butôden 3
Dossier exclusif Super Famicom !

Découvrez en avant-première les nouveaux combattants de la saga Majin Buu qui rejoignent l'arène dans ce troisième volet explosif sur SFC !`
	},
	{
		databookId: 76,
		page: 3,
		text_fr: `Présentation des nouveaux personnages de Super Butôden 3 :
Son Goten, Trunks enfant et Majin Vegeta entrent dans la bataille avec des techniques surpuissantes fidèles à l'œuvre originale !`
	},
	{
		databookId: 76,
		page: 4,
		text_fr: `Les coulisses du développement et les commandes secrètes de Super Butôden 3 !
Retrouvez les fiches techniques des coups spéciaux et les astuces pour maîtriser les combats aériens à haute vitesse.`
	},

	// === Databook #77 (V-Jump Septembre 1994) ===
	{
		databookId: 77,
		page: 1,
		text_fr: `# V-Jump

Numéro de septembre 1994
Prix fixe : 450 yens (taxes incluses)

Supplément spécial :
Grand dossier complet sur les deux grands jeux vidéo de cet été !!

Dr. Slump
Bakuen Campus Guardress
Haô Taikei Ryû Knight
GO! GO! ACKMAN

SLAM DUNK
Ruin Arm / Virtua Fighter / Tactics Ogre
Yû Yû Hakusho

Dragon Quest Comic : Les Aventures de Slime
Final Fantasy Comic : Choco Choco Bonbon
Inu Mayuge Téikô

Publié le 1er septembre 1994 (mensuel). Volume 2, numéro 9 (15e numéro cumulé).`
	},
	{
		databookId: 77,
		page: 3,
		text_fr: `# L'homme est de retour !!

Abandonnant le monde de la quiétude,
Il retourne une fois encore sur la plaine des guerriers,
Sur la scène du combat.

● L'affrontement contre Super Vegeta dépasse l'œuvre originale et prend vie sous nos yeux !

Le guerrier de la justice, Son Goku. Cet homme qui mène de nouveau le combat sur la scène de « Super Butôden 3 »... Le jour où la légende devient réalité est proche !

La légende de Son Goku

Non pas par ambition...
Ni même pour la victoire...

Kamehameha !

Mais pour se mesurer
À des adversaires toujours plus puissants !

● Quels combats attendent ce Goku qui a grandi avec tant de force et de vaillance ?`
	},
	{
		databookId: 77,
		page: 4,
		text_fr: `La vague déferlante !!

Pour faire vibrer son âme brûlante...
Pour dialoguer à coups de poings...

Le guerrier de la justice, Son Goku. Cet homme qui s'engage une fois de plus dans la bataille sur la scène de « Super Butôden 3 »...
Le jour où la légende devient réalité est proche !

Oui,
Tout cela uniquement pour le combat.

※ Quels affrontements attendent cette légende qui a grandi avec force ?

Le combat après le retour du guerrier...
C'était bien ainsi !`
	},
	{
		databookId: 77,
		page: 5,
		text_fr: `# Rassemblement des combattants d'élite sous une seule bannière !
## Et ainsi commence une toute nouvelle légende...

# La légende nommée « Super Butôden »...

## Vegeta

« Je vais régler nos comptes une bonne fois pour toutes !! »

Allant jusqu'à utiliser le pouvoir maléfique pour surpasser Goku,
Ce guerrier à la fierté inébranlable, Vegeta,
Mise toute sa carrière de combattant dans ce super duel contre Goku !!

## Trunks

« Je vais tester ta véritable force, tonton ! »

Bénéficiant de l'entraînement rigoureux de son père,
Ce jeune guerrier, Trunks, possède des talents de combat prodigieux.
Sa manière de se battre contre Goku ressemble-t-elle à celle de son père ?!

## C-18

Numéro 18 :
« Je participe à ce tournoi comme un investissement. »`
	},

	// === Databook #80 (V-Jump Décembre 1994) ===
	{
		databookId: 80,
		page: 1,
		text_fr: `V-Jump

Numéro de décembre 1994
Prix fixe : 450 yens (taxes incluses)

Dragon Ball Z
SLAM DUNK
Tactics Ogre
Yû Yû Hakusho

Les 7 grands mangas sérialisés d'une puissance saisissante !!

Dr. Slump
GO! GO! ACKMAN
Bakuen Campus Guardress
Haô Taikei Ryû Knight / Dragon Quest : Les Aventures de Slime
Final Fantasy Comic : Choco Choco Bonbon
Inu Mayuge Téikô

Le super chef-d'œuvre RPG qui fait sensation !!
Chrono Trigger

Avec un poster exclusif dessiné par Akira Toriyama !

Bientôt disponible !
Supplément séparé : grand dossier d'urgence sur les jeux à venir !`
	},
	{
		databookId: 80,
		page: 2,
		text_fr: `Commémoration du 10e anniversaire de la sérialisation
Super Information — 1er volet !!

DRAGON BALL Z
Versions Super Famicom & Game Boy
Toutes les dernières informations !!!

10 gagnants tirés au sort !!!
Fourni par Forte.

Grand cadeau : le CD musical de Dragon Ball Z Super Butôden 3 !!

Soyez fasciné, vous aussi !!
Pour fêter le succès retentissant du jeu, nous offrons le CD original de « Butôden 3 ».

Adresse pour participer : 集英社 V-Jump, numéro de décembre, section « Envoyez-moi le superbe CD DBZ ! ».
Commentaire de Dragon Suzuki : « Salut ! Ce CD est tellement réussi qu'il vous laissera sans voix, tentez absolument votre chance ! »`
	},
	{
		databookId: 80,
		page: 3,
		text_fr: `# Une première sur SFC ! Une aventure en deux parties (Première et Seconde Parties)

## Les scènes de combat
Du manga original à l'animation télévisée, puis aux jeux vidéo : les personnages transposent leur terrain de jeu. Reproduits fidèlement à partir de multiples planches d'animation, ils offrent des mouvements splendides et réalistes.

## Les scènes d'aventure
Des écrans dynamiques où les expressions des visages des personnages changent selon les répliques. Les arrière-plans magnifiques adaptés à chaque situation et les textes conçus pour une lisibilité parfaite témoignent d'un souci du détail impressionnant.

## Des mouvements surpassant l'animation !

## Les scènes d'entraînement
L'ascension de la tour Karin pour rencontrer maître Karin, les entraînements rigoureux sous la direction de Kamé Sennin... De nombreux événements majeurs vécus par Goku y sont condensés !`
	},
	{
		databookId: 80,
		page: 4,
		text_fr: `Un « chef-d'œuvre grandiose » fait son apparition !!!

Offert pour commémorer le 10e anniversaire de la sérialisation de Dragon Ball.
Une épopée monumentale en deux volumes (parties 1 et 2) formant une seule œuvre d'art...
Un jeu à l'échelle colossale que seule la technologie d'aujourd'hui pouvait concrétiser !

Revivez toute l'histoire de Goku !
Une réalisation soignée dans les moindres détails : l'histoire qui débute par la rencontre avec Bulma se matérialise enfin sous vos yeux !!

Rivaux, compagnons et personnages de légende répondent tous à l'appel !
Combats épiques et événements marquants sont retranscrits dans leur intégralité...
En mars prochain, une émotion inédite va traverser tout notre corps !!

La magnifique histoire de Son Goku commence.

DRAGON BALL Z
Chô Gokû Den (La Légende de Super Goku) — Première Partie
© Bird Studio / Shueisha / Toei Animation`
	},

	// === Databook #85 (DBH 5th Anniversary Mission Guide) ===
	{
		databookId: 85,
		page: 1,
		text_fr: `Édition spéciale V-Jump — Supplément du 1er janvier 2016
Fanbook officiel du 5e anniversaire Bandai

DRAGON BALL HEROES
5th ANNIVERSARY
5th MISSION

Prix fixe : 880 yens (taxes incluses)

Rassemblement des cartes de Son Goku de la première mission à GDM5 !
Focus sur les fans de DBH !

- Compte-rendu de l'événement commémoratif du 5e anniversaire !
- Tous les secrets du développement de DBH enfin dévoilés !
- Retracez l'histoire à travers la chronologie et les données chiffrées !
- Analyse des meilleurs decks des tournois officiels !
- Sondage exclusif auprès des fans de DBH !

Découvrez les messages de félicitations des plus grandes personnalités, dont la comédienne Masako Nozawa !`
	},
	{
		databookId: 85,
		page: 2,
		text_fr: `# Rapport spécial explosif

Retour sur l'émission spéciale commémorant le 5e anniversaire de Dragon Ball Heroes : « L'Éveil explosif des super guerriers » !

Des invités de prestige réunis pour célébrer les 5 ans de DBH !
(De gauche à droite sur la photo) : Wataru Higuchi (producteur chez Bandai), Terashi (rédacteur en chef adjoint du V-Jump), Ryô Horikawa (voix de Vegeta), Masako Nozawa (voix de Son Goku et Son Gohan), Tsubasa, Momo-chan, Dr. Bikini et Ayano Ôsawa (présentatrice).

Des anecdotes inédites sur l'enregistrement de l'anime Dragon Ball Super ont également été révélées !
Le dimanche 11 octobre 2015, lors de cet événement diffusé en direct sur YouTube Live, les comédiens Masako Nozawa et Ryô Horikawa ont rejoint les nombreux fans de DBH pour célébrer cet anniversaire marquant.`
	},
	{
		databookId: 85,
		page: 4,
		text_fr: `Messages de félicitations des guerriers DBH du monde entier — Missions Spéciales !!
Des personnalités liées à l'univers Dragon Ball nous ont envoyé leurs messages pour célébrer les 5 ans de DBH !!!

Version intégrale du message du père créateur de Dragon Ball, maître Akira Toriyama, annoncé lors de l'événement anniversaire du 11 octobre :

Maître Akira Toriyama :
« Toutes mes félicitations pour le 5e anniversaire de Dragon Ball Heroes !
Je suis profondément reconnaissant envers les enfants et tous les fans qui continuent aujourd'hui encore à s'amuser avec Dragon Ball, ainsi qu'envers l'équipe dévouée qui soutient ce projet !
Une fois, dans un supermarché près de chez moi, j'ai vu des enfants y jouer avec passion... C'était très touchant de constater à quel point le jeu est apprécié. Continuez à faire vibrer les joueurs avec vos superbes cartes et combats ! »`
	},
	{
		databookId: 85,
		page: 5,
		text_fr: `Classement des avatars et personnages préférés des fans de Dragon Ball Heroes !
Retrouvez les héros les plus populaires sélectionnés par la communauté lors du grand sondage du 5e anniversaire : guerriers Saiyans, cyborgs, Nameks et démons du froid plébiscités par les joueurs.`
	},

	// === Databook #93 (DBS Broly (Anime Comics)) ===
	{
		databookId: 93,
		page: 1,
		text_fr: `JUMP COMIC

# DRAGON BALL SUPER : BROLY
## Anime Comics du Film

Histoire originale, scénario et chara-design : Akira Toriyama
Édition et réalisation : Shueisha Comic Publishing`
	},
	{
		databookId: 93,
		page: 3,
		text_fr: `Broly Anime Comics`
	},
	{
		databookId: 93,
		page: 4,
		text_fr: `DRAGON BALL SUPER : BROLY
Présentation des guerriers qui s'illustrent dans le film « Broly », de leurs alliés et de la toile de fond de cette histoire épique.
Fiches des personnages !!

Vegeta :
Fils du roi Vegeta, il voue une rivalité intense à Goku. Après le Tournoi du Pouvoir, il garde une profonde méfiance envers Freezer qui est revenu à la vie.
- Forme normale
- Super Saiyan
- Super Saiyan God
- Super Saiyan God SS (Super Saiyan Blue)

Son Goku :
Un Saiyan élevé sur Terre qui a sauvé la planète de nombreux ennemis redoutables. Après avoir affronté de puissants guerriers lors du Tournoi du Pouvoir, il poursuit son entraînement pour devenir encore plus fort.
- Forme normale
- Super Saiyan
- Super Saiyan God
- Super Saiyan God SS (Super Saiyan Blue)

Colonne : Le Tournoi du Pouvoir, la bataille pour la survie de tous les univers convoquée par le Grand Roi Zeno.`
	},
	{
		databookId: 93,
		page: 6,
		text_fr: `# Berryblue
# Roi Cold
# Kikono
# Daigen
# Paragus
# Lemo
# Armée de Freezer
# Beerus
# Bulma
# Bra
# Trunks`
	},

	// === Databook #112 (SJR DBZ: Battle of Gods) ===
	{
		databookId: 112,
		page: 1,
		text_fr: `Shueisha Jump Remix — Dragon Ball Z : Battle of Gods (Anime Comics)
Histoire originale et conception : Akira Toriyama.
Guide remix officiel du film marquant le retour légendaire de Dragon Ball Z au cinéma !`
	},
	{
		databookId: 112,
		page: 2,
		text_fr: `## Les compagnons de Son Goku

### Bulma
Fille du Dr Brief et épouse de Vegeta. Elle a jadis parcouru le monde avec Goku à la recherche des Dragon Balls.

### Krilin
Disciple de l'école de la Tortue aux côtés de Goku et son meilleur ami de toujours. Le plus fort des artistes martiaux terriens.

### Yamcha
Ancien bandit du désert devenu disciple de l'école de la Tortue. Inséparable de son fidèle compagnon Plume.

### Videl
Fille de Mister Satan et épouse de Son Gohan. Courageuse et déterminée, elle pratique les arts martiaux avec passion.

### Gyûmaô (Roi Taureau)
Autrefois chef redouté de la montagne Frypan, il est désormais un grand-père bienveillant pour la famille de Goku.

### Piccolo
Guerrier Namek sage et puissant, mentor dévoué de Son Gohan.`
	},
	{
		databookId: 112,
		page: 3,
		text_fr: `# Le Dieu de la Destruction et ses mystères

## Beerus
Dieu présidant à la destruction dans l'univers. Doté d'une puissance incommensurable, il est craint même par les Kaïo Shin. Il se rend sur Terre en quête du légendaire Super Saiyan God.

## Whis
Serviteur et maître d'arts martiaux de Beerus. Il est le seul capable de conseiller le Dieu de la Destruction en toute franchise sans craindre son courroux.

## Poisson Oracle
Créature vivant sur la planète de Beerus. Douée de visions prophétiques, elle prédit l'apparition d'un adversaire digne du Dieu de la Destruction.

## La bande de Pilaf
Pilaf, Mai et Shu. Le trio d'infâmes brigands a accidentellement rajeuni en enfants à la suite d'un vœu formulé auprès de Shenron. Mai est en réalité une femme mature d'une quarantaine d'années sous ses traits enfantins.

## Plume
Compagnon fidèle de Yamcha capable de métamorphose.

## Les parents de Bulma
Le Dr Brief et son épouse, bienveillants dirigeants de Capsule Corporation.`
	},
	{
		databookId: 112,
		page: 4,
		text_fr: `Article spécial : Dernières révélations sur les liens familiaux dans Dragon Ball !
L'attrait des films récents ne réside pas uniquement dans les batailles dantesques : ils explorent également la chute tragique de la planète Vegeta, berceau de Goku et Vegeta.

Quatre destins de pères et de fils s'entrecroisent à travers le temps et l'espace pour aboutir à l'affrontement décisif sur la Terre du présent :
- Le prince Vegeta, né prodige et seul espoir de triompher de Freezer.
- Broly, le fils de Paragus dont le potentiel surdimensionné inquiète le roi Vegeta.
- Le roi Cold cédant les rênes de son empire galactique à son impitoyable fils Freezer.`
	},

	// === Databook #131 (V Jump Mai 1996) ===
	{
		databookId: 131,
		page: 1,
		text_fr: `V-Jump
Numéro de mai 1996
Prix fixe : 450 yens (taxes incluses)

Présentation exclusive des monstres 3D et des plus grands RPG de la saison !

Grands cadeaux et concours de printemps :
400 exemplaires du jeu Dragon Ball Z : Hyper Dimension à gagner !
1 300 exemplaires de Super Bomberman 4 offerts aux lecteurs !
Nouvelle série manga dérivée de Chrono Trigger : les aventures spatio-temporelles de Nuu et Mamo !`
	},
	{
		databookId: 131,
		page: 2,
		text_fr: `V-Jump — Mai 1996
Numéro 5

● COUVERTURE
Illustration : Katsuyoshi Nakatsuru
Design : Tsuboi Hi (Banana Grove Studio)
Photogravure : Takeshi Sumitani (Kyodo Printing)`
	},
	{
		databookId: 131,
		page: 3,
		text_fr: `ANIME DRAGON BALL GT
L'apparition d'ennemis surpuissants à travers le cosmos !!

Faisons le bilan complet du périple de Goku, Trunks et Pan depuis leur départ de la Terre ! Un résumé indispensable pour comprendre d'un seul coup d'œil leurs grandes aventures galactiques avant la diffusion des prochains épisodes inédits !

● Planète Imecka :
Après un atterrissage forcé dû à une avarie de leur vaisseau, nos héros découvrent une planète entièrement dominée par des marchands avares et sans scrupules ! Pour récupérer leur vaisseau volé, Goku et ses compagnons affrontent le cupide tyran Don Kia !

● Planète Monmaasu :
Une planète peuplée de créatures géantes où Pan est prise pour une reine abeille et où une Dragon Ball est avalée par un colosse ! Mais nos héros parviennent à récupérer la boule aux quatre étoiles !`
	},
	{
		databookId: 131,
		page: 4,
		text_fr: `Carddass® DRAGON BALL GT`
	},

	// === Databook #296 (Weekly Shōnen Jump 1995 N°21-22) ===
	{
		databookId: 296,
		page: 2,
		text_fr: `[◆] Un gigantesque Genki Dama renfermant le dernier espoir de tout l'univers ! C'est la bataille finale !!`
	},
	{
		databookId: 296,
		page: 3,
		text_fr: `Majin Buu trouve-t-il enfin la mort !?

Le plus puissant ennemi, Buu, est-il anéanti !? Quel est l'avenir de Goku et de ses amis après avoir vaincu la menace suprême ?`
	},
	{
		databookId: 296,
		page: 4,
		text_fr: `Majin Buu trouve-t-il enfin la mort !?

Le plus redoutable des adversaires, Buu, a-t-il poussé son dernier soupir !? Vers quel avenir se tournent Goku et ses fidèles compagnons après ce combat dantesque ?`
	},
	{
		databookId: 296,
		page: 5,
		text_fr: `[◆] C'est Son Goku qui a tranché. Majin Buu est totalement anéanti !!`
	}
];

// Création du fichier JSONL pour déposition
const jsonlLines = translations.map((t) =>
	JSON.stringify({
		databookId: t.databookId,
		page: t.page,
		fr: t.text_fr.trim(),
	})
);

const outputPath = "data/traductions-batch-golden-1.jsonl";
writeFileSync(outputPath, jsonlLines.join("\n") + "\n", "utf8");
console.log(`Généré ${translations.length} traductions dans ${outputPath}`);
