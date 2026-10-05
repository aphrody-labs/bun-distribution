<!-- SPDX-License-Identifier: Apache-2.0 -->
# GOAL — aphrody-py

Directive propriétaire du 2026-10-04. Pendants : [Aphrody](../aphrody/GOAL.md) (produits) et
[Yolo](../yolo/GOAL.md) (bibliothèque partagée native).

## Rôle

aphrody-py porte la **surface Python IA/ML** d'Aphrody : entraînement, modèles, OCR et outils
de données. Aphrody (Rust et Bun) n'embarque plus de code Python IA/ML. Yolo garde seulement sa
liaison PyO3 du cœur natif (`packages/python`).

## Règles

- **uv natif** : un seul espace de travail, des lockfiles conservés et des wheels vérifiées.
- **Python via uv** seulement quand l'écosystème tiers est indispensable (PyTorch, Hugging Face, NumPy…) ; CPython reste réservé aux besoins bas niveau de l'interpréteur.
- Les calculs natifs passent par Yolo (FFI ou PyO3, zéro copie) plutôt que par une réimplémentation Python.

## État vérifié (2026-10-04)

| Élément | Constat | Source |
| --- | --- | --- |
| Espace de travail | uv >=0.12.22 (hôte 0.12.23), CPython 3.12, Bun 1.4+ | `pyproject.toml`, `uv --version` |
| Paquets | `aphrody`, `aphrody-train`, `cli`, `embedding-fixtures`, `model-tools`, `os` ; app `meetings` | `ls packages apps` |
| Validation | 695 tests unitaires passés, `bun run check` (roues isolées), `lint`, `fmt`, `typecheck` verts | `bun run check`, `bun run test` |
| Branche | `main` synchronisée avec `origin/main` | `git status -sb` |

## Écarts résolus (2026-10-04)

- **Code Python IA/ML dans Aphrody** : `crates/ai/embed/tests/fixtures/generate_reference.py` et `generate_rerank_reference.py` entièrement absorbés dans `packages/embedding-fixtures/src/aphrody_embedding_fixtures/` avec tests unitaires dédiés. Fichiers sources Python supprimés d'Aphrody (commit `d06d007`). Aphrody ne conserve que les fixtures JSON de référence.
- **GPU hôte qualifié** : NVIDIA GeForce RTX 4070 (12282 MiB, CUDA 13.4, pilote 615.71.08 / KMD 616.92, WSL2 Ubuntu 24.04), source PyTorch cu129 épinglée dans `aphrody-train`.

