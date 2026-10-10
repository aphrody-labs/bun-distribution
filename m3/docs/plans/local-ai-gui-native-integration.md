<!-- SPDX-License-Identifier: Apache-2.0 -->
# GUI local AI — plan propriétaire

Architecture : [PLAN racine](https://github.com/aphrody-labs/aphrody/blob/main/PLAN.md).
Décisions AI : [plan AI](https://github.com/aphrody-labs/aphrody/blob/main/docs/plans/ai/native-integration-master.md).
Jan fournit les concepts de hub local, sans code importé.
La GUI reste un client des owners AI, pas une seconde implémentation métier.

## Owners

| Surface | Source |
| --- | --- |
| Desktop et broker | `crates/ui/app`, app-server propriétaire AI |
| Traits toolkit-neutral | `crates/ui/gui-core` |
| Hub modèles et view models | `crates/ui/local-ai` |
| UI applicative | `packages/app-ui`, composants `packages/m3-ai` |
| Scaffolding | `packages/scaffold`, `web-to-tauri` |
| Wrapper sites tiers | `tauri-wrap` ; sidecar conserve ce rôle produit |
| Debug/automation | `tauri-mcp`, pas façade métier |
| Explorer/A2A | `ui/drive`, `ui/a2a-ui`, selon leurs contrats |

AI fournit inférence/providers/gateway, threads/session/rollout, tools/skills,
assistants/prompts, MCP et RAG. Web search reste chez Web. Updater/tray/deep-links,
préférences et shortcuts restent chez app/integration et plugins retenus.

## API toolkit-neutral

`ModelHub::new/with_root`, `store_root`, `catalog`, `installed`,
`recommend`, `hardware`, `verify`, `remove`, `pull`.
Conserver les JSON CLI, les erreurs Model/Invalid/Cancelled, progress/cancellation,
le store choisi et le contrat de reprise `.part`. Travail bloquant sur pool dédié.

Adapters Tauri : commandes historiques, événement `aphrody://model-pull`,
map Pulls/cancel et argument names inchangés. Modèle corrompu :
`intact:false` ; recommend sans candidat : erreur.

## Jalons et qualification

| Travail rapporté W1–W8 | Preuve à conserver ou compléter |
| --- | --- |
| W1 hub et commandes modèles en processus | Parité catalog/install/recommend/verify/remove/pull |
| W2 broker app-server en processus | Duplex tokio, task restart, id rewriting, replay, event routing, arrêt joint/rollout flush |
| W3 CLI/desktop même owner | JSON identiques, aucun nouveau shaping concurrent |
| W4 serveur local/view model | Gateway loopback 127.0.0.1:8795, lifecycle/cancellation/refus origine |
| W5 assistants/MCP/RAG view models et M3 | Schémas typés, composants partagés, parcours rendu |
| W6 hub/catalog search | Références modèles épinglées ; distinguer catalog search et recherche HF live |
| W7 appels kernel natifs | Env/host/capture via owners ; retirer sidecars propres après parité |
| W8 neutralité toolkit | Core sans toolkit/IPC ; tests et consommateur indépendant |

Le précédent document marquait ces jalons FAIT tout en indiquant qu'aucun
build n'avait été exécuté. Ces marqueurs ne qualifient pas les gates ci-dessus.
Vérifier source, tests, UI rendue, artefact installé et shutdown séparément.

## Contraintes

Passer models-dir comme option explicite à AppServer ; ne pas muter l'env du
processus multithread. Closing duplex déclenche join/flush. Qualifier le contrat
du daemon géré au host qui embarque app-server, selon le owner inférence.

Les modes sidecar tiers et OS shell integrations restent distincts des hops
AI à supprimer. Retirer externalBin/APHRODY_BIN après migration des consommateurs.
M3-ai possède les composants chat communs ; produit et données restent chez
leurs propriétaires. MLX macOS reste un écart, pas un backend qualifié.

Manifests/pins existants font autorité ; Rust sérialisé et Bun scoped, puis
pilote desktop/permissions/arrêt/release. Aucun nouveau build lancé pour cette prose.
