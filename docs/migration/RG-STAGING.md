<!-- SPDX-License-Identifier: Apache-2.0 -->

# Rose Griffon source staging

RG source remains authoritative at `~/src/rg`. The staged copy in this
repository is source preservation, not a runnable or deployable RG workspace.
The source revision and the SHA-256 of every tracked file are recorded in
[`rg-staging.json`](rg-staging.json). The audit verified 4,241 tracked files.

## Destination map

| RG source                         | Aphrody staging                                                     |
| --------------------------------- | ------------------------------------------------------------------- |
| `apps/*`                          | `apps/rg/*`                                                         |
| `packages/*`                      | `packages/rg/*`                                                     |
| `scripts/*`                       | `scripts/rg/*`                                                      |
| `docs/*`                          | `docs/rg/*`                                                         |
| root files                        | `docs/rg/root/*` (also `config/rg/*` for tracked non-private files) |
| `plugins/*`, `.claude-plugin/*`   | same paths                                                          |
| `.github/*`, `.ops/*`, `.codex/*` | corresponding `rg` subdirectory                                     |

The ten local `.env` files and the RG root `.npmrc` are copied beside their
RG app or package under `apps/rg` and `packages/rg`, with mode `0600`. They are
ignored by Git. Copies of the two root `.env` files and `.npmrc` also exist in
`docs/rg/root` because that directory preserves the requested root snapshot;
they are ignored by Git and must never be staged. The source contains no local
SQLite, PostgreSQL dump, or other database file to import. The tracked assets
and website data are included in the app and package copies.

The source-ignored `AGENTS.md` and `CLAUDE.md` under `apps/website` are copied
under `apps/rg/website` and ignored by Aphrody Git. The 178 ignored generated
Patreon API documentation pages are not part of the tracked source snapshot;
regenerate them from the package when that workspace is qualified.

## Integration gates

- The initial staging report recorded 21 RG packages and seven RG apps outside
  the Aphrody workspace. Root workspace patterns now include `apps/rg/*`,
  `packages/rg/*`, and the nested Patreon examples/docs/worker manifests. The
  RG module currently discovers 33 members; the root catalog includes the RG
  catalog entries, with Aphrody's existing values kept where names overlap.
- The root Bun install now passes with `@aphrody/discordx`; the RG bot imports
  the Aphrody package and its `typecheck` passes. This verifies the TypeScript
  surface only; runtime decorator discovery and command registration still
  need their own parity checks before release.
- A local link audit found 18 unresolved relative links across six copied RG
  Markdown files. Resolve those before promoting the docs to canonical
  Aphrody documentation.
- The TypeScript 7, import/export, lint, format, tests, and build gates now run
  through the RG workspace module. Current checks still expose dependency and
  source-level errors; the staging copy is not yet qualified for release.
- The source RG test run had 1,212 passes and 11 failures; its root typecheck
  failed in `packages/ui/test/presentation-literals.test.ts`. Re-run gates
  after the dependency and path cutover; do not infer runtime parity from the
  file copy.
- Preserve the source checkout and deployed RG release until a clean clone,
  install, tests, build, release packaging, and rollback pass from Aphrody.

The copied `.github/rg/workflows` files are provenance only. GitHub Actions
does not load workflows from that nested path. Production topology remains
owned by `aphrody-infra`.

## Pipeline RG dans Aphrody

Le module `@aphrody/workspace` expose désormais `aphrody-ops rg status`,
`aphrody-ops rg check <gate>`, et `aphrody-ops rg pipeline [--dry-run]`.
La pipeline découvre récursivement les manifests RG puis filtre les résultats
aux membres effectifs des globs `workspaces` racine. Elle exige un contrôle TS
pour chaque membre qui possède un `tsconfig`, audite les imports/dépendances,
puis lance les scripts déclarés ou les commandes de repli pour format, lint,
typecheck et test; elle lance les builds déclarés, un audit N2B avec les fichiers
secrets exclus, et vérifie les liens de `docs/rg`. Le rapport publie les membres retenus, les étapes exécutées et la
couverture. Les gates dépendants de l'installation sont marqués ignorés si
l'installation gelée échoue. Le déploiement reste délégué à `aphrody-infra`.

Les anciens imports `@aphrody-code/bxc`, `@aphrody/bxc` et le paquet absent
`@aphrody/zukan` sont retirés des consommateurs actifs. Les pages rendues
utilisent désormais `WebCdpPage` depuis `@aphrody/agent-browser/cdp`, adossé au
serveur CDP Aphrody Web. Les recherches web du service utilisent DuckDuckGo
HTML; `scrape.page` renvoie le texte visible du DOM, sans conversion Markdown
par le moteur Rust. `web-recon` conserve son crawl de pages/ressources et son
HAR synthétique issu des sondes HTTP, mais n'expose plus la détection DNS /
Wappalyzer de BXC. Le contrat de ces limites est décrit dans
`packages/rg/cron/src/tasks/ie-crawl/scrape-service.ts`.

`@aphrody/x` reste le propriétaire des appels X et de la session. Les anciens
profils `static/http` ne sont plus exposés dans la commande Discord : le serveur
CDP est géré à l'échelle du service Aphrody Web.

La génération de `bun.lock` est résolue via `discordx` standard en `catalog:`,
utilisé par le bot RG: les décorateurs et l'enregistrement de commandes sont
fournis par `discordx@11.13.3`. L'intégration de l'owner Discord est vérifiée.
Le filtre Bun `minimumReleaseAge` bloque aussi Oxlint 1.86.0 et Oxfmt 0.71.0
pendant les trois jours suivant leur publication; la politique de fraîcheur
n'a pas été contournée.

Les gates bloquants sont: terminer l'owner Discord, régénérer `bun.lock` avec
Bun 1.4.2, corriger les résultats de l'audit imports/exports et de format/lint,
puis exécuter `bun run rg:pipeline` intégralement en CI.
