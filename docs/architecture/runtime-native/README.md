<!-- SPDX-License-Identifier: Apache-2.0 -->
# Frontière runtime Yolo / produit Aphrody

Autorité : [PLAN.md](../../../PLAN.md), notamment les sections 1, 6, 9,
12 et 14. Cette page organise la lecture du contrat ; elle n’introduit aucun
contrat SDK supplémentaire et ne remplace pas les gates du plan.

| Surface | Propriétaire | Référence |
| --- | --- | --- |
| Runtime précompilé, moteurs et SDK | Yolo (`/home/aphro/yolo`) | Plan producteur et procédure `/home/aphro/yolo/docs/CONSUMERS.md`, liés depuis le plan racine |
| Workflows, intégrations et données métier | Aphrody | [Parcours consommateur](../../guides/workspace/runtime-consumer.md) et gates R7 du plan racine |
| Orchestration, inventaires et fabrique | Workspace/Infra | [Conventions](../../reference/workspace/LAYOUT.md) et [CLI propriétaire](../../reference/workspace/CLI.md) |
| Provenance des imports existants | Propriétaires des capacités et Workspace/Infra | [Sources déclarées](../../../config/upstream-sources.json), à conserver jusqu’au remplacement qualifié |
| Documentation et index générés | Workspace | [Guide documentaire](../../guides/workspace/documentation.md) |

## Contrat stable et mécanismes internes

La frontière applicative est une ABI C versionnée : poignées opaques, buffers
avec ownership explicite, erreurs, annulation, capacités, règles de thread et
durée de vie. Consulter la section 6 du plan avant de modifier une interface.
Les types Rust internes et une rlib ne constituent pas une ABI stable entre
versions de compilateur. Les extensions et plugins restent soumis aux règles
de compatibilité de leur artefact réel.

La façade JS/TS est fournie par le SDK producteur. Les noms `runtime:*` du plan
ont des états différents : vérifier les capacités de l’artefact épinglé avant
usage. Un module réservé n’est pas une fonctionnalité disponible. Le mécanisme
initial `bun:ffi` avec preload `Bun.plugin` ne démontre pas un hôte Bun forké
reconstruit ni une compilation anticipée complète de JavaScript.

## Sécurité et moteurs

Chaque contexte possède ses droits, sessions et travaux. Une page distante
n’hérite pas des API privilégiées Bun ; les contrôles natifs et permissions
Tauri restent requis. Cookies, secrets et mémoires de domaines ne sont pas
fusionnés par la mutualisation des mécanismes.

Obscura conserve V8 jusqu’à la parité requise pour le port JavaScriptCore.
Les WebViews desktop gardent leurs moteurs de plateforme. Une intégration
précompilée peut progresser avant cette convergence ; elle ne prouve pas un
moteur unique partout. Les workers natifs isolés répondent à une frontière de
panne ou sécurité définie, sans remplacer l’intégration par un pont CLI.

## Lire les preuves sans confondre les états

[Le parcours de qualification](qualification.md) sépare source, build,
comportement, packaging, installation et activation. Les résultats producteurs
ne qualifient pas automatiquement les consommateurs Aphrody. Le statut daté,
les hashes d’artefacts et les gates ouverts sont ceux du plan racine ; cette
page évite d’en entretenir une copie susceptible de diverger.

Les [archives antérieures](../../plans/runtime/history/README.md) restent
inchangées. Leurs références relatives se résolvent selon la base historique
indiquée dans leur README. Elles préservent provenance et obligations produit,
sans concurrencer la direction active.
