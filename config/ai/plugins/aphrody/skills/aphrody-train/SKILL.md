---
name: aphrody-train
description: "aphrody training pipeline: triple datasets, embedding/reranker fine-tuning, LoRA adapters, autonomous promotion."
version: "1.0.0"
metadata:
  source: aphrody native — crates/aphrody-train & py/aphrody-train
  since: "2026-09-19"
---

# aphrody — Surface d'Entraînement (`train`)

Aphrody intègre un pipeline complet d'adaptation locale piloté par un superviseur Rust (`aphrody-train`) et des sous-processus Python isolés (`py/aphrody-train`).

## Pipeline d'Entraînement

1. **Génération de Triplets (`aphrody train dataset triples`)** :
   - Extrait les chunks du repository et synthétise des requêtes et négatifs difficiles via un LLM local.
   - Enforce le **gold-leak guard** : tout passage appartenant au jeu d'évaluation de référence est banni et journalisé.
2. **Entraînement d'Embeddings (`aphrody train embed`)** :
   - Fine-tuning de sentence-transformers (perte Cached MNRL + Matryoshka) pour aligner les représentations sémantiques.
   - Export automatique vers ONNX avec quantification FP16/INT8.
3. **Entraînement de Cross-Encoders (`aphrody train rerank`)** :
   - Fine-tuning d'un modèle de reranking haute précision.
   - Export automatique vers ONNX.
4. **Adaptation d'Agents LoRA (`aphrody train lora`)** :
   - QLoRA sur Qwen2.5-Coder à partir des trajectoires de sessions et des paires DPO.
   - Conversion en GGUF pour rechargement à chaud sur `llama-server`.
5. **Porte de Promotion Autonome (`aphrody train promote`)** :
   - Validation stricte sans humain dans la boucle : requiert un gain de performance ($\Delta\text{Recall@5} \ge +0.01$) et une régression par tag maximale $\le 0.03$.
   - Mise à jour atomique de la configuration active si validé.

## Sécurité Matérielle (VRAM & GPU Lease)

- L'entraînement requiert l'acquisition préalable d'un bail GPU exclusif (`GpuLease`).
- Les daemons d'inférence partagés (`llama-server`) sont temporairement suspendus ou vidés de la VRAM le temps de l'exécution, évitant tout Out-Of-Memory.
