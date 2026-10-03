# Déploiement de Shenron

> **Exploitation déléguée.** Depuis la migration décrite dans
> `docs/SHENRON-MIGRATION.md` et
> `docs/PRODUCTION-ALLOCATION.md`, la production (VPS, systemd,
> Nginx, blue/green, backups, rollback) n'est plus pilotée depuis ce dépôt
> mais depuis Infra du monorepo (`config/service-catalog.json`,
> `config/nginx-routes.json`, `config/application-contracts.json`). Voir
> [`docs/operations/shenron/INFRA-DELEGATION.md`](../../../operations/shenron/INFRA-DELEGATION.md) pour le détail de la
> frontière et la liste des fichiers d'ops en cours de retrait. Ce document ne
> garde que ce qui reste local au repo : build, tests et compilation.

## Sommaire

- [Build & tests locaux](#build--tests-locaux)
- [Binaire compilé (local)](#binaire-compilé-local)
- [Gestion des secrets (local)](#gestion-des-secrets-local)
- [CI applicative](#ci-applicative)
- [Scaling / sharding](#scaling--sharding)
- [Ops de production (historique, voir aphrody-infra)](#ops-de-production-historique-voir-aphrody-infra)

---

## Build & tests locaux

```bash
bun install
bun run type-check   # turbo run type-check
bun run lint          # turbo run lint
bun run test:all      # bun scripts/test-all.ts
bun run bot:build     # bun --filter @shenron/bot build
bun run site:build    # bun --filter @shenron/site build
```

Checklist avant de marquer une version prête :

- [ ] `bun run type-check` passe
- [ ] `bun run lint` passe
- [ ] `bun run test:all` passe
- [ ] `.env` local créé depuis `apps/shenron/bot/.env.example` (secrets jamais commités)

---

## Binaire compilé (local)

```bash
bun run compile                         # → dist/shenron (~70 MB), via bun build --compile
```

Le binaire inclut Bun + tout le code JS. Il **n'inclut pas** `data/`,
`assets/cards/` (not in repo), ni `assets/backgrounds/` (not in repo) — à fournir à côté. Les 5 cibles
(linux-x64/arm64, darwin-x64/arm64, windows-x64) sont compilées par
`.github/shenron/workflows/release.yml` sur tag `v*` (SHA256SUMS + GitHub Release).

---

## Gestion des secrets (local)

Règle d'or : **jamais de secret dans git**, jamais de secret dans un log,
jamais de secret dans un arg visible (`ps aux`).

- Local (`.env`) : créé par `scripts/tools/ui/drive/scripts/setup.sh` avec `chmod 600`, ignoré par
  git, lu par Bun via `process.env`.
- **Rotation token Discord volé** : Portail dev → **Bot → Reset Token** → met
  à jour `.env` → redémarrage géré par l'infra (voir
  `docs/operations/shenron/INFRA-DELEGATION.md`).
- **Rotation PAT GitHub volé** : github.com → **Settings → Developer
  settings → Tokens → Revoke** → regen → `gh secret set GH_PACKAGES_TOKEN`.
- Les secrets de production (base de données, tokens d'API, `EnvironmentFile`
  systemd) sont opérateur-managés côté infra, jamais dans ce repo.

---

## CI applicative

| Workflow | Trigger | Fait |
| --- | --- | --- |
| `ci.yml` | push/PR main | type-check, lint, test, build (matrix Ubuntu + macOS) + compile Linux x64 |
| `release.yml` | tag `v*` | Compile 5 cibles, SHA256SUMS, GitHub Release |
| `codeql.yml` | push/PR + hebdo | Scan sécurité JS/TS |
| `update-deps.yml` | hebdo | `bun update` → PR automatique si `bun.lock` change |

Ces workflows valident et publient le code ; ils ne déploient pas en
production (le déploiement est porté par le pipeline Infra du monorepo).

### Conventional Commits

Format recommandé : `<type>(<scope>): <message>`

```
feat(canvas): ajout du podium /top
fix(mod): /jail ne restaure pas les rôles
chore(deps): bun update
docs(readme): section infra
refactor(canvas): extract canvas-kit
test(economy): smoke test /shop
ci: fix GH Packages auth
```

---

## Scaling / sharding

Discord impose **un seul process Gateway par bot** tant qu'on est < 2 500 guilds.

| Nombre de guilds | Config |
| --- | --- |
| 1 - 2 500 | 1 process, single-shard |
| 2 500 - 250 000 | Sharding manuel : définir `totalShards` dans discord.js |
| > 250 000 | Architecture multi-process, Redis pour state partagé (hors scope Shenron) |

Shenron est codé single-shard. Pour sharder il faudra :

1. Passer à `ShardingManager` de discord.js
2. Extraire la DB en service partagé (déjà PostgreSQL, cf. contrats
   Infra du monorepo)
3. Coordination cache (Redis)

**Pour l'instant (< 100 guilds) : n'y touche pas.**

---

## Ops de production (historique, voir aphrody-infra)

Le contenu qui suivait ici (Fly.io, VPS + systemd, Docker/Kubernetes,
pipeline `deploy-fly`/`deploy-vercel`, monitoring VPS, sauvegardes VPS,
rollback bleu/vert) est **historique** : il décrivait un mode d'exploitation
que ce repo ne porte plus. Les commandes qu'il contenait (`fly deploy`,
`systemctl restart shenron`, `scripts/deploy-*`, `scripts/ship-*`,
`scripts/release-dbfr.sh` (not in repo), etc.) sont obsolètes et ne sont pas reproduites ici
pour éviter qu'elles soient exécutées par erreur.

Pour l'état courant de l'exploitation (units systemd, routes Nginx, backups,
rollback, blue/green), se référer à :

- `docs/SHENRON-MIGRATION.md`
- `docs/PRODUCTION-ALLOCATION.md`
- `config/service-catalog.json`
- `config/nginx-routes.json`
- [`docs/operations/shenron/INFRA-DELEGATION.md`](../../../operations/shenron/INFRA-DELEGATION.md) (frontière et liste
  de suppression gated des fichiers d'ops encore présents dans ce repo)
