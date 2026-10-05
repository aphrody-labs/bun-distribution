# Unification IA / CLI / MCP — 2026-10-05

- [x] Relever les consommateurs, propriétaires et travaux concurrents.
- [x] Unifier sampler et client Gemma sur le service d'inférence existant.
- [x] Centraliser les opérations CLI/MCP et le transport streaming/HTTP.
- [x] Extraire la logique métier des handlers MCP Yolo et vérifier les adaptateurs.
- [ ] Qualifier la convergence Rust via la fabrique native, sans bypass local.
- [x] Exécuter tests, types, lint, format, documentation puis livrer les lots qualifiés.

Blocage natif observé : verrou lourd VPS occupé et ancien pin source. Les helpers ML/benchmark restants et la consolidation native globale restent ouverts ; voir docs/architecture/ai/OWNERS.md.
