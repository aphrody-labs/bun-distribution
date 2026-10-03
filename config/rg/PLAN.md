# PLAN — Source Ultime de Vérité & Architecture Unifiée Rose Griffon

> **Statut : Document de référence absolu**  
> **Dernière mise à jour : 23/09/2026**  
> **Mode : Autonome (YOLO 100% / No Human in the Loop)**  
> **Applicabilité : Multi-agents (Claude Code, Antigravity AGY, Codex)**

---

## 1. Vision & Architecture du Réseau

Le monorepo `rg` (`../rg`) unifie l'ensemble des services web, données et bots de l'écosystème Rose Griffon sur une infrastructure VPS auto-hébergée (PostgreSQL 18 local, PostgREST :8809, Storage :8810, Realtime :8812, CDN :8804/:8805, API :8807).

### 1.1 — Les Trois Piliers Unifiés sous `rosegriffon.fr` (`apps/website`)

Le site unique `rosegriffon.fr` héberge désormais les trois univers du réseau dans un chrome applicatif unifié :

| Pilier | Préfixe | Description | Marque & Identité |
|---|---|---|---|
| **Association** | `/` (racine) | Le portail officiel de l'association Rose Griffon : actualités, chroniques, projets communautaires, événements, RG TV, boutique solidaire, recrutement et vie associative. | Marine `#0a152c`, Rose `#f13f8a`, Or `#d8b349`, Brique `#98483c` |
| **Wiki Azalée** | `/wiki` | L'encyclopédie et base de données de référence sur *Inazuma Eleven: Victory Road* : 6 000+ joueurs, techniques, tactiques, passifs, hyper-techniques (esprits guerriers, totems, miximax, éveils, modes), clubs, objets, simulateurs et modèles 3D. *(azalee.rosegriffon.fr redirige 301 vers /wiki)* | Ambre `#f2a93b` / `#ffc66c`, Vermillon `#a92335` |
| **E-sport Achilléa** | `/achillea` | La scène compétitive officielle : tournois communautaires, Astral League, clans, ranked ELO (1v1, 2v2) avec 11 paliers, files d'attente temps réel, licence compétiteur, portefeuille ACH, casts et arbitrage. *(achillea.rosegriffon.fr redirige 301 vers /achillea)* | Violet cyber `#6d00ce` / `#b875ff`, Lime fluo `#dfff57`, Fond `#0d0814` |

---

## 2. Redesign Complet de la Navigation et du Layout

### 2.1 — Unification Absolue des Barres et Menus

Fini le découpage hérité où chaque univers masquait les barres des autres (`shouldHideSidebar = isWikiPage || isAchilleaPage`). L'ensemble du réseau partage désormais une même architecture responsive Material Design 3 :

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ TopAppBar Unifiée (fixe h-14)                                              │
│ [Burger] [Logo Rose Griffon] [Badge Univers]    [SearchBar Unifiée ⌘K]   [Thème] [Notifs] [Profil]│
├───────────────┬─────────────────────────────────────────────────────────────┤
│ Sidebar /     │ Contenu Principal                                           │
│ NavigationRail│                                                             │
│               │ ├── Hub de l'univers actif (hero, actualités, classements)  │
│ ▾ Association │ ├── Modules et données interconnectées                      │
│ ▾ Wiki Azalée │ └── Pied de page unifié                                     │
│ ▾ Achilléa    │                                                             │
│               │                                                             │
├───────────────┴─────────────────────────────────────────────────────────────┤
│ MobileBottomNav Unifiée (écrans compacts < 600px, fixe h-20)               │
│ [ Accueil ]   [ Wiki Azalée ]   [ E-Sport ]   [ Recherche ]   [ Menu/Compte ]│
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 — Arborescence Déclarative de la Sidebar (`packages/app-shell`)

La barre latérale unifiée (`AppSidebar`) regroupe les trois sous-catégories majeures sous forme de sections repliables (`Collapsible` M3), avec ouverture automatique sur l'univers actif (`domaineDeLaRoute`) :

#### Sous-catégorie 1 : Association (Rose Griffon)
- **Accueil** (`/`)
- **Actualités & Chroniques** (`/news`, `/chroniques`)
- **Événements** (`/evenements`)
- **Projets** (`/projets` : Emotes, Nostalgie...)
- **Rose Griffon TV** (`/rose-griffon-tv`)
- **Boutique solidaire** (`/shop`)
- **Vie associative** (`/community`, `/sondages`, `/iergday`)
- **À propos & Contact** (`/a-propos`, `/notre-equipe`, `/nous-soutenir`)

#### Sous-catégorie 2 : Wiki Azalée (Encyclopédie Inazuma Eleven)
- **Accueil Encyclopédie** (`/wiki`)
- **Joueurs** (`/wiki/chara`)
- **Techniques & Capacités** (`/wiki/skill`, `/wiki/tactic`, `/wiki/passive`)
- **Hyper-techniques** (`/wiki/aura` : Esprits guerriers, Totems, Miximax, Éveils, Modes)
- **Clubs & Entraîneurs** (`/wiki/equipe`, `/wiki/entraineur`, `/wiki/stade`)
- **Objets & Obtention** (`/wiki/item`, `/wiki/boutique`, `/wiki/capsule`, `/wiki/invocation`, `/wiki/drops`)
- **Niveaux & Quêtes** (`/wiki/niveau`, `/wiki/quete`, `/wiki/succes`)
- **Médias & Modèles 3D** (`/wiki/gallery`, `/wiki/textures`, `/wiki/sons`, `/wiki/videos`, `/wiki/modeles`, `/wiki/mode`)
- **Outils communautaires** (`/wiki/tools`, `/wiki/cross`, `/wiki/save`, `/wiki/patch-notes`)

#### Sous-catégorie 3 : E-Sport Achilléa (Compétition)
- **Accueil Compétitif** (`/achillea`)
- **Mode Classé** (`/achillea/ranked`, `/achillea/ranked/leaderboard`, `/achillea/ranked/tiers`, `/achillea/ranked/history`)
- **Tournois & Circuits** (`/achillea/tournaments`, `/achillea/tournaments/circuit/ranking`, `/achillea/tournaments/create`)
- **Astral League** (`/achillea/leagues/astral`)
- **Clans** (`/achillea/clans`, `/achillea/clans/dashboard`, `/achillea/clans/create`)
- **Casts & Casters** (`/achillea/casts`)
- **Licence Compétiteur** (`/achillea/licence`, `/achillea/licence/verify`)
- **Portefeuille ACH** (`/achillea/wallet`)
- **Guide & Brand Kit** (`/achillea/guide`, `/achillea/guide/brand`)
- **Administration & Arbitrage** (`/achillea/admins/dashboard` — accessible si rôle Staff/Admin)

---

## 3. TopAppBar, MobileNavBar et SearchBar Fédérée

### 3.1 — TopAppBar Unifiée (`TopAppBar` / `DesktopTopBar` / `MobileHeader`)
- **Logo & Badge d'univers** :
  - Détection dynamique de l'univers via `domaineDeLaRoute(pathname)`.
  - Pill visuel interactif : **Association** (Marine/Rose), **Wiki** (Ambre Azalée), **E-Sport** (Cyber Violet/Lime).
  - Clic sur le badge permet de basculer instantanément d'un univers à l'autre.
- **SearchBar unifiée au centre** :
  - Rendu natif dans `DesktopTopBar`.
  - Raccourci global clavier `⌘K` / `Ctrl+K`.
- **Actions rapides à droite** :
  - Lien Administration (si rôle Admin/Modérateur).
  - Notifications contextuelles.
  - Basculeur de thèmes fluide (`ThemeToggle`) supportant les 5 thèmes officiels.
  - Bouton Compte / Connexion universelle (auth Rose Griffon + session Discord Achilléa).

### 3.2 — MobileBottomNav Unifiée
Sur mobile (< 600px), une barre tactile à 5 onglets stratégiques :
1. **Accueil** (`/`) — Hub Rose Griffon
2. **Wiki** (`/wiki`) — Encyclopédie Inazuma
3. **E-Sport** (`/achillea`) — Tournois & Ranked
4. **Recherche** (`/search`) — Recherche globale
5. **Menu / Profil** — Tiroir de navigation complet

### 3.3 — SearchBar Unifiée (Multi-Domaine)
La recherche fédérée (`/search` et palette `⌘K`) interroge simultanément :
1. **Association** : Articles, chroniques, projets associatifs.
2. **Wiki Azalée** : Joueurs, techniques, objets, auras, clubs, modèles 3D.
3. **E-sport Achilléa** : Tournois en cours, clans, joueurs classés, ligues.
Affichage par onglets instantanés : **Tous**, **Wiki**, **E-Sport**, **Actualités**.

---

## 4. Design System, Thème Achilléa & Tailwind v4

### 4.1 — Les Cinq Thèmes Officiels (`packages/ui`)
Les thèmes sont appliqués par classe CSS sur `<html>` (`theme-roy`, `theme-gaelle`, `theme-azalee-light`, `theme-azalee-dark`, `theme-achillea`) :

1. **Roy** : Inazuma Bleu/Doré (`#0e5794` / `#e0b771`, fond `#f9f4ee`)
2. **Gaëlle** : Vermillon/Orange (`#b32228` / `#fca676`, fond `#ffe8e0`)
3. **Azalée clair** : Ambre M3 (`#f2a93b` / `#a92335`, fond `#fff8f5`)
4. **Azalée sombre** : Ambre nocturne (`#ffc66c` / `#ffb2be`, fond `#1a120d`)
5. **Achilléa** : Cyber-gaming esport (`#b875ff` / `#6d00ce` violet, `#dfff57` lime fluo, fond `#0d0814`)

### 4.2 — Palette Ranking 11 Paliers Achilléa
Chaque palier expose ses 5 stops hexadécimaux et sa classe utilitaire dégradée :
- `rank-gradient-1` (Fer `#959595`)
- `rank-gradient-2` (Bronze `#b17253`)
- `rank-gradient-3` (Argent `#7facb8`)
- `rank-gradient-4` (Or `#c2ad88`)
- `rank-gradient-5` (Platine `#897e8b`)
- `rank-gradient-6` (Diamant `#88f6ff`)
- `rank-gradient-7` (Émeraude `#2d925c`)
- `rank-gradient-8` (Rubis `#ff5648`)
- `rank-gradient-9` (Divin `#7edcb5`)
- `rank-gradient-10` (Supernova `#f010ff`)
- `rank-gradient-11` (Légendaire `#ffa910`)

---

## 5. Données, Pipelines & Interconnexions

### 5.1 — Base de Données Unifiée
- `rg` et `achillea` résident sur le même cluster PostgreSQL 18 local.
- Les tables d'Achilléa sont consolidées dans la base `rg` sous le schéma natif `achillea` via `scripts/ops/achillea-merge.ts` (les tables FDW étrangères et la tâche `sync:achillea` ont été retirées).
- Clé de réconciliation universelle : `profiles.discord_id = achillea."user".id` (538 comptes communs actifs dès l'ouverture).

### 5.2 — Passerelles Croisées UI / UX
- Fiche Joueur Wiki (`/wiki/chara/[id]`) affiche les statistiques ELO et tournois si le joueur est enregistré en compétitif.
- Profil Compétiteur (`/achillea/users/[id]`) relie le profil membre RG, les rôles Discord et les contributions au wiki.
- Barre de recherche unique déclenchant des suggestions intelligentes inter-domaines.

---

## 6. Migration des Tests et Assurance Qualité

### 6.1 — Batterie de Tests Unitaires & Intégration
1. **Tokens & Thèmes** : `bun test packages/ui/test/tokens.test.ts` (vérifie la non-dérive stricte CSS → TS et la couverture complète des 68 variables M3/shadcn sur les 5 thèmes).
2. **Navigation & Routes** : `bun test packages/app-shell/test/navigation.test.ts` et `packages/app-shell/test/liens.test.ts` (garantit l'absence totale de 404 sur les liens du menu et la conformité des 3 domaines).
3. **Métier Achilléa migré** : `bun test apps/website/src/lib/achillea` (couvre `hero-bg-fx`, calculs ELO, permissions Tournament Organizer, URLs d'API, tonalités de badges).
4. **Vérification globale** : `bun run type-check && bun run build`.

---

## 7. Purge et Nettoyage de la Documentation

Les anciens documents temporaires, obsolètes ou contradictoires de `docs/` ont été purgés pour faire de ce `PLAN.md` la référence unique :
- Retrait des anciens plans de bascule temporaires (ex. `PLAN-SECURITE-BASCULE.md`, `PLAN-SESSION-3D.md`, `azalee-plan-correctifs.md`).
- Retrait des manifests JSON d'importation brute temporaires (`achillea-phase0-import-manifest.json`, `achillea-phase0-source-map.md`, `achillea-phase0-dependencies.md`).
- Centralisation de toute la stratégie dans `PLAN.md` et son découpage d'exécution `PARTITION.md`.

---

## Migration de l'exploitation transverse vers `aphrody-infra` — 23/09/2026

Ce qui concernait tout le VPS ou plusieurs dépôts a quitté `rg` pour `aphrody-infra`
(index : `../aphrody-infra/docs/ops/README.md`). Noms d'units inchangés.

| Élément | Nouvel emplacement |
|---|---|
| `infra/sysctl/`, `infra/logrotate/` | `aphrody-infra/host/` |
| `rg-zram-swap`, drop-ins `nginx.service.d` | `aphrody-infra/systemd/` |
| `rg-watchdog@` + `scripts/rg-watchdog.sh` | `aphrody-infra/systemd/`, `scripts/ops/rg-watchdog.sh` |
| `rg-infra-monitor` + `scripts/ops/stack.ts` (doublon) | `aphrody-infra/scripts/infra-status.ts` |
| `rg-repo-sync` + `scripts/ops/repo-sync.ts`, `docs/REPO-SYNC.md` | `aphrody-infra/scripts/ops/`, `docs/ops/` |
| `scripts/ops/archive-froid.ts`, `docs/stockage-secondaire.md` | `aphrody-infra/scripts/ops/`, `docs/ops/` |

Restent dans `rg` : units applicatives, crons du bot et du site, et le script
d'assemblage de release (`scripts/ops/assemble-vps-release.sh`). Les scripts d'exploitation
(`sauvegarde.ts`, `infra.ts`, etc.) sont portés par `aphrody-infra/scripts/rg/`. `bun run infra:*`
et `ops:sync*` appellent `../aphrody-infra`.

**Reste à faire (opérateur)** : réinstaller ces units depuis `aphrody-infra` sur le VPS
(`ExecStart` pointe vers `~/aphrody-infra`), `daemon-reload`, vérifier les timers.

## Assets CDN partagés rétablis — 23/09/2026

`https://cdn.rosegriffon.fr/static/rg/public/*` répondait 404 depuis l'unification
(8c797ba) : la tâche cron `cdn` écrivait dans `/var/www/cdn/static/static/rg/public`
(hors `ReadWritePaths`, échec EROFS), et le vhost CDN de `infra/nginx/rg-production.conf`
envoyait `/static/` à `rg-cdn`, qui ne le sert pas. Corrigé par 939fc1a (chemin de
publication + `location ^~ /static/` servi depuis `/var/www/cdn`).

Décision : la release `939fc1a` a été dérivée de la release `5779c9d` (seuls les
fichiers du commit remplacés, manifeste et `SHA256SUMS` régénérés), puis activée par
`aphrody-infra deploy --stack rg --apply`. Motif : l'environnement privé d'installation
Bun (`~/.rg-deploy-stage/root.env`) n'existe plus sur le VPS, ce qui bloque
`assemble-vps-release.sh` ; le commit ne touche aucun artefact construit. Tâche `cdn`
relancée dans le bac à sable de rg-cron : 388 assets publiés, URLs vérifiées en 200.

**Reste à faire** : reprovisionner l'environnement de build privé pour que la prochaine
release repasse par `scripts/ops/assemble-vps-release.sh`.

## Hôte VPS : consommation réduite pour RG — 23/09/2026

- `certbot.timer` et `logrotate.timer` relancés : la remise à zéro du 22/09 les avait
  arrêtés, et sans eux les certificats RG expirent à partir du 09/11. Simulation
  `certbot renew --dry-run` : tous les certificats RG passent. `studio.rosegriffon.fr`,
  hors catalogue, sort du renouvellement (configuration déplacée dans
  `/var/backups/letsencrypt-renewal-retired`).
- Docker et containerd ne tournent plus au repos (`disable --now`) : `docker.socket`
  reste actif et les démarre à la demande pour `assemble-vps-release.sh`. État
  précédent dans `/var/backups/docker-enable-state-*.txt`.
- Aucun autre service système n'est relancé. Pas de nouveau timer, ni de sauvegarde
  ni de nettoyage, ajouté sur l'hôte.

## Sous-domaines et services doublons retirés — 23/09/2026

- `supabase.`, `storage.` et `realtime.rosegriffon.fr` retirés (vhosts, certificat
  `supabase.rosegriffon.fr` sorti du renouvellement, enregistrements DNS A supprimés).
  Ils doublaient `/storage/v1/` et `/realtime/v1/` servis par `rosegriffon.fr`, que tous
  les clients utilisent. Leur seul trafic était du scan WordPress. `studio.` (A
  orphelin, sans vhost) supprimé aussi. Restauration : A → `51.77.147.152`.
- `rg-postgrest` retiré (unité désactivée, sauvegardée dans
  `/var/backups/rg-postgrest-retired-*`) : aucun consommateur, les seuls appels
  `/rest/v1` venaient des sondes de déploiement.
- Release `6494fd4` (dérivée de `939fc1a`, fichiers du commit copiés sans conversion
  de fins de ligne) activée par `aphrody-infra deploy --stack rg --apply` ; catalogue
  aphrody-infra `a412e14` installé sur le VPS. Les changements du site (`sites.ts`,
  `platform.ts`) ne prennent effet qu'à la prochaine release construite.
- Sous-domaines conservés, car utilisés : `api.` (callback OAuth, API unifiée),
  `cdn.`, `achillea.` (API bot et redirection), `ranked.` (WebSocket Colyseus codé
  dans le bundle du site).

## Infrastructure RG entièrement portée par `aphrody-infra` — 23/09/2026

`rg` ne garde que le code applicatif et le script de construction de release
(`scripts/ops/assemble-vps-release.sh`). Ports, unités, hôtes et routes :
`../aphrody-infra/config/service-catalog.json` et `config/nginx-routes.json`,
seules sources de vérité ; ce dépôt ne publie plus de table de ports.

| Ancien emplacement (`rg`) | Nouvel emplacement (`aphrody-infra`) |
| --- | --- |
| `infra/systemd/*` | `systemd/rg-*.service` (units finales `/srv/rg/current`, env `/etc`) |
| `infra/nginx/*` | `nginx/rg/` (`rg-production.conf` → release `nginx/rg.conf`) |
| `infra/docker/vps-replica`, `infra/cloud` | `config/infra/docker/rg-vps-replica/`, `config/infra/cloud/rg-website/` |
| `scripts/ops/{sauvegarde,infra,invalidate-cdn,vercel-failover}.ts`, `provision-vps-env.py` | `scripts/rg/` |

- Le build lit `systemd/rg-*.service` et `nginx/rg/rg-production.conf` depuis
  `${APHRODY_INFRA_ROOT:-../aphrody-infra}` (révision propre exigée, consignée
  dans `release.json` sous `infraCommit`) ; plus de renommage `website-web`.
- `rg-cdn` écoute sur **8801** (défaut de `apps/cdn/server.ts`).
- Retirés : déploiement bleu/vert (`scripts/ops/deploy.ts`, `website-web-b`),
  `release-stack.ts`, `prune-runtime.ts`, `deploy-bot.sh`, `ship-website.sh`,
  workflow `deploy.yml`, tâche turbo `deploy`, shims RAG du cron (tâches `rag`,
  `rag:wiki`, `query`, verbe IPC `query_rag`), unités `achillea-postgrest`,
  `achillea-storage`, `achillea-realtime` (8820-8822, la façade publique sert
  `/storage/v1` et `/realtime/v1` depuis `rg-storage`/`rg-realtime`), et le
  contrôle `check:achillea-services` qui validait ces fichiers.
- Chemin du dépôt de données du jeu : `~/nie` (et non plus `niers`).

## Correctifs production post-migration — 23/09/2026

- ISR : `experimental.isrFlushToDisk: false` (Next 16.3). La release est immuable
  (`ProtectSystem=strict`) : les pages régénérées restent en cache mémoire au lieu
  d'échouer en `EROFS` dans `.next/server/app`.
- Auras : `getAurasList` lit les tables de base avec `DISTINCT ON (name_fr)` (même
  sémantique que les vues `*_clean`, dont la liste de colonnes figée n'a pas
  `asset_code`/`element_id`/`sub_type` pour souls, awakenings et mode_changes).
- Emblèmes d'équipe : `TEAM_EMBLEM_MAP` → `emNNNNNN` → CDN ; les `emblem_url`
  legacy `0x<CRC>.webp` du bucket `menu` disparu donnent `null` (repli UI, plus de 404).
- `assemble-vps-release.sh` n'embarque que les unités `.service` du catalogue ; les
  timers `rg-sauvegarde`/`rg-infra-monitor` appartiennent à `aphrody-infra`.
- Stockage : les 381 objets du bucket `images` (fusion Achilléa) ont été copiés de
  `/var/www/achillea-storage/images` vers `/var/www/rg-storage/images` (copie, source conservée).
