## 📋 Description des Changements
<!-- Décrivez clairement les modifications apportées et le composant ciblé. -->

### Composant(s) modifié(s) :
- [ ] `packages/aphrody` (SDK Python et runtime Aphrody)
- [ ] `packages/aphrody-train` (Entraînement et fine-tuning)
- [ ] `packages/cli` (Interface en ligne de commande)
- [ ] `packages/embedding-fixtures` (Fixtures et benchmarks d'embeddings)
- [ ] `packages/model-tools` (Outils de modèles Koharu)
- [ ] `packages/relecture-ocr` (Moteur OCR et relecture)
- [ ] `apps/meetings` (Application de réunions)
- [ ] `tools/` (Outillage de packaging, scripts et infra)
- [ ] `docs/` (Documentation)

---

## 🧪 Validations Requises
Avant de soumettre, confirmez que les vérifications suivantes ont été exécutées :
- [ ] `bun run lint` (Ruff check / Oxlint sans erreur)
- [ ] `bun run fmt -- --check` ou `bun run fmt` (Formatage sans diff)
- [ ] `bun run typecheck` (Vérification de types Mypy sans erreur)
- [ ] `bun run test` (Tests unitaires pytest 100% verts)
- [ ] `python tools/packaging/modernize_workspace.py check` (Validation complète de l'espace de travail)
