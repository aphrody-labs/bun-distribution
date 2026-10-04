<!-- SPDX-License-Identifier: Apache-2.0 -->
# Livraison en cours

Lot possédé : métadonnées de livraison Yolo, hors des claims UI, binaire autonome
et routage de fabrique actifs dans les checkouts partagés.

- [x] Aligner le scaffold sur l'ABI 1.4 du producteur et du SDK.
- [x] Remplacer les runners macOS retirés/dépréciés et refuser une architecture différente.
- [x] Exécuter les gates du scaffold, YAML, liens, whitespace et mdBook.
- [x] Consigner les sondes SSH et les limites dans le [reçu](../yolo/docs/delivery-metadata-2026-10-04.json).
- [x] Revoir le staging et livrer le lot Yolo : `a6bcfd4`, poussé sur `origin/dev`.

Le reçu Aphrody et ce TODO sont livrés ensemble sur la branche `main` existante.

Gate global documentaire en échec : `docs/README.md` et
`docs/reference/workspace/documentation.json` périmés, sous claim concurrent
`runtime-sdk-acquisition`. Build/exécution macOS, release courante et fabrique
restent à leurs propriétaires et ne sont pas clos par les métadonnées.

La suite globale reste dans [PLAN.md](PLAN.md) et [GOAL.md](GOAL.md).
Les lots concurrents conservent leurs claims ; leur état n'est pas une preuve de livraison.
