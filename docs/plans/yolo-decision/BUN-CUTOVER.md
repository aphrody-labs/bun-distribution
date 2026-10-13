<!-- SPDX-License-Identifier: Apache-2.0 -->
# Consommateurs Python du Bun Yolo natif

`aphrody.decision` garde ses contrats applicatifs, son Agent Pydantic AI, son
graphe Pydantic Graph et ses évaluations. Le consommateur emprunte le client
`Yolo` de l'unique SDK Bun (`bun_yolo`), avec son `Runtime` vérifié ; aucune
inférence, supervision ou validation de distributions n'est copiée ici.

```python
from aphrody.decision import YoloDecision, decide_async_json

# bun_client : Yolo appartenant à l'appelant, SDK et binaire qualifiés.
decision = await YoloDecision.from_bun(bun_client).decide(inputs)
serialized = await decide_async_json(inputs.model_dump_json(), bun_client=bun_client)
assert decision.executed is False
```

Le client SDK reçoit le modèle, le seuil `minimum_confidence`, le délai et zéro
retry. Bun valide le seuil avant d'appeler le fournisseur ; Rust renvoie les
`selections`, y compris `None` pour une abstention. Python vérifie seulement la
liaison de la réponse au catalogue applicatif. L'appelant termine les opérations
du client avant de fermer son `Runtime` ; cet adaptateur ne les ouvre ni ne les
ferme. La deadline du graphe annule la coroutine SDK ; la terminaison du processus
possédé relève du superviseur Bun et de sa qualification native.

## Usage explicite

`JevResponse.usage` et `DecisionOutput.usage` valent un comptage fourni ou `None`.
Le champ est obligatoire, tout comme les deux compteurs d'un usage fourni. Une
absence ou un objet partiel échoue ; un vrai zéro doit être déclaré explicitement.
Le JSON applicatif conserve `"usage": null`, sans estimation de tokens ou coût.

Pydantic AI 2.55.0 impose un `RequestUsage` non nullable pour sa comptabilité
interne. Quand le fournisseur ne mesure pas les tokens, l'adaptateur ajoute
`details.aphrody_provider_usage_missing=1` et
`ModelResponse.metadata.aphrody_provider_usage=None`. Ses compteurs internes
par défaut ne sont pas des mesures fournisseur : utiliser l'usage nullable de
`DecisionOutput` pour toute sortie ou facturation. La borne porte sur un appel
et un délai, sans promesse de budget tokens sur un usage inconnu.

## Condition de bascule native

Les fixtures valident cette injection, la sélection/abstention, l'annulation,
la conservation d'usage et les évaluations existantes. Elles ne qualifient pas
un artefact installé. Avant d'activer le client sur un hôte :

1. Vérifier le manifeste SDK, le target, les hashes/provenance et les capacités
   `process.stdin`/`process.wait` de l'ABI additive 1.6. L'ancienne ABI 1.4/1.5
   échoue explicitement avant tout lancement privé.
2. Qualifier le binaire Bun exact avec le worker `bun:yolo` et des réponses
   synthétiques passant par le propriétaire Rust : primitives, usage nul ou
   fourni, seuil invalide, abstention, annulation et fermeture stdout/stderr.
3. Exécuter le même graphe depuis le Python consommateur, puis l'installation
   hors checkout et le host `bun:python` sélectionné. Fournisseurs payants,
   clés, corpus et sessions ne sont pas nécessaires aux fixtures.
4. Injecter ce client vérifié dans l'application avant de retirer les anciennes
   routes. Les preuves doivent identifier le binaire et le SDK réellement chargés.

Le gate consommateur adjacent `test_bun_decision_native.py` est opt-in via
`BUN_YOLO_NATIVE_GATE=1`. L'appelant fournit `BUN_YOLO_EXECUTABLE`,
`BUN_YOLO_REVISION`, `YOLO_RUNTIME_HOME` et le `PYTHONPATH` du SDK qualifié ; le
test ne recherche ni ne copie un moteur. Son fournisseur synthétique passe
réellement par `bun:yolo`/Rust et les pipes du superviseur natif. L'absence d'une
preuve ABI/binaire reste un gate en attente, même si les fixtures passent.

## Références encore non basculées

| Référence | État et condition |
| --- | --- |
| `decision/workflow.py:decide_json` appelé sans `bun_client` | Conserve le endpoint privé explicite `APHRODY_YOLO_DECISION_ENDPOINT` et son token de service ; aucune bascule automatique à partir d'une variable d'environnement. |
| `decision/bridge.ts` et `tests/decision-bridge.test.ts` | Le host CPython appelle encore le helper JSON sans client SDK emprunté. Injection/lifetime de ce host à qualifier après les gates Bun + ABI1.6. |
| `decision/backend.py:JevHTTP` | Transport privé optionnel conservé, avec ses tests d'authentification, TLS et refus de redirection. |
| `decision/typesafe.py:TypeSafeClient`, `AsyncTypeSafeClient` | Alias du vrai SDK TypeSafe HTTP encore conservés ; primitives et réponses publiques diffèrent de la façade brute Bun. Leur remplacement exige un gate de compatibilité, sans fabriquer l'usage absent. |
| `decision/typesafe.py:comparison_client` | Client comparatif optionnel amont conservé ; aucune qualification de modèle ou migration de son moteur revendiquée. |
| Extras `aphrody[decision]`, `aphrody[decision-compare]` et `py/uv.lock` | Pins et packaging préservés. Une façade importable du SDK Bun doit être qualifiée hors checkout avant toute modification de dépendances. |
| Serveur Rust privé Aphrody `/v1/systemone` | Route applicative encore consommée par les chemins HTTP ci-dessus ; ne retirer son intégration qu'après leur bascule mesurée au propriétaire Bun. |

Les données étiquetées, exports train et résultats d'évaluation restent chez
l'appelant. Ni corpus, secrets, poids ni sessions ne sont déplacés par ce lot.
