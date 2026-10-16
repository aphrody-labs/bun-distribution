<!-- SPDX-License-Identifier: Apache-2.0 -->
# Workflow unifié — Aphrody, WinClean, niers et Ghidra

**Statut :** contrat opérationnel, synchronisé depuis
`niers/docs/WORKFLOW-UNIFIE.md` le 2026-09-07.

This workflow describes reproducible execution within the unified Bun OS
product. Historical capability names and application domains do not define
separate products or exclusions from integration. Source owners, imported
licenses and host-specific deployment permissions remain explicit; this
workflow does not itself qualify physical migration or production activation.

## 1. Principe directeur

Chaque action suit cette chaîne :

```text
demande humaine
  -> plan borné et identifiant de run
  -> niers (CLI / crates Rust / MCP)
  -> outil spécialisé (Aphrody, WinClean ou Ghidra)
  -> artefact + journal + preuve
  -> décision humaine ou étape suivante
```

Une déclaration d'outil, un build vert ou une fenêtre ouverte ne constitue pas
à elle seule une preuve de résultat. Une preuve nomme la commande ou l'appel,
le périmètre, l'horodatage, le code de sortie et l'artefact observé.

## 2. Responsabilités et frontières

| Surface | Responsabilité | Entrée canonique | Sortie attendue |
|---|---|---|---|
| `niers` | orchestration, formats Level-5, VFS, données, CLI, traces et rapports | chemins VFS, binaire, dump, config de run | JSON/PNG/GLB/rapport reproductible |
| Aphrody (`nie-site`) | présentation publique et API autorisée | résultats validés de `niers` | page ou endpoint borné, sans accès arbitraire au dépôt |
| WinClean | observation et contrôle Windows explicitement autorisé | application, fenêtre, PID, action native | observation avant/après, PID et état UI |
| Ghidra/GhidrAssistMCP | analyse interactive du binaire actuellement ouvert | projet CodeBrowser, binaire, adresse/fonction | décompilation, symboles, xrefs, structures, export |
| Codex Computer Use | pilotage visible et vérification d'interface | surface déclarée, état observé | action UI et nouvelle observation |

WinClean et Computer Use pilotent ou observent ; ils ne deviennent pas des
moteurs de vérité. Ghidra produit le savoir de RE ; `niers` le normalise et le
versionne. Aphrody ne reçoit que des résultats explicitement destinés à être
servis.

## 3. Routage par type de demande

1. **Données, formats, VFS ou batch** : commencer par `niers` (`vfs`,
   `decode`, `lua`, `wiki`, `render`, `report`). Le chemin VFS et le hash sont
   les identifiants de référence.
2. **RE d'un binaire** : vérifier d'abord le binaire et son empreinte avec
   `niers`/`aphrody-re`, puis utiliser Ghidra pour la décompilation et les
   xrefs. Exporter vers un format consommable par `nie-seed` ou `nie-index`.
3. **État du jeu ou d'une application Windows** : observer avant toute action
   avec WinClean ou Computer Use, capturer PID et fenêtre, agir, puis observer
   à nouveau. Une relance est bornée et son PID doit être suivi ; aucun
   `pkill -f`.
4. **Rendu, asset ou interface** : produire avec les outils du dépôt, lancer
   la surface réelle, capturer l'artefact et l'inspecter visuellement. Une
   capture hors écran prouve le rendu produit, pas automatiquement la fidélité
   au jeu.
5. **Publication Aphrody** : valider localement, servir uniquement la route
   prévue, vérifier la réponse live et conserver le rapport. Les routes de
   lecture de code dépôt restent désactivées par défaut et authentifiées si
   elles sont nécessaires.

## 4. Contrat de run

Tout travail non trivial possède un répertoire borné :

```text
var/runs/<run-id>/
  pending/     # entrées déclarées
  results/     # sorties validées
  logs/        # commandes, appels, stderr, timestamps
  evidence/    # captures, réponses live, hashes
  manifest.json
```

`manifest.json` contient au minimum `run_id`, `requested_scope`,
`tool_versions`, `inputs`, `actions`, `outputs`, `status` et `evidence`. Les
secrets, dumps privés et gros assets restent locaux ; le manifest peut les
référencer par hash sans les copier. Un résultat chaîné devient une entrée
`pending/` du run suivant avec son hash conservé.

## 5. Niveaux de preuve

| Niveau | Signification | Exemple |
|---|---|---|
| P0 | intention/configuration | outil déclaré dans MCP |
| P1 | exécution locale | commande terminée avec code 0 |
| P2 | artefact inspecté | JSON/PNG/GLB ou décompilation vérifiée |
| P3 | surface réelle | UI lancée, jeu observé, endpoint live ou service sondé |
| P4 | reproductibilité | run borné, manifest, hash et test indépendant |

Une livraison de code vise P2 au minimum ; un déploiement ou une affirmation
runtime vise P3 et P4. Les hypothèses restent marquées comme telles dans le
rapport.

## 6. Sécurité et MCP

- Toute opération Windows destructive ou externe annonce sa cible et son impact
  avant exécution.
- Les actions Computer Use ré-observent l'état après chaque interaction
  importante.
- Ghidra ne modifie le projet ou le binaire que dans le périmètre demandé ;
  ses exports sont des données non fiables jusqu'à validation.
- Un serveur MCP stdio réserve stdout au JSON-RPC ; les diagnostics vont dans
  stderr.
- Les serveurs HTTP n'exposent pas de routes de lecture arbitraire du dépôt
  sans authentification.
- Une entrée MCP prouve uniquement P0. Chaque skill doit vérifier que le
  serveur ou le connecteur répond avant de revendiquer P3.
- Les identifiants et noms techniques restent en anglais ; les rapports
  adressés à l'utilisateur sont en français.

## 7. Definition of done

Un lot est terminé seulement si :

1. le périmètre et les entrées sont écrits dans le manifest ;
2. le test ou build pertinent a réellement tourné ;
3. l'artefact est inspecté, pas seulement créé ;
4. toute surface live concernée a été sondée ;
5. le rapport distingue faits vérifiés, hypothèses et éléments non validés ;
6. aucune modification étrangère au lot n'est écrasée.
