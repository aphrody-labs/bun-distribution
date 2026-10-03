# Shenron en local sur GPU NVIDIA (CUDA)

Faire tourner les **services ML de Shenron sur un GPU NVIDIA** au lieu du CPU du VPS. Trois charges
d'inférence sont concernées : **LLM conversationnel**, **RAG** (embeddings + reranker), **OCR manga**.
Sur le VPS elles tournent toutes en CPU ; sur une machine GPU on les sert sur CUDA — réponses quasi
instantanées et OCR du batch de planches en minutes au lieu d'heures.

> Référence croisée : [`rag-enrichment.md`](../../architecture/shenron/rag-enrichment.md)
> (pipeline RAG hybride), [`ocr-manga.md`](../../guides/shenron/ocr-manga.md) (transcription manga).

## Machine de référence

- **GPU** : NVIDIA GeForce RTX 4070, **12 Go VRAM** (Ada Lovelace, `sm_89`).
- **Driver / CUDA** : driver 610.x, **CUDA 13.3** (`nvcc` 13.3). WSL2 (le driver vient de Windows ;
  `nvidia-smi` doit répondre **dans** le shell WSL).
- **Toolchain** : `bun`, `cmake`, `gcc 15.2`, et **`uv`** pour les venvs Python.
- **Python** : le système est en 3.14 (trop récent pour torch/paddle) → on crée des venvs **Python 3.12**
  via `uv` (`uv python install 3.12`). Les wheels CUDA récentes (torch `cu130`, paddle `cu126`) tournent
  sans souci : le driver 13.3 est rétro-compatible avec un runtime CUDA plus ancien embarqué dans la wheel.

## Vue d'ensemble — 3 services sur GPU

| Service                         | Port           | Backend GPU                                                         | Code                                |
| ------------------------------- | -------------- | ------------------------------------------------------------------- | ----------------------------------- |
| **LLM conversationnel**         | 11434 (Ollama) | **Ollama + `gemma4:12b`** sur CUDA (`think:false`)                  | `src/lib/llm.ts` (backend `ollama`) |
| **Embeddings + reranker (RAG)** | 5007           | sidecar Python `sentence-transformers` CUDA (drop-in du sidecar TS) | `embed-server-gpu.py`               |
| **OCR manga**                   | —              | `paddlepaddle-gpu` + `device="gpu"`                                 | `scripts/transcribe-manga.py` (not in repo)       |
| _LLM alt. (secondaire)_         | 5008           | llama.cpp `-DGGML_CUDA=ON` + `-ngl 99`, Qwen2.5-3B GGUF             | —                                   |

**Budget VRAM (12 Go, ~10 Go libres hors desktop)** — les trois ne tiennent pas tous à fond en même temps :

- `gemma4:12b` ≈ **8,4 Go** (ctx 8192), sidecar embeddings+reranker ≈ **1,5 Go**, OCR Paddle ≈ **2 Go**.
- LLM + embeddings cohabitent (~9,9 Go). L'**OCR est un batch** : le lancer pendant que Gemma occupe 8,4 Go
  pousse au-delà de 12 Go → faire tourner l'OCR quand le LLM est déchargé (cf. `keep_alive`, ci-dessous),
  ou accepter qu'Ollama offload une partie des couches sur le CPU.

---

## 1. LLM conversationnel — Ollama + Gemma 4 (GPU)

Le chemin retenu sur cette machine. **Gemma 4 12B** (servi par Ollama) remplace le Qwen2.5-3B du VPS :
modèle nettement plus capable, chargé **100 % GPU** par Ollama, zéro API externe.

### Intégration (`src/lib/llm.ts`)

`generateLlmAnswer` sait parler à plusieurs backends via `LLM_BACKEND`. On a ajouté un backend **`ollama`**
qui tape l'**API native `/api/chat`** (et non l'endpoint OpenAI `/v1`) :

```
LLM_BACKEND=ollama  → callOllama() → POST http://127.0.0.1:11434/api/chat
                      { model, messages, think:false, stream:false, keep_alive, options }
                      → lit message.content
```

La voie historique (`LLM_BACKEND=local` → endpoint OpenAI `:5008`, pour llama.cpp/Qwen) reste **inchangée**.

### Piège critique : modèles à raisonnement

`gemma4:12b` **réfléchit** : il met sa chaîne de pensée dans `message.thinking` et laisse `message.content`
**vide** tant qu'il n'a pas fini — s'il atteint la limite de tokens avant (`finish_reason:"length"`),
`content` reste vide et Shenron retombe sur sa réponse de repli persona.

- **Fix** : `think:false` (cf. [doc Ollama `/api/chat`](https://github.com/ollama/ollama/blob/main/docs/api.md)).
- **Important** : l'endpoint **OpenAI-compatible `/v1/chat/completions` d'Ollama IGNORE `think`** → il faut
  l'**API native `/api/chat`**. C'est la raison du backend dédié.

### Best practices Ollama appliquées

| Paramètre                                                                                  | Valeur                       | Raison                                                               |
| ------------------------------------------------------------------------------------------ | ---------------------------- | -------------------------------------------------------------------- |
| `think`                                                                                    | `false`                      | coupe le CoT des modèles reasoning (sinon `content` vide).           |
| `options.num_ctx`                                                                          | **8192** (`LLM_NUM_CTX`)     | le défaut modèle (4096) tronque système + faits RAG + historique.    |
| `keep_alive`                                                                               | **`30m`** (`LLM_KEEP_ALIVE`) | résidence VRAM bornée — laisse la place aux sidecars embeddings/OCR. |
| `-1` (résident à vie) pinnerait 8,4 Go en permanence. `0` déchargerait après chaque appel. |
| `options.num_predict`                                                                      | 320 (`LLM_NUM_PREDICT`)      | budget de génération aligné au comportement existant.                |

**Serveur Ollama** (env systemd, déjà en place sur cette machine) :
`OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KEEP_ALIVE=30m`, `OLLAMA_MAX_LOADED_MODELS=2`.
`OLLAMA_NUM_PARALLEL` est laissé à **1** : sur 12 Go partagés, chaque slot parallèle ajoute un KV-cache
(ctx 8192) et ferait sauter le budget VRAM. À monter seulement si la VRAM le permet.

### Configuration (`apps/rg/bot/.env`)

```
LLM_BACKEND=ollama
LLM_MODEL=gemma4:12b
LLM_NUM_CTX=8192
LLM_KEEP_ALIVE=30m
```

> `.env` est gitignored — l'écrire avec `printf` (jamais `echo`). Bun auto-charge `apps/rg/bot/.env` quand on
> lance depuis `apps/shenron/bot`, donc ces clés s'appliquent au bot et aux scripts.

### Vérification

```bash
# Le modèle tourne-t-il sur GPU ?
ollama ps                         # PROCESSOR doit afficher "100% GPU", CONTEXT 8192
nvidia-smi                        # gemma4:12b résident en VRAM

# Réponse en voix de persona via le pipeline Shenron (depuis apps/bot, .env auto-chargé) :
curl -s http://127.0.0.1:11434/api/chat -d '{"model":"gemma4:12b",
  "messages":[{"role":"user","content":"Qui est Vegeta ? Une phrase."}],
  "think":false,"stream":false,"options":{"num_ctx":8192}}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['message']['content'])"
```

---

## 2. RAG — contrat du service E5

Le bot et les scripts de pipeline utilisent `ShenronEmbeddingsClient` de
`@shenron/pipeline/aphrody`. Il appelle l'API loopback compatible OpenAI
`POST /v1/embeddings` (adresse `APHRODY_AI_EMBED_BASE_URL`, sans défaut, voir
[`ENV.md`](ENV.md)), avec le modèle
`Xenova/multilingual-e5-small`, dimension 384, mean pooling et normalisation L2.
Le client ajoute `query: ` ou `passage: ` et limite les lots à 16 entrées. Les
vecteurs de requête et d'index doivent provenir du même modèle et du même espace.

Ce dépôt ne contient plus `embed-server.ts` ni `embed-server-gpu.py`. L'ancien
protocole `/embed` et `/rerank` décrit dans cette section a été retiré : une
ancienne expérience GPU sur le port 5007 n'est plus compatible. Un backend GPU
alternatif doit implémenter l'API `/v1/embeddings` avec le même modèle avant
d'être sélectionné via `APHRODY_AI_EMBED_BASE_URL` (alias hérités : `APHRODY_SHENRON_EMBED_BASE_URL`,
`EMBED_URL`). Un modèle ou une dimension différents de l'index sont refusés.

Le reranking est facultatif et désactivé sans `APHRODY_AI_RERANK_BASE_URL` (ou l'alias
`RERANK_URL`, dialecte du sidecar). Sans vecteurs E5
prêts, la recherche se replie sur BM25; le dépôt ne précharge pas les poids et
ne peut pas prouver la disponibilité du modèle à l'exécution.

---

## 3. OCR manga sur GPU (PaddleOCR)

`scripts/transcribe-manga.py` (not in repo) a été rendu portable + pilotable par env, et **corrigé d'un bug de
recognizer** (le vrai gain de qualité — cf. ci-dessous) :

- **Chemin dynamique** : `ROOT` est résolu via `__file__` (plus de `~/...` codé en dur) →
  tourne sur le VPS comme en local.
- **Device** : `OCR_DEVICE` (`"cpu"` par défaut, `"gpu"` pour CUDA). PaddleOCR 3.x/PaddleX attend
  `device="gpu"` (et **non** l'ancien `use_gpu=True`). Le fallback CPU est strictement identique à avant
  (`enable_mkldnn=False`, `cpu_threads`).
- **Recognizer FR (`OCR_LANG`, défaut `fr`)** : le script forçait `text_recognition_model_name=
"PP-OCRv5_mobile_rec"`, qui est le recognizer **CN/EN** — appliqué à du **français**, il détruisait
  accents et apostrophes (`SÛR→SUR`, `MÊME→MEME`, `N'OSERIEZ→NOSERIEZ`, `QU'EST-CE→QUEST-CE`).
  `lang="fr"` charge le recognizer **latin** (en pratique `PP-OCRv6_medium_rec`) qui restitue
  `é è ê û ç` et les apostrophes. **A/B validé sur planche réelle** — c'est l'essentiel de la montée
  en qualité, à coût quasi nul.
- **Détecteur (`OCR_DET`)** : `PP-OCRv5_server_det` **par défaut sur GPU** (bulles mieux resserrées),
  `PP-OCRv5_mobile_det` sur CPU (ne pas alourdir le batch throttlé du VPS). Surchargeable par env.

### Venv + lancement

```bash
uv venv ~/.ocr-gpu --python 3.12
uv pip install --python ~/.ocr-gpu paddlepaddle-gpu -i https://www.paddlepaddle.org.cn/packages/stable/cu126/
uv pip install --python ~/.ocr-gpu paddleocr      # 3.7.0
~/.ocr-gpu/bin/python -c "import paddle; print(paddle.device.is_compiled_with_cuda())"   # True

cd apps/bot
OCR_DEVICE=gpu ~/.ocr-gpu/bin/python scripts/transcribe-manga.py \
  "assets/manga/DB/regular/vol*" "assets/manga/DBS/ch*" --workers 1
# server_det + rec FR sur GPU ; ~4.7 Go VRAM avec le sidecar (=> Gemma decharge pour l'OCR).
# Idempotent (saute les tomes deja transcrits). 1 worker : le batch GPU fait le parallelisme.
```

### Plus puissant ? (scout 8 OCR GPU)

Un scout comparatif (Surya, dots.ocr, PaddleOCR-VL, Qwen3-VL, GOT-OCR2, olmOCR, MinerU, DeepSeek-OCR)
a conclu que, pour des **scans manga FR sur 12 Go de VRAM partagés**, le meilleur rapport est de **rester
sur PaddleOCR** (déterministe, ~1-2 Go, zéro hallucination, garde `reading_order()`), une fois le rec FR
corrigé. Les VLM (Qwen3-VL, dots, DeepSeek…) sont plus robustes sur le **lettrage stylisé/SFX** mais :
hallucinent/bouclent sur les pages denses et les `...`, n'ont **pas** d'ordre de lecture manga natif, et
exigent **Gemma déchargé** (OOM sinon). À réserver à un **2ᵉ passage** ciblé.

> **Runner-up** : **Qwen3-VL via Ollama** (`ollama pull qwen3-vl:8b`, déjà servi sur GPU) en **recognizer
> sur les crops de bulles à faible confiance** uniquement — on garde les boîtes + l'ordre de PaddleOCR, le
> VLM ne fait que ré-OCR le crop (temperature 0, `num_predict` borné, dé-dup anti-répétition). Jamais en
> transcription pleine page.

---

## 4. LLM alternatif — llama.cpp CUDA (secondaire)

Conservé pour rester aligné au VPS (endpoint OpenAI `:5008`, modèle Qwen). Gemma 4 via Ollama étant plus
capable, c'est une **option de repli**, pas le défaut sur cette machine.

```bash
git clone --depth 1 https://github.com/ggml-org/llama.cpp ~/llama.cpp
cmake -B ~/llama.cpp/build -S ~/llama.cpp -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
cmake --build ~/llama.cpp/build --target llama-server -j$(nproc)     # auto-détecte sm_89 (RTX 4070)

LD_LIBRARY_PATH=~/llama.cpp/build/bin ~/llama.cpp/build/bin/llama-server \
  -m apps/bot/.models/qwen2.5-3b-instruct-q4_k_m.gguf \
  --host 127.0.0.1 --port 5008 -c 8192 -ngl 99 --no-webui
```

`-ngl 99` offloade toutes les couches sur le GPU ; le log doit afficher `offloaded N/N layers to GPU`.
Pour basculer Shenron dessus : `LLM_BACKEND=local` (défaut) + `LOCAL_LLM_URL` sur `:5008`.

---

## 5. Fine-tune Gemma 4 12B sur le manga (QLoRA, Unsloth)

Adaptation du LLM au **style manga DBZ** via QLoRA continued-pretrain sur les transcriptions OCR.

- **Stack** : `uv pip install unsloth --torch-backend=auto` (Unsloth 2026.6.8 + bitsandbytes CUDA 13 +
  **transformers ≥ 5.12** — requis pour l'archi `gemma4_unified`, sinon `KeyError`). Modèle base
  fine-tunable : `unsloth/gemma-4-12b-it` (safetensors BF16, gated:False).
- **Contrainte RAM (piège vécu)** : le 12B est **un seul safetensors de 23,9 Go** → `mmap` échoue
  (`Cannot allocate memory`) sous 15 Go de RAM. Fix : WSL `.wslconfig` → `memory=24GB swap=16GB` +
  `sysctl vm.overcommit_memory=1` (non persistant, à re-poser après reboot). VRAM training ≈ 9,8 Go
  (4-bit + LoRA + activations), tient sur la 4070.
- **Données** : `data/llm/prepare_manga_data.py` (not in repo) produit `manga_pretrain.jsonl` depuis les transcripts
  bruts avec un **nettoyage TRAINING agressif** (drop watermarks scanlation `SCANTRAD.NET`/`BLEACH-MX`,
  timestamps, dates, n° de page, crédits, garbage OCR). **Critique** : sans ce filtre, le modèle apprend
  à cracher les watermarks (overfit constaté sur v1). Limite résiduelle : l'OCR en ordre de lecture
  entrelace les bulles → prose un peu brouillée (plafond de qualité du continued-pretrain sur cette donnée).
- **Training** : `data/llm/finetune_manga.py` (not in repo) (`FastModel`, `load_in_4bit=True`, r=8, `max_seq=512`,
  1 epoch, LR 1e-4, gradient-checkpointing Unsloth). ~2 h sur la 4070.
- **Servir sans merger les 23,9 Go** : `convert_lora_to_gguf.py` (llama.cpp, supporte gemma4) → adapter
  GGUF 131 Mo → Modelfile `FROM gemma4:12b` + `ADAPTER` → `ollama create gemma4-manga`.
- **Honnêteté** : le fine-tune apporte la **voix/style** manga mais aussi du **bruit factuel** (OCR). En
  prod, garder la base `gemma4:12b` pour les faits (via le RAG focus manga). Ne PAS activer `gemma4-manga`
  par défaut tant que le bruit n'est pas maîtrisé. `data/llm/test_lora.py` (not in repo) pour juger une itération.

### Branche encyclopédique `gemma4-db-full` (faits) — bilan : ne pas câbler

Variante du même pipeline visant les **faits** (pas le style) : continued-pretrain QLoRA de
`unsloth/gemma-4-12b-it` sur `data/llm/db_full_pretrain.jsonl` (not in repo) (~50 Mo = dump complet de la connaissance
DB de l'époque, corpus depuis purgé de Fandom), `r=16`, `max_seq=768`, 1 epoch, LR 5e-5. `data/llm/finalize-v3.sh` (not in repo)
automatise LoRA → adapter GGUF → `ollama create gemma4-db-full` → test connaissances.

- **Résilience (obligatoire pour les runs longs)** : `data/llm/train-supervised.sh` (not in repo) relance
  `finetune_manga.py` après crash et **reprend au dernier checkpoint** (`save_strategy="steps"`,
  `save_steps=500`, `resume_from_checkpoint`). Un run lancé sans cette version **ne checkpointe pas →
  crash = perte totale** (piège vécu : 15,5 h sans filet). Run de référence : 1 epoch ≈ **5861 steps,
  18 h 38** sur la 4070 (rythme 6–30 s/it, se dégrade en fin de dataset sur les séquences longues).
- **Résultat (éval 2026-06-24)** : le fine-tune **DÉGRADE la factualité**. Éval comparée, 6 questions FR :
  `gemma4-db-full` ≈ **2/6 (33 %)** vs base `gemma4:12b` ≈ **4,5/6 (75 %)** — hallucinations en hausse
  (« Tsururin » à l'ép. 1, « Super Saiyan Rage » contre Jiren, mauvaise dernière saga de Super) et
  réponses plus verbeuses. Un continued-pretrain sur dump brut apprend le **style/bruit**, pas les **faits**.
- **Conclusion** : **NE PAS activer `gemma4-db-full` en prod** ; garder la base + RAG (les faits passent
  par le RAG). Pour un vrai modèle « faits », viser un **instruction-tune sur paires Q&A propres**
  (générées depuis le wiki + RAG), pas un continued-pretrain.

---

## Récap des changements de code

- `src/lib/llm.ts` — backend **`ollama`** (`callOllama`, API native `/api/chat`, `think:false`), options
  best-practice configurables (`LLM_MODEL`, `LLM_NUM_CTX`, `LLM_KEEP_ALIVE`, `LLM_NUM_PREDICT`, `OLLAMA_URL`).
  Voie OpenAI/`local` préservée.
- `@shenron/pipeline/aphrody` — client embeddings E5 loopback compatible OpenAI (`ShenronEmbeddingsClient`, adresse `APHRODY_AI_EMBED_BASE_URL`).
- `scripts/transcribe-manga.py` (not in repo) — `ROOT` dynamique + `OCR_DEVICE` (GPU/CPU), fallback CPU inchangé.

Aucun secret commité ; `.env`, `.models/`, venvs (`~/.rag-gpu`, `~/.ocr-gpu`) restent hors Git.
