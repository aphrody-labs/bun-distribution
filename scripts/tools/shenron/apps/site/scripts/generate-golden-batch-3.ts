import { writeFileSync } from "node:fs";

interface TranslationEntry {
	databookId: number;
	page: number;
	fr: string;
}

const translations: TranslationEntry[] = [
	// === Databook #103 (Toei Anime Fair Printemps '94 : Rivaux dangereux) ===
	{
		databookId: 103,
		page: 1,
		fr: `Slam Dunk / Dragon Ball Z`
	},
	{
		databookId: 103,
		page: 2,
		fr: `Le redoutable Super Saiyan légendaire est de retour !
Réveillez-vous, super guerriers !!
DRAGON BALL Z : Rivaux dangereux

Équipe de production :
Œuvre originale : Akira Toriyama / Musique : Shunsuke Kikuchi
Scénario : Takao Koyama / Chara-design & Direction de l'animation : Tadayoshi Yamamuro
Direction artistique : Takashi Yoshiike / Réalisation : Shigeyasu Yamauchi
Producteurs : Kozo Morishita, Munehisa Higuchi, Kenji Shimizu
Voix : Masako Nozawa, Mayumi Tanaka, Ryo Horikawa, Takeshi Kusao

Son Goten & Trunks`
	},
	{
		databookId: 103,
		page: 3,
		fr: `HISTOIRE 1 : DRAGON BALL Z — Goten et Trunks entrent en scène !`
	},
	{
		databookId: 103,
		page: 4,
		fr: `# Défiez Broly, Goten et Trunks !!
# HISTOIRE 2 : Le réveil du guerrier démoniaque
# Une puissance écrasante ! Le Super Saiyan légendaire Broly se déchaîne !!`
	},
	{
		databookId: 103,
		page: 5,
		fr: `HISTOIRE 3
Déployez toute votre puissance, super guerriers !!
Bats-toi, Gohan ! C'est à toi de protéger la Terre !!
Unissez les forces d'un père et de ses fils face au colosse !!

Résumé :
Face à la force écrasante de Broly, Trunks est blessé ! Gohan tente désespérément de résister mais ne fait pas le poids. Le soutien de Videl et de Krilin ne suffit pas à inverser la vapeur. Mais leur détermination inébranlable va provoquer un véritable miracle...!
Gohan rassemble ses dernières forces pour projeter un titanesque Kamehameha. Broly riposte avec sa terrible vague d'énergie... C'est alors que Goten se joint à lui, invoquant la silhouette de leur père Goku pour un triple Kamehameha décisif !`
	},
	{
		databookId: 103,
		page: 6,
		fr: `Le guide ultime des victoires de Goku dans ses plus grands duels légendaires !`
	},

	// === Databook #109 (Toei Anime Fair Été '91 : La Revanche de Cooler) ===
	{
		databookId: 109,
		page: 1,
		fr: `DRAGON BALL Z : Le film le plus puissant
L'affrontement suprême entre les deux êtres les plus forts de l'univers !
Nouvelle parution pour le grand festival d'animation d'été !`
	},
	{
		databookId: 109,
		page: 2,
		fr: `DRAGON BALL Z : La Revanche de Cooler (L'Incroyable duel des plus forts contre les plus forts)
© Bird Studio / Shueisha, Fuji TV, Toei Animation

Écrasez le mal ! Envole-toi, Super Saiyan Son Goku !!!

Équipe :
Œuvre originale : Akira Toriyama (Weekly Shōnen Jump)
Scénario : Takao Koyama / Musique : Shunsuke Kikuchi
Direction de l'animation : Minoru Maeda / Réalisation : Mitsuo Hashimoto
Chanson : Columbia Records

Voix :
Son Goku & Son Gohan : Masako Nozawa
Krilin : Mayumi Tanaka / Piccolo : Toshio Furukawa / Cooler & Freezer : Ryûsei Nakao`
	},
	{
		databookId: 109,
		page: 3,
		fr: `# L'arrivée du roi Cooler
## Les guerriers de l'escadron d'élite
### Salza
### Neizu
### Doore`
	},
	{
		databookId: 109,
		page: 4,
		fr: `Serait-ce Freezer ?! Non, c'est son frère aîné, Cooler !!
COMBAT 1 : Cooler attaque la Terre par surprise !!
Apprenant la défaite de Freezer, Cooler débarque avec ses troupes pour laver l'honneur de sa lignée et anéantir le guerrier Saiyan !`
	},
	{
		databookId: 109,
		page: 5,
		fr: `COMBAT 2 : Le formidable escadron blindé de Cooler !
Salza, Neizu et Doore attaquent en formation coordonnée pour traquer Goku et ses compagnons !`
	},
	{
		databookId: 109,
		page: 6,
		fr: `Goûtez à la véritable puissance du Super Saiyan !! L'assaut titanesque et le Kamehameha furieux de Goku !`
	},
	{
		databookId: 109,
		page: 7,
		fr: `Qu'est-ce que le Super Saiyan légendaire !?

Maître Kaio révèle les secrets inattendus du Super Saiyan !
En réalité, lorsque Goku se transforme en Super Saiyan, il ne peut plus utiliser le Genki Dama !! Le Genki Dama exige un cœur parfaitement pur et serein ; or, l'état de Super Saiyan est éveillé par la colère et contient une légère part d'agressivité Saiyan !

Le maître de la galaxie du Nord vous explique tout :
Le Super Saiyan est un guerrier ultime qui n'apparaît qu'une fois tous les mille ans en brisant toutes les limites !! La légende racontait qu'il aimait le sang et la destruction. Mais Goku a réussi l'exploit d'allier un cœur bienveillant et une puissance démesurée !`
	},

	// === Databook #111 (DBS Super Hero (Anime Comics)) ===
	{
		databookId: 111,
		page: 1,
		fr: `JUMP COMICS
# DRAGON BALL SUPER : SUPER HERO
## Anime Comics officiel du film

Histoire originale, scénario et chara-design : Akira Toriyama
Édition : Shueisha Jump Comic Publishing`
	},
	{
		databookId: 111,
		page: 2,
		fr: `# Présentation des personnages principaux !!!

### Magenta
Président officiel de Red Pharmaceuticals et chef secret de la renaissance de l'armée du Red Ribon.

### Carmine
Bras droit loyal de Magenta reconnaissable à sa coupe banane. Il supervise toutes les machinations et la logistique.

### Dr. Hedo
Petit-fils du célèbre Dr. Gero qui avait créé les cyborgs et Cell. Il est lui-même un savant d'un génie sans pareil.

### Gamma 1
Le premier cyborg de nouvelle génération conçu par le Dr. Hedo. Doté d'une puissance prodigieuse, il fait preuve d'un calme absolu.

### Gamma 2
Le second cyborg créé par le Dr. Hedo. À l'opposé de Gamma 1, il possède une personnalité joyeuse, théâtrale et communicative.

### Piccolo
Guerrier Namek dévoué, mentor de Pan et de Gohan.`
	},
	{
		databookId: 111,
		page: 5,
		fr: `Équipe de promotion et distribution du film Dragon Ball Super : Super Hero.

Département des ventes : Megumi Inoue, Yunosuke Ii, Maho Morita, Itaru Maruyama, Honoka Terahara, Yoko Toyama.
Promotion en salles : Yoichi Igawa, Tsuki Kondo, Mina Fujii, Kentaro Wakatsuki, Akari Noda.
Promotion régionale et coordination : Taiei Kyo, Toshiyuki Sato, Takeshi Tokube, Kaoru Kurokawa.
Coordination générale de la publicité : Satoshi Orihara, Tokugo Terashima, Kazuya Taguchi.
Coopération promotionnelle et partenaires médias : Takaaki Tanaka, Shun Unate, Anna Ohashi, Keiichi Fukasawa.`
	},
	{
		databookId: 111,
		page: 6,
		fr: `Dragon Ball Super : Super Hero
Société de production : Toei Animation
Distribution : Toei Company
Réalisateur : Tetsurô Kodama
Studios partenaires : Studio Viv, Yostar Pictures, Kinema Citrus, Orange, ENGI, J.C. Staff, Madbox.`
	},
	{
		databookId: 111,
		page: 7,
		fr: `# Message de maître Akira Toriyama

Jusqu'à présent, les films ont suivi les grandes étapes de la décennie séparant la défaite de Majin Buu du chapitre final du manga original.

« Super Hero » se déroule juste avant ce chapitre ultime.

Grâce à l'excellence du réalisateur et de l'ensemble du personnel, le film a reçu un accueil extraordinaire du public, beaucoup le considérant comme le meilleur de la franchise !

Moi-même, je suis extrêmement fier et heureux d'y avoir participé !

Dans cet anime comics, vous pourrez non seulement apprécier cette qualité visuelle remarquable à tout moment, mais aussi faire de nombreuses découvertes inédites.

Profitez-en dans ses moindres recoins !`
	},

	// === Databook #121 (V Jump Juillet 1995) ===
	{
		databookId: 121,
		page: 1,
		fr: `V-Jump — Numéro de juillet 1995 (vol. 3, n° 7, numéro cumulé 25). Prix : 450 yens.`
	},
	{
		databookId: 121,
		page: 2,
		fr: `L'ennemi est un démon spectral !! C'est moi qui vais l'abattre !!

Découvrez en avant-première les coulisses du nouveau film de l'été où Videl combat sous les traits d'une héroïne Great Saiyaman !

Équipe :
Œuvre originale : Akira Toriyama / Scénario : Takao Koyama
Musique : Shunsuke Kikuchi / Direction de l'animation : Tadayoshi Yamamuro
Direction artistique : Junichi Higashi / Réalisation : Mitsuo Hashimoto`
	},
	{
		databookId: 121,
		page: 3,
		fr: `Grande offensive estivale de l'animation !!
Présentation du programme Toei Anime Fair de l'été 1995 !
Dragon Ball Z : L'Attaque du dragon (L'Explosion du Poing du Dragon !! Si Goku ne le fait pas, qui le fera ?).
Sortie en salles le 15 juillet 1995. Distribution : Toei Company.`
	},
	{
		databookId: 121,
		page: 4,
		fr: `DRAGON BALL Z : Jumbo Carddass
Sortie prévue fin mai ! Des cartes géantes d'une taille environ six fois supérieure aux Carddass standard !`
	},
	{
		databookId: 121,
		page: 5,
		fr: `Numérotation des combattants du jeu :
Guerrier n°17 : Son Goten
Guerrier n°16 : Ginyu
Guerrier n°18 : Kaïo Shin
Trunks adolescent
Guerrier n°19 : Dabra
Guerrier n°20 : Super Buu
Guerrier n°21 : Majin Buu
Guerrier n°22 : Gotenks
Guerrier n°15 : Reacum
Guerrier n°8 : Perfect Cell
Guerrier n°23 : Tenshinhan
Guerrier n°24 : Great Saiyaman
Zabon`
	},
	{
		databookId: 121,
		page: 6,
		fr: `# Tous les guerriers réunis au combat !!!
Découvrez le nouveau chapitre de Super Butôden : les combattants guidés par le destin !
14 combattants légendaires ont rassemblé de nouveaux alliés pour donner naissance à une confrontation historique réunissant 22 guerriers d'élite, dont C-16 et C-18 !`
	},

	// === Databook #297 (Weekly Shōnen Jump 1995 N°35) ===
	{
		databookId: 297,
		page: 3,
		fr: `Bataille à l'intérieur du corps !!
S'étant infiltrés dans le corps de Buu, leur fusion s'est rompue ! À l'intérieur de son organisme, Goku et Vegeta sont devenus plus minuscules que des puces, réduisant drastiquement leur portée offensive !`
	},
	{
		databookId: 297,
		page: 4,
		fr: `Buu est anéanti ! Et le temps s'est écoulé...
Même transformé en Super Saiyan 3, je ne pouvais rivaliser avec la férocité de ce Buu démoniaque... C'est alors que le plus colossal Genki Dama de l'histoire a été achevé !! Grâce à cette énergie pure, Majin Buu a enfin été rayé de l'univers !!
Et dix ans plus tard...`
	},
	{
		databookId: 297,
		page: 6,
		fr: `La réincarnation bienveillante de Majin Buu !!
Il ne possède plus la moindre once de malveillance. Aîné d'une fratrie de cinq enfants âgé de 10 ans, Oob est originaire d'un paisible village d'une île du sud. D'un tempérament doux et dévoué à sa famille, il dissimule un potentiel latent capable de rivaliser avec Son Goku !!`
	},
	{
		databookId: 297,
		page: 7,
		fr: `Les métamorphoses diaboliques de Buu !!

Salut, c'est moi, Goku !!
J'ai reçu la vie du doyen des Kaïo Shin pour ressusciter en tant qu'humain ! Mais après avoir absorbé Gotenks et Piccolo, cet enfoiré de Buu a aussi absorbé Gohan !! Bon sang, je n'avais plus personne avec qui fusionner via les Potaras !!
C'est à cet instant précis que, par la décision du grand roi Enma, Vegeta qui était mort a été renvoyé sur Terre !! Nous avons immédiatement fusionné grâce aux Potaras pour donner naissance à Vegetto !!
Vegetto s'est fait volontairement absorber pour pénétrer dans le corps de Buu afin de libérer nos compagnons sains et saufs !!`
	}
];

const jsonlLines = translations.map((t) =>
	JSON.stringify({
		databookId: t.databookId,
		page: t.page,
		fr: t.fr.trim(),
	})
);

const outputPath = "data/traductions-batch-golden-3.jsonl";
writeFileSync(outputPath, jsonlLines.join("\n") + "\n", "utf8");
console.log(`Généré ${translations.length} traductions dans ${outputPath}`);
