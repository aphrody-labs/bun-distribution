<!-- SPDX-License-Identifier: Apache-2.0 -->
# RAG natif — plan propriétaire

Décisions communes : [plan AI](native-integration-master.md).
Portée : `rag*`, `embed`, `memory`, `context`, `summary`, `train`, `ocr*`.
Inventaire initial : 2026-10-01. LlamaIndex (MIT) fournit les concepts, sans copie.
Préserver API/CLI/schémas et format des indexes.

## Owners

| Capacité | Owner |
| --- | --- |
| Chunking, fusion, MMR, dedup, quantification, top-k, métriques | `rag-core` |
| Corpus FTS5/vecteurs, indexer et recherche | `rag` |
| Embedding/reranking | `embed`, adapters `rag::Embedder/Reranker` |
| Faits agent | `memory` ; modèle distinct du corpus, ne pas fusionner les stores |
| Budget tokens | `context` |
| Gold sets et retrieval eval | `rag-eval` |
| Bridge Python → Rust | `rag-python`, leaf cdylib sur rag-core |
| Synthèse de réponse/tours | `agent-runtime`, hors duplication RAG |

Readers OCR/PDF sont chez `ocr*`. Embeddings natifs/BERT et reranker
cross-encoder sont sélectionnés par feature `native` ; ORT reste optionnel pour
exports ONNX utilisateur. Backends HTTP restent sélectionnables ; Qwen3-reranker
ne devient pas compatible BERT par simple substitution.

## Sous-ensemble rapporté

W0 : adapters NativeEmbedder/NativeReranker, `Arc<Engine>` partagé ;
recherche vectorielle en deux passes, bounded top-k puis hydration des gagnants ;
insert_vectors dans une transaction avec statement préparé.
Les bytes stockés restent identiques. Ordre des ties, feature native et tests
rag_store doivent être qualifiés ; les marqueurs source ne prouvent pas un gain.

## Queue unique

| Travail | Contrat/gate |
| --- | --- |
| W1 : config et construction CLI/MCP | EmbedBackend::Native et rerank ; index lié à un seul embed_model_id `native:<repo>@<rev>` |
| W2 : erreurs embedding visibles | IndexStats expose échecs ; aucun doc marqué indexé sans ses vecteurs |
| W3 : concurrence index/recherche | Writer unique, read connections, spawn_blocking ; overlap chunk/embed/write borné |
| W4 : snapshots et int8 | Snapshot invalidé sur write, colonne quant i8, kernels existants ; HNSW selon mesures |
| W5 : tokens en processus | Encoding qualifié ; retirer GoTokenEstimator/lookup après migration |
| W6 : kernels mémoire | Réutiliser rag-core pour cosine/norm ; embed reste leaf indépendant |
| W7 : retrieval | G3 voisins, G7 MMR option, G8 cutoff, G6 fusion relative, G5 cache chunk-hash additif |
| W8 : embeddings mistral.rs | G4 via API inférence stable ; déprécier HTTP local seulement après parité |
| W9 : query transforms/eval génération | G9 HyDE/multi-query/decomposition ; G10 faithfulness, sur API inférence |

G1 metadata générique et G2 readers OCR/PDF restent des écarts à décider avec
leurs owners. Knowledge graph et SPLADE ne sont pas prévus ; FTS5 est la branche
sparse actuelle. Chunkers, RRF, embeddings instructions et retrieval eval gardent
leur propriétaire unique.

## Contraintes

Une migration de backend impose nouvel index ou re-embedding explicite :
ne jamais mélanger les espaces vectoriels. Préserver corpus PostgreSQL/Redis,
modèles et mémoire agent. Exact scan reste O(Nd) ; aucun seuil de performance
universel ni accélération chiffrée sans workload.

Python training cold path et bridge PyO3 restent distincts de la requête RAG.
Worker stdio embedding : retirer seulement après migration de ses consommateurs.
OCR VLM relève de l'inférence. Aucune fusion de stores protégés.

Versions/features uniquement dans les manifests. Activer rag/native aux
consommateurs sélectionnés ; qualifier default-members PyO3 et encoding tokens
avant changement. Pas nouvelle dépendance sur simple suggestion du plan.

Gates : store/index ordering, erreurs et model-lock, cache/fusion et concurrency ;
Rust check/test/Clippy scoped via wrapper sérialisé ; comportement native et
backends sélectionnés réellement exécutés. Preuve initiale dans le plan AI,
pas qualification complète de cette queue.
