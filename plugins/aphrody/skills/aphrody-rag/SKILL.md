---
name: aphrody-rag
description: "aphrody RAG engine: index, hybrid search, context, status, eval, serve over a codebase or corpus."
version: "1.0.0"
metadata:
  source: aphrody native — crates/ai/rag
  since: "2026-09-19"
---

# aphrody — Moteur RAG & Recherche Hybride

Le moteur RAG d'Aphrody combine la recherche lexicale SQLite FTS5 (`unicode61`), le scan vectoriel dense BLOB multithreadé, la fusion RRF ($k=60$) et le reclassement par cross-encoder (BGE-Reranker).

## Commandes RAG

- **`aphrody rag index <path>`** — Analyse, découpe (chunkers AST Rust/TS/Markdown) et indexe les fichiers modifiés dans la base SQLite locale.
  - Détection incrémentale via hash Blake3 et écoute des changements.
- **`aphrody rag search "<query>"`** — Recherche des passages pertinents.
  - `--mode <hybrid+rerank|hybrid|lexical>` : Sélectionne le mode de retrieval.
  - `--top-k <N>` : Nombre de candidats initiaux (défaut: 20).
  - `--rerank-top-n <N>` : Nombre final après reranking (défaut: 5).
  - `--json` : Formatage structuré en JSON pour scripts ou intégration agent.
- **`aphrody rag context "<query>"`** — Génère un bloc de contexte markdown prêt à injecter dans le prompt système du modèle.
- **`aphrody rag status`** — Affiche les statistiques de l'index : nombre de documents, chunks, dimensions vectorielles et modèle d'embedding utilisé.
- **`aphrody rag eval --gold-path <path>`** — Exécute la suite de benchmark contre le fichier gold de référence (métriques Recall@1/3/5/10, MRR, p50/p95).
  - `--gate "<metric>>=<threshold>"` : Échoue avec exit code 3 si le seuil n'est pas atteint (ex: `--gate "recall@5>=0.85"`).
- **`aphrody rag serve [--port 8085]`** — Lance le serveur HTTP de recherche compatible avec l'API publique Shenron.
