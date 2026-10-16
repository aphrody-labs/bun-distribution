<!-- SPDX-License-Identifier: Apache-2.0 -->
# Bridge Bun Yolo et host CPython — 2026-10-14

La qualification Windows x64 utilise le même host CPython pour appeler le graphe
Python Aphrody et le SDK natif Bun. L'installation temporaire du SDK est hors
des checkouts ; les trois façades producteur et les fichiers natifs sont copiés
avec vérification SHA-256 puis retirés après le gate. Aucun moteur, interpréteur,
poids, service, secret ou source de fournisseur n'est créé dans Aphrody.

## Artefacts mesurés

| Composant | Source et SHA-256 |
| --- | --- |
| Bun 1.4.4, Windows x64 | Révision `4b8dee0bc69d2c290111001f2249e63e1dc95b70`, binaire `5e66ef065b502606182a1cfad2e0d2681ee0f9acfed314ae2cf9ee6c22e393ef` |
| SDK `buv-runtime`, ABI additive 1.6 | Source propre `ffb9a96ceb4131829c441d17d5713d9c6de27a56`, DLL `dbce4057ca89bb622d60ab87f555706b5cf9614e04799ee608b69d110f364e06`, manifeste `30759d7ab6487650a4ca7c46db6afca82a8702e63c5ff291c406c704092a2352` |
| Host `bun-python-host`, ABI 1 | DLL existante `c8c7e7888306c3cdfee875742738f71c73b0a8396a6649458eab2968e8ac05b5`, build antérieur identifié dans le [gate host](yolo-python-host-2026-10-13.md) à `c98bee01e747d05151d9a49d9a210197e14dfda5` |
| CPython Aphrody 3.12.15 | `python312.dll`, `0fa23e4d1dc49a412d7017ae3ffefbd40e4063f60d3eaf437dcc294b7861620f` |

Les sources des composants diffèrent : ce reçu établit leur comportement commun
sur cet hôte, pas une release globale issue d'un unique commit. Les hashes des
façades installées et du snapshot consommateur sont dans
`.coord/bun-yolo-bridge/qualification.json`, avec les logs adjacents. Les sources
de l'application passent Ruff, mypy et `bun check` ; les nouvelles signatures
empruntent directement `Options`, `Question` et `Result` du SDK producteur.

## Gates exécutés

52 tests Python et 9 tests TypeScript passent, incluant les deux gates séparés
du host natif. La qualité passe Ruff/format Python, mypy sur les trois sources
Python touchées, lint/format OXC et `bun check` sur les trois sources TypeScript.

- SDK installé hors checkout : manifeste, target, source, SHA et capacités
  `process.stdin`/`process.wait` vérifiés avant le spawn ; bibliothèque native
  effectivement chargée.
- Graphe Python existant : `Yolo.inspect_async` indépendant et nouvelle portée
  synchrone sur le worker du host ; réponses natives synthétiques, seuil 0.8,
  confidence 0.6, abstention, usage `null` puis `12/3`, `executed=false`.
- Host CPython unique : PID identique à Bun avant/après les appels, modules SDK
  chargés hors checkout, scopes successifs fermés puis host fermé explicitement.
- Mauvais SHA du binaire : `ERR_DECISION_ARTIFACT_HASH` propagée avant activation
  du SDK. Le test attend directement la promesse et vérifie l'erreur capturée.
- Fournisseur silencieux : HTTP loopback sur port 0 et clé publique de fixture,
  deadline 1.5 s du superviseur, arrêt/jonction du processus, fermeture de la
  portée, `ERR_DECISION_DEADLINE`, puis nouvelle évaluation réussie du host.
- Portée JS : refus d'appel simultané/fermé, capture des pins avant mutation,
  bornes UTF-8 de 1 MiB et `close()` qui rejoint l'appel sans fermer le host.
- Ancien helper privé HTTP : son gate séparé reste exécuté dans un autre
  processus Bun, avec un serveur loopback et sans fournisseur externe.

La règle de host unique reste importante : le lot ne prétend pas qualifier la
réouverture de CPython après chargement des extensions Pydantic. Le SDK placé
temporairement hors checkout n'est pas une wheel publiée. Ni inference de modèle,
activation de service, release multiplateforme ni retrait des anciennes routes
ne découle de ces gates. Voir les [propriétaires restant à basculer](../../plans/yolo-decision/BUN-CUTOVER.md).
