import { writeFileSync } from "node:fs";

interface TranslationEntry {
	databookId: number;
	page: number;
	fr: string;
}

const translations: TranslationEntry[] = [
	// === Databook #74 (V-Jump Juillet 1994) ===
	{
		databookId: 74,
		page: 1,
		fr: `Numéro commémoratif du 1er anniversaire de parution !
V-Jump — Juillet 1994
Prix : 450 yens (taxes incluses)

Cet été sera particulièrement brûlant ! Révélation exclusive des derniers jeux secrets !!
V-Jump Festival : 2 400 lecteurs invités !
Présentation exclusive de Final Fantasy VI, Dragon Ball Z, Tactics Ogre, Slam Dunk et Virtua Fighter !
Reprise de la sérialisation en couleurs intégrales de GO! GO! ACKMAN par Akira Toriyama !`
	},
	{
		databookId: 74,
		page: 2,
		fr: `DRAGON BALL Z : SUPER BATTLE CAPSULES
Une toute nouvelle expérience avec Goku !!
Dossier spécial : Dragon Ball Z — Idainaru Son Goku Densetsu (La Légende du Grand Son Goku) sur PC-Engine !
L'univers de Dragon Ball Z et Butôden 3 déferlent sur vos consoles !`
	},
	{
		databookId: 74,
		page: 4,
		fr: `« L'armée du Red Ribon convoitait les Dragon Balls, mais Son Goku avait nettement le dessus dans leurs affrontements. Alors, comme ultime atout, le Red Ribon a fait appel au plus grand assassin du monde : Tao Pai Pai ! »

« Parti à la recherche de la boule aux quatre étoiles, souvenir précieux de son grand-père, Goku s'est heurté à la plus puissante et malfaisante des armées, le Red Ribon... »

Une adaptation fidèle qui recrée l'histoire originale avec réalisme !

« Face à la force redoutable de Tao Pai Pai, Goku a d'abord mordu la poussière... Mais ayant survécu, il a suivi un entraînement intensif au sommet de la tour Karin auprès de maître Karin, avant de défier à nouveau Tao Pai Pai ! »

« Je ne te donnerai pas les boules ! Je ne me ferai plus jamais battre par quelqu'un comme toi ! »`
	},
	{
		databookId: 74,
		page: 5,
		fr: `Plus fort que jamais, Goku défie à nouveau Tao Pai Pai !
Le combat commence !!
Des scènes de duel inédites se déploient sur la version PC-Engine !
Lorsque vous remportez la victoire, de superbes séquences animées apparaissent !

« P-Pardonne-moi !! C'est moi qui avais tort !! Je t'en supplie, épargne-moi ! »
« Hein ? »
« Je jure de ne plus jamais faire de mal ! »

Freezer entre en scène ! Aperçu exclusif des séquences d'action !!
Des animations fidèles retranscrivent à merveille la gestuelle et la cruauté de Freezer !
Le tyran qui fit trembler d'effroi les guerriers Z renaît sur PC-Engine !`
	},
	{
		databookId: 74,
		page: 6,
		fr: `« Mouhahaha !! Tu es tombé dans le piège !! » « C'est une bombe !! » « Adieu !! Meurs !! »`
	},

	// === Databook #100 (Toei Anime Fair Été '95 (DBZ Film 13)) ===
	{
		databookId: 100,
		page: 2,
		fr: `# DRAGON BALL Z : L'ATTAQUE DU DRAGON
Guerriers Z, unissez vos forces pour terrasser le mal absolu !!
Guide cinématographique officiel Toei Anime Fair Été 1995.
Œuvre originale : Akira Toriyama.
Direction de l'animation : Tadayoshi Yamamuro. Réalisation : Mitsuo Hashimoto.`
	},
	{
		databookId: 100,
		page: 3,
		fr: `# CHAPITRE 1 : LA BOÎTE À MUSIQUE MYSTÉRIEUSE
L'apparition de la boîte musicale scellée renfermant le légendaire héros Tapion.`
	},
	{
		databookId: 100,
		page: 4,
		fr: `Chapitre 2 : Le passé douloureux de Tapion et la menace du monstre Hildegarn !`
	},
	{
		databookId: 100,
		page: 5,
		fr: `L'explosion de la puissance colossale de Goku ! Chapitre 3 : L'ultime attaque, le Poing du Dragon (Ryûken) !!`
	},
	{
		databookId: 100,
		page: 6,
		fr: `Grand jeu de l'oie officiel du film Dragon Ball Z : du sanctuaire de Tapion jusqu'au combat final contre Hildegarn !`
	},

	// === Databook #101 (Toei Anime Fair Printemps '95 (DBZ Film 12)) ===
	{
		databookId: 101,
		page: 1,
		fr: `Dragon Ball Z : Fusions (La Résurrection de la Fusion !! Goku et Vegeta)
Toei Anime Fair Printemps 1995 — Avec de superbes autocollants exclusifs !
Le tout dernier chef-d'œuvre cinématographique !`
	},
	{
		databookId: 101,
		page: 2,
		fr: `Scène de combat : Le grand tournoi d'arts martiaux de l'Autre Monde où s'affrontent Goku et Paikûhan !
Soudain, une lumière étrange illumine le palais d'Enma. Un dysfonctionnement dimensionnel provoque le chaos et les morts ressuscitent sur Terre !
Goku et Paikûhan font face au gigantesque Janemba, un ennemi redoutablement imprévisible qui sème la panique dans l'au-delà !`
	},
	{
		databookId: 101,
		page: 3,
		fr: `Deuxième acte : La puissance du Super Saiyan 3 pour terrasser Janemba !`
	},
	{
		databookId: 101,
		page: 6,
		fr: `# PARTIE 2 : LES PLUS GRANDS GUERRIERS
DBZ Le Film : Les héros unissent leurs forces pour briser les barrières dimensionnelles et restaurer l'ordre cosmique !`
	},
	{
		databookId: 101,
		page: 8,
		fr: `L'ultime fusion de Goku et Vegeta !
Protégez les deux mondes et triomphez de l'ennemi le plus redoutable !!

Histoire originale : Akira Toriyama (prépublié dans Weekly Shōnen Jump)
Scénario : Takao Koyama / Musique : Shunsuke Kikuchi
Directeur de l'animation : Tadayoshi Yamamuro / Réalisateur : Shigeyasu Yamauchi
Chanson thème : « WE GOTTA POWER » par Hironobu Kageyama

Distribution des voix :
Son Goku, Son Gohan, Son Goten : Masako Nozawa
Trunks : Takeshi Kusao
Vegeta : Ryô Horikawa`
	},

	// === Databook #244 (V Jump Août 2011) ===
	{
		databookId: 244,
		page: 1,
		fr: `Inscriptions en cours pour le V-Jump Festa 2011 !
V-Jump — Numéro 8
Sensations fortes et nouveautés exclusives !`
	},
	{
		databookId: 244,
		page: 2,
		fr: `Le Journal des Héros Dragon Ball — 21 juin 2011
Supplément exclusif du numéro d'août du V-Jump

Mission 5 disponible dès le 14 juillet (jeudi) !
Burst Saiyans explosif !! Le jeu à succès Dragon Ball Heroes déchaîne une armée de Saiyans en folie !!
« Laissez-moi vous montrer la fierté d'un peuple guerrier !!! »

Articles connexes :
Page 4 : Le redoutable Lord Slug apparaît dans la nouvelle mission temporelle !
Page 8 : Le tournoi décidera enfin des champions ultimes de l'Est et de l'Ouest !`
	},
	{
		databookId: 244,
		page: 3,
		fr: `Les cartes de campagne de la mission 5 rassemblent tous les guerriers Saiyans d'élite !
Déclenchez l'effet Burst surpuissant avec 8 combattants légendaires combattant côte à côte, dont la superbe carte Son Goku H5-CP6 !`
	},
	{
		databookId: 244,
		page: 4,
		fr: `# Place V-Jump
## Une entrée fracassante dans la mission temporelle 5 !!
# La plus terrifiante bataille de l'univers

Face au tyran Namek Lord Slug qui clame : « C'est moi qui vais vous exterminer !! »
Relevez le défi des attaques ultra-rapides dans les missions de boss contre Slug et triomphez de son armée !`
	},
	{
		databookId: 244,
		page: 6,
		fr: `Grand succès pour Dragon Ball Heroes !`
	},

	// === Databook #294 (Weekly Shōnen Jump 1995 N°18) ===
	{
		databookId: 294,
		page: 1,
		fr: `Weekly Shōnen Jump — Spécial Dr. Printemps
Prix : 200 yens (taxes incluses)
Grand numéro avec suppléments et cadeaux exclusifs pour tous les lecteurs !`
	},
	{
		databookId: 294,
		page: 2,
		fr: `[◆] C'est d'abord la Terre qui ressuscite ! La contre-attaque commence maintenant !! Écrasez Buu, la source absolue du mal !!`
	},
	{
		databookId: 294,
		page: 3,
		fr: `[◆] C'est d'abord la Terre qui ressuscite ! La contre-attaque commence maintenant !! Terrassez Buu, la source de tout le mal !!`
	},
	{
		databookId: 294,
		page: 4,
		fr: `La ligne de front d'un combat invincible !! La plus colossale puissance de l'univers !!
Le dénouement du combat à mort ! Quelle sera l'issue de l'ultime assaut lancé par Goku de toutes ses forces restantes... !?`
	},
	{
		databookId: 294,
		page: 5,
		fr: `La ligne de front d'une bataille légendaire !! La puissance absolue de l'univers !!
Le dénouement d'un combat acharné ! Quelle est la portée de l'attaque décisive portée par Son Goku à pleine puissance... !?`
	},

	// === Databook #309 (V Jump Novembre 1997) ===
	{
		databookId: 309,
		page: 1,
		fr: `Offre spéciale réservée à tous les souscripteurs : cassette vidéo V-Fest 97 !
Présentation des grands jeux : Cashman, Final Fantasy VII International, Panzer Dragoon RPG, Resident Evil 2, Bloody Roar, Dragon Ball Final Bout, Digimon et Tamagotchi !
Cadeaux exceptionnels pour les lecteurs !`
	},
	{
		databookId: 309,
		page: 2,
		fr: `Dernières informations exclusives !
Diffusé sur le réseau Fuji TV tous les mercredis de 19h00 à 19h30 (épisodes de 30 minutes).
Production : Toei Animation.
DRAGON BALL GT : L'ascension vers le sommet !`
	},
	{
		databookId: 309,
		page: 3,
		fr: `Carddass Dragon Ball — Série spéciale collector : The Complete Works of Dragon Ball in Carddass !

Puissance inouïe :
Capacité d'inversion transformant l'énergie négative en positive, clones corporels, images rémanentes... Et par-dessus tout, la fusion des techniques ultimes de Goku et Vegeta : le Big Bang Kamehameha, la technique la plus dévastatrice de tous les temps !!

Costume :
Le costume de Super Gogeta 4 adopte le design traditionnel des guerriers de la fusion, identique à celui de Gotenks et du Gogeta cinématographique ! Il s'agit en réalité de la tenue traditionnelle du peuple de la planète Métamol qui a enseigné la fusion à Son Goku.`
	},
	{
		databookId: 309,
		page: 4,
		fr: `La fusion suprême de Goku et Vegeta : Super Gogeta 4 !!
La fusion est une technique sacrée où deux guerriers unissent leurs corps pour donner naissance à une toute nouvelle entité surpuissante ! Face aux assauts dévastateurs d'Omega Shenron (Super Yi Xing Long), Goku et Vegeta ont décidé d'accomplir cette fusion légendaire !!

Physique et stature :
Sa taille est presque identique à celle de Goku. Il arbore tous les traits distinctifs du Super Saiyan 4 : queue de singe, contour des yeux écarlate et longue crinière flamboyante. La résistance de son corps est telle qu'il ne bronche même pas face aux attaques à pleine puissance d'Omega Shenron !!`
	},
	{
		databookId: 309,
		page: 5,
		fr: `Carddass® — 10e Anniversaire (depuis 1988)
Dragon Ball, Dragon Ball Z, Dragon Ball GT : tout l'univers Dragon Ball condensé dans une collection légendaire !
© Bird Studio / Shueisha, Fuji TV, Toei Animation.
La plus grande distribution de cartes de toute l'histoire des Carddass !
Choisissez entre les parcours A et B pour recevoir des cartes spéciales non destinées à la vente offertes à tous les participants !`
	}
];

const jsonlLines = translations.map((t) =>
	JSON.stringify({
		databookId: t.databookId,
		page: t.page,
		fr: t.fr.trim(),
	})
);

const outputPath = "data/traductions-batch-golden-2.jsonl";
writeFileSync(outputPath, jsonlLines.join("\n") + "\n", "utf8");
console.log(`Généré ${translations.length} traductions dans ${outputPath}`);
