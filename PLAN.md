<!-- SPDX-License-Identifier: Apache-2.0 -->
# Runtime natif unifié — plan directeur Aphrody

Décision du propriétaire : 2026-10-03. Statut : architecture cible et feuille de
route autorisées ; implémentation, compatibilité et gains encore à qualifier.

Ce plan remplace le plan racine antérieur, conservé intégralement dans
[les archives](docs/plans/runtime/history/README.md). Les réalisations, dettes,
preuves et obligations produit antérieures restent consultables dans l'archive ;
elles ne deviennent pas des validations du nouveau runtime.

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
l'abandon de leurs contrats. Le checkout séparé `aphrody-ui` reste hors périmètre
sans mission UI explicite.

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
puis `process.supervise` et `http.probe`, exposés par l'ABI C 1.3 et le SDK
`@aphrody/runtime-sdk` 0.1.0 sans dépendances déclarées. Le premier consommateur
est `packages/web/agent-browser/src/engine.ts` ; le patch producteur a été testé
puis retiré. Le raccordement durable dans Aphrody reste la prochaine tranche,
selon [la procédure consommateur Yolo](../yolo/docs/CONSUMERS.md) : archive SDK
épinglée avec provenance, dépendances et lockfile, patch, tests du package puis
qualification des consommateurs aval. Ne pas démarrer toutes les phases à la fois.

### État synchronisé au 2026-10-03

Sources relues dans Yolo au commit `07419cffb4beeb0f104b33a75cb23ea4a1c06def`
(checkout propre lors du relevé). Les preuves ci-dessous distinguent les
résultats documentés par le producteur de ceux relancés pendant cette synchronisation.

Le dernier commit ajoute aussi le relais CLI vers les propriétaires Aphrody
(`infra`, `ops`, `workspace`, `workflow`, `git`, `ssh`), `ship` vers la fabrique
et l'installation d'un hook pre-push. Ces sources existent dans
`apps/cli/src/aphrody.ts` et `scripts/ship_remote.sh` côté Yolo ; ce relevé ne
prouve ni build distant réussi ni hook installé.

| Phase | État et portée de la preuve |
| --- | --- |
| R0 | Runtime C ABI 1.3, SDK et artefact Linux x64 présents. Gate complet `just runtime-test` déclaré passant par Yolo ; aucune relance Cargo ici. |
| R1 | Preload et modules system/process opérationnels : tests SDK relancés contre une bibliothèque précompilée, y compris erreurs, annulation, limites et destruction. Aucun hôte Bun forké reconstruit. |
| R2 | Patch `agent-browser` documenté : 33 tests passent avant/après, TypeScript et oxlint passent, aucun processus résiduel. Patch retiré ; `engine.ts` utilise encore `Bun.spawn` et le package ne déclare pas le SDK. Migration Aphrody non livrée. |
| D0 | Release locale 0.1.0 Linux x64 présente. Installation isolée, réinstallation, doctor et scaffold documentés dans Yolo ; non relancés ici. |
| D1 | Workflow cinq cibles et fusion des assets présents ; première release par tag et upgrade à qualifier selon le plan producteur. |
| D2 | Compilation, archive serveur et exécution extraite sans Bun/Rust documentées sur Linux x64 ; Docker et systemd non exécutés. |
| R3 / D3 | Scaffold desktop : Cargo check documenté. Module desktop, fenêtre pilote, permissions, arrêt et installation des bundles restent à qualifier. |
| R4 / R5 / R6 | Intégration headless, port JSC et retrait V8 restent ouverts. Le module browser est réservé ; Obscura demeure externe. |
| R7 | `agent-browser` raccordé durablement (commit `7b362f10d`, pas seulement patch testé puis retiré) : `engine.ts` utilise `@aphrody/runtime-sdk`, surface publique inchangée. Consommateurs directs qualifiés contre ce changement précis : `fut` (148 tests), `rg/cron` (174 tests), `aphrody-web-test` (41 tests), 0 échec ; `web-to-tauri` non affecté (n'importe que `cdp`/`tauri`) ; aucune dépendance Shenron trouvée sur ce paquet. Reste ouvert : `service.ts` garde son `Bun.spawn` direct, et les gates produit plus larges de R7 (migration des applications vers le SDK léger en général) ne sont pas qualifiées par ce seul lot. |
| D4 / R8 | Publication de packages sur demande du propriétaire ; benchmarks, signature et matrice supportée restent à qualifier. Aucun gain mesuré annoncé. |

Vérification relancée : `bun test test/runtime_sdk.test.ts test/runtime_release.test.ts`
dans Yolo : **28 tests passent, aucun échec ni test ignoré**. Cela couvre aussi
hashes, refus d'ABI/cible incompatibles, installation et rollback en répertoire
temporaire ; cela ne valide pas les installeurs de release ni l'intégration produit.
L'artefact `dist/runtime/x86_64-unknown-linux-gnu` vérifié par ces tests déclare
ABI 1.3, profil `runtime` avec unwind, SHA-256 bibliothèque
`7766c4074d77150c7205981818e3d40382aea19d786d7af61d6f8bcc816d9b10`.
Sa provenance est `ad8d4e148e755b50d00c683c4df83296d68829c8`, `dirty: true` ;
il n'est donc pas présenté comme un build propre du HEAD observé.
La release locale déclare séparément le commit `2cecec212ed3540350f0a7dc25a84c4a3d1a0010`.
macOS, Windows, Linux ARM et `install.ps1` ne sont pas qualifiés par ce relevé.

Références producteur : [ABI](../yolo/docs/RUNTIME-ABI.md),
[décisions D5/D10/D11](../yolo/docs/DECISIONS.md),
[consommateurs](../yolo/docs/CONSUMERS.md),
[distribution et preuves locales](../yolo/docs/DISTRIBUTION.md).
Les documents ABI et MEMORY Yolo contiennent encore des réserves historiques
(rollback absent, phases non qualifiées par le lot documentaire initial) ;
elles ne remplacent pas les tests actuels et les preuves de distribution plus récentes.

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

## 16. État documentaire et références

Le lot documentaire initial du 2026-10-03 remplace le plan directeur et les
consignes, crée la mémoire courante et aligne les documents Yolo.
Il ne migre aucun code, ne change aucun
profil Cargo et ne qualifie aucun runtime. Les preuves historiques restent
historiques et les modifications concurrentes du checkout restent distinctes.
La synchronisation suivante, décrite en section 14, relève l'implémentation Yolo
et ses preuves actuelles sans modifier le runtime ni activer de consommateur.

- [Consignes du dépôt](AGENTS.md)
- [Mémoire courante](MEMORY.md)
- [Plan producteur Yolo](../yolo/PLAN.md)
- [Archive exacte et hashes](docs/plans/runtime/history/README.md)
- [Documentation et commandes propriétaires](docs/guides/workspace/documentation.md)

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
