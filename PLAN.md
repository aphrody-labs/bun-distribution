<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody — plan actif

Décision propriétaire : 2026-10-03. Objectif : applications Aphrody utilisant
un runtime Bun/Tauri/Obscura précompilé et un SDK léger, avec installation,
upgrade et rollback qualifiés. La refonte complète reste ouverte.

## Autorité et propriétaires

| Source unique | Responsabilité |
| --- | --- |
| Ce plan | Architecture commune, migration produit et critères de réussite |
| [Plan Yolo](../yolo/PLAN.md) | Runtime, SDK, phases producteur et distribution |
| [MEMORY.md](MEMORY.md) | Preuves consommateur et limites datées |
| [Mémoire Yolo](../yolo/MEMORY.md) | Preuves producteur et artefacts natifs |
| [AGENTS.md](AGENTS.md) | Règles du dépôt, identité, confidentialité et gates |

Aphrody conserve workflows, UI, intégrations et données métier. Yolo possède les
moteurs et fournit des releases épinglées ; aucune source moteur dans Aphrody.
Workspace/Infra possède orchestration, inventaires, fabriques et déploiement.
UI : `m3/packages/app-ui`, `crates/ui/*`. Le sous-module M3 est directement à la
racine (`m3/`), selon la [décision du 2026-10-05](docs/architecture/workspace/M3-LOCATION.md).
Python et IECODE restent dans leurs
dépôts, avec leurs contrats et stores séparés.

## Contrats d'architecture

- SDK versionné et ABI C : poignées opaques, structures dimensionnées, négociation
  ABI/capacités, buffers avec longueur, libération par l'allocateur, erreurs,
  annulation, callbacks et règles de threading/lifetime explicites.
- Les types Rust internes et rlibs moteurs ne sont pas l'ABI applicative.
  Une extension standard doit compiler sans reconstruire les moteurs.
- Chaque contexte, opération et ressource a un propriétaire. Files bornées,
  saturation explicite ; arrêter et joindre les workers avant unload.
  Respecter le thread UI et les threads autorisés des objets JavaScript.
- Vérifier permissions, origine et isolation dans le natif. Une page distante
  ne reçoit aucun privilège Bun/host implicite ; cookies et profils restent isolés.
- Préserver unwind/récupération aux frontières réelles des artefacts.
  Une faute mémoire peut arrêter le processus ; isoler les travaux quand requis.
- Garder V8 jusqu'à parité Obscura/JSC : DOM, GC, exceptions, promesses,
  microtasks, modules, workers, timers, interruptions et destruction.
  Les WebViews système gardent leurs moteurs de plateforme.
- Garder les graphes moteurs compatibles et indépendants si nécessaire.
  Préserver noms d'API/CLI/permissions, licences, provenance, features et lockfiles.
  Retirer un chemin remplacé dans le lot qui qualifie son remplacement.
- Compiler les moteurs par version/cible ; distribuer SDK, artefacts, hashes
  et compatibilité. Refuser une ABI incompatible avant tout appel natif.

## Exécution autonome — no human in the loop

Dans le périmètre déjà autorisé, décider et exécuter de bout en bout sans
confirmation intermédiaire : contrat ciblé → modification → gates → correction
→ revue du diff → commit propriétaire → push sur le remote existant.
Continuer les lots autorisés jusqu'à satisfaction des critères.

Utiliser les checkouts et caches existants. Aucun clone supplémentaire, copie
de travail, checkout propre ou copie de script propriétaire. Appeler directement
le propriétaire existant ; signaler un prérequis absent sans créer un substitut.
Pas de nouvelle archive ni de code mort après migration qualifiée.

Réutiliser les règles d'[AGENTS.md](AGENTS.md) : préserver les modifications
concurrentes et les stores protégés ; réserver les chemins ; gates scoped une fois,
puis répéter seulement après changement pertinent ou échec non résolu.
Cargo sérialisé, sccache conservé, moteurs lourds par la fabrique.

Les validations techniques restent obligatoires. Une autorité manquante,
une donnée indispensable ou un blocage externe est consigné ; avancer sur
le reste autorisé. Cette consigne ne crée pas d'autorisation de publication
publique, de destruction de données ou d'action dans un autre domaine.

## Queue consommateur

| Ordre | Travail | Critère de fermeture |
| --- | --- | --- |
| 1 | Acquisition du runtime natif et compatibilité avec le SDK épinglé | Artefact vérifié obtenu sans rebuild moteur ; install/upgrade/rollback |
| 2 | Intégrer le pilote desktop R3 fourni par Yolo | Écran rendu, permissions refusées, événements, annulation, arrêt, bundle installé |
| 3 | Intégrer le navigateur R4 fourni par Yolo | Navigation, extraction, capture, isolation, tests produit |
| 4 | Migrer les produits R7 : Shenron, RG, Koharu et autres consommateurs concernés | Graphe léger, contrats produit et release passent ; chemins remplacés retirés |
| 5 | Qualifier les variantes serveur/headless/desktop | Santé et récupération, installation sur la matrice réellement supportée |
| 6 | Valider R5/R6 côté produit, puis R8 | Parité JSC requise, retrait V8 du profil promu, mesures reproductibles |

Supervision Web et bootstrap SDK sont livrés dans la portée de
[MEMORY.md](MEMORY.md). Les jalons producteur sont suivis uniquement dans Yolo.
Le SDK bootstrap exige un producteur existant ou un cache vérifié ; l'acquisition
native sur une nouvelle machine reste ouverte.

## Définition de réussite

- [ ] Modifier workflow, écran ou intégration ne reconstruit pas les moteurs.
- [ ] Une extension Rust standard compile avec le SDK léger.
- [ ] Toute ressource native a un propriétaire et une destruction vérifiée.
- [ ] Annulation et arrêt ne laissent ni fuite ni callback invalide.
- [ ] Les droits des pages et extensions sont contrôlés côté natif.
- [ ] Runtime/application : compatibilité, upgrade et rollback qualifiés.
- [ ] Artefacts lourds précompilés pour chaque cible supportée.
- [ ] Gains de build, taille et mémoire mesurés séparément.
- [ ] Limites de compatibilité documentées.
- [ ] Anciens chemins inutiles retirés après qualification.

Chaque fermeture cite son reçu : révisions, cible, commandes, résultats,
artefact et limites. Distinguer source, tests, packaging, installation et
activation. Aucun gain, support multiplateforme ou déploiement déduit des sources.

## Références d'exécution

- [Qualification consommateur](docs/guides/workspace/runtime-consumer.md)
- [Référence Rspyts](docs/plans/runtime/rspyts-alignment.md)
- [Stack sélectionnée](docs/reference/workspace/STACK-REPORT-2026-10.md)
- [Commandes propriétaires](docs/guides/workspace/documentation.md)
