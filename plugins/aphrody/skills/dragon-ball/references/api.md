# API REST publique dragonballfr.com — catalogue complet

> **S'applique quand :** `https://bot.dragonballfr.com` et `https://dragonballfr.com` sont joignables (réseau sortant). **Sinon :** n'invente aucune réponse ; dis que la source n'est pas joignable et laisse vide ce qui n'est pas établi. Routes sondées le 2026-10-01 (HTTP 200 sauf mention) ; l'OpenAPI courant (`/api/openapi.json`) ne décrit qu'une partie de ces routes, à revérifier avant de s'y fier.

Base : `https://bot.dragonballfr.com` · préfixe : `/api/public` · **lecture seule,
sans authentification**, CORS ouvert. Réponses JSON (sauf images PNG). Spec
machine : `GET /api/openapi.json` ; UI : `https://bot.dragonballfr.com/api/docs`.

## Sommaire

- [RAG (recherche / réponse)](#rag)
- [Wiki — listes et fiches](#wiki)
- [Manga](#manga)
- [Canon (arbitre de canonicité)](#canon-arbitre-de-canonicité)
- [Bot & communauté](#bot--communauté)
- [Divers (news, sources, profils, eval)](#divers)
- [Champs des entités](#champs-des-entités)

---

## RAG

| Méthode & chemin                 | Paramètres                                                                                    | Renvoie                            |
| -------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------- |
| `GET /api/public/rag/search`     | `q` (requis, ≥2 car.), `limit` (1–25, déf. 8), `lang`, `entity`, `sourceId`, `kind`, `lexicalOnly` | `{ q, mode, results: RagHit[] }`   |
| `GET /api/public/rag/context`    | `q` (requis), `limit` (1–12, déf. 6), `maxChars` (500–16000, déf. 6000), `lang`, `entity`, `sourceId`, `kind` | `{ q, mode, context, sources[] }` — passages intégraux numérotés `[n]`, URL absolues |
| `GET\|POST /api/public/rag/chat` | `q`, `persona` (déf. `whis`), `lang`, `entity`, `sourceId` — en query-string **ou** body JSON | `{ answer, hits: RagHit[], mode }` |

`mode` ∈ `hybrid+rerank | hybrid | lexical` (dégradation gracieuse si le sidecar
sémantique est indisponible). `RagHit` = `{ kind, title, url, snippet }`.

```bash
curl -s "https://bot.dragonballfr.com/api/public/rag/search?q=comment+Goku+devient+super+saiyan&limit=5" | jq
curl -s -X POST "https://bot.dragonballfr.com/api/public/rag/chat" \
  -H 'content-type: application/json' -d '{"q":"qui est Vegeta ?"}' | jq '.hits'
```

> `rag/chat` renvoie aussi un champ `answer`, rédigé par le LLM à partir des
> `hits` (backend choisi par `RAG_BACKEND` côté bot). Si le LLM est
> indisponible, la route répond avec `error: "llm_unavailable"` (code dans
> `apps/shenron/bot/src/api/server.ts`) : un texte de repli n'est jamais servi
> en 200. Le 2026-10-01, `GET /api/public/rag/search` répondait
> `{"results":[],"error":"index_unavailable"}` et `GET .../rag/chat` un 500 :
> lis toujours `error` avant de conclure à une absence de résultat. Dans tous les cas, `hits` et leurs URLs
> sont les éléments à contrôler et citer.

## Wiki

Recherche plein-texte transverse : `GET /api/public/wiki/search?q=...&limit=` (1–50, déf. 20).

Le registre des catégories (21 le 2026-10-01 : characters, planets, races,
techniques, transformations, sagas, arcs, episodes, movies, games, tools,
battles, items, dragons, wishes, locations, tournaments, voice_actors,
soundtracks, power_levels, timeline_events) est servi par
`GET /api/public/wiki/categories` ; le tableau ci-dessous ne liste que les
routes historiques. Chaque catégorie expose une **liste** (`?limit=` 1–200 déf. 50, `&offset=`) et une
**fiche** (par `id` numérique ou `slug`) :

| Catégorie       | Liste                          | Fiche                         |
| --------------- | ------------------------------ | ----------------------------- |
| Personnages     | `GET .../wiki/characters`      | `.../wiki/characters/{id}`    |
| Planètes        | `GET .../wiki/planets`         | `.../wiki/planets/{id}`       |
| Races           | `GET .../wiki/races`           | `.../wiki/races/{slug}`       |
| Techniques      | `GET .../wiki/techniques`      | `.../wiki/techniques/{slug}`  |
| Transformations | `GET .../wiki/transformations` | —                             |
| Sagas           | `GET .../wiki/sagas`           | `.../wiki/sagas/{slug}`       |
| Arcs            | —                              | `.../wiki/arcs/{slug}`        |
| Épisodes        | `GET .../wiki/episodes`        | `.../wiki/episodes/{id}`      |
| Films           | `GET .../wiki/movies`          | `.../wiki/movies/{slug}`      |
| Jeux            | `GET .../wiki/games`           | `.../wiki/games/{slug}`       |
| Outils/objets   | `GET .../wiki/tools`           | `.../wiki/tools/{slug}`       |
| Tomes manga     | `GET .../wiki/manga/volumes`   | `.../wiki/manga/volumes/{id}` |
| Actus           | `GET .../wiki/news`            | —                             |

```bash
curl -s "https://bot.dragonballfr.com/api/public/wiki/sagas" | jq '.sagas[] | {name, series, order_idx, slug}'
curl -s "https://bot.dragonballfr.com/api/public/wiki/characters/1" | jq
curl -s "https://bot.dragonballfr.com/api/public/wiki/search?q=kamehameha&limit=5" | jq
```

## Manga

| Chemin                                                 | Paramètres   | Renvoie                                 |
| ------------------------------------------------------ | ------------ | --------------------------------------- |
| `GET /api/public/manga/tomes`                          | —            | liste des tomes                         |
| `GET /api/public/manga/tomes/{series}/{tome}`          | path         | détail d'un tome + planches             |
| `GET /api/public/manga/page/{series}/{tome}/{planche}` | path         | métadonnées + URL image d'une planche   |
| `GET /api/public/manga/search`                         | `q`, `limit` | recherche texte (OCR) dans les planches |

```bash
curl -s "https://bot.dragonballfr.com/api/public/manga/search?q=kamehameha&limit=5" | jq
```

## Canon (arbitre de canonicité)

Base : `https://dragonballfr.com` (API du site, pas du bot). Lecture seule, CORS ouvert.

| Méthode & chemin                | Paramètres                                                   | Renvoie                                                                                  |
| ------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `GET /api/canon`                | —                                                            | la doctrine : `tiers`, `doctrine`, `sourcesAdmises`, `sourcesInterdites`, `heuristics`, `entries`, `stats` |
| `GET /api/canon?q=`             | `q` (≤ 400 car.)                                             | `{ question, verdict, references, planches, fiches, suggestions, mode }`                 |
| `GET /api/canon/references`     | `q`, `provenance` (aphrody\|databooks\|manuel\|manga), `limit` ≤100, `offset` | `{ total, items: CanonReference[] }`                                          |

`verdict` = `{ tier, tierLabel, tierDefinition, score (0-100), verdict, explanation, sources, matchedKeywords, doctrine, origine, nature, color, toriyamaQuote, suggestions }` (clés relevées le 2026-10-01 ; `references` et `planches` peuvent être vides, ce qui ne prouve rien : cite alors seulement la doctrine).
`origine` ∈ `entry:<id>` (sujet tranché) · `heuristic:<id>` (famille de formulations) · `fallback` (la doctrine ne sait pas — ne pas inventer).
Les cinq rangs sont, par score décroissant : `CANON_ABSOLU` (100), `CANON_SUPERVISE` (85), `EXTENSION_OFFICIELLE` (70), `NON_CANON_DERIVE` (50), `APOCRYPHE_FANON` (0). **Ce que chaque rang contient est une doctrine éditée à la main et elle change.** Deux niveaux coexistent dans `/api/canon` : `entries[]` (un verdict par sujet : `{id, title, tier, score}`, 44 entrées le 2026-10-01, ex. `db-gt` = `NON_CANON_DERIVE`, `daima` et `broly` = `CANON_SUPERVISE`) et `tiers[].inclut` (description générale de chaque rang). Le 2026-10-01 ces deux niveaux n'étaient pas parfaitement cohérents (`tiers` rangeait GT dans la « trame principale » alors que l'entrée `db-gt` le classait `NON_CANON_DERIVE`) : cite le verdict et l'`origine` renvoyés pour le sujet, signale l'écart s'il y en a un, et ne tranche pas toi-même.
`references[]` = `{ id, subject, text (original), textFr, source, year, lang, provenance, href }` — les déclarations de Toriyama et les planches de databooks traduites qui parlent du sujet. `planches[]` porte l'image, la transcription japonaise, la traduction et l'ancre `/wiki/databooks/{id}#planche-{n}`.

```bash
curl -s "https://dragonballfr.com/api/canon?q=Broly+est-il+canon" | jq '.verdict.tier, .references[0].source'
curl -s "https://dragonballfr.com/api/canon/references?q=Kaioken&provenance=databooks" | jq '.total'
```

Le corpus est alimenté en continu par l'ingestion canon (unité `shenron-canon-ingest` ; script `apps/shenron/site/scripts/canon-ingest.ts`) ; la doctrine s'édite dans `/admin/canon` du site (redirection vers la connexion si non authentifié).

## Bot & communauté

| Chemin                                         | Paramètres | Renvoie                                                          |
| ---------------------------------------------- | ---------- | ---------------------------------------------------------------- |
| `GET /api/public/stats`                        | —          | stats serveur Discord (membres, niveaux…)                        |
| `GET /api/public/presence`                     | —          | présence/état temps réel                                         |
| `GET /api/public/personas`                     | —          | les 6 personas (Shenron, Beerus, Whis, Grand Prêtre, Enma, Kaïo) |
| `GET /api/public/commands`                     | —          | commandes Discord publiques                                      |
| `GET /api/public/leaderboard`                  | `limit`    | classement par niveau/XP                                         |
| `GET /api/public/user/{discordId}`             | path       | profil public d'un membre                                        |
| `GET /api/public/shop`                         | —          | boutique                                                         |
| `GET /api/public/profile/{discordId}/card.png` | path       | **image PNG** carte de profil                                    |
| `GET /api/public/profile/{discordId}/scan.png` | path       | **image PNG** scouter                                            |

## Divers

| Chemin                                                  | Renvoie                                                   |
| ------------------------------------------------------- | --------------------------------------------------------- |
| `GET /api/public/news`                                  | actualités Dragon Ball (`?limit=`)                        |
| `GET /api/public/sources`                               | sources/corpus indexés par le RAG                         |
| `GET /api/public/data/coverage`                         | couverture réelle par corpus et par rubrique wiki (outil `dragonball_data_coverage`) |
| `GET /api/public/assets`                                | assets exposés                                            |
| `GET /api/public/eval/{cache-stats,reports,lore-stats}` | diagnostics (qualité RAG/LLM, stats lore)                 |
| `GET /graphql`                                          | endpoint GraphQL (GraphiQL activé) — cf. `mcp-graphql.md` |
| `GET /api/openapi.json` · `GET /api/docs`               | spec OpenAPI 3.1 + UI Scalar                              |
| `GET /health`                                           | sonde                                                     |

## Champs des entités

- **Character** : `id, name, name_ja, name_romaji, race, gender, affiliation, ki,
max_ki, origin_planet_id, description, image`. `ki`/`max_ki` sont indicatifs et
  dépendent du support (databook/anime) — à citer avec contexte.
- **Saga** : `id, name, name_ja, slug, series, order_idx, description, image`.
  Trie par `order_idx` pour l'ordre chronologique au sein d'une `series`.
- **Technique** : `id, name, name_ja, slug, type, creator_id, description`.
  `creator_id` → `characters/{id}` (le créateur).
- **Planet** : `id, name, slug, description, image` (+ habitants via `origin_planet_id`).
- **Race / Transformation** : `id, name, name_ja, slug, description, image`.
- **Episode / Movie / Game** : `id, title|name, slug, series/saga, description, …`.
- **RagHit** : `kind` (character|planet|race|technique|transformation|saga|movie|
  game|episode|source), `title`, `url` (relative au site → préfixer `https://dragonballfr.com`), `snippet`.

> Les `url` renvoyées par le RAG/wiki sont relatives (`/wiki/...`) : préfixe-les
> par `https://dragonballfr.com` pour un lien cliquable.
