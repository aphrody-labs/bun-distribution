# Couverture des données de jeu IEVR — matrice maître (objectif `/goal`)

> Objectif : **indexer, mapper, typer, analyser, extraire et peupler en DB proprement** TOUTE la donnée du jeu
> (items, teams, uniformes, passifs, skills, auras, emblèmes, telop/video waza, textures & modèles chr,
> drop-rates par élément, shops, tous les cfg.bin, tous les lua, tout le code C).
> Ancré au réel : `~/nie/data/common/gamedata/**` (sources), `packages/inagle/src/parsers/**` (66 parseurs),
> `packages/inagle/src/cli-push.ts` (not in repo) (push Supabase), tables `inagle_*` Supabase. **Aucune valeur inventée.**

## Sources réelles

- **19 371** `*.cfg.bin.json` sous `~/nie/data` (dont ~16k `ev*`/`Subtitle_ev*` = scripts d'événements/cutscenes).
- **common/gamedata/** organisé par catégorie : `item shop capsule formation party command soccer skill skill_view
  character chara_bank uniform craft boost_grp quest mission dungeon movie motion live2d banner gallery formation …`
- **677** scripts Lua (`~/nie/data/lua_scripts/{decompiled,analysis}`, classés `p0-critical/p1-gameplay/p2-other`).
- **Code C** : `nie.exe` reversé par **niers** (52 783 fonctions réelles, 92,43 % classifiées — repo séparé `~/nie`).
- **Assets binaires** (textures/modèles) : g4tx/g4mg/g4md/g4sk dans les CPK — traités côté **iecode** (embed g4tx→GLB fait).

## Matrice de couverture (catégorie → source → parseur inagle → table DB → statut)

| Catégorie | Config source | Parseur inagle | Table `inagle_*` | Statut |
| --- | --- | --- | --- | --- |
| Personnages | `chara_param`, `chara_base`, … | chara-param, chara-base… | `inagle_characters` | **FAIT** |
| Skills (techniques) | `skill_config` | skill-config, real-skill-config | `inagle_skills` | **FAIT** |
| Auras | `aura_skill_config` | change-aura-skill-config | `inagle_auras` | **FAIT** |
| Passifs | `passive_skill_config(+effect)` | passive-skill-(effect-)config | `inagle_passives` | **FAIT** |
| Items | `item_config` | item-config | `inagle_items` | **FAIT** |
| Formations | `rpg_battle_formation_config` | formation-config | `inagle_formations` | **FAIT** |
| Teams | `team_*` | belong-team, opponent-team | `inagle_teams`,`inagle_opponent_teams` | **FAIT** |
| Capsules (gacha) | `capsule_config` | capsule-config | `inagle_capsules` | **FAIT** |
| Drops | `soccer_drop_config`, treasure | SQL projection / service | `inagle_drops` | **FAIT** |
| EXP / Growth | `chara_exp_table`, growth | chara-exp-table, growth-table | `inagle_exp_table`,`inagle_growth_tables` | **FAIT** |
| Keshin/Soul/Miximax/Awakening | divers | playstyle, star-sign… | `inagle_keshins/souls/miximax/awakenings` | **FAIT** |
| Costumes / Gallery / Quests / Mode-changes | divers | chara-costume, gallery, quest… | `inagle_costumes/gallery/quests/mode_changes` | **FAIT** |
| **Uniformes** | `uniform_config` | uniform-config | `inagle_uniforms` (384) | **FAIT** |
| **Shops** | `shop_config` | shop-config | `inagle_shops` (2331) | **FAIT** |
| **Tricks** | `trick_config` | trick-config | `inagle_tricks` (9) | **FAIT** |
| **Tactiques spéciales** | `special_tactics_*` | special-tactics-config | `inagle_special_tactics` (85) | **FAIT** |
| **Telop waza** | `skill_telop_info_config` | **telop-waza (nouveau)** | `inagle_telop_waza` (926) | **FAIT** |
| **Video waza** | `event_movie_config` | **video-waza (nouveau)** | `inagle_video_waza` (4) | **FAIT** |
| **Emblèmes** | `emblem_resource` | **emblems (nouveau)** | `inagle_emblems` (2) | **FAIT** |
| **Stadiums** | `stadium_*` | stadium-config | `inagle_stadiums` (81) | **FAIT** |
| **Nameplates** | `user_name_plate_config` | nameplate-config | `inagle_nameplates` (54) | **FAIT** |
| **Super-tactiques** | `super_tactics_config` | super-tactics-base-config | `inagle_super_tactics` (23) | **FAIT** |
| **Team-build** | `team_build_config` | team-build-config | `inagle_team_build` (86) | **FAIT** |
| **Skill-technic** | `skill_technic_config` | skill-technic-config | `inagle_skill_technic` (14) | **FAIT** |
| **Boost groups** | `boost_player_group_config` | boost-player-group-config | `inagle_boost_groups` (5) | **FAIT** |
| **Constellations** | `players_universe_config` | constellation | `inagle_constellations` (30) | **FAIT** |
| **Star-signs** (pool drop/signe) | `players_universe_config`+basara | star-sign | `inagle_star_signs` (5080) | **FAIT** |
| **Trophées** | `trophy_config` | trophy-config | `inagle_trophies` (228) | **FAIT** |
| **Missions** | `mission_config` (1 placeholder réel) | mission-config | `inagle_missions` (1) | **FAIT** (config = placeholder ; vrai contenu = `inagle_quests`) |
| Textures chr (g4tx) | CPK assets | — (iecode C#) | — (assets, pas DB) | iecode (embed GLB FAIT) |
| Modèles chr (g4mg/g4md/g4sk) | CPK assets | — (iecode/niers) | — (assets) | iecode/niers partiel |
| Drop-rates par élément | `soccer_drop_config`, `item_emission_rarity_table`, `win_treasure_lot_table` | SQL projection / service | `inagle_drops` | **FAIT** |
| Lua (677) | `lua_scripts/**` | analyse p0/p1/p2 | `inagle_lua_scripts` (666) | **FAIT** |
| Code C (nie.exe) | RE niers | niers (pdata/disasm/propagate) | sqlite niers | **FAIT 92,43 %** |

## Surfaçage azalee (contenu jeu → page wiki)

Le `/goal` ne s'arrête pas à la DB : la donnée doit être **navigable**. État du surfaçage des tables
`inagle_*` dans des pages azalee (vérifié 2026-06-06, routes réelles sous `apps/azalee/app/` (not in repo) à
l'époque de l'audit ; le wiki est depuis fusionné dans `apps/website/src/app/wiki/**` et chaque
route ci-dessous est préfixée par `/wiki`).

| Table `inagle_*` | Page azalee | Statut |
| --- | --- | --- |
| `inagle_characters` | `/wiki/chara` (+ `/wiki/chara/[id]`) | **SURFACÉ** |
| `inagle_skills` | `/wiki/skill` (+ détail) | **SURFACÉ** |
| `inagle_auras` | `/wiki/aura` (+ détail) | **SURFACÉ** |
| `inagle_items` | `/wiki/item` (+ détail) | **SURFACÉ** |
| `inagle_keshins/souls/miximax/awakenings` | `/wiki/keshin` | **SURFACÉ** |
| `inagle_special_tactics`/`super_tactics`/`team_build` | `/wiki/tactic` | **SURFACÉ** |
| `inagle_passives` (1716) | **`/wiki/passive`** (+ `/wiki/passive/[id]`) — projection SQL canonique | **SURFACÉ (récent)** |
| `inagle_teams` (208) | **`/wiki/equipe`** (+ `/wiki/equipe/[id]`) | **SURFACÉ (récent)** |
| `inagle_shops` (2331) | **`/wiki/boutique`** (+ détail) | **SURFACÉ (récent)** |
| `inagle_quests` (182) | **`/wiki/quete`** (+ détail) | **SURFACÉ (récent)** |
| coachs/entraîneurs | **`/wiki/entraineur`** (+ détail) | **SURFACÉ (récent)** |
| `inagle_stadiums` (81) | **`/wiki/stade`** (+ détail) | **SURFACÉ (récent)** |
| `inagle_drop_rates`/`inagle_drops_*` | **`/wiki/drops`** (explorer taux) | **SURFACÉ (récent)** |
| `inagle_capsules` + costumes | **`/wiki/capsule`** (+ détail) | **SURFACÉ (récent)** |
| `inagle_uniforms` (384) | (servi via modèles 3D `/model-full`, pas de page dédiée) | indirect |
| `inagle_emblems`, `inagle_nameplates`, `inagle_tricks`, `inagle_skill_technic`, `inagle_boost_groups`, `inagle_telop_waza`, `inagle_video_waza` | — | **PAS DE PAGE** (en DB, non surfacé) |
| `inagle_constellations` (30), `inagle_star_signs` (5080) | — | **PAS DE PAGE** (cf. RESTANT) |
| `inagle_trophies` (228) | — (mappés côté succès Steam) | **PAS DE PAGE** dédiée |
| `inagle_events` (4708), `inagle_event_subtitles` (2093) | — | **PAS DE PAGE** (cf. RESTANT) |

> Pattern de page wiki récente (RSC) : lib serveur `lib/wiki/<x>.ts` (`import "server-only"`, lit le miroir
> SQLite) + `<x>-shared.ts` client-safe (types/helpers) ; nav dans `packages/rg/app-shell/src/config/navigation.ts` + locales
> fr/en/ja. Frontière stricte : un `"use client"` n'importe **jamais** une lib qui touche sqlite (sinon
> build casse `Can't resolve 'tls'`). Cf. `docs/products/rg/cpk-browser.md` (même frontière pour `lib/cpk`).

## État CPK-mirror (navigateur de fichiers)

**FAIT côté données/API, sans page dédiée** — l'**arbre des fichiers** des CPK (pas seulement les
données parsées) reste exposé via l'API `/api/cpk` (pas de page `/cpk/[[...path]]`, l'explorateur UI a
été retiré, `84461f04`) : miroir des **250 800 fichiers** (common 193 540 / dx11 57 260, source Redis
db3 `iev:file:index`). Index tracké `apps/rg/website/data/cpk-index.ndjson.gz` (~3,9 Mo) → matérialisé en
SQLite runtime sur `/tmp`. Contenu décodé live par le CDN : g4tx→png (:8788), g4md/g4mg→GLB
**texturé complet** (corps+visage+uniforme) via `nie-model-serve` :8790 `/model-full/<code>.glb`. Doc dédiée :
`docs/products/rg/cpk-browser.md`. C'est la concrétisation « extraction totale → exploration totale » du `/goal`.

## RESTANT (domaines non surfacés / à câbler)

1. **Événements / histoire** : `inagle_events` (**4708**) + `inagle_event_subtitles` (**2093**) en DB mais
   **aucune page** — dialogues/cutscenes/lyrics non navigables.
2. **Constellations / star-signs** : `inagle_constellations` (**30**) + `inagle_star_signs` (**5080**) en DB,
   pas de page (pool drop par signe = donnée riche non exposée).
3. **Héros** : ~**126** héros (Hero/légendaires) — à vérifier/séparer dans une vue dédiée (actuellement noyés
   dans `/wiki/chara`).
4. **Trophées** : `inagle_trophies` (**228**) mappés côté succès Steam mais **pas de page wiki** trophées.
5. **Telop / video waza** : `inagle_telop_waza` (926) + `inagle_video_waza` (4) en DB, servis comme bannières
   sur certaines fiches (`/tactic`) mais pas de galerie/section dédiée.
6. **Courbes de stats zukan** : câbler les courbes de progression de stats (source zukan, ingérées par
   `nie-zukan` côté niers) sur les fiches perso.

## Constat

L'essentiel du socle est **FAIT** (22 tables `inagle_*` peuplées) et **largement surfacé** (14 sections wiki +
navigateur CPK). Le gros du `/goal` = **fermer l'écart parseur→DB** :
**~14 parseurs existent déjà** mais ne sont **pas poussés** en table `inagle_*`, et **3 catégories** (emblèmes, telop waza,
video waza) demandent un **nouveau parseur**. Plus : vérifier les drop-rates **par élément**, indexer/typer les **677 Lua**.

## Plan (phases, exécutées en workflows vérifiés contre le réel)

1. **Push DB des parseurs existants** (P0) : pour chaque GAP « pousser » — concevoir la table Supabase (migration),
   câbler `cli-push.ts`, exécuter le push, **vérifier le `COUNT(*)`** réel. Catégories : uniformes, shops, tricks,
   special/super-tactiques, team-build, skill-technic, stadiums, nameplates, boost-groups, constellations,
   star-signs, trophées, missions.
2. **Nouveaux parseurs** (P0) : emblèmes (localiser le config), telop waza (`skill_telop_info_config`),
   video waza (`event_movie_config`) → parseur + type + table + push + vérif.
3. **Drop-rates par élément** (P1) : confirmer/compléter la projection SQL pour ventiler par élément
   (`item_emission_rarity_table`, `win_treasure_lot_table`).
4. **Lua** (P1) : indexer + typer les 677 scripts (table `inagle_lua_scripts` : nom, version, catégorie p0/p1/p2,
   symboles/fonctions, hash).
5. **Assets chr** (P2) : textures/modèles g4tx/g4mg via iecode → index/manifest exploitable.
6. **Code C** : niers continue (déjà 92,43 %).

> Chaque livrable est classé **FAIT / INCOMPLET / NON_FAIT** et vérifié contre la donnée réelle (parseur exécuté,
> `COUNT(*)` Supabase, octets du config). Voir aussi `docs/iecode-inagle-supabase.md` (not in repo) (audit consolidé).

## Batches (découpage exécutable en workflows dynamiques)

| Batch | Contenu | Domaine (évite conflits) | Statut |
| --- | --- | --- | --- |
| **B1** | Catégories nommées : uniformes, shops, tricks, tactiques spéciales, telop waza, video waza, emblèmes → table + parseur + push + COUNT + câblage | `rg/packages/inagle` + Supabase | **FAIT** (`8ec292d` ; 384/2331/9/85/926/4/2 vérifiés ; RLS+policy `Public Read` 7/7 ; type-check vert) |
| **B2** | Reste parseur→DB (8 catégories) | `rg/packages/inagle` + Supabase | **FAIT** (`99e3c25` ; 23/14/86/5/30/5080/228/1 vérifiés ; RLS+`Public Read` 8/8 dès création ; type-check vert ; bonus fix parser constellation) |
| **B3** | **Taux de drop** : audit configs drop + existant `inagle_drops_*`, combler le vrai gap | `rg/packages/inagle` + Supabase | **FAIT** (`d54cdf5` ; `inagle_drop_rates` **177** vérifié REST = 10 emission + 54 spirit + 113 treasure ; RLS ; AUCUNE dimension élément-attribut dans les octets → « élément » du /goal = chaque item/objet) |
| **B4** | **Lua** : indexer/typer les ~677 scripts (`inagle_lua_scripts`) + analyse statique | `rg` (`inagle/src/lua/`) + Supabase | **FAIT** (agy `bea3687`/`bc6c9ff` ; `inagle_lua_scripts` **666** vérifié REST ; `parsers/lua.ts` + `PostgresAdapter` + câblé `cli-push`) |
| **B5** | **Assets chr** : extraire/indexer g4tx + g4mg/g4md/g4sk → manifest/DB + index arbre du jeu → Redis | `iecode` (C#) + `niers` (nie-formats) | **FAIT (voie C#)** (`319af59` ; `TextureManifestExport.cs` + `index-textures-to-redis.ts` ; **2000 g4tx → 20479 textures** en-têtes W/H/format/mips dans Redis db3 `iev:tex:*` vérifié `SCARD`=2000 + `HGETALL` échantillon `w14h015`=2048×2048 DX10 mips10 ; test 1293 assert ; arbre→Redis `0ba8a8a` 250800 fic/921 CPK). **CORRECTION honnête** : l'« extraction CPK » niers `c91faeb`/`a0e5333` était **cassée sur les vrais CPK** (modèle storage @UTF faux : nibble haut traité en enum au lieu de bits HasName/HasDefault/RowStorage → 0% extrait sur CPK textures) → fix Rust en cours (ancré au C# `UtfTable.cs`) + validation croisée Rust↔C#) |
| **B6** | Événements : `ev*`/`Subtitle_ev*` (~16k) → index/typage des scripts d'event (dialogues, video waza in-game) | `rg` + Supabase | **FAIT** (`7e0cb0e` ; 3 familles réelles tracées : `Subtitle_ev*`=timing 5 vars, `text/<lang>/event/ev*`=TEXT_INFO localisé, `ev*_map`=washa 17 vars, jointes par hash Int signé ; `inagle_events`=**4708** + `inagle_event_subtitles`=**2093** vérifiés REST count=exact, dont **1572** lignes texte FR non-null, 521 NULL légitimes lyrics ; RLS+`Public Read` ; type-check vert ; texte stocké brut tags `<MNT:>`/furigana préservés) |
| **B7** | Code C : niers continue (nie-wasm, câblage runtime sim, levier feuilles) | `niers` | EN COURS (axe séparé) |
| **B8** | **RAG unifié — vecteurs précis + liens** : sidecar embeddings self-host (`rg-rag-embed.service`, multilingual-e5-small, zéro clé), graphe `inagle_rag_edges`, ingestion du texte de jeu (kind `text`) | `rg` (`packages/rg/db`+`cron`, `scripts/rag-*`) + Supabase | **FAIT** (`c5569c4`,`c07e2c0` ; **41 491 arêtes** references/has_face/has_icon/is_texture/has_miximax ; texte de jeu **formaté/UTF-8** `[C…]` résiduel 0 / 259 899 entrées ; reembed 9850 PoC hash→e5 + ingestion ~70 k chunks `text` via sidecar ; doc `docs/rag-unified.md` (not in repo)) |
| **B9** | **Surfaçage UI / drift data↔UI** (audit read-only 66 tables) : combler P0/P1 | `rg/apps/azalee` | **FAIT (P0/P1)** (`637ad44` ; `/item` 6→19 catégories ~1078 objets débloqués ; section `/succes` 228 trophées ; fusion `special_tactics` dans `/tactic` 70→80 ; retrait stats Lv30/50 mortes — vrai calcul = `lib/wiki/chara-stats.ts`) |

## Surfaçage UI — drift restant (audit read-only, 66 tables)

Tables peuplées encore **NON surfacées** (P2, candidates) : `inagle_events`(4708)+`event_subtitles`(1572 FR)
→ section `/histoire` ; `star_signs`(5080) → enrichir `/invocation` ; `kizuna_items`(125, `getKizunaItems`
jamais importé) ; galerie cosmétique (`activity_photos`115/`scene_archives`112/`nameplates`54/`chat_emotes`57/`phase_titles`9) ;
`growth_tables`(276)+`exp_table`(100). Anomalies : `inagle_formations` **vide (0)** mais comptée au dashboard +
liée vers route 404 (whitelist navigateur générique = 9/65 tables). Hash non résolus : capsules `contentRef`/`poolRef`,
costumes `model_ref`.

## Moteur de workflows dynamiques (cadence autonome)

Le `/goal` (Stop hook) maintient la session active. Cadence : **lancer un MAX de workflows dynamiques en parallèle sur
des domaines DISJOINTS** (`rg/packages/inagle`+Supabase ⟂ `niers` ⟂ `iecode` C#) pour éviter les conflits de fichiers
(`cli-push.ts` est mono-fichier → un seul workflow le câble à la fois ; les migrations Supabase sont idempotentes
`IF NOT EXISTS`). Boucle par batch : **dispatch workflow → vérifier les `COUNT(*)`/builds RÉELS soi-même (ne pas croire
l'agent) → committer le vérifié → marquer le batch FAIT ici → enchaîner**. Anti-hallucination systématique : toute
valeur/colonne adossée au vrai config/octet ; sinon NON_FAIT motivé. Plan tenu à jour dans CE fichier + mémoire
`project-gamedata-extraction-goal`.
