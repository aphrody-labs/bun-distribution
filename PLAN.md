<!-- SPDX-License-Identifier: Apache-2.0 -->
# Runtime natif unifié — plan directeur Aphrody

Décision du propriétaire : 2026-10-03. Statut : architecture cible et feuille de
route autorisées ; implémentation, compatibilité et gains encore à qualifier.

L'objectif est une distribution exploitable : runtime précompilé, SDK épinglé,
applications compatibles, installation, upgrade et rollback testés. Les
obligations produit existantes restent requises. Les chemins remplacés sont
retirés du build courant dans leur lot de migration qualifié.

## 1. Objectif et responsabilités

Alléger fortement Aphrody et son cycle de build en construisant un runtime natif
précompilé fondé sur le fork Bun, avec intégration de Tauri et Obscura.
Compiler les moteurs lourds une fois par version/cible, puis faire évoluer les
applications avec un SDK léger et des modules applicatifs.

Le producteur est [Yolo](../yolo/PLAN.md), sous `/home/aphro/yolo`.
Aphrody est le consommateur et le propriétaire des fonctionnalités produit.
Une réunion des sources ou un build réussi ne constitue pas cette séparation.

| Livrable | Propriétaire | Contenu | Motif de reconstruction |
| --- | --- | --- | --- |
| Runtime natif | Yolo | Bun forké, services natifs, desktop, navigateur headless | Changement de plateforme, moteur ou contrat |
| SDK | Yolo | Types TypeScript, ABI C, adaptateur Rust léger, packaging | Évolution des contrats |
| Applications | Aphrody | Workflows, agents, commandes, intégrations, UI et données métier | Évolution du produit |
| Extensions natives | Leur propriétaire applicatif | Fonctionnalités Rust exposées via le SDK | Changement de fonctionnalité ou ABI |

Les consommateurs existants, dont Shenron, RG et Koharu, gardent leurs exigences
fonctionnelles. Ce changement de direction ne qualifie ni leur déploiement ni
l'abandon de leurs contrats. Les applications et bibliothèques UI du workspace
restent des consommateurs produit et suivent leurs propriétaires locaux.

## 2. Exécution applicative dans le fork Bun

Bun fournit l'exécution JS/TS, le chargement et les mécanismes de packaging
retenus. Les capacités supplémentaires sont des modules intégrés au runtime,
avec contrats documentés pour types, erreurs, événements, annulation et droits.

Exemple conceptuel, à stabiliser avant publication du SDK :

```ts
import { windows } from "runtime:desktop";
import { browser } from "runtime:browser";
import { services } from "runtime:system";
```

`runtime:system` et `runtime:process` existent dans le SDK Yolo sous forme de
modules virtuels chargés par `bun:ffi` et un preload `Bun.plugin` (décision D5).
Le fork Bun n'est pas modifié pour cette première intégration. `runtime:desktop`
et `runtime:browser` sont réservés et renvoient une erreur explicite ; l'exemple
ci-dessus reste conceptuel pour ces capacités et pour `services`.
Le code produit dépend de
la façade stable, sans accès nécessaire aux types internes Tauri ou Obscura.
Les appels fréquents utilisent des buffers et interfaces spécialisées ; le
contrôle peut employer des données structurées. Éviter la sérialisation JSON
systématique des flux à fort volume.

Le code Rust/C/C++ du runtime est précompilé. Embarquer du JS/TS avec Bun ne
prouve pas une compilation anticipée intégrale de ce code en instructions
machine ; conserver les propriétés et limites réelles de JavaScriptCore.

## 3. Convergence Obscura et JavaScriptCore

Cible : partager un moteur JavaScript embarqué pour l'exécution serveur et les
pages headless, avec environnements, droits et durées de vie distincts.
Le portage de l'intégration Obscura de V8/deno_core vers JavaScriptCore est un
chantier fonctionnel, pas une substitution de dépendance Cargo.

Préserver ou adapter explicitement :

- DOM exposé au JavaScript, objets globaux et comportements Web requis ;
- références natives, garbage collector, exceptions et finalisation ;
- promesses, microtasks, événements, timers et ordre d'exécution ;
- modules, workers, interruptions, limites et destruction des contextes ;
- compatibilité des parcours browser, extraction, réseau et rendu consommés.

Définir une interface interne depuis les besoins concrets d'Obscura et réaliser
un prototype JavaScriptCore tôt. Ne pas construire une abstraction universelle
avant d'avoir démontré les opérations difficiles. Une page headless ne reçoit
aucun accès implicite aux fichiers, processus ou modules privilégiés Bun.

Conserver le backend V8 pendant la transition et le retirer seulement après
parité des consommateurs requis. L'intégration initiale précompilée doit produire
des bénéfices avant l'achèvement de cette convergence.

## 4. Desktop natif et compatibilité Web

Tauri fournit les fenêtres, événements et capacités système retenues : menus,
dialogues, notifications et intégrations desktop. Les plugins sélectionnés sont
compilés avec le runtime et exposés au produit par sa façade stable.

Les WebViews système conservent leurs moteurs de plateforme. Leur JavaScript
ne devient pas automatiquement celui de Bun. La cible est un moteur partagé
Bun/headless si le portage aboutit, des WebViews natives pour le desktop et un
contrat commun d'échange entre environnements.

Remplacer toutes les WebViews par Obscura serait un chantier distinct de
navigateur desktop : compatibilité Web, accessibilité, saisie, multimédia, GPU,
outillage et intégration OS. Il ne conditionne pas l'allègement initial.

## 5. Threads, événements et durées de vie

Respecter les contraintes du thread principal desktop. Chaque contexte JS a un
propriétaire ; les opérations natives bloquantes ou intensives utilisent des
workers bornés. Définir l'intégration des boucles Bun, UI et services asynchrones
sans supposer que leurs ordonnanceurs sont interchangeables.

- Aucun blocage réentrant sur le thread UI depuis son propre callback.
- Aucun objet JS manipulé depuis un thread non autorisé.
- Files bornées, saturation et pression de retour explicites.
- Ordre défini pour callbacks, annulations, microtasks et destruction.
- Arrêt commun des services et attente des travaux propriétaires avant unload.

Les opérations appartiennent à un contexte ou service identifié. Fermer une
fenêtre annule ou transfère explicitement ses travaux. Les callbacks tardifs
ne peuvent pas utiliser une poignée libérée. Réduire le nombre de threads
reste une optimisation mesurée, pas une fin en soi.

## 6. SDK léger et ABI native stable

L'adaptateur Rust du SDK communique avec le runtime par une ABI C versionnée.
Aucun type interne Rust de Tauri, Obscura ou Bun ne traverse cette frontière.
Une rlib précompilée n'est pas un contrat binaire stable entre compilateurs.

Le contrat précise :

- poignées opaques avec génération/validité et propriétaire ;
- structures dimensionnées et versionnées, négociation des capacités ;
- buffers avec longueur, ownership, alignement et règles de partage ;
- libération par le composant qui a alloué ;
- erreurs structurées, annulation et résultat de fin d'opération ;
- durée de vie des callbacks, threading et interdiction d'unload prématuré.

Les fonctionnalités Rust applicatives peuvent être des bibliothèques natives
chargées par le runtime. Les consommateurs restant liés aux moteurs paient
encore leur coût : rendre ces dépendances visibles et les supprimer par
migration qualifiée. Ne pas annoncer le SDK léger tant que son graphe recrée
les dépendances lourdes.

## 7. Services partagés avec propriétaires explicites

| Service | Contrat commun |
| --- | --- |
| HTTP, WebSocket, DNS | Flux, annulation, proxy, erreurs, métriques |
| Cookies et sessions | Contextes, règles d'origine, persistance choisie |
| Fichiers | Droits, surveillance, flux, annulation |
| Processus | Lancement, arrêt, sorties, statut |
| Secrets | Références opaques aux stores protégés existants |
| Logs et traces | Identifiants de requête, service et contexte |
| Rendu | Surfaces, images, transfert, durée de vie |
| Configuration | Schémas versionnés et validation |

Réutiliser les propriétaires existants quand leur contrat convient. Un service
commun peut avoir plusieurs backends justifiés. Le transport d'une WebView
n'est pas supposé interchangeable avec Bun ou le headless. Ne pas fusionner
les cookies de profils différents en mutualisant le stockage.

## 8. Erreurs, panics et isolation

Convertir les exceptions JS et erreurs Rust récupérables en erreurs structurées.
Les frontières appropriées interceptent les panics Rust uniquement si le profil
permet l'unwind. Ni exception étrangère ni panic ne traverse l'ABI de façon
incontrôlée. Définir les profils à partir des artefacts et frontières réels.

Ne pas supposer qu'une exception par package Cargo peut changer arbitrairement
la stratégie panic d'un exécutable unifié. L'intégration d'un composant dépendant
de catch_unwind exige une stratégie compatible ou une frontière d'artefact
explicitement qualifiée. Le rapport lexical précédent n'établit aucun profil.

Une faute mémoire ou erreur fatale de moteur peut abattre un processus complet.
Le mode intégré est la cible principale ; des workers natifs isolés peuvent
être prévus pour navigation non fiable, extension expérimentale ou traitement
nécessitant une frontière de panne. Les utiliser pour une isolation démontrée,
pas comme remplacement par une commande externe d'une intégration native.
Un contexte JS séparé n'offre pas les garanties d'un processus isolé.

## 9. Droits et capacités

Distinguer code local, extension et page distante. Chaque contexte reçoit les
capacités nécessaires : fichiers, réseau, session, fenêtres ou service natif.
Vérifier les droits dans le natif. Une fonction JS cachée n'est pas un contrôle
d'accès. Les pages distantes n'obtiennent pas les API privilégiées par défaut.

Préserver les garanties utiles de Tauri derrière la nouvelle façade. Définir
les contrôles d'origine, événements et commandes avec tests de refus explicites.
Aucune consolidation ne déplace des secrets vers le code ou la mémoire projet.

## 10. Build et optimisation

Priorité : sortir les moteurs du graphe de compilation courant des applications.
Produire des artefacts par plateforme, architecture, ABI et variante, avec
sources, toolchain et options identifiées. Les consommateurs reçoivent le SDK
et les artefacts précompilés compatibles.

- Caches adressés par contenu et réutilisation des caches Cargo/sccache/Bun.
- Outils de développement séparés des artefacts runtime distribués.
- Petit nombre de variantes maîtrisées : serveur, headless, desktop complet.
- Profils appropriés, symboles séparés, LTO et PGO après mesures pertinentes.
- Initialisation différée des services coûteux et ressources à la demande.
- Matrice OS/architecture explicite avec statut réellement qualifié.

Une distribution unifiée peut assembler plusieurs graphes de build reproductibles.
Ne pas forcer Bun et Obscura dans le workspace Tauri au prix d'une régression de
build ou de panic. La fabrique existante reste propriétaire des builds lourds ;
les commandes Cargo Aphrody passent par le wrapper sérialisé existant.

## 11. Compatibilité et identité

| Niveau | Engagement |
| --- | --- |
| API applicative | Contrats versionnés et évolutions maîtrisées |
| Surfaces Bun/Tauri/Obscura retenues | Compatibilité explicitement documentée et testée |
| Internes moteurs et plugins natifs | Alignés avec la version du runtime |

Un plugin Rust Tauri générique peut nécessiter une recompilation avec le runtime.
Une extension utilisant l'ABI stable peut suivre un cycle indépendant.
Conserver les clés Cargo/noms de bibliothèques quand leur compatibilité l'exige.
Ne pas déduire les identifiants runtime/ACL d'un renommage de package.
Déclarer séparément packages, plugins, permissions, commandes et schémas.

## 12. Upstream, provenance et releases

Versionner ensemble la distribution et les révisions exactes de ses composants.
Classer les modifications : adaptation, correction upstream, capacité propre,
optimisation mesurée. Les mises à jour upstream passent par l'intégration avant
promotion vers les consommateurs.

Conserver les imports reproductibles Yolo et ses contrats vendor/dev. Les
transformations mécaniques sont reproductibles ; les changements de logique
restent des commits explicites. Préserver licences, notices, features requises,
provenance et correctifs locaux jusqu'à validation de leur remplacement.

Les releases contiennent SDK, runtime, compatibilité, hashes et procédure de
retour arrière. Négocier la compatibilité runtime/application au chargement,
refuser un ABI incompatible avant l'appel natif. Qualification, installation
locale, publication de package et activation produit sont des états distincts.
Décision du propriétaire du 2026-10-03 : tout doit être déployable et installable en
une commande, comme Bun. Le producteur Yolo publie le runtime, le SDK et le CLI
autonome `yolo` en releases GitHub par tag, avec installeurs `install.sh` et
`install.ps1` (voir [Yolo PLAN](../yolo/PLAN.md) et `docs/DISTRIBUTION.md` côté
Yolo) ; les consommateurs Aphrody dépendent du SDK léger et d'artefacts vérifiés.
Les dépôts restent privés ; la publication sur un registre de paquets (crates.io,
npm) est faite sur demande explicite du propriétaire, car elle est irréversible.

## 13. Mesures et observabilité

Exposer temps de démarrage par composant, opérations et files en cours, latence
JS/natif, copies de données, temps UI, ressources restant à l'arrêt et mémoire
par contexte dans les limites des moteurs.

Mesurer lancement, fenêtre, HTTP, navigation headless, extraction DOM, capture,
appels natifs en volume et fermeture propre. Distinguer froid, chaud et durée
prolongée. Comparer aux mêmes fonctionnalités, versions, profils et matériel.
Aucun pourcentage de gain n'est établi avant comparaison reproductible.

## 14. Phases et preuves de passage

Les gates producteur sont ceux du [plan Yolo](../yolo/PLAN.md). Leur réussite
qualifie la portée effectivement testée ; l'intégration et l'activation dans
Aphrody restent des gates consommateurs. R7 est suivi ici par Aphrody et ne
figure pas dans la table producteur. L'existence des sources ou d'importations
Tauri ne valide aucune phase automatiquement.

| Phase | Livrable | Preuve exigée |
| --- | --- | --- |
| R0 | Contrat minimal SDK/ABI et artefact précompilé | Consommateur léger appelle une capacité sans compiler les moteurs |
| R1 | Hôte Bun avec modules natifs | Appels, erreurs, annulation et libération corrects |
| R2 | Supervision de processus partagée | `agent-browser` migre, retire sa supervision locale et passe ses tests avec arrêt vérifié ; Obscura reste requis jusqu'à R4 |
| R3 | Desktop intégré | Application pilote : fenêtres, événements, permissions et arrêt |
| R4 | Obscura avec moteur actuel | Navigation, extraction et rendu requis dans la distribution |
| R5 | Prototype JavaScriptCore pour Obscura | Cas difficiles exécutés et écarts documentés |
| R6 | Parité et retrait V8 | Consommateurs requis passent, ancien backend retiré du profil promu |
| R7 | Migration des applications | Builds courants utilisent le SDK léger et les contrats produit passent |
| R8 | Optimisation et distribution | Mesures reproductibles, matrice supportée, release et rollback qualifiés |

R3 et R4 peuvent progresser indépendamment après stabilisation du socle. R5/R6
ne bloquent pas les premiers gains de précompilation. Chaque migration a une
preuve avant/après et un retour arrière ; ne pas laisser les deux chemins dans
le build courant sans nécessité explicite.

La première tranche producteur est choisie : `system.stats`, `bench.compute`,
puis `process.supervise` et `http.probe`, exposés par l'ABI C 1.4 et le SDK
`@aphrody/runtime-sdk` 0.1.0 sans dépendances déclarées. Le premier consommateur
est `packages/web/agent-browser/src/engine.ts` ; le patch initial a été testé
puis retiré, avant le raccordement durable livré dans `7b362f10d` (voir R7).
La migration des autres surfaces reste à qualifier selon
[la procédure consommateur Yolo](../yolo/docs/CONSUMERS.md) : archive SDK épinglée
avec provenance, dépendances et lockfile, tests du package puis qualification
des consommateurs aval. Ne pas démarrer toutes les phases à la fois.

### État livré au 2026-10-03

Yolo `dev` : `01300fb2f935f7fb85b135212c718131ae640ff5` livre ABI 1.4,
`0ade1c71ccb52bcc9d255188a252c28c5b789b48` corrige la capacité du superviseur
partagé. Le runtime Linux x64 est reconstruit depuis ce dernier commit propre ;
sa révision embarquée correspond au manifeste. L'installation locale utilise
le propriétaire release et conserve les versions précédentes.

| Surface | Preuve actuelle | Travail restant |
| --- | --- | --- |
| R0 / R1, processus et opérations | ABI 1.4 : sorties binaires sans troncature silencieuse, budgets explicites, workers joints, handles invalidés ; 31 tests Rust, Clippy strict et 36 tests SDK/release passent | Extension Rust légère et surfaces natives supplémentaires |
| R2, consommateur Web | Engine et appels ponctuels utilisent le superviseur SDK commun ; arrêt Unix du groupe même après sortie du leader ; 50 tests agent-browser passent | Qualification Windows du descendant et distribution complète Obscura |
| SDK et installation | Archive 0.1.0 `5334dbe9`, provenance propre, pin catalog/lockfile ; installation locale ABI 1.4 vérifiée | Acquisition reproductible du SDK/runtime par le bootstrap et les fabriques |
| Matrice native | Linux x64 exécuté ; Windows x64, macOS x64/ARM64 et Linux ARM64 passent Cargo check | Exécution, packaging, signature et install/rollback sur chaque autre cible |
| D0 / D2 | Preuves producteur antérieures d'installation Linux x64 et serveur compilé disponibles | Requalifier la distribution complète avec le SDK promu |
| R3 / D3 | Sources desktop et scaffold existants | Adaptateur stable, pilote rendu, droits, événements, arrêt, bundle installé |
| R4 / R5 / R6 | V8 et Obscura restent requis ; module browser encore réservé | Intégration distribuée actuelle, puis parité JSC avant retrait V8 |
| R7 | Consommateur Web et suites aval qualifiés pour ce lot | Migration/build produit de Shenron, RG, Koharu et des autres applications |
| R8 | Hashes, provenance, installation/rollback d'artefacts testés | Benchmarks reproductibles, release complète, signature et activation |

Le [reçu consommateur](docs/migration/runtime-web-consumer-2026-10-03.json)
porte les hashes, les commandes, les résultats aval et les limites.
Les 64 MiB par stream des appels ponctuels sont un budget de durée de vie ;
un dépassement est une erreur explicite. Les descendants qui quittent leur
groupe Unix restent hors ownership ; un writer échappé ne bloque pas les
workers indéfiniment et déclenche une erreur de capture incomplète.
Windows ne qualifie encore que l'arrêt du child direct.

Références producteur : [ABI](../yolo/docs/RUNTIME-ABI.md),
[consommateurs](../yolo/docs/CONSUMERS.md),
[distribution](../yolo/docs/DISTRIBUTION.md).
Aucune activation produit ni réduction mesurée des coûts n'est déduite de ces
gates. La refonte complète reste ouverte.

## 15. Définition de réussite

- [ ] Modifier workflow, écran ou intégration ne reconstruit pas les moteurs.
- [ ] Une extension Rust standard compile avec le SDK léger.
- [ ] Toute ressource native a un propriétaire et une destruction vérifiable.
- [ ] Annulation et arrêt ne laissent ni fuite ni callback invalide.
- [ ] Les droits des pages et extensions sont contrôlés côté natif.
- [ ] Runtime et application évoluent avec compatibilité et rollback qualifiés.
- [ ] Les artefacts lourds sont précompilés pour la matrice supportée.
- [ ] Build, taille et mémoire ont des gains mesurés séparément.
- [ ] Les limites de compatibilité sont documentées.
- [ ] Les anciens chemins inutiles sont retirés après qualification.

## 16. Sprint de production

Exécuter les lots dans cet ordre, avec suppression des anciens chemins dans le
lot qui qualifie leur remplacement. Un ancien moteur ne devient pas du code
mort tant que ses comportements restent nécessaires.

- [x] Corriger ABI/ownership/output et livrer le runtime léger avec gates.
- [x] Épingler le SDK propre, migrer engine et appels ponctuels Web, retirer
  `Bun.spawn` du service et la supervision/lifetime locale du consommateur.
- [ ] Rendre l'acquisition SDK/runtime reproductible depuis un checkout propre,
  sans rebuild moteur ni dépendance à un cache préexistant.
- [ ] Livrer R3 : pilote desktop réel, permissions refusées, événements,
  fermeture, package installé ; intégrer les écrans par leurs propriétaires UI.
- [ ] Livrer R4 : navigateur distribué, navigation, extraction, rendu et
  isolation des contextes par le SDK ; conserver le moteur actuellement requis.
- [ ] Migrer les produits R7 par propriétaire et retirer leurs dépendances lourdes
  remplacées après les suites produit et builds de release.
- [ ] Produire les variantes serveur/headless/desktop par la fabrique existante ;
  qualifier install/upgrade/rollback et santé sur les cibles supportées.
- [ ] Qualifier la parité JSC puis retirer V8 du profil promu.
- [ ] Mesurer séparément build, taille, mémoire et latence ; fermer les dix
  critères de réussite avec preuves reproductibles.

Chaque lot nomme propriétaire, chemins, gates, artefact et état d'installation.
Les limites techniques deviennent le prochain travail d'implémentation ; elles
ne ferment pas la demande par une simple mise à jour documentaire.

- [Consignes](AGENTS.md)
- [Mémoire courante](MEMORY.md)
- [Plan producteur](../yolo/PLAN.md)
- [Worklist complète](docs/plans/runtime/rspyts-alignment.md)
- [Commandes propriétaires](docs/guides/workspace/documentation.md)

## Workflow de simplification et optimisation

Le skill `optimize-workspace` du plugin privé `/home/aphro/plugins/aphrody`
porte les lots de déduplication, purification, optimisation, Bunisation,
Rustisation et fusion. Workspace/Infra reste le propriétaire des opérations :
`aphrody-workspace optimize -- <tâche bornée>` délègue à `aphrody exec` ;
`--print` prépare les instructions sans démarrer d'agent. Les transformations
réutilisent `code-edit` et les capacités existantes, sans nouveau moteur.
Les API natives Bun et les crates/packages complets qualifiés précèdent les
réécritures. Chaque retrait attend ses preuves de comportement et de rollback.
La commande ne constitue pas une preuve de migration du runtime ni de gain de
performance. La livraison sur main et la création de dev préservent les lots
concurrents et les branches existantes.

## État d'intégration du workspace — 2026-10-03

Le monorepo rassemble les domaines produit dans `apps/` et `packages/`, les
capacités Rust dans `crates/`, et leurs contrats d'exploitation dans `config/`.
Les noms de packages et d'API restent compatibles; une ancienne étiquette de
dépôt ne justifie pas de renommer ou supprimer une capacité active.

| Surface | État vérifié pour le lot partagé | Limite restante |
| --- | --- | --- |
| RG website | TypeScript : 0 erreur; 402 tests passés, 0 échec, 2 649 assertions sur 39 fichiers, selon le reçu d'intégration du 2026-10-03 | Build de release et activation non démontrés |
| Shenron site | Lint/typecheck propres; sondes 11/11, éditeur concurrent 2/2, databooks 19/19 selon le reçu d'intégration du 2026-10-03 | Tests RAG live conditionnés à un rapport récent du corpus |
| Shenron sur DBFR | Données PostgreSQL et espaces médias persistants observés; le Redis unique conserve plusieurs index logiques | Le paquet candidat attend l'assemblage officiel, les fichiers d'environnement conformes et des preuves de santé/rollback; site, MCP et bot ne sont pas activés |
| UI et Web | Les packages Bun ne présentaient pas de diff dans l'inspection du 2026-10-03 | Les crates Rust Web restent soumises aux gates Cargo sérialisées |

Cette table rapporte l'état du checkout partagé et de la cible DBFR à la date du
relevé; elle n'autorise ni fusion destructive des données ni activation implicite.
Une consolidation Shenron doit conserver les assets servis, comparer les
identités par chemin et empreinte, dédupliquer sans écraser les divergences, et
garder PostgreSQL, Redis, RAG et sauvegardes dans leurs stores protégés.

Avant livraison, chaque lot doit laisser un reçu avec les chemins possédés,
commandes, résultats et limites. L'intégration finale peut regrouper les lots
terminés dans un commit unique, après avoir comparé le résultat au reçu et sans
perdre de changements présents dans le checkout.

## Exécution directe — correction du workflow, 2026-10-03

Décision du propriétaire : travailler dans les checkouts existants. Aucun clone
supplémentaire, checkout propre, copie de travail ou script propriétaire recopié
pour exécuter ou vérifier ce plan. Réutiliser les caches vérifiés et appeler les
propriétaires en place. Une source absente est un prérequis manquant explicite.

Exécuter chaque lot de bout en bout : lecture ciblée du contrat et du diff,
implémentation directe, gates de la surface modifiée, correction des échecs,
revue du diff et livraison du lot possédé. Ne répéter un gate qu'après une
modification pertinente ou pour résoudre un échec. Aucun nouvel audit global,
archive de code remplacé ou orchestrateur concurrent. Préserver les données,
les caches partagés et les modifications des autres sessions.

Le bootstrap SDK appelle directement le packaging Yolo existant, vérifie son
script contre le commit épinglé et contrôle SHA-256/provenance du résultat.
Il ne clone, ne fetch, ne change de branche et ne copie aucun script. Le SDK
courant est `c81812ea`, produit depuis `27403350547d36ef208068df929bc4e2eeb22218`.
Le runtime natif installé reste issu de `0ade1c71ccb5` ; ces révisions sont distinctes.
L'acquisition native sur une nouvelle machine, desktop, headless, distribution,
parité JSC et qualification produit restent à réaliser avec leurs gates.
