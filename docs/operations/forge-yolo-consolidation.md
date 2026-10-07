<!-- SPDX-License-Identifier: Apache-2.0 -->
# Fusion Forge et Yolo — 2026-10-07

Forge appartient maintenant à `packages/engine/yolo/src/cli/forge/`.
Le routeur `yolo forge` utilise un import littéral différé, qui permet à Bun de
l'embarquer dans le runtime. La compilation et les opérations autonomes ne
nécessitent plus de retrouver les sources de Forge dans un checkout.

Les quatre anciens modules du paquet `@aphrody/bun-forge` réexportent les modules
Yolo ; son entrée CLI conserve l'invocation standalone et les unités systemd.
La configuration JSON est emballée une seule fois dans le propriétaire Yolo.
L'identité npm reste compatible ; son ancienne implémentation est retirée.
Les modules conservent SPDX Apache-2.0 dans le paquet Yolo déclaré MIT.

## Qualification

- Avant migration : 28 tests, 96 assertions sur le propriétaire Forge.
- Après migration : ces mêmes tests avec le contrôle de copies des configurations,
  33 tests réussis. TypeScript Yolo et façade Forge passent.
- Binaire Yolo compilé sous `/tmp`, lancé depuis un dossier vide avec un chemin
  de checkout inexistant : Forge help, version et génération de l'unité systemd
  réussissent. L'unité désigne le binaire suivi de `forge watch`.
- Suite Yolo complète : 277 tests, 2789 assertions, aucun échec avec la
  bibliothèque native explicitement qualifiée (ABI tooling 1/n2b 2/oxc 1).
  Son SHA-256 est `3212bfd18223e188e4cb2bc4bcd6ab4027a9359d522d5ba59d34c3e297789d3d`.
- Aucun build du moteur Bun ni installation PATH n'est revendiqué par ce lot.
  L'activation du fork, le SDK FFI et les autres cibles restent dans le plan global.

Les commandes de construction demeurent `yolo forge build|watch`, leurs arguments,
profils, outils, scratch, tests first-party et reçus restent conservés.
Le runtime externe déjà publié et la façade npm déjà publiée ne sont pas modifiés
par le seul déplacement des sources.
