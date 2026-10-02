# RAG — enrichissement du corpus & reconstruction sans coupure

Le RAG hybride (BM25 `rag_chunks` FTS5 + embeddings denses `vec_chunks` vec0, fusion
RRF + rerank) sert la recherche du site, `/ask`, le Discord `/ask` et l'assistant.
Pipeline runtime : `apps/shenron/bot/src/lib/rag.ts` (cf. **Exploitation** ci-dessous pour le
scoring/dédup/filtrage). Build : `packages/shenron/pipeline/scripts/rag-build.ts`.

## Exploitation (runtime — `apps/shenron/bot/src/lib/rag.ts`)

- **Score normalisé** : chaque `RagHit` porte un `score` ∈ [0,1]. En `hybrid+rerank` =
  sigmoïde du logit du cross-encoder ; en `hybrid`/`lexical` = min-max planché à 0.4.
  Le score est **sémantique par mode** et **comparable uniquement au sein d'une même
  réponse et d'un même `mode`** — pas de seuil absolu cross-requêtes.
- **Déduplication / diversification** du top-N par **URL canonique**, puis repli sur le
  **titre foldé** (les chunks `kind=source` ont souvent une `url` vide). Le
  **manga est exempté** (clé par rowid) pour préserver le quota manga ≥2.
- **Stopwords + fold d'accents** : `ftsMatch` retire les stopwords FR/EN et fold les
  accents avant la requête FTS5 (l'index est `remove_diacritics 2` → fold sûr).
  Garde-fou : on ne filtre que si la requête fait >3 tokens **et** qu'il en reste ≥2.
- **Snippet de repli centré** sur le 1er terme de la requête.
- Propagation : `/api/public/rag/search` remonte `score` ; `/api/public/rag/chat` a reçu
  CORS + rate-limit ; GraphQL `RagHit` expose `rowid` + `score` ; MCP `rag_search` gagne
  les filtres `lang`/`entity`/`sourceId` + `score` (et `rag_ask` se fie aux `hits`
  sourcés, le rédacteur LLM étant OFF) ; Discord `/ask` affiche citations `[n]` + mode +
  % de pertinence ; site = puces de pertinence + îlot `WikiRagArchives` sur la page saga.
- Tests : `apps/shenron/bot/tests/rag-filter.test.ts` (score ∈ [0,1], dédup URL, dédup
  titre-vide, manga non-fusionné, tolérance stopwords).

## Corpus PostgreSQL (source de vérité) — `packages/shenron/pipeline/scripts/_rag-sources-pg.ts`

Depuis le 2026-09-14, toutes les sources éditoriales sont rendues **depuis
PostgreSQL** (le réplica SQLite n'a ni `article`, ni sections de fiches, ni
`visible` sur les personnages). Un registre unique `PG_SOURCES` sert au build
complet (`rag-build.ts`) comme à la resynchronisation à chaud
(`rag-resync-entites.ts`, lancée chaque nuit par `orchestre-donnees.ts --toutes`).

| `source_id` | `kind` | URL citée |
|---|---|---|
| `db_characters` | `character` (fiche + article) | `/wiki/personnages/<slug>` |
| `db_wiki_sections` | `character_section`, `power_profile` (9 rubriques regroupées) | `/wiki/personnages/<slug>#<clé>` |
| `db_character_variants` | `character_variant` | `/wiki/personnages/<slug>#sagas` |
| `db_techniques` (+ utilisateurs via `db_character_techniques`), `db_transformations`, `db_planets`, `db_races`, `db_sagas`, `db_arcs` | fiche + article | route canonique (slug) |
| `db_movies`, `db_games`, `db_episodes` (`synopsis_fr` d'abord), `db_manga_volumes`, `db_manga_chapters`, `db_tools` | idem | idem |
| `db_battles`, `db_items`, `db_dragons`, `db_wishes`, `db_timeline_events`, `db_power_levels`, `db_locations`, `db_tournaments`, `db_voice_actors`, `db_soundtracks` | `battle`, `item`, `dragon`, `wish`, `timeline_event`, `power_level`, `location`, `tournament`, `voice_actor`, `soundtrack` | `/wiki/combats/<slug>`, `/wiki/objets/<slug>`, `/wiki/dragons#…`, `/wiki/chronologie#evenement-<id>`, `/wiki/puissances#niveau-<id>`, `/wiki/lieux/<slug>`, `/wiki/tournois/<slug>`, `/wiki/voix/<slug>`, `/wiki/musiques#<slug>` |
| `canon_references` | `canon` (provenance + texte FR + original) | `href` ou `/wiki/canon#<id>` |
| `wiki_pages` | `article` | `/wiki/<slug>` |
| `manga` | `manga_page` — **une planche = un passage**, bruit OCR/filigranes retiré | `/wiki/manga/<chapitre>?planche=<rang>` |
| `databooks` | `databook` (JA + traduction, planches fautives exclues) | `https://dragonballfr.com/wiki/databooks/<id>#planche-<n>` |

Règles : lignes `visible` seulement, fiches doublons (`CHARACTER_DUPLICATE_REDIRECTS`)
exclues, URL = route canonique réelle du site. Ajouter une table = une fonction de
rendu + une entrée du registre + son `kind` dans `truthWeight` (`lib/rag.ts`).

### Embedding en masse sans pénaliser la production

Le sidecar `:5007` sert aussi la recherche du site. Pour une resynchronisation
volumineuse, lancer des sidecars temporaires dédiés (même code, `nice`) et pointer
`APHRODY_AI_EMBED_BASE_URL` dessus (forme base, `…/v1` ; l'alias `EMBED_URL` reste lu) :

```bash
cd apps/bot
EMBED_PORT=5017 TRANSFORMERS_CACHE=$PWD/.models nice -n 10 bun embed-server.ts &
APHRODY_AI_EMBED_BASE_URL=http://127.0.0.1:5017/v1 bun scripts/rag-resync-entites.ts manga --appliquer
```

> **MANQUANT** : `apps/bot/embed-server.ts` (not in repo) a été supprimé en `5b031301`
> (unification de l'offload dans `@shenron/pipeline`) et n'a pas été
> restauré. Vérifier sa présence avant de rejouer cette commande.

Débit mesuré le 2026-09-14 (CPU partagé avec l'OCR) : ≈1 passage long/s par
sidecar ; ne pas en lancer plus de deux sur 6 cœurs (onnxruntime-node ouvre déjà
un pool de threads par processus).

## Évaluation v2 — `apps/shenron/bot/tests/rag-gold.jsonl`, `src/lib/rag-eval.ts`

Un cas vise la **source** (`expectUrl`, préfixe d'URL, ancres comprises) ou, quand
l'URL du site n'est pas fiable, le **titre** (`expectTitle`) ; `expect` (sous-chaîne
du titre/extrait) reste accepté mais ne distingue pas « la fiche de Freezer » d'un
passage qui prononce « Freezer ». Chaque cas porte des `tags` (corpus, langue).

```bash
bun apps/bot/scripts/rag-eval.ts --validate --details   # sources absentes + cas hors top-3
bun apps/bot/scripts/rag-eval.ts --lexical-only          # baseline BM25 seule
bun apps/bot/scripts/rag-eval.ts --tag=ja                # une rubrique
RAG_QUERY_EXPANSION=0 bun apps/bot/scripts/rag-eval.ts   # mesure sans expansion
```

Deux passes : `lexical` (BM25) et `servie` (pipeline de production) ; ventilation
par tag, latences p50/p95, rapport JSON (`--json=`) et Redis (`dbz:eval:report:rag`).
`TrainingService.evaluateRag` (`/train eval`) utilise la même bibliothèque.

## Contexte d'ancrage — `GET /api/public/rag/context`

Mêmes passages que `/rag/search`, en **texte intégral**, numérotés `[n]`, URL
absolues, dans un budget `maxChars` (500–16 000). Outil MCP `rag_context`. Filtres
communs à `/rag/search`, `/rag/chat`, GraphQL `ragSearch` et MCP : `lang`, `entity`,
`sourceId`, `kind`. Chaque hit expose désormais `sourceId` et `lang`.

## Expansion des requêtes — `packages/shenron/pipeline/scripts/rag-lexique.ts`

`data/rag/lexique-requetes.json` (not in repo) regroupe les graphies équivalentes d'une entité
(nom FR, japonais, romaji, localisations anglaises : Freezer/Frieza/フリーザ). Quand
une forme apparaît dans la question, les autres forment un **second classement
BM25** fusionné avec un poids `RAG_EXPANSION_WEIGHT` (0,5 ; 1 pour une question en
japonais). Le volet dense et le rerank gardent la question d'origine. Régénéré
chaque nuit par l'orchestration ; lu au démarrage du bot (`RAG_QUERY_EXPANSION=0`
pour désactiver).

## Tables (dans `apps/shenron/bot/data/bot.db`)

- `rag_chunks` — FTS5 (`kind, title, url, content, lang, source_id, entity`).
- `vec_chunks` — vec0 (`embedding float[384]`), aligné par **rowid** sur `rag_chunks`.
- `rag_meta` — (`model, dim, count, built_at`).

`rag-build.ts` lit la base (`RAG_DB` env, défaut `bot.db`) pour les entités
structurées **+** `data/rag/corpus.json` (not in repo) (full-text scrapé), chunke (sémantique,
~1400 chars, overlap 15 %), et **embed via le sidecar `:5007`** (`shenron-embed`,
`sqliteVec.load(db)`).

## Corpus (`apps/bot/data/rag/corpus.json` (not in repo))

Format `{generatedAt, count, docs:[{id, name, url, markdown}]}`. État après la purge Fandom du 2026-09-10 : **403 docs** dans `corpus.json`, plus le
**manga OCR (147 tomes)**, les **2058 docs Xenoverse 2** et les **11 079 planches de
databooks** et le **corpus d'auteur `.aphrody` (80 chunks)** → **31 698 chunks
indexés** (la phase d'embedding de `rag:build` dure désormais ~15 min).

### Sources de full-text & crawlers

> ⚠️ **Fandom a été retiré du corpus le 2026-09-10** (source interdite,
> cf. `CLAUDE.md`) : 8 118 docs et ~29 300 chunks supprimés, crawler
> `crawl-fandom-rag.ts` effacé, et `rag-build.ts` refuse désormais à
> l'indexation tout document dont l'id ou l'URL vient de `fandom.com`.
- **Kanzenshuu** (`crawl-kanzenshuu-rag.ts`) — databooks officiels (Daizenshuu,
  Chōzenshū…). BFS scopé `/databook/…`, extraction `<main id="content">`. ~342 docs.
- **Databooks traduits** (`crawl-databooks-rag.ts`) — Kanzentai (archives **Wayback**),
  forums Neoseeker (**via Wayback** car blocage direct 403), Toei officiel, fredcrash.
  ~28 docs.

### Corpus d'auteur `.aphrody` (`ingest-aphrody-rag.ts`)

Les déclarations d'Akira Toriyama et les guides Shueisha traduits par
Kanzenshuu vivent hors du dépôt, dans `~/.aphrody/workspace/memory`. Le site en
tirait déjà les citations de `/wiki/canon` ; le RAG ne les voyait pas.

```bash
bun apps/bot/scripts/ingest-aphrody-rag.ts            # corpus + rapport (simulation)
bun apps/bot/scripts/ingest-aphrody-rag.ts --injecte  # écriture à chaud
```

La liste des documents admis n'est PAS redéfinie côté bot : elle est importée de
`apps/shenron/site/scripts/_aphrody-corpus.ts` (`DOCUMENTS`, `REFUSÉ`), pour que la règle
« ni wiki de fans, ni forum » soit écrite une seule fois.

`--injecte` écrit directement dans `rag_chunks` (`kind='author'`,
`source_id='aphrody'`) **sans DDL** et n'embarque que les nouveaux chunks dans
`vec_chunks` : le bot n'est pas arrêté et les 31 618 voisins gardent leurs
vecteurs. Idempotent — la passe purge d'abord `source_id='aphrody'`.

### Fusion

`merge-corpus.ts shard-*.json …` — dédupe par `id` (le markdown le plus long gagne),
garde les docs sans équivalent, **backup `corpus.json.bak`**.

## Reconstruction SANS coupure de recherche

> **Ne JAMAIS rebuild sur la base live** : `rag-build` `DROP TABLE rag_chunks` puis
> embed (~15 min) → la recherche casse pendant le build, et le DDL `DROP` gèle les
> handlers `Bun.serve`. Ne jamais le lancer au premier plan, ni en arrêtant le bot
> (downtime), ni en live. Si seuls les vecteurs sont à recalculer, préférer
> `rag-embed-vectors.ts` (ci-dessous), sans downtime.

Procédure copy-swap :

```bash
# 1. Reverse-sync d'abord (la copie doit avoir la data structurée à jour)
sudo systemctl start shenron-neon-pull.service

# 2. Build sur une COPIE (le bot continue de servir l'ancien index)
sqlite3 apps/bot/data/bot.db ".backup /tmp/ragbuild.db"
RAG_DB=/tmp/ragbuild.db bun apps/bot/scripts/rag-build.ts   # ~45-90 min

# 3. Swap atomique (bot arrêté ~1-2 min) — préserve les rowid
sudo systemctl stop shenron
bun apps/bot/scripts/swap-rag-tables.ts        # ATTACH copie → remplace rag_chunks/vec_chunks/rag_meta
sudo systemctl start shenron
```

`swap-rag-tables.ts` charge sqlite-vec, recrée les tables FTS5/vec0 et copie les
lignes en préservant le **rowid** (alignement chunk↔vecteur). Source = `$RAG_COPY`
(défaut `/tmp/ragbuild.db`).

### Rebuild des vecteurs seuls (sans downtime)

`packages/shenron/pipeline/scripts/rag-embed-vectors.ts` (re)calcule **uniquement `vec_chunks`** depuis un
`rag_chunks` déjà bon, **sans arrêter le bot** : l'embedding ne fait que des appels HTTP
au sidecar (aucun verrou d'écriture), et l'insertion finale est **atomique** ⇒ bascule
nette `lexical`→`hybride`. À utiliser après un correctif data (`fix-*`) ou un `rag:build`
interrompu, plutôt que le copy-swap complet.

## Vérification

```bash
curl -s "https://bot.dragonballfr.com/api/public/rag/search?q=daizenshuu&limit=3"  # mode hybrid+rerank
sqlite3 apps/bot/data/bot.db "SELECT count(*) FROM rag_chunks"                       # ≈ 40874
```

## Pièges

- **`~/.gemini` manquant casse le boot du bot** (`226/NAMESPACE`) — l'unit
  l'unité `shenron-bot` le référence dans `ReadWritePaths` ; s'il a été supprimé (nettoyage
  disque), `mkdir -p ~/.gemini` avant restart.
- **bxc** : le binaire compilé plante sur les commandes navigateur (`awaitPromise`) ;
  le `bxc` global route vers la source. Cf. [`docs/bxc.md` (not in repo)](#) / mémoire.
- **Fuite d'infobox (ancien ingest de wiki de fans)** : il pouvait faire fuiter des paramètres d'infobox
  dans des champs de `bot.db_characters` (`name_ja`, `name_romaji`, `race`,
  `affiliation`, ex. `race = "Giras|Concepteur=…}}"`) — donc dans le corpus structuré
  lu par `rag-build`. La root cause a été corrigée à l'époque dans l'ingest (depuis
  supprimé) ; data déjà polluée nettoyée par
  `apps/shenron/bot/scripts/fix-infobox-leak.ts` (idempotent, 306 cellules, sur le Postgres `bot.*`
  source de vérité → propagé au SQLite par le reverse-sync). Re-propager au RAG via
  `rag-embed-vectors.ts` (ou un rebuild si le texte des chunks a changé).
