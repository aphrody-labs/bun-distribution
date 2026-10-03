# Changelog

Toutes les évolutions notables du monorepo `rg`. Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) + [SemVer](https://semver.org/lang/fr/).

## [Non publié]

### Ajouté

- **Achilléa devient portable** (`docs/achillea-modulaire.md`) : le domaine est découpé en quatre couches dont aucune ne connaît Angular — `achillea-types` (contrat pur), `achillea-core` (règles métier), `achillea-client` (accès API isomorphe), `achillea-contract` (export hors TypeScript). Objectif tenu et vérifiable : migrer le front vers Next.js + Tailwind + shadcn, ouvrir un client de jeu Rust ou une app mobile sans réécrire le métier.
- **`@rosegriffon/achillea-contract`** : lit l'AST de `achillea-types` et génère JSON Schema 2020-12, Rust `serde`, Swift `Codable` et Kotlin `kotlinx.serialization` pour les 226 formes du domaine. Le Rust produit est vérifié par `cargo check`. `bun run achillea:contract:check` échoue en CI si l'export est périmé.
- **Suite de tests durcie, de 223 à 298 tests** : exhaustivité des enums (tout membre du contrat doit avoir un libellé, ou une dispense justifiée), robustesse aux entrées hostiles (`NaN`, `±Infinity`, négatifs, `null`, dates illisibles) écrite sous forme de propriétés plutôt que de cas, solidité du code généré (collisions de noms après conversion Rust/Swift/Kotlin, mots réservés, équilibrage des accolades, aller-retour `camelCase ↔ snake_case`) et invariants de surface du client (197 routes appelées une à une : URL bien formée, requête réellement émise, jamais d'exception sur un 500). Chaque nouvelle suite a été validée par mutation — un test incapable d'échouer ne protège rien.
- **`@rosegriffon/achillea-core/numbers`** : coercition numérique défensive (`toNumber`, `toFinite`, `toCount`, `toPositiveInt`, `clamp`, `euclideanMod`), point de passage obligé de toute entrée venue de l'extérieur.
- **13 tables de libellés manquantes** ajoutées (`EventTypeEnum`, `LobbyState`, `RankedState`, `InterclanState`, `TournamentEventType`, `TeamSide`, `SocialMedia`, `NotificationType`, `SanctionIssuerType`, `BracketMatchStatus`, …) : les 34 enums du contrat sont désormais couverts.
- **`achillea-core` passe de 12 à 23 domaines** : brackets (tours, exempts, seeding standard), statistiques, clans, casts, inscrits de tournoi, portefeuille, pagination, URL d'API, identité (avatars, images de rang), libellés fr-FR et tonalités neutres traduites en variantes shadcn. Deux tests de garde refusent toute dépendance runtime ou framework dans `types` et `core`.
- **`achillea-client` couvre l'API entière** : 197 routes sur 16 ressources, schémas verrouillés par `satisfies z.ZodType<Dto>`, erreurs renvoyées en résultat typé plutôt qu'en exception, authentification par cookie ou par jeton injecté.
- **Achilléa consommable depuis `apps/website`** : les trois paquets sont déclarés et transpilés par Next, avec un pont tonalités → `<Badge>` shadcn dans `src/lib/achillea/`.

### Corrigé

- **Onze bugs trouvés par le durcissement de la suite de tests** (`docs/achillea-modulaire.md`, section « Ce que les tests garantissent »). Le point commun de cinq d'entre eux : `Math.max(0, Math.floor(x))` a l'air de borner, mais `Math.floor(NaN)` vaut `NaN` et `Math.max(0, NaN)` vaut `NaN` — le garde-fou laissait passer exactement la valeur contre laquelle il protégeait. `stageRounds`, `stageMatchCount`, `byeCount`, `matchGameCount` et `freeSlots` rendaient `NaN` ; `winRate` et `winRatePercent` aussi. Tout passe désormais par `@rosegriffon/achillea-core/numbers`.
- **`pageWindow` rendait une fenêtre vide** quand la page courante sortait des bornes (`-5`, `999`, `NaN`) : la borne basse dépassait la borne haute et la pagination disparaissait de l'écran au lieu de se recaler.
- **`toFinite(null)` rendait `0` au lieu du repli** : `Number(null)`, `Number("")` et `Number([])` valent `0`, un zéro *fini* qui franchissait tous les contrôles. Une colonne SQL nulle devenait un solde ou une capacité de zéro — une valeur plausible et fausse.
- **`discordDefaultAvatarIndex` rendait un index négatif** sur un identifiant négatif : `-1 % 6` vaut `-1` en JavaScript, pas `5`. Remplacé par un modulo euclidien.
- **Cycle d'import dans `@core/labels`** : le registre importait le barrel qui le ré-exportait, et l'initialisation tournait en rond (`Cannot access … before initialization`) — la suite entière tombait. Tables et registre sont désormais dans deux modules distincts.
- **`ClanMemberRoleName` (libellés français) vivait dans `achillea-types`** : du texte destiné à un humain dans le paquet dont la raison d'être est d'être traduisible mécaniquement. Déplacé dans `@core/labels`, avec un test qui refuse toute table de libellés dans le contrat.
- **Tri des membres de clan** : la table de priorité des distinctions était indexée par le nom anglais du membre d'enum alors que la valeur stockée est française, et `ContentCreator` y était traduit en « Content Creator » (avec espace). Aucune distinction ne matchait hormis `Staff` ; les créateurs de contenu tombaient en fin de liste. La règle est unique et testée, les deux composants qui la dupliquaient la délèguent.
- **`GET /organizations/me` et `GET /bot/users/cached` ne répondaient jamais** : déclarées après leurs jokers `/:id`, elles étaient capturées par eux. Routes littérales remontées, avec un commentaire qui dit pourquoi l'ordre compte.
- **`Omit` ignoré à la génération du contrat** : `WireTournament extends Omit<Tournament, …>` ne produisait que ses quatre champs propres, les trente hérités disparaissaient du Rust et du JSON Schema sans avertissement.
- **Hook de restauration de `bun.lock`** : son garde cherchait `@rosegriffon/monorepo` alors que la racine s'appelle `@rose-griffon/monorepo`. Il sortait en silence sans jamais corriger la régression `lockfileVersion: 2` — le mode d'échec exact que son propre commentaire décrivait.

### Modifié

- **Scope aligné sur le monorepo** : `@achillea/*` devient `@rosegriffon/achillea-*`, et les apps `achillea-bot` / `achillea-web` sont scopées. Les chemins sur disque, le nom de projet Angular et les unités systemd sont inchangés.
- **Fin de la duplication des DTO** : les 1 621 lignes de modèles Angular deviennent 230 lignes de ré-exports ; les 66 contrats déclarés en attente dans le client remontent dans `achillea-types`. Une seule déclaration par forme.

## [0.4.0] — 2026-08-10

### Ajouté

- **`@rosegriffon/azalee` — le wiki devient une bibliothèque Bun** : le cœur du wiki (données, index CPK, index de texte, recherche, CLI, API HTTP headless) quitte l'app Next pour `packages/azalee`. Racine client-safe bundlable dans un navigateur, `/server` pour l'accès disque et base, `/remote` pour un client HTTP typé avec repli automatique quand la machine n'a ni miroir ni dump. L'app Next est renommée `@rosegriffon/azalee-web` et consomme la bibliothèque.
- **API headless du wiki en service** : `azalee-api.service` (:8807) sert les 41 routes JSON derrière `api.rosegriffon.fr/azalee`.
- **`@rosegriffon/mcp` — serveur Model Context Protocol du monorepo** : implémentation Bun native sans dépendance Node, conforme à la révision `2026-07-28` de la spécification **et** aux révisions à handshake encore parlées par les clients. 26 outils (données du jeu, SQL borné, fichiers du jeu, dépôt, production), ressources de contexte, prompts. Deux portées décidées par le jeton présenté : lecture seule, ou administration (écriture, suppression, exécution de commandes).
- **Connexion distante permanente** : `rg-mcp.service` (:8808) derrière `mcp.rosegriffon.fr`, avec scripts d'installation bash et PowerShell pour brancher un Claude Code d'une autre machine.
- **Plugin Claude `rose-griffon`** (`plugins/rose-griffon`) : installe d'un coup le serveur MCP, cinq skills, deux agents et un hook qui restaure `lockfileVersion: 1` après un `bun install`.
- **CLI `azalee` modularisé** : le monolithe de 4 500 lignes éclate en modules par commande, avec des types d'options exportés et les règles de jeu remontées dans la bibliothèque. Surface de commandes identique, vérifiée sortie par sortie.

### Corrigé

- **Miroir SQLite périmé dans les services longs** : `azalee-api` et `rg-mcp` gardaient le fichier ouvert au démarrage et servaient un snapshot supprimé après deux rotations. La bibliothèque détecte désormais le remplacement du fichier et rouvre la base.
- **`azalee-mirror-sync` en échec** alors que la synchronisation réussissait : la sonde de santé unique tombait sur un service Next encore en train de démarrer.
- **`azalee glossary-rebuild`** cherchait le script de reconstruction à un chemin inexistant.
- Correctifs de recherche floue (clé de cache ignorant le seuil, langue japonaise, suggestions).

### Supprimé

- Documents de planification et d'audit datés, périmés ou redondants : `PLAN.md`, `SEO-PLAN.md`, `UI-UX-AUDIT.md`, `IECODE-INAGLE-PLAN.md`, `asset-audit/`, et les doublons de `docs/reference/`. La couverture d'extraction durable reste dans `docs/gamedata-coverage.md`.
- Le guide de déploiement Vercel : les deux applications sont auto-hébergées sur le VPS.

## [0.3.0] — 2026-06-03

### Ajouté

- **Tests natifs unifiés (Azalée CLI)** :
  - Intégration d'une suite de tests natifs dans la commande `azalee test` pour exécuter toutes les étapes précédemment gérées sous Playwright directement en Bun (sauvegarde SQLite locale, endpoints d'API, résolveur GraphQL, audits bxc, structure DOM et rendu HTTP de 29 routes).
  - Création du test d'intégration unifié `packages/inagle/src/azalee-inagle-integration.test.ts` (exécuté via `bun test`) validant de bout en bout le chargement des fichiers JSON binaires d'Inagle, la cohérence avec la base SQLite et le bon comportement du CLI.
  - Nettoyage automatique des caches de navigateurs Playwright (`~/.cache/ms-playwright`) et suppression des processus chrome/playwright orphelins sur le VPS.

## [0.2.0] — 2026-05-31

### Ajouté

- **Intégration & Rendu Premium des actualités X (Azalée)** :
  - Synchronisation et importation complète du thread de 26 tweets de @Azalee_IE (`2061064712393982247`).
  - Téléchargement et hébergement local sur Supabase Storage de tous les médias associés (photos et vidéos).
  - Lettrine (Drop Cap) stylisée sur le premier paragraphe de l'article pour un look éditorial haut de gamme.
  - Mise en forme automatique des blocs de citation (Blockquotes) pour les passages entre guillemets.
  - Intégration de la police *Super Cartoon* sur le titre et les sous-titres de l'article.
  - Ajout d'overlays avec icônes de lecture (Play buttons) sur les vidéos et GIFs animés dans la galerie.
  - Alignement à gauche du texte pour éviter les rivières de blancs inesthétiques issues du texte justifié.
- **Cache local SQLite (Azalée)** :
  - Proxy transparent SQLite pour le wiki réduisant les latences à moins de 100ms.
- **Sécurité et robustesse (Cron)** :
  - Rotation de proxies pour contourner les limitations et protections d'API.
  - Sauvegarde logique PostgreSQL 18 automatisée (`roles.sql`, `schema.sql`, `data.sql`).

## [0.1.0] — 2026-05-17

### Ajouté

- **Monorepo Turborepo + Bun workspaces** avec catalog versions stables (Next 16.2.6, React 19.2.6, TS 6.0.3, Tailwind 4.3.0, Bun 1.3.14).
- **`@rosegriffon/azalee-web`** (apps/azalee) — wiki Inazuma Eleven Victory Road. Extrait de `aphrody-code/vps@apps/azalee` (submodule Vercel `rose-griffon/azalee`).
- **`@rosegriffon/website`** (apps/website) — site principal `rosegriffon.fr`. Extrait de `aphrody-code/vps@apps/rosegriffon` (renommé `website` pour clarté).
- **`@rosegriffon/bot`** (apps/bot) — bot Discord (Bun + discordx + tsyringe DI + canvas). Restauré depuis `aphrody-code/vps@c4d47a683^:apps/rg-bot/`. 15 commandes (8 publiques + 7 admin), 4 services, 7 modules lib (canvas/cache/rbac/audit/embeds/api/db), 2 events Discord.
- **`@rosegriffon/ui`** (packages/ui) — 55 composants shadcn/ui style new-york + 3 hooks (`use-mobile`, `use-media-query`, `useSwipe`) + helper `cn`.
- **`@rosegriffon/db`** (packages/db) — client Supabase partagé (`browser` / `server` / `service`) + `types.gen.ts` (3925 lignes générées par `supabase gen types`).
- **`@rosegriffon/patreon-bun`** (packages/patreon-bun) — vendoré depuis `rose-griffon/patreon-bun` (repo privé inaccessible via `github:` dep). Build OK (`index.js` 118.64 KB).
- **`@rosegriffon/config`** (packages/config) — tsconfig (base, nextjs, bun) + eslint flat configs + oxlintrc + tailwind preset.
- **Infra bot** : `infra/systemd/rg-bot.service` (resource limits 1G/256M, hardening systemd, cgroup v2 weights cohérents avec rpb-bot/shenron côté vps).
- **Script deploy** : `scripts/deploy-bot.sh` (build + rsync vers `~/rg-bot-prod/` + systemctl restart + smoke logs).
- **Docs** : `README.md`, `CLAUDE.md`, `docs/migration-from-vps.md`.

### Décisions architecture

- **Pas de `packages/types`** : les zod schemas dérivés dupliquaient `Tables<'X'>` de `@rosegriffon/db`. Les apps importent directement les types Database de `@rosegriffon/db`.
- **Bot DB double accès** : `supabase` (query builder typé) + `sql` (Bun.SQL Postgres direct via pooler). Choix assumé, pas une transition.
- **Catalog versions stables** : ne pas reprendre `react@canary` / `next@canary` du vps (besoins rpb-bot uniquement). `rg` cible la prod Vercel avec versions LTS.
- **Shim Supabase côté website** : `src/lib/supabase/{client,server}.ts` réexporte `@rosegriffon/db/*` pour préserver les 84 call sites legacy. Migration progressive possible site par site.

### Connu

- Apps `apps/azalee` et `apps/rosegriffon` restent dans `~/vps/` comme submodules figés jusqu'à la bascule manuelle Vercel sur `rose-griffon/rg`.
- Le bot historique utilisait Prisma — remplacé par Supabase shared client + Bun.SQL legacy pour queries complexes.
