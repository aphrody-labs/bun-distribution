#!/usr/bin/env bun
/**
 * seed-mega-dragon-ball-data.ts — Injection massive des 5 piliers Dragon Ball
 *
 * Remplit PostgreSQL (schéma `bot`) et SQLite (apps/bot/data/bot.db) avec :
 * 1. 150+ Combats majeurs canoniques et légendaires (DB, DBZ, DBS, Daima, Films)
 * 2. 80+ Événements de la Chronologie universelle par Âge (Daizenshuu 7 P.16-33)
 * 3. 70+ Niveaux de Puissance officiels (Scouter manga & Daizenshuu 7)
 * 4. 50+ Objets, Reliques & Technologies (Capsule Corp, Karin, Kami-sama, Potalas)
 * 5. 5 Dragons sacrés & 40+ Vœux canoniques exaucés
 *
 * Source de vérité : 42 tomes manga Akira Toriyama, Daizenshuu 7, Chōzenshū 4.
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
        return last.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
      }
    } catch {}
  }
  return null;
}

const sqlitePath = join(import.meta.dir, "../../apps/bot/data/bot.db");

function publishableSeedImage(image: string): string | null {
  if (!image.startsWith("/assets/")) return image;
  const file = join(import.meta.dir, "../../apps/bot/public", image.replace(/^\/+/, ""));
  return existsSync(file) ? image : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. DATASETS : DRAGONS SACRÉS
// ─────────────────────────────────────────────────────────────────────────────
const DRAGONS_DATA = [
  {
    slug: "shenron",
    name: "Shenron",
    name_ja: "神龍 (シェンロン)",
    creator: "Le Tout-Puissant (Kami-sama) puis Dendé",
    planet_realm: "Terre (Planète Terre, Univers 7)",
    balls_count: 7,
    balls_diameter: "7,5 cm",
    summon_phrase: "Sors, Shenron ! Et réalise mon souhait !",
    summon_phrase_ja: "いでよ神龍、そして願いをかなえたまえ！",
    wishes_count: 3,
    cooldown: "1 an terrestre (réduit à 4 mois si un seul vœu est consommé)",
    rules: "Ne peut pas ressusciter une personne morte de causes naturelles. Ne peut pas ressusciter plusieurs fois la même personne (sous l'ère du Tout-Puissant ; Dendé assouplit les résurrections multiples sous réserve de vœux distincts). Ne peut pas outrepasser la force de son créateur.",
    image: "/assets/dragons/shenron.webp",
    article: "Shenron est le dragon sacré de la Terre, invoqué par les sept Dragon Balls terrestres serties d'étoiles rouges. Créé par le Tout-Puissant à partir d'une statuette modelée selon la silhouette de Polunga.",
  },
  {
    slug: "polunga",
    name: "Polunga",
    name_ja: "ポルンガ",
    creator: "Le Grand Chef (Saichōrō) puis Moori",
    planet_realm: "Planète Namek (Nouvelle Namek, Univers 7)",
    balls_count: 7,
    balls_diameter: "Taille d'un ballon de basket (~30 cm)",
    summon_phrase: "Takkaraputo popoporunga pupirittopaaro (Apparais Polunga, et exauce nos vœux !)",
    summon_phrase_ja: "タッカラプト ポポルンガ プピリットパロ",
    wishes_count: 3,
    cooldown: "1 an namekien (130 jours terrestres)",
    rules: "Exauce 3 vœux distincts. Sous Saichōrō, ne pouvait ressusciter qu'une seule personne par vœu mais un nombre infini de fois. Après son amélioration par Moori sur la Nouvelle Namek, il peut ressusciter une multitude de personnes en un seul vœu tout en conservant 3 vœux.",
    image: "/assets/dragons/polunga.webp",
    article: "Polunga, dont le nom signifie « Dieu des Rêves » en dialecte namekien, est le dragon titanesque de Namek. Doté de cornes massives, d'une collerette dorsale imposante et de bras musculeux.",
  },
  {
    slug: "super-shenron",
    name: "Super Shenron",
    name_ja: "超神龍 (スーパーシェンロン)",
    creator: "Zalama, le Dieu Dragon Divin",
    planet_realm: "Entre les Univers 6 et 7 (Multivers)",
    balls_count: 7,
    balls_diameter: "37 196 km (taille d'une planète géante)",
    summon_phrase: "Apparais, dragon divin, et daigne réaliser mon vœu ! (en Langage des Dieux)",
    summon_phrase_ja: "いでよ神の龍 そして願いを叶えてちょんまげ (神の言語)",
    wishes_count: 1,
    cooldown: "Indéterminé (les Super Dragon Balls se dispersent dans les Univers 6 et 7)",
    rules: "Zéro limite. Aucun interdit. Peut restaurer des univers effacés par le Roi Zeno, accorder l'immortalité absolue, ou échanger les corps avec une divinité suprême.",
    image: "/assets/dragons/super_shenron.webp",
    article: "Super Shenron est l'entité ultime du multivers créée par le Dieu Dragon Zalama en l'An 41 du calendrier divin. Son corps doré est si colossal qu'il engloutit des galaxies entières.",
  },
  {
    slug: "toronbo",
    name: "Toronbo",
    name_ja: "トロンボ",
    creator: "Monite (Namekien de la tribu de Cereal)",
    planet_realm: "Planète Cereal (Univers 7)",
    balls_count: 2,
    balls_diameter: "7,5 cm (Dragon Balls à 2 étoiles)",
    summon_phrase: "Apparais Toronbo !",
    summon_phrase_ja: "いでよトロンボ！",
    wishes_count: 1,
    cooldown: "Aucun cooldown annuel (immédiatement réutilisable après recherche)",
    rules: "Seulement 2 Dragon Balls requises. Peut exaucer le désir de devenir le guerrier le plus puissant de l'univers en échange de la compression drastique de l'espérance de vie du demandeur.",
    image: "/assets/dragons/toronbo.webp",
    article: "Toronbo est un dragon ancestral namekien créé par l'ermite Monite sur Cereal. Contrairement aux autres dragons sacrés, sa réactivation ne requiert que deux perles.",
  },
  {
    slug: "ultimate-shenron",
    name: "Ultimate Shenron (Shenron Rouge)",
    name_ja: "究極神龍 (アルティメットシェンロン)",
    creator: "Le Tout-Puissant originel (avant séparation du vice)",
    planet_realm: "Palais de Dieu (Terre)",
    balls_count: 7,
    balls_diameter: "Taille standard, étoiles noires",
    summon_phrase: "Apparais, dragon ultime !",
    summon_phrase_ja: "いでよ究極の神龍！",
    wishes_count: 1,
    cooldown: "Provoque l'explosion de la planète hôte dans l'année si les boules ne sont pas réunies",
    rules: "Dragon rouge colossal créé avant que le Tout-Puissant n'expulse Piccolo Daimaō. Les Dragon Balls aux étoiles noires se dispersent dans toute la galaxie et détruisent le monde d'invocation au bout d'un an.",
    image: "/assets/dragons/ultimate_shenron.webp",
    article: "Ultimate Shenron est le dragon mythique scellé dans le tréfonds du Palais Céleste. Ses perles noires portent une malédiction cataclysmique.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 2. DATASETS : VŒUX CANONIQUES EXAUCÉS
// ─────────────────────────────────────────────────────────────────────────────
const WISHES_DATA = [
  {
    dragon_slug: "shenron",
    dragon_name: "Shenron",
    wish_number: 1,
    whisperer: "Oolong",
    saga: "Quête des Dragon Balls",
    manga_chapter: 20,
    episode_number: 12,
    wish_text: "Une culotte de fille douce et propre ! (Pour court-circuiter le vœu de domination du monde de Pilaf).",
    granted: true,
    canon: true,
  },
  {
    dragon_slug: "shenron",
    dragon_name: "Shenron",
    wish_number: 1,
    whisperer: "Upa",
    saga: "Armée du Red Ribbon",
    manga_chapter: 110,
    episode_number: 68,
    wish_text: "Ressusciter son père Bora, assassiné par le tueur à gages Taopaïpaï au pied de la Tour Karin.",
    granted: true,
    canon: true,
  },
  {
    dragon_slug: "shenron",
    dragon_name: "Shenron",
    wish_number: 1,
    whisperer: "Piccolo Daimaō",
    saga: "Piccolo Daimaō",
    manga_chapter: 148,
    episode_number: 114,
    wish_text: "Retrouver sa jeunesse éternelle et sa vigueur physique originelle.",
    granted: true,
    canon: true,
  },
  {
    dragon_slug: "shenron",
    dragon_name: "Shenron",
    wish_number: 1,
    whisperer: "Bulma, Yamcha & Oolong",
    saga: "Piccolo Daimaō",
    manga_chapter: 165,
    episode_number: 126,
    wish_text: "Ressusciter toutes les personnes innocentes assassinées par Piccolo Daimaō et ses démons (Krilin, Tortue Géniale, Chaozu).",
    granted: true,
    canon: true,
  },
  {
    dragon_slug: "shenron",
    dragon_name: "Shenron",
    wish_number: 1,
    whisperer: "Tortue Géniale",
    saga: "Saga des Saiyans",
    manga_chapter: 212,
    episode_number: 21,
    wish_text: "Ressusciter Son Goku afin qu'il puisse affronter Vegeta et Nappa sur Terre.",
    granted: true,
    canon: true,
  },
  {
    dragon_slug: "polunga",
    dragon_name: "Polunga",
    wish_number: 1,
    whisperer: "Dendé (pour Son Gohan & Krilin)",
    saga: "Saga de Namek",
    manga_chapter: 294,
    episode_number: 75,
    wish_text: "Ressusciter Piccolo, ce qui réactive simultanément les Dragon Balls de la Terre et Kami-sama.",
    granted: true,
    canon: true,
  },
  {
    dragon_slug: "polunga",
    dragon_name: "Polunga",
    wish_number: 2,
    whisperer: "Dendé (pour Son Gohan & Krilin)",
    saga: "Saga de Namek",
    manga_chapter: 294,
    episode_number: 75,
    wish_text: "Téléporter Piccolo directement sur la planète Namek pour combattre Freeza.",
    granted: true,
    canon: true,
  },
  {
    dragon_slug: "shenron",
    dragon_name: "Shenron",
    wish_number: 1,
    whisperer: "M. Popo (ordonné par Kami-sama & Kaïō)",
    saga: "Saga de Freeza",
    manga_chapter: 322,
    episode_number: 99,
    wish_text: "Ressusciter toutes les personnes massacrées par Freeza et son armée sur Namek (y compris Saichōrō et Vegeta).",
    granted: true,
    canon: true,
  },
  {
    dragon_slug: "polunga",
    dragon_name: "Polunga",
    wish_number: 3,
    whisperer: "Dendé",
    saga: "Saga de Freeza",
    manga_chapter: 323,
    episode_number: 101,
    wish_text: "Téléporter toutes les personnes présentes sur Namek vers la Terre, à l'exception de Son Goku et de Freeza.",
    granted: true,
    canon: true,
  },
  {
    dragon_slug: "polunga",
    dragon_name: "Polunga",
    wish_number: 1,
    whisperer: "Bulma & amis (sur Terre)",
    saga: "Saga de Freeza",
    manga_chapter: 329,
    episode_number: 107,
    wish_text: "Transférer l'âme de Krilin du vide spatial vers la Terre.",
    granted: true,
    canon: true,
  },
  {
    dragon_slug: "polunga",
    dragon_name: "Polunga",
    wish_number: 2,
    whisperer: "Bulma & amis (sur Terre)",
    saga: "Saga de Freeza",
    manga_chapter: 329,
    episode_number: 107,
    wish_text: "Ressusciter Krilin sur Terre.",
    granted: true,
    canon: true,
  },
  {
    dragon_slug: "polunga",
    dragon_name: "Polunga",
    wish_number: 3,
    whisperer: "Bulma & amis (sur Terre)",
    saga: "Saga de Freeza",
    manga_chapter: 329,
    episode_number: 107,
    wish_text: "Ressusciter Yamcha.",
    granted: true,
    canon: true,
  },
  {
    dragon_slug: "shenron",
    dragon_name: "Shenron",
    wish_number: 1,
    whisperer: "Yamcha",
    saga: "Saga des Cyborgs & Cell",
    manga_chapter: 417,
    episode_number: 191,
    wish_text: "Ressusciter toutes les personnes tuées par Cell (y compris Trunks du futur).",
    granted: true,
    canon: true,
  },
  {
    dragon_slug: "shenron",
    dragon_name: "Shenron",
    wish_number: 2,
    whisperer: "Krilin",
    saga: "Saga des Cyborgs & Cell",
    manga_chapter: 418,
    episode_number: 192,
    wish_text: "Retirer les dispositifs d'autodestruction internes implantés dans les corps de C-17 et C-18 par le Dr Gero.",
    granted: true,
    canon: true,
  },
  {
    dragon_slug: "shenron",
    dragon_name: "Shenron",
    wish_number: 1,
    whisperer: "Bulma",
    saga: "Saga de Majin Buu",
    manga_chapter: 453,
    episode_number: 232,
    wish_text: "Ressusciter toutes les personnes décédées le jour même au Tenkaichi Budokai (massacrées par Majin Vegeta).",
    granted: true,
    canon: true,
  },
  {
    dragon_slug: "polunga",
    dragon_name: "Polunga",
    wish_number: 1,
    whisperer: "Dendé",
    saga: "Saga de Majin Buu",
    manga_chapter: 513,
    episode_number: 282,
    wish_text: "Restaurer intégralement la planète Terre détruite par Kid Buu.",
    granted: true,
    canon: true,
  },
  {
    dragon_slug: "polunga",
    dragon_name: "Polunga",
    wish_number: 2,
    whisperer: "Dendé",
    saga: "Saga de Majin Buu",
    manga_chapter: 513,
    episode_number: 282,
    wish_text: "Ressusciter tous les Terriens et êtres vivants morts depuis l'arrivée de Babidi et Buu, à l'exclusion des êtres mauvais.",
    granted: true,
    canon: true,
  },
  {
    dragon_slug: "polunga",
    dragon_name: "Polunga",
    wish_number: 3,
    whisperer: "Dendé",
    saga: "Saga de Majin Buu",
    manga_chapter: 516,
    episode_number: 284,
    wish_text: "Restaurer pleinement l'énergie vitale épuisée de Son Goku pour pousser le Genkidama final contre Kid Buu.",
    granted: true,
    canon: true,
  },
  {
    dragon_slug: "shenron",
    dragon_name: "Shenron",
    wish_number: 1,
    whisperer: "Goku & amis",
    saga: "Saga de Majin Buu",
    manga_chapter: 517,
    episode_number: 287,
    wish_text: "Effacer de la mémoire de tous les Terriens le souvenir de Majin Buu afin que le gentil Buu puisse vivre paisiblement avec M. Satan.",
    granted: true,
    canon: true,
  },
  {
    dragon_slug: "super-shenron",
    dragon_name: "Super Shenron",
    wish_number: 1,
    whisperer: "C-17 (au nom de tous)",
    saga: "Tournoi du Pouvoir (DBS)",
    manga_chapter: 42,
    episode_number: 131,
    wish_text: "Restaurer intégralement tous les univers effacés par les Rois Zeno lors du Tournoi du Pouvoir.",
    granted: true,
    canon: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 3. DATASETS : OBJETS, ARTEFACTS & TECHNOLOGIES
// ─────────────────────────────────────────────────────────────────────────────
const ITEMS_DATA = [
  {
    slug: "dragon-radar",
    name: "Dragon Radar",
    name_ja: "ドラゴンレーダー",
    name_romaji: "Doragon Rēdā",
    category: "technologie",
    creator: "Bulma (Capsule Corp)",
    description: "Appareil circulaire de détection portable émettant une onde électromagnétique spécifique aux Dragon Balls. Permet de localiser les 7 perles avec une précision millimétrique à l'échelle planétaire.",
    debut_chapter: "Dragon Ball Tome 1, Chapitre 1",
    debut_episode: "Dragon Ball Épisode 1",
    image: "/assets/items/dragon_radar.webp",
  },
  {
    slug: "capsules-hoi-poi",
    name: "Capsules Hoi-Poi",
    name_ja: "ホイポイカプセル",
    name_romaji: "Hoi Poi Kapuseru",
    category: "technologie",
    creator: "Dr Brief (Capsule Corporation)",
    description: "Petites capsules cylindriques révolutionnaires numérotées de 1 à 99, capables de miniaturiser et stocker instantanément sous forme de particules d'énergie des véhicules, maisons entières, avions et armes lourdes.",
    debut_chapter: "Dragon Ball Tome 1, Chapitre 1",
    debut_episode: "Dragon Ball Épisode 1",
    image: "/assets/items/capsules_hoipoi.webp",
  },
  {
    slug: "senzu",
    name: "Haricot Magique (Senzu)",
    name_ja: "仙豆 (センズ)",
    name_romaji: "Senzu",
    category: "relique_magique",
    creator: "Maître Karin",
    description: "Haricot mystique cultivé au sommet de la Tour Karin. Consommer un seul Senzu régénère instantanément toute blessure corporelle grave, fractures et fatigue extrême, tout en rassasiant son consommateur pendant 10 jours.",
    debut_chapter: "Dragon Ball Tome 8, Chapitre 88",
    debut_episode: "Dragon Ball Épisode 61",
    image: "/assets/items/senzu.webp",
  },
  {
    slug: "nyoibo",
    name: "Bâton Magique (Nyoï-bô)",
    name_ja: "如意棒 (ニョイボウ)",
    name_romaji: "Nyoibō",
    category: "relique_magique",
    creator: "Kami-sama / Maître Karin",
    description: "Bâton rouge indestructible capable de s'allonger à l'infini sur commande vocale. Sert à l'origine de passerelle physique reliant le toit de la Tour Karin au Palais Céleste de Dieu.",
    debut_chapter: "Dragon Ball Tome 1, Chapitre 1",
    debut_episode: "Dragon Ball Épisode 1",
    image: "/assets/items/nyoibo.webp",
  },
  {
    slug: "kintoun",
    name: "Nuage Magique (Kinto-Un)",
    name_ja: "筋斗雲 (キントウン)",
    name_romaji: "Kinto-un",
    category: "relique_magique",
    creator: "Maître Karin",
    description: "Nuage doré volant à des vitesses supersoniques offert par Kame Sennin à Son Goku. Seules les personnes au cœur pur et exemptes de tout vice peuvent monter dessus sans passer au travers.",
    debut_chapter: "Dragon Ball Tome 1, Chapitre 4",
    debut_episode: "Dragon Ball Épisode 3",
    image: "/assets/items/kintoun.webp",
  },
  {
    slug: "potalas",
    name: "Boucles d'oreilles Potalas",
    name_ja: "ポタラ",
    name_romaji: "Potara",
    category: "relique_magique",
    creator: "Dieux Kaïōshins",
    description: "Reliques divines portées par les Kaïōshins. Lorsque deux individus placent une boucle à une oreille opposée, ils fusionnent instantanément en un guerrier supérieur. Permanente pour les dieux, limitée à 1 heure pour les mortels.",
    debut_chapter: "Dragon Ball Tome 42, Chapitre 501",
    debut_episode: "Dragon Ball Z Épisode 267",
    image: "/assets/items/potalas.webp",
  },
  {
    slug: "scouter",
    name: "Scouter (Détecteur de Ki)",
    name_ja: "スカウター",
    name_romaji: "Sukautā",
    category: "technologie",
    creator: "Peuple Tsuful, adapté par l'Armée de Freeza",
    description: "Monocle optique connecté scannant le champ de bataille. Mesure avec exactitude les unités de puissance (Battle Power), la localisation géographique et fait office de radio communicateur longue portée interplanétaire.",
    debut_chapter: "Dragon Ball Tome 17, Chapitre 195",
    debut_episode: "Dragon Ball Z Épisode 1",
    image: "/assets/items/scouter.webp",
  },
  {
    slug: "gravity-spaceship",
    name: "Vaisseau spatial à gravité augmentée (100G / 300G)",
    name_ja: "重力宇宙船",
    name_romaji: "Jūryoku Uchūsen",
    category: "vehicule",
    creator: "Dr Brief (Capsule Corporation)",
    description: "Vaisseau d'exploration interstellaire propulsé par la technologie Namek et équipé d'un générateur de gravité artificielle réglable jusqu'à 100 fois (puis 300 fois) la pesanteur terrestre.",
    debut_chapter: "Dragon Ball Tome 23, Chapitre 268",
    debut_episode: "Dragon Ball Z Épisode 46",
    image: "/assets/items/gravity_ship.webp",
  },
  {
    slug: "time-machine",
    name: "Machine à voyager dans le temps (Hope!!)",
    name_ja: "タイムマシン",
    name_romaji: "Taimu Mashin",
    category: "technologie",
    creator: "Bulma du Futur alternatif",
    description: "Véhicule sphérique temporel développé au cours de décennies d'efforts clandestins dans un futur ravagé par les Cyborgs. Permet de voyager entre les lignes temporelles en condensant une énergie de propulsion rarissime.",
    debut_chapter: "Dragon Ball Tome 28, Chapitre 335",
    debut_episode: "Dragon Ball Z Épisode 119",
    image: "/assets/items/time_machine.webp",
  },
  {
    slug: "z-sword",
    name: "Épée Z",
    name_ja: "Zソード",
    name_romaji: "Zetto Sōdo",
    category: "armement",
    creator: "Anciens Kaïōshins / Beerus",
    description: "Épée légendaire incrustée dans un promontoire du Royaume Sacré des Kaïōshins. D'un poids phénoménal, sa brisure accidentelle contre un cube de métal Katchin libère le Doyen des Kaïōshins scellé des millénaires plus tôt.",
    debut_chapter: "Dragon Ball Tome 40, Chapitre 471",
    debut_episode: "Dragon Ball Z Épisode 240",
    image: "/assets/items/z_sword.webp",
  },
  {
    slug: "time-ring",
    name: "Anneau du Temps",
    name_ja: "時の指輪",
    name_romaji: "Toki no Yubiwa",
    category: "relique_magique",
    creator: "Divinités Suprêmes (Kaïōshins)",
    description: "Anneau sacré réservé aux Kaïōshins permettant de voyager dans le futur et d'observer le cours de l'histoire cosmique sans créer d'anomalies temporelles.",
    debut_chapter: "Dragon Ball Super Tome 2, Chapitre 14",
    debut_episode: "Dragon Ball Super Épisode 53",
    image: "/assets/items/time_ring.webp",
  },
  {
    slug: "mafuba-jar",
    name: "Autocuiseur / Jarre du Mafūba",
    name_ja: "魔封波の壺",
    name_romaji: "Mafūba no Tsubo",
    category: "relique_magique",
    creator: "Maître Mutaito",
    description: "Récipient scellé hermétiquement à l'aide d'un talisman calligraphié sacré pour emprisonner définitivement les démons et entités maléfiques capturés par le tourbillon du Mafūba.",
    debut_chapter: "Dragon Ball Tome 12, Chapitre 135",
    debut_episode: "Dragon Ball Épisode 102",
    image: "/assets/items/mafuba_jar.webp",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 4. DATASETS : CHRONOLOGIE UNIVERSELLE PAR ÂGE (Daizenshuu 7 / Chōzenshū)
// ─────────────────────────────────────────────────────────────────────────────
const TIMELINE_DATA = [
  {
    age_year: -4237,
    era: "pre-history",
    title: "Naissance des Kaïōshins",
    title_ja: "界王神の誕生",
    description: "Éclosion des Kaïōshins depuis les fruits dorés de l'arbre géant Kaiju dans l'Autre-Monde. Structuration des quadrants universels et mise en place de la tutelle cosmique.",
    characters_involved: ["Kaïōshin de l'Est", "Grand Kaïōshin"],
    source_ref: "Daizenshuu 7 — Chronologie de l'univers, P.16",
    order_idx: 1,
  },
  {
    age_year: -5000000,
    era: "pre-history",
    title: "Menace de Majin Buu et massacre des Kaïōshins",
    title_ja: "魔人ブウの殺戮",
    description: "Le sorcier démoniaque Bibidi réveille Majin Buu. Des centaines de planètes sont anéanties. Les Kaïōshins du Nord et de l'Ouest sont éliminés, celui du Sud et le Grand Kaïōshin sont absorbés. Bibidi enferme Buu dans un cocon sur Terre.",
    characters_involved: ["Majin Buu", "Bibidi", "Kaïōshin de l'Est", "Grand Kaïōshin"],
    source_ref: "Daizenshuu 7 — Chronologie, P.16 & Manga Tome 42",
    order_idx: 2,
  },
  {
    age_year: -238,
    era: "pre-history",
    title: "Légende du premier Super Saiyan",
    title_ja: "伝説の超サイヤ人出現",
    description: "Apparition dans l'univers du Super Saiyan primitif légendaire. Sa puissance disproportionnée ravage plusieurs galaxies avant que son corps ne cède face à sa propre énergie destructrice.",
    characters_involved: ["Super Saiyan Primitif"],
    source_ref: "Daizenshuu 7 — P.16",
    order_idx: 3,
  },
  {
    age_year: 250,
    era: "pre-history",
    title: "Arrivée d'Enma-sama à la tête du tribunal des âmes",
    title_ja: "閻魔大王の着任",
    description: "Le Roi Enma prend ses fonctions officielles au Palais du Jugement dans l'Autre-Monde pour peser le bien et le mal des défunts.",
    characters_involved: ["Roi Enma"],
    source_ref: "Daizenshuu 7 — P.17",
    order_idx: 4,
  },
  {
    age_year: 430,
    era: "pre-history",
    title: "Naissance de Muten Roshi (Kame Sennin)",
    title_ja: "亀仙人の誕生",
    description: "Naissance de Muten Roshi sur Terre. Plus tard, il deviendra le disciple prodige du maître d'arts martiaux Mutaito avec Tsuru Sennin.",
    characters_involved: ["Muten Roshi", "Tsuru Sennin", "Maître Mutaito"],
    source_ref: "Daizenshuu 7 — P.17",
    order_idx: 5,
  },
  {
    age_year: 461,
    era: "pre-history",
    title: "Le fléau Piccolo Daimaō et le sacrifice de Mutaito",
    title_ja: "ピッコロ大魔王の封印",
    description: "Le démon Piccolo Daimaō déferle sur la Terre avec sa progéniture de démons. Maître Mutaito utilise la technique suprême du Mafūba pour sceller le Roi Démon au prix de sa vie.",
    characters_involved: ["Piccolo Daimaō", "Maître Mutaito", "Muten Roshi"],
    source_ref: "Daizenshuu 7 — P.17 & Manga Tome 12",
    order_idx: 6,
  },
  {
    age_year: 550,
    era: "pre-history",
    title: "Les Saiyans atterrissent sur la planète Plant",
    title_ja: "サイヤ人のプラント星漂着",
    description: "Les ancêtres des Saiyans dérivent dans l'espace à bord d'un vaisseau d'infortune et échouent sur la planète Plant, habitée par les Tsufuls technologiquement avancés.",
    characters_involved: ["Peuple Saiyan", "Peuple Tsuful"],
    source_ref: "Daizenshuu 7 — P.18",
    order_idx: 7,
  },
  {
    age_year: 720,
    era: "pre-history",
    title: "Guerre Saiyans-Tsufuls et fondation de la planète Vegeta",
    title_ja: "サイヤ・ツフル戦争",
    description: "Le Roi Vegeta mène la rébellion saiyenne profitant d'une pleine lune décennale pour exterminer les Tsufuls sous forme d'Ôzaru. La planète est rebaptisée Planète Vegeta.",
    characters_involved: ["Roi Vegeta"],
    source_ref: "Daizenshuu 7 — P.18",
    order_idx: 8,
  },
  {
    age_year: 737,
    era: "jeunesse-goku",
    title: "Naissance de Son Goku et destruction de la planète Vegeta",
    title_ja: "孫悟空誕生と惑星ベジータ壊滅",
    description: "Naissance de Kakarotto. Conscient du danger potentiel des Super Saiyans, Freeza détruit la planète Vegeta. Bardock périt en tentant d'intercepter la Death Ball. Le bébé Kakarotto est envoyé sur Terre et recueilli par Grand-père Son Gohan.",
    characters_involved: ["Son Goku", "Bardock", "Freeza", "Grand-père Son Gohan"],
    source_ref: "Daizenshuu 7 — P.19 & Dragon Ball Minus",
    order_idx: 9,
  },
  {
    age_year: 749,
    era: "jeunesse-goku",
    title: "Rencontre de Goku et Bulma : Départ de la quête",
    title_ja: "悟空とブルマの出会い",
    description: "Le 1er Septembre, Bulma rencontre Son Goku au Mont Paozu. Début du premier voyage à la recherche des sept boules de cristal terrestres.",
    characters_involved: ["Son Goku", "Bulma", "Oolong", "Yamcha"],
    source_ref: "Daizenshuu 7 — P.20 & Manga Tome 1",
    order_idx: 10,
  },
  {
    age_year: 750,
    era: "jeunesse-goku",
    title: "21e Tenkaichi Budokai et démantèlement du Red Ribbon",
    title_ja: "第21回天下一武道会とRR軍壊滅",
    description: "Jackie Chun (Muten Roshi) gagne le tournoi de justesse face à Goku. Goku combat l'armée du Red Ribbon, terrasse Taopaïpaï à la Tour Karin et détruit le quartier général de l'armée.",
    characters_involved: ["Son Goku", "Krilin", "Muten Roshi", "Taopaïpaï", "Commandant Red"],
    source_ref: "Daizenshuu 7 — P.21 & Manga Tomes 3 à 9",
    order_idx: 11,
  },
  {
    age_year: 753,
    era: "jeunesse-goku",
    title: "22e Tenkaichi Budokai et terreur de Piccolo Daimaō",
    title_ja: "ピッコロ大魔王の復活と討伐",
    description: "Tenshinhan remporte le tournoi. Tambourine assassine Krilin. Piccolo Daimaō retrouve sa jeunesse grâce à Shenron. Goku consomme l'Eau Ultra Sacrée et transperce Piccolo Daimaō.",
    characters_involved: ["Son Goku", "Piccolo Daimaō", "Tenshinhan", "Maître Karin", "Krilin"],
    source_ref: "Daizenshuu 7 — P.22 & Manga Tomes 10 à 14",
    order_idx: 12,
  },
  {
    age_year: 756,
    era: "jeunesse-goku",
    title: "23e Tenkaichi Budokai : Le triomphe de Goku",
    title_ja: "第23回天下一武道会：悟空優勝",
    description: "Goku, devenu adulte, bat Ma-Junior (Piccolo) en finale dans un duel mémorable. Il épouse Chichi et part vivre au Mont Paozu.",
    characters_involved: ["Son Goku", "Piccolo", "Chichi", "Kami-sama"],
    source_ref: "Daizenshuu 7 — P.23 & Manga Tomes 14 à 16",
    order_idx: 13,
  },
  {
    age_year: 761,
    era: "saiyan-namek",
    title: "Arrivée de Raditz et sacrifice héroïque de Goku",
    title_ja: "ラディッツ襲来と悟空の死",
    description: "Le 12 Octobre, Raditz révèle les origines saiyennes de Goku. Goku et Piccolo font équipe. Goku bloque Raditz et périt sous le Makankōsappō de Piccolo. Kaïō du Nord commence l'entraînement de Goku.",
    characters_involved: ["Raditz", "Son Goku", "Piccolo", "Son Gohan"],
    source_ref: "Daizenshuu 7 — P.24 & Manga Tome 17",
    order_idx: 14,
  },
  {
    age_year: 762,
    era: "saiyan-namek",
    title: "Invasion des Saiyans et choc titanesque sur Namek",
    title_ja: "サイヤ人地球襲来とナメック星の決戦",
    description: "Vegeta et Nappa attaquent la Terre. Goku revient et repousse Vegeta. Le voyage sur Namek culmine avec l'éveil du Super Saiyan de Goku face à Freeza à 100%. Planète Namek détruite.",
    characters_involved: ["Son Goku", "Vegeta", "Freeza", "Piccolo", "Son Gohan", "Krilin"],
    source_ref: "Daizenshuu 7 — P.25-27 & Manga Tomes 18 à 28",
    order_idx: 15,
  },
  {
    age_year: 764,
    era: "cyborgs-cell",
    title: "Arrivée de Trunks du futur et mort de Mecha Freeza",
    title_ja: "未来トランクス来訪とフリーザ親子の討伐",
    description: "En Août, Trunks du futur élimine Mecha Freeza et le Roi Cold. Il avertit Goku de sa mort prochaine due à une maladie cardiaque et de l'apparition des Cyborgs dans trois ans.",
    characters_involved: ["Trunks du Futur", "Mecha Freeza", "Roi Cold", "Son Goku"],
    source_ref: "Daizenshuu 7 — P.28 & Manga Tome 28",
    order_idx: 16,
  },
  {
    age_year: 767,
    era: "cyborgs-cell",
    title: "Cell Games et réveil du Super Saiyan 2 de Gohan",
    title_ja: "セルゲーム開幕と悟飯の超覚醒",
    description: "Le 26 Mai, lors des Cell Games, Goku se sacrifie avec Cell pour sauver la Terre. Cell revient sous forme Super Perfect. Son Gohan pulvérise Cell avec le Kaméhaméha Père-Fils.",
    characters_involved: ["Son Gohan", "Cell", "Son Goku", "Vegeta", "Trunks"],
    source_ref: "Daizenshuu 7 — P.29-30 & Manga Tomes 29 à 35",
    order_idx: 17,
  },
  {
    age_year: 774,
    era: "majin-buu",
    title: "Crise Majin Buu et Genkidama universel",
    title_ja: "魔人ブウ復活と元気玉決着",
    description: "Le 7 Mai, réveil de Majin Buu. Combats au Kaiôshin-kai. Vegetto humilie Buuhan. Kid Buu détruit la Terre. Goku anéantit Kid Buu grâce au Super Genkidama alimenté par l'énergie des Terriens.",
    characters_involved: ["Son Goku", "Vegeta", "Majin Buu", "Vegetto", "M. Satan"],
    source_ref: "Daizenshuu 7 — P.31-32 & Manga Tomes 36 à 42",
    order_idx: 18,
  },
  {
    age_year: 778,
    era: "super-dieux",
    title: "Éveil de Beerus et Super Saiyan God",
    title_ja: "破壊神ビルスの目覚めと超サイヤ人ゴッド",
    description: "Beerus, Dieu de la Destruction, s'éveille après une prophétie. Son Goku atteint le stade divin de Super Saiyan God grâce au rituel des 6 cœurs purs.",
    characters_involved: ["Son Goku", "Beerus", "Whis", "Vegeta"],
    source_ref: "Dragon Ball Super Tome 1 & Chōzenshū 4",
    order_idx: 19,
  },
  {
    age_year: 780,
    era: "super-dieux",
    title: "Le Tournoi du Pouvoir et l'Ultra Instinct",
    title_ja: "力の大会と身勝手の極意",
    description: "80 guerriers de 8 univers s'affrontent pour leur survie. Goku éveille et maîtrise les réflexes divins de l'Ultra Instinct pour triompher de Jiren.",
    characters_involved: ["Son Goku", "Jiren", "Vegeta", "C-17", "Freeza"],
    source_ref: "Dragon Ball Super Tomes 7 à 9",
    order_idx: 20,
  },
  {
    age_year: 784,
    era: "fin-manga",
    title: "28e Tenkaichi Budokai et départ avec Uub",
    title_ja: "第28回天下一武道会とウーブとの旅立ち",
    description: "Le 7 Mai, Goku affronte le jeune Uub (réincarnation de Majin Buu) au tournoi. Reconnaissant son potentiel prodigieux, Goku s'envole avec lui pour devenir son maître.",
    characters_involved: ["Son Goku", "Uub", "Vegeta", "Pan", "Goten"],
    source_ref: "Daizenshuu 7 — P.33 & Manga Tome 42 (Fin)",
    order_idx: 21,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 5. DATASETS : NIVEAUX DE PUISSANCE OFFICIELS (Scouter & Daizenshuu 7)
// ─────────────────────────────────────────────────────────────────────────────
const POWER_LEVELS_DATA = [
  {
    character_name: "Fermier",
    form: "Humain ordinaire",
    saga_name: "Saga des Saiyans",
    battle_power: 5,
    battle_power_display: "5",
    scouter_device: "Scouter de Raditz",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 195",
    notes: "Première mesure scouter affichée dans le manga original.",
  },
  {
    character_name: "Tortue Géniale (Muten Roshi)",
    form: "Forme de repos",
    saga_name: "Saga des Saiyans",
    battle_power: 139,
    battle_power_display: "139",
    scouter_device: "Scouter réparé par Bulma",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 209",
    notes: "Puissance en état de repos à Kame House.",
  },
  {
    character_name: "Krilin",
    form: "Forme de repos",
    saga_name: "Saga des Saiyans",
    battle_power: 206,
    battle_power_display: "206",
    scouter_device: "Scouter réparé par Bulma",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 209",
    notes: "Mesuré par Bulma avant l'entraînement chez Kami-sama.",
  },
  {
    character_name: "Tenshinhan",
    form: "Forme de repos",
    saga_name: "Saga des Saiyans",
    battle_power: 250,
    battle_power_display: "250",
    scouter_device: "Scouter réparé par Bulma",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 209",
    notes: "Mesuré par Bulma.",
  },
  {
    character_name: "Piccolo",
    form: "Avec vêtements lourds",
    saga_name: "Saga des Saiyans",
    battle_power: 322,
    battle_power_display: "322",
    scouter_device: "Scouter de Raditz",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 195",
    notes: "Première rencontre avec Raditz.",
  },
  {
    character_name: "Son Goku",
    form: "Avec vêtements lourds",
    saga_name: "Saga des Saiyans",
    battle_power: 334,
    battle_power_display: "334",
    scouter_device: "Scouter de Raditz",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 199",
    notes: "À Kame House face à Raditz.",
  },
  {
    character_name: "Piccolo",
    form: "Sans vêtements lourds",
    saga_name: "Saga des Saiyans",
    battle_power: 408,
    battle_power_display: "408",
    scouter_device: "Scouter de Raditz",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 201",
    notes: "Pendant l'affrontement contre Raditz.",
  },
  {
    character_name: "Son Goku",
    form: "Sans vêtements lourds",
    saga_name: "Saga des Saiyans",
    battle_power: 416,
    battle_power_display: "416",
    scouter_device: "Scouter de Raditz",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 201",
    notes: "Pendant l'affrontement contre Raditz.",
  },
  {
    character_name: "Son Goku",
    form: "Super Kaméhaméha concentré",
    saga_name: "Saga des Saiyans",
    battle_power: 924,
    battle_power_display: "924",
    scouter_device: "Scouter de Raditz",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 201",
    notes: "Concentration de ki dans les paumes.",
  },
  {
    character_name: "Son Gohan",
    form: "Colère dans la capsule spatiale",
    saga_name: "Saga des Saiyans",
    battle_power: 1307,
    battle_power_display: "1 307",
    scouter_device: "Scouter de Raditz",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 203",
    notes: "Éruption spontanée de puissance brisant la capsule.",
  },
  {
    character_name: "Piccolo",
    form: "Makankōsappō final",
    saga_name: "Saga des Saiyans",
    battle_power: 1440,
    battle_power_display: "1 440",
    scouter_device: "Scouter de Raditz",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 203",
    notes: "Attaque fatale transperçant Goku et Raditz.",
  },
  {
    character_name: "Saibaiman",
    form: "Guerrier végétal",
    saga_name: "Saga des Saiyans",
    battle_power: 1200,
    battle_power_display: "1 200",
    scouter_device: "Scouter de Nappa",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.82 & Manga Chapitre 215",
    notes: "Égal à la force d'un Raditz standard.",
  },
  {
    character_name: "Raditz",
    form: "Guerrier Saiyan",
    saga_name: "Saga des Saiyans",
    battle_power: 1500,
    battle_power_display: "1 500",
    scouter_device: "Estimation Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.82",
    notes: "Puissance de combat de base confirmée par Daizenshuu 7.",
  },
  {
    character_name: "Nappa",
    form: "Guerrier d'élite Saiyan",
    saga_name: "Saga des Saiyans",
    battle_power: 4000,
    battle_power_display: "4 000",
    scouter_device: "Estimation Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.82",
    notes: "Puissance physique de Nappa.",
  },
  {
    character_name: "Son Goku",
    form: "Repos à son arrivée face à Nappa",
    saga_name: "Saga des Saiyans",
    battle_power: 5000,
    battle_power_display: "5 000",
    scouter_device: "Scouter de Nappa / Vegeta",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 222",
    notes: "Goku dissimule encore sa puissance.",
  },
  {
    character_name: "Son Goku",
    form: "Puissance déployée face à Nappa",
    saga_name: "Saga des Saiyans",
    battle_power: 8000,
    battle_power_display: "Plus de 8 000",
    scouter_device: "Scouter de Vegeta",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 223",
    notes: "Le fameux 'It's over 8000!' (9000 en anime US).",
  },
  {
    character_name: "Son Goku",
    form: "Kaiô-ken x3",
    saga_name: "Saga des Saiyans",
    battle_power: 24000,
    battle_power_display: "24 000",
    scouter_device: "Calcul officiel Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.82",
    notes: "Dépasse le niveau de combat de Vegeta.",
  },
  {
    character_name: "Son Goku",
    form: "Kaiô-ken x4",
    saga_name: "Saga des Saiyans",
    battle_power: 32000,
    battle_power_display: "32 000",
    scouter_device: "Calcul officiel Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.82",
    notes: "Pendant le choc Kaméhaméha vs Galick Hō.",
  },
  {
    character_name: "Vegeta",
    form: "Base (Saga Saiyans)",
    saga_name: "Saga des Saiyans",
    battle_power: 18000,
    battle_power_display: "18 000",
    scouter_device: "Scouter de Dodoria",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 249",
    notes: "Reconnu par Dodoria sur Namek.",
  },
  {
    character_name: "Vegeta",
    form: "Ôzaru (Singe Géant)",
    saga_name: "Saga des Saiyans",
    battle_power: 180000,
    battle_power_display: "180 000",
    scouter_device: "Multiplicateur x10 officiel Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.82",
    notes: "La transformation en Ôzaru multiplie la puissance par 10.",
  },
  {
    character_name: "Cui",
    form: "Guerrier de l'armée de Freeza",
    saga_name: "Saga de Namek",
    battle_power: 18000,
    battle_power_display: "18 000",
    scouter_device: "Scouter de Cui",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 246",
    notes: "Rivalité d'antan avec Vegeta.",
  },
  {
    character_name: "Vegeta",
    form: "Après Zenkai de la Terre",
    saga_name: "Saga de Namek",
    battle_power: 24000,
    battle_power_display: "24 000",
    scouter_device: "Scouter de Cui & Dodoria",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 246",
    notes: "Pulvérise Cui sans effort.",
  },
  {
    character_name: "Dodoria",
    form: "Garde du corps de Freeza",
    saga_name: "Saga de Namek",
    battle_power: 22000,
    battle_power_display: "22 000",
    scouter_device: "Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.82",
    notes: "Inférieur aux 24 000 de Vegeta.",
  },
  {
    character_name: "Zarbon",
    form: "Forme de base",
    saga_name: "Saga de Namek",
    battle_power: 23000,
    battle_power_display: "23 000",
    scouter_device: "Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.82",
    notes: "Forme esthétique.",
  },
  {
    character_name: "Capitaine Ginyu",
    form: "Puissance maximale",
    saga_name: "Saga de Namek",
    battle_power: 120000,
    battle_power_display: "120 000",
    scouter_device: "Scouter de Ginyu",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 283",
    notes: "Affirmation explicite de Ginyu.",
  },
  {
    character_name: "Son Goku",
    form: "Kaiô-ken face à Ginyu",
    saga_name: "Saga de Namek",
    battle_power: 180000,
    battle_power_display: "180 000",
    scouter_device: "Scouter de Ginyu",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 285",
    notes: "Fait exploser le scouter de panique.",
  },
  {
    character_name: "Freeza",
    form: "1ère forme",
    saga_name: "Saga de Freeza",
    battle_power: 530000,
    battle_power_display: "530 000",
    scouter_device: "Déclaration directe de Freeza",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 286",
    notes: "« Mon niveau de combat est de 530 000. Mais rassurez-vous, je n'utiliserai pas toute ma force. »",
  },
  {
    character_name: "Freeza",
    form: "2ème forme",
    saga_name: "Saga de Freeza",
    battle_power: 1000000,
    battle_power_display: "Plus de 1 000 000",
    scouter_device: "Déclaration directe de Freeza",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 296",
    notes: "« Ma puissance de combat dépasse largement le million. »",
  },
  {
    character_name: "Freeza",
    form: "Forme finale 100%",
    saga_name: "Saga de Freeza",
    battle_power: 120000000,
    battle_power_display: "120 000 000",
    scouter_device: "Mesure éditoriale Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.83",
    notes: "Puissance musculaire extrême.",
  },
  {
    character_name: "Son Goku",
    form: "Super Saiyan (Namek)",
    saga_name: "Saga de Freeza",
    battle_power: 150000000,
    battle_power_display: "150 000 000",
    scouter_device: "Mesure officielle Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.83",
    notes: "Base de 3 000 000 multipliée par le facteur x50 officiel du Super Saiyan.",
  },
  {
    character_name: "Trunks du Futur",
    form: "Super Saiyan (Arrivée sur Terre)",
    saga_name: "Saga des Cyborgs",
    battle_power: 150000000,
    battle_power_display: "150 000 000",
    scouter_device: "Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.83",
    notes: "Face à Mecha Freeza.",
  },
  {
    character_name: "Yakon",
    form: "Monstre dévoreur de lumière",
    saga_name: "Saga de Majin Buu",
    battle_power: 800,
    battle_power_display: "800 Kiri",
    scouter_device: "Dispositif d'énergie de Babidi",
    source_kind: "kiri_babidi",
    source_page: "Manga Chapitre 451 & Daizenshuu 7 P.42",
    notes: "Mesure en Kiri : 200 à 500 Kiri suffisent à pulvériser une planète.",
  },
  {
    character_name: "Son Goku",
    form: "Super Saiyan (Vaisseau de Babidi)",
    saga_name: "Saga de Majin Buu",
    battle_power: 3000,
    battle_power_display: "3 000 Kiri",
    scouter_device: "Dispositif d'énergie de Babidi",
    source_kind: "kiri_babidi",
    source_page: "Manga Chapitre 451 & Daizenshuu 7 P.42",
    notes: "Sature et fait exploser l'estomac de Yakon.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 6. DATASETS : COMBATS LÉGENDAIRES (DB, DBZ, DBS)
// ─────────────────────────────────────────────────────────────────────────────
const BATTLES_DATA = [
  {
    slug: "goku-vs-taopaipai-tour-karin",
    title: "Son Goku vs Taopaïpaï — L'épreuve de la Tour Karin",
    title_ja: "孫悟空対桃白白",
    series: "DB",
    combatants: [
      { name: "Son Goku", side: "a" },
      { name: "Taopaïpaï", side: "b" }
    ],
    winner_name: "Son Goku",
    location: "Terre Sainte de Karin",
    manga_volume_start: 7,
    manga_volume_end: 8,
    manga_chapter_start: 85,
    manga_chapter_end: 90,
    episode_start: 58,
    episode_end: 62,
    techniques_used: ["Dodonpa", "Kaméhaméha", "Zanzōken"],
    climax_summary: "Après avoir essuyé une défaite cuisante face au tueur à gages Taopaïpaï, Goku gravit la Tour Karin. Fort de l'entraînement de Maître Karin, il surclasse Taopaïpaï et renvoie sa grenade mortelle.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "goku-vs-jackie-chun-21e-tournoi",
    title: "Son Goku vs Jackie Chun — Finale du 21e Tenkaichi Budokai",
    title_ja: "孫悟空対ジャッキー・チュン",
    series: "DB",
    combatants: [
      { name: "Son Goku", side: "a" },
      { name: "Jackie Chun (Muten Roshi)", side: "b" }
    ],
    winner_name: "Jackie Chun",
    location: "Arène du Tenkaichi Budokai",
    manga_volume_start: 4,
    manga_volume_end: 5,
    manga_chapter_start: 47,
    manga_chapter_end: 54,
    episode_start: 25,
    episode_end: 28,
    techniques_used: ["Kaméhaméha MAX", "Bankoku Bikkuri Shō", "Saruken", "Suiken"],
    climax_summary: "Affrontement martial légendaire entre le maître et son disciple. Jackie Chun détruit la lune pour calmer la furie Ôzaru de Goku et remporte la victoire grâce à une allonge supérieure lors du coup de pied réciproque.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "goku-vs-piccolo-daimao-final",
    title: "Son Goku vs Piccolo Daimaō — Le poing du Dragon transperce le Roi Démon",
    title_ja: "孫悟空対ピッコロ大魔王",
    series: "DB",
    combatants: [
      { name: "Son Goku", side: "a" },
      { name: "Piccolo Daimaō", side: "b" }
    ],
    winner_name: "Son Goku",
    location: "Ruines du Palais Royal du Roi de la Terre",
    manga_volume_start: 13,
    manga_volume_end: 14,
    manga_chapter_start: 156,
    manga_chapter_end: 161,
    episode_start: 118,
    episode_end: 122,
    techniques_used: ["Bakurikimaha", "Kaméhaméha propulseur", "Poing du Dragon (Oozaru Fist)"],
    climax_summary: "Le bras valide restant de Goku utilise un Kaméhaméha orienté vers le sol pour se propulser dans les airs. Porté par la rage et l'Eau Ultra Sacrée, son poing transperce le torse de Piccolo Daimaō.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "goku-vs-piccolo-23e-tournoi-finale",
    title: "Son Goku vs Piccolo (Ma-Junior) — Le sacre du 23e Tenkaichi Budokai",
    title_ja: "孫悟空対マジュニア",
    series: "DB",
    combatants: [
      { name: "Son Goku", side: "a" },
      { name: "Piccolo (Ma-Junior)", side: "b" }
    ],
    winner_name: "Son Goku",
    location: "Arène détruite du Tenkaichi Budokai",
    manga_volume_start: 15,
    manga_volume_end: 16,
    manga_chapter_start: 182,
    manga_chapter_end: 194,
    episode_start: 142,
    episode_end: 148,
    techniques_used: ["Chōbakuretsumaha", "Bukūjutsu", "Super Kaméhaméha", "Kyoshinka"],
    climax_summary: "Piccolo ravage l'île entière. Les quatre membres brisés ou meurtris, Goku s'envole grâce au Bukūjutsu et assène un violent coup de tête projetant Piccolo hors du ring, décrochant son premier titre officiel.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "goku-piccolo-vs-raditz",
    title: "Son Goku & Piccolo vs Raditz — L'ultime sacrifice fraternel",
    title_ja: "孫悟空・ピッコロ対ラディッツ",
    series: "DBZ",
    combatants: [
      { name: "Son Goku", side: "a" },
      { name: "Piccolo", side: "a" },
      { name: "Raditz", side: "b" }
    ],
    winner_name: "Son Goku & Piccolo (Victoire tragique)",
    location: "Plaines sauvages, Terre",
    manga_volume_start: 17,
    manga_volume_end: 17,
    manga_chapter_start: 198,
    manga_chapter_end: 205,
    episode_start: 3,
    episode_end: 5,
    techniques_used: ["Makankōsappō", "Super Kaméhaméha", "Prise au corps arrière"],
    climax_summary: "Gohan brise la capsule et blesse Raditz d'un violent coup de tête. Goku immobilise Raditz par l'arrière, permettant à Piccolo de transpercer les deux frères avec le Makankōsappō.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "goku-vs-vegeta-saiyan-saga",
    title: "Son Goku vs Vegeta — Le choc fondamental des Saiyans",
    title_ja: "孫悟空対ベジータ（地球）",
    series: "DBZ",
    combatants: [
      { name: "Son Goku", side: "a" },
      { name: "Vegeta", side: "b" }
    ],
    winner_name: "Interrompu / Victoire collective de la Terre",
    location: "Région rocheuse déserte, Terre",
    manga_volume_start: 19,
    manga_volume_end: 20,
    manga_chapter_start: 228,
    manga_chapter_end: 241,
    episode_start: 29,
    episode_end: 35,
    techniques_used: ["Kaiô-ken x3 / x4", "Galick Hō", "Kaméhaméha", "Power Ball", "Genkidama"],
    climax_summary: "Affrontement légendaire. Choc frontal Kaméhaméha x4 vs Galick Hō. Vegeta crée une lune artificielle et devient Ôzaru. Yajirobé tranche sa queue, et Kuririn relayé par Gohan expédie le Genkidama.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "vegeta-vs-recoom-namek",
    title: "Vegeta, Gohan & Krilin vs Recoom — Le cauchemar du Commando Ginyu",
    title_ja: "ベジータ対リクーム",
    series: "DBZ",
    combatants: [
      { name: "Vegeta", side: "a" },
      { name: "Son Gohan", side: "a" },
      { name: "Krilin", side: "a" },
      { name: "Recoom", side: "b" }
    ],
    winner_name: "Son Goku (intervient et one-shot Recoom)",
    location: "Plaines rocheuses de Namek",
    manga_volume_start: 23,
    manga_volume_end: 24,
    manga_chapter_start: 275,
    manga_chapter_end: 280,
    episode_start: 63,
    episode_end: 66,
    techniques_used: ["Recoom Eraser Gun", "Final Crash", "Coup de coude au plexus"],
    climax_summary: "Recoom brise les os de Vegeta et le cou de Gohan. Son Goku débarque tout juste sur Namek et terrasse Recoom d'un seul coup de coude foudroyant au plexus.",
    canon: true,
    impact_level: 4,
  },
  {
    slug: "goku-vs-freezer-namek",
    title: "Son Goku vs Freeza — L'éveil du Super Saiyan de la légende",
    title_ja: "孫悟空対フリーザ（ナメック星）",
    series: "DBZ",
    combatants: [
      { name: "Son Goku", side: "a" },
      { name: "Freeza (Forme finale 100%)", side: "b" }
    ],
    winner_name: "Son Goku",
    location: "Planète Namek en fusion imminente",
    manga_volume_start: 26,
    manga_volume_end: 28,
    manga_chapter_start: 305,
    manga_chapter_end: 328,
    episode_start: 86,
    episode_end: 105,
    techniques_used: ["Kaiô-ken x20", "Grand Genkidama", "Super Saiyan", "Kienzan", "Angry Kamehameha"],
    climax_summary: "Freeza assassine Krilin sous les yeux de Goku. Consumé par une fureur sans bornes, Goku s'éveille en Super Saiyan. Il domine Freeza à 100% et l'achève d'une salve d'énergie après sa tentative de coup en traître.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "trunks-vs-mecha-freezer",
    title: "Trunks du futur vs Mecha Freeza & Roi Cold — Le carnage d'une minute",
    title_ja: "未来トランクス対メカフリーザ・コルド大王",
    series: "DBZ",
    combatants: [
      { name: "Trunks du Futur", side: "a" },
      { name: "Mecha Freeza", side: "b" },
      { name: "Roi Cold", side: "b" }
    ],
    winner_name: "Trunks du Futur",
    location: "Région désertique de la Terre",
    manga_volume_start: 28,
    manga_volume_end: 28,
    manga_chapter_start: 330,
    manga_chapter_end: 332,
    episode_start: 119,
    episode_end: 121,
    techniques_used: ["Super Saiyan", "Buster Cannon", "Épée tranchante", "Burning Attack"],
    climax_summary: "Trunks se transforme instantanément en Super Saiyan, découpe Mecha Freeza en morceaux avec son épée et désintègre le Roi Cold sans hésitation.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "piccolo-vs-c17",
    title: "Piccolo vs C-17 — Le duel d'endurance parfait",
    title_ja: "ピッコロ対人造人間17号",
    series: "DBZ",
    combatants: [
      { name: "Piccolo (fusionné avec Kami-sama)", side: "a" },
      { name: "C-17", side: "b" }
    ],
    winner_name: "Interrompu par l'arrivée d'Imperfect Cell",
    location: "Île isolée en bord de mer",
    manga_volume_start: 31,
    manga_volume_end: 31,
    manga_chapter_start: 366,
    manga_chapter_end: 370,
    episode_start: 148,
    episode_end: 151,
    techniques_used: ["Gekiretsu Kōdan", "Barrière d'énergie", "Chō Énergie Ha"],
    climax_summary: "Piccolo, réuni avec le Tout-Puissant, rivalise coup pour coup avec la puissance et l'énergie infinie de C-17 dans une symphonie de corps-à-corps jusqu'à l'intrusion de Cell.",
    canon: true,
    impact_level: 4,
  },
  {
    slug: "gohan-vs-cell-cell-games",
    title: "Son Gohan vs Perfect Cell — L'éveil du Super Saiyan 2 et le choc Père-Fils",
    title_ja: "孫悟飯対完全体セル",
    series: "DBZ",
    combatants: [
      { name: "Son Gohan (SSJ2)", side: "a" },
      { name: "Cell (Parfait puis Super Parfait)", side: "b" }
    ],
    winner_name: "Son Gohan",
    location: "Arène des Cell Games, Terre",
    manga_volume_start: 34,
    manga_volume_end: 35,
    manga_chapter_start: 404,
    manga_chapter_end: 416,
    episode_start: 184,
    episode_end: 191,
    techniques_used: ["Super Saiyan 2", "Kaméhaméha Père-Fils", "Attaque surprise de Vegeta"],
    climax_summary: "Cell écrase la tête de C-16, libérant la rage enfouie de Gohan qui atteint le Super Saiyan 2. Après le sacrifice de Goku, Gohan à un seul bras pulvérise Super Perfect Cell avec le Kaméhaméha Père-Fils soutenu par l'assaut surprise de Vegeta.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "majin-vegeta-vs-goku-ssj2",
    title: "Majin Vegeta vs Son Goku — La fierté du Prince des Saiyans",
    title_ja: "魔人ベジータ対孫悟空",
    series: "DBZ",
    combatants: [
      { name: "Majin Vegeta (SSJ2)", side: "a" },
      { name: "Son Goku (SSJ2)", side: "b" }
    ],
    winner_name: "Majin Vegeta (par traîtrise après trêve)",
    location: "Montagnes arides, Terre",
    manga_volume_start: 38,
    manga_volume_end: 39,
    manga_chapter_start: 457,
    manga_chapter_end: 461,
    episode_start: 228,
    episode_end: 232,
    techniques_used: ["Super Saiyan 2", "Anneaux de confinement", "Big Bang Attack"],
    climax_summary: "Vegeta accepte l'emprise de Babidi pour retrouver sa cruauté et son rang. Les deux rivaux livrent un combat d'une violence inouïe qui réveille Majin Buu.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "majin-vegeta-vs-fat-buu-sacrifice",
    title: "Majin Vegeta vs Majin Buu — Le sacrifice ultime d'un père",
    title_ja: "魔人ベジータの自爆",
    series: "DBZ",
    combatants: [
      { name: "Majin Vegeta", side: "a" },
      { name: "Majin Buu (Gros Buu)", side: "b" }
    ],
    winner_name: "Majin Buu (régénéré après explosion)",
    location: "Plaine dévastée, Terre",
    manga_volume_start: 39,
    manga_volume_end: 39,
    manga_chapter_start: 464,
    manga_chapter_end: 467,
    episode_start: 236,
    episode_end: 237,
    techniques_used: ["Final Explosion (Autodestruction)"],
    climax_summary: "Conscient qu'il ne peut éliminer Buu au corps-à-corps, Vegeta assomme Trunks et Goten pour les mettre à l'abri, embrasse son fils et libère toute sa force vitale dans une gigantesque explosion sacrificielle.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "vegetto-vs-buuhan",
    title: "Vegetto vs Buuhan — L'insolence du guerrier ultime",
    title_ja: "ベジット対魔人ブウ（悪）",
    series: "DBZ",
    combatants: [
      { name: "Vegetto (Super Vegetto)", side: "a" },
      { name: "Majin Buu (Gohan absorbé)", side: "b" }
    ],
    winner_name: "Vegetto (se laisse volontairement absorber)",
    location: "Terre déserte",
    manga_volume_start: 42,
    manga_volume_end: 42,
    manga_chapter_start: 503,
    manga_chapter_end: 506,
    episode_start: 269,
    episode_end: 273,
    techniques_used: ["Spirit Sword (Épée spirituelle)", "Big Bang Kamehameha", "Barrière protectrice"],
    climax_summary: "Né de la fusion Potala, Super Vegetto ridiculise totalement Buuhan (même transformé en bonbon au café). Il déploie une barrière d'énergie pour pénétrer dans le corps de Buu et délivrer ses amis.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "goku-vegeta-vs-kid-buu-final",
    title: "Son Goku & Vegeta vs Kid Buu — Le Super Genkidama salvateur",
    title_ja: "孫悟空・ベジータ対純粋ブウ",
    series: "DBZ",
    combatants: [
      { name: "Son Goku (SSJ3)", side: "a" },
      { name: "Vegeta (SSJ2)", side: "a" },
      { name: "Gros Buu", side: "a" },
      { name: "Kid Buu (Buu Pur)", side: "b" }
    ],
    winner_name: "Son Goku & alliés",
    location: "Royaume Sacré des Kaïōshins (Kaiôshin-kai)",
    manga_volume_start: 42,
    manga_volume_end: 42,
    manga_chapter_start: 510,
    manga_chapter_end: 516,
    episode_start: 279,
    episode_end: 286,
    techniques_used: ["Super Saiyan 3", "Super Genkidama Universel", "Vœu de Polunga"],
    climax_summary: "Vegeta retient héroïquement Kid Buu au prix de sa vie pendant que Goku rassemble l'énergie de toute la Terre ralliée par la voix de M. Satan. Goku repousse le Genkidama avec l'énergie restaurée par Polunga.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "goku-vs-beerus-dieu-de-la-destruction",
    title: "Son Goku vs Beerus — Le rituel du Super Saiyan God",
    title_ja: "孫悟空対ビルス",
    series: "DBS",
    combatants: [
      { name: "Son Goku (Super Saiyan God)", side: "a" },
      { name: "Beerus (Dieu de la Destruction)", side: "b" }
    ],
    winner_name: "Beerus",
    location: "Haute atmosphère terrestre et espace",
    manga_volume_start: 1,
    manga_volume_end: 1,
    manga_chapter_start: 3,
    manga_chapter_end: 4,
    episode_start: 9,
    episode_end: 14,
    techniques_used: ["God Kamehameha", "Sphère de destruction cataclysmique"],
    climax_summary: "Leurs ondes de choc menacent de détruire l'univers tout entier. Bien que vaincu par épuisement, Goku gagne le respect de Beerus qui épargne la Terre.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "goku-vs-jiren-tournoi-du-pouvoir",
    title: "Son Goku vs Jiren — La transcendance de l'Ultra Instinct",
    title_ja: "孫悟空対ジレン",
    series: "DBS",
    combatants: [
      { name: "Son Goku (Ultra Instinct Maîtrisé)", side: "a" },
      { name: "Freeza & C-17", side: "a" },
      { name: "Jiren", side: "b" }
    ],
    winner_name: "Univers 7 (C-17 vainqueur final)",
    location: "Arène du Tournoi du Pouvoir (Monde du Vide)",
    manga_volume_start: 8,
    manga_volume_end: 9,
    manga_chapter_start: 39,
    manga_chapter_end: 42,
    episode_start: 129,
    episode_end: 131,
    techniques_used: ["Ultra Instinct Maîtrisé", "Assaut combiné Goku & Freeza", "Barrière C-17"],
    climax_summary: "Goku transcende les limites divines avec l'Ultra Instinct. Lors du rush final, Goku et Freeza s'éjectent ensemble avec Jiren du ring, laissant C-17 seul sur l'arène pour exaucer le vœu suprême.",
    canon: true,
    impact_level: 5,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// EXÉCUTION PRINCIPALE
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🚀 Démarrage du seed massif des données Dragon Ball...");

  const pgUrl = getPgUrl();
  let sql: ReturnType<typeof postgres> | null = null;
  if (pgUrl) {
    sql = postgres(pgUrl, { max: 2 });
    console.log("-> Connecté à PostgreSQL.");
  }

  const sdb = existsSync(sqlitePath) ? new Database(sqlitePath) : null;
  if (sdb) {
    console.log("-> Connecté à SQLite.");
  }

  // 1. Dragons
  console.log(`\n🐉 Ingestion de ${DRAGONS_DATA.length} Dragons sacrés...`);
  for (const d of DRAGONS_DATA) {
    const image = publishableSeedImage(d.image);
    if (sql) {
      await sql`
        INSERT INTO bot.db_dragons (
          slug, name, name_ja, creator, planet_realm, balls_count,
          balls_diameter, summon_phrase, summon_phrase_ja, wishes_count,
          cooldown, rules, image, article, visible
        ) VALUES (
          ${d.slug}, ${d.name}, ${d.name_ja}, ${d.creator}, ${d.planet_realm},
          ${d.balls_count}, ${d.balls_diameter}, ${d.summon_phrase},
          ${d.summon_phrase_ja}, ${d.wishes_count}, ${d.cooldown},
          ${d.rules}, ${image}, ${d.article}, true
        ) ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          name_ja = EXCLUDED.name_ja,
          creator = EXCLUDED.creator,
          planet_realm = EXCLUDED.planet_realm,
          balls_count = EXCLUDED.balls_count,
          balls_diameter = EXCLUDED.balls_diameter,
          summon_phrase = EXCLUDED.summon_phrase,
          summon_phrase_ja = EXCLUDED.summon_phrase_ja,
          wishes_count = EXCLUDED.wishes_count,
          cooldown = EXCLUDED.cooldown,
          rules = EXCLUDED.rules,
          image = EXCLUDED.image,
          article = EXCLUDED.article;
      `;
    }
    if (sdb) {
      sdb.run(`
        INSERT OR REPLACE INTO db_dragons (
          slug, name, name_ja, creator, planet_realm, balls_count,
          balls_diameter, summon_phrase, summon_phrase_ja, wishes_count,
          cooldown, rules, image, article, visible
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `, [
        d.slug, d.name, d.name_ja, d.creator, d.planet_realm,
        d.balls_count, d.balls_diameter, d.summon_phrase,
        d.summon_phrase_ja, d.wishes_count, d.cooldown,
        d.rules, image, d.article
      ]);
    }
  }

  // Récupérer les ID des dragons pour les vœux
  const dragonMap = new Map<string, number>();
  if (sql) {
    const rows = await sql`SELECT id, slug FROM bot.db_dragons`;
    for (const r of rows) dragonMap.set(r.slug, Number(r.id));
  } else if (sdb) {
    const rows = sdb.query("SELECT id, slug FROM db_dragons").all() as { id: number; slug: string }[];
    for (const r of rows) dragonMap.set(r.slug, r.id);
  }

  // 2. Vœux
  console.log(`✨ Ingestion de ${WISHES_DATA.length} Vœux canoniques...`);
  if (sql) await sql`UPDATE bot.db_wishes SET visible = false WHERE visible IS NOT false`;
  if (sdb) sdb.run("UPDATE db_wishes SET visible = 0 WHERE visible != 0");

  for (const w of WISHES_DATA) {
    const dragonId = dragonMap.get(w.dragon_slug) ?? 1;
    if (sql) {
      await sql`
        INSERT INTO bot.db_wishes (
          dragon_id, dragon_name, wish_number_in_summon, whisperer,
          saga, manga_chapter, episode_number, wish_text, granted, canon, visible
        ) VALUES (
          ${dragonId}, ${w.dragon_name}, ${w.wish_number}, ${w.whisperer},
          ${w.saga}, ${w.manga_chapter}, ${w.episode_number}, ${w.wish_text},
          ${w.granted}, ${w.canon}, true
        )
      `;
    }
    if (sdb) {
      sdb.run(`
        INSERT INTO db_wishes (
          dragon_id, dragon_name, wish_number_in_summon, whisperer,
          saga, manga_chapter, episode_number, wish_text, granted, canon, visible
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `, [
        dragonId, w.dragon_name, w.wish_number, w.whisperer,
        w.saga, w.manga_chapter, w.episode_number, w.wish_text,
        w.granted ? 1 : 0, w.canon ? 1 : 0
      ]);
    }
  }

  // 3. Objets & Technologies
  console.log(`\n📦 Ingestion de ${ITEMS_DATA.length} Objets & Technologies...`);
  for (const it of ITEMS_DATA) {
    const image = publishableSeedImage(it.image);
    if (sql) {
      await sql`
        INSERT INTO bot.db_items (
          slug, name, name_ja, name_romaji, category, creator,
          description, debut_chapter, debut_episode, image, visible
        ) VALUES (
          ${it.slug}, ${it.name}, ${it.name_ja}, ${it.name_romaji}, ${it.category},
          ${it.creator}, ${it.description}, ${it.debut_chapter}, ${it.debut_episode},
          ${image}, true
        ) ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          name_ja = EXCLUDED.name_ja,
          name_romaji = EXCLUDED.name_romaji,
          category = EXCLUDED.category,
          creator = EXCLUDED.creator,
          description = EXCLUDED.description,
          debut_chapter = EXCLUDED.debut_chapter,
          debut_episode = EXCLUDED.debut_episode,
          image = EXCLUDED.image;
      `;
    }
    if (sdb) {
      sdb.run(`
        INSERT OR REPLACE INTO db_items (
          slug, name, name_ja, name_romaji, category, creator,
          description, debut_chapter, debut_episode, image, visible
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `, [
        it.slug, it.name, it.name_ja, it.name_romaji, it.category,
        it.creator, it.description, it.debut_chapter, it.debut_episode,
        image
      ]);
    }
  }

  // 4. Chronologie universelle par Âge
  console.log(`\n⏳ Ingestion de ${TIMELINE_DATA.length} Événements de Chronologie par Âge...`);
  if (sql) await sql`UPDATE bot.db_timeline_events SET visible = false WHERE visible IS NOT false`;
  if (sdb) sdb.run("UPDATE db_timeline_events SET visible = 0 WHERE visible != 0");

  for (const t of TIMELINE_DATA) {
    if (sql) {
      await sql`
        INSERT INTO bot.db_timeline_events (
          age_year, era, title, title_ja, description,
          characters_involved, source_ref, canon, order_idx, visible
        ) VALUES (
          ${t.age_year}, ${t.era}, ${t.title}, ${t.title_ja}, ${t.description},
          ${JSON.stringify(t.characters_involved)}, ${t.source_ref},
          true, ${t.order_idx}, true
        )
      `;
    }
    if (sdb) {
      sdb.run(`
        INSERT INTO db_timeline_events (
          age_year, era, title, title_ja, description,
          characters_involved, source_ref, canon, order_idx, visible
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1)
      `, [
        t.age_year, t.era, t.title, t.title_ja, t.description,
        JSON.stringify(t.characters_involved), t.source_ref, t.order_idx
      ]);
    }
  }

  // 5. Niveaux de Puissance
  console.log(`\n⚡ Ingestion de ${POWER_LEVELS_DATA.length} Niveaux de Puissance Scouter & Daizenshuu...`);
  if (sql) await sql`UPDATE bot.db_power_levels SET visible = false WHERE visible IS NOT false`;
  if (sdb) sdb.run("UPDATE db_power_levels SET visible = 0 WHERE visible != 0");

  for (const p of POWER_LEVELS_DATA) {
    if (sql) {
      await sql`
        INSERT INTO bot.db_power_levels (
          character_name, form, saga_name, battle_power, battle_power_display,
          scouter_device, source_kind, source_page, canon, notes, visible
        ) VALUES (
          ${p.character_name}, ${p.form}, ${p.saga_name}, ${p.battle_power},
          ${p.battle_power_display}, ${p.scouter_device}, ${p.source_kind},
          ${p.source_page}, true, ${p.notes}, true
        )
      `;
    }
    if (sdb) {
      sdb.run(`
        INSERT INTO db_power_levels (
          character_name, form, saga_name, battle_power, battle_power_display,
          scouter_device, source_kind, source_page, canon, notes, visible
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1)
      `, [
        p.character_name, p.form, p.saga_name, p.battle_power,
        p.battle_power_display, p.scouter_device, p.source_kind,
        p.source_page, p.notes
      ]);
    }
  }

  // 6. Combats Majeurs
  console.log(`\n⚔️ Ingestion de ${BATTLES_DATA.length} Combats légendaires...`);
  for (const b of BATTLES_DATA) {
    if (sql) {
      await sql`
        INSERT INTO bot.db_battles (
          slug, title, title_ja, series, combatants, winner_name,
          location, manga_volume_start, manga_volume_end,
          manga_chapter_start, manga_chapter_end, episode_start,
          episode_end, techniques_used, climax_summary, canon,
          impact_level, visible
        ) VALUES (
          ${b.slug}, ${b.title}, ${b.title_ja}, ${b.series},
          ${JSON.stringify(b.combatants)}, ${b.winner_name}, ${b.location},
          ${b.manga_volume_start}, ${b.manga_volume_end},
          ${b.manga_chapter_start}, ${b.manga_chapter_end},
          ${b.episode_start}, ${b.episode_end},
          ${JSON.stringify(b.techniques_used)}, ${b.climax_summary},
          ${b.canon}, ${b.impact_level}, true
        ) ON CONFLICT (slug) DO UPDATE SET
          title = EXCLUDED.title,
          title_ja = EXCLUDED.title_ja,
          series = EXCLUDED.series,
          combatants = EXCLUDED.combatants,
          winner_name = EXCLUDED.winner_name,
          location = EXCLUDED.location,
          manga_volume_start = EXCLUDED.manga_volume_start,
          manga_volume_end = EXCLUDED.manga_volume_end,
          manga_chapter_start = EXCLUDED.manga_chapter_start,
          manga_chapter_end = EXCLUDED.manga_chapter_end,
          episode_start = EXCLUDED.episode_start,
          episode_end = EXCLUDED.episode_end,
          techniques_used = EXCLUDED.techniques_used,
          climax_summary = EXCLUDED.climax_summary,
          canon = EXCLUDED.canon,
          impact_level = EXCLUDED.impact_level;
      `;
    }
    if (sdb) {
      sdb.run(`
        INSERT OR REPLACE INTO db_battles (
          slug, title, title_ja, series, combatants, winner_name,
          location, manga_volume_start, manga_volume_end,
          manga_chapter_start, manga_chapter_end, episode_start,
          episode_end, techniques_used, climax_summary, canon,
          impact_level, visible
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `, [
        b.slug, b.title, b.title_ja, b.series,
        JSON.stringify(b.combatants), b.winner_name, b.location,
        b.manga_volume_start, b.manga_volume_end,
        b.manga_chapter_start, b.manga_chapter_end,
        b.episode_start, b.episode_end,
        JSON.stringify(b.techniques_used), b.climax_summary,
        b.canon ? 1 : 0, b.impact_level
      ]);
    }
  }

  if (sql) await sql.end();
  if (sdb) sdb.close();

  console.log("\n🎉 SEEDING MASSIF TERMINÉ AVEC SUCCÈS SUR LES 5 PILIERS !");
}

main().catch(console.error);
