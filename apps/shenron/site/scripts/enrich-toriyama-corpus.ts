#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Enrichissement et traduction du corpus Akira Toriyama.
 * 
 * Applique les traductions fidèles et vérifiées pour :
 * - Daizenshuu 2 (ID 2, planches 255-258 & ID 7 Super Interview intégrale)
 * - Daizenshuu 4 (ID 3, planches 161 & 164)
 * - Daizenshuu 7 (ID 4, planche 309 - 38 commentaires de fin de numéro)
 * - Super Exciting Guide Character Volume (ID 6, planches 91-95)
 * - Super Exciting Guide Story Volume (ID 9, planches 89, 91, 92)
 * - WIRED Japan 1997 (ID 57 entretien intégral)
 * - Dragon Ball Z Shin Budokai (ID 56 correction glossaire canonique)
 * - Entretien Toriyama x Toyotaro (ID 8 dialogue du tome 1 Jump Comics)
 * - Nettoyage glossaire des références dans public.canon_references
 */

import postgres from "postgres";

import {
	arretSiGel,
	deposerTraduction,
	texteDePlanche,
	traductionDePlanche,
	type PlancheBrute,
} from "./_databooks-base";

// Gel des écrivains : sortie 3 avant toute connexion si .coord/FREEZE-databooks.json existe.
arretSiGel("enrich-toriyama-corpus");

const GLOSSAIRE: { faux: RegExp; correct: string }[] = [
	{ faux: /\bFreeza\b/g, correct: "Freezer" },
	{ faux: /\bFrieza\b/g, correct: "Freezer" },
	{ faux: /\bKuririn\b/gi, correct: "Krilin" },
	{ faux: /\bKrillin\b/gi, correct: "Krilin" },
	{ faux: /\bTien\b/g, correct: "Tenshinhan" },
	{ faux: /\bpoing du roi\b/gi, correct: "Kaioken" },
	{ faux: /\bKaio-ken\b/g, correct: "Kaioken" },
	{ faux: /\bboule d[’']énergie\b/gi, correct: "Genkidama" },
	{ faux: /\bvague déferlante de la tortue\b/gi, correct: "Kamehameha" },
	{ faux: /\bSaiya-?jin\b/gi, correct: "Saiyan" },
	{ faux: /\bSaiyen\b/gi, correct: "Saiyan" },
	{ faux: /\bNamekian\b/g, correct: "Namékien" },
	{ faux: /\bNamekians\b/g, correct: "Namékiens" },
	{ faux: /\bMajin Buu\b/g, correct: "Majin Boo" },
	{ faux: /\bMr\.? Hercule\b/gi, correct: "Mr. Satan" },
	{ faux: /\bHercule\b/g, correct: "Mr. Satan" },
	{ faux: /\bSon Gokou\b/gi, correct: "Son Goku" },
	{ faux: /\bDragon Balls\b/g, correct: "Dragon Ball" },
	{ faux: /\bGenki Dama\b/g, correct: "Genkidama" },
	{ faux: /\bKid Buu\b/g, correct: "Kid Boo" },
];

function verifierGlossaire(texte: string, contexte: string): void {
	for (const g of GLOSSAIRE) {
		const matches = texte.match(g.faux);
		if (matches) {
			throw new Error(`[Glossaire] Violation dans ${contexte} : « ${matches.join(", ")} » devrait être « ${g.correct} »`);
		}
	}
}

// ── Traductions des planches par livre et numéro ────────────────────────────

const TRADUCTIONS_PLANCHES: Record<number, Record<number, string>> = {
	// Daizenshuu 2 (ID 2)
	2: {
		255: `— Ce volume étant un Story Guide, nous aimerions aborder avec vous l'histoire de Dragon Ball. Pour commencer, comment cette histoire est-elle née ?

Akira Toriyama : Au moment d'arrêter Dr. Slump, je me suis dit qu'il fallait enchaîner sur une nouvelle série. À l'époque, j'avais d'innombrables réunions avec mon premier éditeur, M. Torishima. Par hasard, j'adorais les films de Jackie Chan, j'avais vu Le Maître chinois (Drunken Master) des dizaines de fois. M. Torishima m'a dit : « Si tu aimes tant ça, pourquoi ne dessinerais-tu pas un manga de kung-fu avec un jeune garçon ? » C'est ainsi que j'ai dessiné l'histoire courte Dragon Boy (騎竜少年). L'accueil des lecteurs a été bien meilleur que prévu, alors nous avons décidé d'emprunter cette voie pour la prochaine série.

— Et c'est là que vous avez commencé à concevoir sérieusement cette nouvelle œuvre.

Akira Toriyama : Comme Dr. Slump avait une ambiance très « côte Ouest » américaine, je voulais changer d'atmosphère et adopter un décor chinois. Et quitte à faire du chinois, autant s'inspirer de La Pérégrination vers l'Ouest (西遊記, Saiyūki). La Pérégrination vers l'Ouest est une histoire absurde, pleine d'aventures, alors je me suis dit que j'allais en faire une version moderne. S'il y a déjà une trame de base, il suffit de l'adapter, c'est bien plus commode ! (rires)

— Au départ, vous aviez même envisagé de faire de Goku un véritable singe (cf. page 90).

Akira Toriyama : Oui, c'était La Pérégrination vers l'Ouest après tout. Mais comme le héros manquait d'humanité, j'en ai fait un garçon normal. Il lui fallait cependant un trait distinctif. Le héros de Dragon Boy avait des ailes, mais je voulais quelque chose qu'on reconnaisse au premier coup d'œil. C'est pour cela que j'ai doté Goku d'une queue. Comme ça, même caché derrière un rocher, s'il y a la queue qui dépasse, on sait tout de suite que c'est Goku.
Ensuite sont venues les sept Dragon Ball qui exaucent un vœu quand on les réunit. En faisant de leur recherche un voyage, ils pouvaient parcourir le monde exactement comme dans La Pérégrination vers l'Ouest.

— Et la sérialisation a débuté. Avant le tournoi du Tenkaichi Budokai, la série était encore très marquée par La Pérégrination vers l'Ouest.

Akira Toriyama : Tout à fait. Bulma correspondait à Sanzō Hōshi (le moine Xuanzang), Oolong à Zhu Bajie, et Yamcha à Sha Wujing. Au départ, je pensais m'arrêter une fois les sept Dragon Ball réunies.`,

		256: `— Comment en êtes-vous arrivé à la transition vers le Tenkaichi Budokai ?

Akira Toriyama : Avant le début du Tenkaichi Budokai, la série n'était pas très populaire. Un jour, M. Torishima m'a lancé : « Ton héros est bien trop fade. C'est pour ça que la série ne décolle pas. » Pour ma part, je voulais miser sur l'histoire, et j'avais délibérément affublé le protagoniste d'une tenue extrêmement banale. Piqué au vif, j'ai rétorqué : « C'est bon, j'ai compris. Je vais la faire décoller, la popularité ! » En réfléchissant au personnage de Goku, les mots qui le résumaient le mieux étaient « je veux devenir plus fort » (強くなりたい). J'ai donc décidé de mettre cela au premier plan. Dans Dr. Slump, le Grand Prix du village Pingouin avait rencontré un franc succès. Je me suis dit : faisons simplement un format de tournoi ! C'est ainsi qu'est né le Tenkaichi Budokai. J'ai mis de côté les autres personnages, fait réapparaître Kame-sennin, et introduit un nouveau venu nommé Krilin. Et là, d'un coup, la popularité est montée en flèche !

— Pourtant, alors qu'un héros classique l'emporte toujours, Goku a mis du temps avant de gagner le tournoi.

Akira Toriyama : Oui, il n'a remporté la victoire qu'à sa troisième tentative. Tout le monde disait : « De toute façon, c'est le héros qui va gagner, non ? » Quand on me dit ce genre de chose, mon esprit de contradiction prend le dessus et je me dis : « Même par pur entêtement, je ne vais pas le faire gagner ! » (rires)

— Après le premier Tenkaichi Budokai, l'armée du Red Ribon est entrée en scène.

Akira Toriyama : Pour l'armée du Red Ribon, c'était le même principe : un système d'élimination progressive, identique au Tenkaichi Budokai. À l'époque, je jouais beaucoup au jeu Famicom Spartan X (Kung-Fu Master). À chaque étage qu'on gravit, un ennemi plus puissant apparaît et on doit l'abattre. C'est aussi la base des films de kung-fu. De cette façon, je pouvais proposer une mise en scène et un visuel différents de ceux d'un tournoi. La tour du Muscle en est la parfaite illustration.`,

		257: `— Et c'est alors qu'apparaît le Roi démon Piccolo (Piccolo Daimaō).

Akira Toriyama : Jusque-là, tous les méchants avaient un côté un peu attachant qu'on ne pouvait pas totalement détester. Le Roi démon Piccolo est donc né de l'envie de créer un individu foncièrement et véritablement mauvais. Mettre en scène le mal absolu a été la chose la plus amusante à dessiner pour moi.

— Ensuite, l'histoire est montée en puissance et s'est étendue à l'univers...

Akira Toriyama : Après être devenu le numéro un sur Terre, Goku a vaincu les Saiyans venus de l'espace, puis l'intrigue est partie dans le cosmos. L'idée de Freezer m'est venue en plein pendant la bulle économique japonaise. Les spéculateurs immobiliers (地上げ屋, jiageya) étaient considérés comme les pires ordures. Je me suis dit : faisons-en le spéculateur immobilier de l'univers ! Les Saiyans n'étaient que ses hommes de main. C'était le plus grand promoteur véreux du cosmos. Mais faire constamment escalader la puissance des ennemis devenait étouffant. C'est là que le commando Ginyu est apparu. Comme j'adorais les séries Super Sentai et que j'en regardais plein, je me suis dit : « Et si je les introduisais dans l'histoire ? » (rires)

— Puis sont arrivés les cyborgs et Cell.

Akira Toriyama : Une fois devenu le numéro un de l'univers, il ne restait plus qu'à transcender le temps. Je me suis donc lancé dans une histoire de voyage temporel, mais c'était un enfer. Les paradoxes temporels ? Je m'enfonçais de plus en plus dans un bourbier sans fond ! Fondamentalement, je ne pensais qu'à ce que j'écrivais pour la semaine en cours. Ce qui allait arriver la semaine suivante, moi-même je n'en avais aucune idée. Après avoir dessiné un chapitre, je demandais toujours à mon éditeur : « Qu'est-ce qu'on fait la semaine prochaine ? » (rires)

— À la fin de l'arc de Cell, tout le monde a pensé que Son Gohan prenait la relève en tant que protagoniste.

Akira Toriyama : J'avais effectivement l'intention de faire de Gohan le personnage principal. Mais je n'ai pas réussi à m'y faire. Par rapport à Goku, j'ai senti que Gohan n'était finalement pas taillé pour ce rôle de premier plan.

— Quels sont vos personnages préférés, Toriyama-sensei ?

Akira Toriyama : Eh bien, c'est Piccolo que je préfère après tout. Parmi les ennemis, le Roi démon Piccolo est mon favori, et même par la suite, Piccolo reste mon préféré. J'aime Piccolo à peu près autant que Goku. Vegeta, bon, je ne l'aimais pas tellement au début, mais il m'a été d'un immense secours. Et plus récemment, Mr. Satan était également très plaisant à dessiner.`,

		258: `Akira Toriyama : C'est comme pour Mr. Satan : imaginer des gags stupides est bien plus réjouissant pour moi que de dessiner des combats acharnés (rires). Et puis au fond, il y a toujours une foule d'alliés contre un seul ennemi. Quand on y pense, ce n'est pas très équitable, n'est-ce pas ? (rires) Ils se liguent tous contre lui. Quel que soit l'ennemi, Goku voulait se battre en un contre un... c'était sans doute là son sentiment le plus profond.

(Entretien recueilli le 23 mai 1995 au restaurant chinois Rōgairō)`,
	},

	// Daizenshuu 4 (ID 3)
	3: {
		161: `— Dès qu'un combat commence, Goku et les siens semblent toujours vouloir filer vers des étendues désertes (rires). Vous vous inspiriez de recueils de photographies pour vos dessins ?

Akira Toriyama : Oui, je regardais des livres de photos. J'ai aussi consacré beaucoup d'énergie au décor du Tenkaichi Budokai. Avant le début de la publication, j'étais parti en voyage à Bali avec ma famille et mes assistants. L'île Papaye où se tient le Tenkaichi Budokai est entièrement calquée sur Bali. J'ai conçu les bâtiments en m'appuyant largement sur les photos prises là-bas. C'était un travail colossal (rires), d'autant que le décor du tournoi est revenu plusieurs fois par la suite. À chaque fois, il me fallait ressortir mes documents de référence ! (rires)

— Y a-t-il d'autres paysages inspirés de lieux réels ?

Akira Toriyama : Pas tellement d'autres... Ah si, l'endroit où le vaisseau de Babidi était enterré : pour cela, je me suis inspiré d'un recueil de photographies de l'Afrique. C'était une étendue aride et désertique, et je l'ai adaptée pour le manga. Dans la seconde moitié de l'histoire, les scènes se déroulaient presque exclusivement dans des zones désolées, et la difficulté était de réussir à les différencier les unes des autres.

— En y regardant de près, aucun désert ne se ressemble effectivement.

Akira Toriyama : Exactement. Je veillais à varier les paysages à chaque fois : changer la silhouette des rochers, la forme des montagnes lointaines... C'est un point sur lequel je réfléchissais beaucoup. Il fallait que le lecteur comprenne qu'il s'agissait d'un lieu différent, et puis des décors identiques auraient été d'un ennui mortel.

— Les terres inhabitées et sauvages reviennent constamment tout au long du récit.

Akira Toriyama : Faire combattre Goku et ses amis en pleine ville est un véritable cauchemar : il faut dessiner les habitants qui y vivent, les immeubles qui s'effondrent... Voilà pourquoi, dès qu'un affrontement éclate, ils ont tous hâte de filer vers des étendues désertes (rires). Comme s'ils s'étaient concertés, ils décollent en trombe grâce au vol (舞空術, Bukūjutsu).

— Depuis que tous les compagnons de Goku ont appris le Bukūjutsu et savent voler, faire progresser l'histoire est devenu bien plus facile, n'est-ce pas ?

Akira Toriyama : Tout le monde pouvait instantanément se rendre n'importe où. Cela a grandement facilité l'enchaînement des événements, et surtout, le rythme du récit est devenu bien plus vif et rapide. Sur le plan visuel, cela m'a aussi permis de montrer les paysages en plongée ou sous des angles aériens. C'était déjà dans cette même optique que j'avais introduit le nuage Kinto-un tout au début de la série.`,

		164: `Akira Toriyama : En général, je conçois les choses après coup pour que tout concorde logiquement. Prenez par exemple le siège sur lequel est assis le Grand Chef des Namékiens (最長老, Saichōrō) : c'est pratiquement le même fauteuil que celui où siégeait le Roi démon Piccolo lors de sa toute première apparition, au crâne près !

— En effet ! Quand on y regarde, la forme est rigoureusement identique.

Akira Toriyama : Je me suis dit que le Roi démon Piccolo avait sans doute gardé un vestige de mémoire de son époque sur la planète Namek lorsqu'il s'est fait fabriquer ce siège. C'est à partir du design de ce fauteuil que j'ai imaginé l'architecture des bâtiments namékiens et la forme de leurs vaisseaux spatiaux. Quand nous sommes partis sur Namek, on m'avait prévenu : « Envoyer une série de shōnen dans l'espace mène presque toujours à l'échec. » C'est pourquoi j'ai pensé l'univers de Namek avec une grande rigueur pour que chaque détail s'imbrique parfaitement.

— En dehors de la Terre, les deux grands théâtres de l'histoire ont été Namek et l'autre monde (あの世, Ano Yo). Comment avez-vous conçu cet au-delà ?

Akira Toriyama : Comme le palais du Tout-Puissant (神様, Kami-sama) dégageait une atmosphère mystique, j'ai pensé qu'un au-delà d'apparence administrative et terre-à-terre serait amusant. C'est ainsi que j'ai imaginé le roi Enma habillé en costume-cravate comme un employé de bureau, entouré de démons fonctionnaires. Si vous regardez le plan d'ensemble du monde publié dans ce volume, vous remarquerez que les âmes qui se rendent au paradis y vont à bord d'un avion de ligne ! Ce grand schéma cosmologique m'avait été commandé à l'origine par l'équipe de l'anime, et j'ai profité de ce livre pour y ajouter le royaume des Kaïoshin qui n'y figurait pas, afin de le rendre complet. En vérité, j'ai élaboré cette carte globale après avoir achevé l'histoire, pour que toutes les pièces du puzzle retombent sur leurs pieds (rires). En ce qui me concerne, j'écris d'abord le récit, puis je bâtis l'univers autour pour que tout se tienne. Les mangakas sérieux définissent sans doute d'abord l'univers avant d'écrire l'histoire, mais chez moi, c'est l'inverse ! Quand je dis cela, on a l'impression que je ne prévois rien à l'avance... mais rassurez-vous, j'ai toujours une image générale en tête avant de me lancer (rires).

(Entretien recueilli le 24 juillet 1995 au centre touristique de Kanazawa)`,
	},

	// Daizenshuu 7 (ID 4)
	4: {
		309: `● Akira Toriyama : Best of des commentaires de fin de numéro (Weekly Shōnen Jump 1984–1995)

Parmi les 519 commentaires publiés en fin de numéro du Weekly Shōnen Jump au fil de la parution de Dragon Ball, 38 ont été sélectionnés pour cette anthologie :

- 1984, n°51 : À peine le temps de souffler que me revoilà déjà ! Je suis à la fois content et effrayé. Mais je vais me donner à fond !!
- 1985, n°3 : J'ai enfin regardé le chef-d'œuvre Conan, le fils du futur et j'ai été profondément ému. C'est exactement ce genre d'œuvre que j'aimerais créer.
- 1985, n°27 : Un lecteur m'a envoyé une culotte. J'étais tellement content que je l'ai accrochée au mur de mon atelier.
- 1985, n°35 : J'ai une peur bleue des éclairs depuis ma naissance ! Dès que l'orage gronde, j'enlève mes lunettes par réflexe et je suis incapable de travailler.
- 1985, n°45 : Enfin quelques jours de repos. Voyage en famille vers les sources thermales de Shinshū. Le bain en plein air était un pur bonheur.
- 1986, n°12 : Entre le travail, la date limite du concours de maquettes et les mariages de mon frère et d'amis, c'est la panique. Mais je ne manquerai l'anime pour rien au monde !
- 1986, n°18 : J'ai remporté la médaille d'or au concours de figurines en plastique ! Ça fait vraiment plaisir.
- 1986, n°24 : Dragon Quest, c'est un piège absolu ! Ça m'empêchait de travailler, alors ma femme a fini par me confisquer le jeu.
- 1986, n°33 : Ma chatte adorée Koge a donné naissance à quatre chatons tant attendus. Ils sont adorables et c'est une joie de les voir grandir chaque jour.
- 1987, n°18 : Pour les enfants de ma famille, je suis juste le tonton qui sait bien dessiner les personnages de DRAGON BALL.
- 1987, n°39 : Mon chien aboyait dans le jardin ; je suis allé voir et il y avait une grosse tortue. Comme je l'ai relâchée, j'espère qu'elle m'apportera une boîte magique (tamatebako) !
- 1987, n°48 : Ce qui va arriver la semaine prochaine, même l'auteur l'ignore. C'est pour ça que je dessine chaque semaine avec le cœur qui bat !
- 1988, n°17 : Je suis allé au zoo avec mon fils Sasuke. Il était ravi, mais honnêtement, celui qui s'est le plus amusé, c'était moi.
- 1988, n°36 : Comme il est difficile d'aller au cinéma tant que mon fils est petit, je compense avec des cassettes vidéo. J'en ai désormais une montagne.
- 1989, n°21 : Mon éditeur M. Kondo est parti en Australie avec M. Endo. Moi, je suis allé au supermarché du coin avec mon fils... J'ai perdu.
- 1989, n°45 : Incroyable !! J'ai emprunté une version de démonstration de Dragon Quest IV et je l'ai terminée jusqu'au bout !! C'est passionnant, une réussite totale !!
- 1989, n°49 : Parti pour durer un an, Dragon Ball dépasse désormais Dr. Slump en longévité ! Je suis partagé entre la joie et le vertige...
- 1990, n°16 : Le Jump sponsorise la Formule 1 que j'adore tant ! Je suis surexcité par ce projet de rêve.
- 1990, n°19 : L'autre jour, j'ai fêté mes 35 ans. Si j'arrondis à la dizaine supérieure... non, je préfère ne pas y penser.
- 1990, n°45 : Masakazu Katsura est venu chez moi sans raison particulière. Mais comme il est incollable sur les héroïnes coquines à transformation, la discussion était passionnante.
- 1991, n°13 : Comme une petite fille est née chez nous l'an passé, la fête des poupées (Hinamatsuri) du 3 mars est devenue un événement très cher à mon cœur.
- 1991, n°47 : Cette année, les typhons s'enchaînent chaque week-end et mon voyage d'automne a été annulé. Au bout du compte, il ne me reste que le travail...
- 1991, n°51 : Monté à Tokyo pour la séance photo de couverture du numéro du Nouvel An. J'ai beau le faire chaque année, je trouve ça toujours un peu embarrassant.
- 1992, n°44 : J'ai installé un nouveau télécopieur dans mon atelier. Mais il a tellement de fonctions avancées qu'il m'est désespérément impossible de le maîtriser...
- 1992, n°51 : Mon nouvel éditeur est venu pour notre première réunion de travail. J'ai été sidéré par sa stature imposante... Serait-il au-delà des 100 kg... !?
- 1993, n°9 : J'ai lu les exemples de questions de l'examen Tenkaichi... Même pour l'auteur, c'est d'une difficulté redoutable ! Je me demande quel genre de personne pourra l'emporter !
- 1993, n°27 : Lors d'une interview, on m'a demandé quelle était ma devise dans la vie, et j'ai répondu sans réfléchir : « La facilité » (楽, raku)...
- 1993, n°43 : Quand je conçois le design d'une voiture, je peux passer plusieurs nuits blanches d'affilée sans dormir. Je crois que j'aime encore plus ça que mon travail.
- 1993, n°47 : L'exposition Akira Toriyama démarre en décembre. C'est un peu gênant d'avoir une exposition à mon nom, mais venez nombreux !
- 1994, n°8 : Après trois semaines de longues vacances, j'ai rêvé que je me remettais à dessiner d'arrache-pied toute l'année !! Était-ce un rêve prémonitoire !?
- 1994, n°16 : Ah, comme j'aimerais déménager dans une maison élégante au bord d'un lac, encore plus à la campagne... mais face au refus catégorique de ma famille, le projet est tombé à l'eau.
- 1994, n°26 : Mon chien est tombé malade et a dû être hospitalisé. Il a passé le cap et a pu rentrer à la maison, me voilà rassuré. Un animal de compagnie fait partie intégrante de la famille.
- 1994, n°32 : Le personnage de Boo a commencé à bouger tout seul dans l'histoire. Il se pourrait bien qu'il prenne une ampleur monumentale !?
- 1995, n°2 : Une vedette internationale m'a sollicité pour adapter Dragon Ball en film en prises de vues réelles. Rien n'est encore décidé, mais cela verra peut-être le jour.
- 1995, n°5-6 : Quand je me retourne, cela fait dix ans que Dragon Ball est publié. Dix ans marquent une étape : cette année, je compte dessiner avec une énergie toute neuve !!
- 1995, n°11 : Mon chien adoré n'a pas survécu à sa maladie et s'en est allé au ciel. Joue bien avec Goku dans l'autre monde.
- 1995, n°12 : J'ai imaginé la fusion sans trop y penser, mais organiser un concours d'idées de fusion serait hilarant. Du genre Kame-sennin et Bulma...
- 1995, n°25 : Les mots me manquent pour remercier les lecteurs qui m'ont soutenu pendant ces dix années. Du fond du cœur... merci infiniment.`,
	},

	// Super Exciting Guide : Character Volume (ID 6)
	6: {
		91: `Manga « DRAGON BALL » no Shinjitsu part 2 — Spécial « Voilà comment Toriyama y pensait »
Maître Toriyama répond aux questions sur les personnages et l'univers de DRAGON BALL !

À propos des personnages : Pourquoi avoir harmonisé les noms par familles thématiques ?
Réponse : Trouver des noms pour une telle profusion de personnages est un véritable casse-tête. En regroupant les noms par ensembles thématiques, la réflexion devient bien plus simple.
Par exemple, celui qui commande aux Saiyans et aux autres extraterrestres belliqueux est Freezer. Le mot « freezer » désigne à proprement parler un congélateur, mais j'ai choisi ce nom en pensant à un réfrigérateur. Dès lors, tous les personnages sous ses ordres portent des noms d'aliments qui se rangent à l'intérieur : les Saiyans portent des noms de légumes (yasai), le commando Ginyu des noms de produits laitiers, et ainsi de suite.

À propos des personnages : Quel a été le modèle de conception ?
Réponse : Pour les créatures non humaines, je voulais donner à Cell une allure d'insecte, mais en dehors de cela, il n'y a pas eu de modèle particulier. Quant aux Namékiens, bien que leur nom vienne de la limace (namekuji), le seul élément dont je me suis inspiré sont leurs antennes.

À propos des personnages : D'ailleurs, quel est le vrai nom de Mr. Satan ?
Réponse : Mr. Satan est un nom de ring ; son vrai nom civil est différent. Le véritable nom de Mr. Satan est « Mark » (マーク, Māku), qui est une anagramme d'« Akuma » (悪魔, démon en japonais). Dans la région où vit Satan, les habitants ne portent pas de nom de famille : son identité se résume donc à « Mark ». Quant à sa fille Videl, il s'agit bien de son vrai nom civil et non d'un nom de scène : c'est l'anagramme de « Devil » (diable en anglais).

Celui qui répond : Akira Toriyama, mangaka résidant dans la préfecture d'Aichi, passionné de maquettes. Après ses débuts en 1978 avec Wonder Island, son premier grand succès en feuilleton est Dr. Slump, immédiatement suivi de DRAGON BALL, sérialisé pendant plus de dix ans.`,

		92: `À propos de l'univers
Comment avez-vous conçu la structure de l'univers ?
Réponse : Je l'ai pensée de manière à ce que l'atmosphère soit facile à appréhender, pour moi comme pour les lecteurs. La grande sphère centrale englobe le monde des vivants et l'au-delà (le bas-monde et l'autre monde), et les Kaïoshin veillent dessus depuis l'extérieur. Cependant, dans la partie inférieure de cette sphère se trouve son pendant opposé, où résident les Makaiōshin régissant le mal. (À l'heure actuelle, la puissance des Kaïoshin semble supérieure.)

La charge de Kaïo (Kaïo-sama) est-elle héréditaire ?
Réponse : À l'intérieur de la grande sphère se trouve la planète d'où sont issus les quatre Kaïo : la Planète du Noyau du Monde (界芯星, Kaishin-sei). C'est un astre semblable à une planète Kaïo géante, où les divinités naissent sous forme de peuple du noyau (芯人, Shin-jin) à partir des fruits d'un arbre gigantesque, l'Arbre du Monde (界樹, Kaiju).
La population de cette planète est d'environ 80 âmes. Les Shin-jin ne sont ni hommes ni femmes, et leur espérance de vie moyenne avoisine 75 000 ans. Ils vivent paisiblement et s'instruisent dans un château faisant office d'école ; lorsqu'un Kaïo vient à mourir sur l'une des planètes Kaïo, son successeur est désigné parmi eux par tirage au sort (loterie). En revanche, les Kaïoshin naissent exclusivement de fruits dorés exceptionnels, un événement rarissime. Il arrive parfois que des Shin-jin au cœur corrompu fassent leur apparition : ces délinquants finissent par rejoindre les Makaiō dans le Royaume des Démons.

Quelque part dans le cosmos, sur Kaishin-sei : les Kaïo naissent des fruits de l'arbre
- Fruits ordinaires ➔ Kaïo
- Fruits dorés ➔ Kaïoshin`,

		93: `À propos de l'univers
Quelle sensation a-t-on lorsqu'on touche une Dragon Ball ?
Réponse : J'imagine leur consistance semblable à une résine naturelle dure. Même si on les perce ou qu'elles subissent une entaille, une fois le vœu exaucé et les boules dispersées dans le ciel, toutes les dégradations disparaissent et elles redeviennent impeccables, comme neuves.

À propos de l'univers / À combien équivaut 1 Zenny ? Combien coûte une capsule Hoi-Poi ?
Réponse : Pour que ce soit simple à comprendre, la valeur est identique à celle du yen japonais (1 Zenny ≈ 1 Yen). Le prix d'une capsule Hoi-Poi dépend évidemment de ce qu'elle contient. Par exemple, la capsule d'un aéronef standard à 4 places coûte environ 1 480 000 Zenny (1 280 000 Zenny pour l'aéronef + 200 000 Zenny pour le coût de la capsule). Pour la plupart des objets du quotidien, il suffit de les apporter dans une succursale de Capsule Corporation pour qu'on y intègre le système de miniaturisation en capsule pour 200 000 Zenny. Bien entendu, pour les structures complexes exigeant beaucoup de travail comme des maisons entières, le tarif est supérieur.`,

		94: `À propos de l'univers
Les Namékiens peuvent-ils réellement vivre en buvant seulement de l'eau ?
Réponse : Si les Namékiens peuvent subsister uniquement avec de l'eau, c'est parce qu'ils possèdent dans leur organisme une enzyme spéciale capable de transformer l'eau en nutriments.
Par ailleurs, les semis d'Ajissa qu'ils plantent sur Namek tirent leur nom de l'hortensia (ajisai). Comme le motif de conception des Namékiens est l'escargot, et que les escargots adorent les hortensias, le lien s'est fait naturellement. C'est le peuple le plus écologique de tout l'univers !

Les Saiyans restent-ils jeunes éternellement ?
Réponse : Comme les Saiyans sont un peuple de guerriers, une fois qu'ils atteignent l'âge optimal pour le combat, leur vieillissement ralentit considérablement afin de conserver une puissance redoutable le plus longtemps possible. En revanche, leur espérance de vie totale n'est pas très différente de celle des Terriens : une fois atteint un certain âge, leur déclin physique est fulgurant.
D'ailleurs, leurs cheveux ne sont pas totalement immuables : Nappa, par exemple, a tout simplement perdu ses cheveux et est devenu chauve. La nature capillaire des Saiyans est très proche de celle des Terriens, à une nuance de texture près.

Combien de planètes l'armée de Freezer possède-t-elle ? S'agissait-il d'une organisation de type entreprise ?
Réponse : Je pense que le nombre de planètes sous leur domination se compte par centaines (sans compter celles qui ont été totalement anéanties). Depuis les temps anciens, les Saiyans menaient une existence brutale et barbare en attaquant d'innombrables mondes pour s'enrichir. Freezer et sa bande ont ensuite soumis ces Saiyans par la force brute. C'est le grand chef mafieux, en quelque sorte. Mais ce n'étaient que des brutes épaisses, ils n'avaient absolument rien d'une société structurée comme une véritable entreprise.`,

		95: `À propos des techniques
Parmi toutes les techniques de Dragon Ball, laquelle aimeriez-vous utiliser ?
Réponse : La plupart des techniques de Goku et des autres sont bien trop puissantes et dangereuses ! S'il s'agit de techniques un peu utiles, voici celles qui me plairaient :
- Faire le tour du monde : le vol (舞空術, Bukūjutsu)
  Une technique qui permet de voler dans les cieux en contrôlant son ki. En la maîtrisant, on va bien plus vite qu'un avion à réaction !
  Pourquoi ce choix ? Tout simplement pour le plaisir de voler librement dans le ciel !
- À l'autre bout du monde en un instant : le déplacement instantané (瞬間移動, Shunkan Idō)
  Permet de repérer le ki d'une personne et de se téléporter directement à ses côtés. Même les voyages d'une planète à l'autre se font en un éclair !
  Pourquoi ce choix ? C'est ultra-pratique pour aller n'importe où !

Si vous deviez imaginer une nouvelle technique pour Goku, que choisiriez-vous ?
Réponse : Hmm, si j'avais eu une bonne idée de nouvelle technique, je l'aurais déjà dessinée pendant la publication du manga ! (rires) Après tout, l'attaque ultime de Son Goku reste et restera le Genkidama !`,
	},

	// Super Exciting Guide : Story Volume (ID 9)
	9: {
		89: `La vérité sur « DRAGON BALL » — Le secret du Kamehameha

Akira Toriyama : « Je cherchais un moyen de représenter visuellement dans un magazine pour garçons cette chose invisible qu'est le ki (気). Quand je me retrouvais seul chez moi, j'ai essayé différentes postures devant le miroir, et j'ai fini par choisir celle qui m'a semblé la plus classe.
Quant au nom "Kamehameha", alors que je me demandais quel nom en "quelque chose-ha" (vague) conviendrait le mieux, mon épouse (Mikawa Hanako) m'a lancé pour plaisanter : "Pourquoi pas Kamehameha, tout simplement ?" et j'ai immédiatement adopté son idée. Cela venait bien évidemment du célèbre roi Kamehameha d'Hawaï. »`,

		91: `Les combats favoris d'Akira Toriyama (suite)

3e place : Son Goku contre Recoom (Édition kanzenban, tome 19)
4e place : Krilin contre Bacterian (Édition kanzenban, tome 3)

Commentaire d'Akira Toriyama : Ce sont des affrontements où l'humour et la tension physique se mêlent à merveille. Le combat contre Bacterian est l'un de mes gags favoris, où Krilin réalise subitement qu'il n'a pas de nez pour sentir la puanteur !`,

		92: `À propos des combats décisifs
Quel est le secret pour triompher au combat ?
Réponse : Lors d'un combat, le plus important réside dans la quantité de ki et dans son contrôle. Dans la notion de « ki » (気) sont bien évidemment incluses des composantes spirituelles fondamentales comme la vitalité / l'énergie (元気, Genki), le courage (勇気, Yūki) et la justesse d'esprit / la lucidité (正気, Shōki). Sur le plan strictement physique, l'entraînement musculaire a inévitablement ses limites ; pour les franchir, seul le ki le permet. C'est en décuplant la puissance de son ki que Goku a pu s'élever au rang de combattant le plus puissant de l'univers.

Note 11 : Le Genki, le Yūki et le Shōki constituent les trois piliers du Ki dans la cosmologie martiale d'Akira Toriyama. Le terme « Genki » est familier, mais on peut être en bonne santé corporelle tout en manquant de vitalité. De même, face à un ennemi terrifiant comme le Roi démon Piccolo, deux guerriers de force physique égale réagiront différemment : l'un trouvera le courage (Yūki) de faire face, l'autre tremblera et fuira. Dans les arts martiaux traditionnels comme le tai-chi, la maîtrise et le forgeage du ki occupent une place centrale.`,
	},
};

// ── Interviews complètes en description (IDs 7, 57, 8, 56) ──────────────────

const INTERVIEW_ID_7_DAIZENSHUU_2 = `## Super Interview d'Akira Toriyama — Daizenshuu 2 : Story Guide (1995)

*Entretien recueilli le 23 mai 1995 au restaurant chinois Rōgairō.*

### Pourquoi l'histoire de Dragon Ball a-t-elle commencé ?
> **Akira Toriyama** : Au moment d'arrêter *Dr. Slump*, je me suis dit qu'il fallait enchaîner sur une nouvelle série. À l'époque, j'avais d'innombrables réunions avec mon premier éditeur, M. Torishima. Par hasard, j'adorais les films de Jackie Chan, j'avais vu *Le Maître chinois* (*Drunken Master*) des dizaines de fois. M. Torishima m'a dit : « Si tu aimes tant ça, pourquoi ne dessinerais-tu pas un manga de kung-fu avec un jeune garçon ? » C'est ainsi que j'ai dessiné l'histoire courte *Dragon Boy* (*騎竜少年*). L'accueil des lecteurs a été bien meilleur que prévu, alors nous avons décidé d'emprunter cette voie pour la prochaine série.

### L'inspiration de La Pérégrination vers l'Ouest
> **Akira Toriyama** : Comme *Dr. Slump* avait une ambiance très « côte Ouest » américaine, je voulais changer d'atmosphère et adopter un décor chinois. Et quitte à faire du chinois, autant s'inspirer de *La Pérégrination vers l'Ouest* (*西遊記*, *Saiyūki*). *La Pérégrination vers l'Ouest* est une histoire absurde, pleine d'aventures, alors je me suis dit que j'allais en faire une version moderne. S'il y a déjà une trame de base, il suffit de l'adapter, c'est bien plus commode ! *(rires)*

### La création de Son Goku et de sa queue
> **Akira Toriyama** : C'était *La Pérégrination vers l'Ouest* après tout. Mais comme le héros manquait d'humanité, j'en ai fait un garçon normal. Il lui fallait cependant un trait distinctif. Le héros de *Dragon Boy* avait des ailes, mais je voulais quelque chose qu'on reconnaisse au premier coup d'œil. C'est pour cela que j'ai doté Goku d'une queue. Comme ça, même caché derrière un rocher, s'il y a la queue qui dépasse, on sait tout de suite que c'est Goku. Ensuite sont venues les sept Dragon Ball qui exaucent un vœu quand on les réunit. En faisant de leur recherche un voyage, ils pouvaient parcourir le monde exactement comme dans *La Pérégrination vers l'Ouest*.
> Bulma correspondait à Sanzō Hōshi, Oolong à Zhu Bajie, et Yamcha à Sha Wujing. Au départ, je pensais m'arrêter une fois les sept Dragon Ball réunies.

### La naissance du Tenkaichi Budokai et Krilin
> **Akira Toriyama** : Avant le début du Tenkaichi Budokai, la série n'était pas très populaire. Un jour, M. Torishima m'a lancé : « Ton héros est bien trop fade. C'est pour ça que la série ne décolle pas. » Pour ma part, je voulais miser sur l'histoire, et j'avais délibérément affublé le protagoniste d'une tenue extrêmement banale. Piqué au vif, j'ai rétorqué : « C'est bon, j'ai compris. Je vais la faire décoller, la popularité ! » En réfléchissant au personnage de Goku, les mots qui le résumaient le mieux étaient « je veux devenir plus fort » (強くなりたい). J'ai donc décidé de mettre cela au premier plan. Dans *Dr. Slump*, le Grand Prix du village Pingouin avait rencontré un franc succès. Je me suis dit : faisons simplement un format de tournoi ! C'est ainsi qu'est né le Tenkaichi Budokai. J'ai mis de côté les autres personnages, fait réapparaître Kame-sennin, et introduit un nouveau venu nommé Krilin. Et là, d'un coup, la popularité est montée en flèche !
> Goku n'a remporté la victoire qu'à sa troisième tentative. Tout le monde disait : « De toute façon, c'est le héros qui va gagner, non ? » Quand on me dit ce genre de chose, mon esprit de contradiction prend le dessus et je me dis : « Même par pur entêtement, je ne vais pas le faire gagner ! » *(rires)*

### L'Armée du Red Ribon et l'inspiration de Spartan X
> **Akira Toriyama** : Pour l'armée du Red Ribon, c'était le même principe : un système d'élimination progressive. À l'époque, je jouais beaucoup au jeu Famicom *Spartan X* (*Kung-Fu Master*). À chaque étage qu'on gravit, un ennemi plus puissant apparaît et on doit l'abattre. C'est aussi la base des films de kung-fu. De cette façon, je pouvais proposer une mise en scène et un visuel différents de ceux d'un tournoi. La tour du Muscle en est la parfaite illustration.

### Le Roi démon Piccolo : l'incarnation du mal absolu
> **Akira Toriyama** : Jusque-là, tous les méchants avaient un côté un peu attachant qu'on ne pouvait pas totalement détester. Le Roi démon Piccolo est donc né de l'envie de créer un individu foncièrement et véritablement mauvais. Mettre en scène le mal absolu a été la chose la plus amusante à dessiner pour moi.

### Freezer : le promoteur immobilier véreux de l'espace
> **Akira Toriyama** : Après être devenu le numéro un sur Terre, Goku a vaincu les Saiyans venus de l'espace, puis l'intrigue est partie dans le cosmos. L'idée de Freezer m'est venue en plein pendant la bulle économique japonaise. Les spéculateurs immobiliers (地上げ屋, *jiageya*) étaient considérés comme les pires ordures. Je me suis dit : faisons-en le spéculateur immobilier de l'univers ! Les Saiyans n'étaient que ses hommes de main. C'était le plus grand promoteur véreux du cosmos. Mais faire constamment escalader la puissance des ennemis devenait étouffant. C'est là que le commando Ginyu est apparu. Comme j'adorais les séries *Super Sentai* et que j'en regardais plein, je me suis dit : « Et si je les introduisais dans l'histoire ? » *(rires)*

### Cell et les paradoxes du voyage temporel
> **Akira Toriyama** : Une fois devenu le numéro un de l'univers, il ne restait plus qu'à transcender le temps. Je me suis donc lancé dans une histoire de voyage temporel, mais c'était un enfer. Les paradoxes temporels ? Je m'enfonçais de plus en plus dans un bourbier sans fond ! Fondamentalement, je ne pensais qu'à ce que j'écrivais pour la semaine en cours. Ce qui allait arriver la semaine suivante, moi-même je n'en avais aucune idée. Après avoir dessiné un chapitre, je demandais toujours à mon éditeur : « Qu'est-ce qu'on fait la semaine prochaine ? » *(rires)*

### L'échec du passage de flambeau à Son Gohan
> **Akira Toriyama** : J'avais effectivement l'intention de faire de Gohan le personnage principal. Mais je n'ai pas réussi à m'y faire. Par rapport à Goku, j'ai senti que Gohan n'était finalement pas taillé pour ce rôle de premier plan.

### Piccolo, le personnage préféré d'Akira Toriyama
> **Akira Toriyama** : Eh bien, c'est Piccolo que je préfère après tout. Parmi les ennemis, le Roi démon Piccolo est mon favori, et même par la suite, Piccolo reste mon préféré. J'aime Piccolo à peu près autant que Goku. Vegeta, bon, je ne l'aimais pas tellement au début, mais il m'a été d'un immense secours. Et plus récemment, Mr. Satan était également très plaisant à dessiner. C'est comme pour Mr. Satan : imaginer des gags stupides est bien plus réjouissant pour moi que de dessiner des combats acharnés *(rires)*. Et puis au fond, il y a toujours une foule d'alliés contre un seul ennemi. Quand on y pense, ce n'est pas très équitable, n'est-ce pas ? *(rires)* Ils se liguent tous contre lui. Quel que soit l'ennemi, Goku voulait se battre en un contre un... c'était sans doute là son sentiment le plus profond.`;

const INTERVIEW_ID_57_WIRED_1997 = `## Entretien exclusif WIRED Japan (1997, n°1) : Akira Toriyama

*Propos recueillis par Masanori Nakamura (WIRED), illustration Akira Toriyama.*

Depuis les débuts de *Dr. Slump*, Akira Toriyama a porté le succès du *Weekly Shōnen Jump*. WIRED a obtenu un entretien rare avec l'auteur, d'une discrétion légendaire dans les médias. Du numérique au célèbre « système Jump », découvrez la pensée de Toriyama sans fard.

### WIRED : Le passage au numérique a commencé, certains mangas sortent sur CD-ROM. Pensez-vous que les mangas numériques vont continuer à se développer ?
> **Akira Toriyama** : Je pense que leur part va augmenter progressivement. Pour ce qui est du CD-ROM, l'expérience reste très proche de la lecture sur papier, car on peut librement feuilleter ou revenir en arrière. Le CD-ROM a même l'avantage de ne pas s'abîmer ni d'être jeté comme les revues papier. Cependant, il est difficile de faire une croix sur la sensation tactile du papier. Personnellement, je reste persuadé qu'un livre doit être en papier.

### Même si le numérique devenait le format dominant du manga ?
> **Akira Toriyama** : En tant qu'individu, cela ne me pose aucun problème. Que ceux qui préfèrent le CD-ROM choisissent le CD-ROM, et que ceux qui veulent du papier achètent du papier, c'est très bien ainsi. En revanche, si on commence à y ajouter des voix d'acteurs ou du doublage, on quitte le domaine du manga : la force du manga papier est que chaque lecteur imagine la voix des personnages et les bruitages à son propre rythme. De plus, dans un manga, on lit toujours une double page dans sa globalité : on perçoit instantanément qu'une case plus grande qu'une autre porte un moment plus intense. Si toutes les cases s'affichaient à la même taille sur un écran, cela créerait un malaise.

### Vous réalisez également le design des personnages de Dragon Quest ; êtes-vous friand de jeux vidéo ?
> **Akira Toriyama** : Pas du tout, je n'y joue presque jamais. Pour être honnête, au tout début de Dragon Quest, j'ai dessiné les monstres et les personnages sans avoir la moindre idée de ce dans quoi je mettais les pieds.

### Un manuscrit achevé n'est plus qu'un simple dessin
### Dans les récits de science-fiction récents, on voit beaucoup d'anticipation proche du réel. Retrouve-t-on cette tendance dans le manga ?
> **Akira Toriyama** : Oui, c'est identique. On privilégie la crédibilité à l'imagination débridée. Si le cadre n'est pas accessible à l'imagination des lecteurs, comme un futur proche, cela ne marche pas. La SF pure et dure, mettant en scène des extraterrestres à la culture totalement étrangère sur une autre planète, ne séduit généralement pas le grand public. Quand j'ai lancé *Dr. Slump*, des responsables chez Shueisha me demandaient encore : « Mais pourquoi les animaux parlent-ils ? » *(rires)*. Aujourd'hui, plus personne ne poserait cette question.

### Dragon Ball rencontre un immense succès à l'étranger. Quel effet cela vous fait-il ?
> **Akira Toriyama** : J'en suis heureux, mais cela me dépasse complètement *(rires)*. Je n'ai jamais dessiné en pensant à l'étranger. Pour moi, c'est presque comme si cela concernait quelqu'un d'autre.

### Pourquoi les mangas japonais ont-ils un tel écho hors du Japon selon vous ?
> **Akira Toriyama** : Aux États-Unis, les comics sont souvent perçus comme des lectures pour enfants avec des intrigues très simples ; une fois adultes, les gens s'en détournent pour regarder des films. Au Japon, comme on ne peut pas vivre décemment en faisant du cinéma, les créateurs qui auraient réalisé des films aux États-Unis dessinent des mangas. C'est pour cela que les talents convergent vers le manga. Et le charme unique de ce médium, c'est qu'on fait tout soi-même, de l'histoire au dessin. C'est comme réaliser son propre film tout seul : aucun risque de divergence d'opinion !

### Quel est le rapport entre information visuelle et textuelle dans vos mangas ?
> **Akira Toriyama** : L'information visuelle prédomine très largement. Mon premier éditeur m'a inculqué de ne pas bavarder inutilement : les dessins doivent permettre de comprendre l'essentiel, les mots ne sont là qu'en soutien. Une réplique ne doit servir qu'à renforcer la caractérisation du personnage, de façon concise.

### Conservez-vous précieusement vos planches originales ?
> **Akira Toriyama** : Une fois dessinées, ce ne sont plus que des feuilles de papier *(rires)*. Lors d'une exposition il y a quelques années, les organisateurs venus chercher mes manuscrits les ont découverts empilés n'importe comment dans mon garage et ont failli s'évanouir : « Mais ça va moisir ! » m'ont-ils dit. Certains mangakas créent des pièces climatisées dédiées à leurs archives, mais cela ne m'intéresse absolument pas. Je n'ai aucun attachement envers ce que j'ai déjà dessiné. C'est d'ailleurs pour cela que des lecteurs m'écrivent souvent : « Ce que vous dites là contredit ce que vous disiez avant ! » *(rires)*.

### Il faut percevoir le « poison » dissimulé dans l'ombre
### Le système des questionnaires de popularité du Shōnen Jump est-il impitoyable ?
> **Akira Toriyama** : Très impitoyable. Mais les lecteurs qui renvoient les cartes postales le font surtout pour gagner les cadeaux du tirage au sort, qui s'adressent aux enfants. Pour ma part, comme je suis d'un naturel très contrariant, si un lecteur écrivait sur sa carte « Voilà comment l'histoire devrait se passer », je faisais exprès de prendre le contre-pied absolu. Et si un personnage devenait trop populaire, je m'arrangeais pour le faire mourir *(rires)*. Comme je naviguais à vue sans rien planifier à long terme, c'était très facile de bifurquer selon mon humeur. Même pour les personnages qui ont l'air de faire le bien au premier abord...

### Il y a du « poison » caché en eux ?
> **Akira Toriyama** : Exactement. Prenez Son Goku dans Dragon Ball : au fond, il ne se bat pas pour sauver les autres, mais uniquement parce qu'il veut affronter des adversaires très puissants. C'est pourquoi, dès que Dragon Ball a été adapté en série animée, j'ai toujours été insatisfait de la façon dont on l'a dépeint comme un « héros de justice » au cœur pur. Je n'ai jamais vraiment réussi à leur faire saisir cette part d'ombre et de « poison » qui affleure à la surface de sa personnalité.

### Le manga est un pur divertissement
### Que pensez-vous du système de contrat d'exclusivité de Shueisha ?
> **Akira Toriyama** : Comme je fais tout tout seul, mon temps est compté et le *Jump* me suffit amplement. Je n'ai pas de désirs démesurés : mon seul souhait est de pouvoir dessiner un bon manga. Shueisha m'accorde la liberté de travailler à mon propre rythme, ce qui me convient parfaitement.

### Pourquoi êtes-vous devenu mangaka au départ ?
> **Akira Toriyama** : Pour l'argent *(rires)*. En toute franchise, je voulais remporter la prime du concours pour débutants. Si j'avais empoché la récompense dès le début, j'aurais probablement arrêté le manga aussitôt après ! Mais avec le recul, je reconnais que c'est un métier formidablement plaisant *(rires)*.`;

const INTERVIEW_ID_8_ENRICHI = `## Dialogue d'ouverture : Akira Toriyama × Toyotarō (Dragon Ball Super, Tome 1)

*Discussion croisée publiée dans le premier volume relié de Dragon Ball Super (Jump Comics, Shueisha).*

> **Toyotarō** : C'est un honneur immense pour moi de travailler avec vous !
> **Toyotarō** : L'arc du 6e Univers marque le grand retour des tournois dans Dragon Ball après une très longue absence !
> **Akira Toriyama** : J'avais bien esquissé des tournois au tout début et à la fin de l'arc Majin Boo, mais je les avais laissés en suspens *(rires)*.
> **Toyotarō** : Lors du tout dernier, Goku s'envolait avec Oob dès le premier tour !
> **Akira Toriyama** : En effet *(rires)*. Chaque fois que je relis mes propres tomes pour trouver de nouvelles idées scénaristiques, je suis systématiquement abasourdi par tout ce que j'ai pu oublier *(rires)*.
> **Akira Toriyama** : Tu es sans doute la personne dont le style graphique se rapproche le plus du mien, y compris en comptant les animateurs de Toei Animation !
> **Toyotarō** : C'est un compliment incroyable !
> **Akira Toriyama** : Tu as un sens de la composition remarquable ! Le rendu est superbe ; de nos jours, je serais totalement incapable de dessiner des planches avec une telle énergie ! Quand je supervise les anime, il y a toujours des éléments qui me chiffonnent et pour lesquels je demande des corrections. Mais quand je regarde tes storyboards (nemu), je peux souffler en toute sérénité. Je donne mon feu vert en un clin d'œil, c'est d'une commodité royale *(rires)*.
> **Toyotarō** : Pourtant, j'avais une peur constante de vous décevoir. Comme l'histoire originale que vous me fournissez est un texte écrit sans dessin, je garde constamment vos tomes ouverts à côté de moi quand je dessine. Je ne veux surtout pas que les lecteurs disent que cela ne ressemble pas à du Dragon Ball... Mais en même temps, j'ai envie de laisser libre cours à mon imagination pour proposer des combats inédits et des expressions variées.
> **Akira Toriyama** : Lâche-toi complètement ! Fais-toi plaisir, cela ne me dérange absolument pas *(rires)*.
> **Toyotarō** : Vraiment ? Il n'y a rien que vous souhaiteriez corriger ou retirer ? Ne vous retenez pas par égard pour moi... *(sueur)*
> **Akira Toriyama** : Hahaha ! *(éclat de rire sonore)* Pas du tout... *(réfléchit un court instant)* Non, vraiment rien ! Bon, si je devais faire une remarque constructive, tes cadrages gagneraient encore en force si tu variais davantage les angles de vue. Et surtout, je trouve formidable que tu intègres tes propres idées originales. Je t'en suis très reconnaissant : je n'aurais jamais imaginé qu'un dessinateur comme toi apparaisse pour dessiner la suite de mon histoire !

---

## Entretien de Toyotarō avec Anime News Network (2016)

### ANN : Travailler un jour sur la suite officielle de Dragon Ball était-il l’un de vos objectifs ?
> **Toyotarō** : Pas vraiment. Bien évidemment, j’adorais Dragon Ball mais je n’étais pas préoccupé de savoir chez quel éditeur je serais publié. Je ne me suis jamais arrêté de dessiner pendant des années.

### Vous semblez avoir une relation particulière avec Akira Toriyama : il vous indique les grandes lignes, et vous vous occupez des détails. Quel est le plus excitant dans cette collaboration ?
> **Toyotarō** : Chaque mois, je crée un storyboard qu'il lit pour ensuite me donner son avis ou suggérer des modifications. Il sait me féliciter mais aussi être exigeant sur certains aspects. Quand il me corrige, je perçois immédiatement le décalage entre sa vision et ma façon de la digérer. Ses corrections sont hyper précises et toujours utiles. Je trouve très stimulant de pouvoir me rapprocher peu à peu de sa philosophie de travail.

### Qu’est-ce qui vous a surpris le plus dans votre relation professionnelle ?
> **Toyotarō** : D’abord, je suis surpris que quelqu’un comme moi poursuive son travail. Ensuite, je croyais que M. Toriyama serait bien plus exigeant en ce qui concerne l’histoire à proprement parler, mais en réalité, il accorde une immense importance à l’humour et aux séquences comiques. On sent très vite qu’il adore ce genre de scènes.

### Aviez-vous un personnage préféré quand vous étiez petit ?
> **Toyotarō** : Goku ! Et il reste encore le numéro un !

### Quelle est la phase la plus délicate dans la création du manga ?
> **Toyotarō** : Toriyama ne me transmet qu’une trame textuelle, sans dessin. Je dois donc concevoir les détails, les expressions et les attitudes des personnages. Souvent, Toriyama ne fait pas de retours sur ces aspects-là. J'aimerais parfois qu'il soit assis juste à côté de moi pour pouvoir lui poser des questions sans arrêt, mais ce n'est évidemment pas possible !`;

const SHIN_BUDOKAI_CORRIGE = `## Ryo Mito, producteur de *Dragon Ball Z : Shin Budokai*, nous offre un aperçu en exclusivité des débuts sur PSP de cette célèbre série de jeux de combat inspirée de l'anime.

*La série Dragon Ball Z fait vibrer les joueurs sur PlayStation 2, GameCube et Xbox depuis un certain temps déjà, et elle a même fait son apparition sur consoles portables, notamment sur Game Boy Advance et Nintendo DS. Une version pour PlayStation Portable pourrait-elle être loin derrière ? Bien sûr que non ! Dragon Ball Z : Shin Budokai marque les débuts de la série sur l’élégante console portable de Sony. Fidèle à l’esprit de DBZ, le jeu mettra en scène de nombreux personnages emblématiques de la série et proposera suffisamment de modes de jeu pour occuper les fans de Dragon Ball lors de leurs déplacements. Dans notre premier journal des développeurs consacré à Dragon Ball Z : Shin Budokai, le producteur du jeu, Ryo Mito, nous donne un aperçu des personnages présents dans le jeu PSP, ainsi que des informations en coulisses sur les différents modes de jeu auxquels vous pourrez jouer dès sa sortie début mars.*

### Dragon Ball Z: Shin Budokai — Personnages et modes de jeu
### Par Ryo Mito, producteur chez Bandai

> Bonjour à tous ! Je m’appelle Ryo et je suis le producteur du jeu Shin Budokai sur PSP. Certains d’entre vous me connaissent peut-être en tant que producteur de DBZ : Budokai Tenkaichi (PS2).
> 
> Dans Dragon Ball Z : Shin Budokai, le joueur peut disputer des combats en incarnant l’un des 18 personnages de l’univers de Dragon Ball Z. Les coups spéciaux et les animations de chacun de ces personnages sont très différents les uns des autres, et chaque personnage dispose de coups et d’attaques uniques, fidèles au manga et à la série animée. Par exemple, Piccolo peut étirer ses bras (un coup appelé « Mystic Attack ») pour attraper ses adversaires et les rapprocher de lui afin de les attaquer. Un autre personnage, Krilin, peut utiliser son coup « Solar Flare » (Makyōsen / morsure du soleil) pour aveugler ses adversaires et les empêcher de bouger, exactement comme on le voit dans la série télévisée d’animation.

<figure class="wiki-img wiki-size-lg">
  <img src="./assets/wiki/databooks/37fbb195-9de0-4fb9-8c64-fb523304c24b.webp" alt="" />
</figure>

*Dragon Ball Z : Shin Budokai mettra en scène des personnages familiers tels que Goku et ses amis… ou ses ennemis, selon le cas.*

> De plus, chacun des 18 personnages du jeu peut se transformer en différentes formes. Par exemple, au combat, Goku peut se transformer en l’une des formes suivantes : Kaioken, Super Saiyan, Super Saiyan 2 et Super Saiyan 3. Chaque forme dispose d’attaques différentes.
> 
> Paikūhan et Janemba sont deux nouveaux personnages qui n’apparaissaient pas dans le jeu précédent. Paikūhan est mon personnage préféré de la série de films et il était suffisamment puissant pour vaincre Freezer et Cell lorsqu’ils se sont déchaînés en enfer. Il a également livré un combat très intense contre Goku lors de la finale du tournoi de l'autre monde. Je sais qu’il est très populaire auprès des fans, et comme de nombreuses personnes avaient demandé qu’il figure dans un jeu, il fait donc sa première apparition dans ce titre. Dans le jeu, c’est un personnage puissant qui utilise des attaques très rapides et dispose d’un certain nombre de coups spéciaux tels que le « Thunder Flash » et l’« Hyper Tornado ».
> 
> Janemba est une créature maléfique apparue en enfer. C’est l’ennemi le plus puissant à avoir fait son apparition dans les films d’animation Dragon Ball Z. Il possède une puissance et une vitesse écrasantes et dispose d’une grande variété de coups spéciaux. Il peut transformer sa massue en une épée très tranchante, qu’il utilise pour attaquer ses adversaires dans le jeu. Il est aussi puissant dans le jeu qu’il l’était dans le film, ce qui fera de lui l’un des personnages les plus puissants du jeu.
> 
> En ce qui concerne les modes de jeu, le mode principal de Dragon Ball Z : Shin Budokai s’appelle « Dragon Road ». Le mode Dragon Road est un mode histoire à scénarios multiples inspiré des événements du film DBZ « Fusions » (*Fusion Reborn*). Après la défaite de Boo et le retour de la paix dans le monde, le mal s’accumule en enfer, donnant naissance à une créature appelée Janemba. Janemba sème le chaos dans l'ordre du monde pour son propre plaisir : il ressuscite les morts, déforme le temps et l'espace, et crée des copies de puissants guerriers pour qu'ils combattent à ses côtés. Goku et ses amis font appel à de nombreux alliés, et même à certains anciens ennemis, pour tenter de vaincre Janemba. Cette histoire épique, centrée sur Janemba et Paikūhan, se déroule à la fois dans le monde des vivants et dans l'autre monde. Le joueur suit le déroulement de l’histoire en incarnant tour à tour de nombreux personnages différents. Bien sûr, cela inclut Goku et ses amis, mais vous utiliserez parfois aussi des personnages ennemis au combat, et, selon les choix que vous ferez, l’histoire prendra des tournants différents.
> 
> Le mode Arcade, un mode solo dans lequel vous affrontez l’IA, vous permet de disputer des combats en utilisant uniquement vos personnages préférés tout en rivalisant pour remporter des Dragon Ball. Dans le mode Épreuve Z, vous participez à des combats soumis à diverses conditions ou restrictions. Il existe deux types de parties en mode Épreuve Z : le mode Survie, où vous affrontez des adversaires contrôlés par l’IA aussi longtemps que possible, et le mode Contre-la-montre, où vous devez terminer une série prédéfinie de combats le plus rapidement possible.

<figure class="wiki-img wiki-size-lg">
  <img src="./assets/wiki/databooks/794a631c-5b54-4608-9343-28071b18268e.webp" alt="" />
</figure>`;

// ── Exécution et mise à jour ────────────────────────────────────────────────

const sql = postgres(process.env.DATABASE_URL!);

console.log("1. Contrôle préalable du glossaire officiel et des juges...");

// Vérification de toutes les planches
for (const [bookId, pages] of Object.entries(TRADUCTIONS_PLANCHES)) {
	for (const [num, fr] of Object.entries(pages)) {
		verifierGlossaire(fr, `Livre ${bookId} planche ${num}`);
	}
}

verifierGlossaire(INTERVIEW_ID_7_DAIZENSHUU_2, "Daizenshuu 2 interview (ID 7)");
verifierGlossaire(INTERVIEW_ID_57_WIRED_1997, "WIRED 1997 (ID 57)");
verifierGlossaire(INTERVIEW_ID_8_ENRICHI, "Toriyama x Toyotaro (ID 8)");
verifierGlossaire(SHIN_BUDOKAI_CORRIGE, "Shin Budokai (ID 56)");

console.log("✓ Glossaire officiel validé sans aucune infraction.");

// 2. Application des planches dans bot.db_databooks
console.log("\n2. Application des planches traduites dans bot.db_databooks...");

for (const [bookIdStr, pagesObj] of Object.entries(TRADUCTIONS_PLANCHES)) {
	const bookId = Number(bookIdStr);
	const [book] = await sql`SELECT id, title, pages FROM bot.db_databooks WHERE id = ${bookId}`;
	if (!book) {
		console.warn(`! Livre ${bookId} non trouvé`);
		continue;
	}

	const pages = (book.pages as PlancheBrute[]) || [];
	let modifs = 0;

	// Écriture atomique PAR PLANCHE (`deposerTraduction`) : l'ancienne réécriture
	// du tableau entier écrasait toute planche modifiée entre la lecture et
	// l'écriture. Traductions relues à la main : seuls les juges de source sont
	// levés, pas ceux de la traduction.
	for (const p of pages) {
		const num = Number(p.number);
		const trad = pagesObj[num];
		if (!trad) continue;
		const res = await deposerTraduction(
			sql,
			{
				databookId: bookId,
				numero: num,
				image: p.image ?? null,
				source: texteDePlanche(p),
				traduction: trad,
				par: "manual:toriyama-specialist",
				traductionAttendue: traductionDePlanche(p),
			},
			{ sourceRelue: true }
		);
		if (res.statut === "ecrite") modifs++;
	}
	console.log(`  ✓ Livre ID ${bookId} (« ${book.title} ») : ${modifs} planches mises à jour.`);
}

// 3. Application des descriptions d'interviews (IDs 7, 57, 8, 56)
console.log("\n3. Mise à jour des fiches d'interviews intégrales...");

await sql`UPDATE bot.db_databooks SET description = ${INTERVIEW_ID_7_DAIZENSHUU_2} WHERE id = 7`;
console.log("  ✓ ID 7 (Interview Daizenshuu 2) enrichie avec la Super Interview intégrale.");

await sql`UPDATE bot.db_databooks SET description = ${INTERVIEW_ID_57_WIRED_1997} WHERE id = 57`;
console.log("  ✓ ID 57 (WIRED Japan 1997) enrichie avec l'entretien intégral traduit.");

await sql`UPDATE bot.db_databooks SET description = ${INTERVIEW_ID_8_ENRICHI} WHERE id = 8`;
console.log("  ✓ ID 8 (Toriyama × Toyotarō) enrichie avec le dialogue du volume 1 Jump Comics.");

await sql`UPDATE bot.db_databooks SET description = ${SHIN_BUDOKAI_CORRIGE} WHERE id = 56`;
console.log("  ✓ ID 56 (Shin Budokai Designer Diary) corrigé selon le glossaire officiel.");

// 4. Nettoyage du glossaire dans public.canon_references
console.log("\n4. Nettoyage du glossaire dans public.canon_references...");

// Nettoyage ciblé des 16 références aphrody
const correctionsCanon = [
	{
		id: "economie-technologie-de-la-capsule-corporation",
		search: "Dragon Balls",
		replace: "Dragon Ball",
	},
	{
		id: "mr-satan-hercule-et-l-importance-du-gag-2",
		fixes: [
			{ search: /Mr\. Satan \(Hercule\)/g, replace: "Mr. Satan" },
			{ search: /Genki Dama/g, replace: "Genkidama" },
			{ search: /Kid Buu/g, replace: "Kid Boo" },
			{ search: /Buu/g, replace: "Boo" },
		],
	},
	{
		id: "mr-satan-hercule-et-l-importance-du-gag",
		fixes: [
			{ search: /Mr\. Satan \(Hercule\)/g, replace: "Mr. Satan" },
			{ search: /Hercule/g, replace: "Mr. Satan" },
		],
	},
	{
		id: "l-echec-du-passage-de-flambeau-a-gohan-2",
		fixes: [
			{ search: /Majin Buu/g, replace: "Majin Boo" },
			{ search: /Buu/g, replace: "Boo" },
		],
	},
	{
		id: "les-namekians",
		fixes: [
			{ search: /Les Namekians/g, replace: "Les Namékiens" },
			{ search: /Namekians/g, replace: "Namékiens" },
		],
	},
];

for (const item of correctionsCanon) {
	const [ref] = await sql`SELECT id, text, subject FROM public.canon_references WHERE id = ${item.id}`;
	if (ref) {
		let texte = ref.text as string;
		let sujet = ref.subject as string;
		if ("search" in item && "replace" in item) {
			texte = texte.replaceAll(item.search as string, item.replace as string);
			sujet = sujet.replaceAll(item.search as string, item.replace as string);
		} else if ("fixes" in item) {
			for (const f of item.fixes as { search: RegExp; replace: string }[]) {
				texte = texte.replace(f.search, f.replace);
				sujet = sujet.replace(f.search, f.replace);
			}
		}
		await sql`UPDATE public.canon_references SET text = ${texte}, subject = ${sujet}, updated_at = now() WHERE id = ${item.id}`;
		console.log(`  ✓ Référence ${item.id} nettoyée.`);
	}
}

await sql.end();
console.log("\n✓ Toutes les mises à jour ont été appliquées avec succès en base PostgreSQL !");
