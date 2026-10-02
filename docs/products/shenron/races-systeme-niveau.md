# Races & système de niveau — référence factuelle Xenoverse 2

> **Source** : données extraites du jeu **Dragon Ball Xenoverse 2** (Steam 454650,
> v1.25.02.0) via le toolkit `dbxv2`. Tous les chiffres et libellés ci-dessous sont
> tirés des fichiers du jeu (cités en §6), pas d'estimations. Les descriptions de races
> sont le **verbatim français** de l'écran de création de personnage
> (`data1/data/msg/tribeselect_text_fr.msg`).
>
> Objet : servir de **base factuelle** au système de races/niveaux de Shenron
> (transposition en §7). Le membre choisit une race qui module sa progression, façon XV2.

---

## 1. Les 5 races jouables (CaC)

À la création, le joueur (un « Patrouilleur du temps ») choisit **une race** parmi 5,
avec un **sexe** (Masculin/Féminin) sauf Namek et Race de Freezer (masculin uniquement
dans le jeu). Libellés exacts (`tribeselect_text_fr`, idx 141-145) :

|   # | Race (FR)           | Sexes | Description courte (verbatim jeu)                                           |
| --: | ------------------- | ----- | --------------------------------------------------------------------------- |
|   1 | **Terrien**         | M / F | « Stats équilibrées en attaque et en défense. »                             |
|   2 | **Saiyen**          | M / F | « Tribu de guerriers : santé faible mais attaques puissantes. »             |
|   3 | **Race de Freezer** | M     | « Vitesse élevée, mais santé faible. »                                      |
|   4 | **Namek**           | M     | « Attaque faible mais santé élevée et récupération rapide de l'endurance. » |
|   5 | **Majin**           | M / F | « Défense augmentée si endurance max. Stats variables selon sexe. »         |

### Traits innés par race (verbatim de l'écran de sélection)

- **Terrien** — _« Stats équilibrées en attaque et en défense. »_ +
  _« Ki automatiquement récupéré et attaques plus puissantes si au niv. max. »_ +
  _« Objets plus efficaces que les autres races et santé restaurée. »_
  → polyvalent ; **récup de Ki automatique**, bonus au **Ki max**, et **objets de soin plus efficaces**.

- **Saiyen** — _« Une tribu de guerriers qui possède une très grande force, mais peu de santé. »_ +
  _« Attaques plus puissantes si santé faible. Stats augmentées après réanimation. »_
  → glass cannon ; **Zenkai** : dégâts ↑ à basse santé et **boost de stats après une réanimation**.

- **Race de Freezer** — _« Une race fragile qui domine ses ennemis grâce à sa grande vitesse. »_ +
  _« Récupération de l'endurance pendant l'attaque. Vitesse augmentée si santé faible. »_
  → rapide et fragile ; **endurance qui remonte en attaquant**, **vitesse ↑ à basse santé**.

- **Namek** — _« Attaque faible mais santé élevée et récupération rapide de l'endurance. »_
  → tank régénérant ; grosse santé, **endurance qui revient vite**, attaque faible.

- **Majin** — _« Défense élevée mais récupération lente de l'endurance. »_ +
  _« Défense augmentée si endurance max. Stats variables selon sexe. »_
  → défensif, **stats fortement dépendantes du sexe** (voir §2).

> Note jeu : en **version Lite**, _Saiyen (H/F)_ et _Race de Freezer_ sont indisponibles
> (`tribeselect_text_fr` idx 189-193).

---

## 2. Modificateurs de sexe (Masculin / Féminin)

Règle générale (verbatim, `tribeselect_text_fr` idx 232-239) :

> « Les personnages **masculins** disposent d'attaques normales plus puissantes et de
> buffs qui durent plus longtemps. Leurs techniques spéciales sont légèrement plus
> faibles. Les personnages **féminins** ont une jauge de Ki et une jauge d'endurance qui
> se remplit plus rapidement, mais une santé moins importante. »

Variantes spécifiques **Majin** (idx 176-177) :

- **Majin Masculin** : _« santé élevée et peu de dégâts subis tant que l'endurance est élevée. »_
- **Majin Féminin** : _« santé plus faible, mais temps de récupération plus élevé permettant d'éviter les attaques critiques. »_

---

## 3. Les 6 statistiques

Libellés exacts (`data1/data/msg/customize_status_text_fr.msg`, idx 129-133 + ki) :

| Code radar | Stat (FR)            | Effet (verbatim)                                                                       |
| ---------- | -------------------- | -------------------------------------------------------------------------------------- |
| HEA        | **Santé**            | « Augmenter la santé maximum. »                                                        |
| KI         | **Ki**               | « Augmenter le ki maximum. »                                                           |
| STM        | **Endurance**        | « Augmenter l'endurance maximum. »                                                     |
| ATK        | **Attaques de base** | « Augmenter la puissance des attaques normales et des Kikohas. »                       |
| STR        | **Super frappes**    | « Augmenter la puissance des attaques spéciales, ultimes et compétences d'évolution. » |
| BLA        | **Super Kikohas**    | « Augmenter la puissance des super attaques de Ki. »                                   |

> Le diagramme radar du menu d'état affiche ces 6 axes (cf. `DESIGN.md` du toolkit dbxv2).
> 49 descriptions de **tendances de stats** (QQ Bang / équipement) existent dans le même
> fichier (idx 211-259) — ex. _« Endurance élevée. Privilégie la puissance des attaques
> normales, réduit les autres capacités. »_

### Style de combat de départ (`tribeselect_text_fr` idx 182-184)

À la création, choix d'un préréglage de stats initiales :

- **Équilibré** — « bon équilibre entre Kikohas et techniques de frappe »
- **Frappe** — « penchant pour les frappes »
- **Kikoha** — « penchant pour les Kikohas »

---

## 4. Système de niveau & expérience

### 4.1 Niveau maximum

**Niveau max = 180.** Preuve factuelle dans la table d'EXP
(`system/avatar_growth_data.agd`) : l'EXP requise pour le niveau suivant
(`exp_to_next`) reste **non nulle jusqu'au niveau 180**, puis **tombe à 0 à partir du
niveau 181** ; l'EXP cumulée se fige alors à **481 199 100** (le total est atteint, plus
aucune progression possible). La table de coûts `CharacterLevelupPriceList.clv` contient
d'ailleurs exactement **180 entrées** (niveaux 1→180).

La courbe a **deux ruptures de pente** internes (pas des caps) : un pic vers le niveau 98
(43,75 M pour un seul niveau) suivi d'une réinitialisation à 500 k au niveau 99, puis une
remontée jusqu'au cap. C'est cette rupture qui pouvait faire croire à tort à un cap à 99.

### 4.2 Courbe d'EXP (`avatar_growth_data.agd`, verbatim)

|  Niveau | EXP → niveau suivant | EXP cumulée pour l'atteindre |
| ------: | -------------------: | ---------------------------: |
|       1 |                  100 |                            0 |
|      10 |                1 450 |                        6 300 |
|      50 |               22 450 |                      398 800 |
|      80 |               53 950 |                    1 499 050 |
|      90 |            5 503 950 |                   17 788 550 |
|      98 |           43 753 950 |                  127 570 150 |
|      99 |              500 000 |                  171 324 100 |
|     150 |            4 250 000 |                  328 149 100 |
|     179 |            8 150 000 |                  471 049 100 |
| **180** |            2 000 000 |              **479 199 100** |
|    181+ |      0 (cap atteint) |                  481 199 100 |

→ atteindre le **niveau 180 demande ≈ 479,2 millions d'EXP cumulés** ; le total absolu de
la table se fige à **481 199 100**. Le gros du grind est sur les tranches 90-98 puis
150-180.

### 4.3 Coûts de niveau (`system/CharacterLevelupPriceList.clv`)

Table de **180 entrées** (= le niveau max). Les coûts en jeu sont définis **jusqu'au
niveau 80** (héritage du cap d'origine), puis la valeur passe à la sentinelle
`0xFFFFFFFF` (−1) du niveau 81 au niveau 180. Ex. : niv 50 → 12 500, niv 80 → 250 000.

### 4.4 Monnaie de déblocage : médailles PT / SPT

La création/personnalisation consomme des **médailles PT** (et **SPT**) pour débloquer
options et apparences (`tribeselect_text_fr` idx 240-242, 256-262) — ex. changer
tête/cheveux = **10 médailles PT**.

---

## 5. Tables de paramètres avatar (croissance par niveau)

Les valeurs de stats par niveau/race vivent dans des binaires `system/*` propriétaires
(format `#XXX` + marqueur `FE FF` + count) **non gérés par pyxenoverse** :

| Fichier                                | Contenu                                                       |
| -------------------------------------- | ------------------------------------------------------------- |
| `system/level_character_parameter.lcp` | 199 entrées × 34 champs — paramètres de perso par niveau      |
| `system/parameter_spec_avater.psa`     | 200 entrées × 8 floats — spec de croissance de l'avatar (CaC) |
| `system/parameter_spec_char.psc`       | spec des personnages du roster (184 Ko)                       |
| `system/powerup_parameter.pup`         | 72 entrées — paramètres d'investissement de stats             |
| `system/avatar_growth_data.agd`        | table d'EXP (§4.2)                                            |

> Le détail numérique exact des multiplicateurs par race n'a pas été décodé champ-par-champ
> (format binaire non documenté) ; les **traits qualitatifs** du §1 proviennent du texte
> in-game, qui fait foi côté joueur.

---

## 6. Provenance des données (fichiers du jeu)

| Donnée                                                        | Fichier extrait (`output/cpk/...`)                                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Noms & traits des races, sexes, style de combat, médailles PT | `data1/data/msg/tribeselect_text_fr.msg(.json)`                                                      |
| Noms des 6 stats + tendances QQ Bang                          | `data1/data/msg/customize_status_text_fr.msg(.json)`                                                 |
| Table d'EXP, niveau max                                       | `data/data/system/avatar_growth_data.agd`                                                            |
| Coûts de niveau                                               | `data/data/system/CharacterLevelupPriceList.clv`                                                     |
| Croissance des paramètres avatar                              | `data/data/system/{level_character_parameter.lcp, parameter_spec_avater.psa, powerup_parameter.pup}` |
| Tutoriels / aide                                              | `data1/data/msg/{tutorial_text_fr, lobby_tutorial_text_fr}.msg(.json)`                               |

---

## 7. Transposition Shenron — ✅ IMPLÉMENTÉE (Phase 1)

On **transpose les traits réels XV2 sur les leviers du bot** (XP, vocal, zéni, jeux) — pas
un moteur de combat. Le membre choisit sa race via **`/race`** (ou le menu de rôles
Discord) ; elle est posée comme rôle de race exclusif et module sa progression.

Les **6 races** correspondent aux **rôles Discord** du serveur (exclusifs) :

| Race (rôle serveur) | Inspiration XV2                        | Effet implémenté                                                                  |
| ------------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| **Saiyan**          | Saiyen : guerrier né, Zenkai           | **×1,25 XP** (chat+vocal) + **Zenkai** : +50 % XP pendant 1 h après chaque palier |
| **Humain**          | Terrien : équilibré, objets +efficaces | **+25 % zéni** sur tous les gains (daily, drops, jeux, paliers)                   |
| **Namek**           | Santé élevée, régén, patience          | **×1,1 XP** + **régén passive** : +200 XP & +200 zéni à la 1re activité du jour   |
| **Mutant**          | Puissance brute et instable            | **×1,4 XP en chat** (montée régulière à l'écrit)                                  |
| **Cyborg**          | Machine infatigable/efficace           | **×1,4 XP en vocal** (récompense la présence vocale)                              |
| **Majin**           | Défensif, joueur imprévisible          | **+50 % zéni aux mini-jeux** (pfc/morpion/pendu/bingo)                            |

Choisir une race **pose le rôle Discord exclusif** correspondant (et retire les autres). Les
IDs de rôles sont dans `RACES[].roleId` (`lib/races.ts`). Le rôle **Saiyan** n'est **plus**
distribué automatiquement (c'était un auto-rôle posé à tout le monde) — c'est désormais un
choix de race.

### Implémentation (fichiers)

- **Catalogue + logique pure** (testée) : `apps/bot/src/lib/races.ts` (`tests/races.test.ts`).
- **Commande** : `apps/bot/src/commands/race/Race.ts` (`/race` — embed + boutons, persona `kaio`).
- **Schéma** : `users.race` / `race_chosen_at` / `race_boost_until` (Zenkai) / `last_race_regen_at`
  (migration `0013`).
- **Application des perks** : XP → `events/MessageXP.ts` + `events/VoiceXP.ts` ; zéni paliers +
  Zenkai → `services/LevelService.ts` ; zéni général/jeux → `services/EconomyService.ts`
  (`addZeni(..., { kind: "game" })`).

> Source de vérité runtime = `apps/bot/data/bot.db` (SQLite, forward-sync Neon). Ne **pas**
> écrire la progression dans le wiki éditorial (`wiki-write-guard`). Les valeurs sont des
> points de départ équilibrables (cf. `lib/races.ts`).

### Phase 2 — rôles de palier PAR RACE — ✅ infra en place

- **Échelles de transformations par race** : `apps/bot/src/lib/race-levels.ts`
  (`RACE_LEVEL_ROLES`, module pur testé `tests/race-levels.test.ts`). Chaque race a sa
  propre suite de rôles de palier (niveaux 1..10). **Saiyan** est peuplée (Kaioken → UI
  Parfait, source unique réutilisée par `seed-level-rewards.ts`) ; les **autres races
  sont vides** → à compléter avec les rôles Discord créés côté serveur.
- **Nettoyage au changement de race** : `LevelService.syncRaceLevelRoles(member)` retire
  les paliers des autres races et (re)pose ceux de la race courante jusqu'au niveau. Appelé
  par `/race` (kaio) **et** par `guildMemberUpdate` (grandPretre) quand un rôle de race est
  posé/retiré à la main. Le niveau suit l'XP (jamais re-dérivé des rôles).
- `level_rewards` reste la table **race-agnostique** des paliers (zéni, seuil XP, bannière) ;
  seuls les **rôles** de transformation sont par race.

### Phases suivantes (roadmap)

- **Peupler les échelles non-Saiyan** dans `RACE_LEVEL_ROLES` (Namek, Mutant, Cyborg,
  Majin, Humain) une fois les rôles Discord créés. Cooldown/coût de changement de race,
  intégration carte de profil (`CardService`).
- **Phase 3 — stats & combat** (optionnel) : vraies stats HP/Ki à la XV2 si un mode combat
  est introduit.
