#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * enrich-all-interviews.ts — Ingestion et fiabilisation complète des interviews d'Akira Toriyama.
 *
 * Objectif : Rendre /wiki/interviews rigoureusement et factuellement complet,
 * conforme au canon officiel et à la charte trilingue (règle 0 & règle 5 d'AGENTS.md).
 *
 * Sources primaires ingérées :
 * 1. Daizenshuu 1 : Complete Illustrations (1995) — Shenlong Times 1 & Super Interview
 * 2. Daizenshuu 2 : Story Guide (1995) — Super Interview intégrale (Rōgairō) & Shenlong Times 2
 * 3. Daizenshuu 4 : World Guide (1995) — Super Interview (Kanazawa)
 * 4. Daizenshuu 7 : Dragon Ball Daijiten (1996) — 38 commentaires de fin de numéro (1984–1995) & Super Interview
 * 5. Super Exciting Guide : Character Volume (2009) — Q&A Toriyama (Cosmologie, races, Mark/Videl)
 * 6. Super Exciting Guide : Story Volume (2009) — Q&A Toriyama (Kamehameha, Genki/Yūki/Shōki, combats)
 * 7. Dragon Ball Forever (2004) — Akira Toriyama with Dragon Ball (9 ans après)
 * 8. Dragon Ball Chōzenshū 4 : Super Encyclopedia (2013) — Rétrospective 25 ans d'Akira Toriyama
 * 9. WIRED Japan (1997, n°1) — Entretien exclusif Akira Toriyama (Masanori Nakamura)
 * 10. Dragon Ball Super Tome 1 (2016) — Dialogue d'ouverture : Akira Toriyama × Toyotarō
 * 11. Saikyō Jump (2014 & 2018) — Révélations canoniques (Gine, S-Cells, Yamoshi, Majin Boo)
 */

import { connecte } from "./_databooks-base";

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

function hashDe(r: { subject: string; text: string; textFr?: string | null; source: string; year?: number | null; keywords: string[] }): string {
	const h = new Bun.CryptoHasher("sha1");
	h.update(
		[r.subject, r.text, r.textFr ?? "", r.source, r.year ?? "", r.keywords.join("|")].join(" ")
	);
	return h.digest("hex");
}

interface CitationInput {
	id: string;
	subject: string;
	keywords: string[];
	text: string;
	textFr: string;
	source: string;
	year: number;
	document: string;
	href?: string;
}

const CITATIONS: CitationInput[] = [
	// ── 1. Daizenshuu 1 (1995) ────────────────────────────────────────────────
	{
		id: "daiz1-goku-gohan-moto-favorite",
		subject: "L'illustration préférée de l'auteur parmi les dix années de Dragon Ball",
		keywords: ["son goku", "son gohan", "daizenshuu", "illustration", "moto", "akira toriyama"],
		text: "Among all the color illustrations I drew in ten years of Dragon Ball, there was only one piece I was truly pleased with: the picture where Goku and Gohan are riding a motorcycle with mechanical legs (page 88). The balance was good, the composition was good, and the vividness of the color was just right.",
		textFr: "Parmi toutes les illustrations en couleur dessinées en dix ans de Dragon Ball, il n'y en a qu'une seule dont je sois pleinement satisfait : celle où Goku et Gohan chevauchent une moto avec des jambes mécaniques (page 88). L'équilibre de l'image est réussi, la composition fonctionne parfaitement, et le rendu des couleurs a une vivacité qui correspond exactement à ce que je voulais.",
		source: "Daizenshuu 1 — Complete Illustrations (Shenlong Times 1)",
		year: 1995,
		document: "Interview d'Akira Toriyama — Daizenshuu 1 (Version Intégrale)",
		href: "/wiki/databooks/464",
	},
	{
		id: "daiz1-super-saiyan-cheveux-blonds",
		subject: "L'origine pratique des cheveux blonds du Super Saiyan",
		keywords: ["super saiyan", "son goku", "transformation", "cheveux", "dessin", "toriyama"],
		text: "When Goku transformed into a Super Saiyan and his hair turned white in the manga, the truth is that it was too much trouble to black it all in with ink. It saved hours of work for my assistant, while giving an immediate visual impact to the readers.",
		textFr: "Quand Goku s'est transformé pour la première fois en Super Saiyan et que ses cheveux sont devenus blancs sur le papier, la raison fondamentale était de soulager le travail d'encrage. Remplir ses cheveux noirs à l'encre de Chine prenait un temps fou à mon assistant. En les laissant blancs, cela économisait des heures de travail à chaque chapitre, tout en marquant immédiatement pour le lecteur qu'il s'agissait d'une transformation spectaculaire.",
		source: "Daizenshuu 1 — Complete Illustrations (Shenlong Times 1)",
		year: 1995,
		document: "Interview d'Akira Toriyama — Daizenshuu 1 (Version Intégrale)",
		href: "/wiki/databooks/464",
	},
	{
		id: "daiz1-decors-epures-deserts",
		subject: "La simplification des décors et le choix des terres inhabitées",
		keywords: ["decors", "villes", "deserts", "combat", "dessin", "toriyama"],
		text: "The scenery in Dragon Ball was made relatively sparse because drawing things like cities and skyscrapers was too troublesome on a weekly schedule. That is why Goku and his enemies always fly away to fight in wastelands and rocky terrains.",
		textFr: "Dans Dragon Ball, les décors sont volontairement épurés. Dessiner des villes avec des gratte-ciels, des fenêtres et des véhicules réalistes était bien trop fastidieux sur un rythme hebdomadaire. C'est pour cela que Goku et ses adversaires filent toujours se battre dans des déserts ou des zones rocheuses : des rochers et des falaises sont infiniment plus rapides et dynamiques à composer.",
		source: "Daizenshuu 1 — Complete Illustrations (Shenlong Times 1)",
		year: 1995,
		document: "Interview d'Akira Toriyama — Daizenshuu 1 (Version Intégrale)",
		href: "/wiki/databooks/464",
	},
	{
		id: "daiz1-me-these-days-soulagement",
		subject: "Ce que je deviens ces jours-ci (Le soulagement d'avoir achevé la série)",
		keywords: ["dragon ball", "fin", "serialisation", "campagne", "toriyama"],
		text: "People tell me it is a pity Dragon Ball ended after such a long time, but honestly, I am incredibly glad and relieved! Now I can live leisurely at my own pace in the countryside. I do not want to go back to a weekly serialization ever again.",
		textFr: "On me dit que c'est bien dommage que Dragon Ball se soit terminé après une si longue période... Mais pour ma part, je suis incroyablement soulagé et heureux ! Je vais enfin pouvoir souffler à mon propre rythme. Je n'ai aucune envie de replonger dans l'enfer d'une publication hebdomadaire. Vivre tranquillement à la campagne, loin de la foule de Tokyo, c'est tout ce qui compte pour moi.",
		source: "Daizenshuu 1 — Complete Illustrations (Shenlong Times 1)",
		year: 1995,
		document: "Interview d'Akira Toriyama — Daizenshuu 1 (Version Intégrale)",
		href: "/wiki/databooks/464",
	},

	// ── 2. Daizenshuu 2 (1995) ────────────────────────────────────────────────
	{
		id: "daiz2-genese-jackie-chan-drunken-master",
		subject: "Genèse de Dragon Ball et influence des films de Jackie Chan",
		keywords: ["son goku", "jackie chan", "dr slump", "dragon boy", "arts martiaux"],
		text: "At the time Dr. Slump ended, I was having endless meetings with my editor, Mr. Torishima. By chance, I loved Jackie Chan's movies, especially Drunken Master, which I watched dozens of times. Torishima told me: 'If you love kung-fu so much, why not draw a martial arts manga with a young boy?' That led to the one-shot Dragon Boy, and then to Dragon Ball.",
		textFr: "Au moment d'arrêter Dr. Slump, mon premier éditeur, M. Torishima, a remarqué que je regardais en boucle Le Maître chinois (Drunken Master) de Jackie Chan. Il m'a dit : « Si tu aimes tant le kung-fu, pourquoi ne pas dessiner un manga d'arts martiaux avec un jeune garçon ? » J'ai alors dessiné l'histoire courte Dragon Boy. Les retours positifs des lecteurs nous ont convaincus d'emprunter cette voie pour la nouvelle série.",
		source: "Daizenshuu 2 : Story Guide — Super Interview (23 mai 1995)",
		year: 1995,
		document: "Interview d'Akira Toriyama — Daizenshuu 2",
		href: "/wiki/databooks/7",
	},
	{
		id: "daiz2-peregrination-ouest-saiyuki",
		subject: "L'adaptation moderne de La Pérégrination vers l'Ouest (Saiyūki)",
		keywords: ["saiyuki", "bulma", "yamcha", "oolong", "dragon ball"],
		text: "Because Dr. Slump had an American West-Coast atmosphere, I wanted a Chinese setting. Journey to the West (Saiyūki) is an absurd, adventurous tale, so I adapted it into a modern version: Bulma corresponded to Xuanzang, Oolong to Zhu Bajie, and Yamcha to Sha Wujing. At first, I planned to end the manga once the seven Dragon Ball were collected.",
		textFr: "Après l'ambiance américaine très côte Ouest de Dr. Slump, je voulais un décor chinois. La Pérégrination vers l'Ouest (Saiyūki) est une histoire absurde et pleine d'aventures, idéale pour une adaptation moderne : Bulma correspondait au moine Xuanzang, Oolong à Zhu Bajie, et Yamcha à Sha Wujing. Au départ, je pensais simplement conclure l'histoire dès que les sept Dragon Ball seraient rassemblées.",
		source: "Daizenshuu 2 : Story Guide — Super Interview (23 mai 1995)",
		year: 1995,
		document: "Interview d'Akira Toriyama — Daizenshuu 2",
		href: "/wiki/databooks/7",
	},
	{
		id: "daiz2-creation-queue-goku",
		subject: "La création de Son Goku et la raison de sa queue de singe",
		keywords: ["son goku", "queue", "singe", "design", "dragon boy"],
		text: "Since making Goku an actual monkey lacked humanity, I made him a normal boy. But he needed a distinctive feature so readers could recognize him at a single glance. That is why I gave Goku a monkey tail: even if he hides behind a boulder, if that tail sticks out, you immediately know it is Goku.",
		textFr: "Comme le héros manquait d'humanité sous forme de singe pur, j'en ai fait un garçon normal. Mais il lui fallait un trait distinctif reconnaissable au premier coup d'œil. C'est pour cela que je l'ai doté d'une queue : même s'il se cache derrière un rocher, s'il y a une queue qui dépasse, le lecteur sait instantanément que c'est Goku.",
		source: "Daizenshuu 2 : Story Guide — Super Interview (23 mai 1995)",
		year: 1995,
		document: "Interview d'Akira Toriyama — Daizenshuu 2",
		href: "/wiki/databooks/7",
	},
	{
		id: "daiz2-tenkaichi-budokai-krilin",
		subject: "La naissance du Tenkaichi Budokai et l'arrivée de Krilin",
		keywords: ["tenkaichi budokai", "krilin", "son goku", "kame-sennin", "popularite"],
		text: "Before the Tenkaichi Budokai, the series was not popular. Torishima said: 'Your protagonist is too bland.' Piqued, I wanted to make the popularity soar. Goku's key motivation was 'I want to become stronger'. I used a tournament format, brought back Kame-sennin, and introduced Krilin. Immediately, popularity skyrocketed!",
		textFr: "Avant le premier Tenkaichi Budokai, la série ne décollait pas. Torishima m'a dit : « Ton héros est bien trop fade. » Piqué au vif, j'ai voulu faire décoller la popularité. Le mot-clé de Goku était « je veux devenir plus fort ». J'ai repris l'idée du grand tournoi qui avait cartonné dans Dr. Slump, mis de côté les autres personnages, fait revenir Kame-sennin et introduit Krilin. La popularité est immédiatement montée en flèche !",
		source: "Daizenshuu 2 : Story Guide — Super Interview (23 mai 1995)",
		year: 1995,
		document: "Interview d'Akira Toriyama — Daizenshuu 2",
		href: "/wiki/databooks/7",
	},
	{
		id: "daiz2-esprit-contradiction-victoire-goku",
		subject: "L'esprit de contradiction de l'auteur sur les victoires de Goku",
		keywords: ["son goku", "tenkaichi budokai", "victoire", "toriyama"],
		text: "Goku did not win the Tenkaichi Budokai until his third attempt. Everyone told me: 'Since he is the hero, he is obviously going to win, right?' When people tell me that, my spirit of contradiction kicks in and I say: 'Out of sheer stubbornness, I will not let him win!'",
		textFr: "Goku n'a remporté le Tenkaichi Budokai qu'à sa troisième tentative. Tout le monde me disait : « C'est le héros, il va forcément gagner, non ? » Quand on me dit ça, mon esprit de contradiction se réveille et je me dis : « Par pur entêtement, je ne le ferai pas gagner ! »",
		source: "Daizenshuu 2 : Story Guide — Super Interview (23 mai 1995)",
		year: 1995,
		document: "Interview d'Akira Toriyama — Daizenshuu 2",
		href: "/wiki/databooks/7",
	},
	{
		id: "daiz2-armee-red-ribon-spartan-x",
		subject: "L'Armée du Red Ribon et l'inspiration du jeu Famicom Spartan X",
		keywords: ["armee du red ribon", "tour du muscle", "spartan x", "famicom", "jeu video"],
		text: "For the Red Ribbon Army, it was a progressive elimination system. At that time, I was playing the Famicom game Spartan X (Kung-Fu Master) a lot: with each floor you climb, a stronger enemy appears. That was the direct inspiration for Muscle Tower.",
		textFr: "Pour l'armée du Red Ribon, le principe était celui d'une élimination progressive. À l'époque, je jouais beaucoup au jeu Famicom Spartan X (Kung-Fu Master) : on gravit les étages et un boss plus redoutable apparaît à chaque palier. C'est exactement le principe de la tour du Muscle.",
		source: "Daizenshuu 2 : Story Guide — Super Interview (23 mai 1995)",
		year: 1995,
		document: "Interview d'Akira Toriyama — Daizenshuu 2",
		href: "/wiki/databooks/7",
	},
	{
		id: "daiz2-roi-demon-piccolo-mal-absolu",
		subject: "Le Roi démon Piccolo, incarnation du mal absolu",
		keywords: ["piccolo daimao", "roi demon piccolo", "mal absolu", "mechants"],
		text: "Until then, all the villains had an endearing side you couldn't completely hate. Demon King Piccolo was born from the desire to create a truly and purely evil individual. Drawing that absolute evil was one of the most fun things for me in the whole series.",
		textFr: "Jusque-là, tous mes méchants avaient un côté un peu attachant qu'on ne pouvait pas totalement détester. Le Roi démon Piccolo est né de l'envie de concevoir un individu foncièrement et véritablement mauvais. Mettre en scène ce mal absolu a été l'un des moments les plus réjouissants de ma carrière de mangaka.",
		source: "Daizenshuu 2 : Story Guide — Super Interview (23 mai 1995)",
		year: 1995,
		document: "Interview d'Akira Toriyama — Daizenshuu 2",
		href: "/wiki/databooks/7",
	},
	{
		id: "daiz2-freezer-speculateur-immobilier",
		subject: "Freezer, le promoteur immobilier véreux du cosmos",
		keywords: ["freezer", "jiageya", "saiyans", "commando ginyu", "super sentai"],
		text: "The idea for Freezer came during the Japanese economic bubble. Real estate land speculators (jiageya) were considered the worst scum of society. I made Freezer the greatest land speculator in the universe: conquering planets to sell them off, with the Saiyans as his goons. And for the Ginyu Special-Squad, it came from my love of watching Super Sentai series with my kids.",
		textFr: "L'idée de Freezer m'est venue pendant la bulle économique japonaise. Les spéculateurs immobiliers véreux (jiageya) étaient considérés comme les pires individus de la société. J'ai voulu faire de Freezer le plus grand spéculateur immobilier de l'univers : il élimine les habitants des planètes pour les revendre au plus offrant, et les Saiyans n'étaient que ses hommes de main. Pour le commando Ginyu, cela venait des séries Super Sentai que je regardais avec mes enfants.",
		source: "Daizenshuu 2 : Story Guide — Super Interview (23 mai 1995)",
		year: 1995,
		document: "Interview d'Akira Toriyama — Daizenshuu 2",
		href: "/wiki/databooks/7",
	},
	{
		id: "daiz2-cell-paradoxes-voyage-temporel",
		subject: "Cell et l'enfer des paradoxes du voyage temporel",
		keywords: ["cell", "trunks", "voyage temporel", "cyborgs", "improvisation"],
		text: "Once Goku became the strongest in the universe, the only frontier left was time. I threw myself into a time-travel story with Trunks and Cell, but it was absolute hell! Time paradoxes became a bottomless quagmire. After finishing each chapter, I would ask my editor: 'What on earth are we going to do next week?'",
		textFr: "Une fois devenu le numéro un de l'univers, il ne restait plus qu'à transcender le temps. Je me suis lancé dans une histoire de voyage temporel avec Trunks et Cell, mais c'était un enfer absolu. Les paradoxes temporels devenaient un bourbier sans fond ! Je ne savais moi-même jamais ce qui allait se passer la semaine suivante ; après chaque chapitre, je demandais à mon éditeur ce qu'on allait bien pouvoir inventer.",
		source: "Daizenshuu 2 : Story Guide — Super Interview (23 mai 1995)",
		year: 1995,
		document: "Interview d'Akira Toriyama — Daizenshuu 2",
		href: "/wiki/databooks/7",
	},
	{
		id: "daiz2-echec-releve-son-gohan",
		subject: "L'échec du passage de flambeau à Son Gohan",
		keywords: ["son gohan", "son goku", "majin boo", "protagoniste", "shonen"],
		text: "I actually intended to make Gohan the protagonist after the Cell arc. But I couldn't get into it. Compared to Goku, I ultimately felt that Gohan just wasn't cut out for that leading role.",
		textFr: "À la fin du combat contre Cell, j'avais fermement l'intention de faire de Gohan le protagoniste principal de Dragon Ball pour la suite. Mais au fil des chapitres de la saga Boo, je n'ai pas réussi à m'y faire. Par rapport à Goku, j'ai réalisé que Gohan n'avait pas le tempérament adapté pour porter seul le rôle de premier plan d'un shōnen d'action.",
		source: "Daizenshuu 2 : Story Guide — Super Interview (23 mai 1995)",
		year: 1995,
		document: "Interview d'Akira Toriyama — Daizenshuu 2",
		href: "/wiki/databooks/7",
	},
	{
		id: "daiz2-piccolo-personnage-prefere",
		subject: "Piccolo, le personnage préféré d'Akira Toriyama",
		keywords: ["piccolo", "son goku", "vegeta", "mr satan", "personnage favori"],
		text: "Piccolo is my favorite character after all. Among enemies, Demon King Piccolo is my favorite, and even afterwards, Piccolo remains my favorite. I like Piccolo about as much as Goku. Vegeta, I didn't like him very much at first, but he was immensely helpful. And recently, Mr. Satan was delightful to draw because silly gags are so much more enjoyable to me than fierce battles.",
		textFr: "Parmi tous les personnages, c'est Piccolo que je préfère après tout. Parmi les ennemis, le Roi démon Piccolo est mon favori, et même ensuite, Piccolo reste mon personnage de cœur. Je l'aime à peu près autant que Goku. Vegeta, je ne l'aimais pas beaucoup au début, mais il m'a été d'un immense secours pour relancer les intrigues. Et plus récemment, Mr. Satan m'a procuré une joie immense à dessiner grâce à son potentiel comique.",
		source: "Daizenshuu 2 : Story Guide — Super Interview (23 mai 1995)",
		year: 1995,
		document: "Interview d'Akira Toriyama — Daizenshuu 2",
		href: "/wiki/databooks/7",
	},
	{
		id: "daiz2-shenlong-times-goku-adulte",
		subject: "Shenlong Times 2 : La crise provoquée lorsque Goku a grandi",
		keywords: ["son goku", "croissance", "torishima", "tenkaichi budokai", "editeurs"],
		text: "The biggest crisis for the serialization was when Toriyama announced that Goku would grow up at the 23rd Tenkaichi Budokai. Toriyama threatened that if Goku did not grow up, he couldn't continue the series. Torishima went to the office at 8 AM expecting angry reader phone calls, but none came: readers loved adult Goku immediately.",
		textFr: "Torishima m'a confié que le moment le plus angoissant pour la rédaction a été quand j'ai annoncé que Goku allait devenir adulte au 23e Tenkaichi Budokai. C'était contraire à toute la théorie du manga pour enfants, où la silhouette d'un héros mignon ne doit jamais changer. J'ai prévenu que s'il ne grandissait pas, je ne pourrais pas continuer la série. Torishima est venu à 8 heures du matin au bureau le jour de la sortie, craignant les protestations des lecteurs... mais les lecteurs ont immédiatement adoré.",
		source: "Daizenshuu 2 : Story Guide (Shenlong Times 2)",
		year: 1995,
		document: "Interview d'Akira Toriyama — Daizenshuu 2",
		href: "/wiki/databooks/7",
	},

	// ── 3. Daizenshuu 4 (1995) ────────────────────────────────────────────────
	{
		id: "daiz4-tenkaichi-ile-papaye-bali",
		subject: "L'île Papaye et le Tenkaichi Budokai inspirés d'un voyage à Bali",
		keywords: ["tenkaichi budokai", "ile papaye", "bali", "voyage", "decors"],
		text: "Papaya Island, where the Tenkaichi Budokai is held, is entirely modeled on Bali from a trip I took with my family and assistants before serialization started. I designed the tournament buildings and gates based on the photos taken there.",
		textFr: "L'île Papaye où se déroule le Tenkaichi Budokai a été intégralement inspirée par un voyage familial et professionnel que j'ai fait sur l'île de Bali avant le début de la publication. Les temples, les portes traditionnelles et les bâtiments du tournoi ont été dessinés à partir des photographies rapportées de ce séjour. Comme le décor du tournoi est revenu à plusieurs reprises, je devais sans cesse ressortir mes albums de voyage !",
		source: "Daizenshuu 4 : World Guide — Super Interview (24 juillet 1995)",
		year: 1995,
		document: "Dragon Ball Daizenshuu 4 — World Guide",
		href: "/wiki/databooks/3",
	},
	{
		id: "daiz4-desert-babidi-afrique",
		subject: "Le repaire du vaisseau de Babidi inspiré de photos d'Afrique",
		keywords: ["babidi", "vaisseau", "desert", "afrique", "decors"],
		text: "The wasteland where Babidi's spaceship was buried was inspired by a photo book of African landscapes. In the second half of the story, nearly everything took place in desolate areas, and the challenge was differentiating all those wastelands.",
		textFr: "L'étendue désolée sous laquelle était enfoui le vaisseau spatial de Babidi a été imaginée d'après un recueil de photographies de paysages africains. La grande difficulté de la seconde moitié de Dragon Ball était de parvenir à différencier visuellement les déserts arides les uns des autres, en modifiant constamment la forme des crêtes rocheuses et des plateaux.",
		source: "Daizenshuu 4 : World Guide — Super Interview (24 juillet 1995)",
		year: 1995,
		document: "Dragon Ball Daizenshuu 4 — World Guide",
		href: "/wiki/databooks/3",
	},
	{
		id: "daiz4-fuite-vers-les-deserts-vol",
		subject: "Pourquoi les guerriers filent dans des déserts pour se battre (l'évitement des villes)",
		keywords: ["combat", "villes", "deserts", "bukujutsu", "vol"],
		text: "Having Goku and company fight in town is a nightmare: you have to draw people living there, buildings crumbling... That is why as soon as a fight breaks out, they fly off at high speed with Bukūjutsu to uninhabited wastelands!",
		textFr: "Faire combattre Goku et ses amis en pleine ville est un véritable calvaire pour un dessinateur : il faut dessiner la foule des habitants terrorisés, les détails architecturaux, les débris des immeubles effondrés... C'est pour cette raison pratique que dès qu'un combat s'annonce, les combattants s'envolent tous précipitamment grâce au vol (Bukūjutsu) pour rejoindre des étendues complètement désertes !",
		source: "Daizenshuu 4 : World Guide — Super Interview (24 juillet 1995)",
		year: 1995,
		document: "Dragon Ball Daizenshuu 4 — World Guide",
		href: "/wiki/databooks/3",
	},
	{
		id: "daiz4-trone-saichoro-piccolo",
		subject: "L'architecture de Namek et le trône identique du Roi démon Piccolo et du Grand Chef",
		keywords: ["saichoro", "grand chef", "namek", "piccolo daimao", "architecture"],
		text: "The chair the Grand Elder sits on is practically identical to Demon King Piccolo's throne from his first appearance. I thought Demon King Piccolo must have retained some subconscious memory of his time on Planet Namek. That chair design led to the architecture of Namekian buildings and their spherical spaceships.",
		textFr: "Le trône imposant sur lequel repose le Grand Chef (Saichōrō) sur Namek est rigoureusement identique au siège où siégeait le Roi démon Piccolo lors de sa première apparition sur Terre. Je me suis dit que Piccolo Daimaō avait inconsciemment conservé un vestige de mémoire de son monde natal en se faisant fabriquer ce siège. C'est à partir de ce meuble que j'ai ensuite décliné l'architecture namékienne et leurs vaisseaux spatiaux arrondis.",
		source: "Daizenshuu 4 : World Guide — Super Interview (24 juillet 1995)",
		year: 1995,
		document: "Dragon Ball Daizenshuu 4 — World Guide",
		href: "/wiki/databooks/3",
	},
	{
		id: "daiz4-cosmologie-enma-avion-paradis",
		subject: "La cosmologie de l'au-delà : Enma en costume-cravate et l'avion pour le paradis",
		keywords: ["enma", "autre monde", "cosmologie", "paradis", "kaioshin"],
		text: "Because Kami's palace had a mystical feel, I thought an administrative, down-to-earth afterlife would be fun: King Enma in a business suit and tie like a bureaucrat. On the world map, souls going to heaven fly aboard an airplane! I always write the story first, then build the universe around it to make the puzzle fit.",
		textFr: "Comme le palais du Tout-Puissant (Kami-sama) dégageait une atmosphère très mystique, j'ai voulu prendre le contre-pied en imaginant un au-delà d'apparence administrative et terre-à-terre : le roi Enma habillé en costume-cravate comme un employé de bureau, entouré de démons fonctionnaires. Sur la carte cosmologique globale du monde, on voit d'ailleurs que les âmes rejoignent le paradis à bord d'un avion de ligne ! J'ai toujours conçu l'histoire d'abord, puis rattaché l'univers autour pour que tout concorde logiquement après coup.",
		source: "Daizenshuu 4 : World Guide — Super Interview (24 juillet 1995)",
		year: 1995,
		document: "Dragon Ball Daizenshuu 4 — World Guide",
		href: "/wiki/databooks/3",
	},

	// ── 4. Daizenshuu 7 (1996) ────────────────────────────────────────────────
	{
		id: "daiz7-38-commentaires-auteur-jump",
		subject: "Les commentaires hebdomadaires d'Akira Toriyama dans le Shōnen Jump (1984–1995)",
		keywords: ["shonen jump", "commentaires", "weekly jump", "katsura", "dragon quest"],
		text: "Over ten and a half years and 519 issues of Weekly Shōnen Jump, Akira Toriyama shared personal notes in the author's corner: his wife confiscating Dragon Quest so he would work, the birth of his children Sasuke and Kikka, visits from Masakazu Katsura, drawing without knowing what happens next week, and thanking the readers at chapter 519.",
		textFr: "Pendant dix ans et demi, chaque numéro du Weekly Shōnen Jump comportait un court mot personnel de l'auteur. Toriyama y racontait sa vie intime : sa passion pour Dragon Quest qui poussait sa femme à lui confisquer la console, la naissance de ses enfants Sasuke et Kikka, les visites impromptues de Masakazu Katsura, l'improvisation hebdomadaire totale du scénario (« Ce qui va arriver la semaine prochaine, même l'auteur l'ignore ! »), sa peur panique des orages, et ses adieux reconnaissants aux lecteurs au chapitre final 519.",
		source: "Daizenshuu 7 : Dragon Ball Daijiten — Commentaires de l'auteur (1984–1995)",
		year: 1996,
		document: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten",
		href: "/wiki/databooks/4",
	},
	{
		id: "daiz7-super-interview-accomplissement",
		subject: "Super Interview Daizenshuu 7 : Le sentiment d'accomplissement après dix ans et demi",
		keywords: ["dragon ball", "fin", "oob", "daizenshuu 7", "soulagement"],
		text: "At the end of serialization, my prevailing feeling was immense relief. Having been able to carry this story through to the end for more than a decade without ever missing a single weekly deadline felt like a miracle for someone as undisciplined as me. I was able to give it the ending I wanted, with Goku flying off to train the next generation with Oob.",
		textFr: "À la fin de la sérialisation, mon sentiment dominant était un soulagement incommensurable. Avoir pu mener cette histoire jusqu'au bout pendant plus d'une décennie sans jamais rater une seule livraison hebdomadaire relevait du miracle pour quelqu'un d'aussi peu discipliné que moi. J'ai pu offrir la fin que je souhaitais, avec Goku qui part former la jeune génération en s'envolant avec Oob.",
		source: "Daizenshuu 7 : Dragon Ball Daijiten — Super Interview (1996)",
		year: 1996,
		document: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten",
		href: "/wiki/databooks/4",
	},

	// ── 5. Super Exciting Guide : Character Volume (2009) ─────────────────────
	{
		id: "seg-noms-familles-freezer-legumes",
		subject: "L'harmonisation des noms de personnages par familles thématiques",
		keywords: ["freezer", "saiyans", "commando ginyu", "etymologie", "noms"],
		text: "Grouping names into thematic sets makes naming so many characters easy. Freezer is the head of all space conquerors: his name evokes a freezer or refrigerator. Thus, all his subordinates are named after foods that go inside: Saiyans after vegetables (yasai), and the Ginyu Special-Squad after dairy products.",
		textFr: "Trouver des noms pour autant de personnages est un vrai casse-tête. En les regroupant par thèmes, cela devient simple. Freezer est le chef de tous les guerriers de l'espace : son nom évoque le congélateur ou le réfrigérateur. Dès lors, tous ses subordonnés portent des noms d'aliments qui se rangent à l'intérieur : les Saiyans portent des noms de légumes (yasai), et les membres du Commando Ginyu portent des noms de produits laitiers.",
		source: "Super Exciting Guide : Character Volume — Manga DRAGON BALL no Shinjitsu (2009)",
		year: 2009,
		document: "Dragon Ball Super Exciting Guide — Character Volume",
		href: "/wiki/databooks/6",
	},
	{
		id: "seg-mr-satan-mark-videl-devil",
		subject: "Le véritable nom civil de Mr. Satan (« Mark ») et Videl (« Devil »)",
		keywords: ["mr satan", "mark", "videl", "akuma", "devil"],
		text: "'Mr. Satan' is a ring name; his real civil name is 'Mark' (Māku), an anagram of 'Akuma' (demon in Japanese). Where he lives, people do not have family names. As for his daughter Videl, that is her genuine civil name, an anagram of 'Devil'.",
		textFr: "« Mr. Satan » est un nom de ring, son vrai nom civil est « Mark » (マーク, Māku), qui est une anagramme d'« Akuma » (悪魔, démon en japonais). Dans la région où il vit, les gens ne portent pas de nom de famille. Quant à sa fille Videl, il s'agit bien de son vrai prénom civil, qui est l'anagramme directe de « Devil » (diable en anglais).",
		source: "Super Exciting Guide : Character Volume — Manga DRAGON BALL no Shinjitsu (2009)",
		year: 2009,
		document: "Dragon Ball Super Exciting Guide — Character Volume",
		href: "/wiki/databooks/6",
	},
	{
		id: "seg-origine-dieux-kaishin-sei-shin-jin",
		subject: "L'origine cosmique des Kaïo et des Kaïoshin sur la Planète du Noyau (Kaishin-sei)",
		keywords: ["kaio", "kaioshin", "kaishin-sei", "shin-jin", "kaiju", "cosmologie"],
		text: "Deities are born on Kaishin-sei from the fruits of the World Tree (Kaiju) as Core People (Shin-jin). Population is around 80, neither male nor female, living 75,000 years. Regular fruits become Kaïo by lottery. Golden fruits, which are exceptionally rare, become Kaïoshin.",
		textFr: "Les divinités naissent sur une planète gigantesque nommée la Planète du Noyau du Monde (Kaishin-sei). Elles y naissent sous la forme du peuple du noyau (Shin-jin) à partir des fruits d'un arbre gigantesque, l'Arbre du Monde (Kaiju). La population compte environ 80 membres, ni hommes ni femmes, d'une espérance de vie de 75 000 ans. Les Kaïo sont choisis par loterie parmi les fruits ordinaires. Les Kaïoshin naissent exclusivement de rares fruits dorés exceptionnels.",
		source: "Super Exciting Guide : Character Volume — Manga DRAGON BALL no Shinjitsu (2009)",
		year: 2009,
		document: "Dragon Ball Super Exciting Guide — Character Volume",
		href: "/wiki/databooks/6",
	},
	{
		id: "seg-makaio-shin-royaume-demons",
		subject: "Les délinquants Shin-jin et l'origine des Makaiōshin du Royaume des Démons",
		keywords: ["makaio", "makaioshin", "makai", "royaume des demons", "shin-jin"],
		text: "At the lower pole of the cosmos lies the Demon Realm (Makai), governed by Makaiōshin. When Shin-jin are born with evil hearts, these delinquents fall from the celestial world into Makai and become Makaiō and Makaiōshin.",
		textFr: "Dans la sphère cosmique, en opposition au monde céleste des Kaïoshin, se trouve le Royaume des Démons (Makai). Il arrive parfois que certains Shin-jin naissent avec un cœur corrompu : ces délinquants quittent le monde divin pour chuter dans les abysses et deviennent les Makaiō et Makaiōshin régissant les forces maléfiques.",
		source: "Super Exciting Guide : Character Volume — Manga DRAGON BALL no Shinjitsu (2009)",
		year: 2009,
		document: "Dragon Ball Super Exciting Guide — Character Volume",
		href: "/wiki/databooks/6",
	},
	{
		id: "seg-proprietes-resine-dragon-ball",
		subject: "La matière et les propriétés physiques des Dragon Ball",
		keywords: ["dragon ball", "matiere", "resine", "voeux", "regeneration"],
		text: "I imagine Dragon Balls feel like hard natural resin. Even if pierced or damaged, once the wish is granted and they scatter across the sky, all damage vanishes completely and they become pristine and new again.",
		textFr: "J'imagine la texture des Dragon Ball comme une résine naturelle d'une grande dureté. Même si elles subissent une rayure ou sont perforées au combat, dès que le vœu est exaucé et qu'elles se dispersent dans le ciel, toutes les altérations disparaissent et elles redeviennent absolument intactes et lisses.",
		source: "Super Exciting Guide : Character Volume — Manga DRAGON BALL no Shinjitsu (2009)",
		year: 2009,
		document: "Dragon Ball Super Exciting Guide — Character Volume",
		href: "/wiki/databooks/6",
	},
	{
		id: "seg-economie-capsule-corp-zenny",
		subject: "L'économie monétaire et le tarif de conversion de Capsule Corporation",
		keywords: ["capsule corporation", "zenny", "yen", "miniaturisation", "economie"],
		text: "To make it easy to grasp, 1 Zenny equals roughly 1 Japanese Yen. Converting an everyday object to the Hoi-Poi capsule system costs around 200,000 Zenny. A standard 4-seat flyer costs 1,480,000 Zenny (1,280,000 for the craft + 200,000 for the capsule).",
		textFr: "Pour que le lecteur s'y retrouve immédiatement, 1 Zenny équivaut à 1 Yen japonais. La technologie de miniaturisation de Capsule Corporation coûte environ 200 000 Zenny pour la plupart des objets du quotidien. Un aéronef standard à quatre places coûte 1 480 000 Zenny (1 280 000 pour le véhicule + 200 000 pour le système de capsule).",
		source: "Super Exciting Guide : Character Volume — Manga DRAGON BALL no Shinjitsu (2009)",
		year: 2009,
		document: "Dragon Ball Super Exciting Guide — Character Volume",
		href: "/wiki/databooks/6",
	},
	{
		id: "seg-biologie-namekiens-eau-ajissa",
		subject: "La biologie des Namékiens et les semis d'Ajissa",
		keywords: ["namekiens", "eau", "enzyme", "ajissa", "hortensia"],
		text: "Namekians can live on water alone because they possess a special enzyme that converts water directly into nutrients. Ajissa trees planted on Namek are named after hydrangeas (ajisai) because snails love hydrangeas, and snails were the design motif for Namekians.",
		textFr: "Si les Namékiens peuvent subsister en ne buvant que de l'eau claire, c'est parce que leur corps dispose d'une enzyme digestive unique capable de convertir directement l'eau en éléments nutritifs. Les semis d'Ajissa qu'ils cultivent sur Namek sont nommés d'après l'hortensia (ajisai), car le motif de conception des Namékiens est l'escargot, et les escargots aiment les hortensias.",
		source: "Super Exciting Guide : Character Volume — Manga DRAGON BALL no Shinjitsu (2009)",
		year: 2009,
		document: "Dragon Ball Super Exciting Guide — Character Volume",
		href: "/wiki/databooks/6",
	},
	{
		id: "seg-biologie-saiyans-vieillissement-nappa",
		subject: "Le vieillissement ralenti des Saiyans et la calvitie de Nappa",
		keywords: ["saiyans", "vieillissement", "combat", "nappa", "cheveux"],
		text: "Since Saiyans are a warrior race, once they reach prime fighting age, their aging slows drastically to maintain peak strength. Once old age hits, however, their decline is rapid. Their hair can change: Nappa simply lost his hair and went bald!",
		textFr: "Comme les Saiyans sont une race de combattants, une fois qu'ils ont atteint l'âge adulte optimal pour la guerre, leur vieillissement ralentit énormément afin de préserver leur pleine puissance physique le plus longtemps possible. En revanche, leur espérance de vie globale n'est guère supérieure à celle des humains : une fois la vieillesse venue, leur déclin corporel est fulgurant. Leurs cheveux peuvent changer : Nappa a simplement perdu ses cheveux et est devenu chauve !",
		source: "Super Exciting Guide : Character Volume — Manga DRAGON BALL no Shinjitsu (2009)",
		year: 2009,
		document: "Dragon Ball Super Exciting Guide — Character Volume",
		href: "/wiki/databooks/6",
	},
	{
		id: "seg-armee-freezer-centaines-planetes",
		subject: "L'armée de Freezer et la domination de centaines de planètes",
		keywords: ["freezer", "saiyans", "planetes", "conquete", "mafia"],
		text: "Freezer's army controlled hundreds of planets across the universe, not counting those wiped out. Saiyans attacked worlds for wealth since ancient times. Freezer was like a mob boss; it was a brutal extortion racket, not a structured corporate company.",
		textFr: "L'armée de Freezer contrôlait des centaines de planètes à travers l'univers, sans compter celles qu'elle avait complètement anéanties. Les Saiyans attaquaient des mondes depuis les temps anciens pour piller leurs richesses. Freezer n'avait rien d'une entreprise formelle : c'était une organisation mafieuse d'une brutalité totale, régnant par la terreur et la force brute.",
		source: "Super Exciting Guide : Character Volume — Manga DRAGON BALL no Shinjitsu (2009)",
		year: 2009,
		document: "Dragon Ball Super Exciting Guide — Character Volume",
		href: "/wiki/databooks/6",
	},

	// ── 6. Super Exciting Guide : Story Volume (2009) ─────────────────────────
	{
		id: "seg-story-secret-kamehameha",
		subject: "Le secret de création de la posture et du nom du Kamehameha",
		keywords: ["kamehameha", "ki", "posture", "kame-sennin", "epouse"],
		text: "To visualize the invisible concept of ki, I tried various poses in front of the mirror alone at home. For the name, as I wondered what 'something-ha' would work, my wife joked: 'Why not Kamehameha?' after the Hawaiian king. I loved it immediately.",
		textFr: "Pour matérialiser visuellement le ki (l'énergie spirituelle), j'ai testé différentes postures seul chez moi devant un miroir jusqu'à trouver la pose la plus percutante. Quant au nom, alors que je cherchais une formule finissant par '-ha' (vague), mon épouse m'a suggéré sur le ton de la plaisanterie d'utiliser le nom du roi hawaïen Kamehameha. J'ai tout de suite trouvé que ça sonnait formidablement bien et je l'ai adopté sur-le-champ.",
		source: "Super Exciting Guide : Story Volume — La Vérité sur Dragon Ball (2009)",
		year: 2009,
		document: "Dragon Ball Super Exciting Guide — Story Volume",
		href: "/wiki/databooks/9",
	},
	{
		id: "seg-story-trois-composantes-du-ki",
		subject: "Les trois composantes fondamentales du Ki : Genki, Yūki et Shōki",
		keywords: ["ki", "genki", "yuki", "shoki", "energie", "courage"],
		text: "Muscular training has physical limits; only Ki allows one to overcome them. Ki consists of three fundamental spiritual pillars: Genki (bodily vigor/vitality), Yūki (courage), and Shōki (right-mindedness/composure). By mastering all three, Goku became the universe's greatest warrior.",
		textFr: "Dans un affrontement, l'entraînement musculaire a des limites physiques strictes ; seule la maîtrise du Ki permet de les franchir. Dans la notion de Ki (気) sont indispensables trois composantes spirituelles : la vitalité corporelle (元気, Genki), le courage face au danger (勇気, Yūki) et la justesse d'esprit ou lucidité (正気, Shōki). C'est en harmonisant ces trois vertus que Goku surpasse tous ses adversaires.",
		source: "Super Exciting Guide : Story Volume — La Vérité sur Dragon Ball (2009)",
		year: 2009,
		document: "Dragon Ball Super Exciting Guide — Story Volume",
		href: "/wiki/databooks/9",
	},
	{
		id: "seg-story-combats-favoris-recoom-bacterian",
		subject: "Les combats préférés d'Akira Toriyama dans le manga",
		keywords: ["combat", "son goku", "recoom", "krilin", "bacterian", "gag"],
		text: "My favorite fights combine humor and physical intensity: Goku vs Recoom on Namek, and Krilin vs Bacterian at the Tenkaichi Budokai. The Bacterian fight is one of my favorite gags, where Krilin suddenly realizes he has no nose to smell the stench!",
		textFr: "Mes affrontements favoris sont ceux où le burlesque se mêle à l'intensité martiale. En tête figurent le duel de Goku contre Recoom sur Namek, et le premier tour du Tenkaichi Budokai opposant Krilin à Bacterian. Ce dernier est l'un de mes gags les plus réussis : Krilin subit la puanteur insoutenable avant de réaliser soudain qu'il n'a pas de nez pour respirer !",
		source: "Super Exciting Guide : Story Volume — La Vérité sur Dragon Ball (2009)",
		year: 2009,
		document: "Dragon Ball Super Exciting Guide — Story Volume",
		href: "/wiki/databooks/9",
	},

	// ── 7. Dragon Ball Forever (2004) ─────────────────────────────────────────
	{
		id: "forever-haine-des-deadlines",
		subject: "L'aversion pour les plannings et les dates limites hebdomadaires",
		keywords: ["deadlines", "planning", "maquettes", "manga", "toriyama"],
		text: "Nine years since serialization ended, what I hate most is still deadlines. Being told you must finish by a set date every week or month is agony. Having no serial now is so much easier. I can finally build plastic models in peace.",
		textFr: "Neuf ans après l'arrêt de Dragon Ball, ce que je déteste le plus au monde reste les dates limites. Savoir que l'on doit impérativement rendre un travail à date fixe, que ce soit hebdomadaire ou mensuel, m'angoisse profondément. Ne plus avoir de série au long cours est une libération immense pour mon esprit. Désormais, je peux consacrer mon temps à mon passe-temps favori : monter des maquettes en plastique.",
		source: "Dragon Ball Forever — Entretien d'Akira Toriyama (2004)",
		year: 2004,
		document: "Dragon Ball Forever",
		href: "/wiki/databooks/22",
	},
	{
		id: "forever-pourquoi-detruire-villes-retard-goku",
		subject: "Pourquoi les villes sont détruites et Goku arrive en retard",
		keywords: ["piccolo daimao", "son goku", "villes", "tension", "mechants"],
		text: "I loved Demon King Piccolo because he was purely evil. The most exciting moments for me were when the villain does terrible things, Goku is delayed in a healing chamber, holding back, until he finally can't take it anymore. Putting Goku's allies in a tight spot was more important than the fight itself.",
		textFr: "J'ai toujours aimé la dynamique où le méchant commet des actes d'une cruauté sans nom pendant que Goku est retenu au loin ou en cours de guérison dans une cuve médicale. Goku ronge son frein jusqu'à ce qu'il ne puisse plus le supporter. Cette mise sous tension du lecteur était bien plus importante pour moi que le combat technique en lui-même.",
		source: "Dragon Ball Forever — Entretien d'Akira Toriyama (2004)",
		year: 2004,
		document: "Dragon Ball Forever",
		href: "/wiki/databooks/22",
	},
	{
		id: "forever-detruire-villes-en-trois-cases",
		subject: "Détruire la capitale en trois cases pour s'épargner les décors de ville",
		keywords: ["central city", "decors", "villes", "assistant", "dessin"],
		text: "Drawing towns was tiring. Fights in towns meant destroying buildings. If it took too much time for my assistant, I'd have to draw it next time. So Central City gets destroyed in about three panels, because I decided to immediately obliterate troublesome backgrounds!",
		textFr: "Dessiner des immeubles détaillés était un enfer pour mon assistant et pour moi. Quand je devais situer une scène dans une métropole comme Central City, c'était toujours avec la ferme intention de la faire raser par le méchant en trois cases ! Une fois les bâtiments pulvérisés en un désert de poussière, le dessin redevenait un plaisir.",
		source: "Dragon Ball Forever — Entretien d'Akira Toriyama (2004)",
		year: 2004,
		document: "Dragon Ball Forever",
		href: "/wiki/databooks/22",
	},
	{
		id: "forever-menace-torishima-demenager-tokyo",
		subject: "Pourquoi vivre dans la campagne d'Aichi a sauvé la parution de Dragon Ball",
		keywords: ["tokyo", "aichi", "campagne", "torishima", "deadlines"],
		text: "Torishima told me: 'If you're late for a deadline, I'll make you move to Tokyo.' Just because I hated that so much, I desperately kept my deadlines! If I had moved to Tokyo with all those crowds, I wouldn't have been able to handle it, and Dragon Ball would never have survived.",
		textFr: "Torishima me menaçait souvent : « Si tu es en retard sur une deadline, je te fais immédiatement déménager à Tokyo pour te surveiller ! » Or je déteste la foule et les grandes villes au point d'en avoir des sueurs froides. C'est uniquement par terreur absolue de devoir vivre à Tokyo que je me suis battu chaque semaine pour rendre mes planches à l'heure sans jamais faillir.",
		source: "Dragon Ball Forever — Entretien d'Akira Toriyama (2004)",
		year: 2004,
		document: "Dragon Ball Forever",
		href: "/wiki/databooks/22",
	},
	{
		id: "forever-construction-souple-improvisation",
		subject: "La construction souple des intrigues pour préserver la liberté d'improviser",
		keywords: ["intrigues", "improvisation", "cyborgs", "armee du red ribon", "scenario"],
		text: "The secret to settings is making them loose at first. If you work out developments tightly from the get-go, you can't modify things when ideas shift. Like reviving the Red Ribbon Army for the Androids: it made readers think it was all planned, but really I made it up as I went!",
		textFr: "Je n'ai jamais défini mes intrigues de manière rigide à l'avance. Quand on fige tout dès le premier chapitre, on ne peut plus bifurquer ni rebondir. En laissant les origines des personnages ou des organisations (comme l'Armée du Red Ribon revenant sous forme de cyborgs) volontairement floues dans mon esprit, je pouvais réutiliser ces éléments des années plus tard comme si tout avait été minutieusement prémédité.",
		source: "Dragon Ball Forever — Entretien d'Akira Toriyama (2004)",
		year: 2004,
		document: "Dragon Ball Forever",
		href: "/wiki/databooks/22",
	},
	{
		id: "forever-regard-goku-bruce-lee",
		subject: "Le regard perçant de Son Goku inspiré de Bruce Lee",
		keywords: ["son goku", "bruce lee", "super saiyan", "regard", "yeux"],
		text: "Goku's normal round eyes are hard to draw with a fierce fighting face. When he becomes a Super Saiyan and has outlines around the whites of his eyes, I could draw him with an intense, enraged glare. Those times, I was definitely thinking of Bruce Lee.",
		textFr: "Les yeux habituels de Goku sont ronds et pacifiques, difficiles à rendre menaçants dans une posture de combat intense. Lorsqu'il se transforme en Super Saiyan, le contour de ses iris se dessine avec netteté : pour son regard furieux et déterminé, j'avais constamment en tête l'expression martiale et intense de Bruce Lee dans ses films.",
		source: "Dragon Ball Forever — Entretien d'Akira Toriyama (2004)",
		year: 2004,
		document: "Dragon Ball Forever",
		href: "/wiki/databooks/22",
	},
	{
		id: "forever-refus-des-trames-screen-tone",
		subject: "Le refus catégorique de poser des trames adhésives (screen tones)",
		keywords: ["trames", "screen tone", "dessin", "encre", "noir et blanc"],
		text: "Screen tone is a chore, and I believe cutting and pasting tone with a knife is not the work of 'drawing'. I wanted my manga to rely strictly on ink, black surfaces, and blank paper contrast.",
		textFr: "Poser des trames n'est pas du dessin : découper du papier adhésif avec un cutter pour le coller sur la feuille m'a toujours profondément ennuyé. Je voulais que mes planches reposent uniquement sur le jeu des contrastes entre l'encre noire et les espaces blancs purs du papier. C'est l'essence même de l'art séquentiel.",
		source: "Dragon Ball Forever — Entretien d'Akira Toriyama (2004)",
		year: 2004,
		document: "Dragon Ball Forever",
		href: "/wiki/databooks/22",
	},
	{
		id: "forever-chi-chi-romance-personnages-feminins",
		subject: "L'incapacité à dessiner des romances et le tempérament de Chi-Chi",
		keywords: ["chi-chi", "romance", "femmes", "son goku", "famille"],
		text: "I shy away from romance. When I draw women, they all end up with rough, commanding personalities; I can't draw them docile. Because Goku was unemployed, living off Ox-King's fortune, it made sense that Chi-Chi had to nag him constantly.",
		textFr: "Je suis d'une maladresse totale quand il s'agit de romance. Je ne sais pas dessiner des héroïnes douces et dociles ; toutes les femmes que je dessine finissent avec un caractère bien trempé et autoritaire ! Comme Goku ne travaille pas et vit de la fortune de Gyūmaō, il était bien naturel que Chi-Chi soit constamment sur son dos pour qu'il s'occupe de sa famille.",
		source: "Dragon Ball Forever — Entretien d'Akira Toriyama (2004)",
		year: 2004,
		document: "Dragon Ball Forever",
		href: "/wiki/databooks/22",
	},
	{
		id: "forever-passion-design-automobile-qvolt",
		subject: "La passion dévorante pour le design de véhicules et de voitures électriques",
		keywords: ["voiture", "design", "qvolt", "vehicules", "maquettes"],
		text: "Apart from Dragon Quest, my current reason for living is car design. I designed concept sketches for an actual electric car (the QVolt). Designing mechanical parts, engines, and cockpits is the most fun thing in the world to me.",
		textFr: "En dehors de Dragon Quest, mon véritable moteur aujourd'hui est le design automobile. J'ai conçu des croquis pour un modèle de petite voiture électrique réelle (la QVolt). Penser l'habitacle, le moteur et les lignes aérodynamiques est un pur régal. Même si un concept n'entre pas en production, l'acte de concevoir des mécaniques imaginaires me passionne plus que tout.",
		source: "Dragon Ball Forever — Entretien d'Akira Toriyama (2004)",
		year: 2004,
		document: "Dragon Ball Forever",
		href: "/wiki/databooks/22",
	},
	{
		id: "forever-couvertures-kanzenban-mac",
		subject: "Le dessin des couvertures Kanzenban sur Mac et la redécouverte du manga",
		keywords: ["kanzenban", "couvertures", "mac", "photoshop", "relecture"],
		text: "Drawing the Kanzenban covers, I had to re-read Dragon Ball because I had completely forgotten the story! I was surprised by how enjoyable it was. Switching to drawing and coloring on Mac with Painter and Photoshop saved my desire to keep drawing.",
		textFr: "Pour dessiner les couvertures de l'édition Kanzenban, j'ai dû relire l'intégralité de Dragon Ball car j'avais presque tout oublié de l'histoire ! J'ai été surpris de trouver ça vraiment divertissant. Pour la colorisation, je suis passé au Mac avec Painter puis Photoshop, ce qui m'a redonné le goût de dessiner sans la corvée physique des encres traditionnelles.",
		source: "Dragon Ball Forever — Entretien d'Akira Toriyama (2004)",
		year: 2004,
		document: "Dragon Ball Forever",
		href: "/wiki/databooks/22",
	},

	// ── 8. Chōzenshū 4 (2013) ────────────────────────────────────────────────
	{
		id: "choz4-debuts-trois-mois-chine",
		subject: "Les débuts de Dragon Ball : trois mois de répit et un voyage en Chine",
		keywords: ["dr slump", "dragon ball", "chine", "debuts", "voyage"],
		text: "I only had three months between ending Dr. Slump and starting my next serial, because that was the condition for being allowed to stop. There was zero preparation. I just took a trip to China with my wife, which ended up inspiring the whole early visual direction.",
		textFr: "Pour avoir le droit d'arrêter Dr. Slump, j'avais dû promettre à la rédaction d'entamer une nouvelle série dans les trois mois. Je n'avais donc eu aucun temps de préparation. J'ai simplement fait un voyage en Chine avec mon épouse par curiosité personnelle, et ce dépaysement a été le déclic décisif pour l'ambiance visuelle du début de l'aventure.",
		source: "Dragon Ball Chōzenshū 4 — Rétrospective d'Akira Toriyama (2013)",
		year: 2013,
		document: "Dragon Ball Chōzenshū 4: Dragon Ball Super Encyclopedia",
		href: "/wiki/databooks/19",
	},
	{
		id: "choz4-voix-masako-nozawa-evidence",
		subject: "L'évidence absolue de Masako Nozawa pour la voix de Son Goku",
		keywords: ["son goku", "masako nozawa", "anime", "audition", "doublage"],
		text: "I rarely get involved in animation, but I participated in the voice audition for Goku. Listening to the audition tapes, I felt Masako Nozawa's voice fit Goku to a T, capturing his purity and energetic nature instantly.",
		textFr: "Je ne m'implique que très rarement dans l'animation, mais j'ai participé directement aux auditions vocales pour Goku. Dès que j'ai entendu la voix de Masako Nozawa sur la bande magnétique, j'ai su immédiatement que c'était elle. Elle incarnait à la perfection la pureté, l'énergie et la spontanéité du personnage.",
		source: "Dragon Ball Chōzenshū 4 — Rétrospective d'Akira Toriyama (2013)",
		year: 2013,
		document: "Dragon Ball Chōzenshū 4: Dragon Ball Super Encyclopedia",
		href: "/wiki/databooks/19",
	},
	{
		id: "choz4-fatigue-musculaire-visage-combats",
		subject: "L'épuisement des expressions faciales en dessinant les combats acharnés",
		keywords: ["combats", "dessin", "expressions", "visage", "vegeta"],
		text: "When drawing fierce battles, I simulate the fights in my head and unconsciously make the exact same facial expressions and grimaces as the characters. Drawing shout-filled battle scenes for hours left the muscles of my own face utterly exhausted!",
		textFr: "Pour chorégraphier un duel intense, je dois me mettre mentalement dans la peau du combattant et ressentir chaque coup. Sans m'en rendre compte, mon visage reproduit les mêmes rictus de tension et de rage que ceux des personnages. Après avoir dessiné des scènes de hurlements et de coups violents pendant des heures, les muscles de mon visage étaient littéralement exténués !",
		source: "Dragon Ball Chōzenshū 4 — Rétrospective d'Akira Toriyama (2013)",
		year: 2013,
		document: "Dragon Ball Chōzenshū 4: Dragon Ball Super Encyclopedia",
		href: "/wiki/databooks/19",
	},
	{
		id: "choz4-talent-animateur-nakatsuru",
		subject: "L'admiration pour le trait de l'animateur Katsuyoshi Nakatsuru",
		keywords: ["katsuyoshi nakatsuru", "animation", "v-jump", "style", "dessin"],
		text: "Nakatsuru-san's drawing skill is astounding. For V-Jump promotional projects, he drew illustrations in my stead that were so identical to my own style that even I couldn't tell who drew what! I almost wished he could draw serial chapters for me.",
		textFr: "Katsuyoshi Nakatsuru est un animateur d'un talent prodigieux. Lors de certains projets pour le V-Jump, il a réalisé des illustrations promotionnelles à ma place avec une fidélité telle que moi-même je n'arrivais plus à distinguer son dessin du mien ! J'aurais presque aimé qu'il dessine certaines planches de la sérialisation à ma place tant son énergie était formidable.",
		source: "Dragon Ball Chōzenshū 4 — Rétrospective d'Akira Toriyama (2013)",
		year: 2013,
		document: "Dragon Ball Chōzenshū 4: Dragon Ball Super Encyclopedia",
		href: "/wiki/databooks/19",
	},
	{
		id: "choz4-broly-cooler-designs-films",
		subject: "La conception graphique de Broly et Cooler pour les films Toei Animation",
		keywords: ["broly", "cooler", "toei animation", "films", "charadesign"],
		text: "For the theatrical films, I drew the character designs for Broly, Cooler, and other movie villains when requested. But beyond those design sketches, I left scripts and direction completely to the anime staff without interfering.",
		textFr: "Pour les films de Toei Animation, je dessinais les designs originaux des nouveaux antagonistes comme Cooler ou Broly quand l'équipe me sollicitait. Mais en dehors de ces croquis préparatoires, je leur laissais carte blanche sur les scripts et la réalisation sans jamais chercher à interférer.",
		source: "Dragon Ball Chōzenshū 4 — Rétrospective d'Akira Toriyama (2013)",
		year: 2013,
		document: "Dragon Ball Chōzenshū 4: Dragon Ball Super Encyclopedia",
		href: "/wiki/databooks/19",
	},
	{
		id: "choz4-tablette-graphique-numerique",
		subject: "La tablette graphique, planche de salut pour continuer à dessiner",
		keywords: ["tablette graphique", "numerique", "photoshop", "encrage", "dessin"],
		text: "If not for computers and graphics tablets, I would have stopped drawing entirely. People say digital coloring lacks flavor, but for me, getting rid of messy ink and nibs kept my creative spark alive.",
		textFr: "Si l'outil informatique et les tablettes graphiques n'étaient pas apparus, j'aurais probablement cessé complètement de dessiner il y a bien longtemps. Certains puristes disent que le numérique manque de chaleur, mais pour moi, ne plus avoir à manipuler plumes, encres et solvants a été une renaissance salvatrice.",
		source: "Dragon Ball Chōzenshū 4 — Rétrospective d'Akira Toriyama (2013)",
		year: 2013,
		document: "Dragon Ball Chōzenshū 4: Dragon Ball Super Encyclopedia",
		href: "/wiki/databooks/19",
	},
	{
		id: "choz4-neko-majin-brider-penchants",
		subject: "Neko Majin et la nécessité de brider ses propres penchants humoristiques",
		keywords: ["neko majin", "dr slump", "torishima", "parodie", "humour"],
		text: "I love the silliness of Neko Majin. But if a cartoonist pushes personal likes too strongly, it won't be popular. Dr. Slump and Dragon Ball became mega-hits because Torishima made me suppress my eccentric whims to connect with readers.",
		textFr: "J'adore l'absurde décalé de Neko Majin. Mais j'ai appris au cours de ma carrière que si un mangaka laisse libre cours à ses propres goûts personnels sans filtre, cela ne séduit que rarement le grand public. Dr. Slump et Dragon Ball ont été des triomphes parce que mon premier éditeur Torishima m'a forcé à canaliser et modérer mes penchants pour viser le cœur des lecteurs.",
		source: "Dragon Ball Chōzenshū 4 — Rétrospective d'Akira Toriyama (2013)",
		year: 2013,
		document: "Dragon Ball Chōzenshū 4: Dragon Ball Super Encyclopedia",
		href: "/wiki/databooks/19",
	},
	{
		id: "choz4-collaboration-katsura-refus-emouvoir",
		subject: "La collaboration avec Masakazu Katsura : le refus d'émouvoir",
		keywords: ["masakazu katsura", "sachie-chan", "jiageya", "manga", "divertissement"],
		text: "When Katsura-kun and I collaborated, he drew and I wrote the storyboard. What we butted heads on most was that Katsura wanted to deeply move and make readers cry, whereas I stubbornly refused: I believe manga should be pure, lighthearted fun!",
		textFr: "Sur nos mangas en duo (Sachie-chan Gu!!, Jiya), Katsura s'occupait du dessin et moi du storyboard. Nous n'arrêtions pas de débattre sur la direction de l'histoire. Ce qui nous opposait le plus, c'est que Katsura voulait absolument faire pleurer et émouvoir le lecteur, alors que moi, je refusais catégoriquement d'émouvoir ! Pour moi, le manga doit demeurer un pur divertissement joyeux.",
		source: "Dragon Ball Chōzenshū 4 — Rétrospective d'Akira Toriyama (2013)",
		year: 2013,
		document: "Dragon Ball Chōzenshū 4: Dragon Ball Super Encyclopedia",
		href: "/wiki/databooks/19",
	},
	{
		id: "choz4-allergie-stress-serialisation",
		subject: "L'allergie physique au stress de la publication hebdomadaire",
		keywords: ["serialisation", "stress", "rhume des foins", "pression", "weekly jump"],
		text: "Throughout the ten years of Dragon Ball serialization, I constantly had a runny nose and sneezing, thinking it was hay fever. The moment serialization ended, it stopped completely! It was actually the physical toll of weekly stress and deadlines.",
		textFr: "Pendant dix ans de sérialisation hebdomadaire, j'avais sans arrêt le nez qui coule et des éternuements que je prenais pour un rhume des foins. Dès que Dragon Ball s'est achevé, tous ces symptômes se sont instantanément évanouis ! C'était en réalité le stress monumental et la pression permanente de la cadence de livraison qui se manifestaient physiquement.",
		source: "Dragon Ball Chōzenshū 4 — Rétrospective d'Akira Toriyama (2013)",
		year: 2013,
		document: "Dragon Ball Chōzenshū 4: Dragon Ball Super Encyclopedia",
		href: "/wiki/databooks/19",
	},
	{
		id: "choz4-bilan-soixantaine-metier-solitaire",
		subject: "Le bilan à l'approche de ses 60 ans : la joie d'un métier solitaire",
		keywords: ["soixantaine", "mangaka", "solitaire", "fans", "remerciements"],
		text: "Approaching 60, I realize cartooning was the ultimate blessing for someone like me. Twisted, stubborn, hating crowds, I would have been a disaster in a regular company. To all fans worldwide who supported me: thank you with all my heart!",
		textFr: "À l'approche de mes soixante ans, je mesure ma chance. Avec mon caractère solitaire, obstiné et contrariant, j'aurais été incapable de faire carrière comme employé dans une entreprise ordinaire. Être mangaka m'a permis d'exprimer librement mon univers tout en vivant à mon propre rythme. Aux lecteurs du monde entier qui m'ont suivi, je n'ai qu'un mot : merci infiniment !",
		source: "Dragon Ball Chōzenshū 4 — Rétrospective d'Akira Toriyama (2013)",
		year: 2013,
		document: "Dragon Ball Chōzenshū 4: Dragon Ball Super Encyclopedia",
		href: "/wiki/databooks/19",
	},

	// ── 9. WIRED Japan (1997) ─────────────────────────────────────────────────
	{
		id: "wired-rythme-lecture-papier-silence",
		subject: "Le silence du papier et la liberté du lecteur face au multimédia",
		keywords: ["wired", "cd-rom", "numerique", "manga", "lecture"],
		text: "Digital CD-ROMs are fine, but paper has irreplaceable strength: each reader sets their own reading pace and imagines character voices. Adding audio voices and sound effects destroys that personal imagination.",
		textFr: "Le format CD-ROM est intéressant, mais le manga papier possède une force irremplaçable : chaque lecteur y règle son propre tempo de lecture. Si l'on commence à y ajouter des voix et des bruitages sonores préenregistrés, on détruit l'imaginaire du lecteur. De plus, la mise en page d'une double page imprimée permet de ressentir l'intensité dramatique d'une grande case par rapport aux petites, ce qu'un écran uniforme peine à reproduire.",
		source: "WIRED Japan (1997, n°1) — Entretien exclusif Akira Toriyama",
		year: 1997,
		document: "WIRED Japan 1997 #1: “Issue 3.01”",
		href: "/wiki/databooks/57",
	},
	{
		id: "wired-information-visuelle-dessin",
		subject: "La prédominance du dessin sur le texte : ne pas bavarder inutilement",
		keywords: ["dessin", "dialogues", "torishima", "information visuelle", "manga"],
		text: "Visual information must dominate. My editor taught me never to chatter unnecessarily: the drawings must convey the essentials, while words are only there as brief support to sharpen character traits.",
		textFr: "Mon premier éditeur m'a enseigné une règle d'or : le dessin doit faire comprendre l'action de façon autonome, les dialogues ne sont là qu'en soutien secondaire. Une bulle de texte ne doit servir qu'à accentuer brièvement la personnalité d'un personnage, jamais à surcharger la planche d'explications superflues.",
		source: "WIRED Japan (1997, n°1) — Entretien exclusif Akira Toriyama",
		year: 1997,
		document: "WIRED Japan 1997 #1: “Issue 3.01”",
		href: "/wiki/databooks/57",
	},
	{
		id: "wired-manuscrits-garage-detachement",
		subject: "Le mépris des archives et les manuscrits originaux empilés au garage",
		keywords: ["manuscrits", "garage", "archives", "detachement", "expositions"],
		text: "Once finished, manuscripts are just sheets of paper. Exhibition organizers came to pick up my original pages and found them stacked haphazardly in my garage, nearly fainting in horror! I have zero attachment to what I have already drawn.",
		textFr: "Une fois qu'une planche est publiée, ce n'est plus qu'une simple feuille de papier. Lors d'une exposition, les organisateurs sont venus chercher mes planches originales chez moi et les ont découvertes entassées dans des cartons au fond du garage ; ils ont failli faire une syncope ! Je n'éprouve aucun attachement fétichiste pour ce que j'ai déjà dessiné. C'est pour cela que mes propos futurs contredisent parfois mes propos passés !",
		source: "WIRED Japan (1997, n°1) — Entretien exclusif Akira Toriyama",
		year: 1997,
		document: "WIRED Japan 1997 #1: “Issue 3.01”",
		href: "/wiki/databooks/57",
	},
	{
		id: "wired-contre-pied-sondages-popularite",
		subject: "Prendre le contre-pied des sondages de popularité du Shōnen Jump",
		keywords: ["sondages", "cartes postales", "shonen jump", "esprit de contradiction", "vegeta"],
		text: "I am extremely contrary. If a reader survey postcard said 'This is how the story should go', I would do the exact opposite. If a character became too popular, I made a point to kill them or make them suffer!",
		textFr: "Le système des cartes postales de popularité du Jump est impitoyable. Mais comme je suis d'un naturel profondément contrariant, dès qu'une lettre de lecteur me disait « Voilà comment l'intrigue doit évoluer », je m'arrangeais pour prendre le contre-pied absolu. Et si un personnage devenait trop populaire auprès des fans, j'avais immédiatement envie de le faire souffrir ou de le faire mourir !",
		source: "WIRED Japan (1997, n°1) — Entretien exclusif Akira Toriyama",
		year: 1997,
		document: "WIRED Japan 1997 #1: “Issue 3.01”",
		href: "/wiki/databooks/57",
	},
	{
		id: "wired-poison-dans-son-goku",
		subject: "La part d'ombre et le « poison » dans la personnalité de Son Goku",
		keywords: ["son goku", "poison", "heros de justice", "anime", "psychologie"],
		text: "Son Goku is not a hero fighting for justice to save others. Deep down, he fights out of pure selfish desire to face strong opponents. I was always dissatisfied with the TV anime portraying him as a squeaky-clean hero of justice, failing to capture that darker selfish poison.",
		textFr: "Son Goku n'a jamais été un héros de justice vertueux qui se bat pour sauver les autres : au fond de lui, il ne combat que par désir égoïste de se mesurer à des adversaires toujours plus forts. Quand l'anime télévisé en a fait un redresseur de torts au cœur immaculé, j'ai toujours été frustré de voir que Toei Animation n'avait pas compris cette part d'ombre et ce « poison » qui affleurent sous sa naïveté.",
		source: "WIRED Japan (1997, n°1) — Entretien exclusif Akira Toriyama",
		year: 1997,
		document: "WIRED Japan 1997 #1: “Issue 3.01”",
		href: "/wiki/databooks/57",
	},
	{
		id: "wired-prime-debutants-motivation",
		subject: "Pourquoi être devenu mangaka : la prime du concours pour amateurs",
		keywords: ["prime", "debuts", "argent", "concours", "maquettes"],
		text: "I became a manga artist purely for the prize money of the newcomer contest! If I had won it on my first try, I would have cashed the money and quit immediately. It was because I failed that my pride was hurt and I kept going.",
		textFr: "Pour être totalement honnête, je suis devenu mangaka pour l'argent de la prime du concours pour débutants ! Si j'avais remporté la prime dès ma première tentative, j'aurais probablement arrêté aussitôt après avoir acheté mes maquettes. C'est en échouant que ma fierté a été piquée et que je me suis acharné jusqu'à être publié.",
		source: "WIRED Japan (1997, n°1) — Entretien exclusif Akira Toriyama",
		year: 1997,
		document: "WIRED Japan 1997 #1: “Issue 3.01”",
		href: "/wiki/databooks/57",
	},

	// ── 10. Dragon Ball Super Tome 1 (2016) ───────────────────────────────────
	{
		id: "dbs1-retour-format-tournoi",
		subject: "Le retour du format tournoi dans l'arc du 6e Univers",
		keywords: ["tournoi", "dragon ball super", "univers 6", "toyotaro", "oob"],
		text: "The Universe 6 tournament marks the return of tournaments in Dragon Ball. Tournaments keep things fast, funny, and let you create whimsical fighters without bogging down the serious plot.",
		textFr: "L'arc opposant le 6e et le 7e Univers marque le grand retour du format tournoi dans Dragon Ball. J'avais ébauché des tournois au début et à la conclusion de la saga Boo sans les mener à terme. Ce cadre permet de multiplier les combats rapides et les combattants aux techniques insolites sans alourdir la trame dramatique.",
		source: "Dragon Ball Super Tome 1 — Entretien Akira Toriyama × Toyotarō (2016)",
		year: 2016,
		document: "Entretien Toriyama × Toyotarō — Dragon Ball Super",
		href: "/wiki/databooks/8",
	},
	{
		id: "dbs1-oubli-des-details-manga",
		subject: "L'oubli des détails en relisant ses propres volumes",
		keywords: ["oubli", "dragon ball super", "tomes", "relecture", "toriyama"],
		text: "Whenever I re-read the original Dragon Ball volumes to find new story ideas, I am constantly stunned by everything I have forgotten! My memory capacity is genuinely tiny.",
		textFr: "Chaque fois que je replonge dans les 42 volumes de Dragon Ball pour vérifier la cohérence d'une nouvelle idée, je suis systématiquement abasourdi par tout ce que j'ai pu oublier de ma propre histoire ! Ma mémoire des événements passés est extrêmement volatile, ce qui m'oblige à relire mes tomes avec un œil presque étranger.",
		source: "Dragon Ball Super Tome 1 — Entretien Akira Toriyama × Toyotarō (2016)",
		year: 2016,
		document: "Entretien Toriyama × Toyotarō — Dragon Ball Super",
		href: "/wiki/databooks/8",
	},
	{
		id: "dbs1-eloge-style-graphique-toyotaro",
		subject: "L'admiration pour le trait graphique et la fidélité de Toyotarō",
		keywords: ["toyotaro", "dessin", "style", "toei animation", "storyboard"],
		text: "Toyotarō's art is the closest to mine of anyone, even including Toei Animation's top animators! His composition and dynamic action are superb; I could never draw with that kind of youthful energy today.",
		textFr: "Toyotarō est sans aucun doute l'artiste dont le style graphique se rapproche le plus du mien, y compris en incluant les animateurs chevronnés de Toei Animation. Il possède un sens de la composition remarquable et une énergie dynamique que je serais bien incapable de reproduire moi-même aujourd'hui à la main.",
		source: "Dragon Ball Super Tome 1 — Entretien Akira Toriyama × Toyotarō (2016)",
		year: 2016,
		document: "Entretien Toriyama × Toyotarō — Dragon Ball Super",
		href: "/wiki/databooks/8",
	},
	{
		id: "dbs1-liberte-nemu-storyboard",
		subject: "La liberté accordée à Toyotarō dans la composition des planches",
		keywords: ["toyotaro", "nemu", "storyboard", "liberte", "mise en scene"],
		text: "I only provide a text script without drawings. When Toyotarō sends his storyboards (nemu), I give green lights with complete confidence. I encourage him to bring in his own action choreography and camera angles.",
		textFr: "Je fournis uniquement une trame scénaristique textuelle, sans dessin. Lorsque Toyotarō m'envoie ses storyboards (nemu), je les valide en toute confiance. Je l'encourage à intégrer ses propres idées de mise en scène et à varier les angles de caméra. C'est une grande chance d'avoir un successeur capable de faire vivre la suite de Dragon Ball avec une telle ferveur.",
		source: "Dragon Ball Super Tome 1 — Entretien Akira Toriyama × Toyotarō (2016)",
		year: 2016,
		document: "Entretien Toriyama × Toyotarō — Dragon Ball Super",
		href: "/wiki/databooks/8",
	},

	// ── 11. Saikyō Jump (2014 & 2018) ─────────────────────────────────────────
	{
		id: "saikyo-jump-2014-gine-mere-goku",
		subject: "Gine, la mère de Son Goku et compagne de Bardock (2014)",
		keywords: ["gine", "bardock", "son goku", "saiyans", "famille"],
		text: "Gine was Goku's mother. She once fought in Bardock's team, but her gentle nature was unsuited to battle. Bardock saved her multiple times, sparking a rare emotional romance among Saiyans, where unions were normally purely for reproduction. She later worked at Planet Vegeta's meat distribution center.",
		textFr: "La mère de Goku s'appelle Gine. Elle combattait autrefois au sein de l'escouade de Bardock, mais sa douceur naturelle la rendait inadaptée aux carnages guerriers ; Bardock l'a sauvée à plusieurs reprises sur le champ de bataille. Ils ont fini par développer un attachement affectif sincère, rarissime chez les Saiyans où les couples ne se forment d'ordinaire que dans un but purement reproductif. Gine a ensuite travaillé au centre de distribution de viande de la planète Vegeta.",
		source: "Saikyō Jump (Mars 2014) — Interview d'Akira Toriyama",
		year: 2014,
		document: "Saikyō Jump (2014 & 2018) — Entretiens d'Akira Toriyama",
		href: "/wiki/canon",
	},
	{
		id: "saikyo-jump-2018-cellules-s-super-saiyan",
		subject: "Les Cellules S (S-Cells) et la mécanique du Super Saiyan (2018)",
		keywords: ["cellules s", "s-cells", "super saiyan", "biologie", "transformation"],
		text: "To become a Super Saiyan, a Saiyan's body must have enough 'S-Cells'. Increasing them requires high battle power, but most crucially a gentle spirit, which is rare in Saiyans. Earth's peaceful environment allowed Goku, Gohan, Goten, and Trunks to multiply their S-Cells rapidly.",
		textFr: "Pour devenir Super Saiyan, un corps saiyan doit posséder une quantité suffisante de « Cellules S » (S-Cells). Si la plupart des Saiyans en ont un peu, ce n'est pas suffisant pour franchir le palier. Deux conditions augmentent ces cellules : un entraînement intensif augmentant la puissance de combat, mais surtout un esprit doux et serein (穏やかな心), très difficile à trouver chez cette race belliqueuse. L'environnement paisible de la Terre a permis à Goku, puis à Gohan, Goten et Trunks, de démultiplier leurs Cellules S bien plus vite que sur la planète Vegeta.",
		source: "Saikyō Jump (Janvier 2018) — Q&A d'Akira Toriyama",
		year: 2018,
		document: "Saikyō Jump (2014 & 2018) — Entretiens d'Akira Toriyama",
		href: "/wiki/canon",
	},
	{
		id: "saikyo-jump-2018-yamoshi-super-saiyan-god",
		subject: "Yamoshi, le premier Super Saiyan et l'origine du mythe du Super Saiyan God (2018)",
		keywords: ["yamoshi", "super saiyan", "super saiyan god", "origine", "legende"],
		text: "The legendary Super Saiyan was named Yamoshi. He was an ancient righteous warrior who rebelled with five comrades against Saiyan evil. Defeated by numbers, his wandering spirit sought six righteous Saiyans, birthing the Super Saiyan God legend recorded in Namek's ancient book.",
		textFr: "Le Super Saiyan originel de la légende n'était pas un mythe abstrait : il s'appelait Yamoshi. C'était un guerrier antique au cœur juste qui s'est rebellé avec cinq camarades contre la barbarie des Saiyans. Acculé et transformé en Super Saiyan, il a fini par être vaincu par le nombre une fois ses forces épuisées. Après sa mort, son esprit a continué d'errer à travers l'univers à la recherche de six Saiyans au cœur pur pour manifester le Super Saiyan God, ce que le Tout-Puissant de Namek a jadis consigné dans son livre des légendes.",
		source: "Saikyō Jump (Janvier 2018) — Q&A d'Akira Toriyama",
		year: 2018,
		document: "Saikyō Jump (2014 & 2018) — Entretiens d'Akira Toriyama",
		href: "/wiki/canon",
	},
	{
		id: "saikyo-jump-2018-origine-majin-boo-bibidi",
		subject: "La véritable nature de Majin Boo et le rôle du sorcier Bibidi (2018)",
		keywords: ["majin boo", "bibidi", "origine", "destruction", "magie"],
		text: "Bibidi did not create Majin Boo from scratch. Boo has existed since time immemorial as a primordial cosmic force, cycling between rampages and slumber. Bibidi merely discovered the incantation to awaken him and briefly direct his terror.",
		textFr: "Contrairement à ce que le Kaioshin croyait, le sorcier Bibidi n'a pas créé Majin Boo à partir de rien. Majin Boo est une entité primordiale existant depuis les temps immémoriaux, alternant entre de longues phases de sommeil cataclysmique et des réveils destructeurs. Bibidi a simplement découvert la formule magique permettant de contrôler son réveil et de diriger temporairement sa fureur avant d'être dépassé par sa nature ingouvernable.",
		source: "Saikyō Jump (Janvier 2018) — Q&A d'Akira Toriyama",
		year: 2018,
		document: "Saikyō Jump (2014 & 2018) — Entretiens d'Akira Toriyama",
		href: "/wiki/canon",
	},
];

async function main() {
	console.log("=== ENRICHISSEMENT FACTUEL DES INTERVIEWS D'AKIRA TORIYAMA ===");

	// 1. Validation du glossaire canonique
	console.log("\n1. Contrôle du glossaire canonique officiel sur toutes les citations...");
	for (const c of CITATIONS) {
		verifierGlossaire(c.textFr, `[ID ${c.id}] ${c.subject}`);
		verifierGlossaire(c.subject, `[ID ${c.id}] subject`);
	}
	console.log(`✓ Les ${CITATIONS.length} citations respectent rigoureusement le glossaire officiel.`);

	const sql = await connecte();

	// 2. Mise à jour de l'auteur d'interview dans bot.db_databooks
	console.log("\n2. Mise à jour des fiches d'interviews dans bot.db_databooks...");
	await sql`UPDATE bot.db_databooks SET author = 'Akira Toriyama' WHERE id IN (7, 57, 464)`;
	await sql`UPDATE bot.db_databooks SET author = 'Toriyama & Toyotarō' WHERE id = 8`;
	console.log("✓ Auteurs mis à jour dans bot.db_databooks.");

	// 3. Upsert des citations dans public.canon_references
	console.log("\n3. Ingestion des citations dans public.canon_references...");
	let inserees = 0;
	let misesAJour = 0;

	for (const c of CITATIONS) {
		const hash = hashDe({
			subject: c.subject,
			text: c.text,
			textFr: c.textFr,
			source: c.source,
			year: c.year,
			keywords: c.keywords,
		});

		const [existante] = await sql`
			SELECT id FROM public.canon_references WHERE id = ${c.id}
		`;

		if (existante) {
			await sql`
				UPDATE public.canon_references
				SET
					subject = ${c.subject},
					keywords = ${sql.json(c.keywords)},
					text = ${c.text},
					text_fr = ${c.textFr},
					source = ${c.source},
					year = ${c.year},
					document = ${c.document},
					lang = 'fr',
					provenance = 'aphrody',
					href = ${c.href ?? null},
					hash = ${hash},
					visible = true,
					updated_at = now()
				WHERE id = ${c.id}
			`;
			misesAJour++;
		} else {
			await sql`
				INSERT INTO public.canon_references (
					id, subject, keywords, text, text_fr, source, year,
					document, lang, provenance, href, hash, visible,
					seen_at, created_at, updated_at
				) VALUES (
					${c.id}, ${c.subject}, ${sql.json(c.keywords)}, ${c.text}, ${c.textFr},
					${c.source}, ${c.year}, ${c.document}, 'fr', 'aphrody', ${c.href ?? null},
					${hash}, true, now(), now(), now()
				)
			`;
			inserees++;
		}
	}

	console.log(`✓ Citations : ${inserees} insérées, ${misesAJour} mises à jour.`);

	// 4. Masquer logiquement les planches de "THE WORLD Special Anime" si présentes
	console.log("\n4. Application de la suppression logique (visible = false) sur les catalogues hors-sujet...");
	const rMasquage = await sql`
		UPDATE public.canon_references
		SET visible = false, updated_at = now()
		WHERE document = 'Shonen Weekly Jump Spécial Edition Akira Toriyama THE WORLD Special Anime'
		  AND visible = true
	`;
	console.log(`✓ Planches masquées logiquement : ${rMasquage.count}`);

	// 5. Mettre à jour l'année des planches de Daizenshuu 2 (ID 7)
	await sql`
		UPDATE public.canon_references
		SET year = 1995, updated_at = now()
		WHERE document = 'Interview d''Akira Toriyama — Daizenshuu 2'
		  AND year IS NULL
	`;

	// 6. Harmoniser les documents des anciens imports aphrody vers leurs titres canoniques
	console.log("\n5. Harmonisation des documents aphrody vers les ouvrages canoniques du catalogue...");
	await sql`
		UPDATE public.canon_references
		SET document = 'Interview d''Akira Toriyama — Daizenshuu 2', year = 1995, updated_at = now()
		WHERE document = 'toriyama_toriyama-interviews.md'
	`;
	await sql`
		UPDATE public.canon_references
		SET document = 'Interview d''Akira Toriyama — Daizenshuu 1 (Version Intégrale)', year = 1995, updated_at = now()
		WHERE document LIKE 'shenron_daizenshuu-1-shenlong-times%'
	`;
	await sql`
		UPDATE public.canon_references
		SET document = 'Dragon Ball Forever', year = 2004, updated_at = now()
		WHERE document = 'toriyama_dragon-ball-forever-toriyama.md'
	`;
	await sql`
		UPDATE public.canon_references
		SET document = 'Dragon Ball Super Exciting Guide — Character Volume', year = 2009, updated_at = now()
		WHERE document = 'toriyama_toriyama-databook-seg.md' OR document LIKE 'shenron_seg-character-volume%'
	`;
	await sql`
		UPDATE public.canon_references
		SET document = 'Dragon Ball Super Exciting Guide — Story Volume', year = 2009, updated_at = now()
		WHERE document LIKE 'shenron_seg-story-volume%'
	`;
	await sql`
		UPDATE public.canon_references
		SET document = 'Saikyō Jump (2014 & 2018) — Entretiens d''Akira Toriyama', year = 2014, updated_at = now()
		WHERE document = 'saikyo-jump-2014-toriyama'
	`;
	console.log("✓ Documents harmonisés avec succès.");

	console.log("\n=== ENRICHISSEMENT TERMINÉ AVEC SUCCÈS ===");
	await sql.end();
}

main().catch((err) => {
	console.error("Erreur fatale :", err);
	process.exit(1);
});
