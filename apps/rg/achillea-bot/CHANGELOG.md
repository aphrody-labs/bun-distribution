# CHANGELOG — achillea-bot

## 2026-06-09 — audit : durcissements, robustesse & formats de tournoi

- **Tournois** : déblocage des formats **élimination double** et **round-robin** (en plus de
  l'élimination simple) — l'avancement (winner/loser bracket, classement round-robin) est délégué
  à `brackets-manager` ; tests in-memory des 3 formats. Le format suisse garde son flux dédié.
- **Migration CLI réparée** : `Rel<T>` sur toutes les relations d'entités (fin de la migration
  MikroORM 6→7) → `bunx mikro-orm migration:*` ne plante plus (TDZ d'imports circulaires).
- **Sécurité** : auth `CookieAuthorize` + fileFilter/limite multer + anti-traversal sur
  `/proxy/{upload,delete}` ; **CORS Socket.IO** restreint à l'allowlist `WEB_ALLOWED_ORIGINS`.
- **Ranked robustesse** : validation du `mode` (2/4) et du `forfeitUserId` (joueur du lobby) ;
  **Saison 1** active + rattachement des comptes ; **cron 4h** d'annulation des lobbies `Ongoing`
  abandonnés (préserve les litiges).
- **Cohérence** : fallback « Non classé » (fin de « Unranked ») ; `await Promise.all`
  (OrganizationService) ; `console.log/debug` → `console.info/error` (warnings lint purgés).

## 2026-06-09 — refonte paliers FR, canvas ARM64 & durcissements

- **Ranked — paliers** : remplacement du barème Valorant anglais par **11 paliers FR**
  (Fer → Légendaire, **Rubis** inclus) avec leurs images Achillea (GDrive) et gradients
  5 couleurs ; seuils Fer 0-49 · Bronze 50-199 · Argent 200-399 · Or 400-599 · Platine
  600-799 · Diamant 800-999 · Émeraude 1000-1199 · Rubis 1200-1399 · Divin 1400-1699 ·
  Supernova 1700-2099 · Légendaire 2100+. Voir `docs/ranked.md`.
- **Ranked — départ à 0** : `baseRating` 1000 → **0** (le rating est clampé à 0, jamais
  négatif) + **reset complet de la ladder** (migration `Migration20260609000000` :
  re-seed `rank`, `user_elo` remis à 0, `season.config.baseRating` à 0).
- **Canvas ARM64** : support des serveurs aarch64 via `@aphrody/canvas-linux-arm64-gnu`
  (drop-in du binaire `@napi-rs/canvas` officiel) en `optionalDependency`.
- **Fix CLI migration** : `Rel<T>` appliqué à **toutes** les relations d'entités (32 fichiers)
  → `bunx mikro-orm migration:*` ne plante plus sur les TDZ d'imports circulaires.
- **Cohérence FR** : fin des fallbacks `"Unranked"` (clé morte) → **« Non classé »**
  (UserService, ClanService, embeds, mapping image web).
- **Durcissements** : `await Promise.all` (OrganizationService) ; validation d'`id`
  anti path-traversal sur `GET /proxy/delete/:id`.

## 2026-06-06 — monorepo, packages publics & ranked « double validation »

- **Dépendances** : migration des scopes privés `@rpbey/*` / `@aphrody-code/*` vers les
  **packages publics `@aphrody/*`** (discordx, importer, pagination, utilities, canvas) sur
  npmjs — **aucun token requis à l'install**.
- **Monorepo** : le bot est désormais workspace du monorepo `rose-griffon/achillea`
  (`apps/achillea-web` + `apps/achillea-bot` + `packages/achillea-types` + `packages/achillea-core`), runner natif Bun
  (Turborepo retiré).
- **Base Supabase-first** : plus de PostgreSQL local ; connexion via session pooler 5432.
- **Ranked** : fin de match en **double validation** (les deux joueurs saisissent le score,
  preuve par capture en cas de litige), **arbitrage staff** (commande Discord `ranked-admin`
  et onglets de l'admin web), et **télémétrie** (`ranked_match_event`).
- **Nouveaux domaines exposés** : **licences** (QR + page de vérification publique) et
  **wallet** (solde + historique de transactions), côté API bot et web.
- **Sécurité** : RLS sur `ranked_match_event`, secret interne exigé sur `emit-match-found`,
  upload de preuve restreint aux images, vues SQL en `security_invoker`.

## v2.0.0 — 2026-04-25 (Bun-first migration)

Migration complète Node.js → Bun + adoption `@rpbey/discordy` + perfection code-quality.

### Breaking changes

- **Runtime cible** : Bun 1.3+ (Node n'est plus supporté)
- **Imports** :
  - `discordx` → `@rpbey/discordx`
  - `@discordx/importer` → `@rpbey/importer`
  - `@discordx/pagination` → `@rpbey/pagination`
  - `@discordx/utilities` → `@rpbey/utilities`
- **`engines.bun >= 1.3`** au lieu de `engines.node >= 22`
- **`mikro-orm.useTsNode: false`** (Bun runs TS natively)
- **Workspace** : `apps/achillea-bot` est maintenant workspace member du monorepo `~/vps` (résolution `@rpbey/*` via `packages/discordy/packages/*`)

### Sécurité

- **CVE critical** [GHSA-gwhv-j974-6fxm](https://github.com/advisories/GHSA-gwhv-j974-6fxm) résolue : SQL Injection dans mikro-orm < 6.6.10
- **8 CVE high** transitifs `tar` < 7.5.7 résolus via bump mikro-orm

### Bumps majeurs

- `@mikro-orm/*` 6.4 → **6.6.13**
- `discord.js` 14.21 → **14.26.3**
- `tsyringe` 4.8 → **4.10**
- `@tsed/*` 7.84 → **7.87.9**
- `bullmq` 5.63 → **5.76.2**
- `ioredis` 5.8 → **5.10.1**
- `socket.io` 4.8 → **4.8.3**
- `puppeteer` 24.11 → **24.42.0**
- `sharp` 0.34.4 → **0.34.5**
- `axios` 1.8 → **1.15**

### Drop deps Node-only

- `cross-env` (utiliser `NODE_ENV=x bun ...`)
- `dotenv` (Bun load `.env` natif)
- `nodemon` (utiliser `bun --watch`)
- `ts-node` (Bun runs TS natively)
- `npm-run-all` (utiliser `bun run`)
- `rimraf` (utiliser `rm -rf`)
- `fs ~0.0.1-security` (package squat factice)
- `@types/ioredis` (typé natif depuis ioredis 5)

### Modernisation Bun-natif

- `mikro-orm.config.ts` : drop `@ts-nocheck` + `dotenv/config` + `process.env` → `Bun.env`
- `bunfig.toml` (nouveau) — config install/run/test centralisée
- `.dockerignore` (nouveau) — anti-leak `.env`, `.credentials.json`, lockfiles npm

### Toolchain

- **Linter** : eslint → **oxlint 1.61** (50–100× faster) + `oxlint-tsgolint` pour type-aware
- **`.oxlintrc.json`** : 7 plugins (eslint, typescript, import, oxc, promise, unicorn, node), categories correctness=error
- **CI workflow** : `oven-sh/setup-bun@v2` + `actions/checkout@v4`, ordre install → type-check → lint → build

### Tsconfig

- `target: ES2021` → **`ES2022`**
- `module: CommonJS` → **`ESNext`**
- `moduleResolution: node` → **`Bundler`**
- Ajout `moduleDetection: "force"` (chaque fichier ESM)
- Ajout `types: ["bun"]`
- `skipLibCheck: false` → **`true`** (résout 11 erreurs `bun-types` cache)
- Path aliases avec `./` prefix (compat tsgolint type-aware)
- Suppression bloc `ts-node`

### Docker

- `oven/bun:20-alpine` → **`oven/bun:1.3-alpine`**
- `npm prune` → `bun install --production --frozen-lockfile`
- `CMD ["npm", "run", "start"]` → `CMD ["bun", "run", "start"]`
- `COPY package-lock.json` → `COPY bun.lock`

### Code quality

- **0 erreurs TS** (`bunx tsc --noEmit`) — était 11 (false positives `bun-types` cache)
- **0 erreurs oxlint** (`bun run lint`) — était 49 (40 tsconfig-error + 5 no-useless-escape + 4 promise valid-params)
- **0 warnings oxlint** — était 762 (353 consistent-type-imports auto-fixé + désactivation rules pattern TSed/decorator)
- 4 `.catch()` vides → `.catch(() => null)`
- 2 `prefer-array-find` : `.filter(...)[0]` → `.find(...)`
- 1 `eqeqeq` : `!=` → `!==`

---

## Commits clés

- `6078637` — chore: migration vers les forks @rpbey/discordy (PR #2)
- `330bfb1` — chore: migration npm→Bun (PR #1, squash)
- `9c7defe` — chore(lint): oxlint + type-aware via tsgolint
- `98bdbea` — fix(docker,scripts): runtime Bun-natif
- `89db007` — docs(readme): refonte runtime Bun

---

## Historique TSCord

Pour les versions antérieures (basées sur le template `barthofu/tscord` v2.4), voir l'historique git ou le [CHANGELOG du template upstream](https://github.com/barthofu/tscord/blob/main/CHANGELOG.md).
