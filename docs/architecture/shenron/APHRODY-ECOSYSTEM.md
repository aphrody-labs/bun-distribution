> **Snapshot de code du 2026-09-28, pas un état runtime courant.** Les noms de paquets et chemins de dépôts frères décrivent la structure de l'époque. Le code actuel est dans `apps/shenron/` et `packages/shenron/` pour Shenron, `crates/ai/` pour les capacités Aphrody, et les catalogues Infra vivent sous `config/`. Pour l'état de production, voir les observations datées dans `docs/operations/infra/`.

# Écosystème Aphrody pour Shenron

## Frontière Discord partagée

Le transport Discord partagé est maintenu dans `aphrody-discord` et son
déploiement dans Infra du monorepo. Shenron ne conserve que ses commandes, son
domaine, son autorisation et ses données. La migration détaillée est dans
[`APHRODY-DISCORD-INTEGRATION.md`](APHRODY-DISCORD-INTEGRATION.md).

État du code de raccordement vérifié le 2026-09-26 dans des dépôts séparés à
l'époque. Les chemins `aphrody-ai/crates/aphrody-mcp` ci-dessous sont désormais
historiques : le code MCP actuel est sous `crates/ai/mcp/` (`dragonball.*`).
Cette carte décrit les limites de l'intégration, pas un inventaire courant des
paquets ni un état de release. L'état production est documenté séparément dans
les observations datées d'Infra.

Le plan d'exécution des vérifications et travaux restants est dans
[`APHRODY-REMAINING-WORK.md`](../../plans/shenron/APHRODY-REMAINING-WORK.md).

## Capacités à raccorder

| Besoin Shenron | Capacité Aphrody existante | Frontière et limites |
| --- | --- | --- |
| Recherche factuelle Dragon Ball pour agents | MCP unifié `aphrody-mcp`, outils `dragonball.rag_search`, `rag_context`, `rag_ask`, `sources`, `data_coverage`, `wiki_*`, `manga_*`, `databooks_*`, `canon_*`, `chronologie`, `bot_*`, `news` | MCP local stdio ; noms complets et schémas via `tools/list`. Les API Shenron fournissent les données éditoriales. `rag_ask` dépend en plus du LLM. |
| Recherche/rédaction RAG dans le bot et le site | `@shenron/pipeline/ai` → API privée `aphrody-ai-http` (`/api/v1/shenron/rag/*`, `/llm/chat`) ; recherche dans `aphrody_rag_documents`, vecteurs E5 facultatifs | Frontière HTTP authentifiée, URL/token fournis par infra. RAG et réponses Aphrody sont des capacités de calcul/index, pas la source éditoriale ni un juge canonique. Lire le `mode` réellement renvoyé. |
| Embeddings du RAG | `aphrody-embed` / endpoint `/v1/embeddings`, modèle `Xenova/multilingual-e5-small`, 384 dimensions, préfixes E5 query/passage | Shenron vérifie `never-mix-spaces` à l'initialisation et avant écriture. Un changement de modèle/dimension nécessite une réindexation. |
| OCR et revue visuelle d'images | CLI locale `aphrody ocr shenron` et `aphrody ocr dbfr`; endpoints AI privés `/ocr` et `/vision/structured`; modèles PP-OCRv5, dots-ocr et VLM selon la tâche | CLI construite avec feature `ocr` et modèles installés localement. Sous-commandes vérifiées : `doctor`, `emit`, `verify`, `deposit`, `pipeline`. Les étapes `verify`/`deposit` appellent les scripts Shenron ; l'API MCP `admin_databooks_deposit` ne remplace pas automatiquement ce juge OCR métier. |
| Traduction japonais → français | crate `aphrody-translate` et CLI `aphrody translate` ; chaîne Shenron réutilise lexique/juges côté Shenron | Traitement local par CLI, pas une route de chat distante. Aphrody produit une proposition ; les juges et l'écriture PostgreSQL restent Shenron. |
| Crawl et collecte web | API `aphrody-web-api` / BXC, commandes `aphrody web` et ses outils MCP | Crawl générique et index BXC. Les extracteurs métier, provenance, validation canonique et dépôt éditorial restent dans Shenron. Vérifier le contrat HTTP live avant de basculer un collecteur. |
| Délégation d'agents sur les tâches Shenron | Outils `dragonball.a2a_*` vers le hub A2A du site ; Aphrody fournit aussi son client/serveur A2A | Une tâche `submitted/working` n'est pas un résultat. Attendre un artefact du pair avant FAIT. Pas de double hub local ni de statut supposé. |
| Administration éditoriale contrôlée | `dragonball.admin_databooks_deposit`, `admin_bot_commands`, `admin_bot_command_execute`, `admin_services`, `admin_service_action` | Secrets API d'hôte `SHENRON_DATABOOKS_API_TOKEN` ou `SHENRON_API_ADMIN_TOKEN`. Aucun secret dans le plugin. Le dépôt MCP est un merge ciblé ; vérifier la révision côté site. Pas d'outils `admin_aphrody_doctor`/`admin_aphrody_git`. |

Le plugin Dragon Ball configure désormais `aphrody-mcp` local en stdio. Le
serveur public séparé `mcp.dragonballfr.com`, son OAuth et l'application
`apps/shenron-mcp` (not in repo) ont été retirés ; ne pas créer une seconde unité ni rétablir
leurs URLs. L'inventaire généré `../ecosystem/MCP-TOOLS.md`
et `tools/list` du binaire construit sont les sources des noms et schémas.

Configuration requise par les appels runtime : Shenron lit le contrat IA
canonique `APHRODY_AI_HTTP_URL` et `APHRODY_AI_HTTP_TOKEN` (aliases historiques
acceptés ; détails dans [`ENV.md`](../../operations/shenron/ENV.md)). Ces appels sont distincts de la
connexion MCP du plugin, qui ne transporte pas les secrets du service.

## Capacités que Shenron garde

- PostgreSQL Shenron comme source éditoriale, règles de suppression logique,
  révisions `wiki_revisions` et modération canon/databooks.
- Verdict canonique déterministe depuis `CanonConfig` et `canon_references` ;
  le RAG Aphrody retrouve des preuves mais ne tranche pas le canon.
- Lexique japonais, contrôle humain/automatique des transcriptions et juges OCR.
- Commandes de collecte spécialisées, schémas des fiches et publication sur le
  site. Le crawl et les modèles Aphrody ne publient pas directement ces données.

## Parcours databooks supporté

1. Aphrody lit les planches et écrit des résultats OCR locaux reprenables.
2. `aphrody ocr shenron verify <lot>` fait vérifier le lot par le script de
   Shenron ; les pages douteuses sont rejetées ou retenues pour revue.
3. Après revue de `verify`, `aphrody ocr shenron deposit <id> --apply` est la
   voie de dépôt intégrée. `pipeline --apply` orchestre tout le flux. La CLI
   `aphrody ocr dbfr push` suit un autre parcours API et ne doit pas contourner
   le juge éditorial Shenron.
4. Contrôler les révisions et l'état des pages côté Shenron ; relancer l'index
   RAG séparément selon la procédure Shenron. Une transcription non lisible ne
   doit pas effacer une valeur précédente.

La transcription ne suffit pas à déclarer la traduction complète : le compte
rendu Shenron du 2026-09-25 demande de traiter d'abord les 2 528 pages en
quarantaine OCR/source, puis les 2 556 pages traduisibles. Ce travail est
distinct de l'inventaire des capacités Aphrody et n'est pas démarré ici.

Document de référence : ce que Shenron garde en TypeScript, ce qu'il confie à
l'écosystème Rust d'Aphrody, et par quelles frontières passer. Il complète
[`APHRODY-OFFLOAD.md`](../../operations/shenron/APHRODY-OFFLOAD.md), qui décrit l'état du déport et ses
preuves, et [`INFRA-DELEGATION.md`](../../operations/shenron/INFRA-DELEGATION.md), qui fixe la frontière
d'exploitation.

État relevé le 2026-09-24 : `aphrody` HEAD `e0bcd639` (trois commits après
`2109d678` : évaluation RAG HTTP/MCP, entraînement, app-server), Infra du monorepo
HEAD `33d0f9d`, `aphrody-os` HEAD `d9499887` (arbre de travail local). L'état de production cité ici
vient du contrôle du 2026-09-23 consigné dans `APHRODY-OFFLOAD.md`. Seule la
release active sur l'hôte fait foi pour ce qui est réellement servi ; un
commit de ces dépôts ne le prouve pas.

> **Scission du 2026-09-25.** `aphrody` et `aphrody-os` ont été scindés en
> dépôts de catégorie voisins (`../aphrody-<catégorie>`). Les chemins
> `aphrody/…` et `aphrody-os/…` et les numéros de ligne cités plus bas
> désignent les monolithes aux commits relevés ci-dessus. Correspondance :
> `aphrody/crates/*` (dont `aphrody-mcp`, `aphrody-rag*`, `aphrody-ocr*`,
> `aphrody-llama-server`, `aphrody-app-server`, `aphrody-ffi`), `aphrody/apps/shenron-{mcp,embed}`,
> `aphrody/docs/{PLAN.md, RAG.md, training.md, CLI.md}`, `aphrody-os/crates/{aphrody-translate, aphrody-web-embed}` → `aphrody-ai` ;
> `aphrody/crates/aphrody-a2a-*` → `aphrody-contracts` ; `aphrody-os/apps/bxc`,
> `aphrody-os/crates/{aphrody-site, aphrody-obscura, aphrody-web-engine, aphrody-web-ffi, aphrody-web-render}`,
> `aphrody-os/docs/WEB-RUNTIME.md` → `aphrody-web` ; `crates/ui/render`,
> `aphrody-os/packages/{canvas, m3, m3-next}`, `aphrody-os/docs/{PUBLISHING.md, CANVAS-UPSTREAM.md}` → `aphrody-ui` ;
> `crates/ui/bun`, `aphrody-os/packages/bun` → `aphrody-compat` ;
> `crates/os/winclean`, `aphrody-os/packages/os`, `aphrody-ai/plugins/aphrody`
> restent dans `aphrody-os`.

**Convention.** Ce document ne contient ni hôte, ni IP, ni port. Un service
est désigné par son identifiant dans `config/service-catalog.json`
(par exemple `aphrody-ai-http`). Un client le trouve par une variable
d'environnement que provisionne Infra du monorepo. Les hôtes publics sont
déclarés dans `yolo/config/host/nginx/routes.json`.

**Échelle de maturité.**
- *production* : déployé et vérifié par une sonde.
- *utilisable* : code complet et testé, mais pas forcément actif en production.
- *staged* : déclaré au catalogue avec `staged: true`, pas encore actif.
- *expérimental* : fonctionne partiellement, ou dépend d'une session ou d'un modèle absents.
- *planifié* : n'existe pas encore.

---

## 1. Principe

### 1.1 Ce qui reste en TypeScript dans Shenron

- **Le métier éditorial** : wiki, personnages, canon, doctrine des databooks,
  personas, prompts, commandes Discord, orchestration des collecteurs et des
  pipelines.
- **Les données et l'identité** : accès PostgreSQL (`@shenron/db`, Drizzle),
  authentification (`@shenron/auth`), API publique REST/GraphQL/OpenAPI
  (`@shenron/api`), interface (`@shenron/ui`, `components/kit`). À réconcilier
  avec le contrat d'infra : `config/application-contracts.json:12-14`
  déclare Shenron `application-namespace-on-rg-plane`, avec
  `"ui": "reuse-rg-ui-contract"` et `"auth": "reuse-rg-better-auth-boundary"`, et
  `:31-32` pose `rg-ui-is-canonical; shenron-consumes-the-contract` et
  `one-better-auth-boundary-per-public-origin`. `@shenron/ui` et `@shenron/auth`
  doivent donc consommer ce contrat RG, pas en créer un second.
- **Des clients fins vers Aphrody**, qui font seulement cinq choses :
  - valider les entrées et les sorties avec `zod` ;
  - appliquer les délais d'attente et les reprises ;
  - traduire les erreurs ;
  - lire le `mode` renvoyé ;
  - échouer explicitement. Aucun calcul local silencieux ne remplace un service Aphrody en panne (déjà le cas avec `RAG_BACKEND=aphrody`, cf. `APHRODY-OFFLOAD.md`).
- **L'encodage et le redimensionnement simples**, avec des binaires natifs
  *préconstruits* publiés sur npm (Skia via napi-rs, sharp/libvips). C'est
  toléré tant qu'Aphrody n'offre pas de service Rust équivalent (§6).
- **Le rendu dans le navigateur** (`pixi.js`, `modern-gif`), qui ne charge pas
  le serveur.

### 1.2 Ce qui est délégué à Aphrody

Toute opération lourde, c'est-à-dire qui charge un modèle, sollicite le GPU,
demande beaucoup de CPU ou de mémoire, ou exige un binaire natif non
préconstruit :

- inférence LLM, embeddings, reranking, indexation et recherche RAG ;
- OCR, vision, transcription audio, traduction ;
- analyse d'image au pixel (hash perceptuel, PSNR, mesure de trait) ;
- rendu canvas 2D/3D ;
- crawl, scrape, extraction HTML/Markdown ;
- frames vidéo ;
- évaluation et entraînement des modèles de recherche.

### 1.3 Frontières autorisées

| Frontière | Quand l'employer | Exemples actuels |
| --- | --- | --- |
| **HTTP OpenAI-compatible** | Embeddings, et chat dès qu'une surface compatible existera (§6). C'est la cible de `@ai-sdk/openai-compatible` dans `@shenron/pipeline/ai`. | `POST /v1/embeddings` sur `aphrody-shenron-embed` |
| **HTTP REST Aphrody** (Bearer) | Calcul Shenron (RAG, LLM, embed, OCR, vision), rendu, Web | `/api/v1/shenron/*` sur `aphrody-ai-http` ; `/api/v1/canvas/render` sur `aphrody-site` ; `/api/v1/web/*` publié par Nginx directement vers `aphrody-web-api` (§2.2) |
| **MCP** (stdio ou Streamable HTTP) | Agents et outils, pas le chemin chaud du bot | `aphrody-mcp` (`dragonball.*`, `dbfr_*`, `aphrody_*` selon build) |
| **JSON-RPC stdio** | Boucles d'agent, recherche RAG locale | `aphrody app-server` / `aphrody session serve` (`thread/*`, `turn/*`, `aphrody/rag/*`) |
| **CLI `--json`** (`Bun.spawn`) | Scripts et lots hors requête : OCR par lots, doctor, git | `aphrody doctor --json`, `aphrody git inspect`, `aphrody mcp call` ; `aphrody ocr batch|shenron` seulement sur un binaire compilé avec la feature `ocr` (poste windows-local ou WSL : le binaire de production est compilé sans features, `apps/cli/Cargo.toml:21`). `aphrody translate` n'a **pas** de mode JSON (§2.2) |
| **Paquet npm à binaire préconstruit** (napi-rs ou WASM) | Chemin en processus, seulement si le paquet embarque ses binaires pour la production (linux-x64-gnu) et le poste de développement (win32-x64-msvc) | `@napi-rs/canvas` 1.0.9 (§3) |

### 1.4 Interdits

- **Pas de FFI ni de Rust dans `apps/shenron/bot`** (règle 4 de `CLAUDE.md`). Cela
  vaut aussi pour les paquets qu'il importe. Sont donc exclus :
  - `bun:ffi` / `dlopen` sur `aphrody_ffi`, `bun_rs` ou `aphrody_web_ffi` ;
  - `@aphrody/zstd` et `@aphrody/xml2`.

  Violation actuelle : `shenron/packages/pipeline/src/aphrody/index.ts:10,59-72`
  (`AphrodyNativeBridge`). Elle touche le processus du bot, pas seulement
  l'emplacement du code : l'export `bun` de `@shenron/pipeline/aphrody` est ce même
  `src/index.ts` (`packages/shenron/pipeline/package.json`), qui importe `bun:ffi`
  (`:10`) et réexporte `compute`, `shenron-embeddings`, `web` et `a2a`
  (`:307-312`). Tout `import { AphrodyComputeClient } from "@shenron/pipeline/aphrody"`
  du bot (`lib/llm.ts:14`, `lib/rag.ts:22`, `api/server.ts:128`,
  `apps/shenron/bot/src/services/TranslateService.ts:6`…) charge donc le module `bun:ffi` et `a2a.ts`
  dans le bot ; le `dlopen` reste paresseux (`getNativeFfi()`, `:55-72`).
- **Pas de lien vers une bibliothèque compilée localement** : `@aphrody/bun`,
  le pont Rust de BXC. Ils exigent une chaîne Rust sur l'hôte. Violation
  actuelle : `apps/bot/scripts/harvest-kanzenshuu-aphrody.ts:56-67,113` refuse
  de démarrer sans `libbxc_rust_bridge` construit localement
  (`BXC_RUST_BRIDGE_LIB` ou chemins sous le répertoire personnel).
- **Pas d'URL, d'hôte ni de port par défaut dans le code.** Une variable
  absente doit bloquer le démarrage. Les défauts actuels à supprimer sont
  listés en §6.2.
- **Pas de second registre de services.** Tout service consommé par Shenron
  est déclaré dans `config/service-catalog.json`.
- **Pas de Rust dans ce dépôt.** Le code Rust vit dans `aphrody` ou `aphrody-os`.

---

## 2. Carte des capacités Aphrody par dépôt

### 2.1 `aphrody` : IA, RAG, LLM

Le dépôt est un espace de travail Cargo. Le service E5 est maintenant le binaire
Rust `aphrody-embed`; l'ancienne application Bun `apps/shenron-embed` (not in repo) est
supprimée. Le serveur MCP est le binaire unifié `crates/ai/mcp`; l'ancien
`apps/shenron-mcp` (not in repo) est supprimé. Le dépôt contient aussi un worker Python `uv`
(`py/aphrody-train`).

| Capacité | Implémentation | Interface pour Bun | Configuration | Maturité |
| --- | --- | --- | --- | --- |
| API de calcul Shenron | `aphrody/crates/aphrody-mcp/src/http_rest.rs:110-132` (routeur), binaire `aphrody-mcp http`. Build de release : `cargo build -p aphrody -p aphrody-mcp --features aphrody-mcp/ocr` (`scripts/build-aphrody-stack-release.sh:50`) | REST propriétaire `/api/v1/shenron/{health, rag/search, rag/document, rag/stats, rag/ingest, rag/sync/finish, llm/chat, embed, ocr, vision/structured}`, Bearer, loopback seulement. Erreurs JSON typées, `no-store`. Corps limité à 24 Mio pour `ocr` et `vision`. Client : `AphrodyComputeClient` (`shenron/packages/pipeline/src/aphrody/compute.ts:59-209`) | Service `aphrody-ai-http`. Client : `APHRODY_SHENRON_API_URL`, `APHRODY_SHENRON_API_TOKEN`. Serveur : `APHRODY_MCP_DATABASE_URL`, `APHRODY_SHENRON_*` (§5.4) | Déployé. En production le 2026-09-23 : `rag=true`, `llm=false`, `ocr=false` ; la release active renvoie 404 sur `rag/stats` |
| Recherche RAG hybride (PostgreSQL + pgvector) | Lexical : `http_rest.rs:351-534`, avec classement titre/URL/contenu, intention (`:747`), indices de source (`:823`) et expansions FR/EN/JA (`:623`). Dense : `shenron_vector.rs:20-60` (cosinus pgvector, garde de dimension 384, garde anti-vecteur périmé). Fusion RRF k=60 et dédoublonnage par URL : `http_rest.rs:490-531` | `GET /api/v1/shenron/rag/search?q&limit(1..20)&lang&kind&sourceId&entity` renvoie `{results, mode: 'lexical'|'hybrid'}`, avec `content` limité à 8192 caractères. Outil MCP `aphrody_shenron_rag_search` | Mode `hybrid` : `APHRODY_SHENRON_EMBED_MODEL=Xenova/multilingual-e5-small` et `APHRODY_SHENRON_EMBED_BASE_URL` vers `aphrody-shenron-embed` | Utilisable. Hors ligne sur 172 questions : Recall@5 0,8663 en lexical, 0,9186 en hybride. Production lexicale. **Pas de rerank.** `aphrody-mcp/README.md` (≈ l. 98-110) dit encore « lexical, pas de vecteurs », en retard sur le code |
| Ingestion RAG par générations | `http_rest.rs:843-936` (ingest), `:966-1023` (sync/finish) | `POST rag/ingest`, upsert idempotent par `sourceId` sous `pg_advisory_xact_lock`, nouvel embedding si le texte change. `POST rag/sync/finish {originSourceId, syncGeneration, expectedCount}` : retrait logique `metadata.visible=false`, 409 si le compte diffère | Mêmes variables. Si l'embed est configuré mais injoignable, renvoie 503 (rejouable) | Utilisable ; respecte la règle 8 (aucun `DELETE`) |
| Chat LLM | `http_rest.rs:1025-1213`, `shenron_gemini_web.rs:21-72` | `POST llm/chat {messages (≤ 32), model?}` renvoie `{answer, model}`. Ni streaming, ni outils, ni comptage de jetons. Outil MCP `aphrody_shenron_llm_chat` | `APHRODY_SHENRON_LLM_PROVIDER` (le gate de déploiement impose `gemini-web`), `APHRODY_SHENRON_LLM_BASE_URL` (défaut en dur à `http_rest.rs:1208-1213`), `APHRODY_SHENRON_LLM_MODEL`, `APHRODY_SHENRON_GEMINI_MODEL`, `APHRODY_SHENRON_GEMINI_COOKIE_FILE`. Cadre infra : `config/google-gemini-pipeline.json` (binaire `aphrody-google`, fournisseurs `gemini-web` et `gemini-oauth` via `aphrody-antigravity`, voie Vertex `APHRODY_VERTEX_PROJECT`, `fallback: fail-closed`, et `forbidden: cookie-forwarding-between-hosts` à `:48`, qui interdit de copier le fichier de cookies Gemini d'un poste vers le VPS) | Expérimental : `llm=false`, session Gemini Web rejetée (502 « page bootstrap failed ») |
| Proxy d'embeddings | `http_rest.rs:1032-1129` | `POST embed {texts (≤ 16 × 8 Kio), kind: 'query'|'passage'}` renvoie `{vectors, model}`. Préfixe E5 ajouté par le serveur ; contrôle du nombre, de l'index et de la finitude des vecteurs | `APHRODY_SHENRON_EMBED_MODEL`, `APHRODY_SHENRON_EMBED_BASE_URL` (repli sur `APHRODY_SHENRON_LLM_BASE_URL`, puis sur un défaut littéral en dur à `http_rest.rs:1055-1057`) | Utilisable ; dépend de l'embedder |
| Service E5 | `aphrody/apps/shenron-embed/src/index.ts`. **Bun + `@huggingface/transformers` 4.2.0 (onnxruntime-node, sharp), pas Rust** | OpenAI-compatible : `GET /health` (503 tant que le modèle charge), `POST /v1/embeddings {model:'Xenova/multilingual-e5-small', input}`. Préfixe E5 fourni par l'appelant. Client : `ShenronEmbeddingsClient` (`shenron/packages/pipeline/src/aphrody/shenron-embeddings.ts:24-90`) | Service `aphrody-shenron-embed` (`staged: true`). `APHRODY_SHENRON_EMBED_{HOST,PORT,CACHE_DIR}`, et `APHRODY_SHENRON_EMBED_ALLOW_REMOTE=1` pour `--warm-cache` seulement. Les SHA256 du modèle et du tokenizer sont **consignés** (`README.md:19-23`) mais **non vérifiés** : `index.ts:5-16` appelle `pipeline("feature-extraction", MODEL, { dtype: "q8" })` sans révision épinglée ni contrôle d'empreinte | Expérimental : cache modèle vide sur le VPS le 2026-09-23 |
| API publique modèles et RAG générique | `http_rest.rs:1511-1690` | `GET /api/v1/models`, `GET /api/v1/rag/query` (en GET ; `aphrody/docs/RAG.md:26` dit POST à tort), `GET /api/v1/rag/stats`, `GET /healthz`. Sans jeton | `APHRODY_MCP_DATABASE_URL`, `APHRODY_HOME` | Utilisable ; seules routes publiées par Nginx (`nginx-routes.json:21`) |
| Serveur MCP unifié et outils Dragon Ball | `aphrody-ai/crates/aphrody-mcp/src/main.rs`, `dragonball_tools.rs`, `http_rest.rs` | Stdio par `aphrody-mcp` ou Streamable HTTP sur le listener MCP configuré. Outils Shenron `dragonball.*` (30 publics, 5 admin) plus les catalogues Aphrody conditionnés par les features du build. Les outils Dragon Ball proxifient les API du bot/site ; RAG local/persona relèvent de `aphrody-rag::dragonball`. `tools/list` du binaire installé fait foi. | `SHENRON_API_URL`, `SHENRON_SITE_API_URL`, `SHENRON_SITE_URL`, jetons admin côté processus pour les outils d'écriture. Le plugin Shenron déclare la connexion locale stdio. | Code présent ; état live du binaire et des backends à vérifier dans Infra du monorepo. Pas de service MCP Dragon Ball/OAuth public séparé. |
| RAG local et CLI | `aphrody/crates/aphrody-rag` (FTS5, vecteurs BLOB, RRF, MMR, rerank `reranker/llama.rs`, embedders `ort`/`llama`/`openai`), `aphrody-rag-core`, `crates/infra/aphrody-command/src/rag_cmd.rs:36-68`. Ingestion Web PostgreSQL déjà écrite : `aphrody-rag/src/postgres.rs:54` (`ingest_web_document`, table `aphrody_rag_documents`, corpus `bxc_crawl`, lexical seulement), branchée sur `aphrody rag web-ingest` quand `APHRODY_MCP_DATABASE_URL` est défini (`rag_cmd.rs:225-242`) | CLI `aphrody rag index|web-ingest|search|context|stats` (modes `lexical|vector|hybrid|hybrid-rerank`). JSON-RPC `aphrody/rag/{search,context,status}` | Table `[rag]` du `config.toml`. `APHRODY_WEB_API_URL`, `APHRODY_WEB_API_TOKEN` pour `web-ingest` ; `APHRODY_MCP_DATABASE_URL` pour la cible PostgreSQL | Utilisable ; feature `rag` absente du binaire de production |
| Évaluation RAG | `aphrody/crates/aphrody-rag-eval`, `aphrody-rag-core/src/eval.rs` | CLI `aphrody-rag-eval --target http|mcp|local …`, seuils par `--gates`. Métriques identiques bit à bit à `rag-eval.ts` (Recall@k, MRR, p50/p95). La cible `http` n'envoie **aucun** en-tête d'authentification (`crates/ai/rag-eval/src/target/http.rs:92-116`) et vise par défaut `/api/public/rag/search` de `shenron-bot` (`main.rs:176-178`), donc le backend courant du bot. La cible `mcp` accepte `aphrody_shenron_rag_search` (`main.rs:156-160`) | `APHRODY_SHENRON_GOLD_PATH` (test protégé) | Utilisable |
| Inférence locale | `aphrody/crates/aphrody-llama-server` pilote `llama-server` sans le lier (`managed.rs:20-22`) ; `aphrody-models/catalog.json` (18 modèles : E5, qwen3-embedding, bge-reranker base et v2-m3, PP-OCRv5, dots-ocr, qwen2.5-vl, whisper, gpt-oss…) ; `aphrody-infer` (ORT CUDA/DirectML/CPU) | CLI `aphrody model list|pull|verify|… --json`, `aphrody infer runtime|probe`. Le `llama-server` lancé expose `/v1/chat/completions`, `/v1/embeddings` et `/v1/rerank` | `APHRODY_HOME`. **Aucun service au catalogue** | Utilisable sur poste GPU (`aphrody/docs/PLAN.md:81`) ; absent de la production |
| OCR et vision | `aphrody-ocr`, `aphrody-ocr-onnx` (PP-OCRv5 : polygones et confiance), `aphrody-ocr-vlm` (dots-ocr, granite-docling, qwen2.5-vl via `llama-mtmd-cli`), `aphrody-ocr-core` (audit et statuts `Text…ProcessingError`), `aphrody-vision` | HTTP `POST /api/v1/shenron/ocr {engine: 'ppocr'|'gemini-web'|vlm, include_geometry}` et `/vision/structured`. CLI `aphrody ocr page|ppocr|batch|audit|dbfr|shenron` (JSONL, reprise par `--skip-done`) | `aphrody model pull ppocr-v5-mobile` ; `DBFR_BASE_URL` (optionnel) | Utilisable. `health.ocr` = `cfg!(feature="ocr")` : un drapeau de compilation, pas la présence d'un modèle. La CLI `aphrody ocr …` est **absente** du binaire `aphrody` de production (feature `ocr` du crate `aphrody` non activée, `apps/cli/Cargo.toml:21`) : lots OCR sur windows-local ou WSL seulement |
| Voix et STT | `aphrody-voice` (whisper.cpp), `aphrody-mcp/src/{voice_tools,stt_local_tools}.rs` | MCP `voice_*` (STT/TTS cloud), `aphrody_transcribe` (local) ; CLI `aphrody job transcribe` | `ELEVENLABS_API_KEY`, `OPENAI_API_KEY` ; poids `whisper-*` | Expérimental. `voice_*` est compilé dans le binaire de production (non gardé par feature) mais dépend de clés d'API ; `aphrody_transcribe` (feature `stt-local`) et `aphrody job` (feature `jobs`) en sont absents |
| Génération d'image Adobe | crate `aphrody-firefly` ; `aphrody-mcp/src/{firefly_tools,photoshop_tools}.rs` | MCP `firefly_generate`, `firefly_generative_fill`, `firefly_generative_expand`, `firefly_to_photoshop` (`main.rs:1057-1215`) ; CLI `aphrody firefly` (feature `firefly`, `apps/cli/Cargo.toml:71`) | Identifiants Adobe Firefly Services | Outils MCP compilés en production (non gardés par feature), inutilisables sans identifiants ; CLI absente de la production |
| App-server JSON-RPC | `aphrody/crates/aphrody-app-server/src/lib.rs:531-991` (`dispatch`), routes HTTP `:1467-1470` | NDJSON sur stdio (`aphrody app-server`), ou HTTP loopback `/rpc`, `/events` (SSE), `/health` | `config.toml`, avec `[rag]` pour les méthodes RAG | Utilisable |
| A2A 1.0 | `aphrody-a2a-server`, `aphrody-a2a-coord`, `aphrody-a2a-client` | JSON-RPC A2A (`SendMessage`, tâches, carte d'agent) ; `aphrody a2a serve|tick|invoke` ; outil MCP `aphrody_a2a_call` | Service `aphrody-a2a`. `APHRODY_A2A_ENDPOINT`, `APHRODY_A2A_PEERS_FILE` ; registre `config/a2a-peers.json` | Utilisable ; état en production non établi (à vérifier) |
| Entraînement | `aphrody-train` (bail GPU, runner) et `aphrody-py/packages/ai/py/aphrody-train` (uv) | CLI `aphrody train status|lease|run --kind embed|rerank|lora` ; événements NDJSON | uv, `APHRODY_PY_ROOT`, GPU CUDA, jeu d'or | Expérimental : `promote` refuse d'installer (`train_cmd.rs:55`, P10 ouvert) |
| CLI et C ABI | `crates/infra/aphrody-command/src/lib.rs:258-872` ; `aphrody-ffi` (cdylib) | `Bun.spawn([APHRODY_BIN, …])` avec JSON sur stdout (`doctor --json`, `git inspect`, `mcp call` ; `ocr …` sur un binaire compilé avec `ocr`). `translate` imprime du texte humain coloré (`commands.rs:969-983`) et `notify` une ligne texte `canal id salon` (`commands.rs:2080`) : pas de JSON. **Le C ABI par `bun:ffi` est interdit dans Shenron** | `APHRODY_BIN` | Utilisable (CLI) |
| Passerelle OpenAI (legacy) | `aphrody/crates/aphrody-gateway/src/server.rs:47-53` | `/v1/chat/completions` (SSE), `/v1/models` | Non cataloguée ; son port par défaut appartient à un autre service | Legacy, suppression prévue en P5 (`aphrody/CLAUDE.md` §4) |
| Mémoire, Jev, fournisseurs | `aphrody-memory` (Mem0, Honcho, SQLite, LanceDB) ; `aphrody-jev` (`/v1/systemone`) ; `aphrody-providers` (anthropic, gemini et antigravity seulement ; xAI refusé, `lib.rs:59-66`) | CLI `aphrody memory migrate`, `aphrody antigravity chat` ; HTTP `aphrody-jev` | Variables propres à chaque fournisseur | Expérimental. Aucun crate n'écrit `knowledge.db documents_fts` |

### 2.2 `aphrody-os` : système, M3, canvas, 2D/3D, Obscura, Web

`aphrody-os` ne dépend jamais d'`aphrody`. Pour Shenron, les seules voies
conformes sont les services HTTP du catalogue (`aphrody-site`,
`aphrody-web-api`) et les paquets npm à binaires préconstruits.

| Capacité | Implémentation | Interface pour Bun | Configuration | Maturité |
| --- | --- | --- | --- | --- |
| Tokens et paquets web Material 3 | `crates/ui/m3-tokens` (source Rust unique : HCT, palettes, rôles), `packages/{m3-theme, m3-tokens, material-web, react, m3-motion, m3-design}` | npm CSS/TS (§3). CSS et polices aussi servis par `aphrody-site` sous `/cdn/m3/*` (`crates/aphrody-site/src/assets_api.rs:37` (not in repo)). Les éléments `md-*` se chargent côté client (`ssr:false`) | Aucune | Publiés en 3.2.5/3.2.6, sources en 3.3.0 ; installabilité partielle (§3) |
| Adaptateur Next `@aphrody/m3-next` | `design/aphrody-m3/packages/m3-next` | `withM3()`, `M3Root`, `m3Css`. Rust par FFI sous `bun --bun`, sinon repli JS (parité testée) | — | Utilisable dans `aphrody-os` ; **non publié** |
| Façade Rust `@aphrody/bun` | `crates/ui/bun` (cdylib `bun_rs`), `packages/bun/src/render.ts:61,93` | `bun:ffi` : `m3Render`, `m3Render3d`, Sass (grass), HCT, `m3SeedFromImage` | `cargo build` local | Non publié, aucun binaire livré ; **interdit dans le bot** |
| Canvas Skia `@aphrody/canvas` | `design/aphrody-m3/packages/canvas/index.ts` (façade 1.0.9-aphrody.1), sous-module `third_party/canvas` (napi-rs/canvas 1.0.9, épinglé en `8411071`) | `createCanvas`, `loadImage`, `GlobalFonts`, encodage png/webp/avif/jpeg, `drawM3Scene`/`drawM3Scene3d`, entrée navigateur `/site` | Binaire `skia.<triple>.node` | Façade **non publiable** : elle importe hors du paquet (`index.ts:2,78,153-154`). npm reste en 0.1.99 |
| Rendu M3 2D (HTTP) | `crates/ui/render` (raster CPU déterministe sans `unsafe`, backend wgpu à parité). Route HTTP : `crates/aphrody-site/src/canvas_api.rs:5-9,33-47`, qui ne désérialise qu'une `Scene` 2D et appelle `raster::render_scene_png` | HTTP `POST /api/v1/canvas/render` : scène JSON 2D (`scene.rs:288-360`, miroir TS écrit à la main dans `packages/interop/native/src/scene-types.ts`), Bearer, réponse `image/png` | Service `aphrody-site`. Jeton `APHRODY_SITE_WEB_API_TOKEN` (alias `APHRODY_BXC_API_TOKEN`) | Production (200 avec jeton, 401 sans). Limites : 1024 × 1024, 64 nœuds, 4 Mio, texte sur une ligne en alphabet latin (`text.rs:41-44`), 2 rendus simultanés (503 `RENDER_BUSY`) |
| Rendu M3 3D | `crates/ui/render` : `pipeline3d`, glTF/OBJ/export GLB | Aucune route HTTP : crate Rust, `m3Render3d` de `@aphrody/bun` (`bun:ffi`, interdit) ou outils `render3d_*` du kernel | — | Pas de surface serveur pour Shenron |
| Rendu 3D du kernel | `crates/aphrody-render3d` (not in repo) | Outils MCP `render3d_*` via `@aphrody/os` (pipe nommé ou socket Unix) | `APHRODY_OS_SOCKET` | Poste de travail seulement ; pas de service serveur |
| Accès public Aphrody Web | Nginx : `yolo/config/host/nginx/aphrody/aphrody-apex.conf:105-114` (`location ^~ /api/v1/web/`, `client_max_body_size 4m`, réécriture vers `/api/v1/` de l'amont `aphrody-web-api`, en-tête `Authorization` transmis) ; `yolo/config/host/nginx/routes.json:22` (service `aphrody-web-api`, chemin `/api/v1/web/`). Le relais `crates/aphrody-site/src/web_api.rs:43-53` (not in repo) (liste blanche de 6 routes, corps ≤ 1 Mio par `main.rs:78`, `private, no-store`) ne s'applique qu'aux appels directs en loopback à `aphrody-site` | `/api/v1/web/*` public = **toutes** les routes BXC `/api/v1/*` (`apps/bxc/src/server/app.ts:266` (not in repo) et suivantes : `scrape`, `crawl`, `crawl/{stats,replay,failed}`, `page{,/openapi,/markdown,/types}`, `search{,/keyword,/semantic}`, `extract`, `index/search`, `autocomplete`, `recon`, `detect`, `fut/*`), protégées par le seul jeton BXC | Public : Nginx vers `aphrody-web-api`. Incohérence infra : `service-catalog.json:26` déclare `publicProxy: "aphrody-site"` pour `aphrody-web-api`. Client : `APHRODY_WEB_API_URL`, `APHRODY_BXC_API_TOKEN` ; `AphrodyWebClient` utilise le préfixe `/api/v1/web` hors loopback (`packages/shenron/pipeline/src/aphrody/web.ts:40-41`) et atteint donc BXC directement | Production. La release active a stocké `chunks=0` : la correction n'existe que sur un binaire candidat |
| BXC (crawl, scrape, index) | `apps/bxc` (not in repo) (Elysia), `crates/aphrody-web-ffi` (not in repo), `aphrody-web-extract` (contenu principal, Markdown, chunks, SimHash), `aphrody-web-index` (HNSW int8), `crates/aphrody-web-render` (not in repo) (rendu JS en processus V8 + html5ever derrière un C ABI non bloquant, chargé par `BXC_RENDER_LIB`, livré en `libbxc_render.so` par `build-aphrody-stack-release.sh:45`). Outillage Dragon Ball déjà présent : CLI `bxc dragonball` (`apps/bxc/src/cli/index.ts:67,261`, `cli/dragonball.ts` : portail officiel, line-ups Toei, Jajanken, archives Toriyama), `sources/dragonball.ts`, `sources/shenron-canon.ts`, `archive/shenron.ts` (manifeste média Archive.org), `archive/dragonball-export.ts` (export JSONL), outil MCP `bxc_dragonball_shenron` | npm `@aphrody/bxc` ; CLI `bxc`. HTTP `aphrody-web-api` : voir la ligne précédente pour l'exposition publique | `BXC_API_TOKEN`, `BXC_RUST_BRIDGE_LIB`, `BXC_RENDER_LIB`, `BXC_DB_PATH` | Utilisable. L'état des jobs est en mémoire du processus |
| Navigateur Obscura | `crates/aphrody-obscura/crates/obscura-{browser,cdp,render,cli,mcp}`, `crates/web/web-engine` (binaire `aphrody-web`) | CLI `obscura` et `aphrody-web fetch|scrape|serve|mcp`. CDP : `Page.captureScreenshot`, `Page.printToPDF`. MCP `browser_*`. Déjà joignable en production par le `/mcp` d'`aphrody-ai-http` : la feature par défaut `native-browser` d'`aphrody-mcp` republie les outils Obscura (navigation, rendu, capture, PDF) en `aphrody_browser_*` (`aphrody/crates/aphrody-mcp/src/browser_tools.rs:6-9`) | Build local (V8) | Utilisable. Pas de service catalogué propre ; aucune police CJK embarquée, pas de `text-shadow` |
| Embeddings et rerank sur CPU | `crates/aphrody-web-embed` (not in repo) : MiniLM, bge-small, multilingual-e5-small, ms-marco | Aucune : `aphrody-web-ffi/src/embed.rs` n'est pas compilé | — | Orphelin |
| Traduction | `crates/ai/translate` (WebGoogle, puis GoogleRpc, puis MyMemory), consommé par `aphrody` (`aphrody/Cargo.toml:821`). `src/shenron.rs` (395 lignes) est un portage Rust du contrôle qualité JA → FR de Shenron (`apps/shenron/site/src/lib/ja/traduction.ts`) : `proteger_termes`, `restaurer_termes`, `segments_traduisibles`, `intraduisible`, `refus`, et un lexique canonique codé en dur `default_canon_lexique()` (`:283`), second référentiel qui peut diverger de `data/shenron/lexique-db-canonique.json` et `apps/shenron/site/src/lib/ja/lexique-canonique.ts`. Cible wasm32 déclarée (`Cargo.toml` : dépendances `wasm-bindgen` sous `cfg(target_arch = "wasm32")`), sans annotation `#[wasm_bindgen]` ni paquet publié | CLI `aphrody translate TEXT -s -t -b -f` (`aphrody/crates/aphrody/src/lib.rs:378-394`) : **sortie humaine seulement**, pas de `--json` (clap rejette le drapeau). Le « Mode Shenron » s'active tout seul sur une entrée japonaise (`commands.rs:966-974`). Le script `apps/shenron/site/scripts/_aphrody-translate-remote.ts:130-135` lit la sortie en cherchant l'en-tête `Traduction :` | — | Utilisable (CLI) ; mode JSON ou route HTTP à créer (§6.1) |
| Contrats de protocole | `aphrody-app-protocol`, `aphrody-agent-proto`, `aphrody-a2a(-pb)`, `crates/aphrody-site/src/gateway.rs:106-136` (not in repo) | `GET /api/v1/schemas`, `/api/v1/openapi.json` sur `aphrody-site` | — | Utilisable |
| OCR d'écran | `crates/os/winclean/src/ocr.rs` (Windows.Media.Ocr) | MCP `computer_ocr` | Windows seulement | Sans objet pour le VPS |
| Primitives de processus | `aphrody-sandbox`, `aphrody-proc` (bail GPU), `aphrody-jobs`, `aphrody-task-runner`, `aphrody-cron` | Crates Rust seulement, atteintes indirectement par les CLI | — | Indirect |

### 2.3 Infra du monorepo : services et exploitation

| Service (id catalogue) | Type | Rôle pour Shenron | Configuration côté consommateur | État |
| --- | --- | --- | --- | --- |
| `shenron-site` | `next-bun-http` | Site Next (sert aussi le CDN des assets partagés) | Fichiers `EnvironmentFile` de l'unité (`yolo/config/host/systemd/shenron/shenron-site.service:32-33` : `shenron-site.env` et `shenron-compute-client.env`) | Utilisable ; release rapportée active le 2026-09-23 (`SHENRON-MIGRATION.md:117-121`) |
| `shenron-bot` | `discord-bot-and-api` | Bot Discord et API REST/GraphQL/OpenAPI dans un seul processus ; `/api/canvas/`, proxy HLS | `API_HOST`, `API_PORT` fixés par l'unité ; `shenron-bot.env` et `shenron-compute-client.env` (`yolo/config/host/systemd/shenron/shenron-bot.service:24-25`) | Utilisable. Pas de plafond mémoire, **volontairement** : `yolo/config/host/systemd/shenron/shenron-bot.service:47-54` documente le gel de la boucle d'événements (Discord, HTTP, SQLite, canvas) par le reclaim cgroup, et pose `MemoryLow=384M`, `CPUWeight=200`, `IOWeight=200`, `OOMScoreAdjust=-500` |
| `shenron-pg-tunnel` | `ssh-tunnel` | PostgreSQL `shenron_site` sur dbfr | `DATABASE_URL` | Utilisable |
| `shenron-backup` | `backup` | Cache SQLite borné | — | Staged ; timer non installé sur le VPS |
| `aphrody-ai-http` | `rust-http` | Calcul Shenron (§2.1) | `APHRODY_SHENRON_API_URL`, `APHRODY_SHENRON_API_TOKEN` | Déployé, partiel |
| `aphrody-shenron-embed` | `bun-http` | Embeddings E5 384 D | `APHRODY_SHENRON_EMBED_BASE_URL` | Staged |
| `aphrody-web-api` | `bun-http` (source `aphrody-os`) | Crawl, scrape, extraction, recherche ; publié par Nginx sous `/api/v1/web/*` (`nginx-routes.json:22`) alors que le catalogue annonce `publicProxy: "aphrody-site"` (`service-catalog.json:26`) | `APHRODY_WEB_API_URL`, `APHRODY_BXC_API_TOKEN` | Production |
| `aphrody-site` | `rust-http` (source `aphrody-os`) | `/api/v1/canvas/render`, `/cdn/m3/*`, schémas. Son relais `/api/v1/web/*` n'est atteint qu'en loopback : le public passe par Nginx directement vers `aphrody-web-api` (§2.2) | `APHRODY_WEB_API_URL`, `APHRODY_SITE_WEB_API_TOKEN` | Production |
| `aphrody-a2a` | `rust-http` | Hub A2A 1.0 | `APHRODY_A2A_ENDPOINT`, `SHENRON_A2A_TOKEN` | Inconnu (dry-run dans le gabarit) |
| `nie-model-serve` | `rust-http` | Hors Shenron. Modèle de plafonnement d'une charge Rust lourde : `MemoryHigh`, `MemoryMax`, `OOMScoreAdjust`, `TasksMax` | — | Production |

Outils d'exploitation utiles à Shenron :

- **Validation du catalogue** : `cargo run -- validate` vérifie des health en
  loopback et des ports et unités uniques
  (`crates/infra/infra/src/validate.rs:81-95`). Le schéma
  `CatalogService` (`catalog.rs:28-44`) n'a **ni champ d'hôte ni contrat
  d'environnement**.
- **Plan de release** : `bun run site:artifact` puis `bun run site:migrate`,
  une release par commit sous le `releaseRoot` du service `shenron-site`,
  bascule atomique du pointeur `policies.applicationRoots.shenron`
  (`service-catalog.json:159-160,220`). **Il n'existe pas d'adaptateur de déploiement
  Shenron** : `DeployStack` ne connaît que `Rg` et `Aphrody`, et
  `atomic-deploy-rg.sh:40-41` filtre les identifiants `rg-`.
- **Topologie** : le VPS est le seul runtime public. Aucun hôte ne déclare de
  GPU, et le nombre de vCPU n'est pas consigné. dbfr refuse le calcul (sites,
  bots, crawlers). windows-local interdit `production-secrets` et
  `public-runtime` ; WSL interdit `production-database` et `public-runtime`.
  Les deux sont réservés au build et aux lots hors ligne. Bandes de priorité : Shenron
  90, Aphrody 85 ; indexation et MCP en bande 4 ; crawlers, miroirs et jobs
  exploratoires en bande 5, désactivés par défaut (`config/production-topology.json`,
  `docs/products/infra/PRODUCTION-ALLOCATION.md:22-28`, `config/scheduler-policy.json:15`).
- **Pipeline unifié et audit en direct** : `config/pipeline.json` (format,
  lint, types, tests, build, artefact Shenron) et `config/live-audit.json`
  (crawl BXC du site après déploiement).

**Conséquence pour le lourd.** Sur le VPS de production, l'inférence locale
se limite à de petits modèles CPU comme E5-small. Tout ce qui exige un GPU
(PP-OCR en lot, VLM, fine-tuning) tourne hors ligne sur windows-local ou WSL.
Les résultats sont renvoyés par les API d'ingestion (`rag/ingest`,
`aphrody ocr shenron deposit`).

---

## 3. Paquets `@aphrody/*` consommables

Relevé npm et essais `bun install` sous Bun 1.4.2, le 2026-09-24. Un paquet
entre au catalogue Shenron seulement s'il remplit trois conditions :

1. ses dépendances sont en semver résolu, sans `catalog:` ni `workspace:` ;
2. il est en TS pur ou WASM, ou il embarque des binaires pour linux-x64-gnu
   *et* win32-x64-msvc ;
3. il n'appelle pas `bun:ffi` sur le chemin du bot.

| Paquet | Version npm | Nature | Plateformes | Verdict pour Shenron |
| --- | --- | --- | --- | --- |
| `@aphrody/canvas` | 0.1.99 | napi-rs Skia (ancien fork) | linux-x64-gnu seulement : le manifeste ne câble que `@aphrody/canvas-linux-x64-gnu` (dépendance et `optionalDependencies`), `napi.targets = ["x86_64-unknown-linux-gnu"]`. Un paquet `canvas-linux-arm64-gnu` existe sur npm mais n'est jamais installé ; `canvas-win32-x64-msvc` n'existe pas. **Pas de win32** : « Cannot find native binding » | Utilisé aujourd'hui (`shenron/package.json:49`, `apps/shenron/bot/package.json:44`) ; le bot le remplace par un mock hors linux-x64 (`apps/shenron/bot/src/lib/preload.ts:11-60`). **À remplacer** |
| `@napi-rs/canvas`, alias `"@aphrody/canvas": "npm:@napi-rs/canvas@1.0.9"` | 1.0.9 | napi-rs Skia (l'amont épinglé par la façade aphrody-os) | win32-x64-msvc, linux-x64-gnu et d'autres | **Recommandé.** Vérifié sous Windows (`createCanvas` puis PNG). API utilisée par Shenron identique (`encode`, `GlobalFonts.registerFromPath`) |
| `@aphrody/canvas` (façade) | 1.0.9-aphrody.1, non publiée | napi-rs, M3 | — | Attendre une publication avec une vraie dépendance sur `@napi-rs/canvas` |
| `@aphrody/bxc` | 0.9.15 | TS ; le pont Rust (`bun:ffi`) n'est pas livré | Bun ≥ 1.4.2 | Scripts seulement, sans pont natif ; préférer l'HTTP `aphrody-web-api` |
| `@aphrody/frames` | 0.2.1 | TS et sous-processus ffmpeg | Bun ≥ 1.3.14, ffmpeg dans le `PATH` | Admissible pour les scripts de lots |
| `@aphrody/eslint-plugin-m3` | 3.2.5 | TS, sans dépendance | Toutes | Admissible |
| `@aphrody/m3-motion` | 3.2.5 | TS/CSS | — | Non installable : le manifeste publié déclare `"motion": "catalog:"` ; `bun add @aphrody/m3-motion@3.2.5` échoue (`motion@catalog: failed to resolve`) |
| `@aphrody/m3-tokens`, `m3-react`, `material-web` | 3.2.5 | TS/CSS | — | Dépendances `catalog:`/`workspace:` non résolues (à vérifier avec `bun install`) |
| `@aphrody/m3-theme` / `m3-design` | 3.2.6 | TS ; `m3-design` dépend de `@aphrody/bun-rs` | — | Cassés en transitif |
| `@aphrody/bun-rs` | 3.2.5 | Source Rust et TS, sans binaire | — | Inutilisable sans `cargo` |
| Aides TS pures : `x` 1.2.5, `xai` 1.1.5, `fut` 1.0.0, `next-playwright` 0.2.5, `bxc-test` 0.2.6, `animesama`/`xcom`/`challonge`/`worldbeyblade` 0.2.1, `n2b-shims`/`n2b-types` 0.6.2, `ietv-client` 1.1.2, `ovh` 0.1.1, `yolo` 3.2.0, `web-notification`/`web-storage` 0.1.0 | voir nom | TS pur, sans Rust | Toutes | Admissibles ; pertinents pour Shenron : `next-playwright` et `bxc-test` (e2e du site), scrapers |
| `@aphrody/zstd`, `@aphrody/xml2` | 0.1.0 | `bun:ffi` vers `libzstd` et `libxml2` du système | Linux | **Interdits** dans le bot |
| `doc-ai` 3.2.5, `spaceui` 0.2.4-fork.1, `ietv`/`zukan`/`wonderbot` 0.2.2, `n2b-core`/`n2b-plugin` 0.6.2 | voir nom | — | — | Non installables (`catalog:` non résolu, vérifié sur `doc-ai`) |
| `@aphrody/bun`, `os`, `m3`, `m3-next`, `m3-ai`, `m3-primitives`, `m3-icons`, `m3-forms`, `m3-explorer`, `assets`, `drive-client` | non publiés | — | — | Hors d'atteinte |
| WASM | aucun paquet publié | — | — | Il existe des annotations `wasm_bindgen` dans `crates/ui/bun`, et `crates/ai/translate` déclare une cible wasm32 (dépendances `wasm-bindgen`), mais rien n'est empaqueté |

Le scraper `@aphrody/voiranime` local et son mapper dédié ont été retirés : le
scraping VoirAnime est désormais fourni par BXC. Shenron pourra installer le
paquet BXC depuis le registre une fois Aphrody Web stabilisé.

---

## 4. Matrice de délégation des opérations lourdes

Répartition proposée des paquets `@shenron/*` :

- **`@shenron/pipeline/ai`** porte tous les clients de calcul : LLM, embeddings,
  rerank, RAG, OCR, vision, traduction. `AphrodyComputeClient` et
  `ShenronEmbeddingsClient` y migrent depuis `@shenron/pipeline/aphrody`.
- **`@shenron/api`** porte le contrat des APIs publiques Shenron ; Aphrody les consomme via les outils `dragonball.*`.
- **`@shenron/ui`** porte les aides de rendu serveur.
- **`@shenron/pipeline/aphrody`** se réduit au client Web et au lancement de la CLI.

`@shenron/pipeline/ai`, `@shenron/api` et `@shenron/ui` ont aujourd'hui un `src/`
vide.

Effort : S ≤ 1 jour, M = quelques jours, L = plus d'une semaine ou
dépendance à un chantier Aphrody.

| Opération | Implémentation actuelle Shenron | Cible Aphrody | Paquet responsable | Effort |
| --- | --- | --- | --- | --- |
| Génération LLM (persona, `/ask`, RAG du site, rédaction) | `AphrodyComputeClient.chat` (`apps/shenron/bot/src/lib/llm.ts:161`, `packages/shenron/pipeline/src/workflows.ts:59`, `apps/shenron/site/src/lib/site-rag.ts`), `APHRODY_LLM_MODEL` à `gemini-web/flash` par défaut | Maintenant : `POST /api/v1/shenron/llm/chat`. Ensuite : backend catalogué (`llama-server` géré par `aphrody-llama-server`, ou Antigravity) et surface OpenAI-compatible `/v1/chat/completions` en streaming sur `aphrody-ai-http`, derrière le jeton ; `@ai-sdk/openai-compatible` avec une base lue dans l'environnement | `@shenron/pipeline/ai` | M (Shenron), L (Aphrody) |
| Embeddings E5 (requête, passage, cache sémantique) | `ShenronEmbeddingsClient` appelé directement (`apps/shenron/bot/src/lib/rag.ts:25`, `semantic-cache.ts:12`, `TrainingService.ts:20`, scripts du pipeline), plus `AphrodyComputeClient.embed`. Reste transformers.js : `apps/bot/src/lib/embeddings.ts` (not in repo) | Un seul chemin : `POST /api/v1/shenron/embed`. Côté Aphrody, portage Rust de `aphrody-shenron-embed` via `OrtEmbedder::load_user_defined` (`aphrody-rag/src/embedder/ort.rs:55`) avec les mêmes fichiers épinglés, sous condition cosinus ≥ 0,997 contre l'archive | `@shenron/pipeline/ai` | S (Shenron), M (Aphrody) |
| Reranking cross-encoder | `rerankRemote()` vers `RERANK_URL` (`apps/shenron/bot/src/lib/rag.ts:173-188`) : chemin mort, le sidecar `embed-server.ts` a été supprimé | `LlamaServerReranker` (`aphrody-rag/src/reranker/llama.rs`) branché dans `shenron_rag_search_core`, mode `hybrid+rerank` (déjà accepté par le client), repli RRF si le reranker échoue | `@shenron/pipeline/ai` | M (Aphrody), S (Shenron) |
| Recherche RAG | Pipeline bot local FTS5/vecteurs/RRF (`apps/shenron/bot/src/lib/rag.ts`). Le package `@shenron/pipeline/aphrody` peut charger l'ABI native `aphrody-ffi` pour une recherche lexicale avec contenu et provenance ; la couverture dépend de l'index présent. Bascule `RAG_BACKEND=aphrody` annulée le 2026-09-23 | Route HTTP unifiée encore cible ; la façade native locale ne prouve ni embeddings/vecteurs ni couverture manga | `@shenron/pipeline/aphrody` (pont natif), `@shenron/pipeline/ai` (client HTTP), bot | M |
| Indexation et synchronisation RAG | `packages/shenron/pipeline/scripts/rag-sync-aphrody.ts:74`, `_rag-aphrody-sync.ts:62`, `scripts/tools/shenron/scripts/ops/offload-rag-to-aphrody.ts:103`. Les scripts `rag-build.ts:25` et `rag-embed-vectors.ts:19` importent un `../src/lib/embeddings` qui n'existe pas | `POST rag/ingest` puis `rag/sync/finish` (générations, retrait logique) ; embeddings calculés par Aphrody à l'ingestion | `@shenron/pipeline` | S |
| OCR (images du bot, planches, databooks) | `AphrodyComputeClient.ocr` force `engine: "gemini-web"` (`compute.ts:111`). Le pipeline utilise `ppocr` (`packages/pipeline/scripts/_aphrody-remote-ocr.ts:75-76` (not in repo) : `engine: "ppocr"`, modèle `ppocr-v5-mobile`, `include_geometry: true`). `RELECTURE_OCR_URL` (`apps/site/src/app/api/databooks/[id]/relecture-ocr/route.ts:39`). Traces tesseract dans `scripts/tools/shenron/scripts/ops/ocr-french-databooks.ts` et `apps/shenron/site/scripts/_databooks-base.ts` | Un seul client, `POST /api/v1/shenron/ocr` avec `engine=ppocr` par défaut et `include_geometry`. VLM pour le Markdown. Lots : `aphrody ocr batch --skip-done`, puis `aphrody ocr shenron verify|deposit` | `@shenron/pipeline/ai` (lots : `@shenron/pipeline`) | S |
| Vision structurée | `/vision/structured` avec `gemini-web/flash` dans `_aphrody-remote-ocr.ts`. Script Ollama d'essai (`apps/shenron/bot/scripts/test-gemma-multimodal.ts:17-18`) | `POST /api/v1/shenron/vision/structured` adossé à un backend vision catalogué (`aphrody-vision`, `aphrody-ocr-vlm`) | `@shenron/pipeline/ai` | M |
| Traduction JA vers FR/EN | NLLB-200 en local par transformers.js (`apps/shenron/site/scripts/ja-traduire.ts:93`, `traduction-boucle.ts`) ; `LIBRETRANSLATE_URL` (`apps/shenron/bot/src/lib/env.ts:96-97`) ; `bxc google` et curl (`packages/pipeline/src/bxc/src/google.ts:96,125`) ; CLI distante `aphrody translate`, dont la sortie humaine est analysée par l'en-tête `Traduction :` (`apps/site/scripts/_aphrody-translate-remote.ts:54-56,130-135`) | `aphrody translate` (crate `aphrody-translate`) ne rend que du texte humain : il faut d'abord un mode JSON côté CLI, ou la route `/api/v1/shenron/translate` sur `aphrody-ai-http` (à créer, §6.1), avec un seul glossaire (`data/rag/lexique-requetes.json` (not in repo), `data/shenron/lexique-db-canonique.json`) au lieu du `default_canon_lexique()` codé en dur dans `aphrody-translate/src/shenron.rs:283` | `@shenron/pipeline/ai` | M |
| Crawl et scrape | `@shenron/pipeline/bxc` lance la CLI `bxc` avec des chemins absolus codés en dur (`src/spawn.ts:36-55`). `AphrodyWebClient` (`packages/shenron/pipeline/src/aphrody/web.ts:26-81`). Appels directs : `packages/shenron/pipeline/scripts/lib/aphrody-web-scrape.ts:31` | Un seul client HTTP vers `/api/v1/web/{crawl,scrape,page}` (Nginx vers `aphrody-web-api`), en bande 5 (crawlers désactivés par défaut) : chaque crawl est planifié explicitement sous `config/scheduler-policy.json`. Réutiliser l'outillage Dragon Ball de BXC (`bxc dragonball`, `sources/dragonball.ts`, `archive/shenron.ts`, `archive/dragonball-export.ts`, MCP `bxc_dragonball_shenron`) plutôt que des collecteurs parallèles. Ingestion RAG par `rag/ingest`, ou par une route `rag/web-ingest` à créer en réutilisant `aphrody_rag::ingest_web_document` (`aphrody-rag/src/postgres.rs:54`) | `@shenron/pipeline/aphrody` (puis `@shenron/pipeline/bxc` à retirer) | M |
| Extraction HTML, Markdown, chunks, quasi-doublons | Code TS dans `@shenron/pipeline` et dans les scripts du bot | `POST /api/v1/web/extract`, `GET /api/v1/web/page` (`aphrody-web-extract`) ; ajouter `extract()` et `page()` à `AphrodyWebClient` | `@shenron/pipeline/aphrody` + `@shenron/pipeline` | S |
| Frames vidéo, identification de scène | ffmpeg (`apps/shenron/bot/scripts/extract-dbz-frames.ts`, `scripts/tools/shenron/scripts/ops/crawl-frames.ts:304`) ; `bxc frames` (`packages/pipeline/src/bxc/src/frames.ts` (not in repo)) | CLI `bxc frames` (`aphrody-os/apps/bxc/src/cli/frames.ts`) ou `@aphrody/frames` 0.2.1, en lot hors ligne. `aphrody-web-api` n'a aucune route frames et le serveur MCP BXC n'enregistre aucun outil frames, donc `aphrody-mcp` n'en republie pas : surface HTTP/MCP à créer (§6.1). Il n'existe aucun chemin vidéo en Rust | `@shenron/pipeline/bxc` | M |
| Cartes Discord : profil, classement, fusion, jauge, scan | `@aphrody/canvas` 0.1.99, Skia dans le processus du bot (`CardService`, `FusionService`, `LeaderboardService`, `GaugeService`, `BackgroundCacheService`, `lib/canvas-kit.ts:11`, `lib/game-cards.ts:6`, `commands/fun/Scan.ts:11`) | Court terme : alias `npm:@napi-rs/canvas@1.0.9`. Long terme : `POST /api/v1/canvas/render` sur `aphrody-site`, une fois `aphrody-render` doté du texte multiligne et CJK, des dégradés, du filtrage bilinéaire et d'images compactes | `@shenron/ui` (rendu), `apps/shenron/bot` | S puis L |
| Transcodage PNG vers WebP/AVIF | `reEncode()` (`apps/shenron/bot/src/api/server.ts:291-311`), `apps/shenron/bot/scripts/optimize-backgrounds.ts:12` | Service Rust de transformation d'image, à créer (§6.1) | `@shenron/images` (client) | L |
| Optimiseur d'images Next | sharp dans `shenron-site` (`apps/shenron/site/package.json:91`, `next.config.ts:112`) | `images.loader` personnalisé vers le même service Rust, ou variantes pré-générées | `apps/shenron/site` | L |
| Hash perceptuel, PSNR, WebP de la médiathèque | `packages/images/src/{hash.ts:22, pixels.ts:13, webp.ts:36-48}` (sharp) ; `apps/bot/src/lib/images/wiki-illustration.ts:19,108` | Service Rust d'analyse d'image (dHash, PSNR, encodage) ; `@shenron/images` devient un client fin à API inchangée | `@shenron/images` | M |
| Découpe et redimensionnement des planches et scans | sharp dans `packages/pipeline/scripts/{selfhost-manga-pages, ingest-dragonball-volumes, export-manga-ocr, assets-dragonballcn}.ts`, `apps/site/scripts/{decoupe-planche, export-databooks-ocr, download-and-ingest-databooks}.ts`, `scripts/ops/{cdn-harvest-worker, ingest-dbs-raw, ingest-soshuhen-all}.ts` | Service ou CLI d'image Rust ; l'OCR reste sur la CLI `aphrody` | `@shenron/pipeline` | M |
| Mesure du trait d'encre | Boucle par pixel en TS sur la sortie brute de sharp (`packages/shenron/pipeline/src/aphrody/index.ts:256-300`) | Point d'analyse du futur service d'image | `@shenron/images` | S (une fois le service disponible) |
| Images Open Graph | `next/og` (Satori + resvg-wasm) : `apps/shenron/site/src/app/opengraph-image.tsx`, `tierlists/[slug]/opengraph-image.tsx` | Priorité basse. Soit Obscura, déjà joignable par les outils `aphrody_browser_*` du `/mcp` d'`aphrody-ai-http` mais hors chemin chaud et sans police CJK, soit `aphrody-render` étendu au 1200 × 630 | `apps/shenron/site` | M |
| Pont natif en processus | Ancienne implémentation supprimée : `AphrodyNativeBridge` et `bun:ffi` | CLI Aphrody appelée par `Bun.spawn`; aucune dépendance FFI dans le bot | `@shenron/pipeline/aphrody` | Clos |
| Évaluation RAG, entraînement | `apps/shenron/bot/scripts/rag-eval.ts` (bibliothèque `apps/shenron/bot/src/lib/rag-eval.ts`), jeu d'or `apps/shenron/bot/tests/rag-gold.jsonl` (172 lignes), `scripts/tools/shenron/scripts/ops/eval-aphrody-rag.ts:58`, `TrainingService`, `/train` | Gate de CI `aphrody-rag-eval --target mcp --mcp-tool aphrody_shenron_rag_search` contre le `/mcp` d'`aphrody-ai-http` (non authentifié aujourd'hui), seuil par `--gates`, ou `scripts/tools/shenron/scripts/ops/eval-aphrody-rag.ts` (lit `RAG_CI_RECALL5_MIN`). La cible `http` ne convient pas tant qu'elle n'envoie pas de Bearer. Fine-tuning par `aphrody train run --kind embed|rerank`, une fois la promotion débloquée (P10) | `@shenron/pipeline` | M |
| Appels RAG du MCP Dragon Ball | `dragonball.rag_*` dans `aphrody-ai/crates/aphrody-mcp/src/dragonball_tools.rs` appellent le backend Shenron configuré ; les clients bot/site utilisent `@shenron/pipeline/ai` | Garder les routes et réponses documentées ; unifier l'auth RAG côté infra sans exposer de jeton dans le plugin | `@shenron/pipeline/ai` + `@shenron/api` | Code livré ; déploiement à vérifier |
| Scène M3 2D/3D | Aucun usage | 2D : `POST /api/v1/canvas/render` sur `aphrody-site`. 3D (`m3Render3d`, `pipeline3d`) : bloqué tant qu'il n'y a ni cdylib préconstruite ni route catalogue | `@shenron/ui` | L |
| Hub A2A | Le site Shenron porte le hub Dragon Ball (`dragonball.a2a_*`); Aphrody fournit aussi un A2A d'écosystème distinct | Garder le hub de tâches DBFR côté site ; provisionner son jeton par le contrat infra avant enforcement | `@shenron/api` | Propriétaires distincts clarifiés ; auth live à vérifier |

---

## 5. Contrat d'environnement

Règles :

1. Chaque variable est lue et validée au démarrage (schéma `zod`).
2. Une variable obligatoire absente fait échouer le démarrage, sans URL par défaut.
3. Un jeton n'est jamais journalisé.
4. Le client de calcul refuse toute URL qui n'est pas en HTTP loopback. C'est
   déjà le cas dans `compute.ts`, mais le client garde un défaut littéral à
   retirer.

Esquisse pour `@shenron/pipeline/ai` :

```ts
const AphrodyComputeEnv = z.object({
	APHRODY_SHENRON_API_URL: z.url(),          // service aphrody-ai-http, loopback only
	APHRODY_SHENRON_API_TOKEN: z.string().min(32),
	APHRODY_LLM_MODEL: z.string().default("gemini-web/flash"),
	RAG_BACKEND: z.enum(["aphrody", "local"]).default("local"),
});
```

### 5.1 `@shenron/pipeline/ai` (calcul)

| Variable | Service du catalogue | Provisionnée par l'infra | Statut |
| --- | --- | --- | --- |
| `APHRODY_SHENRON_API_URL` | `aphrody-ai-http` | Oui, `shenron-compute-client.env` écrit par `scripts/ops/provision-shenron-ai-access.sh:45` | Obligatoire |
| `APHRODY_SHENRON_API_TOKEN` | `aphrody-ai-http` | Oui, même fichier ; secret identique à celui du serveur | Obligatoire |
| `RAG_BACKEND` | — (aiguillage) | Non : fichiers opérateur seulement | Obligatoire tant que le chemin local existe ; `aphrody` est la cible |
| `APHRODY_LLM_MODEL` | `aphrody-ai-http` (`llm/chat`) | Non | Optionnelle |
| `APHRODY_SHENRON_EMBED_BASE_URL`, `EMBED_TIMEOUT_MS` | `aphrody-shenron-embed` | Non | À retirer côté client : passer par `/api/v1/shenron/embed`. Base utilisée telle quelle, qui **doit déjà finir par `/v1`** |
| `EMBED_URL` | `aphrody-shenron-embed` | Non | **Pas un simple ancien nom** : c'est une origine, à laquelle `ShenronEmbeddingsClient` ajoute `/v1` (`packages/shenron/pipeline/src/aphrody/shenron-embeddings.ts:29-30`) ; recopier sa valeur dans `APHRODY_SHENRON_EMBED_BASE_URL` perd `/v1`. Encore lue, avec un défaut littéral, par `packages/pipeline/scripts/{rag-status.ts:27, ingest-aphrody-rag.ts:41, rag-resync-entites.ts:42, rag-eval.ts:38, rag-embed-vectors.ts:23, rag-build.ts:31}`, `scripts/{bxc-crawl-massive.ts:111, monitor-shenron-engine.ts:75}`, `scripts/ops/{crawl-doc-links-rag.ts:271, observability-snapshot.ts:110}` : à migrer |
| `RERANK_URL`, `RAG_RERANK`, `RAG_RERANK_POOL` | aucun | Non | À retirer (chemin mort) |
| `LIBRETRANSLATE_URL`, `LIBRETRANSLATE_API_KEY` | aucun | Non | À retirer |
| `RELECTURE_OCR_URL` | aucun | Non | À retirer (remplacée par `/api/v1/shenron/ocr`) |
| `OLLAMA_URL`, `MM_MODEL` | aucun | Non | À retirer (script d'essai) |
| `APHRODY_FFI_LIB`, `APHRODY_REPO` | aucun | Non | À supprimer avec le pont `bun:ffi` |
| `APHRODY_BIN` | — (CLI locale) | Non | Scripts et lots seulement |

### 5.2 Web et rendu (`@shenron/pipeline/aphrody`, `@shenron/pipeline`, `@shenron/ui`)

| Variable | Service du catalogue | Provisionnée par l'infra | Statut |
| --- | --- | --- | --- |
| `APHRODY_WEB_API_URL` | `aphrody-web-api` (publié par Nginx sous `/api/v1/web/*`, ou en loopback) | **Non** pour les unités Shenron | Obligatoire pour le crawl ; retirer le défaut de `web.ts:33` et le test de port littéral de `web.ts:40` |
| `APHRODY_BXC_API_TOKEN` | `aphrody-web-api` (et `aphrody-site` en loopback) | **Non** | Obligatoire pour le crawl |
| `APHRODY_WEB_URL`, `BXC_API_TOKEN` (hors contrat) | `aphrody-web-api` | Non | Doublons lus par `apps/shenron/site/scripts/_aphrody-translate-remote.ts:55-56` (défaut loopback littéral pour le premier) ; à remplacer par `APHRODY_WEB_API_URL` et `APHRODY_BXC_API_TOKEN` |
| Jeton du rendu `POST /api/v1/canvas/render` | `aphrody-site` | Non | Côté serveur, `APHRODY_SITE_WEB_API_TOKEN` accepte l'alias `APHRODY_BXC_API_TOKEN` ; réutilisable par le client (à vérifier) |
| `BXC_BIN`, `BXC_FROM_SOURCE`, `BXC_FRAMES_DB` | aucun | Non | À retirer avec `@shenron/pipeline/bxc` |
| `BXC_RUST_BRIDGE_LIB` | aucun | Non | Lue par `apps/bot/scripts/harvest-kanzenshuu-aphrody.ts:56-67,113`, pas par `@shenron/pipeline/bxc` ; à retirer avec ce script (§1.4) |

### 5.3 `@shenron/api`, `@shenron/db` et les consommateurs de l'API

| Variable | Service du catalogue | Provisionnée par l'infra | Statut |
| --- | --- | --- | --- |
| `API_HOST`, `API_PORT` | `shenron-bot` | Oui, par l'unité systemd | Obligatoires |
| `SHENRON_API_URL`, `SHENRON_SITE_API_URL`, `SHENRON_SITE_URL` | `shenron-bot` / `shenron-site` | Environnement du processus `aphrody-mcp` géré côté opérateur ; vérifier infra | Utilisées par les outils `dragonball.*` |
| `API_ADMIN_TOKEN` / `SHENRON_ADMIN_TOKEN` | `shenron-bot` | Fichiers opérateur | Secret |
| `SHENRON_A2A_TOKEN` | `aphrody-a2a` / hub Shenron | `a2a-peers.json` (nom seulement) | Secret |
| `DATABASE_URL` | `shenron-pg-tunnel` | Fichiers opérateur, réécrits vers le tunnel | Obligatoire |
| `REDIS_URL` | **aucun service catalogué** | Non | Manque (§6.1) ; le bot utilise le Redis local du VPS sans cette variable |

Côté `aphrody-mcp` (`aphrody-ai`) : `SHENRON_API_URL`,
`SHENRON_SITE_API_URL`, `SHENRON_SITE_URL`, `SHENRON_API_ADMIN_TOKEN` et
`SHENRON_DATABOOKS_API_TOKEN`. Aucun secret ne figure dans les configurations
du plugin.

### 5.4 Variables serveur possédées par Aphrody (jamais lues par Shenron)

Fichier d'environnement de `aphrody-ai-http` (mode 0600) :

- `APHRODY_MCP_DATABASE_URL`, `APHRODY_SHENRON_API_TOKEN` ;
- `APHRODY_SHENRON_EMBED_MODEL`, qui doit valoir `Xenova/multilingual-e5-small` ;
- `APHRODY_SHENRON_EMBED_BASE_URL` ;
- `APHRODY_SHENRON_LLM_PROVIDER`, `APHRODY_SHENRON_LLM_BASE_URL`, `APHRODY_SHENRON_LLM_MODEL` ;
- `APHRODY_SHENRON_GEMINI_MODEL`, `APHRODY_SHENRON_GEMINI_COOKIE_FILE` ;
- `APHRODY_SHENRON_VISION_BASE_URL`, `APHRODY_SHENRON_VISION_MODEL`.

Service `aphrody-shenron-embed` : `APHRODY_SHENRON_EMBED_{HOST,PORT,CACHE_DIR,ALLOW_REMOTE}`.

Service `aphrody-web-api` : `BXC_API_TOKEN`, `BXC_DB_PATH`,
`BXC_RUST_BRIDGE_LIB`, `BXC_RENDER_LIB`.

Service `aphrody-site` : `APHRODY_SITE_WEB_UPSTREAM`,
`APHRODY_SITE_WEB_BACKEND_TOKEN`.

---

## 6. Manques et prochaines étapes

### 6.1 Côté Aphrody (`aphrody`, `aphrody-os`, Infra du monorepo)

**P0 : débloquer la bascule `RAG_BACKEND=aphrody`**

1. **Publier une release de `aphrody-ai-http` alignée sur le code** : route
   `rag/stats`, recherche hybride, câblage Gemini. Ajouter un pool de
   connexions PostgreSQL à la place du `connect_db()` ouvert à chaque requête
   (`aphrody/crates/aphrody-mcp/src/http_rest.rs:1570-1581`), cause probable
   des 503 pendant les rafales d'`AutoEvalCron`.
2. **Activer les embeddings E5** : restaurer le cache de modèle épinglé
   (`APHRODY_SHENRON_EMBED_CACHE_DIR`, vide le 2026-09-23) et sortir
   `aphrody-shenron-embed` du mode staged. Ajouter au démarrage le contrôle des
   SHA256 déjà consignés (`apps/shenron-embed/README.md:19-23` (not in repo)) et épingler une
   révision du modèle : aujourd'hui rien n'est vérifié (`src/index.ts:5-16`).
   Puis porter le service en Rust (`OrtEmbedder`), sous condition de parité
   cosinus ; `aphrody-rag/tests/trained_onnx_smoke.rs` vérifie déjà le
   chargement d'un ONNX d'embedding entraîné par `OrtEmbedder`.
3. **Cataloguer un backend LLM** : `llama-server` géré par
   `aphrody-llama-server`, ou l'adaptateur Antigravity sans clé. Exposer
   `/v1/chat/completions` en streaming et `/v1/models` sur `aphrody-ai-http`
   derrière le même jeton. Aujourd'hui, le repli non Gemini (`llm_url()`,
   `http_rest.rs:1208-1213`) et le repli du proxy `embed` quand ni
   `APHRODY_SHENRON_EMBED_BASE_URL` ni `APHRODY_SHENRON_LLM_BASE_URL` n'est
   défini (`http_rest.rs:1055-1057`) pointent vers un port en dur qui ne
   correspond à aucun service du catalogue.
4. **Rendre `/api/v1/shenron/health` fidèle** : la réponse ne porte que `rag`,
   `llm` et `ocr` (`http_rest.rs:204-207`). `llm` est déjà une sonde réelle
   (amorçage de la session Gemini Web en mode `gemini-web`, sinon
   `GET <base LLM>/models`, `:176-190`). `ocr` reste un drapeau de compilation
   (`cfg!(feature = "ocr")`) : le remplacer par la présence du modèle.
   Ajouter une capacité `embed` (ou `hybrid`) qui sonde l'embedder.
5. **Protéger `/mcp`** : exiger le jeton pour `aphrody_shenron_rag_ingest` et
   `aphrody_shenron_llm_chat` (`http_rest.rs:1791`).

**P1 : couvrir les opérations lourdes restantes**

6. Brancher le reranker (`bge-reranker-v2-m3` ou `bge-reranker-base`) dans
   `shenron_rag_search_core` et renvoyer `mode='hybrid+rerank'`.
7. Compléter le **contrat d'environnement dans Infra du monorepo** : ajouter au
   schéma `CatalogService` un champ d'environnement, et provisionner
   `APHRODY_WEB_API_URL`, `APHRODY_BXC_API_TOKEN` et `RAG_BACKEND` pour
   `shenron-site` et `shenron-bot`.
8. **Plafonner les ressources** (`MemoryHigh`, `MemoryMax`, `CPUWeight`) de
   `aphrody-ai-http` et `aphrody-shenron-embed`, sur le modèle de
   `nie-model-serve`. Pas de plafond serré pour `shenron-bot` : son unité a
   déjà `MemoryLow=384M`, `CPUWeight=200`, `IOWeight=200`,
   `OOMScoreAdjust=-500`, et documente pourquoi elle n'a pas de plafond
   mémoire (gel de la boucle d'événements par le reclaim cgroup,
   `yolo/config/host/systemd/shenron/shenron-bot.service:47-54`). Le bon correctif pour le bot est de
   sortir le rendu Skia du processus (ligne « Cartes Discord » du §4).
9. **Créer un service Rust de transformation et d'analyse d'image** dans
   `aphrody-os` : redimensionnement, WebP/AVIF, dHash, PSNR, mesure de trait.
   Briques déjà déclarées : `image` 0.25 (les deux espaces de travail),
   `resvg` 0.45 et `tiny-skia` 0.11 (`aphrody-os/Cargo.toml:321-322`),
   `fast_image_resize` 6.1 et `imageproc` 0.27 (`aphrody/Cargo.toml:301,304`,
   déclarés à l'espace de travail pour le prétraitement OCR mais consommés par
   aucun crate aujourd'hui ; `aphrody-ocr-onnx` n'utilise que `image`). Il serait
   exposé par `aphrody-site` sur le modèle des limites de `canvas_api.rs` et
   déclaré au catalogue. Sans lui, sharp reste en place.
10. **Publier `@aphrody/canvas` 1.0.9-aphrody.x** avec une vraie dépendance
    sur `@napi-rs/canvas` et les binaires win32-x64-msvc et linux-x64-gnu.
    Accorder `.gitmodules:10-12` (`rose-griffon/canvas`) avec
    `design/aphrody-m3/docs/reference/CANVAS-UPSTREAM.md` (Brooooooklyn).
11. **Assainir npm** : republier ou déprécier les paquets qui contiennent
    `catalog:`/`workspace:` ; aligner M3 sur 3.3.0 ; corriger
    `design/aphrody-m3/docs/reference/PUBLISHING.md:34`, qui annonce `@aphrody/bun` comme publié.
12. **Traduction** : ajouter un mode JSON à `aphrody translate` (aujourd'hui
    sortie humaine seulement, `crates/infra/aphrody-command/src/lib.rs:378-394`) et une route
    `/api/v1/shenron/translate` (`aphrody-translate` ou le LLM). Le glossaire
    doit venir de Shenron : `crates/ai/translate/src/shenron.rs:283`
    (`default_canon_lexique()`) duplique en dur le lexique canonique Shenron.
13. **Aphrody Web** :
    - publier la correction d'indexation (`chunks=0`) ;
    - persister l'état des jobs ;
    - réconcilier l'exposition publique : Nginx publie **toutes** les routes BXC
      sous `/api/v1/web/*` (`aphrody-apex.conf:105-114`, `nginx-routes.json:22`),
      en contournant la liste blanche et la limite de 1 Mio d'`aphrody-site`,
      alors que `service-catalog.json:26` annonce `publicProxy: "aphrody-site"`.
      Soit pointer Nginx vers `aphrody-site` (et y ajouter les routes voulues,
      dont `/page/markdown` et `/search/semantic`), soit assumer la surface
      BXC complète (`recon`, `fut/*`, `crawl/replay`…) et corriger le catalogue ;
    - ajouter une route `rag/web-ingest` vers le corpus Shenron, en réutilisant
      `aphrody_rag::ingest_web_document` (`aphrody-rag/src/postgres.rs:54`) ;
    - exposer les frames (`bxc frames`) en HTTP ou MCP : aucune surface n'existe.
14. **Étendre `aphrody-render`** avant d'y migrer les cartes : texte
    multiligne et CJK, dégradés, 1200 × 630, images compactes, types TS
    générés au lieu d'être écrits à la main.
15. **Compiler en production** les features `vision`, `jobs`, `stt-local` et
    `dbfr` d'`aphrody-mcp` si leurs outils doivent servir Shenron
    (`build-aphrody-stack-release.sh:50`, qui garde déjà `native-browser` par
    défaut). Le binaire `aphrody` y est compilé sans features
    (`apps/cli/Cargo.toml:21`) : pas de `aphrody ocr`, `infer`, `job`,
    `rag` ni `firefly` sur le VPS.

**P2 : cohérence**

16. Créer l'adaptateur de déploiement Shenron dans Infra du monorepo
    (`DeployStack`, PLAN P1 #9).
17. Réconcilier les états contradictoires :
    - `SHENRON-MIGRATION.md:117-121`, `docs/PLAN.md:39` (not in repo) et `config/infra/inventory/vps-unit-catalog.json:4` ne décrivent pas le même état ;
    - `docs/PLAN.md:37,221` attribue à `aphrody-shenron-embed` le port de `nie-model-serve` ;
    - `policies.sharedReleasePointer` (`service-catalog.json:215`) désigne la racine RG alors que `policies.applicationRoots.shenron` (`:220`) donne à Shenron sa propre racine, et `application-contracts.json:13` qualifie Shenron d'`application-namespace-on-rg-plane` ;
    - `aphrody-web-api` : `publicProxy: "aphrody-site"` au catalogue (`service-catalog.json:26`) contre une route Nginx directe (`nginx-routes.json:22`).
18. Documentation à corriger :
    - `aphrody-ai/plugins/aphrody/skills/aphrody-rag/SKILL.md:25,27` décrit `aphrody rag eval|serve`, qui n'existent pas ;
    - `aphrody/docs/RAG.md:26` indique POST au lieu de GET ;
    - `aphrody-mcp/README.md` dit encore « lexical seulement » ;
    - `aphrody-os/docs/WEB-RUNTIME.md` cite des ports littéraux.
19. Retirer les ports par défaut en dur de `aphrody gateway serve`
    (`gateway_cmd.rs:20`), de `aphrody app-server --http` (`lib.rs:290`) et de
    `aphrody session serve --http` (`lib.rs:884`).
20. **Historique clos le 2026-09-26 :** l'ancien `apps/shenron-mcp` (not in repo) a été
    supprimé et ses outils Dragon Ball ont convergé vers `aphrody-mcp`.
    Vérifier par `tools/list` et le catalogue infra avant toute affirmation de
    déploiement ; ne pas réactiver l'ancien service.
21. Débloquer la promotion de l'entraînement (P10) et raccorder
    `aphrody-web-embed` ou le supprimer.

### 6.2 Côté Shenron

**P0**

1. **Consolider la surface IA** dans `@shenron/pipeline/ai/*` (livrée dans `packages/shenron/pipeline/src/ai`) :
   - y déplacer `AphrodyComputeClient` et `ShenronEmbeddingsClient` ;
   - appliquer le contrat du §5 ;
   - supprimer tous les défauts d'URL : `packages/shenron/pipeline/src/aphrody/compute.ts:65`,
     `shenron-embeddings.ts:30`, `web.ts:33,40`,
     `packages/pipeline/scripts/lib/aphrody-web-scrape.ts:24,30`,
     `packages/shenron/pipeline/src/aphrody/index.ts:203`,
     `packages/pipeline/scripts/_aphrody-remote-ocr.ts:24` (not in repo),
     `apps/site/src/app/api/databooks/[id]/relecture-ocr/route.ts:39`,
     `apps/shenron/site/scripts/_aphrody-translate-remote.ts:54-55` (chemin absolu du
     binaire `aphrody` et URL loopback par défaut),
     `apps/shenron/site/src/lib/ia-cockpit.ts:550` (origine publique par défaut),
     `apps/shenron/bot/scripts/test-gemma-multimodal.ts:18`, et les défauts
     d'`EMBED_URL` listés au §5.1 ;
   - supprimer aussi les défauts de `REDIS_URL`.
2. **Supprimer le pont `bun:ffi`** (`packages/pipeline/src/aphrody/index.ts:10,59-72`)
   et `searchMemory` (`:239`), au profit du lancement de la CLI. En attendant,
   sortir `compute`, `shenron-embeddings` et `web` du barrel qui importe
   `bun:ffi` (`:307-312`), pour que le bot ne charge plus ce module. Retirer
   aussi l'exigence du pont Rust de BXC de
   `apps/shenron/bot/scripts/harvest-kanzenshuu-aphrody.ts:56-67` (passer par
   l'HTTP `aphrody-web-api`).
3. **OCR** :
   - rendre `engine` paramétrable, avec `ppocr` par défaut (`compute.ts:111`) ;
   - fusionner le client de `_aphrody-remote-ocr.ts` dans `@shenron/pipeline/ai` ;
   - ne plus se fier à `health().ocr` seul (`apps/bot/src/services/TranslateService.ts:152,319`).
4. **Canvas** : dans le catalogue, `"@aphrody/canvas": "npm:@napi-rs/canvas@1.0.9"`
   (`package.json:49`). Vérifier les cartes sous Windows et Linux, puis
   retirer le mock de `apps/shenron/bot/src/lib/preload.ts`.

**P1**

5. Corriger ou retirer `packages/shenron/pipeline/scripts/rag-build.ts:25` et
   `rag-embed-vectors.ts:19` (import inexistant). En mode Aphrody, seul
   `rag-sync-aphrody.ts` doit écrire.
6. Retirer `rerankRemote()`/`RERANK_URL`, `apps/bot/src/lib/embeddings.ts` (not in repo)
   (transformers.js), NLLB local, LibreTranslate et les traces tesseract.
7. Supprimer l'inversion de couches `packages/shenron/pipeline/src/aphrody/a2a.ts:22`
   (import depuis `apps/shenron/bot`), puis arbitrer le propriétaire unique de l'A2A.
8. `@shenron/pipeline/bxc` :
   - retirer les chemins absolus (`src/spawn.ts:47-55`) ;
   - migrer le crawl vers `AphrodyWebClient`, complété par `extract()` et `page()` ;
   - ne garder la CLI `bxc` que pour les scrapers spécialisés tant qu'ils n'ont pas d'HTTP.
9. **Clos (2026-09-28)** : retirer `packages/voiranime` (not in repo) et son mapper dédié ;
   utiliser le scraper BXC et installer BXC depuis le registre après la
   stabilisation d'Aphrody Web.
10. **Clos / remplacé (2026-09-26)** : les outils `dragonball.*` d'`aphrody-mcp` consomment les routes du bot/site ; aucun second MCP n'est à déployer.
11. Mettre à jour `INFRA-DELEGATION.md` :
    - retirer `shenron-zswap.service`, retiré du catalogue ;
    - retirer les vhosts `shenron-api` ;
    - supprimer le port d'embedder cité en dur ;
    - ajouter les dépendances `shenron-pg-tunnel`, `aphrody-ai-http`,
      `aphrody-shenron-embed` et `shenron-compute-client.env`.

**Gate de réactivation de `RAG_BACKEND=aphrody`.** Toutes ces conditions
doivent être remplies :

- la release active répond à `rag/stats` ;
- `health` renvoie `rag=true` et `llm=true` ;
- la recherche renvoie `mode` = `hybrid` ;
- sur `apps/shenron/bot/tests/rag-gold.jsonl`, le Recall@5 d'Aphrody atteint le seuil :
  soit `scripts/tools/shenron/scripts/ops/eval-aphrody-rag.ts` (Bearer via `AphrodyComputeClient`,
  seuil `RAG_CI_RECALL5_MIN`), soit
  `aphrody-rag-eval --target mcp --mcp-tool aphrody_shenron_rag_search` contre
  le `/mcp` d'`aphrody-ai-http`, seuil passé par `--gates`
  (`RAG_CI_RECALL5_MIN` n'est lue que par les scripts Shenron). Pas
  `--target http` : il n'envoie pas de jeton et vise par défaut l'API du bot ;
- aucun 503 sous la charge d'`AutoEvalCron`.

Sinon, la bascule reste `NON_FAIT`.

---

## Sources

- `aphrody/crates/aphrody-mcp/src/http_rest.rs` (routeur, RAG, LLM, embed, OCR, `connect_db`), `shenron_vector.rs`, `shenron_gemini_web.rs`, `main.rs`, `bxc_tools.rs`, `README.md`
- `aphrody/apps/shenron-embed/{src/index.ts,README.md,package.json}`, `aphrody/apps/shenron-mcp/{README.md,src/*.ts}`
- `aphrody/crates/{aphrody-rag, aphrody-rag-core, aphrody-rag-eval, aphrody-llama-server, aphrody-models/catalog.json, aphrody-ocr*, aphrody-vision, aphrody-voice, aphrody-app-server, aphrody-a2a-*, aphrody-train, aphrody-gateway, aphrody-providers, aphrody-memory, aphrody-jev, aphrody-ffi}`, `aphrody/crates/{aphrody-firefly, aphrody-google}`, `aphrody/crates/aphrody-rag/src/postgres.rs`, `aphrody/crates/aphrody/{Cargo.toml, src/lib.rs, src/commands.rs, src/rag_cmd.rs, src/ocr_cmd.rs, src/ocr_shenron.rs, src/train_cmd.rs}`, `aphrody/docs/{PLAN.md, RAG.md, training.md, CLI.md}`
- `aphrody-os/crates/{aphrody-render, aphrody-site (canvas_api.rs, web_api.rs, web_auth.rs, gateway.rs, assets_api.rs, main.rs), aphrody-bun, aphrody-obscura, aphrody-web-engine, aphrody-web-embed, aphrody-web-ffi, aphrody-web-render, aphrody-translate (shenron.rs), aphrody-winclean}`, `aphrody-os/packages/{canvas, bun, m3-next, m3, os}`, `aphrody-os/apps/bxc` (`server/app.ts`, `mcp/server.ts`, `cli/{index,dragonball,frames}.ts`, `sources/`, `archive/`), `aphrody-os/docs/{PUBLISHING.md, CANVAS-UPSTREAM.md, WEB-RUNTIME.md}`, `aphrody-os/.gitmodules`
- `config/{service-catalog.json, nginx-routes.json, production-topology.json, scheduler-policy.json, a2a-peers.json, pipeline.json, live-audit.json, application-contracts.json, google-gemini-pipeline.json}`, `yolo/config/host/nginx/aphrody/aphrody-apex.conf`, `systemd/{aphrody-ai-http, aphrody-shenron-embed, aphrody-web-api}.service.example`, `shenron-{site,bot,mcp,pg-tunnel,backup}.service`, `scripts/{build-aphrody-stack-release.sh, atomic-deploy-aphrody-stack.sh, atomic-deploy-rg.sh, ops/provision-shenron-ai-access.sh}`, `crates/infra/infra/src/{catalog.rs, validate.rs}`, `docs/{PLAN.md, SHENRON-MIGRATION.md, PRODUCTION-ALLOCATION.md}`
- `shenron/packages/pipeline/src/aphrody/{compute.ts, shenron-embeddings.ts, web.ts, index.ts, a2a.ts}`, `shenron/packages/{ai, api, ui, images, pipeline, bxc-bridge}`, `shenron/apps/bot/src/lib/{rag.ts, llm.ts, preload.ts, canvas-kit.ts}`, `shenron/apps/bot/src/api/server.ts`, `shenron/apps/site/src/lib/site-rag.ts`, `shenron/apps/site/scripts/_aphrody-translate-remote.ts`, `shenron/apps/bot/scripts/harvest-kanzenshuu-aphrody.ts`, `shenron/scripts/ops/eval-aphrody-rag.ts`, `shenron/packages/pipeline/scripts/{rag-eval.ts, _aphrody-remote-ocr.ts}`, `shenron/package.json`, `shenron/docs/{APHRODY-OFFLOAD.md, INFRA-DELEGATION.md}`
- Registre npm (manifestes `@aphrody/*`, `@napi-rs/canvas` 1.0.9) et essais `bun install` sous Bun 1.4.2 / win32, 2026-09-24
