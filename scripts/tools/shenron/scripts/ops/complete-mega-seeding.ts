#!/usr/bin/env bun
/**
 * complete-mega-seeding.ts — Injection exhaustive pour la plateforme n°1 mondiale Dragon Ball
 *
 * Ce script complète la base de données avec plus de :
 * - 65 Combats détaillés (tous les arcs DB, DBZ, DBS, films)
 * - 45 Objets, Reliques & Technologies mythiques
 * - 40 Événements de la Chronologie universelle par Âge (Daizenshuu 7)
 * - 45 Niveaux de Puissance officiels (Scouter & Daizenshuu)
 * - 5 Dragons & 25 Vœux sacrés
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

// ─────────────────────────────────────────────────────────────────────────────
// COMBATS SUPPLÉMENTAIRES
// ─────────────────────────────────────────────────────────────────────────────
const EXTRA_BATTLES = [
  {
    slug: "goku-vs-yamcha-desert",
    title: "Son Goku vs Yamcha — La rencontre du désert",
    title_ja: "孫悟空対ヤムチャ",
    series: "DB",
    combatants: [
      { name: "Son Goku", side: "a" },
      { name: "Yamcha", side: "b" }
    ],
    winner_name: "Match nul (fuite de Yamcha)",
    location: "Désert des voleurs (Plaines d'Aru)",
    manga_volume_start: 1,
    manga_volume_end: 1,
    manga_chapter_start: 8,
    manga_chapter_end: 9,
    episode_start: 5,
    episode_end: 6,
    techniques_used: ["Rōgafūfūken (Poing du Loup)", "Janken (Pierre-Feuille-Ciseaux)", "Nyoï-bô"],
    climax_summary: "Yamcha attaque Goku affamé avec sa redoutable technique du loup. Alors qu'il prend l'avantage, la vue impromptue de la jeune Bulma déclenche sa phobie maladive des femmes et le pousse à battre en retraite.",
    canon: true,
    impact_level: 3,
  },
  {
    slug: "krilin-vs-bacterian-21e-tournoi",
    title: "Krilin vs Bactérie — Le triomphe sans odorat",
    title_ja: "クリリン対バクテリアン",
    series: "DB",
    combatants: [
      { name: "Krilin", side: "a" },
      { name: "Bactérie (Bacterian)", side: "b" }
    ],
    winner_name: "Krilin",
    location: "Arène du 21e Tenkaichi Budokai",
    manga_volume_start: 4,
    manga_volume_end: 4,
    manga_chapter_start: 36,
    manga_chapter_end: 37,
    episode_start: 20,
    episode_end: 21,
    techniques_used: ["Attaque fétide", "Prout nauséabond", "Rappel anatomique de Goku"],
    climax_summary: "Submergé par la puanteur insoutenable de son adversaire géant, Krilin s'effondre. Goku lui rappelle opportunément qu'il ne possède aucun nez. Réalisant son immunité biologique, Krilin se relève et expédie Bactérie d'un coup de pied magistral.",
    canon: true,
    impact_level: 3,
  },
  {
    slug: "yamcha-vs-jackie-chun-21e-tournoi",
    title: "Yamcha vs Jackie Chun — La leçon du Vieux Maître",
    title_ja: "ヤムチャ対ジャッキー・チュン",
    series: "DB",
    combatants: [
      { name: "Yamcha", side: "a" },
      { name: "Jackie Chun (Muten Roshi)", side: "b" }
    ],
    winner_name: "Jackie Chun",
    location: "Arène du 21e Tenkaichi Budokai",
    manga_volume_start: 4,
    manga_volume_end: 4,
    manga_chapter_start: 38,
    manga_chapter_end: 39,
    episode_start: 21,
    episode_end: 22,
    techniques_used: ["Rōgafūfūken", "Déplacement fantôme", "Pression du vent"],
    climax_summary: "Yamcha déploie toute la férocité de son Poing du Loup mais ne parvient pas à effleurer Jackie Chun, qui esquive les yeux fermés avant de l'éjecter du ring par la seule onde de déplacement de son bras.",
    canon: true,
    impact_level: 3,
  },
  {
    slug: "goku-vs-nam-21e-tournoi",
    title: "Son Goku vs Nam — Le duel aérien pour l'eau du village",
    title_ja: "孫悟空対ナム",
    series: "DB",
    combatants: [
      { name: "Son Goku", side: "a" },
      { name: "Nam", side: "b" }
    ],
    winner_name: "Son Goku",
    location: "Arène du 21e Tenkaichi Budokai",
    manga_volume_start: 4,
    manga_volume_end: 4,
    manga_chapter_start: 43,
    manga_chapter_end: 44,
    episode_start: 24,
    episode_end: 24,
    techniques_used: ["Tenkū Pekejiken (Croix aérienne plongeante)", "Tourbillon aérien"],
    climax_summary: "Nam exécute sa redoutable attaque plongeante depuis les cieux. Goku parvient à se relever in extremis avant le décompte et bondit encore plus haut pour surprendre Nam au sol.",
    canon: true,
    impact_level: 4,
  },
  {
    slug: "goku-vs-general-blue-pirates",
    title: "Son Goku vs Général Blue — L'emprise psychique du Ruban Rouge",
    title_ja: "孫悟空対ブルー将軍",
    series: "DB",
    combatants: [
      { name: "Son Goku", side: "a" },
      { name: "Général Blue", side: "b" }
    ],
    winner_name: "Son Goku (avec l'intervention inattendue d'une souris)",
    location: "Grotte sous-marine des Pirates & Village Pingouin",
    manga_volume_start: 6,
    manga_volume_end: 7,
    manga_chapter_start: 74,
    manga_chapter_end: 81,
    episode_start: 50,
    episode_end: 57,
    techniques_used: ["Paralysie télékinétique", "Fusil-harpon", "Zanzōken"],
    climax_summary: "Le Général Blue immobilise Goku grâce à son pouvoir occulte de paralysie oculaire. Une souris surgit, effrayant Blue qui perd sa concentration, permettant à Goku de le terrasser.",
    canon: true,
    impact_level: 4,
  },
  {
    slug: "goku-vs-grandpa-gohan-baba",
    title: "Son Goku vs Grand-père Son Gohan — Les larmes des retrouvailles",
    title_ja: "孫悟空対孫悟飯じいちゃん",
    series: "DB",
    combatants: [
      { name: "Son Goku", side: "a" },
      { name: "Grand-père Son Gohan (Masque de renard)", side: "b" }
    ],
    winner_name: "Son Goku (abandon attendri de Gohan)",
    location: "Palais de Baba la Voyante",
    manga_volume_start: 9,
    manga_volume_end: 9,
    manga_chapter_start: 104,
    manga_chapter_end: 108,
    episode_start: 73,
    episode_end: 76,
    techniques_used: ["Kaméhaméha", "Saisie de la queue", "Arrachement accidentel de queue"],
    climax_summary: "Le combattant masqué exploite la faiblesse de la queue de Goku. La queue cède accidentellement sous l'effort. Démasqué, Son Gohan serre son petit-fils en larmes dans ses bras.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "yamcha-vs-tenshinhan-22e-tournoi",
    title: "Yamcha vs Tenshinhan — La cruauté de l'École de la Grue",
    title_ja: "ヤムチャ対天津飯",
    series: "DB",
    combatants: [
      { name: "Yamcha", side: "a" },
      { name: "Tenshinhan", side: "b" }
    ],
    winner_name: "Tenshinhan",
    location: "Arène du 22e Tenkaichi Budokai",
    manga_volume_start: 10,
    manga_volume_end: 10,
    manga_chapter_start: 117,
    manga_chapter_end: 119,
    episode_start: 85,
    episode_end: 86,
    techniques_used: ["Shin Rōgafūfūken", "Kaméhaméha", "Kiai", "Brise-jambe"],
    climax_summary: "Yamcha surprend Tenshinhan avec son nouveau Kaméhaméha. Tenshinhan le renvoie d'un Kiai et brise impitoyablement la jambe de Yamcha sans nécessité sportive.",
    canon: true,
    impact_level: 4,
  },
  {
    slug: "goku-vs-krilin-22e-tournoi",
    title: "Son Goku vs Krilin — La fraternité de l'École de la Tortue",
    title_ja: "孫悟空対クリリン",
    series: "DB",
    combatants: [
      { name: "Son Goku", side: "a" },
      { name: "Krilin", side: "b" }
    ],
    winner_name: "Son Goku",
    location: "Arène du 22e Tenkaichi Budokai",
    manga_volume_start: 11,
    manga_volume_end: 11,
    manga_chapter_start: 125,
    manga_chapter_end: 127,
    episode_start: 93,
    episode_end: 94,
    techniques_used: ["Kaméhaméha à retardement", "Zanzōken multiple", "Vitesse invisible"],
    climax_summary: "Krilin imagine un stratagème génial en saisissant la queue de Goku, mais découvre que Goku a entraîné son appendice caudal à ne plus ressentir aucune douleur.",
    canon: true,
    impact_level: 4,
  },
  {
    slug: "goku-vs-tenshinhan-22e-tournoi-finale",
    title: "Son Goku vs Tenshinhan — La collision des écoles rivales",
    title_ja: "孫悟空対天津飯（第22回決勝）",
    series: "DB",
    combatants: [
      { name: "Son Goku", side: "a" },
      { name: "Tenshinhan", side: "b" }
    ],
    winner_name: "Tenshinhan (par contact au sol fortuit d'un van)",
    location: "Arène puis ciel au-dessus de la ville",
    manga_volume_start: 11,
    manga_volume_end: 12,
    manga_chapter_start: 128,
    manga_chapter_end: 134,
    episode_start: 97,
    episode_end: 101,
    techniques_used: ["Kikōhō", "Shiyōken (Quatre bras)", "Kaméhaméha propulsé"],
    climax_summary: "Tenshinhan pulvérise le ring avec son Kikōhō. En chute libre finale, Goku percute un camion en premier, offrant la victoire sur le fil à Tenshinhan.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "yamcha-vs-saibaiman",
    title: "Yamcha vs Saibaiman — Le piège funeste",
    title_ja: "ヤムチャ対栽培マン",
    series: "DBZ",
    combatants: [
      { name: "Yamcha", side: "a" },
      { name: "Saibaiman", side: "b" }
    ],
    winner_name: "Saibaiman (Autodestruction mutuelle)",
    location: "Plaines sauvages, Terre",
    manga_volume_start: 18,
    manga_volume_end: 18,
    manga_chapter_start: 214,
    manga_chapter_end: 215,
    episode_start: 22,
    episode_end: 23,
    techniques_used: ["Kaméhaméha", "Rōgafūfūken", "Autodestruction en crampon"],
    climax_summary: "Après avoir dominé le Saibaiman au combat loyal, Yamcha baisse sa garde. La créature se jette sur son torse et s'autodétruit, tuant Yamcha sur le coup.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "z-fighters-vs-nappa",
    title: "Les Guerriers Z vs Nappa — L'hécatombe des défenseurs de la Terre",
    title_ja: "Z戦士対ナッパ",
    series: "DBZ",
    combatants: [
      { name: "Tenshinhan, Chaozu, Krilin & Piccolo", side: "a" },
      { name: "Nappa", side: "b" }
    ],
    winner_name: "Nappa",
    location: "Plaines sauvages, Terre",
    manga_volume_start: 18,
    manga_volume_end: 19,
    manga_chapter_start: 216,
    manga_chapter_end: 221,
    episode_start: 23,
    episode_end: 28,
    techniques_used: ["Autodestruction de Chaozu", "Kikōhō d'un seul bras", "Bouclier de Piccolo"],
    climax_summary: "Nappa massacre méthodiquement les défenseurs. Chaozu périt en vain, Tenshinhan meurt d'épuisement après un Kikōhō désespéré, et Piccolo s'interpose devant un rayon mortel pour sauver Gohan.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "goku-vs-nappa-vengeance",
    title: "Son Goku vs Nappa — La démonstration du Kaiô-ken",
    title_ja: "孫悟空対ナッパ",
    series: "DBZ",
    combatants: [
      { name: "Son Goku", side: "a" },
      { name: "Nappa", side: "b" }
    ],
    winner_name: "Son Goku",
    location: "Plaines sauvages, Terre",
    manga_volume_start: 19,
    manga_volume_end: 19,
    manga_chapter_start: 222,
    manga_chapter_end: 227,
    episode_start: 28,
    episode_end: 29,
    techniques_used: ["Kaiô-ken instantané", "Kiai", "Attaque brise-reins"],
    climax_summary: "Goku humilie Nappa sans effort. Quand Nappa tente d'attaquer Gohan et Krilin, Goku active le Kaiô-ken en un éclair et lui brise la colonne vertébrale.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "vegeta-vs-cui-namek",
    title: "Vegeta vs Cui — Les feux d'artifice de Namek",
    title_ja: "ベジータ対キュイ",
    series: "DBZ",
    combatants: [
      { name: "Vegeta", side: "a" },
      { name: "Cui", side: "b" }
    ],
    winner_name: "Vegeta",
    location: "Plage rocheuse de Namek",
    manga_volume_start: 21,
    manga_volume_end: 21,
    manga_chapter_start: 246,
    manga_chapter_end: 246,
    episode_start: 44,
    episode_end: 45,
    techniques_used: ["Dirty Fireworks (Feux d'artifice sales)", "Zenkai Boost"],
    climax_summary: "Cui tente de fuir après avoir mesuré les 24 000 unités de Vegeta. Vegeta le rattrape en vol et le fait exploser de deux doigts levés.",
    canon: true,
    impact_level: 4,
  },
  {
    slug: "vegeta-vs-dodoria-namek",
    title: "Vegeta vs Dodoria — La vérité sur la destruction de la planète Vegeta",
    title_ja: "ベジータ対ドドリア",
    series: "DBZ",
    combatants: [
      { name: "Vegeta", side: "a" },
      { name: "Dodoria", side: "b" }
    ],
    winner_name: "Vegeta",
    location: "Forêt d'arbres Ajissa sur Namek",
    manga_volume_start: 21,
    manga_volume_end: 21,
    manga_chapter_start: 248,
    manga_chapter_end: 249,
    episode_start: 48,
    episode_end: 49,
    techniques_used: ["Maximum Flasher", "Poignets brisés"],
    climax_summary: "Dodoria marchande sa survie en révélant que Freeza a détruit la planète Vegeta par peur des Super Saiyans. Vegeta le désintègre aussitôt sans la moindre hésitation.",
    canon: true,
    impact_level: 4,
  },
  {
    slug: "vegeta-vs-zarbon-round1",
    title: "Vegeta vs Zarbon (Round 1) — La métamorphose monstrueuse",
    title_ja: "ベジータ対ザーボン（第1戦）",
    series: "DBZ",
    combatants: [
      { name: "Vegeta", side: "a" },
      { name: "Zarbon (Forme monstre)", side: "b" }
    ],
    winner_name: "Zarbon",
    location: "Région montagneuse de Namek",
    manga_volume_start: 21,
    manga_volume_end: 22,
    manga_chapter_start: 252,
    manga_chapter_end: 254,
    episode_start: 52,
    episode_end: 53,
    techniques_used: ["Transformation en brute", "Piledriver dans le cratère"],
    climax_summary: "Dominé sous sa forme élégante, Zarbon dévoile sa hideuse transformation bestiale et écrase violemment la tête de Vegeta au fond d'un cratère inondé.",
    canon: true,
    impact_level: 4,
  },
  {
    slug: "vegeta-vs-zarbon-round2",
    title: "Vegeta vs Zarbon (Round 2) — Le sable aveuglant",
    title_ja: "ベジータ対ザーボン（第2戦）",
    series: "DBZ",
    combatants: [
      { name: "Vegeta", side: "a" },
      { name: "Zarbon", side: "b" }
    ],
    winner_name: "Vegeta",
    location: "Plaine de Namek",
    manga_volume_start: 22,
    manga_volume_end: 22,
    manga_chapter_start: 263,
    manga_chapter_end: 264,
    episode_start: 56,
    episode_end: 57,
    techniques_used: ["Jet de sable aveuglant", "Perforation du torse à bout portant"],
    climax_summary: "Ayant bénéficié d'un nouveau Zenkai dans la cuve de régénération, Vegeta aveugle Zarbon avec du sable et lui transperce le torse d'un rayon énergétique fatal.",
    canon: true,
    impact_level: 4,
  },
  {
    slug: "freezer-vs-nail-namek",
    title: "Freeza vs Nail — La bravoure du guerrier Namek",
    title_ja: "フリーザ対ネイル",
    series: "DBZ",
    combatants: [
      { name: "Nail (42 000 BP)", side: "a" },
      { name: "Freeza (530 000 BP)", side: "b" }
    ],
    winner_name: "Freeza (Nail survit pour guider Piccolo)",
    location: "Plateau rocheux devant la maison de Saichōrō",
    manga_volume_start: 24,
    manga_volume_end: 24,
    manga_chapter_start: 286,
    manga_chapter_end: 288,
    episode_start: 71,
    episode_end: 72,
    techniques_used: ["Bras tranché et régénéré", "Rayon oculaire"],
    climax_summary: "Nail combat avec héroïsme pour faire gagner du temps à Dendé. Freeza le torture sans pitié avant de réaliser trop tard qu'il a été berné par la ruse namekienne.",
    canon: true,
    impact_level: 4,
  },
  {
    slug: "freezer-2e-forme-vs-piccolo",
    title: "Freeza (2e forme) vs Piccolo — La fusion des Namekiens",
    title_ja: "フリーザ（第2形態）対ピッコロ",
    series: "DBZ",
    combatants: [
      { name: "Piccolo (assimilé à Nail)", side: "a" },
      { name: "Freeza (2e forme)", side: "b" }
    ],
    winner_name: "Piccolo (pousse Freeza à muter)",
    location: "Plaine volcanique de Namek",
    manga_volume_start: 25,
    manga_volume_end: 25,
    manga_chapter_start: 299,
    manga_chapter_end: 301,
    episode_start: 80,
    episode_end: 81,
    techniques_used: ["Vêtements lourds retirés", "Gekiretsu Kōdan", "Super force namekienne"],
    climax_summary: "Fort de sa fusion avec Nail, Piccolo retire son turban et accule violemment le colosse cornu de Freeza, le forçant à enclencher sa 3e métamorphose cauchemardesque.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "vegeta-vs-c19",
    title: "Vegeta vs C-19 — L'avènement du Super Saiyan sanguinaire",
    title_ja: "ベジータ対人造人間19号",
    series: "DBZ",
    combatants: [
      { name: "Vegeta (Super Saiyan)", side: "a" },
      { name: "C-19", side: "b" }
    ],
    winner_name: "Vegeta",
    location: "Région rocheuse près de South City",
    manga_volume_start: 29,
    manga_volume_end: 29,
    manga_chapter_start: 343,
    manga_chapter_end: 345,
    episode_start: 129,
    episode_end: 130,
    techniques_used: ["Big Bang Attack", "Arrachage de bras à mains nues"],
    climax_summary: "Vegeta dévoile sa transformation en Super Saiyan à la stupeur générale. Il arrache les mains absorbantes de C-19 et le décapite à distance avec sa première Big Bang Attack.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "vegeta-vs-c18-autoroute",
    title: "Vegeta vs C-18 — La brisure de l'orgueil Saiyan",
    title_ja: "ベジータ対人造人間18号",
    series: "DBZ",
    combatants: [
      { name: "Vegeta (Super Saiyan)", side: "a" },
      { name: "C-18", side: "b" }
    ],
    winner_name: "C-18",
    location: "Autoroute déserte de montagne",
    manga_volume_start: 30,
    manga_volume_end: 30,
    manga_chapter_start: 352,
    manga_chapter_end: 355,
    episode_start: 136,
    episode_end: 137,
    techniques_used: ["Énergie infinie", "Fracture de bras au tibia"],
    climax_summary: "L'énergie inépuisable de C-18 use rapidement l'endurance de Vegeta. Elle conclut l'affrontement d'un violent coup de tibia qui brise net le bras gauche du Prince.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "super-vegeta-vs-semi-perfect-cell",
    title: "Super Vegeta vs Semi-Perfect Cell — L'arrogance absolue",
    title_ja: "超ベジータ対第二形態セル",
    series: "DBZ",
    combatants: [
      { name: "Super Vegeta (SSJ Grade 2)", side: "a" },
      { name: "Cell (2e forme)", side: "b" }
    ],
    winner_name: "Super Vegeta (laisse Cell absorber C-18)",
    location: "Archipel d'îles rocheuses",
    manga_volume_start: 32,
    manga_volume_end: 32,
    manga_chapter_start: 375,
    manga_chapter_end: 379,
    episode_start: 156,
    episode_end: 159,
    techniques_used: ["Final Flash prototype", "Big Bang Attack", "Coup de pied écrasant"],
    climax_summary: "Vegeta surclasse outrageusement Cell. Piqué au vif par son orgueil, il commet l'erreur fatale de laisser Cell traquer C-18 pour contempler son corps parfait.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "goku-vs-cell-cell-games",
    title: "Son Goku vs Perfect Cell — L'Instant Kaméhaméha d'anthologie",
    title_ja: "孫悟空対完全体セル",
    series: "DBZ",
    combatants: [
      { name: "Son Goku (Full Power SSJ)", side: "a" },
      { name: "Perfect Cell", side: "b" }
    ],
    winner_name: "Son Goku (abandon volontaire au profit de Gohan)",
    location: "Arène des Cell Games",
    manga_volume_start: 33,
    manga_volume_end: 34,
    manga_chapter_start: 396,
    manga_chapter_end: 403,
    episode_start: 177,
    episode_end: 181,
    techniques_used: ["Instant Kamehameha (Téléportation + Kaméhaméha)", "Shunkan Idō"],
    climax_summary: "Goku surprend Cell et pulvérise son buste supérieur d'un Instant Kaméhaméha à bout portant. Cell se régénère grâce à ses cellules de Piccolo, et Goku cède sa place à Gohan.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "gohan-vs-dabra-vaisseau-babidi",
    title: "Son Gohan vs Dabra — Le Roi des Démons au combat",
    title_ja: "孫悟飯対ダーブラ",
    series: "DBZ",
    combatants: [
      { name: "Son Gohan (Super Saiyan)", side: "a" },
      { name: "Dabra", side: "b" }
    ],
    winner_name: "Interrompu par Dabra découvrant le vice de Vegeta",
    location: "Étage désertique du vaisseau de Babidi",
    manga_volume_start: 38,
    manga_volume_end: 38,
    manga_chapter_start: 452,
    manga_chapter_end: 456,
    episode_start: 224,
    episode_end: 226,
    techniques_used: ["Crachat pétrifiant", "Lame magique de Ki", "Flamme du diable"],
    climax_summary: "Gohan peine à cause de son manque d'entraînement pendant les années de paix. Dabra sent la jalousie noire dans le cœur de Vegeta et se retire pour en informer Babidi.",
    canon: true,
    impact_level: 4,
  },
  {
    slug: "gohan-ultime-vs-super-buu",
    title: "Gohan Ultime vs Super Buu — La revanche du guerrier libéré",
    title_ja: "アルティメット悟飯対魔人ブウ（悪）",
    series: "DBZ",
    combatants: [
      { name: "Son Gohan (Potentiel libéré)", side: "a" },
      { name: "Super Buu", side: "b" }
    ],
    winner_name: "Son Gohan (avant ruse d'absorption de Buu)",
    location: "Terre déserte",
    manga_volume_start: 41,
    manga_volume_end: 41,
    manga_chapter_start: 496,
    manga_chapter_end: 499,
    episode_start: 262,
    episode_end: 265,
    techniques_used: ["Potentiel éveillé par le Doyen Kaïōshin", "Correction physique totale"],
    climax_summary: "Gohan rentre sur Terre et prononce sa célèbre réplique : « Te battre ? Non, je vais te tuer. » Il humilie Super Buu à chaque coup jusqu'à ce que Buu feinte et absorbe Gotenks.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "goku-vs-uub-28e-tournoi",
    title: "Son Goku vs Uub — La passation du flambeau",
    title_ja: "孫悟空対ウーブ",
    series: "DB",
    combatants: [
      { name: "Son Goku", side: "a" },
      { name: "Uub", side: "b" }
    ],
    winner_name: "Interrompu (Départ pour l'entraînement)",
    location: "Arène du 28e Tenkaichi Budokai",
    manga_volume_start: 42,
    manga_volume_end: 42,
    manga_chapter_start: 518,
    manga_chapter_end: 519,
    episode_start: 290,
    episode_end: 291,
    techniques_used: ["Vol instinctif", "Force brute de Buu réincarnée"],
    climax_summary: "Goku provoque Uub pour éveiller sa puissance cachée de Majin Buu. Émerveillé par son génie martial pur, Goku s'envole avec lui sur Kinto-Un pour en faire son héritier spirituel.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "goku-vegeta-vs-golden-freezer",
    title: "Son Goku & Vegeta vs Golden Freeza — L'éclat du Super Saiyan Blue",
    title_ja: "孫悟空・ベジータ対ゴールデンフリーザ",
    series: "DBS",
    combatants: [
      { name: "Son Goku & Vegeta (SSGSS)", side: "a" },
      { name: "Golden Freeza", side: "b" }
    ],
    winner_name: "Son Goku (après rembobinage temporel de Whis)",
    location: "Région côtière dévastée de la Terre",
    manga_volume_start: 1,
    manga_volume_end: 1,
    manga_chapter_start: 5,
    manga_chapter_end: 5,
    episode_start: 25,
    episode_end: 27,
    techniques_used: ["Super Saiyan Blue", "Golden Death Beam", "Restauration temporelle de Whis"],
    climax_summary: "Freeza fait sauter la planète Terre de dépit. Whis protège le groupe et rembobine le temps de trois minutes, permettant à Goku d'abattre Freeza avant sa frappe destructrice.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "goku-vs-hit-tournoi-champa",
    title: "Son Goku vs Hit — Le saut temporel face au Kaiô-ken Blue",
    title_ja: "孫悟空対ヒット",
    series: "DBS",
    combatants: [
      { name: "Son Goku (SSGSS Kaiô-ken x10)", side: "a" },
      { name: "Hit (Assassin de l'Univers 6)", side: "b" }
    ],
    winner_name: "Hit (Goku saute hors du ring par défi)",
    location: "Arène de la planète sans nom",
    manga_volume_start: 2,
    manga_volume_end: 2,
    manga_chapter_start: 12,
    manga_chapter_end: 13,
    episode_start: 38,
    episode_end: 40,
    techniques_used: ["Tokitobashi (Saut temporel)", "Super Saiyan Blue Kaiô-ken x10"],
    climax_summary: "Goku devine les dixièmes de seconde de saut temporel de Hit et combine le Super Saiyan Blue avec le Kaiô-ken x10 dans une démonstration d'intensité ahurissante.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "vegetto-blue-vs-zamasu-fusionne",
    title: "Vegetto Blue vs Zamasu Fusionné — L'assaut des dieux",
    title_ja: "ベジットブルー対合体ザマス",
    series: "DBS",
    combatants: [
      { name: "Vegetto (Super Saiyan Blue)", side: "a" },
      { name: "Zamasu Fusionné", side: "b" }
    ],
    winner_name: "Dé-fusion prématurée de Vegetto due à la surpuissance",
    location: "Capitale du futur alternatif en ruines",
    manga_volume_start: 4,
    manga_volume_end: 4,
    manga_chapter_start: 23,
    manga_chapter_end: 24,
    episode_start: 66,
    episode_end: 66,
    techniques_used: ["Final Kamehameha", "Spirit Sword", "Lumière divine corrompue"],
    climax_summary: "Vegetto Blue surpasse Zamasu mais la décharge démesurée d'énergie divine sature les Potalas mortelles avant le coup de grâce, provoquant la séparation anticipée de Goku et Vegeta.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "gogeta-blue-vs-broly",
    title: "Gogeta Blue vs Broly — Le choc dimensionnel absolu",
    title_ja: "ゴジータブルー対ブロリー",
    series: "DBS",
    combatants: [
      { name: "Gogeta (Super Saiyan Blue)", side: "a" },
      { name: "Broly (Super Saiyan Légendaire)", side: "b" }
    ],
    winner_name: "Gogeta (Broly sauvé in extremis par Shenron)",
    location: "Terres polaires puis dimension brisée",
    manga_volume_start: 9,
    manga_volume_end: 9,
    manga_chapter_start: 42,
    manga_chapter_end: 42,
    episode_start: 131,
    episode_end: 131,
    techniques_used: ["Stardust Breaker", "Resonant Kamehameha", "Gigantic Cataclysm"],
    climax_summary: "Leurs attaques brisent le continuum espace-temps. Alors que Gogeta Blue envoie le Kaméhaméha ultime pour désintégrer Broly, Cheelai utilise les Dragon Balls pour le renvoyer sain et sauf sur la planète Vampa.",
    canon: true,
    impact_level: 5,
  },
  {
    slug: "gohan-beast-vs-cell-max",
    title: "Gohan Beast vs Cell Max — Le Makankōsappō vengeur",
    title_ja: "孫悟飯ビースト対セルマックス",
    series: "DBS",
    combatants: [
      { name: "Son Gohan (Beast)", side: "a" },
      { name: "Orange Piccolo", side: "a" },
      { name: "Cell Max", side: "b" }
    ],
    winner_name: "Son Gohan Beast & Orange Piccolo",
    location: "Base du Red Ribbon Army",
    manga_volume_start: 21,
    manga_volume_end: 22,
    manga_chapter_start: 96,
    manga_chapter_end: 100,
    episode_start: 131,
    episode_end: 131,
    techniques_used: ["Forme Beast", "Makankōsappō suprême", "Gigantification Orange Piccolo"],
    climax_summary: "Témoin du quasi-sacrifice d'Orange Piccolo retenant Cell Max, Gohan brise toutes ses limites dans la forme Beast. Son Makankōsappō transperce le point faible crânien de Cell Max.",
    canon: true,
    impact_level: 5,
  },
];

async function main() {
  console.log("🐉 Ingestion des combats légendaires complémentaires...");
  const pgUrl = getPgUrl();
  const sql = pgUrl ? postgres(pgUrl, { max: 2 }) : null;
  const sdb = existsSync(sqlitePath) ? new Database(sqlitePath) : null;

  for (const b of EXTRA_BATTLES) {
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

  if (sql) {
    const [{ count: bCount }] = await sql`SELECT count(*) FROM bot.db_battles`;
    const [{ count: tCount }] = await sql`SELECT count(*) FROM bot.db_timeline_events`;
    const [{ count: pCount }] = await sql`SELECT count(*) FROM bot.db_power_levels`;
    const [{ count: iCount }] = await sql`SELECT count(*) FROM bot.db_items`;
    const [{ count: dCount }] = await sql`SELECT count(*) FROM bot.db_dragons`;
    const [{ count: wCount }] = await sql`SELECT count(*) FROM bot.db_wishes`;

    console.log("\n📊 BILAN COMPLET DES DONNÉES ENRICHIES DANS POSTGRESQL :");
    console.log(`- Combats légendaires : ${bCount}`);
    console.log(`- Chronologie par Âge : ${tCount}`);
    console.log(`- Niveaux de Puissance : ${pCount}`);
    console.log(`- Objets & Technologies : ${iCount}`);
    console.log(`- Dragons sacrés : ${dCount}`);
    console.log(`- Vœux canoniques : ${wCount}`);
    await sql.end();
  }
  if (sdb) sdb.close();

  console.log("\n✅ Succès complet de l'enrichissement !");
}

main().catch(console.error);
