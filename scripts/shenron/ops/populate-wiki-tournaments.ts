#!/usr/bin/env bun
/**
 * populate-wiki-tournaments.ts — Insertion canonique des tournois majeurs manquants
 * dans bot.db_tournaments (42 tomes Toriyama / Dragon Ball Super).
 */
import postgres from "postgres";

const sql = postgres(process.env.REMOTE_DATABASE_URL!, { max: 1 });

const TOURNAMENTS = [
	{
		id: 7,
		slug: "tournoi-uranai-baba",
		name: "Tournoi d'Uranai Baba",
		name_ja: "占いババの対戦",
		tournament_type: "Tournoi de Divination",
		saga: "Saga Baba la Voyante",
		location: "Palais d'Uranai Baba (Les Toilettes du Diable)",
		winner_name: "Équipe de Son Gokū",
		runner_up_name: "Guerrier Masqué (Grand-père Son Gohan)",
		rules_summary: "Combats successifs en 1 contre 1 sans limite de temps. Élimination par KO, chute dans le bassin d'acide ou abandon. Si les challengers battent les 5 champions, Baba leur accorde une consultation divinatoire gratuite.",
		participants_count: 5,
		notable_matches: JSON.stringify([
			{ round: "1er Combat", fighterA: "Krillin", fighterB: "Dracula Man", winner: "Dracula Man", techniqueOrClimax: "Dracula Man se transforme en chauve-souris et mord la tête de Krillin qui chute hors-ring." },
			{ round: "2e Combat", fighterA: "Upa & Puar", fighterB: "Dracula Man", winner: "Upa & Puar", techniqueOrClimax: "Puar se change en main géante giflant le vampire tandis qu'Upa mime une croix et souffle de l'ail." },
			{ round: "3e Combat", fighterA: "Yamcha", fighterB: "L'Homme Invisible (Suke-san)", winner: "Yamcha", techniqueOrClimax: "Krillin fait saigner du nez Kamé Sennin en dévoilant la poitrine de Bulma, révélant la silhouette de l'invisible qui subit le Rōgafūfūken." },
			{ round: "4e Combat", fighterA: "Son Gokū", fighterB: "La Momie & Ackman", winner: "Son Gokū", techniqueOrClimax: "Gokū résiste au rayon diabolique d'Ackman (Akumaito Kōsen) car son cœur est totalement pur de tout vice." },
			{ round: "Finale", fighterA: "Son Gokū", fighterB: "Guerrier Masqué (Son Gohan)", winner: "Son Gokū", techniqueOrClimax: "Gohan saisit la queue de Gokū pour le neutraliser avant de la briser involontairement, puis abandonne et retire son masque dans les larmes." }
		]),
		canon: 1,
		article: `**Le Tournoi d'Uranai Baba** (占いババの対戦, *Uranai Baba no Taisen*) est l'une des épreuves martiales les plus riches en péripéties et en émotions de la première partie du manga d'Akira Toriyama (tomes 8 et 9).\n\n## La quête de la septième boule\n\nAprès la débâcle de l'Armée du Red Ribbon, Son Gokū ne parvient pas à localiser la dernière boule de cristal sur son Dragon Radar (celle-ci étant dissimulée par la boîte hermétique de Pilaf). Kamé Sennin oriente alors le groupe vers sa sœur aînée, la voyante **Uranai Baba**. Refusant de payer la somme colossale de 10 000 000 de zénis, l'équipe menée par Yamcha, Krillin, Upa, Puar et Gokū accepte de relever le défi des cinq guerriers des ténèbres.\n\n## Des arènes atypiques\n\nLe tournoi se déroule dans deux décors singuliers :\n1. Une petite arène intérieure close tapissée de marbre.\n2. **Les Toilettes du Diable** (*Akuma no Benjo*), un fin pont de pierre suspendu au-dessus d'un étang de poison corrosif, sans cordes ni protections.\n\nLe dénouement voit Gokū retrouver son grand-père défunt, offrant à l'œuvre une conclusion bouleversante avant que Shenron ne ressuscite Bora.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/9", kind: "manga_volume", label: "Manga Dragon Ball — Tome 9, Chapitres 98-108" }
		]),
		visible: true
	},
	{
		id: 8,
		slug: "28e-tenkaichi-budokai",
		name: "28e Tenkaichi Budōkai",
		name_ja: "第28回天下一武道会",
		tournament_type: "Tenkaichi Budōkai",
		saga: "Épilogue de Dragon Ball (End of Z)",
		location: "Arène du Tenkaichi Budōkai (Île Papaye)",
		winner_name: "Tournoi interrompu (Son Gokū s'envole avec Uub)",
		runner_up_name: "Uub (Oob)",
		rules_summary: "Règles traditionnelles du Tenkaichi Budōkai (KO, décompte de 10 secondes, sortie de ring). Interdiction de tuer ou d'utiliser des armes.",
		participants_count: 12,
		notable_matches: JSON.stringify([
			{ round: "1er Tour - Match 1", fighterA: "Pan", fighterB: "Mō Kekko", winner: "Pan", techniqueOrClimax: "Pan, âgée de 4 ans seulement, terrasse le géant de deux gifles légères avant de le projeter hors du ring." },
			{ round: "1er Tour - Match 2", fighterA: "Son Gokū", fighterB: "Uub (Oob)", winner: "Match interrompu", techniqueOrClimax: "Gokū provoque le jeune garçon timide en insultant ses parents pour libérer sa puissance cachée, réveillant l'incroyable force de la réincarnation de Majin Boo." }
		]),
		canon: 1,
		article: `**Le 28e Tenkaichi Budōkai** (第28回天下一武道会) est l'ultime événement officiel de la saga originale d'Akira Toriyama (tome 42, chapitres 518 et 519), se déroulant 10 ans après l'anéantissement de Majin Boo.\n\n## Le testament martial d'Akira Toriyama\n\nApprenant par le Roi Enma que l'âme du pur Majin Boo s'est réincarnée en un jeune terrien au cœur pur, Son Gokū décide de participer au championnat du monde pour le rencontrer. Il demande à **Mr. Boo** de manipuler le tirage au sort par magie pour affronter dès le premier tour ce garçon venu d'une île pauvre du Sud : **Uub** (*Oob*).\n\n## L'envol vers l'avenir\n\nPendant leur duel sur le ring rénové de l'Île Papaye, Gokū pousse Uub dans ses retranchements jusqu'à ce que l'enfant libère un ki titanesque capable de faire trembler le stade entier. Reconnaissant en lui son successeur idéal, Gokū interrompt le combat, charge Uub sur ses épaules et s'envole vers son village natal pour lui enseigner la maîtrise des arts martiaux. Cette scène légendaire clôture les 519 chapitres du manga d'Akira Toriyama.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/42", kind: "manga_volume", label: "Manga Dragon Ball — Tome 42, Chapitres 518-519" }
		]),
		visible: true
	},
	{
		id: 9,
		slug: "tournoi-univers-6-vs-7",
		name: "Tournoi de l'Univers 6 vs Univers 7",
		name_ja: "第6・第7宇宙親善試合",
		tournament_type: "Tournoi Inter-Univers",
		saga: "Saga Univers 6",
		location: "Planète Sans Nom (Espace Neutre)",
		winner_name: "Univers 7 (Monaka / Son Gokū)",
		runner_up_name: "Univers 6 (Hit)",
		rules_summary: "Tournoi en équipe de 5 combattants par univers. Matchs 1v1 par élimination directe, le vainqueur restant sur le ring. Test d'intelligence écrit éliminatoire avant le coup d'envoi. Pas d'armes, interdiction formelle de tuer.",
		participants_count: 10,
		notable_matches: JSON.stringify([
			{ round: "Combat 1", fighterA: "Son Gokū", fighterB: "Botamo", winner: "Son Gokū", techniqueOrClimax: "Gokū fait trébucher le corps élastique de Botamo et le jette hors du ring sans frapper." },
			{ round: "Combat 2", fighterA: "Son Gokū", fighterB: "Frost", winner: "Frost (Tricherie)", techniqueOrClimax: "Frost utilise une aiguille empoisonnée dissimulée dans son poignet pour paralyser Gokū." },
			{ round: "Combat 5", fighterA: "Vegeta", fighterB: "Magetta", winner: "Vegeta", techniqueOrClimax: "Vegeta insulte le robot géant ultra-sensible après avoir fait exploser le dôme de vapeur au Final Flash." },
			{ round: "Combat 6", fighterA: "Vegeta", fighterB: "Cabba", winner: "Vegeta", techniqueOrClimax: "Vegeta éveille Cabba au Super Saiyan par la colère avant de l'assommer d'un coup de poing au ventre." },
			{ round: "Combat 7", fighterA: "Son Gokū", fighterB: "Hit", winner: "Hit (Abandon de Gokū)", techniqueOrClimax: "Gokū combine le Super Saiyan Blue au Kaiōken x10 face au saut temporel (Tokitobashi) de Hit." },
			{ round: "Finale", fighterA: "Monaka", fighterB: "Hit", winner: "Monaka", techniqueOrClimax: "Hit simule un KO grotesque suite au faible coup de poing tremblant de Monaka pour rembourser sa dette envers Gokū." }
		]),
		canon: 1,
		article: `**Le Tournoi des Univers 6 et 7** (第6・第7宇宙親善試合, *Dai 6 - Dai 7 Uchū Shinzen Jiai*) est la première confrontation martiale interdimensionnelle organisée entre les dieux de la destruction frères jumeaux **Beerus** et **Champa**.\n\n## L'enjeu des Super Dragon Balls\n\nChampa, jaloux des mets gastronomiques de la Terre de l'Univers 7, parie six des sept **Super Dragon Balls** (orbes planétaires géantes de la taille d'astres) contre le globe terrestre. Le tournoi se déroule sur une planète neutre déserte sous l'arbitrage des anges Whis et Vados.\n\n## Innovations martiales légendaires\n\nCe tournoi marque l'introduction de figures incontournables de *Dragon Ball Super* :\n- **Hit l'assassin millénaire** et sa redoutable technique d'arrêt du temps (*Tokitobashi*).\n- La renaissance du **Kaiōken combiné au Super Saiyan Blue** (dans l'anime) et la maîtrise du Super Saiyan Divin alterné (dans le manga de Toyotarō).\n- La révélation des Saiyans pacifiques de l'Univers 6 avec **Cabba**.\n- L'arrivée surprise impériale du **Roi de Tout (Zen-ō)**, enchanté par le spectacle, qui annonce dans la foulée la tenue future d'un grand tournoi réunissant les douze univers.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/150", kind: "manga_volume", label: "Dragon Ball Super — Tome 1 & 2, Chapitres 7-13" }
		]),
		visible: true
	},
	{
		id: 10,
		slug: "tournoi-exhibition-zen",
		name: "Tournoi d'Exhibition Zen (Zen-ran Jiai)",
		name_ja: "全覧試合",
		tournament_type: "Tournoi Préparatoire Divin",
		saga: "Saga Survie de l'Univers",
		location: "Palais de Zeno",
		winner_name: "Univers 7 (Anime) / Interrompu (Manga)",
		runner_up_name: "Univers 9 (Trio du Danger)",
		rules_summary: "Dans l'anime : 3 matchs simples entre l'Univers 7 et l'Univers 9 sans élimination par sortie de ring, mort autorisée. Dans le manga : Battle Royale des 12 Dieux de la Destruction.",
		participants_count: 6,
		notable_matches: JSON.stringify([
			{ round: "Anime Match 1", fighterA: "Majin Boo", fighterB: "Basil", winner: "Majin Boo", techniqueOrClimax: "Boo s'amuse des coups de pied endiablés de Basil le loup avant de le repousser d'un Kaméhaméha jovial." },
			{ round: "Anime Match 2", fighterA: "Son Gohan", fighterB: "Lavenda", winner: "Égalité (Double KO)", techniqueOrClimax: "Gohan combat aveuglé par le poison corrosif de Lavenda et le plaque au sol au Super Saiyan." },
			{ round: "Anime Match 3", fighterA: "Son Gokū", fighterB: "Bergamo", winner: "Son Gokū", techniqueOrClimax: "Bergamo grandit à chaque coup encaissé mais Gokū le terrasse en Super Saiyan Blue avec un Kaiōken Kaméhaméha." },
			{ round: "Manga Battle Royale", fighterA: "Beerus", fighterB: "Les 11 Dieux de la Destruction", winner: "Interrompu", techniqueOrClimax: "Beerus esquive les attaques conjointes des dieux grâce aux prémices de l'Ultra Instinct avant que le Grand Prêtre n'arrête le duel d'un doigt." }
		]),
		canon: 1,
		article: `**Le Tournoi d'Exhibition Zen** (全覧試合, *Zen-ran Jiai*) est la compétition préliminaire organisée par le **Grand Prêtre** au Palais de Zen-ō afin de présenter les règles du futur Tournoi du Pouvoir au Zen-ō du Futur.\n\n## Deux versions d'anthologie\n\nL'épreuve présente des variations majeures entre les deux supports canoniques :\n- **Dans l'anime** : L'Univers 7 de Gokū affronte l'Univers 9 représenté par le **Trio du Danger** (*Trio De Dangers* : Bergamo, Basil, Lavenda). Toppo, chef des Pride Troopers de l'Univers 11, intervient ensuite pour défier Gokū et tester sa valeur morale.\n- **Dans le manga (Toyotarō)** : Le Grand Prêtre ordonne un **Battle Royale titanesque réunissant les douze Dieux de la Destruction**. Ce duel homérique met en valeur la suprématie martiale de **Beerus**, qui utilise les esquives de l'Ultra Instinct et son génie du combat pour résister à l'assaut concerté de Quitela, Champa, Belmod et leurs pairs.`,
		article_sources: JSON.stringify([
			{ n: 1, url: "/wiki/manga/volume/153", kind: "manga_volume", label: "Dragon Ball Super — Tome 4, Chapitres 28-29" }
		]),
		visible: true
	}
];

console.log(`Insertion de ${TOURNAMENTS.length} tournois majeurs canoniques...`);

for (const tour of TOURNAMENTS) {
	await sql`
		INSERT INTO bot.db_tournaments (
			id, slug, name, name_ja, tournament_type, saga, location, winner_name, runner_up_name,
			rules_summary, participants_count, notable_matches, canon, article, article_sources, visible
		) VALUES (
			${tour.id}, ${tour.slug}, ${tour.name}, ${tour.name_ja}, ${tour.tournament_type}, ${tour.saga}, ${tour.location},
			${tour.winner_name}, ${tour.runner_up_name}, ${tour.rules_summary}, ${tour.participants_count},
			${tour.notable_matches}, ${tour.canon}, ${tour.article}, ${tour.article_sources}, ${tour.visible}
		)
		ON CONFLICT (id) DO UPDATE SET
			slug = EXCLUDED.slug,
			name = EXCLUDED.name,
			name_ja = EXCLUDED.name_ja,
			tournament_type = EXCLUDED.tournament_type,
			saga = EXCLUDED.saga,
			location = EXCLUDED.location,
			winner_name = EXCLUDED.winner_name,
			runner_up_name = EXCLUDED.runner_up_name,
			rules_summary = EXCLUDED.rules_summary,
			participants_count = EXCLUDED.participants_count,
			notable_matches = EXCLUDED.notable_matches,
			canon = EXCLUDED.canon,
			article = EXCLUDED.article,
			article_sources = EXCLUDED.article_sources,
			visible = EXCLUDED.visible;
	`;
	console.log(`  ✓ Tournoi inséré/mis à jour : ${tour.name} (${tour.name_ja})`);
}

const total = await sql`SELECT COUNT(*) as count FROM bot.db_tournaments WHERE visible = true;`;
console.log(`\nSuccès : bot.db_tournaments compte désormais ${total[0].count} tournois visibles.`);

await sql.end();
