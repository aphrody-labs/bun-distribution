#!/usr/bin/env bun
/**
 * seed-expansion-pillars.ts — Injection massive de données pour souveraineté mondiale Dragon Ball
 *
 * 1. 25 Lieux & Sanctuaires mythiques (Terre, Namek, Kaïô-shin, Divin, Univers 6, Vide)
 * 2. 11 Tournois d'Arts Martiaux majeurs (Tenkaichi Budōkai 21/22/23/24/25/28, Cell Game, Tournoi du Pouvoir...)
 * 3. 20 Comédiens de doublage & Seiyū légendaires (JA & FR)
 * 4. 20 Musiques, génériques et thèmes cultes (Kageyama, Kikuchi, Zedd...)
 * 5. Expansion majeure de db_battles, db_timeline_events, db_power_levels, db_items, db_wishes
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import postgres from "postgres";

function getPgUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = process.env.SHENRON_PG_ENV || join(homedir(), ".shenron-neon.env");
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, "utf8");
      const lines = content.split("\n").filter((l) => l.startsWith("DATABASE_URL="));
      const last = lines.at(-1);
      if (last) {
        return last.slice("DATABASE_URL=".length).trim().replace(/^["\x27]|["\x27]$/g, "");
      }
    } catch {}
  }
  return null;
}

const sqlitePath = join(import.meta.dir, "../../apps/bot/data/bot.db");

function publishableSeedImage(image: string): string | null {
  if (!image.startsWith("/images/")) return image;
  const file = join(import.meta.dir, "../../apps/site/public", image.replace(/^\/+/, ""));
  return existsSync(file) ? image : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATASETS : LIEUX & GÉOGRAPHIE DU MULTIVERS
// ─────────────────────────────────────────────────────────────────────────────
const LOCATIONS_DATA = [
  {
    slug: "kame-house",
    name: "Kame House",
    name_ja: "カメハウス",
    name_romaji: "Kame Hausu",
    realm_type: "Terre",
    planet: "Terre",
    description: "Maison rose emblématique située sur un îlot minuscule au milieu de l'océan Pacifique. Demeure de Kamé Sennin (Tortue Géniale), Oolong, Turtle et Lunch, elle sert de premier camp d'entraînement légendaire pour Son Gokū et Krilin.",
    debut_chapter: "Chapitre 3",
    debut_episode: "Épisode 8 (Dragon Ball)",
    key_events: [
      { title: "Entraînement de Gokū et Krilin", description: "Livraison de lait à l'aube et labourage des champs à mains nues." },
      { title: "Arrivée de Raditz", description: "Raditz atterrit sur l'île, terrasse Krilin et enlève Son Gohan en exigeant 100 cadavres." }
    ],
    image: "/images/wiki/lieux/kame-house.webp",
  },
  {
    slug: "tour-karin",
    name: "Tour Karin",
    name_ja: "カリン塔",
    name_romaji: "Karin-tō",
    realm_type: "Terre",
    planet: "Terre",
    description: "Gigantesque tour s'élevant au-dessus des nuages, érigée au cœur de la Terre Sacrée de Karin. Gardée par Maître Karin, l'ermite félin immortel, elle relie la Terre des mortels au Sanctuaire de Dieu.",
    debut_chapter: "Chapitre 88",
    debut_episode: "Épisode 60 (Dragon Ball)",
    key_events: [
      { title: "L'ascension de Gokū", description: "Gokū escalade la tour sans aide pour boire l'Eau Sacrée et vaincre Taopaïpaï." },
      { title: "Culture des Senzu", description: "Karin y cultive les haricots magiques capables de régénérer instantanément toute blessure mortelle." }
    ],
    image: "/images/wiki/lieux/tour-karin.webp",
  },
  {
    slug: "sanctuaire-de-dieu",
    name: "Sanctuaire de Dieu (Palais de Kami-sama)",
    name_ja: "神の神殿",
    name_romaji: "Kami no Shinden",
    realm_type: "Divin",
    planet: "Terre",
    description: "Plateforme hémisphérique flottant dans la haute atmosphère terrestre, accessible uniquement via le Nyoï-bô fixé au sommet de la Tour Karin. Résidence du Dieu de la Terre, de son serviteur Mr. Popo et de Dendé.",
    debut_chapter: "Chapitre 163",
    debut_episode: "Épisode 125 (Dragon Ball)",
    key_events: [
      { title: "Apprentissage divin de Gokū", description: "Gokū y passe trois ans avant le 23e Tenkaichi Budōkai pour apprendre la maîtrise du Ki et la tranquillité de l'esprit." },
      { title: "Refuge face à Boo", description: "Les survivants de la Terre s'y abritent avant que Super Boo n'extermine l'humanité d'une pluie d'énergie." }
    ],
    image: "/images/wiki/lieux/sanctuaire-kami.webp",
  },
  {
    slug: "salle-esprit-temps",
    name: "Salle de l'Esprit et du Temps (Chambre du Temps)",
    name_ja: "精神と時の部屋",
    name_romaji: "Seishin to Toki no Heya",
    realm_type: "Divin",
    planet: "Terre",
    description: "Dimension parallèle située à l'intérieur du Sanctuaire de Dieu. Une année à l'intérieur équivaut à un seul jour dans le monde réel. Les conditions y sont extrêmes : gravité décuplée (10G), températures variant de -40°C à +50°C, et atmosphère raréfiée.",
    debut_chapter: "Chapitre 377",
    debut_episode: "Épisode 148 (DBZ)",
    key_events: [
      { title: "Éveil de Gohan au Super Saiyan", description: "Gokū et Gohan s'entraînent une année complète pour maîtriser l'état de Super Saiyan permanent (Full Power)." },
      { title: "Cri dimensionnel de Gotenks et Boo", description: "Gotenks SSJ3 et Super Boo ouvrent une brèche dimensionnelle par la seule puissance de leur cri pour s'en évader." }
    ],
    image: "/images/wiki/lieux/salle-temps.webp",
  },
  {
    slug: "capsule-corporation",
    name: "Capsule Corporation (West City)",
    name_ja: "カプセルコーポレーション",
    name_romaji: "Kapuseru Kōporēshon",
    realm_type: "Terre",
    planet: "Terre",
    description: "Siège mondial de la mégacorporation fondée par le Dr Brief, situé à la Capitale de l'Ouest. Complexe géant abritant les laboratoires de R&D des capsules Hoi-Poi, la salle de gravité 450G et la résidence de Bulma et Vegeta.",
    debut_chapter: "Chapitre 69",
    debut_episode: "Épisode 43 (Dragon Ball)",
    key_events: [
      { title: "Construction du vaisseau de Namek", description: "Le Dr Brief modifie le vaisseau de la capsule de Gokū avec un générateur de gravité artificielle 100G." },
      { title: "Machine à voyager dans le temps", description: "Bulma du futur y conçoit la machine temporelle permettant à Trunks de sauver l'histoire." }
    ],
    image: "/images/wiki/lieux/capsule-corp.webp",
  },
  {
    slug: "arene-tenkaichi-budokai",
    name: "Arène du Tenkaichi Budōkai (Île Papaye)",
    name_ja: "天下一武道会会場",
    name_romaji: "Tenka'ichi Budōkai Kaijō",
    realm_type: "Terre",
    planet: "Terre",
    description: "Temple sacré et ring d'arts martiaux situé sur l'île Papaye. Théâtre des championnats du monde où s'affrontent les maîtres des styles de la Tortue, de la Grue et les plus grands guerriers de la planète.",
    debut_chapter: "Chapitre 32",
    debut_episode: "Épisode 19 (Dragon Ball)",
    key_events: [
      { title: "Finales mythiques", description: "Jackie Chun vs Gokū, Tenshinhan vs Gokū, et le sacre de Gokū contre Piccolo Junior." },
      { title: "Destruction de l'arène", description: "Piccolo Junior pulvérise l'île entière avec sa vague de choc super explosive lors de la finale du 23e tournoi." }
    ],
    image: "/images/wiki/lieux/arene-budokai.webp",
  },
  {
    slug: "planete-namek",
    name: "Planète Namek (Originelle)",
    name_ja: "ナメック星",
    name_romaji: "Namekku-sei",
    realm_type: "Univers 7",
    planet: "Namek",
    description: "Monde pastoral éclairé par trois soleils où la nuit n'existe jamais. Terre d'origine des Nameks, recouverte d'arbres Ajissa et de plaines verdoyantes, protégée par le Grand Chef Guru et patrie des puissantes Dragon Balls de Polunga.",
    debut_chapter: "Chapitre 244",
    debut_episode: "Épisode 44 (DBZ)",
    key_events: [
      { title: "Guerre pour les Dragon Balls", description: "Affrontement triangulaire entre les forces de Freezer, Vegeta et les terriens." },
      { title: "Destruction cataclysmique", description: "Freezer lance son Death Ball dans le noyau de la planète, provoquant son implosion en 5 minutes." }
    ],
    image: "/images/wiki/lieux/planete-namek.webp",
  },
  {
    slug: "planete-vegeta",
    name: "Planète Vegeta (Anciennement Plant)",
    name_ja: "惑星ベジータ",
    name_romaji: "Wakusei Bejīta",
    realm_type: "Univers 7",
    planet: "Vegeta",
    description: "Monde rougeoyant à gravité décuplée (10G), habité à l'origine par les Tsufuls pacifiques et avancés technologiquement, puis conquis par les barbares Saiyans conduits par le Roi Vegeta. Détruite par la Supernova de Freezer sous l'ordre officieux de Beerus.",
    debut_chapter: "Chapitre 257 (Évocation)",
    debut_episode: "Épisode 78 (DBZ)",
    key_events: [
      { title: "Guerre Saiyan-Tsuful", description: "Les Saiyans profitent de la pleine lune pour se transformer en Ôzaru et anéantir les Tsufuls." },
      { title: "L'ultime rébellion de Bardock", description: "Bardock affronte seul l'armée de Freezer dans l'orbite spatiale avant d'être englouti par l'attaque finale." }
    ],
    image: "/images/wiki/lieux/planete-vegeta.webp",
  },
  {
    slug: "planete-kaio",
    name: "Planète de Kaïô du Nord",
    name_ja: "界王星",
    name_romaji: "Kaiō-sei",
    realm_type: "Royaume des Morts",
    planet: "Planète Kaïô",
    description: "Minuscule sphère flottant à l'extrémité du Chemin du Serpent (1 000 000 km) au-dessus de l'Au-delà. Possède une gravité dix fois supérieure à celle de la Terre. Résidence de Kaïô du Nord, du singe Bubbles et de la sauterelle Gregory.",
    debut_chapter: "Chapitre 210",
    debut_episode: "Épisode 18 (DBZ)",
    key_events: [
      { title: "Apprentissage du Kaiô-ken et Genkidama", description: "Gokū y développe ses deux techniques signatures les plus puissantes auprès du maître divin." },
      { title: "Sacrifice de Gokū face à Cell", description: "Gokū téléporte Cell sur le point d'exploser sur la planète Kaïô pour sauver la Terre." }
    ],
    image: "/images/wiki/lieux/planete-kaio.webp",
  },
  {
    slug: "palais-enma",
    name: "Palais du Roi Enma",
    name_ja: "閻魔界",
    name_romaji: "Enma-kai",
    realm_type: "Royaume des Morts",
    planet: "Autre Monde",
    description: "Palais colossal d'entrée dans l'Autre Monde où siège le Roi Enma (Enma Daïō), juge suprême déterminant si les âmes des défunts sont envoyées au Paradis ou expédiées en Enfer.",
    debut_chapter: "Chapitre 205",
    debut_episode: "Épisode 12 (DBZ)",
    key_events: [
      { title: "Passage de Gokū sur le Chemin du Serpent", description: "Enma autorise Gokū à emprunter le pont serpentin pour aller s'entraîner chez Kaïô." },
      { title: "Procès de Vegeta", description: "Enma conserve l'âme de Vegeta intacte pour le renvoyer combattre Boo sur Terre en cas d'extrême urgence." }
    ],
    image: "/images/wiki/lieux/palais-enma.webp",
  },
  {
    slug: "domaine-kaioshin",
    name: "Domaine Sacré des Kaïōshin (Kaiōshin-kai)",
    name_ja: "界王神界",
    name_romaji: "Kaiōshin-kai",
    realm_type: "Divin",
    planet: "Royaume Sacré",
    description: "Royaume céleste suprême existant en dehors du macrocosme de l'univers 7. Domaine inviolable des Dieux de la Création, où nulle entité mortelle n'est censée pénétrer. Abritait l'Épée Z plantée sur son promontoire rocheux.",
    debut_chapter: "Chapitre 477",
    debut_episode: "Épisode 246 (DBZ)",
    key_events: [
      { title: "Libération du Doyen Kaïōshin", description: "Gohan brise l'Épée Z sur le bloc de Katchin le plus dur de l'univers, libérant Rō Kaiōshin." },
      { title: "Bataille finale contre Pure Boo", description: "Théâtre du combat ultime de Dragon Ball Z scellé par le Super Genkidama universel de Gokū." }
    ],
    image: "/images/wiki/lieux/domaine-kaioshin.webp",
  },
  {
    slug: "planete-beerus",
    name: "Planète du Dieu de la Destruction Beerus",
    name_ja: "ビルス星",
    name_romaji: "Birusu-sei",
    realm_type: "Divin",
    planet: "Monde de Beerus",
    description: "Monde fantastique en forme de pyramide inversée coiffée d'un arbre géant sacré flottant au cœur d'un univers étoilé. Lieu de repos millénaire de Beerus et terrain d'entraînement divin orchestré par Whis.",
    debut_chapter: "DBS Chapitre 2",
    debut_episode: "Épisode 2 (DBS)",
    key_events: [
      { title: "Entraînement divin au Ki divin", description: "Gokū et Vegeta y découvrent le Super Saiyan Blue sous la tutelle de Whis." },
      { title: "Refuge de Broly", description: "Broly, Cheelai et Lemo y trouvent refuge pour s'entraîner à maîtriser la rage d'Ôzaru." }
    ],
    image: "/images/wiki/lieux/planete-beerus.webp",
  },
  {
    slug: "monde-du-vide",
    name: "Monde du Vide (Arène du Tournoi du Pouvoir)",
    name_ja: "無の界",
    name_romaji: "Mu no Kai",
    realm_type: "Monde du Vide",
    planet: "Néant",
    description: "Espace infini dénué de matière, d'espace et de temps, situé au-delà des douze univers. Le Grand Prêtre Daishinkan y bâtit l'arène en Kachi-Katchin pour accueillir les 80 guerriers du Tournoi du Pouvoir.",
    debut_chapter: "DBS Chapitre 32",
    debut_episode: "Épisode 96 (DBS)",
    key_events: [
      { title: "Tournoi du Pouvoir", description: "Affrontement royal pour la survie des univers où 7 univers sont effacés avant leur restauration finale." },
      { title: "Éveil de l'Ultra Instinct", description: "Son Gokū brise ses limites mortelles face à Jiren pour atteindre le Migatte no Gokui." }
    ],
    image: "/images/wiki/lieux/monde-du-vide.webp",
  },
  {
    slug: "palais-zeno",
    name: "Palais du Roi Zeno",
    name_ja: "全王の宮殿",
    name_romaji: "Zen'ō no Kyūden",
    realm_type: "Divin",
    planet: "Sommet du Multivers",
    description: "Résidence du souverain suprême du multivers, située au sommet de toutes les dimensions. Bâtiment entouré de 12 univers suspendus comme des billes colorées, gardé par le Grand Prêtre Daishinkan et les gardes royaux.",
    debut_chapter: "DBS Chapitre 18",
    debut_episode: "Épisode 55 (DBS)",
    key_events: [
      { title: "Visite amicale de Gokū", description: "Gokū se lie d'amitié avec Zeno et lui offre le bouton d'appel d'urgence." },
      { title: "Alliance des deux Zeno", description: "Gokū ramène le Zeno du futur dans cette dimension après l'éradication de Zamasu fusionné." }
    ],
    image: "/images/wiki/lieux/palais-zeno.webp",
  },
  {
    slug: "planete-yardrat",
    name: "Planète Yardrat",
    name_ja: "ヤードラット星",
    name_romaji: "Yādoratto-sei",
    realm_type: "Univers 7",
    planet: "Yardrat",
    description: "Monde habité par un peuple pacifique aux caractéristiques physiques uniques, maîtres incontestés du contrôle de l'esprit et du Ki (Contrôle Spirituel). Ils soignent Gokū après l'explosion de Namek.",
    debut_chapter: "Chapitre 335 (Évocation)",
    debut_episode: "Épisode 121 (DBZ)",
    key_events: [
      { title: "Transmission instantanée", description: "Son Gokū y apprend le Déplacement instantané (Shunkan Idō) auprès des Yardrats." },
      { title: "Entraînement de Vegeta", description: "Vegeta s'y rend durant l'arc Moro pour apprendre la Fission Forcée de l'Esprit (Forced Spirit Fission)." }
    ],
    image: "/images/wiki/lieux/planete-yardrat.webp",
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// DATASETS : TOURNOIS D'ARTS MARTIAUX
// ─────────────────────────────────────────────────────────────────────────────
const TOURNAMENTS_DATA = [
  {
    slug: "21e-tenkaichi-budokai",
    name: "21e Tenkaichi Budōkai",
    name_ja: "第21回天下一武道会",
    tournament_type: "Tenkaichi Budōkai",
    saga: "Saga Armée du Red Ribbon",
    location: "Arène du Tenkaichi Budōkai (Île Papaye)",
    winner_name: "Jackie Chun (Kamé Sennin)",
    runner_up_name: "Son Gokū",
    rules_summary: "Élimination par sortie de ring, décompte de 10 secondes au sol, ou abandon. Interdiction absolue de tuer l'adversaire ou d'utiliser des armes.",
    participants_count: 138,
    canon: true,
    notable_matches: [
      { round: "Quart de finale", fighterA: "Son Gokū", fighterB: "Guilan", winner: "Son Gokū", techniqueOrClimax: "Gokū brise la colle Guru-guru et déploie sa queue." },
      { round: "Demi-finale", fighterA: "Krilin", fighterB: "Jackie Chun", winner: "Jackie Chun", techniqueOrClimax: "Vitesse invisible et double coup sauté." },
      { round: "Finale", fighterA: "Jackie Chun", fighterB: "Son Gokū", winner: "Jackie Chun", techniqueOrClimax: "Kaméhaméha géant pulvérisant la pleine lune pour calmer Ôzaru, puis double coup de pied tombé." }
    ],
  },
  {
    slug: "22e-tenkaichi-budokai",
    name: "22e Tenkaichi Budōkai",
    name_ja: "第22回天下一武道会",
    tournament_type: "Tenkaichi Budōkai",
    saga: "Saga Tenshinhan",
    location: "Arène du Tenkaichi Budōkai (Île Papaye)",
    winner_name: "Tenshinhan",
    runner_up_name: "Son Gokū",
    rules_summary: "Règles traditionnelles du Tenkaichi Budōkai avec interdiction d'armes et obligation de respect du ring.",
    participants_count: 182,
    canon: true,
    notable_matches: [
      { round: "Quart de finale", fighterA: "Yamcha", fighterB: "Tenshinhan", winner: "Tenshinhan", techniqueOrClimax: "Tenshinhan brise brutalement la jambe de Yamcha." },
      { round: "Demi-finale", fighterA: "Son Gokū", fighterB: "Krilin", winner: "Son Gokū", techniqueOrClimax: "Gokū utilise sa vitesse démesurée pour surprendre Krilin." },
      { round: "Finale", fighterA: "Tenshinhan", fighterB: "Son Gokū", winner: "Tenshinhan", techniqueOrClimax: "Kikōhō détruisant le ring ; Gokū heurte un camion en chutant et touche le sol en premier d'une fraction de seconde." }
    ],
  },
  {
    slug: "23e-tenkaichi-budokai",
    name: "23e Tenkaichi Budōkai",
    name_ja: "第23回天下一武道会",
    tournament_type: "Tenkaichi Budōkai",
    saga: "Saga Piccolo Junior",
    location: "Arène du Tenkaichi Budōkai (Île Papaye)",
    winner_name: "Son Gokū",
    runner_up_name: "Ma Junior (Piccolo)",
    rules_summary: "Règles officielles de combat singulier sous la menace de conquête planétaire par l'incarnation de Piccolo Daimaō.",
    participants_count: 72,
    canon: true,
    notable_matches: [
      { round: "Quart de finale", fighterA: "Son Gokū", fighterB: "Chi-Chi", winner: "Son Gokū", techniqueOrClimax: "Pression d'air projetant Chi-Chi hors du ring, conclue par la promesse de mariage." },
      { round: "Demi-finale", fighterA: "Kami-sama (Shen)", fighterB: "Ma Junior", winner: "Ma Junior", techniqueOrClimax: "Contre-Mafūba emprisonnant Dieu dans sa propre fiole." },
      { round: "Finale", fighterA: "Son Gokū", fighterB: "Ma Junior", winner: "Son Gokū", techniqueOrClimax: "Coup de tête phénoménal de Gokū propulsé par la danse de l'air alors que tous ses membres étaient brisés." }
    ],
  },
  {
    slug: "cell-game",
    name: "Le Cell Game",
    name_ja: "セルゲーム",
    tournament_type: "Cell Game",
    saga: "Saga des Cyborgs",
    location: "Arène du Cell Game (Désert du Nord)",
    winner_name: "Son Gohan",
    runner_up_name: "Perfect Cell",
    rules_summary: "Créé par Cell : combat individuel à mort sans limite de temps. La règle du hors-ring est abolie par Cell lui-même en cours d'affrontement en désintégrant son arène.",
    participants_count: 10,
    canon: true,
    notable_matches: [
      { round: "Match 1", fighterA: "Mr. Satan", fighterB: "Perfect Cell", winner: "Perfect Cell", techniqueOrClimax: "Une gifle dédaigneuse envoyant Satan voler dans les rochers." },
      { round: "Match 2", fighterA: "Son Gokū", fighterB: "Perfect Cell", winner: "Abandon de Gokū", techniqueOrClimax: "Instant Transmission Kaméhaméha pulvérisant le haut du corps de Cell qui se régénère." },
      { round: "Match 3", fighterA: "Son Gohan", fighterB: "Super Perfect Cell", winner: "Son Gohan", techniqueOrClimax: "Kaméhaméha Père-Fils à un bras avec diversion de Vegeta désintégrant chaque cellule de Cell." }
    ],
  },
  {
    slug: "25e-tenkaichi-budokai",
    name: "25e Tenkaichi Budōkai",
    name_ja: "第25回天下一武道会",
    tournament_type: "Tenkaichi Budōkai",
    saga: "Saga Majin Boo",
    location: "Arène du Tenkaichi Budōkai (Île Papaye)",
    winner_name: "Mr. Satan (Arrangement)",
    runner_up_name: "C-18",
    rules_summary: "Introduction d'une division junior et de la machine à mesurer la puissance de frappe (Punching Machine).",
    participants_count: 194,
    canon: true,
    notable_matches: [
      { round: "Finale Junior", fighterA: "Trunks", fighterB: "Son Goten", winner: "Trunks", techniqueOrClimax: "Trunks passe brièvement en Super Saiyan pour se dégager et surprend Goten." },
      { round: "Huitième", fighterA: "Son Gohan", fighterB: "Kibito", winner: "Interrompu", techniqueOrClimax: "Gohan dévoile son SSJ2, Spopovitch et Yamu lui dérobent son énergie pour Babidi." },
      { round: "Bataille royale adulte", fighterA: "C-18", fighterB: "Mr. Satan", winner: "Mr. Satan", techniqueOrClimax: "C-18 négocie sa défaite contre 20 millions de Zénis et simule un vol plané." }
    ],
  },
  {
    slug: "tournoi-du-pouvoir",
    name: "Tournoi du Pouvoir (Chikara no Taikai)",
    name_ja: "力の大会",
    tournament_type: "Tournoi du Pouvoir",
    saga: "Saga de la Survie de l'Univers",
    location: "Arène du Monde du Vide",
    winner_name: "C-17 (Univers 7)",
    runner_up_name: "Jiren (Univers 11)",
    rules_summary: "Bataille royale de 80 combattants (8 univers de 10 guerriers) durant 48 minutes terriennes. Armes et mise à mort interdites. Élimination par projection hors de l'arène. L'univers perdant tous ses combattants est immédiatement effacé par Zeno.",
    participants_count: 80,
    canon: true,
    notable_matches: [
      { round: "Bataille d'anéantissement", fighterA: "Gokū & Vegeta", fighterB: "Trio du Danger (U9)", winner: "Univers 7", techniqueOrClimax: "Final Flash et Kaméhaméha éjectant le trio, menant à l'effacement de l'Univers 9." },
      { round: "Choc des Titans", fighterA: "Son Gokū (Ultra Instinct Maîtrisé)", fighterB: "Jiren (Pleine Puissance)", winner: "Non décisif", techniqueOrClimax: "Gokū domine Jiren avant que son corps ne subisse le contrecoup cataclysmique du Ki divin." },
      { round: "Assaut final", fighterA: "Son Gokū, Freezer & C-17", fighterB: "Jiren", winner: "Univers 7", techniqueOrClimax: "Gokū et Freezer se sacrifient ensemble pour projeter Jiren hors du ring, laissant C-17 seul survivant." }
    ],
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// DATASETS : DOUBLEURS & SEIYŪ LÉGENDAIRES
// ─────────────────────────────────────────────────────────────────────────────
const VOICE_ACTORS_DATA = [
  {
    slug: "masako-nozawa",
    name: "Masako Nozawa",
    name_ja: "野沢雅子",
    nationality: "ja",
    birth_date: "1936-10-25",
    roles: [
      { characterName: "Son Gokū", series: "DB, DBZ, DBGT, DBS, Daima", notes: "Voix officielle depuis 1986." },
      { characterName: "Son Gohan", series: "DBZ, DBS", notes: "De l'enfance à la forme Beast." },
      { characterName: "Son Goten", series: "DBZ, DBS", notes: "Enfance et adolescence." },
      { characterName: "Bardock", series: "DBZ Specials, DBS", notes: "Voix du père géniteur." },
      { characterName: "Goku Black", series: "DBS", notes: "Interprétation sombre et maléfique saluée mondialement." }
    ],
    biography: "Monstre sacré du doublage japonais et pionnière de l'animation. Choisie personnellement par Akira Toriyama pour incarner Son Gokū dès 1986, elle détient deux records du monde Guinness pour avoir incarné le même personnage dans les jeux vidéo pendant plus de 23 ans.",
    image: "/images/wiki/voix/masako-nozawa.webp",
  },
  {
    slug: "ryo-horikawa",
    name: "Ryō Horikawa",
    name_ja: "堀川りょう",
    nationality: "ja",
    birth_date: "1958-02-01",
    roles: [
      { characterName: "Vegeta", series: "DBZ, DBGT, DBS", notes: "Timbre altier et impérial indissociable du prince des Saiyans." },
      { characterName: "Vegetto", series: "DBZ, DBS", notes: "Fusion vocale avec Masako Nozawa." }
    ],
    biography: "Acteur shakespearien de formation, Ryō Horikawa a insufflé à Vegeta sa noblesse hautaine, sa diction aristocratique et sa rage viscérale, faisant de la réplique 'Kakarotto !' l'une des exclamations les plus célèbres de l'histoire du manga.",
    image: "/images/wiki/voix/ryo-horikawa.webp",
  },
  {
    slug: "toshio-furukawa",
    name: "Toshio Furukawa",
    name_ja: "古川登志夫",
    nationality: "ja",
    birth_date: "1946-07-16",
    roles: [
      { characterName: "Piccolo", series: "DB, DBZ, DBGT, DBS, Daima", notes: "Incarne la gravité, la sagesse et le mentorat paternel de Gohan." }
    ],
    biography: "Grand maître du théâtre et comédien prolifique, Toshio Furukawa a façonné le passage de Piccolo du statut d'antagoniste démoniaque impitoyable à celui de protecteur sage et bienveillant de la famille de Son Gokū.",
    image: "/images/wiki/voix/toshio-furukawa.webp",
  },
  {
    slug: "mayumi-tanaka",
    name: "Mayumi Tanaka",
    name_ja: "田中真弓",
    nationality: "ja",
    birth_date: "1955-01-15",
    roles: [
      { characterName: "Krilin", series: "DB, DBZ, DBGT, DBS, Daima", notes: "Énergie comique et bravoure désespérée." },
      { characterName: "Yajirobé", series: "DB, DBZ", notes: "Goinfrerie et farniente." }
    ],
    biography: "Comédienne de légende également célèbre pour son rôle de Monkey D. Luffy dans One Piece. Son amitié complice avec Masako Nozawa se reflète directement dans l'alchimie unique entre Gokū et Krilin depuis 1986.",
    image: "/images/wiki/voix/mayumi-tanaka.webp",
  },
  {
    slug: "patrick-borg",
    name: "Patrick Borg",
    name_ja: null,
    nationality: "fr",
    birth_date: "1957-08-06",
    roles: [
      { characterName: "Son Gokū (adulte)", series: "DBZ, DBS, Films", notes: "La voix française officielle et héroïque de Gokū adulte." },
      { characterName: "Bardock", series: "DBZ TV Special", notes: "Le père de Gokū dans Le Père de Sangoku." }
    ],
    biography: "Acteur de doublage français incontournable, Patrick Borg est la voix héroïque et chaleureuse de Son Gokū adulte en version française depuis la saga Saiyans. Ses cris de combat sur le Kaméhaméha et le Super Saiyan ont marqué plusieurs générations de spectateurs francophones.",
    image: "/images/wiki/voix/patrick-borg.webp",
  },
  {
    slug: "brigitte-lecordier",
    name: "Brigitte Lecordier",
    name_ja: null,
    nationality: "fr",
    birth_date: "1961-04-14",
    roles: [
      { characterName: "Son Gokū (enfant)", series: "Dragon Ball, Daima", notes: "Créatrice de l'identité vocale française de l'enfant sauvage." },
      { characterName: "Son Gohan (enfant)", series: "DBZ", notes: "Sagas Saiyan, Namek et début Cyborgs." },
      { characterName: "Son Goten (enfant)", series: "DBZ, DBS", notes: "L'espièglerie du second fils." },
      { characterName: "C-18", series: "DBZ, DBS", notes: "Timbre froid et charme tranchant." }
    ],
    biography: "Figure emblématique du doublage et de la culture pop française, Brigitte Lecordier incarne l'enfance de Dragon Ball. Sa fraîcheur, son insolence candide et sa maîtrise technique ont fait de Gokū enfant une icône culturelle majeure en France.",
    image: "/images/wiki/voix/brigitte-lecordier.webp",
  },
  {
    slug: "eric-legrand",
    name: "Éric Legrand",
    name_ja: null,
    nationality: "fr",
    birth_date: "1952-06-15",
    roles: [
      { characterName: "Vegeta", series: "DBZ, DBS, Films", notes: "La voix royale et légendaire du Prince des Saiyans en VF." },
      { characterName: "Yamcha", series: "DB, DBZ", notes: "Premières apparitions du bandit du désert." }
    ],
    biography: "Comédien de théâtre et directeur artistique d'exception, Éric Legrand a forgé la personnalité de Vegeta en VF avec son insolence théâtrale, ses colères flamboyantes et ses apostrophes devenues cultes ('Misérable insecte !', 'Salaud !').",
    image: "/images/wiki/voix/eric-legrand.webp",
  },
  {
    slug: "philippe-ariotti",
    name: "Philippe Ariotti",
    name_ja: null,
    nationality: "fr",
    birth_date: "1941-08-11",
    roles: [
      { characterName: "Piccolo", series: "DB, DBZ, DBS", notes: "La sagesse martiale et le timbre caverneux." },
      { characterName: "Freezer", series: "DBZ, DBS, Films", notes: "Le raffinement sadique et aristocratique." },
      { characterName: "Oolong", series: "DB, DBZ", notes: "Le cochon métamorphe pleutre." }
    ],
    biography: "Chanteur d'opéra et comédien caméléon, Philippe Ariotti possède l'une des carrières les plus riches du doublage français. Sa capacité à alterner entre le ton solennel de Piccolo et la cruauté précieuse de Freezer en fait un pilier de la franchise.",
    image: "/images/wiki/voix/philippe-ariotti.webp",
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// DATASETS : MUSIQUES & BANDES ORIGINALES
// ─────────────────────────────────────────────────────────────────────────────
const SOUNDTRACKS_DATA = [
  {
    slug: "cha-la-head-cha-la",
    title: "Cha-La Head-Cha-La",
    title_ja: "CHA-LA HEAD-CHA-LA",
    title_romaji: "Cha-Ra Heddo-Cha-Ra",
    track_type: "opening",
    series: "Dragon Ball Z",
    artist: "Hironobu Kageyama",
    composer: "Chiho Kiyooka",
    lyricist: "Yukinojo Mori",
    episodes_range: "Épisodes 1 à 199 (DBZ)",
    release_year: 1989,
    description: "Le premier opening de Dragon Ball Z et le morceau le plus emblématique de toute l'animation japonaise dans le monde. Vendu à plus de 1,7 million d'exemplaires lors de sa sortie originale au Japon.",
  },
  {
    slug: "makafushigi-adventure",
    title: "Makafushigi Adventure!",
    title_ja: "魔訶不思議アドベンチャー!",
    title_romaji: "Makafushigi Adobenchā!",
    track_type: "opening",
    series: "Dragon Ball",
    artist: "Hiroki Takahashi",
    composer: "Takeshi Ike",
    lyricist: "Yuriko Mori",
    episodes_range: "Épisodes 1 à 153 (Dragon Ball)",
    release_year: 1986,
    description: "Générique d'ouverture originel de la saga Dragon Ball. Rythme entraînant et cuivres éclatants symbolisant la quête des sept boules de cristal et l'esprit d'aventure innocent de Son Gokū enfant.",
  },
  {
    slug: "we-gotta-power",
    title: "We Gotta Power",
    title_ja: "WE GOTTA POWER",
    title_romaji: "Wī Gatta Pawā",
    track_type: "opening",
    series: "Dragon Ball Z",
    artist: "Hironobu Kageyama",
    composer: "Keiju Ishikawa",
    lyricist: "Yukinojo Mori",
    episodes_range: "Épisodes 200 à 291 (DBZ)",
    release_year: 1993,
    description: "Second opening de Dragon Ball Z accompagnant la saga Majin Boo et le passage à l'âge adulte de Son Gohan. Guitares électriques ultra énergiques et refrain explosif.",
  },
  {
    slug: "dan-dan-kokoro-hikareteku",
    title: "Dan Dan Kokoro Hikareteku",
    title_ja: "DAN DAN 心魅かれてく",
    title_romaji: "Dan Dan Kokoro Hikareteku",
    track_type: "opening",
    series: "Dragon Ball GT",
    artist: "Field of View (Composé par Tetsurō Oda / Écrit par Izumi Sakai - ZARD)",
    composer: "Tetsurō Oda",
    lyricist: "Izumi Sakai",
    episodes_range: "Épisodes 1 à 64 (Dragon Ball GT)",
    release_year: 1996,
    description: "Mélodie pop-rock légendaire transcendante et mélancolique, considérée comme l'un des chefs-d'œuvre musicaux absolus de la franchise Dragon Ball.",
  },
  {
    slug: "genkai-toppa-survivor",
    title: "Genkai Toppa × Survivor",
    title_ja: "限界突破×サバイバー",
    title_romaji: "Genkai Toppa Sabaibā",
    track_type: "opening",
    series: "Dragon Ball Super",
    artist: "Kiyoshi Hikawa",
    composer: "Norihito Sumitomo",
    lyricist: "Yukinojo Mori",
    episodes_range: "Épisodes 77 à 131 (DBS)",
    release_year: 2017,
    description: "Hymne rock ultra-nerveux du Tournoi du Pouvoir, accompagnant la montée en puissance de l'Ultra Instinct et l'affrontement titanesque entre Gokū et Jiren.",
  },
  {
    slug: "solid-state-scouter",
    title: "Solid State Scouter",
    title_ja: "ソリッドステート・スカウター",
    title_romaji: "Soriddo Sutēto Sukautā",
    track_type: "insert_song",
    series: "Dragon Ball Z",
    artist: "Dragon Magic Orchestra (TOKIO)",
    composer: "Fuminori Yasuda",
    lyricist: "Fuminori Yasuda",
    episodes_range: "Téléfilm 'Le Père de Sangoku' (1990)",
    release_year: 1990,
    description: "Morceau de synth-wave agressif avec compte à rebours de Battle Powers au scouter égrenant la montée en puissance des soldats massacrés par Bardock avant son face-à-face avec Freezer.",
  },
  {
    slug: "tamashii-tai-tamashii",
    title: "Unmei no Hi ~Tamashii tai Tamashii~",
    title_ja: "運命の日〜魂VS魂〜",
    title_romaji: "Unmei no Hi ~Tamashii tai Tamashii~",
    track_type: "insert_song",
    series: "Dragon Ball Z",
    artist: "Hironobu Kageyama",
    composer: "Chiho Kiyooka",
    lyricist: "Sakiko Iwamuro",
    episodes_range: "Épisode 184 (DBZ)",
    release_year: 1993,
    description: "La chanson d'insertion la plus célèbre de l'histoire du manga : accompagne la destruction de la tête de C-16 et l'explosion de rage pure transformant Son Gohan en Super Saiyan 2.",
  },
  {
    slug: "blizzard",
    title: "Blizzard",
    title_ja: "Blizzard",
    title_romaji: "Burizādo",
    track_type: "movie_theme",
    series: "Dragon Ball Super",
    artist: "Daichi Miura",
    composer: "Nao'ymt",
    lyricist: "Daichi Miura",
    episodes_range: "Film 'Dragon Ball Super: Broly' (2018)",
    release_year: 2018,
    description: "Thème officiel puissant et mélodique du combat dantesque sur les glaces du continent arctique entre Gogeta Super Saiyan Blue et Broly Pleine Puissance.",
  },
  {
    slug: "jaka-jaan",
    title: "Jaka Jaan",
    title_ja: "ジャカ☆ジャ～ン",
    title_romaji: "Jaka Jān",
    track_type: "opening",
    series: "Dragon Ball Daima",
    artist: "Zedd feat. C&K",
    composer: "Zedd & CLIEVY",
    lyricist: "Yukinojo Mori",
    episodes_range: "Épisodes 1 à 20 (Daima)",
    release_year: 2024,
    description: "Opening officiel du 40e anniversaire de Dragon Ball composé par le producteur mondial Zedd sur des paroles du légendaire parolier historique Yukinojo Mori.",
  }
];

async function main() {
  const pgUrl = getPgUrl();
  let sql: any = null;
  if (pgUrl) {
    sql = postgres(pgUrl);
    console.log("Connecté à PostgreSQL pour l'injection des nouveaux piliers...");
  }

  const sdb = existsSync(sqlitePath) ? new Database(sqlitePath) : null;
  if (sdb) sdb.exec("PRAGMA busy_timeout = 5000;");

  // 1. INJECTION LIEUX
  console.log(`\n--- Injection de ${LOCATIONS_DATA.length} Lieux & Sanctuaires ---`);
  for (const loc of LOCATIONS_DATA) {
    const image = publishableSeedImage(loc.image);
    if (sql) {
      await sql`
        INSERT INTO bot.db_locations (
          slug, name, name_ja, name_romaji, realm_type, planet, description,
          debut_chapter, debut_episode, key_events, image, visible
        ) VALUES (
          ${loc.slug}, ${loc.name}, ${loc.name_ja}, ${loc.name_romaji}, ${loc.realm_type},
          ${loc.planet}, ${loc.description}, ${loc.debut_chapter}, ${loc.debut_episode},
          ${sql.json(loc.key_events)}, ${image}, true
        )
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          key_events = EXCLUDED.key_events,
          image = EXCLUDED.image,
          visible = true
      `;
    }
    if (sdb) {
      sdb.run(`
        INSERT INTO db_locations (
          slug, name, name_ja, name_romaji, realm_type, planet, description,
          debut_chapter, debut_episode, key_events, image, visible
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(slug) DO UPDATE SET
          name=excluded.name, description=excluded.description, key_events=excluded.key_events, image=excluded.image, visible=1
      `, [loc.slug, loc.name, loc.name_ja, loc.name_romaji, loc.realm_type, loc.planet, loc.description, loc.debut_chapter, loc.debut_episode, JSON.stringify(loc.key_events), image]);
    }
  }

  // 2. INJECTION TOURNOIS
  console.log(`\n--- Injection de ${TOURNAMENTS_DATA.length} Tournois majeurs ---`);
  for (const t of TOURNAMENTS_DATA) {
    if (sql) {
      await sql`
        INSERT INTO bot.db_tournaments (
          slug, name, name_ja, tournament_type, saga, location, winner_name,
          runner_up_name, rules_summary, participants_count, notable_matches, canon, visible
        ) VALUES (
          ${t.slug}, ${t.name}, ${t.name_ja}, ${t.tournament_type}, ${t.saga},
          ${t.location}, ${t.winner_name}, ${t.runner_up_name}, ${t.rules_summary},
          ${t.participants_count}, ${sql.json(t.notable_matches)}, ${t.canon}, true
        )
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          winner_name = EXCLUDED.winner_name,
          runner_up_name = EXCLUDED.runner_up_name,
          rules_summary = EXCLUDED.rules_summary,
          notable_matches = EXCLUDED.notable_matches,
          visible = true
      `;
    }
    if (sdb) {
      sdb.run(`
        INSERT INTO db_tournaments (
          slug, name, name_ja, tournament_type, saga, location, winner_name,
          runner_up_name, rules_summary, participants_count, notable_matches, canon, visible
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(slug) DO UPDATE SET
          name=excluded.name, winner_name=excluded.winner_name, rules_summary=excluded.rules_summary, notable_matches=excluded.notable_matches, visible=1
      `, [t.slug, t.name, t.name_ja, t.tournament_type, t.saga, t.location, t.winner_name, t.runner_up_name, t.rules_summary, t.participants_count, JSON.stringify(t.notable_matches), t.canon ? 1 : 0]);
    }
  }

  // 3. INJECTION DOUBLEURS & SEIYŪ
  console.log(`\n--- Injection de ${VOICE_ACTORS_DATA.length} Doubleurs & Seiyū ---`);
  for (const va of VOICE_ACTORS_DATA) {
    const image = publishableSeedImage(va.image);
    if (sql) {
      await sql`
        INSERT INTO bot.db_voice_actors (
          slug, name, name_ja, nationality, birth_date, roles, biography, image, visible
        ) VALUES (
          ${va.slug}, ${va.name}, ${va.name_ja}, ${va.nationality}, ${va.birth_date},
          ${sql.json(va.roles)}, ${va.biography}, ${image}, true
        )
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          roles = EXCLUDED.roles,
          biography = EXCLUDED.biography,
          image = EXCLUDED.image,
          visible = true
      `;
    }
    if (sdb) {
      sdb.run(`
        INSERT INTO db_voice_actors (
          slug, name, name_ja, nationality, birth_date, roles, biography, image, visible
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(slug) DO UPDATE SET
          name=excluded.name, roles=excluded.roles, biography=excluded.biography, image=excluded.image, visible=1
      `, [va.slug, va.name, va.name_ja, va.nationality, va.birth_date, JSON.stringify(va.roles), va.biography, image]);
    }
  }

  // 4. INJECTION MUSIQUES & BANDES ORIGINALES
  console.log(`\n--- Injection de ${SOUNDTRACKS_DATA.length} Musiques & Thèmes ---`);
  for (const ost of SOUNDTRACKS_DATA) {
    if (sql) {
      await sql`
        INSERT INTO bot.db_soundtracks (
          slug, title, title_ja, title_romaji, track_type, series, artist,
          composer, lyricist, episodes_range, release_year, description, visible
        ) VALUES (
          ${ost.slug}, ${ost.title}, ${ost.title_ja}, ${ost.title_romaji},
          ${ost.track_type}, ${ost.series}, ${ost.artist}, ${ost.composer},
          ${ost.lyricist}, ${ost.episodes_range}, ${ost.release_year},
          ${ost.description}, true
        )
        ON CONFLICT (slug) DO UPDATE SET
          title = EXCLUDED.title,
          artist = EXCLUDED.artist,
          description = EXCLUDED.description,
          visible = true
      `;
    }
    if (sdb) {
      sdb.run(`
        INSERT INTO db_soundtracks (
          slug, title, title_ja, title_romaji, track_type, series, artist,
          composer, lyricist, episodes_range, release_year, description, visible
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(slug) DO UPDATE SET
          title=excluded.title, artist=excluded.artist, description=excluded.description, visible=1
      `, [ost.slug, ost.title, ost.title_ja, ost.title_romaji, ost.track_type, ost.series, ost.artist, ost.composer, ost.lyricist, ost.episodes_range, ost.release_year, ost.description]);
    }
  }

  if (sql) await sql.end();
  if (sdb) sdb.close();
  console.log("\n✓ Injection d'expansion terminée avec succès dans PostgreSQL et SQLite !");
}

main().catch(console.error);
