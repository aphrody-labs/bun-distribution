# Registre du corpus partagé — 2026-10-03

Le registre `DOCUMENTS`, ses types et le garde-fou `REFUSÉ` sont détenus par
`@shenron/config/aphrody-corpus`. Le pipeline l'importe directement ; le site
réexporte son API historique depuis `_aphrody-corpus.ts`. Les sept documents,
la regex et les parseurs du site sont conservés.

Coordination : lot réalisé via `aphrody a2a invoke --peer claude` avec claims
sur config, le module corpus du site et le script d'ingestion. Codex intègre
uniquement ce déplacement ; les changements préexistants des embeddings
dans le script d'ingestion restent hors du commit.

## Vérifications

- Config : `bun test` — 47 réussis ; `bun run type-check` réussi.
- Config : `bun run lint` réussi, avec sept avertissements dans des fichiers
  préexistants ; nouveaux fichiers formatés avec Oxfmt.
- Pipeline : `APHRODY_FFI_DEV=1 bun test` — 286 réussis, sept ignorés ;
  `bun run type-check` réussi (sources et scripts).
- Site : `bun test tests/canon-corpus.test.ts` — neuf réussis.
- Site : `bun run type-check` échoue sur
  `scripts/bxc-asset-harvest.ts:640`, nom `aphrodyWebMirror` introuvable,
  hors des fichiers de ce lot.
- `git diff --check` réussi pour les fichiers du lot.

Les deux tests `_rag-corpus-sources` échouent sans bibliothèque native
sélectionnée et passent avec `APHRODY_FFI_DEV=1` et l'artefact local existant.
Ce résultat ne qualifie ni un nouvel artefact FFI, ni son installation,
ni Windows. Aucun build Cargo, accès base ou déploiement dans ce lot.

La section 7 de `PLAN.md` reste ouverte : ces gates ne prouvent pas la
qualification complète du produit, du chargeur natif ou de ses dépendances.
