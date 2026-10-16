/**
 * Import de l'XP/niveau du bot de niveaux TIERS vers `bot_profils`, et de ses
 * récompenses de rôle par palier vers `bot_recompenses_niveau`.
 *
 * ── LE BOT IDENTIFIÉ : NOCTALY (application Discord 875811233616519219) ────
 * Identification croisée, aucune supposition :
 *   - `GET /guilds/{RG_GUILD_ID}/integrations` (jeton DISCORD_BOT_TOKEN)
 *     liste Noctaly avec pour description officielle Discord : « Text, Voice
 *     & Reaction XP • Reaction Roles • Ban Appeal • Auto Leaderboard • Custom
 *     Bot • Moderation • Logs • Support 26 Languages ».
 *   - Le salon #🎀〡rôles (1349589953721401355) contient un message du staff
 *     (inazo__, 7/4/2026) qui décrit en détail le « Système d'XP » du
 *     serveur : XP textuel + XP vocal **séparés** (deux niveaux distincts par
 *     membre), salons exclus (mudae/mudae-2 en textuel ; AFK + salons de
 *     Modération en vocal), et 4 paliers de rôles (10/25/40/60) — exactement
 *     les fonctionnalités « Text & Voice XP » + « Level Roles » de Noctaly.
 *   - Le salon #🤖〡bots (1135698156835852369) contient les interactions
 *     RÉELLES `/rank` et `/leaderboard` de Noctaly (champ
 *     `interaction_metadata.name` des messages), et des embeds
 *     « 🎉 Niveau supérieur ! Félicitations … Vous avez atteint le niveau… »
 *     — le message de montée de niveau exact de Noctaly.
 *   - Le salon #💬📖〡logs (1073752409387573339) montre Noctaly logger aussi
 *     arrivées/départs, messages édités/supprimés, entrées/sorties vocal — le
 *     module « Logs » listé dans sa description.
 *
 * ── FORMULE D'XP RÉELLE DE NOCTALY (valeurs par défaut du bot ; RG a pu les
 *    modifier depuis son dashboard, invérifiable sans y accéder) ───────────
 *   Sourcé sur noctaly.com/tutorials/how-to-setup-discord-leveling-system et
 *   noctaly.com/table (table statique des 100 paliers, servie côté serveur) :
 *     - XP message  : 20 XP/message, cooldown 60 s
 *     - XP vocal    : 6 XP/minute (membre non muet et non sourd)
 *     - XP réaction : 15 XP/réaction, cooldown 300 s
 *     - XP commande : 10 XP/commande utilisée, cooldown 60 s
 *     - XP cumulée pour ATTEINDRE le niveau n : régression sur les 3
 *       premières lignes de noctaly.com/table (125, 160, 205 XP pour passer
 *       1→2, 2→3, 3→4) puis vérifiée sur les 100 lignes de la table : le coût
 *       pour passer du niveau n à n+1 vaut `5·n² + 20·n + 100`.
 *   Salon d'annonce de montée de niveau : PAS un salon fixe. Les deux embeds
 *   « Niveau supérieur » retrouvés dans l'historique apparaissent dans le
 *   salon où le membre venait d'être actif (#🤖〡bots pour l'un,
 *   #💬🏫〡général-modérateurs pour l'autre) : c'est le mode par défaut de
 *   Noctaly, « Current Channel » (annonce dans le salon courant), pas un
 *   « Custom Channel » unique configuré par RG.
 *
 * ── CE QUI EST IMPORTÉ, ET SURTOUT CE QUI NE L'EST PAS ──────────────────────
 *   Noctaly n'expose AUCUNE route publique de classement complet :
 *     - Son API publique (base `https://noctaly.com/api/v1`, cf. le SDK
 *       officiel github.com/Noctalycom/node-sdk) exige une clé API
 *       (`GET /guilds/{id}/users/{id}/level-profile`, un membre à la fois —
 *       aucune route de liste/export en bulk) générée depuis
 *       noctaly.com/dashboard par un membre du staff RG ayant la permission
 *       Discord « Gérer le serveur » — connexion OAuth humaine, hors de
 *       portée de cet agent. Sans clé : 401 `unauthenticated`. Aucune clé
 *       Noctaly n'existe dans ce dépôt (`.env`, `.secrets/`) : vérifié.
 *     - La page publique noctaly.com/leaderboard/<guild> est une SPA Next.js
 *       dont les données de classement sont chargées côté client après
 *       hydratation JS ; le HTML livré au premier chargement ne contient
 *       AUCUN identifiant Discord de membre (vérifié par recherche sur la
 *       réponse brute) et se limite de toute façon au top 100.
 *     - Le classement auto-posté par la commande `/leaderboard` dans
 *       #🤖〡bots est une IMAGE PNG (carte générée par Noctaly), donc ni
 *       paginable ni exhaustive — seulement le TOP 10, et l'XP y est déjà
 *       arrondie à l'affichage (« 44.4k » = quelque part entre 44 350 et
 *       44 449 XP réelle).
 *   → Résultat : seul le TOP 10 du dernier classement public retrouvé (posté
 *     le 9/8/2026 dans #🤖〡bots, message 1536045686259323010, généré par la
 *     commande `/leaderboard` de yoyo__goat) a pu être récupéré : lu
 *     visuellement sur l'image, puis chaque pseudo résolu en ID Discord réel
 *     via `GET /guilds/{RG_GUILD_ID}/members/search?query=<pseudo>`.
 *     C'est 10 comptes sur ~1 902 membres (`approximate_member_count` de la
 *     guilde au 14/8/2026) : moins de 1 %.
 *   Cette seule image ne suffisait pas : la PASSE 2 ci-dessous (section
 *   « --source=historique ») élargit la couverture à 65 membres SANS clé API,
 *   en dépouillant l'historique complet des salons plutôt qu'un seul
 *   instantané. Le reste des ~1 902 membres n'est toujours récupérable que
 *   par une voie humaine :
 *     1. Un membre du staff RG génère une clé API sur noctaly.com/dashboard,
 *        puis on itère `GET /guilds/{id}/users/{id}/level-profile` sur les
 *        `discord_id` de `discord_members` (limite documentée : 50 req/s).
 *     2. Si le dashboard propose un export (CSV/JSON) — non documenté
 *        publiquement, à vérifier de visu — un humain le télécharge et on
 *        écrit un second script qui le lit.
 *   Aucun chiffre n'a été inventé, dans cette passe comme dans la suivante.
 *
 * ── CORRESPONDANCE DE COURBE ─────────────────────────────────────────────
 *   L'XP est importée BRUTE, telle qu'affichée par Noctaly (imprécise à la
 *   centaine près pour ce lot, cf. ci-dessus). Le niveau est RECALCULÉ avec
 *   `niveauPour()` de la courbe du JEU (`../lib/experience.ts`, 100 paliers,
 *   `inagle_exp_table`) — jamais le niveau Noctaly écrit tel quel : les deux
 *   courbes ne se correspondent pas (ex. niveau 26 Noctaly ≈ 44 400 XP ≈
 *   niveau 30 sur la courbe du jeu, bien plus dure en haut de classement).
 *   Si l'XP dépasse le plafond de notre courbe (2 878 742), `niveauPour` la
 *   borne déjà à 100 — aucun cas dans ce lot (max = 44 400).
 *
 * ── RÉCOMPENSES DE RÔLE PAR PALIER ──────────────────────────────────────────
 *   Sourcées du même message #🎀〡rôles. Noctaly a DEUX pistes de niveau par
 *   membre (textuelle et vocale) avec, à chaque palier, un rôle DISTINCT par
 *   piste mais les mêmes avantages, plus un rôle spécial exigeant le palier
 *   60 sur les deux pistes à la fois.
 *   ⚠ La table réelle `bot_recompenses_niveau` a pour clé primaire
 *   `(guild_id, niveau)` — vérifié via `pg_get_constraintdef` — et non
 *   `(guild_id, niveau, role_id)` : UN SEUL rôle par niveau et par guilde est
 *   représentable, pas un rôle par piste. Notre bot (`experience.ts`,
 *   `GAIN_DEFAUT`) ne track d'ailleurs QUE de l'XP de message, aucune XP
 *   vocale — il n'a donc de toute façon pas de second axe où loger une piste
 *   vocale. Choix fait ici : importer la piste TEXTUELLE de Noctaly (la plus
 *   proche de notre propre système), et **abandonner** la piste vocale ainsi
 *   que le rôle spécial « textuel ET vocal niveau 60 » (aucune des deux
 *   n'entre dans un schéma à un seul rôle par niveau). Le rôle de base donné
 *   à l'arrivée (1073013308623429782, tout le monde l'a dès le join) et le
 *   rôle de boost Nitro (1089171148287250463, indexé sur le statut de boost
 *   et pas sur un palier) sont eux aussi volontairement EXCLUS : ce ne sont
 *   pas des récompenses de palier.
 *   Conversion palier Noctaly → XP Noctaly (colonne « Total XP » de
 *   noctaly.com/table) → niveau jeu via `niveauPour()` :
 *     - palier 10 → 4 025 XP   → niveau 13 → rôle textuel 1086256838137352242
 *     - palier 25 → 36 625 XP  → niveau 30 → rôle textuel 1086257086591160340
 *     - palier 40 → 131 100 XP → niveau 45 → rôle textuel 1086618597578776708
 *     - palier 60 → 411 650 XP → niveau 62 → rôle textuel 1086619301714329720
 *   `cumulable` : Noctaly RETIRE par défaut le rôle du palier précédent à
 *   chaque montée (`Stack Roles` est une option qu'il faut activer à la main
 *   dans son dashboard) ; nous n'avons pas accès à ce réglage pour RG, donc
 *   on importe `cumulable = false` (le défaut de fabrique de Noctaly) plutôt
 *   que de deviner. Si un humain confirme que RG a activé « Stack Roles »,
 *   corriger avec `UPDATE bot_recompenses_niveau SET cumulable = true WHERE
 *   guild_id = '<RG_GUILD_ID>'` (cf. @rosegriffon/types/discord).
 *
 * ── PASSE 2 : `--source=historique` ─────────────────────────────────────────
 *   Deuxième passe demandée après le premier import, sur le seul point qui
 *   manquait : élargir la couverture SANS clé API humaine, en dépouillant
 *   l'historique complet des salons où Noctaly a répondu (pas seulement le
 *   dernier `/leaderboard`).
 *
 *   Méthode : pagination intégrale (`before=`) de chaque salon via
 *   `GET /channels/{id}/messages`, ~5 req/s (cadence choisie pour ne pas
 *   gêner `rg-bot.service`/`azalee-bot.service` qui partagent le même jeton
 *   et donc le même compartiment de rate-limit Discord — d'où les pauses
 *   « rate limited » observées pendant le scan, absorbées par une reprise
 *   automatique sur l'en-tête `retry_after`), en ne gardant que les messages
 *   `author.id = 875811233616519219`. Chaque `/rank` donne l'XP EXACTE d'UN
 *   membre (attachement `card.png`, dont le texte « XP TOTAL » est lu
 *   visuellement) ; chaque `/leaderboard` en donne dix, arrondis à la
 *   centaine par Noctaly à l'affichage ; chaque embed « Niveau supérieur »
 *   donne un niveau annoncé sans XP exacte — dans ce cas on retient le seuil
 *   OFFICIEL de ce palier (colonne « Total XP » de noctaly.com/table, jamais
 *   inventé) comme minorant, explicitement marqué `seuil-officiel-palier`.
 *
 *   Salons couverts, avec les 8 candidats sondés sur leur dernier lot de 100
 *   messages d'abord (règle : deux salons d'affilée sans résultat arrêtent la
 *   piste) :
 *     - #🤖〡bots (1135698156835852369) : pagination COMPLÈTE, 6 119 messages,
 *       31/7/2023→13/8/2026, 19 messages Noctaly (`/rank` + `/leaderboard`,
 *       tous entre le 11/3/2026 et le 9/8/2026).
 *     - #🤪〡memes-inazuma (1140743411901661275) : pagination COMPLÈTE, 3 119
 *       messages, 14/8/2023→4/8/2026, 3 embeds « Niveau supérieur ».
 *     - #🎈〡questions (1136022956619866176) : pagination COMPLÈTE, 1 089
 *       messages, 1/8/2023→14/8/2026, 1 embed (Inazo, dominé par une mesure
 *       plus fraîche déjà connue — rien de nouveau).
 *     - #💬〡général (1135528098146816010, 207 messages Noctaly retrouvés),
 *       #📷〡médias (1135660042025193472, 45), #🎨〡vos-fanarts
 *       (1084588796403777617, 7) : pagination ARRÊTÉE une fois remonté au
 *       11-17/3/2026 sans un seul message Noctaly plus ancien — cohérent avec
 *       les 3 salons ci-dessus, entièrement paginés jusqu'à 2023, où le plus
 *       ancien message Noctaly ne descend JAMAIS sous le 11/3/2026 : le module
 *       de niveaux a manifestement été activé/réinitialisé ce jour-là sur
 *       cette guilde. Continuer plus loin en arrière n'aurait rien trouvé de
 *       plus — la charge inutile sur l'API (partagée avec les deux bots de
 *       prod) a été évitée sur cette base.
 *     - #🕵〡présentations, #🧐〡sondages, #🌹〡rose-griffon : 0 message Noctaly
 *       sur leur dernier lot de 100 → écartés sans pagination complète.
 *   Ces 3 derniers salons scannés en entier (#🤖〡bots, #🤪〡memes-inazuma,
 *   #🎈〡questions) ne contenaient QUE des embeds « Niveau supérieur » côté
 *   salons de discussion générale — aucun `/rank` ni `/leaderboard` en dehors
 *   de #🤖〡bots (logique : ce sont des commandes délibérées, tapées dans le
 *   salon dédié, alors que la montée de niveau est un sous-produit de la
 *   conversation normale, annoncée n'importe où). Chaque embed mentionne
 *   directement l'ID Discord du membre (`<@id>`) : aucune résolution par
 *   pseudo n'a donc été nécessaire pour ces 262 messages.
 *   Résolution pseudo → ID Discord réel (uniquement pour les captures
 *   `/rank`/`/leaderboard`, sans mention directe) : `GET /guilds/{id}/
 *   members/search`, confirmée par recoupement (date d'entrée sur le serveur
 *   cohérente avec le niveau observé, ou global_name+nick exact) — jamais un
 *   pseudo assigné sans recoupement. Un pseudo n'a PAS pu être résolu
 *   (caractères Unicode décoratifs non cherchables, aucun embed direct pour
 *   trancher) : cf. `MESURES_NON_RESOLUES` plus bas.
 *   ⚠ Piège trouvé et évité : deux comptes différents affichent un pseudo
 *   quasi identique, « IceCream » (831595693986021388, toujours sur le
 *   serveur, du top 10) et « Icecream » (403127934480809995, progression
 *   niveau 12→15 entre mars et mai 2026 dans #💬〡général). Le second répond
 *   `404 Unknown Member` à `GET /guilds/{id}/members/{id}` — il a quitté RG,
 *   ce qui explique aussi pourquoi `members/search` ne le trouvait pas lors du
 *   premier passage. Vérifié avant d'écrire quoi que ce soit : sans ce
 *   contrôle, l'XP des deux comptes aurait fusionné à tort sur un seul membre
 *   actuel. Les deux sont importés séparément (le second annoté « parti du
 *   serveur » dans son pseudo).
 *
 *   Piste 3 (endpoint public de noctaly.com) : le JS servi par la page
 *   `/leaderboard/<guild>` a été inspecté (tous les chunks `_next/static`
 *   téléchargés et grep'és) — aucun endpoint public distinct de l'API
 *   documentée n'y est visible en clair (les fetch trouvés sont soit le
 *   routeur RSC interne de Next.js, soit un wrapper générique dans le module
 *   de dashboard). Le seul endpoint concret trouvé est celui déjà documenté
 *   plus haut, `GET https://noctaly.com/api/v1/guilds/{id}/users/{id}/level-
 *   profile` — **testé en direct sans clé** : réponse `HTTP 401
 *   {"code":"unauthenticated","message":"You are not authenticated."}`.
 *   Confirme la conclusion de la passe 1 (empiriquement, pas seulement via
 *   le SDK). Aucun contournement tenté.
 *
 *   Fusion en base : `xp = GREATEST(bot_profils.xp, EXCLUDED.xp)` — une
 *   mesure ancienne retrouvée par ce scan ne doit jamais écraser une valeur
 *   plus fraîche déjà en base. `niveau` suit un `GREATEST` séparé sur la
 *   valeur déjà calculée par `niveauPour()` de chaque côté : correct car
 *   `niveauPour` est monotone non décroissante en XP (voir le commentaire de
 *   `importerHistorique`), donc le plus grand des deux niveaux correspond
 *   toujours à la plus grande des deux XP — pas besoin d'un `CASE` SQL.
 *
 *   Résultat de cette passe : 65 membres distincts couverts au total (contre
 *   10 après la passe 1), soit environ 3,4 % des ~1 902 membres de la guilde
 *   — le reste demeure hors de portée sans clé API humaine (cf. plus haut).
 *
 * ── UTILISATION ──────────────────────────────────────────────────────────
 *   bun apps/bot/src/scripts/import-xp-tiers.ts --essai   # top 10, rien écrit
 *   bun apps/bot/src/scripts/import-xp-tiers.ts            # top 10, écrit
 *   bun apps/bot/src/scripts/import-xp-tiers.ts --source=historique --essai
 *   bun apps/bot/src/scripts/import-xp-tiers.ts --source=historique
 *   Idempotent dans les deux modes : `ON CONFLICT (guild_id, discord_id) DO
 *   UPDATE` pour les profils (avec `GREATEST` en mode historique — jamais de
 *   downgrade), `ON CONFLICT (guild_id, niveau) DO UPDATE` pour les
 *   récompenses — relancer ce script ne duplique rien et ne rétrograde rien.
 */
import { RG_GUILD_ID } from "@rosegriffon/types/discord";

import { niveauPour } from "../lib/experience";
import { sql } from "../lib/db";

const GUILD_ID = RG_GUILD_ID;

interface EntreeClassement {
  /** Pseudo affiché sur la carte de classement Noctaly (source visuelle). */
  pseudo: string;
  /** Résolu réellement via GET /guilds/{id}/members/search?query=<pseudo>. */
  discordId: string;
  /** Niveau Noctaly affiché — non importé tel quel, gardé pour traçabilité. */
  niveauNoctaly: number;
  /** XP brute affichée par Noctaly, arrondie à la centaine ("44.4k" → 44400). */
  xp: number;
}

/**
 * TOP 10 du classement Noctaly du 9/8/2026 (message Discord
 * 1536045686259323010, salon #🤖〡bots, image
 * cdn.discordapp.com/attachments/1135698156835852369/1536045708740796489).
 * Lu visuellement sur l'image, chaque pseudo résolu en ID réel via l'API.
 */
const TOP10_NOCTALY: readonly EntreeClassement[] = [
  { pseudo: "Mioleen_", discordId: "435479810731409408", niveauNoctaly: 26, xp: 44_400 },
  { pseudo: "Ichigo Kurosaki", discordId: "593493079911170068", niveauNoctaly: 22, xp: 28_800 },
  { pseudo: "Inazo", discordId: "531549483067244566", niveauNoctaly: 18, xp: 15_900 },
  { pseudo: "IceCream", discordId: "831595693986021388", niveauNoctaly: 15, xp: 10_500 },
  { pseudo: "Rishar", discordId: "254337557272330241", niveauNoctaly: 14, xp: 9_200 },
  { pseudo: "Yoyo", discordId: "281114294152724491", niveauNoctaly: 14, xp: 8_700 },
  { pseudo: "Dash", discordId: "563787814483918858", niveauNoctaly: 13, xp: 7_800 },
  { pseudo: "ploufy !!", discordId: "987039164988030976", niveauNoctaly: 12, xp: 6_900 },
  { pseudo: "yuan yuan", discordId: "779044049374019594", niveauNoctaly: 12, xp: 6_000 },
  { pseudo: "Pegeto", discordId: "768526829279510529", niveauNoctaly: 11, xp: 5_500 },
] as const;

interface PalierRoleNoctaly {
  palierNoctaly: number;
  /** Colonne « Total XP » de noctaly.com/table pour ce palier. */
  xpNoctaly: number;
  /**
   * Rôle de la piste TEXTUELLE uniquement. La piste vocale (ex.
   * 1165331596170248192 pour ce palier) et le rôle « textuel ET vocal
   * niveau 60 » (1165335240403849337) sont abandonnés : la table
   * `bot_recompenses_niveau` a pour clé `(guild_id, niveau)`, un seul rôle
   * par niveau — voir le commentaire d'en-tête.
   */
  roleTextuel: string;
}

/** Les 4 paliers de rôles décrits dans #🎀〡rôles, piste textuelle seulement. */
const PALIERS_ROLES_NOCTALY: readonly PalierRoleNoctaly[] = [
  { palierNoctaly: 10, xpNoctaly: 4_025, roleTextuel: "1086256838137352242" },
  { palierNoctaly: 25, xpNoctaly: 36_625, roleTextuel: "1086257086591160340" },
  { palierNoctaly: 40, xpNoctaly: 131_100, roleTextuel: "1086618597578776708" },
  { palierNoctaly: 60, xpNoctaly: 411_650, roleTextuel: "1086619301714329720" },
] as const;

/** Comment la valeur d'XP d'une mesure historique a été obtenue. */
type Precision = "exacte" | "arrondie-centaine" | "seuil-officiel-palier";

interface MesureHistorique {
  pseudo: string;
  /** Résolu via GET /guilds/{id}/members/search, recoupé (dates/pseudo exact) — jamais deviné. */
  discordId: string;
  /** XP retenue pour ce membre — déjà la plus fraîche parmi tous ses sightings. */
  xp: number;
  /** Niveau Noctaly annoncé à ce moment (traçabilité seule, jamais écrit dans bot_profils.niveau). */
  niveauNoctaly: number;
  /** Horodatage ISO du message source le plus récent retenu. */
  mesureLe: string;
  precision: Precision;
  /** ID du message Discord source, pour audit. */
  sourceMessageId: string;
  /** Salon source. */
  sourceChannel: string;
}

/**
 * Chaque membre n'apparaît qu'une fois : quand plusieurs sightings existaient
 * (plusieurs `/leaderboard` au fil du temps, un `/rank` puis un
 * `/leaderboard` plus tard…), seul le plus RÉCENT est gardé ici — la
 * fusion « ne jamais rétrograder » est de toute façon refaite en SQL avec
 * `GREATEST` au cas où une valeur plus fraîche existe déjà en base depuis la
 * passe 1.
 */
const HISTORIQUE_NOCTALY: readonly MesureHistorique[] = [
  // 65 membres distincts, triés par XP décroissante. Sources : /leaderboard et /rank
  // de #🤖〡bots (arrondie-centaine ou exacte), embeds « Niveau supérieur » de
  // #🤖〡bots, #🤪〡memes-inazuma, #💬〡général, #📷〡médias, #🎨〡vos-fanarts
  // (seuil-officiel-palier — mention directe de l'ID, aucune résolution requise).
  // « Icecream (parti du serveur) » et « IceCream » (831595693986021388, déjà
  // dans le top 10) sont deux comptes DIFFÉRENTS malgré le pseudo quasi
  // identique : le premier répond 404 "Unknown Member" à l'API (a quitté RG),
  // vérifié avant import — sans cette vérification les deux XP auraient
  // fusionné à tort sur un seul membre.
  {
    pseudo: "Mioleen_",
    discordId: "435479810731409408",
    xp: 44400,
    niveauNoctaly: 26,
    mesureLe: "2026-08-09T16:17:09.953Z",
    precision: "arrondie-centaine",
    sourceMessageId: "1536045686259323010",
    sourceChannel: "#🤖〡bots",
  },
  {
    pseudo: "Ichigo Kurosaki",
    discordId: "593493079911170068",
    xp: 28800,
    niveauNoctaly: 22,
    mesureLe: "2026-08-09T16:17:09.953Z",
    precision: "arrondie-centaine",
    sourceMessageId: "1536045686259323010",
    sourceChannel: "#🤖〡bots",
  },
  {
    pseudo: "Inazo",
    discordId: "531549483067244566",
    xp: 15900,
    niveauNoctaly: 18,
    mesureLe: "2026-08-09T16:17:09.953Z",
    precision: "arrondie-centaine",
    sourceMessageId: "1536045686259323010",
    sourceChannel: "#🤖〡bots",
  },
  {
    pseudo: "IceCream",
    discordId: "831595693986021388",
    xp: 10500,
    niveauNoctaly: 15,
    mesureLe: "2026-08-09T16:17:09.953Z",
    precision: "arrondie-centaine",
    sourceMessageId: "1536045686259323010",
    sourceChannel: "#🤖〡bots",
  },
  {
    pseudo: "Icecream (parti du serveur)",
    discordId: "403127934480809995",
    xp: 10100,
    niveauNoctaly: 15,
    mesureLe: "2026-05-09T08:02:10.643000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1502581434689261579",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Rishar",
    discordId: "254337557272330241",
    xp: 9200,
    niveauNoctaly: 14,
    mesureLe: "2026-08-09T16:17:09.953Z",
    precision: "arrondie-centaine",
    sourceMessageId: "1536045686259323010",
    sourceChannel: "#🤖〡bots",
  },
  {
    pseudo: "Yoyo",
    discordId: "281114294152724491",
    xp: 8700,
    niveauNoctaly: 14,
    mesureLe: "2026-08-09T16:17:09.953Z",
    precision: "arrondie-centaine",
    sourceMessageId: "1536045686259323010",
    sourceChannel: "#🤖〡bots",
  },
  {
    pseudo: "Dash",
    discordId: "563787814483918858",
    xp: 7800,
    niveauNoctaly: 13,
    mesureLe: "2026-08-09T16:17:09.953Z",
    precision: "arrondie-centaine",
    sourceMessageId: "1536045686259323010",
    sourceChannel: "#🤖〡bots",
  },
  {
    pseudo: "ploufy !!",
    discordId: "987039164988030976",
    xp: 6900,
    niveauNoctaly: 12,
    mesureLe: "2026-08-09T16:17:09.953Z",
    precision: "arrondie-centaine",
    sourceMessageId: "1536045686259323010",
    sourceChannel: "#🤖〡bots",
  },
  {
    pseudo: "yuan yuan",
    discordId: "779044049374019594",
    xp: 6000,
    niveauNoctaly: 12,
    mesureLe: "2026-08-09T16:17:09.953Z",
    precision: "arrondie-centaine",
    sourceMessageId: "1536045686259323010",
    sourceChannel: "#🤖〡bots",
  },
  {
    pseudo: "Pegeto",
    discordId: "768526829279510529",
    xp: 5500,
    niveauNoctaly: 11,
    mesureLe: "2026-08-09T16:17:09.953Z",
    precision: "arrondie-centaine",
    sourceMessageId: "1536045686259323010",
    sourceChannel: "#🤖〡bots",
  },
  {
    pseudo: "Kokoro",
    discordId: "1237047037435056281",
    xp: 4025,
    niveauNoctaly: 10,
    mesureLe: "2026-04-17T10:27:24.858000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1494645451713155102",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "dee ✮⋆˙☆",
    discordId: "504630658463694848",
    xp: 3225,
    niveauNoctaly: 9,
    mesureLe: "2026-08-09T19:20:34.897000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1536091844339957841",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Illu",
    discordId: "672528206565474346",
    xp: 3225,
    niveauNoctaly: 9,
    mesureLe: "2026-05-13T19:30:50.514000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1504204294252138567",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Keirakira",
    discordId: "215800314094157824",
    xp: 2540,
    niveauNoctaly: 8,
    mesureLe: "2026-08-09T12:37:43.151000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1535990460689154058",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Dleez",
    discordId: "165739958928146432",
    xp: 2540,
    niveauNoctaly: 8,
    mesureLe: "2026-07-10T19:30:33.469000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1525222718965026967",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Hassane",
    discordId: "411591320147066881",
    xp: 2540,
    niveauNoctaly: 8,
    mesureLe: "2026-06-02T17:44:57.687000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1511425405876310077",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "every end…",
    discordId: "817549867072356352",
    xp: 2540,
    niveauNoctaly: 8,
    mesureLe: "2026-04-15T20:28:52.689000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1494072039315869806",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "mimi",
    discordId: "690108029387014147",
    xp: 2540,
    niveauNoctaly: 8,
    mesureLe: "2026-03-19T17:23:25.273000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1484240895178964993",
    sourceChannel: "#📷〡médias",
  },
  {
    pseudo: "✧˚Karu˚✧",
    discordId: "198209347589898240",
    xp: 1960,
    niveauNoctaly: 7,
    mesureLe: "2026-08-01T23:17:17.918000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1533252313202823209",
    sourceChannel: "#📷〡médias",
  },
  {
    pseudo: "IshakShyGuy",
    discordId: "1381331001724108892",
    xp: 1960,
    niveauNoctaly: 7,
    mesureLe: "2026-06-04T16:52:06.094000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1512136878982430832",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "𝐇𝐚𝐭𝐜𝐡𝐢𝐧",
    discordId: "874819138323877908",
    xp: 1960,
    niveauNoctaly: 7,
    mesureLe: "2026-05-29T17:23:26.939000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1509970440624537670",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Kanawaki",
    discordId: "607845344780222494",
    xp: 1075,
    niveauNoctaly: 5,
    mesureLe: "2026-07-09T10:20:49.253000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1524721985270059089",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Cieran/FujoRin || COMMS CLOSED",
    discordId: "309031721016229890",
    xp: 1075,
    niveauNoctaly: 5,
    mesureLe: "2026-06-24T12:05:48.544000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1519312588427755561",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "El Titi",
    discordId: "466308871926054932",
    xp: 1075,
    niveauNoctaly: 5,
    mesureLe: "2026-05-31T20:27:46.123000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1510741601935298672",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Aerithia 🪻",
    discordId: "457650485315371020",
    xp: 1075,
    niveauNoctaly: 5,
    mesureLe: "2026-05-31T18:34:05.186000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1510712992851951616",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Sanada",
    discordId: "908269053347504170",
    xp: 1075,
    niveauNoctaly: 5,
    mesureLe: "2026-05-21T17:14:49.702000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1507069168250392686",
    sourceChannel: "#🎨〡vos-fanarts",
  },
  {
    pseudo: "ETHAN",
    discordId: "330968901867274240",
    xp: 750,
    niveauNoctaly: 4,
    mesureLe: "2026-07-24T14:32:55.434000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1530221247055794217",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "kittycaillou",
    discordId: "683044704967065626",
    xp: 750,
    niveauNoctaly: 4,
    mesureLe: "2026-05-08T23:27:49.306000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1502451992860164136",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "𝑲𝒂𝒆𝒏 🔥",
    discordId: "332288456686305281",
    xp: 750,
    niveauNoctaly: 4,
    mesureLe: "2026-03-30T21:38:03.439000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1488291242973466814",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "slosh",
    discordId: "554311681094975509",
    xp: 750,
    niveauNoctaly: 4,
    mesureLe: "2026-03-29T21:21:21.823000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1487924654025740379",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Kinun",
    discordId: "869633392814206977",
    xp: 490,
    niveauNoctaly: 3,
    mesureLe: "2026-08-07T17:47:36.982000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1535343673137430650",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Suumash",
    discordId: "1107734851085402206",
    xp: 490,
    niveauNoctaly: 3,
    mesureLe: "2026-05-29T13:16:16.320000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1509908236499816579",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Silva",
    discordId: "388714887498432512",
    xp: 490,
    niveauNoctaly: 3,
    mesureLe: "2026-03-18T18:01:45.294000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1483888154300780615",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Ruvi",
    discordId: "776818507974574111",
    xp: 490,
    niveauNoctaly: 3,
    mesureLe: "2026-03-14T12:56:43.964000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1482361841496887411",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Jenn Scarlet",
    discordId: "469900328758935552",
    xp: 490,
    niveauNoctaly: 3,
    mesureLe: "2026-06-24T14:44:26.470000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1519352509502853221",
    sourceChannel: "#🎨〡vos-fanarts",
  },
  {
    pseudo: "⋆ℳ@∃Ꮁ⋆",
    discordId: "724348833076740157",
    xp: 490,
    niveauNoctaly: 3,
    mesureLe: "2026-04-25T20:13:17.467000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1497691995366232248",
    sourceChannel: "#🎨〡vos-fanarts",
  },
  {
    pseudo: "COLZA",
    discordId: "371727859800080395",
    xp: 285,
    niveauNoctaly: 2,
    mesureLe: "2026-08-01T16:29:51.033000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1533149775535538286",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Abdel BMA",
    discordId: "1462508632993431724",
    xp: 285,
    niveauNoctaly: 2,
    mesureLe: "2026-07-13T07:39:42.037000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1526130989489721435",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "RozenB",
    discordId: "366883009426882582",
    xp: 285,
    niveauNoctaly: 2,
    mesureLe: "2026-07-11T18:09:37.072000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1525564737625002214",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "👑Skipper",
    discordId: "1039860340705480745",
    xp: 285,
    niveauNoctaly: 2,
    mesureLe: "2026-05-21T13:18:23.623000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1507009667522367631",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Binou",
    discordId: "1248351062277226518",
    xp: 285,
    niveauNoctaly: 2,
    mesureLe: "2026-04-21T19:11:28.469000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1496226887238811770",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Link Soleil",
    discordId: "437671719776550934",
    xp: 285,
    niveauNoctaly: 2,
    mesureLe: "2026-04-15T20:28:03.377000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1494071832486088775",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Kitsu",
    discordId: "747080080550789150",
    xp: 285,
    niveauNoctaly: 2,
    mesureLe: "2026-04-02T17:25:39.772000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1489314889427062944",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Tategami 👑",
    discordId: "239380696886411265",
    xp: 285,
    niveauNoctaly: 2,
    mesureLe: "2026-03-31T23:51:04.056000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1488687103972741182",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Masamune Kadoya",
    discordId: "1244715598102138970",
    xp: 180,
    niveauNoctaly: 1,
    mesureLe: "2026-03-14T03:47:24.860Z",
    precision: "exacte",
    sourceMessageId: "1482223600994881669",
    sourceChannel: "#🤖〡bots",
  },
  {
    pseudo: "Kuri",
    discordId: "1499191424732627076",
    xp: 125,
    niveauNoctaly: 1,
    mesureLe: "2026-08-07T18:49:14.959000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1535359183577153567",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Epic",
    discordId: "424975271683293184",
    xp: 125,
    niveauNoctaly: 1,
    mesureLe: "2026-08-06T20:43:48.983000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1535025627457916939",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Vincent(Thebutcher)",
    discordId: "565975991210737675",
    xp: 125,
    niveauNoctaly: 1,
    mesureLe: "2026-07-02T21:47:17.166000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1522358024839233790",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "El pibe de oro",
    discordId: "737011881637707865",
    xp: 125,
    niveauNoctaly: 1,
    mesureLe: "2026-06-24T14:56:40.341000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1519355587580792965",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "✧ 𝕾𝖔𝖗𝖆 ✧",
    discordId: "1202674352999501947",
    xp: 125,
    niveauNoctaly: 1,
    mesureLe: "2026-05-18T20:28:49.679000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1506030826255548568",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Bri",
    discordId: "1201870697463545917",
    xp: 125,
    niveauNoctaly: 1,
    mesureLe: "2026-05-11T22:34:51.088000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1503525826044629163",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Jojo Kirino",
    discordId: "274820033014661121",
    xp: 125,
    niveauNoctaly: 1,
    mesureLe: "2026-05-11T22:29:35.294000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1503524501508591616",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "soledad",
    discordId: "841341826618884103",
    xp: 125,
    niveauNoctaly: 1,
    mesureLe: "2026-05-09T08:24:46.338000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1502587120886480897",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "fentotomy",
    discordId: "904364583383367710",
    xp: 125,
    niveauNoctaly: 1,
    mesureLe: "2026-05-01T15:28:00.027000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1499794526812897423",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Frankos LeBeau",
    discordId: "1408861090212745371",
    xp: 125,
    niveauNoctaly: 1,
    mesureLe: "2026-04-12T20:22:31.609000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1492983277353439282",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Sofiane 4⚽❄",
    discordId: "1097785928342319155",
    xp: 125,
    niveauNoctaly: 1,
    mesureLe: "2026-04-10T12:40:06.860000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1492142131710525461",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Paimy",
    discordId: "410892709264621568",
    xp: 125,
    niveauNoctaly: 1,
    mesureLe: "2026-04-04T12:54:42.502000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1489971477225672856",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "✝🌪",
    discordId: "1433177208075190395",
    xp: 125,
    niveauNoctaly: 1,
    mesureLe: "2026-04-02T14:14:33.461000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1489266796233228372",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Nxzo",
    discordId: "515928091382775820",
    xp: 125,
    niveauNoctaly: 1,
    mesureLe: "2026-03-31T23:44:15.907000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1488685392071888987",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Michou 🧀",
    discordId: "1424828785731174452",
    xp: 125,
    niveauNoctaly: 1,
    mesureLe: "2026-03-14T02:50:36.948000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1482209307176079482",
    sourceChannel: "#💬〡général",
  },
  {
    pseudo: "Neoverse",
    discordId: "644512674692202504",
    xp: 125,
    niveauNoctaly: 1,
    mesureLe: "2026-05-26T21:35:05.447000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1508946604760105102",
    sourceChannel: "#📷〡médias",
  },
  {
    pseudo: "Yuki ★",
    discordId: "264765469716774912",
    xp: 125,
    niveauNoctaly: 1,
    mesureLe: "2026-03-17T22:13:35.680000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1483589143987753113",
    sourceChannel: "#📷〡médias",
  },
  {
    pseudo: "JoJoNA",
    discordId: "1536431102523342998",
    xp: 125,
    niveauNoctaly: 1,
    mesureLe: "2026-08-13T22:06:13.113000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1537583079701618760",
    sourceChannel: "#🎨〡vos-fanarts",
  },
  {
    pseudo: "Vind",
    discordId: "690138166136668211",
    xp: 125,
    niveauNoctaly: 1,
    mesureLe: "2026-08-06T20:38:30.339000+00:00",
    precision: "seuil-officiel-palier",
    sourceMessageId: "1535024290968244368",
    sourceChannel: "#🎨〡vos-fanarts",
  },
] as const;

/**
 * Pseudos rencontrés dans l'historique mais volontairement NON importés :
 * aucun ID Discord fiable n'a pu leur être assigné (zéro invention plutôt
 * qu'un mauvais compte crédité de l'XP d'un autre). Le doute sur « mimi »
 * (3 comptes candidats au même pseudo lors du premier passage) a depuis été
 * levé par un embed « Niveau supérieur » qui la mentionne directement dans
 * #📷〡médias — elle est donc dans `HISTORIQUE_NOCTALY`, plus ici.
 */
const MESURES_NON_RESOLUES: ReadonlyArray<{ pseudo: string; raison: string }> = [
  {
    pseudo: "⼁M@∃⼁⼁",
    raison:
      "Pseudo à caractères Unicode décoratifs (bloc de présentation) rencontré uniquement sur une image de /leaderboard (11/3/2026) — non cherchable de façon fiable via members/search, et aucun embed de montée de niveau ne l'a mentionné directement pour lever le doute (contrairement à mimi).",
  },
] as const;

const essai = Bun.argv.includes("--essai");
const sourceHistorique = Bun.argv.includes("--source=historique");

function ligne(discordId: string, xp: number): { discordId: string; xp: number; niveau: number } {
  return { discordId, xp, niveau: niveauPour(xp) };
}

async function importerProfils(): Promise<number> {
  let ecrites = 0;
  for (const entree of TOP10_NOCTALY) {
    const { discordId, xp, niveau } = ligne(entree.discordId, entree.xp);
    console.log(
      `  ${entree.pseudo.padEnd(20)} niveau Noctaly ${String(entree.niveauNoctaly).padStart(3)} · ` +
        `xp ${String(xp).padStart(6)} → niveau jeu ${niveau}`,
    );
    if (!essai) {
      await sql`
				INSERT INTO bot_profils (guild_id, discord_id, xp, niveau, maj_le)
				VALUES (${GUILD_ID}, ${discordId}, ${xp}, ${niveau}, now())
				ON CONFLICT (guild_id, discord_id) DO UPDATE SET
					xp = EXCLUDED.xp,
					niveau = EXCLUDED.niveau,
					maj_le = now()
			`;
    }
    ecrites++;
  }
  return ecrites;
}

/**
 * Passe `--source=historique` : fusionne chaque mesure retrouvée dans
 * l'historique des salons, sans jamais rétrograder une valeur plus fraîche
 * déjà en base. `GREATEST` sur `xp` ET sur `niveau` donne un résultat
 * cohérent car `niveauPour` est monotone non décroissante en XP : le niveau
 * le plus élevé des deux correspond toujours à l'XP la plus élevée des deux.
 */
async function importerHistorique(): Promise<number> {
  let ecrites = 0;
  for (const mesure of HISTORIQUE_NOCTALY) {
    const niveau = niveauPour(mesure.xp);
    console.log(
      `  ${mesure.pseudo.padEnd(32)} xp ${String(mesure.xp).padStart(6)} (${mesure.precision}) ` +
        `→ niveau jeu ${niveau} · mesuré le ${mesure.mesureLe.slice(0, 10)} (${mesure.sourceChannel})`,
    );
    if (!essai) {
      await sql`
				INSERT INTO bot_profils (guild_id, discord_id, xp, niveau, maj_le)
				VALUES (${GUILD_ID}, ${mesure.discordId}, ${mesure.xp}, ${niveau}, now())
				ON CONFLICT (guild_id, discord_id) DO UPDATE SET
					xp = GREATEST(bot_profils.xp, EXCLUDED.xp),
					niveau = GREATEST(bot_profils.niveau, EXCLUDED.niveau),
					maj_le = now()
			`;
    }
    ecrites++;
  }
  if (MESURES_NON_RESOLUES.length > 0) {
    console.log("\nNon résolus (aucun ID fiable, aucune écriture) :");
    for (const m of MESURES_NON_RESOLUES) console.log(`  ${m.pseudo} — ${m.raison}`);
  }
  return ecrites;
}

async function importerRecompenses(): Promise<number> {
  let ecrites = 0;
  for (const palier of PALIERS_ROLES_NOCTALY) {
    const niveau = niveauPour(palier.xpNoctaly);
    console.log(
      `  palier Noctaly ${String(palier.palierNoctaly).padStart(2)} (${palier.xpNoctaly} xp) → niveau jeu ${niveau} ` +
        `· rôle textuel ${palier.roleTextuel}`,
    );
    if (!essai) {
      await sql`
				INSERT INTO bot_recompenses_niveau (guild_id, niveau, role_id, cumulable)
				VALUES (${GUILD_ID}, ${niveau}, ${palier.roleTextuel}, false)
				ON CONFLICT (guild_id, niveau) DO UPDATE SET
					role_id = EXCLUDED.role_id,
					cumulable = EXCLUDED.cumulable
			`;
    }
    ecrites++;
  }
  return ecrites;
}

console.log(
  `=== Import XP tiers (Noctaly → bot_profils) ${sourceHistorique ? "[source=historique] " : "[source=top10] "}` +
    `${essai ? "[--essai, rien n'est écrit]" : ""} ===\n`,
);

console.log(sourceHistorique ? "Profils (fusion de l'historique complet) :" : "Profils (top 10 du 9/8/2026) :");
const profilsEcrits = sourceHistorique ? await importerHistorique() : await importerProfils();

console.log("\nRécompenses de rôle par palier :");
const recompensesEcrites = await importerRecompenses();

console.log(`\n${essai ? "Simulerait" : "A écrit"} ${profilsEcrits} profil(s) et ${recompensesEcrites} récompense(s).`);

if (!essai) {
  const [stats] = await sql<Array<{ total: number; xp_max: number; niveau_max: number }>>`
		SELECT count(*)::int AS total, max(xp)::int AS xp_max, max(niveau)::int AS niveau_max
		FROM bot_profils WHERE guild_id = ${GUILD_ID}
	`;
  console.log(
    `Vérification bot_profils(guild_id=${GUILD_ID}) : total=${stats?.total} max(xp)=${stats?.xp_max} max(niveau)=${stats?.niveau_max}`,
  );
}

process.exit(0);
