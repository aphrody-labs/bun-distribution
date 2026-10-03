<!-- SPDX-License-Identifier: Apache-2.0 -->
# Inférence native — plan propriétaire

Décisions communes : [plan AI](native-integration-master.md).
Inventaire initial : 2026-10-01 ; état courant à qualifier par lot.
Aucune parité live Ollama/vLLM/mistral.rs déduite des sources.

## Owners et frontières

| Capacité | Owner et contrat |
| --- | --- |
| Providers/streaming | `aphrody-model-client`, `ModelClient`/`ModelStreamEvent` ; identités dans `providers` |
| Tour agent | `engine`/`agent-runtime` |
| Weights/catalog/GPU/stores | `models`, stores protégés |
| GGUF/mtmd/LoRA/grammar | `koharu-llama`/`koharu-llama-sys` |
| Safetensors/vision/paged attention | `engine-mistralrs`, feature `engine` off par défaut |
| ONNX | `infer`, fallback execution provider |
| Façade API locale | `gateway` sur les owners `ModelClient` |
| Retry/cache/cost | `llm-infra` |
| Antigravity | Client `antigravity` + adapter `model-antigravity` |
| Gemini CLI | Adaptateur produit externe ; distinct du moteur local |

Ne pas supprimer la façade serveur gateway en fusionnant son client avec
model-client. Migrer chat/ai avant retrait de router. Les enveloppes Jev et les
clients OCR ne constituent pas une seconde façade OpenAI identique.

## Queue et gates

| Ordre | Travail | Preuve requise |
| --- | --- | --- |
| 1 | Qualifier NVML et lecteur Ollama dans `models` | Tests, absence driver → CPU, host gating, wasm préservé |
| 2 | Résoudre un tag Ollama en GGUF installé | Store read-only, `OLLAMA_MODELS`, manifests/blobs, refus `..` |
| 3 | `InProcessLlama` sur koharu-llama | `ModelClient`, streaming/cancellation ; migration agent-runtime/Jev/app-server/CLI puis retrait daemon/supervisor/caps |
| 4 | Qualifier engine-mistralrs | Linux puis Windows CPU/GPU selon feature ; engine absent de wasm/default CLI |
| 5 | Unifier façade API et consommateurs | Parité gateway/routes ; chat/ai sur model-client ; retrait des doublons qualifiés |
| 6 | Migrer OCR VLM vers mtmd | Même contrat OCR sans CLI par page |

Endpoints utilisateur externes restent des backends sélectionnés, pas un
fallback local implicite. Ollama/vLLM : HTTP en processus, aucun import Python
ni lancement de leurs binaries. `infer/src/llama.rs` discovery reste utile aux
consommateurs CLI/bench jusqu'à migration.

## Sous-ensemble rapporté le 2026-10-01

`models/src/accel.rs` utilise NVML ; parser public `parse_nvidia_smi` conservé.
`models/src/ollama.rs` décrit `OllamaName::parse`, `OllamaStore::{discover,at,resolve,list}`
et `OllamaModel::{gguf_path,layer,read_text}`. Stockage :
`registry.ollama.ai/library:latest`, `blobs/sha256-<hex>`,
`application/vnd.ollama.image.model`. Qualifier contre le pin choisi.

## Dépendances et risques

Les versions/pins sont uniquement dans Cargo manifests/lockfile ; le
[plan AI](native-integration-master.md) fixe la sélection.
Forwarder CUDA/Metal/etc. via features, jamais par défaut. Candle/tokenizers
peuvent exister en plusieurs versions ; aucun type partagé sans qualification.
NVML charge `libnvidia-ml` dynamiquement ; WSL : `/usr/lib/wsl/lib`.
Aucun poids ni secret déplacé par la migration.

Checks/tests/Clippy ciblés via le wrapper sérialisé et la fabrique propriétaire.
Présence des APIs et lecture des manifests ne valent pas test d'exécution.
