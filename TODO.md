<!-- SPDX-License-Identifier: Apache-2.0 -->

# Livraison en cours

Lot possédé : métadonnées de livraison Yolo, hors des claims UI, binaire autonome
et routage de fabrique actifs dans les checkouts partagés.

- [x] Aligner le scaffold sur l'ABI 1.4 du producteur et du SDK.
- [x] Remplacer les runners macOS retirés/dépréciés et refuser une architecture différente.
- [x] Exécuter les gates du scaffold, YAML, liens, whitespace et mdBook.
- [x] Consigner les sondes SSH et les limites dans le reçu.
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
Preuve : reçu Yolo, 23 tests
passés, aucun échec ni skip. Installations fraîches et rollback runtime Linux
vérifiés sur fixtures ; Windows natif et promotion de release restent ouverts.

## Exécution parallèle demandée par le propriétaire

- [ ] Étape 1 : acquisition native du runtime et SDK épinglé (`runtime_acquisition`).
- [ ] Étape 2 / R3 : desktop, permissions, événements, arrêt (`desktop_r3`).
- [ ] Étape 3 / R4 : navigation, extraction, capture et isolation (`browser_r4`).
- [ ] Intégrer les preuves, gates sérialisés, commits et push ; traiter ensuite
      les étapes dépendantes et conserver leurs exigences complètes dans les plans.

## Media / administration unification — 2026-10-05

- [x] Shenron and Koharu (manga, OCR review, translation, administration, editor) left for
      aphrody-labs/shenron on 2026-10-05; Aphrody keeps the host plane and the `/api/v1/shenron/*` gateway.
- [ ] Qualify consumer contracts, review gates and native boundaries.
- [ ] Reuse Yolo supervision for Discord binaries; wire native Gemma inference and dbfr Agent Home.
- [ ] Leave n2b/Oxc/runtime/CLI retirement to the concurrent Yolo owner.
- [ ] Deliver owned changes and evidence.

## Intégration sur main — 2026-10-07

- [x] README : installation complète pilotée par agent CLI, tâche canonique et limites publiées.
- [x] Publier et vérifier les images runtime/Alpine et le paquet WASM portable.
- [x] Réparer les liens documentaires et régénérer les index depuis leurs propriétaires.
- [x] Valider les unités Docker Shenron sur le VPS et les configurations fournisseurs.
- [x] Qualifier la fusion WSL et le graphe TypeScript : check, tests et Clippy sérialisés sur le VPS.
- [x] Revoir les fichiers restants, commiter les changements qualifiés et pousser `workspace/main`.

La qualification du SDK FFI intégré, l'activation du fork et les cibles desktop/native
restent dans le plan global ; ce lot ne les déclare pas terminées.

## Flotte Discord / Drive / MCP — 2026-10-07

- [x] Activer la sync Drive Bun persistante sur VPS, isoler les candidats privés et pousser `69749a91a`.
- [x] Qualifier le hub MCP/A2A authentifié, les clients WSL et une tâche Codex terminée après déconnexion.
- [x] Valider les résultats MCP modernes (124 tests et un ignoré), l'ACK A2A et les échecs/reprises durables (60 tests).
- [x] Qualifier les transports MCP WSL, Windows via WSL et DBFR : 364 outils et relais A2A authentifié.
- [x] Installer le binaire natif `737f87d9…` qualifié ; Claude WSL moderne connecté et tâche A2A achevée après fermeture du client (ACK 8 ms).
- [ ] Admettre Shenron dans Discord et constater un handshake du PC Omar actuellement hors ligne.
- [x] Rapprocher les sept contrats Drive : quatre Docs modifiés, trois promotions locales, structure et sauvegardes vérifiées.
- [x] Activer le rapprochement Drive récurrent : quatre jobs réussis, sept références vérifiées, 45 fichiers copiés et deux homes DBFR/Shenron indexés ; 37 tests ciblés.
- [x] Livrer les seuls chemins/hunks possédés avec leurs preuves et les deux blocages externes documentés.

## Consolidation racine — exemple Bun (2026-10-07)

- [x] Déplacer le dernier prototype suivi de `apps/` vers `examples/`.
- [x] Qualifier tests, lint, format et serveur HTTP ; liens locaux migrés, quatre chemins morts globaux préexistants.
- [x] Préparer la livraison des chemins possédés ; fusions runtime, SDK et racine restantes dans le plan global.

## Fusion proactive globale — 2026-10-07

- [x] Absorber Forge et les plugins dans les modules CLI Yolo ; préserver les API npm par façades sans moteur dupliqué.
- [x] Qualifier la génération et Forge depuis le binaire compilé sans checkout.
- [x] Regrouper les 22 crates OS ; check, 943 tests et Clippy strict passent sur la fabrique.
- [x] Migrer 279 configurations suivies vers tools/config et leurs consommateurs ; sauvegarde protégée conservée.
- [x] Qualifier les dépendances/toolchains Docker desktop et intégrer les gates sérialisés.
- [x] Intégration poussée : `7b4d5f0cd` (2 815 fichiers), puis `d429aa205` ; la fusion complète reste à prouver.

## Suite active — runtime et fabrique unique

- [ ] Gates des 11 consommateurs Rust hors OS de tools/config.
- [x] Compiler Yolo bytecode et SDK FFI partagé ; archive réelle, installation isolée et rollback qualifiés (activation encore ouverte).
- [x] Nettoyer les targets VPS retirés (~39,2 Go) et qualifier la ressource temporaire unique (90 tests), sous verrou global.
- [ ] Absorber les 2 631 fichiers M3 selon la carte validée, après ce lot.

<!-- owner codex-root: isolated Taffy qualification -->
- [x] Qualifier Taffy 0.12.1 sur le snapshot dc6f41ef2160 : 110 tests, check et Clippy strict passent sur le VPS.
- [x] Faire résoudre le lockfile du candidat Taffy isolé e81f1a4c53c7 par Cargo ; revoir le diff et qualifier ce candidat exact.
- [x] Livrer le déplacement, le correctif de retrait des nœuds et leur provenance en conservant les changements concurrents. Les adaptateurs M3/Bun/WASM restent une qualification distincte.
