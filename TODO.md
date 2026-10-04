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

## Lot suivant — validation avant installation

- [x] Extraire et qualifier les archives et le runtime natif avant remplacement.
- [x] Vérifier le maintien de l'installation existante face à un payload invalide.
- [x] Gates scoped, reçu de preuve, revue et commit des installateurs : `86ef154`.

Portée : `yolo/install.sh`, `yolo/install.ps1`, tests et reçu dédiés ; aucun
changement dans les répertoires sources exclus ni dans les lots concurrents.
Preuve : [reçu Yolo](../yolo/docs/installer-validation-2026-10-04.json), 23 tests
passés, aucun échec ni skip. Installations fraîches et rollback runtime Linux
vérifiés sur fixtures ; Windows natif et promotion de release restent ouverts.

## Exécution parallèle demandée par le propriétaire

- [ ] Étape 1 : acquisition native du runtime et SDK épinglé (`runtime_acquisition`).
- [ ] Étape 2 / R3 : desktop, permissions, événements, arrêt (`desktop_r3`).
- [ ] Étape 3 / R4 : navigation, extraction, capture et isolation (`browser_r4`).
- [ ] Intégrer les preuves, gates sérialisés, commits et push ; traiter ensuite
  les étapes dépendantes et conserver leurs exigences complètes dans les plans.

## Media / administration unification — 2026-10-05

- [ ] Share manga/OCR/translation provenance and adapters across the three products.
- [ ] Qualify consumer contracts, review gates and native boundaries.
- [ ] Absorb Shenron administration into the Aphrody web surface with authentication.
- [ ] Keep one Aphrody desktop host and retain all navigation and Koharu editor sections.
- [ ] Reuse Yolo supervision for Discord binaries; wire native Gemma inference and dbfr Agent Home.
- [ ] Leave n2b/Oxc/runtime/CLI retirement to the concurrent Yolo owner.
- [ ] Deliver owned changes and evidence.
