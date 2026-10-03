<!-- SPDX-License-Identifier: Apache-2.0 -->
# Intégration AI native — plan directeur du domaine

Architecture et exécution autonome : [PLAN racine](../../../PLAN.md).
Règles/gates : [AGENTS.md](../../../AGENTS.md). Ce plan possède la répartition
AI, pas une seconde politique de build, de permissions ou de livraison.

Objectif : réutiliser les capacités Aphrody, réduire les copies et les hops
sur les chemins locaux, préserver contrats, stores et API des produits externes.
Références upstream via leurs propriétaires, sans nouveau clone ni copie source.

## Plans uniques

| Domaine | Propriétaires | Plan |
| --- | --- | --- |
| Retrieval/index/mémoire | `rag*`, `embed`, `memory`, `context` | [RAG](rag-native-integration.md) |
| Inférence/modèles/protocoles | `model-client`, `models`, `llama-server`, `engine-mistralrs`, `gateway` | [Inférence](inference-native-integration.md) |
| CLI/config/MCP/plugins/peers | `apps/cli`, `aphrody-command`, propriétaires AI correspondants | [CLI](cli-native-integration.md) |
| UI et façade toolkit-neutral | `ui/app`, `ui/local-ai`, `ui/gui-core`, `m3-ai`, app-server | [GUI](../ui/local-ai-gui-native-integration.md) |

Compléments : `project-doc` possède AGENTS ; `agent-runtime`, `exec-events`,
`rollout`, `session`, `patch` possèdent l'exécution ; `marketplace` les
manifests ; `skills` discovery/hooks, `skills-forge` authoring ; kernel/settings/
secrets les chemins et endpoints. Les autres services AI conservent leurs owners.

## Décisions communes

- `ModelClient` est la frontière provider. GGUF local : `koharu-llama` ;
  mistral.rs reste optionnel et hors build CLI par défaut.
- Pin mistral.rs déclaré dans [Cargo.toml](../../../Cargo.toml), révision
  `3f2515e9b5adc2ac44949c128c50a13b15721294` observée le 2026-10-03.
  Aucun type candle entre owners ; backends GPU sélectionnés par feature.
- `gateway` reste la façade serveur OpenAI-compatible sur les owners modèles.
  Retirer les clients doublons et `router` seulement après migration/parité.
- Codex : protocole/schémas et tests de conformité, sans seconde implémentation
  ni ajout de `codex-*` lourd. Forward externe optionnel selon besoin produit.
- Ollama/vLLM : clients protocoles et lecture de store autorisée, sans lancer
  les moteurs distants via un nouveau supervisor.
- LiteLLM : référence et endpoint externe optionnel ; aucun SDK Python, seconde
  façade/router ou workspace Rust beta. [Revue](../../research/ai/litellm-review-2026-10-01.md).
- Jan/LlamaIndex : concepts attribués, pas imports d'implémentation.
  openfox : aucune copie tant que licence non qualifiée.
- Conserver hooks/MCP stdio/outils externes réellement nécessaires, protéger
  permissions/origines et profils. Retirer les chemins remplacés après leurs gates.

## Ordre

1. Qualifier les modifications AI existantes : manifests, features et propriétaires.
2. Fermer les queues RAG/inférence/CLI/GUI avec leurs gates scoped.
3. Raccorder les consommateurs, retirer les doublons, vérifier wasm où supporté.
4. Livrer les lots possédés sans confirmation intermédiaire ; aucun lancement
   automatique d'anciens agents ni restauration automatique de stash.

## Preuves datées et limites

Le relevé du 2026-10-01 rapporte un pré-lot modèles/local-ai/RAG/app/CLI :
177 tests pour modèles/local-ai/RAG, checks ciblés passés. La vague suivante
a été interrompue ; ses fichiers ne sont pas qualifiés par ces résultats.
Les anciens diagnostics et noms d'agents ne sont pas un état courant.

À la reprise : vérifier Git, claims et sources sélectionnées, puis suivre les
plans propriétaires. Une lecture de manifeste ou un marqueur FAIT documentaire
ne qualifie pas un backend GPU, une GUI rendue ou une release complète.
