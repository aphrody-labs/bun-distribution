<!-- SPDX-License-Identifier: Apache-2.0 -->
# Bun : migration du moteur et des consommateurs

Le plan complet est tenu dans le dépôt propriétaire Bun OS :
[TODO-BUN.md](https://github.com/aphrody-labs/bun-os/blob/obscura/TODO-BUN.md).

Directive du 2026-10-11 : un seul produit runtime, binaire et CLI `bun`, FFI Bun,
MCP `bun mcp` et plugin `bun-agent-plugin`. Les bibliothèques navigateur vivent
sous `src/browser` dans le dépôt runtime. Les documents historiques restent des
preuves datées et des registres de provenance, sans surface produit supplémentaire.

Tous les builds, tests, Clippy et benchmarks passent par la factory VPS via
Infra SSH. Aucun de ces travaux lourds ne s'exécute sur le PC du propriétaire.

- [x] Transférer les sources moteur et leurs notices dans la branche de travail.
- [x] Inventorier les recherches et transférer service, crawl, détection, index
  et modules SDK CDP vers le dépôt runtime.
- [ ] Qualifier les raccords natifs HTML/CSS et le backend JS partagé sur VPS.
- [ ] Qualifier toutes les capacités des consommateurs et les interfaces
  CLI/FFI/MCP/plugin communes, avec les benchmarks existants.
- [ ] Après stabilité démontrée, pinner le provider publié et utiliser Bun
  directement depuis les consommateurs.
- [ ] Retirer les sources et surfaces remplacées, puis mesurer la réduction
  réelle du checkout et des artefacts.

La présence de code transféré ne clôt aucune gate d'intégration, de packaging
ou d'activation. Les cases ouvertes du plan runtime constituent la queue active.
