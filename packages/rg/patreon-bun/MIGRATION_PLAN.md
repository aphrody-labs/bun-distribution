# MIGRATION_PLAN.md — patreon-bun (fork de ghostrider-05/patreon-api.ts v0.19.0)

> Audit généré le 2026-05-01 · n2b 0.4.0 · 53 fichiers scannés · 109 findings

---

## Audit baseline — résultats quantitatifs

### Findings par règle

| Règle                                                                           | Count | Catégorie      | Autofix                  |
| ------------------------------------------------------------------------------- | ----- | -------------- | ------------------------ |
| `imports/bun-native` (vitest→bun:test)                                          | 24    | Tests          | Phase 3 (manuel)         |
| `cli/npm-run`                                                                   | 16    | CI + scripts   | Phase 5 (`--fix`)        |
| `api/process-env`                                                               | 13    | API — SKIP     | déféré (voir note)       |
| `lock/rival` (package-lock.json)                                                | 8     | Lockfiles      | Phase 4 (`--migrate`)    |
| `cli/npm-install`                                                               | 8     | CI + scripts   | Phase 5 (`--fix`)        |
| `cli/npx`                                                                       | 7     | Scripts        | Phase 5 (`--fix`)        |
| `ci/node-version`                                                               | 7     | GitHub Actions | Phase 5 (`--fix`)        |
| `ci/setup-node`                                                                 | 6     | GitHub Actions | Phase 5 (`--fix`)        |
| `tsconfig/module-detection`                                                     | 5     | tsconfig       | Phase 4 (manuel)         |
| `pkg/redundant-dep` (dotenv×3)                                                  | 3     | examples/      | Phase 4                  |
| `tsconfig/*` (target-legacy, no-emit, verbatim, allow-ts-extensions, bun-types) | 5     | tsconfig       | Phase 4                  |
| `imports/node-prefix`                                                           | 1     | Source         | Phase 1 (`--fix`)        |
| `api/sleep-promise`                                                             | 1     | Source         | Phase 2 (`--aggressive`) |
| `ecosystem/express` + `api/express-app`                                         | 2     | examples/      | Phase 2 (manuel)         |
| `cli/npm-publish`, `cli/npm-ci`, `cli/npm-i-D`                                  | 3     | CI             | Phase 5 (`--fix`)        |

**Safe-fix immédiat** (Phase 5 `--fix`) : 47 findings · **Aggressive** : 2 findings · **Manuel/décision** : 60 findings

### Top 10 fichiers les plus problématiques

| Rang | Fichier                                 | Findings |
| ---- | --------------------------------------- | -------- |
| 1    | `.github/workflows/deploy.yml`          | 16       |
| 2    | `.github/workflows/release.yml`         | 8        |
| 3    | `.github/workflows/test.yml`            | 7        |
| 4    | `examples/nodejs-esm/index.js`          | 6        |
| 5    | `.github/workflows/pr.yml`              | 5        |
| 6    | `package.json`                          | 4        |
| 7    | `examples/nodejs-cjs/index.js`          | 4        |
| 8    | `docs/tsconfig.json`                    | 4        |
| 9    | `.github/workflows/resources.yml`       | 4        |
| 10   | `examples/express-webhook/src/index.ts` | 3        |

### Répartition par scope

| Scope       | Findings |
| ----------- | -------- |
| `.github/`  | 40 (37%) |
| `examples/` | 27 (25%) |
| `src/`      | 25 (23%) |
| root        | 7 (6%)   |
| `docs/`     | 6 (5%)   |
| `apps/`     | 5 (5%)   |

Note : les 25 findings dans `src/` sont exclusivement des `imports/bun-native` (vitest dans les tests). Le code source métier (`src/rest/`, `src/payloads/`, `src/schemas/`) ne contient qu'un seul `imports/node-prefix` (manquant) et l'`api/sleep-promise`. La lib core est propre.

---

## Phase 0 — Décisions architecturales (aucun code à toucher)

**Durée estimée** : 1h · **Risk** : low (décisions documentaires)

### 0.1. Dual-runtime Node+Bun vs Bun-only

**Verdict : Bun-only assumé pour ce fork.**

Voir section dédiée en fin de document.

### 0.2. Rename package

Décision : `patreon-api.ts` → `@rose-griffon/patreon-bun`

- Aligner avec la convention org GitHub `rose-griffon`
- Éviter les collisions npm (scope privé)
- Consumer `apps/website` référencera `"@rose-griffon/patreon-bun": "workspace:*"`
- Pas de publish npm public — workspace-only

### 0.3. Périmètre du fork à conserver vs supprimer

| Composant                                             | Décision                              | Raison                          |
| ----------------------------------------------------- | ------------------------------------- | ------------------------------- |
| `src/rest/v2/` — OAuth + API client + webhook         | Conserver + adapter                   | Core du besoin website          |
| `src/payloads/`, `src/schemas/`, `src/utils/`         | Conserver                             | Types JSON:API + utilitaires    |
| `src/__tests__/`                                      | Conserver (adapter vitest→bun:test)   | Coverage existante              |
| `examples/nodejs-cjs/`                                | Supprimer après migration             | CJS inutile en Bun-only         |
| `examples/nodejs-esm/`                                | Garder comme démo                     | Renommer en `examples/bun-esm/` |
| `examples/express-webhook/`                           | Remplacer par `examples/bun-webhook/` | Démontrer `Bun.serve`           |
| `examples/cloudflare-webhook/`                        | Conserver (runtime agnostique)        | fetch global, OK Bun            |
| `apps/discord-bot/`                                   | Hors scope migration                  | Sous-app tierce, ne pas toucher |
| `apps/worker-docs/`                                   | Hors scope migration                  | Docs upstream, non utilisé      |
| `docs/`                                               | Hors scope migration                  | Documentation upstream          |
| `.github/workflows/deploy.yml`, `resources.yml`       | Supprimer ou désactiver               | Pas de publish npm              |
| `.github/workflows/test.yml`, `pr.yml`, `release.yml` | Adapter vers Bun                      | CI interne org                  |

### 0.4. Build : tsup → `bun build`

`tsup` produit CJS + ESM dual exports. En Bun-only, ESM-only suffit.

`bun build` natif produit ESM + déclarations `.d.ts` (via `--dts` ou tsc séparé). La décision de garder ou non `.d.ts` dépend de si on consomme depuis un contexte tsc strict (website utilise `tsc --noEmit`) — oui, les `.d.ts` sont nécessaires. Plan : `bun build --target bun --outdir dist` + `tsc --emitDeclarationOnly` pour les types.

### 0.5. Test runner : vitest → `bun:test`

Le blocage principal est **MSW** (`msw/node`). MSW v2 supporte Bun depuis msw 2.4+ via le même `setupServer` API, mais nécessite que `bun:test` soit compatible avec les hooks `beforeAll`/`afterAll` — ce qui est le cas. Migration viable mais requiert test empirique (voir Phase 3).

### 0.6. Lint : eslint + typescript-eslint → oxlint

Convention vps. eslint-plugin-jsdoc devra être émulé par oxlint ou retiré si non critique.

---

## Phase 1 — Safe rewrites (`n2b --fix`)

**Durée estimée** : 30min · **Risk** : low

Scope : `src/scripts/` uniquement (seul fichier avec `imports/node-prefix`).

```bash
n2b /home/ubuntu/rg/packages/patreon-bun/src/scripts/ --fix
```

| Fichier                            | Règle                 | Action                             |
| ---------------------------------- | --------------------- | ---------------------------------- |
| `src/scripts/v2/openapi/schema.ts` | `imports/node-prefix` | `fs/promises` → `node:fs/promises` |

Gate post-phase : `bun run build && bun run test` (ou équivalent après migration toolchain).

Commit : `fix(imports): préfixer fs/promises avec node: (n2b P1)`

---

## Phase 2 — Aggressive rewrites (`n2b --aggressive` + manuel)

**Durée estimée** : 2h · **Risk** : medium

### 2.1. `api/sleep-promise` — autofix

Scope étroit :

```bash
n2b /home/ubuntu/rg/packages/patreon-bun/src/__tests__/v2/cache.test.ts --aggressive
```

`new Promise(res => setTimeout(res, ms))` → `Bun.sleep(ms)` à la ligne 170.

### 2.2. HMAC-MD5 webhook verify — réécriture manuelle

Fichier : `src/rest/v2/webhooks/verify.ts`

Actuellement :

```typescript
import { createHmac } from "node:crypto";
const hash = createHmac("md5", secret).update(body).digest("hex");
```

Remplacement Bun natif :

```typescript
// Bun supporte HMAC via Web Crypto (SubtleCrypto) — mais MD5 n'est pas dans SubtleCrypto (non-standard).
// Option A : garder node:crypto (compatible Bun, pas de breaking change)
// Option B : implémenter via Bun.CryptoHasher('md5') si disponible en 0.4+
```

**Recommandation : garder `node:crypto` pour HMAC-MD5.** `Bun.CryptoHasher` existe mais l'API HMAC keyed n'est pas exposée nativement de la même façon. `node:crypto` est supporté par Bun, l'import est déjà préfixé `node:` (valide). Pas de gain réel à migrer.

### 2.3. `randomUUID` — réécriture manuelle

Fichier : `src/schemas/v2/mock/data.ts`

```typescript
import { randomUUID } from "node:crypto";
// → supprimer l'import, utiliser crypto.randomUUID() (global Bun)
```

### 2.4. `examples/express-webhook/` — remplacement par `examples/bun-webhook/`

Créer `examples/bun-webhook/src/index.ts` utilisant `Bun.serve()` + `parseWebhookRequest()`. Supprimer `examples/express-webhook/`.

Bun.serve example (skeleton) :

```typescript
import { parseWebhookRequest } from "@rose-griffon/patreon-bun";

Bun.serve({
	port: Number(Bun.env.PORT ?? 3000),
	async fetch(req) {
		const url = new URL(req.url);
		if (url.pathname === "/webhook" && req.method === "POST") {
			const result = await parseWebhookRequest(req, Bun.env.PATREON_WEBHOOK_SECRET!);
			if (!result.verified) return new Response("Unauthorized", { status: 401 });
			console.log(result.event, result.payload);
			return new Response("OK");
		}
		return new Response("Not Found", { status: 404 });
	},
});
```

Commit : `feat(webhook): remplacer express-webhook par Bun.serve natif (P2)`

---

## Phase 3 — Toolchain tests : vitest → `bun:test`

**Durée estimée** : 3-4h · **Risk** : high

C'est la phase la plus risquée. 24 fichiers de tests importent `vitest`. Le setup utilise MSW `msw/node`.

### 3.1. Inventaire des APIs vitest utilisées

Vérifier que toutes les APIs vitest présentes dans `src/__tests__/` ont un équivalent `bun:test` :

| API vitest                                         | Équivalent bun:test             | Statut                   |
| -------------------------------------------------- | ------------------------------- | ------------------------ |
| `describe`, `test`, `expect`, `it`                 | identique                       | OK                       |
| `beforeAll`, `afterAll`, `beforeEach`, `afterEach` | identique                       | OK                       |
| `vi.fn()`, `vi.spyOn()`                            | `mock()`, `spyOn()`             | vérifier                 |
| `vi.mock()`                                        | `mock.module()`                 | breaking change          |
| `clearMocks`, `mockReset`                          | config bun:test                 | vérifier                 |
| Coverage Istanbul                                  | `bun:test --coverage` (v8 only) | perte istanbul           |
| `typecheck: { enabled: true }`                     | non supporté nativement         | perte type-check in test |

### 3.2. MSW compat

MSW `setupServer` (`msw/node`) utilise `@mswjs/interceptors` qui intercepte `node:http`. Sous `bun:test`, Bun utilise sa propre implémentation de `fetch` — l'interception peut ne pas fonctionner de la même façon. **Test empirique obligatoire avant de committer.**

Alternative si MSW incompatible : remplacer par des mocks `fetch` manuels (monkey-patch `globalThis.fetch`).

### 3.3. Procédure

1. Créer branche `migration/p3-bun-test`
2. Remplacer `vitest` imports par `bun:test` dans tous les fichiers `src/__tests__/**/*.ts`
3. Remplacer `vi.fn()` → `mock()`, `vi.spyOn()` → `spyOn()`, `vi.mock()` → `mock.module()`
4. Mettre à jour `vitest.config.mts` → supprimer (ou conserver pour CI legacy)
5. Ajouter `"test": "bun test"` dans `package.json`
6. Tester empiriquement MSW compat
7. Si MSW fail : ouvrir issue, fallback mock fetch

Commit : `feat(tests): migrer vitest → bun:test (P3)`

---

## Phase 4 — `package.json` + tsconfig + lockfiles

**Durée estimée** : 1h · **Risk** : low

### 4.1. `package.json` root

```jsonc
{
	"name": "@rose-griffon/patreon-bun", // rename
	"exports": {
		".": {
			"types": "./dist/index.d.ts",
			"import": "./dist/index.mjs", // drop require CJS
		},
	},
	"scripts": {
		"build": "bun build src/index.ts --outdir dist --target bun && tsc --emitDeclarationOnly",
		"test": "bun test",
		"lint": "oxlint src/ examples/",
		"lint:fix": "oxlint --fix src/ examples/",
		"type-check": "tsc --noEmit",
		// drop: prestart (bunx tsc && node), build:openapi (bunx tsc && node)
	},
	"engines": {
		"bun": ">=1.1.0", // drop node
	},
	"devDependencies": {
		// drop: tsup, vitest, @vitest/coverage-istanbul, eslint, typescript-eslint, eslint-plugin-jsdoc
		// add: oxlint, @types/bun
		// keep: msw, ts-morph, openapi-types, typescript
	},
}
```

### 4.2. Lockfiles

Supprimer tous les `package-lock.json` (8 fichiers trouvés dans sous-répertoires) et générer `bun.lock` :

```bash
find /home/ubuntu/rg/packages/patreon-bun -name "package-lock.json" -not -path "*/node_modules/*"
# Supprimer chacun puis :
bun install
```

### 4.3. `tsconfig.json` root

```jsonc
{
	"compilerOptions": {
		"module": "ESNext", // drop commonjs
		"moduleResolution": "bundler", // pour Bun
		"moduleDetection": "force",
		"verbatimModuleSyntax": true,
		"allowImportingTsExtensions": true,
		"noEmit": true, // Bun émet, tsc type-check only
		"target": "ESNext", // drop ES2020
		"types": ["bun", "@types/node"], // ajouter bun
		// ... garder les flags strict
	},
}
```

### 4.4. `.n2bignore`

Créer `/home/ubuntu/rg/packages/patreon-bun/.n2bignore` :

```
dist/**
tsc-generated/**
node_modules/**
apps/**
docs/**
```

Commit : `chore(pkg): rename @rose-griffon/patreon-bun, ESM-only, bun engines (P4)`

---

## Phase 5 — CI GitHub Actions

**Durée estimée** : 30min · **Risk** : low

### 5.1. Autofix CI

```bash
n2b /home/ubuntu/rg/packages/patreon-bun/.github/workflows/ --fix
```

47 findings couverts : `setup-node` → `oven-sh/setup-bun@v2`, `node-version` → `bun-version: latest`, `bun install` → `bun install`, `npm run` → `bun run`, `npm ci` → `bun install --frozen-lockfile`, `npm publish` → `bun publish`, `npx` → `bunx`.

### 5.2. Workflows à désactiver / supprimer

| Workflow        | Action                                            |
| --------------- | ------------------------------------------------- |
| `deploy.yml`    | Désactiver (pas de publish npm pour fork interne) |
| `resources.yml` | Désactiver (génération docs upstream)             |
| `openapi.yml`   | Évaluer si pertinent                              |
| `test.yml`      | Adapter (Bun, retirer matrix Node)                |
| `pr.yml`        | Adapter (bun install + bun test)                  |
| `release.yml`   | Adapter ou désactiver (no npm publish)            |

### 5.3. Nouveau workflow `ci.yml` minimal

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun run type-check
      - run: bun test
      - run: bun run lint
```

Commit : `ci: migrer GitHub Actions vers oven-sh/setup-bun (P5)`

---

## Phase 6 — Publish strategy

**Durée estimée** : 1h · **Risk** : low

### Options

| Option                            | Avantages                             | Inconvénients                      |
| --------------------------------- | ------------------------------------- | ---------------------------------- |
| A — workspace:\* only, no publish | Zéro friction, intégration native vps | Inutilisable hors monorepo         |
| B — GH Packages org rose-griffon  | Semi-privé, versioning propre         | Setup token GITHUB_TOKEN requis    |
| C — npm public @rose-griffon/\*   | Compatible avec d'autres projets      | Overhead maintenance, scope public |

**Recommandation : Option A (workspace:\* only).**

Le seul consumer est `apps/website`. Aucun besoin de distribution externe. La lib étant un fork spécialisé Bun-only, la publier créerait de la confusion avec l'upstream `patreon-api.ts` (100+ stars, Node-compatible).

Si un jour un autre projet RG en a besoin, basculer vers Option B (GH Packages) en 30 minutes.

### Intégration workspace catalog

Dans `/home/ubuntu/rg/package.json` (root monorepo), ajouter dans `workspaces` :

```json
"packages/patreon-bun"
```

Dans `apps/website/package.json` :

```json
"dependencies": {
  "@rose-griffon/patreon-bun": "workspace:*"
}
```

Commit : `chore(workspace): intégrer @rose-griffon/patreon-bun dans catalog (P6)`

---

## Recommandation : Bun-only vs dual-runtime

### Analyse

**Arguments pour dual-runtime (Node + Bun) :**

- La lib upstream ghostrider-05 cible Node 22+ avec fetch global — elle est déjà quasi dual-compatible
- Le code source métier (`src/rest/`, `src/payloads/`) n'utilise que `fetch` global + `node:crypto` (un seul import) — trivial à maintenir en dual
- Si RG veut un jour contribuer des patches upstream, Bun-only crée une divergence irréconciliable

**Arguments pour Bun-only :**

- Le seul consumer (`apps/website`) tourne sur Bun, pas sur Node
- La convention vps est Bun obligatoire (`CLAUDE.md` parent)
- `tsup` CJS+ESM dual build → `bun build` ESM-only simplifie la toolchain
- Le webhook server gagne `Bun.serve` au lieu d'express (pattern natif)
- `bun:test` + `bun build` + `oxlint` = cohérence totale avec le reste du monorepo

**Verdict : Bun-only.**

Le code source de cette lib est naturellement portable (fetch global, zéro deps npm, `node:crypto` isolé en 2 fichiers). Choisir Bun-only n'implique pas de réécriture massive — c'est surtout une décision de toolchain (build, tests, CI). La valeur ajoutée est la cohérence monorepo et l'exemple `Bun.serve` webhook qui sera directement réutilisable dans `apps/website`.

Si upstream ghostrider-05 évolue et produit des patches intéressants, un cherry-pick ponctuel reste toujours possible malgré la divergence toolchain, car le code source métier (`src/`) sera resté compatible.

---

## Récapitulatif phases + estimations

| Phase     | Contenu                                                   | Durée     | Risk   | Autofix                         |
| --------- | --------------------------------------------------------- | --------- | ------ | ------------------------------- |
| P0        | Décisions archi, rename, scope fork                       | 1h        | low    | —                               |
| P1        | `imports/node-prefix` (1 fichier)                         | 30min     | low    | `n2b --fix`                     |
| P2        | HMAC/randomUUID, `Bun.sleep`, `Bun.serve` webhook example | 2h        | medium | `--aggressive` partiel + manuel |
| P3        | vitest → `bun:test`, MSW compat                           | 3-4h      | high   | manuel                          |
| P4        | `package.json`, tsconfig, lockfiles, rename               | 1h        | low    | manuel                          |
| P5        | GitHub Actions CI → Bun                                   | 30min     | low    | `n2b --fix`                     |
| P6        | Publish strategy, workspace catalog                       | 1h        | low    | manuel                          |
| **Total** |                                                           | **9-10h** |        |                                 |

### Ordre recommandé d'exécution

P0 → P4 → P5 → P1 → P2 → P3 → P6

Raison : commencer par les décisions (P0) + la plomberie package (P4) + CI (P5) avant de toucher le code source, car P4 change la structure de build qui conditionne tous les gates de validation.

---

## Matrice migrer vs garder

| Composant                                | Migrer        | Garder tel quel | Supprimer                 |
| ---------------------------------------- | ------------- | --------------- | ------------------------- |
| `src/rest/v2/` (OAuth, API, webhook)     | P1+P2         | —               | —                         |
| `src/__tests__/`                         | P3            | —               | —                         |
| `src/schemas/v2/mock/` (randomUUID)      | P2            | —               | —                         |
| `examples/express-webhook/`              | —             | —               | P2 (rem. par bun-webhook) |
| `examples/nodejs-cjs/`                   | —             | —               | P4                        |
| `examples/nodejs-esm/`                   | P4 (renommer) | —               | —                         |
| `examples/cloudflare-webhook/`           | —             | Conserver       | —                         |
| `.github/workflows/`                     | P5            | —               | deploy+resources          |
| `tsup.config.ts`                         | —             | —               | P4                        |
| `vitest.config.mts`                      | —             | —               | P3                        |
| `package-lock.json` (×8)                 | —             | —               | P4                        |
| `apps/discord-bot/`, `apps/worker-docs/` | —             | Hors scope      | —                         |

---

## Rapport n2b baseline

Généré dans `/home/ubuntu/rg/packages/patreon-bun/bun/reports/` :

- `n2b-baseline.jsonl` — 109 findings machine-readable
- `n2b-baseline.md` — rapport texte complet
