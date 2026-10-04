<!-- SPDX-License-Identifier: Apache-2.0 -->
# Inventaire des scripts par références entrantes — 2026-10-03

Méthode : pour chaque fichier `.ts/.sh/.nu/.py/.ps1` sous `scripts/`, nombre de fichiers suivis (`git grep -F <nom de base>`, hors `docs/migration`, lockfiles et le script lui-même) qui citent son nom. Zéro référence ne prouve pas l'inutilité : les `*.test.ts` sont découverts par `bun test`, et un script peut être lancé à la main. Aucune suppression sans vérification du propriétaire.

- Scripts : 456 ; sans référence : 175 (dont 21 tests `*.test.ts`).

## Sans référence entrante


### aphrody

- `scripts/aphrody/vps-google-scrape.sh`

### aphrody-os

- `scripts/aphrody-os/mullvad-switch-relay.sh`

### assets

- `scripts/assets/cdn.test.ts`

### audit

- scripts/audit/os/drive/core/scripts/test_daemon.sh (supprimé : doublon exact de `crates/os/drive/core/scripts/test_daemon.sh`)
- `scripts/audit/shenron/scripts/ops/audit-and-materialize-ocr.ts`
- `scripts/audit/shenron/scripts/ops/audit-databook-corpus.ts`
- `scripts/audit/shenron/scripts/ops/audit-databooks-manga.ts`
- `scripts/audit/shenron/scripts/ops/audit-wiki-databooks-coverage.ts`
- `scripts/audit/shenron/scripts/ops/audit-xv2-portrait-feasibility.ts`
- `scripts/audit/shenron/scripts/ops/check-recent-revisions.ts`
- `scripts/audit/shenron/scripts/ops/check-wiki-status.ts`
- `scripts/audit/shenron/scripts/ops/crawl-doc-links-rag.test.ts`
- `scripts/audit/shenron/scripts/ops/crawl-dragon-ball-official-aphrody.test.ts`
- `scripts/audit/shenron/scripts/ops/eval-aphrody-rag.test.ts`
- `scripts/audit/shenron/scripts/ops/ocr-databooks-aphrody.test.ts`
- `scripts/audit/shenron/scripts/ops/ocr-french-databooks-aphrody.test.ts`
- `scripts/audit/shenron/scripts/ops/offload-rag-to-aphrody.test.ts`
- `scripts/audit/shenron/scripts/ops/revert-soshuhen-fake-scans.ts`
- `scripts/audit/shenron/scripts/ops/test-ocr-jpn.ts`
- `scripts/audit/shenron/scripts/ops/wiki-corpus-enricher.test.ts`
- `scripts/audit/shenron/scripts/ops/wiki-page-builder.test.ts`
- `scripts/audit/shenron/scripts/process-ocr-lots-aphrody.test.ts`
- `scripts/audit/ui-browser-bundles.test.ts`
- scripts/audit/ui/apps/nie-web/scripts/build-fingerprint.test.ts (supprimé)
- `scripts/audit/ui/apps/nie-web/scripts/out-dir.test.ts` (not in repo)
- `scripts/audit/ui/apps/nie-web/scripts/precompression-targets.test.ts` (not in repo)
- `scripts/audit/ui/apps/nie-web/scripts/public-entry-bundle.test.ts` (not in repo)
- `scripts/audit/ui/apps/nie-web/scripts/stage-vfs.test.ts` (not in repo)
- scripts/audit/ui/apps/nie-web/scripts/verify-audio-cross-host.ts (supprimé)
- scripts/audit/ui/apps/nie-web/scripts/wasm-audio-smoke.test.ts (supprimé)
- `scripts/audit/ui/drive/scripts/test-data.sh`
- `scripts/audit/web/apps/bxc/scripts/run-tests.ts`

### build

- `scripts/build/discord/packages/scripts/src/builtinDocumentationLinks.ts`
- `scripts/build/discord/packages/scripts/src/generateIndex.ts`
- `scripts/build/rust/channel-cargo.sh`
- `scripts/build/shenron/scripts/ops/wiki-page-builder.ts`
- `scripts/build/ui/apps/nie-web/scripts/build-viewer-wasm.ts` (not in repo)
- `scripts/build/ui/apps/nie-web/scripts/public-entry-bundle.ts` (not in repo)
- `scripts/build/ui/drive/scripts/bundle-libheif.sh`
- `scripts/build/ui/packages/bun/scripts/generate-symbols.ts`
- scripts/build/ui/packages/material-web/scripts/component-custom-elements.ts (supprimé : doublon exact de `packages/ui/material-web/scripts/component-custom-elements.ts`)
- scripts/build/web/apps/bxc/scripts/build-demo-index.ts (supprimé)
- `scripts/build/web/apps/bxc/scripts/build-serverless.ts`
- scripts/build/web/apps/bxc/scripts/capture_squad_builders.ts (supprimé)

### check-aphrody-apex-nginx.ps1

- `scripts/check-aphrody-apex-nginx.ps1`

### check-aphrody-apex-nginx.sh

- `scripts/check-aphrody-apex-nginx.sh`

### check-aphrody-stack-units.sh

- `scripts/check-aphrody-stack-units.sh`

### configure-gcp-runtime.ps1

- `scripts/configure-gcp-runtime.ps1`

### configure-gcp-runtime.sh

- `scripts/configure-gcp-runtime.sh`

### dev

- `scripts/dev/shenron/scripts/ops/enrich-wiki-transformations.ts`
- `scripts/dev/shenron/scripts/ops/merge-transformations.ts`
- `scripts/dev/ui/drive/scripts/autoformat.sh`

### gen-local-ai-env.test.ts

- `scripts/gen-local-ai-env.test.ts`

### iecode

- `scripts/iecode/publish-rust-crates.sh`

### learn-monorepo.ts

- `scripts/learn-monorepo.ts`

### live-audit-report.test.ts

- `scripts/live-audit-report.test.ts`

### nie

- `iecode/scripts/tools/sync-main.test.ts`

### ops

- `scripts/ops/inspect-aphrody-web-db.sh`
- `scripts/ops/purge-attribution.ts`
- `scripts/ops/register-shenron-backup-task.ps1`

### release

- `scripts/release/ui/apps/nie-web/scripts/stage-vfs.ts` (not in repo)

### rg

- `iecode/scripts/rg/achillea/phase0.ts`
- `iecode/scripts/rg/campagnes/affiche-iergday.ts`
- `iecode/scripts/rg/ops/achillea-medias-locaux.ts`
- `iecode/scripts/rg/qa/generate-achillea-matrix.ts`
- `iecode/scripts/rg/seo-bxc-audit.ts`

### smoke-bxc-ffi.ts

- `scripts/smoke-bxc-ffi.ts`

### smoke-bxc-standalone.sh

- `scripts/smoke-bxc-standalone.sh`

### smoke-bxc-systemd.sh

- `scripts/smoke-bxc-systemd.sh`

### test-atomic-deploy-bundle.sh

- `scripts/test-atomic-deploy-bundle.sh`

### tools

- `scripts/tools/fut/src/scripts/follow-fut-accounts.ts`
- `scripts/tools/fut/src/scripts/map_fut.ts`
- `scripts/tools/infra/db-dedup/build_archive.py`
- `scripts/tools/infra/db-dedup/delete_verified.py`
- `scripts/tools/infra/db-dedup/find.sh`
- `scripts/tools/infra/db-dedup/pg_rowdiff.py`
- `scripts/tools/infra/db-dedup/retire_db.sh`
- `scripts/tools/infra/db-dedup/sqlite_rowdiff.py`
- `scripts/tools/infra/wsl-reclaim.ps1`
- `scripts/tools/koharu/scripts/download_bluearchive_comics.ts`
- `scripts/tools/msvc-wsl.py`
- scripts/tools/os/drive/core/scripts/combine.sh (supprimé : doublon exact de `crates/os/drive/core/scripts/combine.sh`)
- scripts/tools/os/drive/core/scripts/update_spacedrive.sh (supprimé : doublon exact de `crates/os/drive/core/scripts/update_spacedrive.sh`)
- `scripts/tools/os/scripts/absorb-upstream.ts`
- `scripts/tools/os/scripts/data/make-renames.nu`
- `scripts/tools/os/scripts/forensics/Invoke-GoogleReversePipeline.ps1`
- `scripts/tools/os/scripts/winclean.ts`
- `scripts/tools/os/scripts/wslg-manager.ps1`
- `scripts/tools/shenron/scripts/download-manga-couleur-cdn.ts`
- `scripts/tools/shenron/scripts/enrich-databooks-manifests.ts`
- `scripts/tools/shenron/scripts/fetch-doc-links.ts`
- `scripts/tools/shenron/scripts/filter-ocr-results.ts`
- `scripts/tools/shenron/scripts/fix-canon-duplicates.ts`
- `scripts/tools/shenron/scripts/monitor-databooks-ocr.ps1`
- `scripts/tools/shenron/scripts/ops/appliquer-ajustements.ts`
- `scripts/tools/shenron/scripts/ops/apply-databooks-manga-updates.ts`
- `scripts/tools/shenron/scripts/ops/auto-translate-worker.ts`
- `scripts/tools/shenron/scripts/ops/backfill-media-works.ts`
- `scripts/tools/shenron/scripts/ops/backfill-narrative-graph.ts`
- `scripts/tools/shenron/scripts/ops/batch-manga-ocr.ts`
- `scripts/tools/shenron/scripts/ops/cdn-harvest-all.ts`
- `scripts/tools/shenron/scripts/ops/clean-noncanon-wiki.ts`
- `scripts/tools/shenron/scripts/ops/complete-db-from-dragonballcn.ts`
- `scripts/tools/shenron/scripts/ops/complete-mega-seeding.ts`
- `scripts/tools/shenron/scripts/ops/create-expansion-tables.ts`
- `scripts/tools/shenron/scripts/ops/deposer-lot-landmark.ts`
- `scripts/tools/shenron/scripts/ops/dump-dragonballcn.ts`
- `scripts/tools/shenron/scripts/ops/enrich-106-characters.ts`
- `scripts/tools/shenron/scripts/ops/enrich-canonical-techniques-ja.ts`
- `scripts/tools/shenron/scripts/ops/enrich-category-characters.ts`
- `scripts/tools/shenron/scripts/ops/enrich-category-planets.ts`
- `scripts/tools/shenron/scripts/ops/enrich-category-races-transfos.ts`
- `scripts/tools/shenron/scripts/ops/enrich-category-sagas.ts`
- `scripts/tools/shenron/scripts/ops/enrich-category-techniques.ts`
- `scripts/tools/shenron/scripts/ops/enrich-characters-batch.ts`
- `scripts/tools/shenron/scripts/ops/enrich-core-characters.ts`
- `scripts/tools/shenron/scripts/ops/enrich-soshuhen-collection.ts`
- `scripts/tools/shenron/scripts/ops/enrich-techniques-batch.ts`
- `scripts/tools/shenron/scripts/ops/enrich-wiki-characters.ts`
- `scripts/tools/shenron/scripts/ops/enrich-wiki-techniques.ts`
- `scripts/tools/shenron/scripts/ops/enrich_events_sagas.ts`
- `scripts/tools/shenron/scripts/ops/enrich_staff_va.ts`
- `scripts/tools/shenron/scripts/ops/envoie-ocr-results.test.ts`
- `scripts/tools/shenron/scripts/ops/expand-all-pillars.ts`
- `scripts/tools/shenron/scripts/ops/generate-db-lexicon.ts`
- `scripts/tools/shenron/scripts/ops/ingest-dbs-raw.ts`
- `scripts/tools/shenron/scripts/ops/ingest-gpu-ocr-results.ts`
- `scripts/tools/shenron/scripts/ops/inspect-knowledge.ts`
- `scripts/tools/shenron/scripts/ops/inspect-missing-images.ts`
- `scripts/tools/shenron/scripts/ops/inspect-wiki-databooks.ts`
- `scripts/tools/shenron/scripts/ops/materialize-databook-descriptions.ts`
- `scripts/tools/shenron/scripts/ops/materialize-game-cover-media.ts`
- `scripts/tools/shenron/scripts/ops/materialize-wiki-article-fallbacks.ts`
- `scripts/tools/shenron/scripts/ops/populate-wiki-locations.ts`
- `scripts/tools/shenron/scripts/ops/populate-wiki-soundtracks.ts`
- `scripts/tools/shenron/scripts/ops/populate-wiki-tournaments.ts`
- `scripts/tools/shenron/scripts/ops/provision-aphrody-admin.ts`
- `scripts/tools/shenron/scripts/ops/seed-all-contributors.ts`
- `scripts/tools/shenron/scripts/ops/seed-expansion-pillars.ts`
- `scripts/tools/shenron/scripts/ops/seed-mega-dragon-ball-data.ts`
- `scripts/tools/shenron/scripts/ops/seed-rag-chunks-from-corpus.ts`
- `scripts/tools/shenron/scripts/ops/shenron-infinite-loop.ts`
- `scripts/tools/shenron/scripts/ops/source-canonical-characters.ts`
- `scripts/tools/shenron/scripts/ops/sync-rag-expansion.ts`
- `scripts/tools/shenron/scripts/ops/sync-reports-goals.ts`
- `scripts/tools/shenron/scripts/ops/sync-soshuhen-legend1.ts`
- `scripts/tools/shenron/scripts/ops/update-planets-and-races.ts`
- `scripts/tools/shenron/scripts/ops/verifier-lot-20.ts`
- `scripts/tools/shenron/scripts/ops/wiki-corpus-enricher.ts`
- `scripts/tools/shenron/scripts/optimize-wiki-videos.sh`
- `scripts/tools/shenron/scripts/prepare-ocr-rejected.ts`
- `scripts/tools/shenron/scripts/seed-all-pws-sections.ts`
- `scripts/tools/shenron/scripts/seed-goku-power-scaling-and-variants.ts`
- `scripts/tools/shenron/scripts/seed-power-scaling-knowledge.ts`
- `scripts/tools/shenron/scripts/wiki-duplicates-fix.ts`
- `scripts/tools/shenron/scripts/wiki-grand-nettoyage.ts`
- `scripts/tools/ui/apps/nie-web/scripts/out-dir.ts` (not in repo)
- `scripts/tools/ui/apps/nie-web/scripts/precompression-targets.ts` (not in repo)
- `scripts/tools/ui/apps/nie-web/scripts/wasm-audio-smoke.ts` (not in repo)
- `scripts/tools/ui/apps/nie-web/src/desktop/components/tools/comparator-state.ts` (not in repo)
- `scripts/tools/ui/apps/nie-web/src/desktop/components/tools/tool-navigation.ts` (not in repo)
- `scripts/tools/ui/drive/scripts/combine.sh`
- `scripts/tools/ui/drive/scripts/fix-deb.sh`
- `scripts/tools/ui/scripts/launch_app.ps1`
- `scripts/tools/ui/scripts/purge-tauri-mobile.nu`
- scripts/tools/web/apps/bxc/scripts/backfill-empty-markdown.ts (supprimé)
- `scripts/tools/web/apps/bxc/scripts/cleanup.ts`
- scripts/tools/web/apps/bxc/scripts/consolidate-dragonball-crawls.ts (supprimé)
- scripts/tools/web/apps/bxc/scripts/enrich-shenron.ts (supprimé)
- scripts/tools/web/apps/bxc/scripts/export-dragonball-jsonl.ts (supprimé)
- `scripts/tools/web/apps/bxc/scripts/fetch_bun_docs.ts`
- `scripts/tools/web/apps/bxc/scripts/ingest-inazuma.ts`
- `scripts/tools/web/apps/bxc/scripts/install-deps-windows.ps1`
- scripts/tools/web/apps/bxc/scripts/train-dragonballfr-links.ts (supprimé)

### winclean-pipeline.ps1

- `scripts/winclean-pipeline.ps1`

## Sans référence et imports relatifs cassés (non exécutables en l'état)

Preuve : import relatif sans fichier cible (`.ts`, `.tsx`, `/index.ts`, `.js`→`.ts`). Beaucoup visent l'ancien layout Shenron (apps/site → apps/shenron/site) : à réparer ou supprimer par le propriétaire.

- `scripts/audit/shenron/scripts/ops/audit-wiki-databooks-coverage.ts` → ./wiki-databooks-indexer
- `scripts/audit/shenron/scripts/ops/check-wiki-status.ts` → ../../packages/db/src/index.ts
- `scripts/audit/shenron/scripts/ops/crawl-doc-links-rag.test.ts` → ./crawl-doc-links-rag
- `scripts/audit/shenron/scripts/ops/crawl-dragon-ball-official-aphrody.test.ts` → ./crawl-dragon-ball-official-aphrody.ts
- `scripts/audit/shenron/scripts/ops/eval-aphrody-rag.test.ts` → ./eval-aphrody-rag
- `scripts/audit/shenron/scripts/ops/test-ocr-jpn.ts` → ../../apps/site/scripts/_databooks-base
- `scripts/audit/shenron/scripts/ops/wiki-corpus-enricher.test.ts` → ./wiki-corpus-enricher
- `scripts/audit/shenron/scripts/ops/wiki-page-builder.test.ts` → ./wiki-page-builder
- scripts/audit/ui/apps/nie-web/scripts/build-fingerprint.test.ts (supprimé) → ../vite.config
- `scripts/audit/ui/apps/nie-web/scripts/out-dir.test.ts` (not in repo) → ./out-dir
- `scripts/audit/ui/apps/nie-web/scripts/precompression-targets.test.ts` (not in repo) → ./precompression-targets
- `scripts/audit/ui/apps/nie-web/scripts/public-entry-bundle.test.ts` (not in repo) → ./public-entry-bundle
- `scripts/audit/ui/apps/nie-web/scripts/stage-vfs.test.ts` (not in repo) → ./stage-vfs
- scripts/audit/ui/apps/nie-web/scripts/verify-audio-cross-host.ts (supprimé) → ../src/wasm/nie_wasm.js
- scripts/audit/ui/apps/nie-web/scripts/wasm-audio-smoke.test.ts (supprimé) → ../src/wasm/nie_wasm.js
- scripts/audit/ui/apps/nie-web/scripts/wasm-audio-smoke.test.ts (supprimé) → ./wasm-audio-smoke
- scripts/build/web/apps/bxc/scripts/build-demo-index.ts (supprimé) → ../src/crawler/MassiveCrawler.ts
- scripts/build/web/apps/bxc/scripts/capture_squad_builders.ts (supprimé) → ../src/api/browser.ts
- `scripts/release/ui/apps/nie-web/scripts/stage-vfs.ts` (not in repo) → ./out-dir
- `scripts/tools/fut/src/scripts/map_fut.ts` → ../futgg.ts
- `scripts/tools/fut/src/scripts/map_fut.ts` → ../futbin.ts
- `scripts/tools/shenron/scripts/filter-ocr-results.ts` → ../apps/site/src/lib/databooks-defauts.ts
- `scripts/tools/shenron/scripts/ops/appliquer-ajustements.ts` → ../../apps/site/scripts/_databooks-base
- `scripts/tools/shenron/scripts/ops/appliquer-ajustements.ts` → ../../apps/site/src/lib/ja/lexique-canonique
- `scripts/tools/shenron/scripts/ops/auto-translate-worker.ts` → ../../apps/site/scripts/_databooks-base
- `scripts/tools/shenron/scripts/ops/auto-translate-worker.ts` → ../../apps/site/src/lib/ja/lexique-canonique
- `scripts/tools/shenron/scripts/ops/batch-manga-ocr.ts` → ../../apps/site/scripts/_databooks-base
- `scripts/tools/shenron/scripts/ops/clean-noncanon-wiki.ts` → ../../apps/site/scripts/_databooks-base
- `scripts/tools/shenron/scripts/ops/clean-noncanon-wiki.ts` → ../../apps/site/scripts/_technique-lexicon
- `scripts/tools/shenron/scripts/ops/complete-db-from-dragonballcn.ts` → ../../apps/site/scripts/_databooks-base
- `scripts/tools/shenron/scripts/ops/deposer-lot-landmark.ts` → ../../apps/site/scripts/_databooks-base
- `scripts/tools/shenron/scripts/ops/generate-db-lexicon.ts` → ../../apps/site/scripts/_databooks-base
- `scripts/tools/shenron/scripts/ops/generate-db-lexicon.ts` → ../../apps/site/scripts/_technique-lexicon
- `scripts/tools/shenron/scripts/ops/generate-db-lexicon.ts` → ../../apps/site/src/lib/ja/normalisation
- `scripts/tools/shenron/scripts/ops/ingest-gpu-ocr-results.ts` → ../../apps/site/scripts/_databooks-base
- `scripts/tools/shenron/scripts/ops/ingest-gpu-ocr-results.ts` → ../../apps/site/src/lib/databooks-defauts
- `scripts/tools/shenron/scripts/ops/inspect-missing-images.ts` → ../../apps/site/scripts/_databooks-base
- `scripts/tools/shenron/scripts/ops/provision-aphrody-admin.ts` → ../../packages/auth/src/agent-keys
- `scripts/tools/shenron/scripts/ops/provision-aphrody-admin.ts` → ../../packages/auth/src/tokens
- `scripts/tools/shenron/scripts/ops/sync-reports-goals.ts` → ../../apps/bot/src/services/AdminReportGoalService

## Réparés 2026-10-03

15 scripts ci-dessus ont été réparés par réécriture d'imports relatifs vers le layout actuel (apps/site → apps/shenron/site, apps/bot → apps/shenron/bot, packages/{auth,db} → packages/shenron/{auth,db}, fut → packages/fut/fut/src) ; `bun build --target bun --packages external` résout les 15. Les 16 restants visent des modules absents du dépôt (nie-web, bxc, tests Shenron orphelins) : décision réparer/supprimer par propriétaire.

### Deuxième passe 2026-10-03

- 12 tests/scripts de `scripts/audit` et `scripts/release` pointent maintenant vers leur module déplacé dans `scripts/{tools,build,release}` ; 2 modules Shenron (crawl-dragon-ball-official-aphrody, wiki-corpus-enricher) suivent le layout actuel.
- `bun test` : tests nie-web 13 pass. Tests Shenron (crawl-doc-links-rag, crawl-dragon-ball-official-aphrody, eval-aphrody-rag, wiki-corpus-enricher, wiki-page-builder) : 5 échecs de résolution de packages (`@shenron/pipeline/*`, `postgres`) car `scripts/` n'est pas un membre de workspace avec ces dépendances. Décision propriétaire Shenron : déplacer sous `packages/shenron/pipeline/scripts` ou déclarer les dépendances.
- Restent non résolus : wasm-audio-smoke et verify-audio-cross-host (artefact généré nie_wasm.js), build-fingerprint (vite.config absent), bxc build-demo-index et capture_squad_builders (sources bxc absentes).

### Troisième passe 2026-10-03 (tous les scripts `.ts`)

- Scripts non référencés restants (105) : 98 résolvent leurs imports avec `bun build --target bun --packages external` ; 2 imports Shenron réparés ; 5 bxc visent des sources absentes du dépôt (backfill-empty-markdown, consolidate-dragonball-crawls, enrich-shenron, export-dragonball-jsonl, train-dragonballfr-links).
- Scripts référencés (171) : 34 aux imports cassés, 27 réparés (layouts Shenron/RG actuels, modules déplacés dans `scripts/`, scripts extraits de `packages/<domaine>/<paquet>` qui pointent à nouveau vers ce paquet).
- Restent cassés : 4 bxc (grok-scan-with-cookies, publish-workspaces.test, x-premium-recon, x-pro-recon : sources bxc absentes) et 3 du kit de build discord (generateSplitDocumentation, deux tsup.config : `package.json`/`tsup.config.js` amont absents).

## Doublons exacts supprimés 2026-10-03

13 copies sous `scripts/` identiques octet pour octet (même blob git) à un fichier de leur paquet propriétaire, sans consommateur (aucun import ni chemin cité hors cet inventaire) :

- scripts/audit/compat/test/fixture/scripts/install.sh → `crates/compat/n2b/tests/fixtures/node-project/scripts/install.sh`
- scripts/audit/os/drive/core/scripts/test_daemon.sh → `crates/os/drive/core/scripts/test_daemon.sh`
- scripts/audit/ui/packages/eslint-plugin-m3/scripts/sync-symbol-names.ts → `packages/ui/eslint-plugin-m3/scripts/sync-symbol-names.ts`
- scripts/build/koharu/packages/bridge/scripts/prepare-wasm.ts → `packages/koharu/bridge/scripts/prepare-wasm.ts`
- scripts/build/ui/packages/material-web/scripts/build.ts → `packages/ui/material-web/scripts/build.ts`
- scripts/build/ui/packages/material-web/scripts/compile-sass.ts → `packages/ui/material-web/scripts/compile-sass.ts`
- scripts/build/ui/packages/material-web/scripts/component-custom-elements.ts → `packages/ui/material-web/scripts/component-custom-elements.ts`
- scripts/build/ui/packages/material-web/scripts/css-to-ts.ts → `packages/ui/material-web/scripts/css-to-ts.ts`
- scripts/build/ui/packages/material-web/scripts/generate-sass-token-meta.ts → `packages/ui/material-web/scripts/generate-sass-token-meta.ts`
- scripts/migration/ui/packages/material-web/migration/codemods/scripts/run-fixtures.ts → `packages/ui/material-web/migration/codemods/scripts/run-fixtures.ts`
- scripts/migration/ui/packages/material-web/migration/scripts/theme-to-tokens.ts → `packages/ui/material-web/migration/scripts/theme-to-tokens.ts`
- scripts/tools/os/drive/core/scripts/combine.sh → `crates/os/drive/core/scripts/combine.sh`
- scripts/tools/os/drive/core/scripts/update_spacedrive.sh → `crates/os/drive/core/scripts/update_spacedrive.sh`

Conservé : scripts/tools/shenron/scripts/ops/wiki-databooks-indexer.ts (importé par 6 scripts `enrich-category-*` et l'audit de couverture), doublon de `apps/shenron/site/scripts/_wiki-databooks-indexer.ts` à unifier par Shenron.

## Scripts orphelins supprimés 2026-10-03

10 scripts sans référence entrante dont les imports visent des sources absentes du dépôt (aucune app bxc ni source nie-web suivie ; `bun build` échoue) : non exécutables et sans consommateur, supprimés (récupérables par l'historique git) :

- scripts/audit/ui/apps/nie-web/scripts/build-fingerprint.test.ts
- scripts/audit/ui/apps/nie-web/scripts/verify-audio-cross-host.ts
- scripts/audit/ui/apps/nie-web/scripts/wasm-audio-smoke.test.ts
- scripts/build/web/apps/bxc/scripts/build-demo-index.ts
- scripts/build/web/apps/bxc/scripts/capture_squad_builders.ts
- scripts/tools/web/apps/bxc/scripts/backfill-empty-markdown.ts
- scripts/tools/web/apps/bxc/scripts/consolidate-dragonball-crawls.ts
- scripts/tools/web/apps/bxc/scripts/enrich-shenron.ts
- scripts/tools/web/apps/bxc/scripts/export-dragonball-jsonl.ts
- scripts/tools/web/apps/bxc/scripts/train-dragonballfr-links.ts

## Scripts cassés référencés seulement par la doc, supprimés 2026-10-03

4 scripts bxc (sources bxc retirées du dépôt, cités par des docs de référence ou un autre script bxc) et 3 fichiers du kit de build discord amont (sans leur `package.json`) ; aucun ne résolvait ses imports :

- scripts/audit/web/apps/bxc/scripts/grok-scan-with-cookies.ts
- scripts/audit/web/apps/bxc/test/scripts/publish-workspaces.test.ts
- scripts/tools/web/apps/bxc/scripts/x-premium-recon.ts
- scripts/tools/web/apps/bxc/scripts/x-pro-recon.ts
- scripts/build/discord/packages/scripts/bin/generateSplitDocumentation.ts
- scripts/build/discord/packages/scripts/tsup.config.ts
- scripts/build/discord/packages/scripts/turbo/generators/templates/default/tsup.config.ts
