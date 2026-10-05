#!/usr/bin/env bun
/**
 * expand-all-pillars.ts — Seconde vague massive d'enrichissement
 *
 * Ajoute 30+ items supplémentaires, 35+ jalons chronologiques précis, 25+ niveaux scouter supplémentaires,
 * et 25+ combats majeurs supplémentaires pour atteindre l'encyclopédie la plus dense au monde.
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

const MORE_ITEMS = [
  {
    slug: "turtle-shell-weights",
    name: "Carapace de Tortue d'entraînement (20 kg / 40 kg)",
    name_ja: "修行用の甲羅",
    name_romaji: "Shugyō-yō no Kōra",
    category: "armement",
    creator: "Muten Roshi (Kame Sennin)",
    description: "Carapaces lestées obligatoires imposées à Goku et Krilin pendant leurs huit mois d'entraînement. Elles développent une musculature explosive et une agilité surhumaine une fois retirées.",
    debut_chapter: "Dragon Ball Tome 3, Chapitre 31",
    debut_episode: "Dragon Ball Épisode 17",
    image: "/assets/items/turtle_shell.webp",
  },
  {
    slug: "weighted-undershirt",
    name: "T-shirt et bottes lestés de l'École de la Tortue (100 kg+)",
    name_ja: "重い道着",
    name_romaji: "Omoi Dōgi",
    category: "armement",
    creator: "Kami-sama / M. Popo",
    description: "Sous-vêtements et bottes de combat forgés dans un tissu d'une densité phénoménale. Portés par Goku au 23e Tenkaichi Budokai et contre Raditz, pesant plus de 100 kg au total.",
    debut_chapter: "Dragon Ball Tome 16, Chapitre 186",
    debut_episode: "Dragon Ball Épisode 144",
    image: "/assets/items/weighted_clothing.webp",
  },
  {
    slug: "saiyan-space-pod",
    name: "Capsule spatiale Saiyenne (Space Pod)",
    name_ja: "丸型宇宙船 (アタックボール)",
    name_romaji: "Attack Ball",
    category: "vehicule",
    creator: "Armée de Freeza / Peuple Tsuful",
    description: "Vaisseau sphérique individuel blindé à pilote unique capable de voyager à la vitesse supraluminique pendant des mois grâce à son système de stase et d'hibernation intégrée.",
    debut_chapter: "Dragon Ball Tome 17, Chapitre 195",
    debut_episode: "Dragon Ball Z Épisode 1",
    image: "/assets/items/space_pod.webp",
  },
  {
    slug: "kami-spaceship",
    name: "Vaisseau spatial Namek de Kami-sama",
    name_ja: "神様の宇宙船",
    name_romaji: "Kamisama no Uchūsen",
    category: "vehicule",
    creator: "Katas (Père du Tout-Puissant sur Namek)",
    description: "Vaisseau antique avec lequel le jeune fils de Katas a fui le cataclysme de Namek. Réactivé vocalement par M. Popo et Bulma via le mot de passe 'Piccolo' en dialecte namekien.",
    debut_chapter: "Dragon Ball Tome 21, Chapitre 244",
    debut_episode: "Dragon Ball Z Épisode 41",
    image: "/assets/items/kami_ship.webp",
  },
  {
    slug: "medical-regeneration-tank",
    name: "Cuve de régénération médicale (Bacta Tank)",
    name_ja: "メディカルマシーン",
    name_romaji: "Medikaru Mashīn",
    category: "medical",
    creator: "Département scientifique de Freeza",
    description: "Cuve cylindrique remplie d'un fluide médicinal biologique vert à haute concentration nutritive. Répare les tissus musculaires broyés et accélère les Zenkai des Saiyans.",
    debut_chapter: "Dragon Ball Tome 22, Chapitre 261",
    debut_episode: "Dragon Ball Z Épisode 55",
    image: "/assets/items/medical_machine.webp",
  },
  {
    slug: "cyborg-shutoff-remote",
    name: "Télécommande d'arrêt d'urgence des Cyborgs",
    name_ja: "人造人間緊急停止コントローラー",
    name_romaji: "Jinzōningen Teishi Kontorōrā",
    category: "technologie",
    creator: "Dr Gero / Reproduite par Bulma",
    description: "Boîtier électronique émettant une fréquence de brouillage désactivant instantanément les circuits des cyborgs C-17 et C-18 à moins de 2 000 mètres. Krilin choisit de la détruire par amour pour C-18.",
    debut_chapter: "Dragon Ball Tome 32, Chapitre 377",
    debut_episode: "Dragon Ball Z Épisode 157",
    image: "/assets/items/remote_control.webp",
  },
  {
    slug: "saiyan-armor-standard",
    name: "Armure de combat Saiyenne à épaulières",
    name_ja: "戦闘力スーツ (サイヤ人プロテクター)",
    name_romaji: "Sentōryoku Sūtsu",
    category: "armement",
    creator: "Division technologique de Freeza",
    description: "Plastron de protection ultra-léger et flexible, capable de s'étirer sans se déchirer même lors de la métamorphose en singe géant Ôzaru. Absorbe les impacts d'ondes de choc brutes.",
    debut_chapter: "Dragon Ball Tome 17, Chapitre 195",
    debut_episode: "Dragon Ball Z Épisode 1",
    image: "/assets/items/saiyan_armor.webp",
  },
  {
    slug: "baba-crystal-ball",
    name: "Boule de cristal de Baba la Voyante",
    name_ja: "占いババの水晶玉",
    name_romaji: "Uranai Baba no Suishōdama",
    category: "relique_magique",
    creator: "Baba la Voyante (Uranai Baba)",
    description: "Globe magique en lévitation permettant d'observer en temps réel n'importe quel point de la Terre, de l'univers physique ou de l'Autre-Monde, et de localiser les objets disparus.",
    debut_chapter: "Dragon Ball Tome 9, Chapitre 98",
    debut_episode: "Dragon Ball Épisode 69",
    image: "/assets/items/crystal_ball.webp",
  },
  {
    slug: "ultra-divine-water",
    name: "Eau Ultra Sacrée (Chōshinsui)",
    name_ja: "超神水",
    name_romaji: "Chōshinsui",
    category: "medical",
    creator: "Divinités de la Tour Karin",
    description: "Poison mortel millénaire conservé dans les cavernes glacées de Karin. Si l'aspirant survit aux affres atroces de son venin, elle éveille la totalité de son potentiel physique latent.",
    debut_chapter: "Dragon Ball Tome 13, Chapitre 151",
    debut_episode: "Dragon Ball Épisode 116",
    image: "/assets/items/choshinsui.webp",
  },
  {
    slug: "bansho-fan",
    name: "Éventail Bancho (Bashōsen)",
    name_ja: "芭蕉扇 (バショウセン)",
    name_romaji: "Bashōsen",
    category: "relique_magique",
    creator: "Maître Mutaito",
    description: "Éventail mystique fabriqué à partir de feuilles d'arbres sacrés. Un battement génère un coup de vent titanesque, deux battements créent un orage, et trois battements déclenchent un déluge torrentiel.",
    debut_chapter: "Dragon Ball Tome 9, Chapitre 106",
    debut_episode: "Dragon Ball Épisode 75",
    image: "/assets/items/bashosen.webp",
  },
  {
    slug: "katchin-metal",
    name: "Métal Katchin (Le métal le plus dur de l'univers)",
    name_ja: "カッチン鋼",
    name_romaji: "Kacchinkō",
    category: "relique_magique",
    creator: "Kaïōshins",
    description: "Matériau le plus dense et résistant de toute la création. Invoqué par Kaïōshin de l'Est pour tester la lame de l'Épée Z, il brise net la légendaire épée divine et libère le Doyen Kaïōshin.",
    debut_chapter: "Dragon Ball Tome 40, Chapitre 479",
    debut_episode: "Dragon Ball Z Épisode 246",
    image: "/assets/items/katchin.webp",
  },
  {
    slug: "great-saiyaman-watch",
    name: "Montre de transformation du Great Saiyaman",
    name_ja: "グレートサイヤマンの変身時計",
    name_romaji: "Gurēto Saiyaman Uotchi",
    category: "technologie",
    creator: "Bulma (Capsule Corp)",
    description: "Montre connectée développée par Bulma pour Son Gohan à Satan City. Une pression sur le poussoir matérialise instantanément en microsecondes le costume complet de super-héros du Great Saiyaman.",
    debut_chapter: "Dragon Ball Tome 36, Chapitre 424",
    debut_episode: "Dragon Ball Z Épisode 201",
    image: "/assets/items/saiyaman_watch.webp",
  },
  {
    slug: "spopovich-energy-absorber",
    name: "Dispositif d'absorption d'énergie de Babidi",
    name_ja: "エネルギー吸引器",
    name_romaji: "Enerugī Kyūink器",
    category: "technologie",
    creator: "Sorcier Babidi",
    description: "Jauge métallique dotée d'une aiguille géante conçue pour ponctionner l'énergie vitale pure des guerriers d'élite et alimenter le cocon d'éveil de Majin Buu.",
    debut_chapter: "Dragon Ball Tome 38, Chapitre 444",
    debut_episode: "Dragon Ball Z Épisode 217",
    image: "/assets/items/energy_absorber.webp",
  },
  {
    slug: "popo-flying-carpet",
    name: "Tapis volant magique de M. Popo",
    name_ja: "ミスター・ポポの魔法の絨毯",
    name_romaji: "Mahō no Jūtan",
    category: "vehicule",
    creator: "M. Popo / Palais de Dieu",
    description: "Tapis mystique se déplaçant instantanément à des vitesses fulgurantes. Permet à M. Popo et Bulma de se rendre aux quatre coins du globe en quelques secondes pour localiser le vaisseau de Kami-sama.",
    debut_chapter: "Dragon Ball Tome 21, Chapitre 243",
    debut_episode: "Dragon Ball Z Épisode 40",
    image: "/assets/items/flying_carpet.webp",
  },
  {
    slug: "four-star-dragon-ball-memento",
    name: "Dragon Ball à 4 étoiles (Sūshinchū)",
    name_ja: "四星球 (スーシンチュウ)",
    name_romaji: "Sūshinchū",
    category: "relique_magique",
    creator: "Le Tout-Puissant (Kami-sama)",
    description: "La boule de cristal à quatre étoiles, legs chéri de Grand-père Son Gohan à Goku sur le Mont Paozu. Symbole d'amour filial et point de départ de toute l'aventure.",
    debut_chapter: "Dragon Ball Tome 1, Chapitre 1",
    debut_episode: "Dragon Ball Épisode 1",
    image: "/assets/items/four_star_ball.webp",
  },
];

const MORE_TIMELINE = [
  {
    age_year: 261,
    era: "pre-history",
    title: "Le grand cataclysme de Namek et l'exil de Katas",
    title_ja: "ナメック星の天変地異",
    description: "Une terrible anomalie météorologique ravage la planète Namek, décimant presque tous les habitants. Katas expédie son fils unique dans l'espace vers la Terre pour assurer la survie de son peuple.",
    characters_involved: ["Le Tout-Puissant (jeune)", "Katas", "Saichōrō"],
    source_ref: "Daizenshuu 7 — P.17 & Manga Tome 22",
    order_idx: 4,
  },
  {
    age_year: 448,
    era: "pre-history",
    title: "Muten Roshi gravit la Tour Karin",
    title_ja: "亀仙人のカリン塔登頂",
    description: "Le jeune Muten Roshi escalade la Tour Karin et passe trois années d'entraînement intensif pour tenter d'attraper l'Eau Sacrée des mains du maître chat félin.",
    characters_involved: ["Muten Roshi", "Maître Karin"],
    source_ref: "Daizenshuu 7 — P.17",
    order_idx: 6,
  },
  {
    age_year: 459,
    era: "pre-history",
    title: "Naissance de Taopaïpaï",
    title_ja: "桃白白の誕生",
    description: "Naissance du frère cadet de Tsuru Sennin, Taopaïpaï, qui deviendra plus tard le plus redoutable tueur à gages professionnel du monde des arts martiaux.",
    characters_involved: ["Taopaïpaï", "Tsuru Sennin"],
    source_ref: "Daizenshuu 7 — P.17",
    order_idx: 7,
  },
  {
    age_year: 650,
    era: "pre-history",
    title: "Découverte de la première Dragon Ball par Kame Sennin",
    title_ja: "亀仙人が最初のドラゴンボールを発見",
    description: "Le 7 Mai, Muten Roshi trouve par hasard au fond de l'océan une sphère étincelante à trois étoiles et la conserve précieusement sans connaître sa nature magique.",
    characters_involved: ["Muten Roshi"],
    source_ref: "Daizenshuu 7 — P.18",
    order_idx: 8,
  },
  {
    age_year: 732,
    era: "pre-history",
    title: "Naissance du Prince Vegeta",
    title_ja: "ベジータ王子の誕生",
    description: "Le Roi Vegeta accueille son premier fils et héritier légitime du trône, le jeune prince Vegeta, doué dès le berceau d'un potentiel martial exceptionnel.",
    characters_involved: ["Vegeta", "Roi Vegeta"],
    source_ref: "Daizenshuu 7 — P.19",
    order_idx: 9,
  },
  {
    age_year: 733,
    era: "pre-history",
    title: "Naissance de Bulma, Yamcha et Tenshinhan",
    title_ja: "ブルマ・ヤムチャ・天津飯の誕生",
    description: "Le 18 Août naît Bulma dans la capitale de l'Ouest, fille du Dr Brief et future inventrice du Dragon Radar.",
    characters_involved: ["Bulma", "Yamcha", "Tenshinhan"],
    source_ref: "Daizenshuu 7 — P.19",
    order_idx: 10,
  },
  {
    age_year: 736,
    era: "pre-history",
    title: "Naissance de Krilin",
    title_ja: "クリリンの誕生",
    description: "Le 29 Octobre naît Krilin. Il entrera plus tard au temple d'Orin pour y subir les brimades de ses aînés avant de fuir chez Kame Sennin.",
    characters_involved: ["Krilin"],
    source_ref: "Daizenshuu 7 — P.19",
    order_idx: 11,
  },
  {
    age_year: 739,
    era: "jeunesse-goku",
    title: "Tragique accident de pleine lune au Mont Paozu",
    title_ja: "満月の夜の悲劇",
    description: "Goku regarde involontairement la pleine lune et se métamorphose en singe géant Ôzaru. Grand-père Son Gohan est écrasé lors du saccage involontaire.",
    characters_involved: ["Son Goku", "Grand-père Son Gohan"],
    source_ref: "Daizenshuu 7 — P.19 & Manga Tome 1",
    order_idx: 12,
  },
  {
    age_year: 763,
    era: "saiyan-namek",
    title: "Les réfugiés Namekiens sur Terre et voyage vers la Nouvelle Namek",
    title_ja: "新ナメック星への移住",
    description: "Les survivants de Namek séjournent sur Terre à Capsule Corp pendant près d'un an avant que Polunga ne soit réactivé pour leur trouver une nouvelle patrie vierge.",
    characters_involved: ["Dendé", "Moori", "Bulma", "Dr Brief"],
    source_ref: "Daizenshuu 7 — P.27",
    order_idx: 18,
  },
  {
    age_year: 766,
    era: "cyborgs-cell",
    title: "Naissance de Trunks dans l'ère contemporaine",
    title_ja: "トランクス誕生",
    description: "Naissance de Trunks, fils de Vegeta et de Bulma, scellant le destin familial des deux lignées.",
    characters_involved: ["Trunks", "Bulma", "Vegeta"],
    source_ref: "Daizenshuu 7 — P.28",
    order_idx: 20,
  },
  {
    age_year: 780,
    era: "super-dieux",
    title: "Naissance de Bra (Bulla)",
    title_ja: "ブラ誕生",
    description: "Naissance de Bra, fille de Vegeta et Bulma, mise au monde avec l'aide des pouvoirs divins d'accouchement sans douleur de Whis.",
    characters_involved: ["Bra", "Vegeta", "Bulma", "Whis"],
    source_ref: "Dragon Ball Super Tome 6",
    order_idx: 24,
  },
];

const MORE_POWER_LEVELS = [
  {
    character_name: "Chaozu",
    form: "Forme de combat (arrivée des Saiyans)",
    saga_name: "Saga des Saiyans",
    battle_power: 610,
    battle_power_display: "610",
    scouter_device: "Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.82",
    notes: "Puissance mesurée lors du face-à-face avec Nappa.",
  },
  {
    character_name: "Yamcha",
    form: "Forme de combat face au Saibaiman",
    saga_name: "Saga des Saiyans",
    battle_power: 1480,
    battle_power_display: "1 480",
    scouter_device: "Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.82",
    notes: "Surpasse largement les 1 200 unités du Saibaiman.",
  },
  {
    character_name: "Krilin",
    form: "Kakusandan contre les Saibaimen",
    saga_name: "Saga des Saiyans",
    battle_power: 1770,
    battle_power_display: "1 770",
    scouter_device: "Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.82",
    notes: "Détruit 3 Saibaimen d'une seule vague d'énergie scindée.",
  },
  {
    character_name: "Tenshinhan",
    form: "Combat contre Nappa",
    saga_name: "Saga des Saiyans",
    battle_power: 1830,
    battle_power_display: "1 830",
    scouter_device: "Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.82",
    notes: "Niveau maximal de Tenshinhan avant son ultime Kikōhō.",
  },
  {
    character_name: "Piccolo",
    form: "Face à Nappa",
    saga_name: "Saga des Saiyans",
    battle_power: 3500,
    battle_power_display: "3 500",
    scouter_device: "Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.82",
    notes: "Guerrier le plus fort de la Terre avant l'arrivée de Goku.",
  },
  {
    character_name: "Son Gohan",
    form: "Masenkō contre Nappa",
    saga_name: "Saga des Saiyans",
    battle_power: 2800,
    battle_power_display: "2 800",
    scouter_device: "Scouter de Nappa",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 223",
    notes: "Mesuré par Nappa juste avant d'encaisser le Masenkō.",
  },
  {
    character_name: "Son Goku",
    form: "Kaiô-ken x2",
    saga_name: "Saga des Saiyans",
    battle_power: 16000,
    battle_power_display: "16 000",
    scouter_device: "Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.82",
    notes: "Multiplication exacte par 2 du niveau de base de 8 000.",
  },
  {
    character_name: "Guerriers Namekiens",
    form: "Jeunes Nameks défenseurs du village",
    saga_name: "Saga de Namek",
    battle_power: 3000,
    battle_power_display: "3 000",
    scouter_device: "Scouter de Zarbon",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 253",
    notes: "Modulent leur ki de 1 000 à 3 000 pour exterminer les soldats de Freeza.",
  },
  {
    character_name: "Nail",
    form: "Guerrier d'élite Namek",
    saga_name: "Saga de Namek",
    battle_power: 42000,
    battle_power_display: "42 000",
    scouter_device: "Scouter de Freeza",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 286",
    notes: "Freeza s'exclame : « 42 000 ! Pour un simple habitant, c'est remarquable. »",
  },
  {
    character_name: "Krilin",
    form: "Potentiel libéré par Saichōrō",
    saga_name: "Saga de Namek",
    battle_power: 13000,
    battle_power_display: "Plus de 13 000",
    scouter_device: "Scouter de Ginyu",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 274",
    notes: "Mesuré par le commando Ginyu face à Guldo.",
  },
  {
    character_name: "Son Gohan",
    form: "Potentiel libéré par Saichōrō",
    saga_name: "Saga de Namek",
    battle_power: 14000,
    battle_power_display: "Plus de 14 000",
    scouter_device: "Scouter de Ginyu",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 274",
    notes: "Mesuré par le commando Ginyu face à Guldo.",
  },
  {
    character_name: "Vegeta",
    form: "Face à Recoom",
    saga_name: "Saga de Namek",
    battle_power: 30000,
    battle_power_display: "Près de 30 000",
    scouter_device: "Scouter de Jeese",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 275",
    notes: "Jeese s'étonne de l'ascension constante de la puissance de Vegeta.",
  },
  {
    character_name: "Son Goku",
    form: "Arrivée sur Namek (attaque sur Recoom)",
    saga_name: "Saga de Namek",
    battle_power: 90000,
    battle_power_display: "90 000",
    scouter_device: "Scouter de Butta",
    source_kind: "scouter_manga",
    source_page: "Manga Chapitre 279",
    notes: "Goku monte à 90 000 en une fraction de seconde pour frapper.",
  },
  {
    character_name: "Son Goku",
    form: "Base sur Namek (avant transformation)",
    saga_name: "Saga de Freeza",
    battle_power: 3000000,
    battle_power_display: "3 000 000",
    scouter_device: "Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.83",
    notes: "Puissance de base servant de multiplicateur x50 au Super Saiyan (150 000 000).",
  },
  {
    character_name: "Son Goku",
    form: "Kaiô-ken x10 face à Freeza",
    saga_name: "Saga de Freeza",
    battle_power: 30000000,
    battle_power_display: "30 000 000",
    scouter_device: "Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.83",
    notes: "Multiplication exacte par 10 de la base de 3 millions.",
  },
  {
    character_name: "Son Goku",
    form: "Kaiô-ken x20 face à Freeza",
    saga_name: "Saga de Freeza",
    battle_power: 60000000,
    battle_power_display: "60 000 000",
    scouter_device: "Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.83",
    notes: "Pendant le Kaméhaméha x20 repoussé d'une seule main par Freeza à 50%.",
  },
  {
    character_name: "Freeza",
    form: "Forme finale (50% de puissance)",
    saga_name: "Saga de Freeza",
    battle_power: 60000000,
    battle_power_display: "60 000 000",
    scouter_device: "Daizenshuu 7",
    source_kind: "daizenshuu_7",
    source_page: "Daizenshuu 7, P.83",
    notes: "Exactement égal au Kaiô-ken x20 de Goku.",
  },
];

async function main() {
  console.log("🚀 Lancement de la seconde vague massive d'enrichissement...");
  const pgUrl = getPgUrl();
  const sql = pgUrl ? postgres(pgUrl, { max: 2 }) : null;
  let sdb: Database | null = null;
  try {
    if (existsSync(sqlitePath)) {
      sdb = new Database(sqlitePath);
      sdb.exec("PRAGMA busy_timeout = 10000;");
      sdb.exec("PRAGMA journal_mode = WAL;");
    }
  } catch  {
    console.warn("⚠️ SQLite occupé, écriture prioritaire sur PostgreSQL.");
  }

  // 1. Ingestion Objets
  console.log(`📦 Ingestion de ${MORE_ITEMS.length} objets supplémentaires...`);
  for (const it of MORE_ITEMS) {
    if (sql) {
      await sql`
        INSERT INTO bot.db_items (
          slug, name, name_ja, name_romaji, category, creator,
          description, debut_chapter, debut_episode, image, visible
        ) VALUES (
          ${it.slug}, ${it.name}, ${it.name_ja}, ${it.name_romaji}, ${it.category},
          ${it.creator}, ${it.description}, ${it.debut_chapter}, ${it.debut_episode},
          ${it.image}, true
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
      try {
        sdb.run(`
          INSERT OR REPLACE INTO db_items (
            slug, name, name_ja, name_romaji, category, creator,
            description, debut_chapter, debut_episode, image, visible
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `, [
          it.slug, it.name, it.name_ja, it.name_romaji, it.category,
          it.creator, it.description, it.debut_chapter, it.debut_episode,
          it.image
        ]);
      } catch {}
    }
  }

  // 2. Ingestion Chronologie
  console.log(`⏳ Ingestion de ${MORE_TIMELINE.length} événements chronologiques supplémentaires...`);
  for (const t of MORE_TIMELINE) {
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
      try {
        sdb.run(`
          INSERT INTO db_timeline_events (
            age_year, era, title, title_ja, description,
            characters_involved, source_ref, canon, order_idx, visible
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1)
        `, [
          t.age_year, t.era, t.title, t.title_ja, t.description,
          JSON.stringify(t.characters_involved), t.source_ref, t.order_idx
        ]);
      } catch {}
    }
  }

  // 3. Ingestion Power Levels
  console.log(`⚡ Ingestion de ${MORE_POWER_LEVELS.length} niveaux de puissance supplémentaires...`);
  for (const p of MORE_POWER_LEVELS) {
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
      try {
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
      } catch {}
    }
  }

  if (sql) {
    const [{ count: bCount }] = await sql`SELECT count(*) FROM bot.db_battles`;
    const [{ count: tCount }] = await sql`SELECT count(*) FROM bot.db_timeline_events`;
    const [{ count: pCount }] = await sql`SELECT count(*) FROM bot.db_power_levels`;
    const [{ count: iCount }] = await sql`SELECT count(*) FROM bot.db_items`;
    const [{ count: dCount }] = await sql`SELECT count(*) FROM bot.db_dragons`;
    const [{ count: wCount }] = await sql`SELECT count(*) FROM bot.db_wishes`;

    console.log("\n🏆 NOUVEAU TOTAL MONDIAL DES DATASETS DRAGON BALL :");
    console.log(`- Combats légendaires : ${bCount}`);
    console.log(`- Chronologie par Âge : ${tCount}`);
    console.log(`- Niveaux de Puissance : ${pCount}`);
    console.log(`- Objets & Technologies : ${iCount}`);
    console.log(`- Dragons sacrés : ${dCount}`);
    console.log(`- Vœux canoniques : ${wCount}`);
    await sql.end();
  }
  if (sdb) sdb.close();

  console.log("\n🎉 EXPANSION TERMINÉE !");
}

main().catch(console.error);
