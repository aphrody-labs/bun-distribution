<!-- SPDX-License-Identifier: Apache-2.0 -->
# Métadonnées de livraison Yolo — 2026-10-04

Le lot corrige les workflows runtime/release et le scaffold du producteur Yolo.
Il conserve les claims concurrents sur le binaire autonome, la fabrique et l'UI.
L'architecture et la queue restent dans [PLAN](../../../PLAN.md) et
[GOAL](../../../GOAL.md).

Les runners macOS sont `macos-15-intel` (x64) et `macos-15` (ARM64), selon le
[catalogue officiel épinglé](https://github.com/actions/runner-images/blob/6d942e630479cd99a93dadfc766af11242bfa402/README.md).
Chaque workflow refuse avant build un host Rust ou une cible Bun différents
de la matrice. Le scaffold annonce ABI 1.4, comme les constantes du SDK et du
producteur. Les autres lignes de la matrice sont conservées.

Validation : 14 tests scaffold, 91 assertions ; les deux YAML sont parsés, les
cinq couples runner/cible contrôlés, les guards shell exécutés sur Linux x64
avec acceptation de la cible courante et refus d'une cible ARM64. Ces contrôles
ne démarrent aucun build moteur ni job GitHub. Le cas conditionnel d'installation
dans la suite scaffold ne constitue pas une requalification de la release courante.

Les liens des documents de ce lot et `git diff --check` passent ; mdBook Yolo
passe. `docs check --skip-ecosystem` d'Aphrody signale deux sorties périmées :
`docs/README.md` et `docs/reference/workspace/documentation.json`. Leur régénération
reste au propriétaire du claim actif `runtime-sdk-acquisition` ; le gate global
est en échec et aucune cohérence globale n'est revendiquée par ce lot.

Sondes SSH en lecture seule via le MCP natif Aphrody :

| Hôte | Outils observés | Espace libre racine | Fabrique |
| --- | --- | --- | --- |
| `vps` | Bun 1.4.2, Rust/Cargo 1.98.1, sccache 0.18.0, Clang 21.1.8, Ninja 1.13.2, CMake 4.2.3 | 270 320 357 376 octets ; `/srv` 319 359 881 216 | `/srv/aphrody-build` absent |
| `dbfr` | mêmes versions | 7 227 445 248 octets, 93 % utilisés | `/srv/aphrody-build` absent |

Ces observations corrigent la supposition ancienne d'absence de toolchains.
Elles ne prouvent ni source distante épinglée, ni fabrique active, ni installation
produit. Les builds macOS, les assets courants, install/upgrade/rollback et les
jalons moteur restent soumis aux gates de leurs propriétaires.

Le détail et les hashes des fichiers livrés sont dans le
[reçu Yolo](../../delivery-metadata-2026-10-04.json).
