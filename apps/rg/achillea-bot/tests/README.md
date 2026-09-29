# Achillea Bot — Tests

Stack de tests **Bun-native** ([bun.com/docs/test](https://bun.com/docs/test)), **Supabase-first**.
Pas de Postgres local, pas de driver SQLite MikroORM (`better-sqlite3` n'est pas supporté
sous Bun). Les données de test sont consommées de deux façons :

- **offline / déterministe** — un snapshot SQLite local lu via `bun:sqlite` ;
- **online / réseau** — une instance Supabase de test explicitement configurée via `fetch`.

## Architecture

```
tests/
├── README.md
├── setup.ts                       # Préchargé via bunfig.toml::test.preload (globals TEST_*, reflect-metadata)
├── fixtures/
│   ├── snapshot.ts                # Helper bun:sqlite : openSnapshot / describeWithSnapshot / countRows
│   ├── live-db.ts                 # Gating live-DB : describeLive / hasLiveDb (actifs si TEST_DB_URL est défini)
│   └── supabase-snapshot.sqlite   # Snapshot de test local (GITIGNORÉ et non importé)
├── supabase/
│   ├── supabase-rls.test.ts       # ONLINE  — RLS sur une instance de test explicitement configurée
│   ├── api-contract.test.ts       # ONLINE  — contrats HTTP publics consommés par le web (skip si API injoignable)
│   └── snapshot.test.ts           # OFFLINE — contrat de données + surface de lecture web (vues)
├── db/
│   └── integrity.test.ts          # OFFLINE — intégrité (relations, FK, format) sur le snapshot
├── unit/                          # PUR — import-casters, ranked-auth (JWT), ranked-elo (logique pure)
├── services/                      # live-DB (describeLive) — skippés sans TEST_DB_URL ; certains à binding natif (canvas)
├── entities/                      # live-DB (describeLive) — Cast, Sanction (skippés sans TEST_DB_URL)
└── controllers/                   # AuthController — binding natif (argon2/canvas), hors-gate CI
```

Trois catégories de gating :

- **OFFLINE snapshot** (`db/`, `supabase/snapshot.test.ts`) → tournent dès que le `.sqlite` est
  présent, sinon `describeWithSnapshot` skippe ;
- **ONLINE réseau** (`supabase/supabase-rls.test.ts`) → exige `TEST_SUPABASE_URL` et
  `TEST_SUPABASE_KEY`, puis skippe intégralement si l'une manque ; `api-contract.test.ts`
  conserve son propre gate de disponibilité HTTP ;
- **live-DB / binding natif** (`services/`, `entities/`, `controllers/`) → `services`/`entities`
  exposent des blocs `describeLive` qui ne s'activent qu'avec `TEST_DB_URL` (cf. `fixtures/live-db.ts`),
  et `controllers`/certains services chargent des bindings natifs (argon2/canvas) absents du runner CI.
  Ces trois dossiers sont **hors du périmètre CI** (voir plus bas).

## Le snapshot SQLite

Les helpers et contrats de test du snapshot SQLite sont conservés, mais aucun snapshot ni
script de dump n'est inclus dans ce portage. Les suites restent **rapides, offline et sans
credentials Postgres** lorsqu'un snapshot de test explicitement fourni est disponible.

Surcharge (env) : `SUPABASE_SNAPSHOT_PATH` (chemin lu par les tests).

> Le `.sqlite` n'est **jamais committé** (cf. `.gitignore`).
> Les suites qui en dépendent se **skippent** automatiquement s'il est absent
> (`describeWithSnapshot`) — un clone frais / la CI sans dump restent verts.

### Pattern d'usage

```ts
import { describeWithSnapshot, countRows } from "../fixtures/snapshot";

describeWithSnapshot("ma suite", (db) => {
	test("…", () => {
		const n = countRows(db(), "clan"); // db() → bun:sqlite Database (readonly)
		expect(n).toBeGreaterThan(0);
	});
});
```

## Run

```bash
bun test                  # toute la suite
bun test --bail=1         # arrête au 1er fail
bun test --watch          # watch dev

# Raccourcis package.json
bun run test:supabase     # tests/supabase/ (online + offline)
bun run test:snapshot     # tests/db/ + snapshot.test.ts (offline pur)
bun run test:db           # tests/db/
bun run test:unit         # tests/unit/
bun run test:ci           # JUnit XML + bail 10
bun run test:coverage     # lcov + text
```

## Configuration

`bunfig.toml::[test]` précharge `tests/setup.ts`, qui n'expose plus que des globals
d'infrastructure (et `reflect-metadata`) :

- `TEST_BASE_URL` (override `process.env.TEST_BASE_URL`)
- `TEST_DB_URL` (optionnel — branche Supabase de test ; vide par défaut, Supabase-first).
  Pilote le gating live-DB : `fixtures/live-db.ts` expose `hasLiveDb` + `describeLive`
  (= `describe.skip` tant que `TEST_DB_URL` est vide) ; les blocs d'écriture de `services/`
  et `entities/` s'enveloppent dedans → silencieux sur un clone frais / en CI.
- `TEST_SOCKET_URL` (override `process.env.TEST_SOCKET_URL`)

Et pour les tests Supabase :

- `TEST_SUPABASE_URL` / `TEST_SUPABASE_KEY` (toutes deux obligatoires ; aucun défaut prod)

## Couverture des suites de données

### `tests/supabase/supabase-rls.test.ts` (ONLINE)

Tape uniquement l'API PostgREST de test configurée : lecture anon ouverte (rank, user_view, clan, user_elo, event),
masque des tokens `user_connection` (`access_token`/`refresh_token` → 401 `42501`),
écritures anon refusées (INSERT rank → 401).

### `tests/supabase/api-contract.test.ts` (ONLINE)

Contrats HTTP publics consommés par le web Angular, contre l'API réellement déployée :
endpoints de **lecture** (health, paliers ranked, tournois, clans, leaderboard) + garde-fous
**sécu** sans état (auth requise, anti open-redirect sur le flow OAuth Discord, backdoor de test
404 en prod) + image OpenGraph servie par le front. Zéro base live / zéro binding natif.
Bases surchargeables par env (`API_BASE`, `OG_BASE`) ; `describe.skipIf` si l'API/le front sont
injoignables (CI hors-ligne) → la suite reste verte sans faux négatif.

### `tests/supabase/snapshot.test.ts` (OFFLINE)

Contrat des **vues consommées par le web** : `user_view` (Discord IDs, displayName, elo),
`leaderboard_view` (rang min = 1, rang non décroissant, elo non croissant par mode),
`tier_view` (couverture continue des paliers), `clan_list_view` (alignée sur `clan`),
`homepage_stat_view`. Vérifie aussi qu'**aucune** relation n'expose de colonne
`*_token`/`secret`/`password`.

### `tests/db/integrity.test.ts` (OFFLINE)

Intégrité sur données de test : relations critiques présentes, 11 paliers de rank croissants,
volumétrie (≥ 450 users, ≥ 35 clans, ≥ 440 memberships), organization Achillea + owner,
cohérence des FK (aucun orphelin), formats (Discord IDs `^\d{17,19}$`, `clan.founders` non vide,
`clan.name` non vide), présence des vues.

## CI/CD

`.github/workflows/ci.yml` (Bun `1.3.14` via `oven-sh/setup-bun@v2`, install `--frozen-lockfile`)
enchaîne deux jobs :

- **`check`** — lint (oxlint) + type-check (tsc) + format (oxfmt) + build, garde anti-dérive du
  et `check:imports`.
- **`test`** — pour le bot : `cd apps/achillea-bot && bun test tests/db/ tests/supabase/ tests/unit/ --bail=10`
  (+ tests `packages/achillea-core` et `apps/achillea-web`).

Le périmètre bot est donc **`tests/db` + `tests/supabase` + `tests/unit`**. Sont volontairement
**exclus** : `services/`/`entities/` (live-DB, skippés sans `TEST_DB_URL`) et `controllers/`
(binding natif argon2/canvas non chargé sous le Bun de la CI). Les suites **offline** (snapshot)
se skippent sans dump ; `supabase-rls` se skippe sans les deux variables `TEST_SUPABASE_*`,
et `api-contract` conserve son gate de disponibilité HTTP. Pour les suites offline, fournir
explicitement `SUPABASE_SNAPSHOT_PATH` vers un snapshot de test non versionné.
