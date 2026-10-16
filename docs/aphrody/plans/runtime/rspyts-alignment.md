<!-- SPDX-License-Identifier: Apache-2.0 -->
# Rspyts — référence de refactoring

La queue active et les critères sont uniquement dans [PLAN.md](../../PLAN.md).
Les preuves consommateur sont dans [MEMORY.md](../../MEMORY.md).
Ce document conserve les conclusions de référence, sans seconde roadmap.

Référence inspectée le 2026-10-03 : dépôt privé `aphrody-dev/rspyts`,
révision `adecf388e0bbb4d90a9c91cc774af0ef6b8c1161`, checkout existant
`/tmp/rspyts`. Aucun nouveau clone requis ; aucune source transplantée.

Retenir la séparation logique Rust / ABI C / clients Bun / bindings Python.
Ne pas reprendre le chargement direct `target/release/librspyts_ffi.so` (not in repo) (generated or machine-local artifact; presence depends on the build host),
l'absence de négociation ABI/erreurs structurées ou le rebuild moteur consommateur.
Aucune mesure Rspyts de performance ou zero-copy reproduite.

Preuve du premier lot :
cycle de vie engine.
Les contrats et propriétaires Aphrody/Yolo restent l'autorité.
