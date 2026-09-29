---
name: workflow-unifie
description: Router les travaux Rose Griffon qui croisent Aphrody, WinClean, niers, Ghidra ou Computer Use avec un run borné et des preuves graduées.
argument-hint: "[demande ou symptôme]"
allowed-tools: mcp__plugin_rose-griffon_rose-griffon, mcp__rose-griffon, Bash, Read, Write, Grep
---

# Workflow unifié Rose Griffon

Pour tout travail non trivial, créer un run unique sous
`var/runs/<run-id>/` :

```text
pending/     # entrées déclarées
results/     # sorties validées
logs/        # commandes, appels, stderr, timestamps
evidence/    # captures, réponses live, hashes
manifest.json
```

Le manifest contient au minimum `run_id`, `requested_scope`, `tool_versions`,
`inputs`, `actions`, `outputs`, `status` et `evidence`. Les secrets, dumps
privés et gros assets ne sont jamais copiés dans le run : les référencer par
hash et chemin local.

## Routage

1. Données, VFS, formats Level-5, batch, rendu ou rapport : commencer par
   `niers` (`vfs`, `decode`, `lua`, `wiki`, `render`, `report`).
2. RE d'un binaire : vérifier l'empreinte avec `niers`/`aphrody-re`, puis
   utiliser Ghidra/GhidrAssistMCP sur le binaire actuellement ouvert. Un index
   historique désaligné n'est pas la vérité terrain.
3. Jeu ou application Windows : observer avec WinClean ou Computer Use, noter
   PID et fenêtre, agir dans le périmètre demandé, observer à nouveau et
   conserver les deux états. Une relance est bornée ; aucun `pkill -f`.
4. Asset ou interface : lancer le consommateur réel et inspecter la sortie ;
   une capture hors écran ne prouve pas la fidélité au jeu.
5. Publication ou production Rose Griffon : valider l'artefact localement,
   sonder l'URL/service réel et conserver la réponse dans `evidence/`.

## Preuve et garde-fous

| Niveau | Ce qui est établi |
|---|---|
| P0 | outil ou configuration déclaré |
| P1 | commande locale terminée avec code 0 |
| P2 | artefact inspecté |
| P3 | UI, jeu, endpoint ou service réel observé |
| P4 | run borné, manifest, hashes et test indépendant |

Un plugin installé, une entrée MCP, un build vert ou une fenêtre ouverte ne
prouve que P0 au mieux. Les claims de code visent P2 ; les claims runtime et
déploiement visent P3/P4. Marquer les hypothèses et surfaces non validées.

Le serveur Rose Griffon reste la source pour les données et l'exploitation du
monorepo. Ne pas ajouter de chemin stdio vers un autre dépôt dans le `.mcp.json`
du plugin : `niers`, WinClean, Ghidra et Computer Use sont des surfaces
optionnelles à vérifier dans leur connecteur actif. Ne jamais copier de jeton
dans un fichier de config ni exposer de lecture arbitraire du dépôt par HTTP.
Les diagnostics d'un MCP stdio vont sur stderr ; stdout reste réservé au
JSON-RPC.

## Restitution

Conclure avec le chemin du run, les commandes et codes de sortie, les artefacts
et hashes, les sondes live, le niveau de preuve par affirmation, puis séparer
faits vérifiés, hypothèses et limites. Le `results/manifest.json` d'un run peut
devenir une entrée `pending/` du run suivant avec son hash conservé.
