<!-- docs-links: external-paths — backtick paths in this document name files of the pre-monorepo Shenron repository (historical changelog), not of this checkout. -->
# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Versionnement : date + courte description.

## [Non publié] - 2026-09-24

### Changed

- **Pile `@shenron/*` source-first branchée partout** : bot, site et pipeline consomment `@shenron/{config,db,auth,ai,api,ui,images,aphrody}` (vague 3) ; carte des paquets dans [`design/aphrody-m3/packages/material-web/docs/STACK.md`](../../../../design/aphrody-m3/packages/material-web/docs/STACK.md).
- **Origines publiques centralisées** (`85ad0857`) : `@shenron/config/public-urls` résout site, API et assets (`SHENRON_PUBLIC_SITE_URL`, `SHENRON_PUBLIC_API_URL`, `SHENRON_PUBLIC_ASSETS_URL`, noms historiques en repli) ; `remotePatterns` Next, CORS du bot et URL Discord en dérivent.
- **Services internes centralisés** (`9691bba6`) : `@shenron/config/services` pour Redis, site interne, API bot, LibreTranslate et sidecar OCR.
- **Dédup des assets bot/site** (`11683117`) : manifeste `packages/shenron/images/src/asset-aliases.json`, résolution disque `apps/shenron/bot/src/lib/asset-files.ts`, redirections Next pour les anciennes URL.
- **Client OCR distant** déplacé dans `@shenron/pipeline/aphrody/remote-ocr` (`0788f82c`) ; scripts du pipeline importent via les sous-chemins exportés `@shenron/site` et `@shenron/bot` (`1a37c65c`).
- **Développement local** : `scripts/dev/shenron/scripts/dev/local-env.ts` génère un `.env.local` par app et ouvre les tunnels depuis le catalogue `aphrody-infra` (port local = distant + 10 000), délégation à `aphrody ssh tunnel` ; Next dev/build dans WSL. Voir `docs/operations/shenron/DEV-LOCAL.md`.
- **Documentation** : référence unique des variables d'environnement `docs/operations/shenron/ENV.md` ; `CODEX.md` réduit à un renvoi vers `AGENTS.md` ; prompts et inventaires datés de la racine (`PROMPT.md`, `cdn.md`, `db-crawl.md`, `NEED.md`) déplacés sous `design/aphrody-m3/docs/products/drive/docs/archive/` ; hôtes, IP, ports et chemins machine retirés des docs de référence.

### Fixed

- **Better Auth** : secret résolu par `resolveBetterAuthSecret` (`BETTER_AUTH_SECRET`, repli `SESSION_SECRET`, obligatoire en production) ; rate limit d'auth du site sur Redis avec repli mémoire (`02a52822`).
- **Codec cookie admin** refuse un secret HMAC vide ou trop court (`cf4d7b09`) ; `PgService.get()` dégrade à `null` si le pool échoue (`3b727288`).

### Ops

- **Infra** : releases sous `/srv/shenron`, unités `shenron-bot` / `shenron-site` / `shenron-mcp` portées par `aphrody-infra` (`d8d69efc`). Les timers de backup de `dbfr` exécutent encore les anciens scripts de `scripts/` en attendant une modification live côté infra.

## [1.0.0] - 2026-09-23

### Changed

- **Stack stable, sortie de canary** (`package.json` racine + `apps/{bot,mcp,site}`) : version `1.0.0` partout. Next `16.3.5`, React/React DOM `19.3.0`, `@types/react`/`@types/react-dom` `19.3.0`, TypeScript `6.0.3`, `next-intl` `4.14.5`, `better-auth` `1.7.5`, Tailwind `^4.3.3`, `packageManager: bun@1.4.2` (`engines.bun >= 1.4.2`). `bunfig.toml` impose désormais `minimumReleaseAge = 259200` (3 jours) sur toute nouvelle résolution de dépendance — filet anti-supply-chain qui ne touche pas `bun.lock` des versions déjà épinglées.
- **Nettoyage du catalogue de dépendances** : retrait de `@supabase/supabase-js`, `@supabase/ssr`, `prisma`, `@prisma/client`, `vitest`, `@next/eslint-plugin-next` (catalog direct — reste en transitive via `eslint-config-next`) et `eslint-plugin-oxlint`. Retrait de la dépendance racine `vercel` et du script `site:deploy`.
- **Délégation infra à `aphrody-infra`** (`e99acd43` côté `shenron`, `250aa81` côté `aphrody-infra`) : l'exploitation de production (unités systemd, routes Nginx, releases, bascule, backups, rétention) n'est plus pilotée depuis ce dépôt. `dbfr` ne sert plus que PostgreSQL/données/backups ; le runtime applicatif (site, MCP, API bot) tourne désormais sur le VPS principal partagé avec RG/Aphrody/NIE (unités `shenron-site`, `shenron-mcp`, `shenron-bot` ; racine de release depuis déplacée sous `/srv/shenron`, voir le catalogue `aphrody-infra`). Détail de la frontière : `docs/operations/shenron/INFRA-DELEGATION.md`.
- **Durcissement auth/DB, aligné sur RG** : pool PostgreSQL durci, secret Better Auth fail-closed (plus de valeur par défaut silencieuse), hôtes SSH résolus via `SHENRON_SSH_HOST`.

### Added

- **Pages wiki crawlées, typées et idempotentes** : module partagé `apps/shenron/site/scripts/_crawled-wiki-pages.ts` remplace la matérialisation ad hoc, avec des types stricts sur les pages issues du crawl.
- **Outillage agents** (`e4831905`) : skills projet verrouillées (`better-auth-best-practices`, `better-auth-security-best-practices`, `supabase-postgres-best-practices`, verrouillées par hash dans `skills-lock.json`) + skills locales (`base-ui`, `tailwind-v4`) sous `.claude/shenron/skills/` ; plugin `nextjs@nextjs` (marketplace `vercel/next.js`) activé dans `.claude/settings.json`.

## [Unreleased] — 2026-08-24

### Added

- **Module d'édition unique du site** (`apps/shenron/site/src/components/editor/`) : un seul éditeur remplace les **quatre** surfaces de saisie qui coexistaient et divergeaient (Tiptap des articles, CodeMirror des pages wiki, CodeMirror des fiches, `<textarea>` nus). Deux composants exposés : **`ShenronEditor`** (riche) et **`PlainField`** (texte simple).
  - **Un vocabulaire de blocs unique** (`commands.ts`) exposé identiquement par la barre d'outils, le **menu « / »**, la **barre contextuelle de sélection** et la **feuille d'insertion mobile** : titres, marques, couleur/surlignage, alignement, listes, citations, code, liens, images (taille + placement + légende), galeries, bannières, vidéos, tableaux, encadrés (5 tons), colonnes (2/3), sections repliables, espaces, badge **Ki** et boutons. Presets par usage (`article`, `wiki`, `section`, `comment`, `note`).
  - **Mobile de plein droit** : barre d'outils **en bas**, décalée en temps réel par `visualViewport` pour rester au contact du clavier virtuel ; feuilles d'insertion et de mise en forme en plein écran, recherche incluse ; cibles tactiles de 44 px ; champs à 16 px (en dessous, iOS zoome à chaque focus).
  - **Rien ne se perd** : autosauvegarde à deux étages — copie locale immédiate + brouillon serveur anti-rebond (`POST/PUT /api/editor/draft`, table `public.editor_drafts`, un brouillon par utilisateur), `sendBeacon` au déchargement de l'onglet, bandeau de reprise au retour (affiché **seulement** si le brouillon diffère du contenu chargé).
  - **Trois vues du même document** : édition riche (mise en page réelle de la publication), **source** markdown/HTML (CodeMirror), **aperçu** avec le vrai rendu public (`WikiMarkdown`). Plus : rechercher/remplacer, plein écran, compteurs mots/signes/temps de lecture, poignées de déplacement de blocs, aide aux raccourcis (`Ctrl+/`).
- **Pont markdown ⇄ ProseMirror** (`components/editor/markdown/`) : le wiki continue de stocker du **markdown + HTML libre** — ce que lisent le rendu public, le RAG, les scripts d'ingest et les commandes Discord. Le HTML écrit à la main est préservé (`htmlContainer` garde balise/classes/style avec son contenu éditable ; `htmlBlock` conserve le reste verbatim). `roundTripReport()` vérifie **avant toute écriture** qu'ouvrir puis réenregistrer ne change pas le rendu. Rejoué sur le corpus réel : **3 543 / 3 544 documents au rendu strictement identique** (le dernier étant une source dont l'imbrication de gras était déjà cassée, que la sérialisation répare), 93,5 % à la source inchangée octet pour octet. Tests : `apps/shenron/site/tests/editor-markdown.test.ts`.

### Changed

- **Toutes les surfaces de saisie du site** passent par le module : éditeur d'articles (`/admin/posts`), pages wiki (`/admin/wiki/page/*`), champ markdown des fiches (`MarkdownField` → façade), éditeur générique de tables (`SmartField`), sections CMS, éditeur de home, et **les 20 `<textarea>`** restants (commentaires d'articles, signalements, avis, console bot, webhooks, boutique, déclencheurs, services, messages, chronologie, transcriptions de databooks, assistant wiki, éditeur JSON) → `PlainField` : hauteur automatique, compteur, `Ctrl/⌘ + ⏎` pour envoyer, brouillon local sur les commentaires.
- **Schéma de rendu des articles** : `lib/tiptap.ts` (supprimé) → `components/editor/schema.ts`. Saisie et rendu serveur partagent désormais littéralement la même liste d'extensions.
- **Dépendances** (`apps/shenron/site`) : ajout de `@tiptap/suggestion`, `@tiptap/extension-text-style`, `@tiptap/extension-drag-handle-react`, `@tiptap/extension-file-handler` et `marked` ; toutes les extensions Tiptap alignées sur `^3.30.3` (une version unique de `@tiptap/core` — deux copies casseraient l'identité des plugins ProseMirror).

### Fixed

- **Sérialisation markdown du gras contenant de l'italique** : traiter chaque fragment isolément produisait `**gras***italique***gras**`, que plus aucun parseur ne relit correctement — cas fréquent, les chapeaux de fiches étant entièrement en gras et citant des titres d'œuvres en italique. Les marques contiguës sont désormais regroupées.
- **Figure sans légende** : une `<figure class="wiki-img">` sans `<figcaption>` faisait réapparaître son image en double à l'enregistrement.
- **Styles d'édition du journal absents de `/admin/posts`** : `editorial.css` n'était importé que sous `/actualites`, l'éditeur d'articles écrivait donc dans une mise en page qui n'était pas celle de la publication.

## [Unreleased] — 2026-06-25

### Added

- **Dashboard « Activité du site » + API analytics + compteur public** (`apps/shenron/site`) : instrumentation `pageview` GLOBALE (îlot client `PageViewTracker` monté dans le layout, cache-safe via `usePathname`, gated consentement — les visites se comptent enfin, avant seul `wiki_view` sur les fiches perso était émis). Couche server-only `lib/analytics.ts` : agrégations GLOBALES sur `site_events` (visites, visiteurs uniques `count(distinct anonId)`, sessions, série temporelle `date_trunc` heure/jour, top pages, sources de trafic, top entités/recherches, live 5 min, deltas vs période précédente). API **`GET /api/analytics?range=today|7d|30d|90d`** (gated `isCurrentUserAdmin`). Page **`/admin/activite`** (entrée sidebar section Système) : KPIs + deltas, **graphe SVG maison interactif** (zéro dépendance, survol/tooltip, scaling uniforme), tables top pages/sources/entités/recherches, badge live, sélecteur de période. **Compteur public non-sensible** intégré à `/stats` (visiteurs du mois, pages vues, visiteurs cumulés, pages populaires — aucun referrer ni donnée par visiteur, CDN/ISR-safe) + lien footer. Migration `0004` (index `path`/`referrer`/`sessionId`/`ts` sur `site_events`, idempotente → à appliquer via `db:push`).
- **Chronologie universelle épisodes + films** (`apps/shenron/site`) : page **`/wiki/chronologie`** réunissant sur UNE frise TOUS les épisodes (659) ET TOUS les films (26) — DB, DBZ, GT, Super, Daima — là où les deux index existants étaient cloisonnés par série et jamais fusionnés. Helper server `dbUniverse.timeline()` (dataset exhaustif, un round-trip/table) + `lib/chronology.ts` **client-safe** (normalise les espaces de séries DISJOINTS épisodes `DB/DBZ/DBGT/DBS/DB_DAIMA` vs films `*_MOVIE/_OVA/_SPECIAL` sous des « ères » communes ; comparateurs de tri ; exports CSV/JSON/Markdown purs). Explorateur client : filtres par ère/type/recherche, 3 modes de tri (par ère / diffusion / titre), frise à bandes d'ère colorées (épisodes compacts, films en vedette), **export JSON/CSV/Markdown + copie**, et builder **« Ma chronologie »** (ajout ＋, réordonnancement ↑/↓, persisté localStorage) → l'utilisateur compose son propre ordre de visionnage. CTA sur les index épisodes & films + lien footer.
- **Boutons film précédent / suivant** (`apps/shenron/site`) : helper `dbUniverse.movieNav(series, id)` (adjacence par date de sortie au sein d'une série, cohérent avec l'ordre de l'index — les films n'ont pas de numéro) + nav prev/next (cartes poster) sur `/wiki/films/[slug]` + lien vers la chronologie. Les épisodes avaient déjà leur prev/next (`episodeNav`).
- **SEO — données structurées + canonicals** (`apps/shenron/site`) : composant **server** `apps/shenron/site/src/components/SiteJsonLd.tsx` monté dans le layout — JSON-LD `Organization` + `WebSite` avec `SearchAction` (sitelinks search box → `/wiki/search?q={search_term_string}`), inerte (sans cookie/header → cache CDN préservé). `ogMeta` (`lib/og.ts`) étendu d'un param `canonical` → `alternates.canonical` + `og:url` ; canonicals **auto-référentes** câblées sur ~30 pages (home + index + détails + page perso inline) — pas de canonical globale (pointerait toutes les pages vers la home). Invariants cache préservés (`public` + `x-nextjs-cache` HIT vérifiés).
- **RAG — exploitation des résultats** (`apps/shenron/bot/src/lib/rag.ts`) : `RagHit` expose désormais un **`score` ∈ [0,1]** (hybrid+rerank = sigmoïde du logit cross-encoder ; sinon RRF/lexical = min-max planché à 0.4 ; comparable **uniquement** au sein d'une même réponse et d'un même `mode`). **Déduplication/diversification** du top-N par URL canonique puis repli sur **titre foldé** (les chunks Fandom `kind=source` ont souvent une URL vide) ; le **manga est exempté** (clé par rowid → préserve le quota manga ≥ 2). **Filtrage stopwords FR/EN** + fold d'accents dans `ftsMatch` (index FTS5 en `remove_diacritics 2` → fold sûr ; garde-fou : ne filtre que si > 3 tokens et qu'il reste ≥ 2 tokens). Snippet de repli **centré sur le 1er terme** de requête. Propagé : REST `/api/public/rag/search` remonte `score` ; `/api/public/rag/chat` reçoit **CORS + rate-limit** (il était brut, sans wrapper) ; GraphQL `RagHit` expose `rowid` + `score` ; MCP `rag_search` gagne les filtres `lang`/`entity`/`sourceId` + `score` documenté (`rag_ask` clarifié : rédacteur LLM OFF → se fier aux `hits` sourcés) ; Discord `/ask` : **citations numérotées `[n]`** + icône de mode + % de pertinence ; site : puces de pertinence + **`WikiRagArchives`** (« passages liés » sourcés, `<Link>` internes + badge de pertinence) monté sur la page saga (îlot Suspense → revalidate de cette route 3600 → 300 s). Vérifié en prod : « Kamehameha » passe de 3/10 à 9/9 titres distincts. Tests : `apps/shenron/bot/tests/rag-filter.test.ts` (+5 invariants).
- **Plugin Claude Code `dragon-ball`** (`plugins/dragon-ball/`) : manifeste `.claude-plugin/plugin.json` + skill auto-découverte `skills/dragon-ball/` (SKILL.md + `references/` + `scripts/db.sh`) + serveur MCP distant déclaré inline (`mcpServers.dragonball` → `streamable-http` `https://mcp.dragonballfr.com/mcp`). **Marketplace `shenron`** à la racine (`.claude-plugin/marketplace.json`, source `./plugins/dragon-ball`). Install : `/plugin marketplace add aphrody-code/shenron` puis `/plugin install dragon-ball@shenron`. Validé via `claude plugin validate` (skill découverte, MCP connecté, outils OK). Caveat : héberger le plugin dans ce monorepo ⇒ `/plugin marketplace add` clone **tout** le dépôt (lourd) — extraction possible dans un dépôt dédié pour des installs légères.
- **`packages/shenron/pipeline/scripts/rag-embed-vectors.ts`** : (re)calcule **uniquement** `vec_chunks` depuis un `rag_chunks` déjà bon, **sans downtime** (aucun verrou d'écriture pendant l'embedding — que des appels HTTP au sidecar — insertion finale atomique ⇒ bascule nette lexical → hybride). À utiliser après un `fix-*` data ou un `rag:build` interrompu.

### Fixed

- **Invite Discord du site cassée → mauvais serveur** (`apps/shenron/site`) : `DISCORD_INVITE` renvoyait `discord.gg/dbfr`, or ce code vanity a été **réattribué à un autre serveur** (« Goldbase Collection ») — les visiteurs du site (footer, about, CTAs, FAB, JSON-LD `sameAs`, licence) étaient envoyés **ailleurs**. Corrigé en `discord.gg/dragonballfr` (= guild « Dragon Ball FR » `934894610545770506`) : `NEXT_PUBLIC_DISCORD_INVITE_URL` dans `apps/site/.env` (l'override qui gagne, baké au build), `DISCORD_DEFAULT` dans `lib/config.ts`, et le littéral de `licence/page.tsx`. Le bot (`SERVER_INVITE_URL`) était déjà correct.

### Changed

- **`robots.ts`** : `/_next/` débloqué (ne plus interdire les ressources de rendu) ; `/wiki/search` passée en `robots: noindex, follow` (évite l'indexation de la combinatoire `?q=`).
- **Corpus RAG ~40 874 chunks** (et non ~1041) : le manga OCR (147 tomes) et 2058 docs Xenoverse 2 ont été fusionnés au corpus ⇒ la phase d'embedding de `rag:build` dure **~15 min**. **Piège** : ne JAMAIS lancer `rag:build` au premier plan, ni en arrêtant le bot (downtime), ni en live (DDL `DROP` qui gèle les handlers) — préférer `rag-embed-vectors.ts` quand seul `vec_chunks` doit être recalculé.

### Fixed

- **Fuite d'infobox Fandom dans `bot.db_characters`** : l'ingest faisait fuiter des paramètres d'infobox dans `name_ja`/`name_romaji`/`race`/`affiliation` (ex. `name_ja = "|Décès = An 737"`, `race = "Giras|Concepteur=Akira Toriyama}}"`). **306 cellules nettoyées** via `apps/shenron/bot/scripts/fix-infobox-leak.ts` (idempotent ; corrige le Postgres `bot.*` source de vérité → propagé au SQLite par le reverse-sync `shenron-neon-pull.service`). Root cause corrigée dans `apps/bot/scripts/ingest/ingest-fandom-full.ts` (`clean()` coupe la valeur au 1er `}}` ou `|` de tête, wikilinks/templates résolus avant pour ne pas casser leurs séparateurs internes).

## [Unreleased] — 2026-06-22

### Added

- **Scans manga 100 % self-hostés (fin du « renvoi sur un autre site »)** : les planches ne sont plus hotlinkées depuis scan-vf.net — elles sont téléchargées sur le VPS (`apps/bot/assets/manga/`, gitignored), converties en WebP, servies depuis `bot.dragonballfr.com`. **12 716 planches** au total. Doc : `docs/guides/shenron/manga-scans.md`.
  - **Dragon Ball original VF complet** : 42 tomes (Sushi Scan → CDN anime-sama), N&B redimensionné/compressé WebP, rattachés aux tomes existants (`ingest-dragonball-volumes.ts`).
  - **Édition couleur** « Full Color – L'enfance de Goku » (2 tomes) avec section/badge « Couleur » dans le lecteur (`ingest-fullcolor-manga.ts`).
  - **Dragon Ball Super N&B complet** self-hosté (`selfhost-manga-pages.ts`).
  - **Nettoyage OCR des pages promo** : pubs « SUSHISCAN.FR » et pages de crédits retirées par OCR (`clean-fullcolor-promos.ts`).
- **Lecteur épisodes/films : sélecteur de langue VF / VOSTFR** (`VideoLecteurs.tsx`) — la donnée `players.lang` existait, l'UI manquait.
- **Encyclopédie massivement étendue depuis Fandom (vraies données, zéro placeholder)** : personnages **108 → 1323** (904 descriptions, images self-hostées), planètes **20 → 62**, arcs **0 → 23**. `ingest-fandom-full.ts` + `enrich-fandom-descriptions.ts` écrivent dans **Neon** (source de vérité), images réelles via l'API MediaWiki. Doc : `docs/guides/shenron/wiki-data-ingestion.md`.
- **RAG fortement enrichi** : corpus **7093 → 8521 docs / 36 228 chunks** — crawl Fandom FR+EN profond (`crawl-fandom-rag.ts`) + databooks officiels Kanzenshuu (`crawl-kanzenshuu-rag.ts`) + databooks traduits (Kanzentai via Wayback, Neoseeker via Wayback, Toei, fredcrash — `crawl-databooks-rag.ts`). Fusion `merge-corpus.ts`. **Reconstruction sur copie + swap sans coupure de recherche** (`swap-rag-tables.ts`). Doc : `docs/architecture/shenron/rag-enrichment.md`.
- **Grid personnages en rendu progressif** (« Voir plus », PAGE 120) pour rester fluide à 1300+ entrées.
- **API manga (transcriptions OCR des planches)** : nouvelle table `db_manga_pages` (migration `0014`) + FTS5 `manga_pages_fts` **bilingue FR+JP**, peuplées par `ingest-manga-db.ts` (12 577 planches / 147 tomes). Exposées en **REST** (`/api/public/manga/{tomes, tomes/:s/:t, page/:s/:t/:p, search}`), **GraphQL** (`mangaTomes/mangaPages/mangaPage/mangaSearch`) et **OpenAPI** (tag « Manga »). Recherche dégradant gracieusement si l'index FTS manque.
- **RAG focus manga** : corpus enrichi des transcriptions OCR (`corpus-manga.json`, FR+JP, kana/kanji conservés) + **boost de source ×2.2 et quota** sur `source_id="manga"` dans `rag.ts` → réponses focalisées manga plutôt que Fandom. Détection de langue `ja` ajoutée.
- **Services ML de Shenron sur GPU NVIDIA (CUDA)** : LLM conversationnel via **Ollama + Gemma 4 12B** (backend `ollama` de `llm.ts`, `/api/chat`, `think:false`, options `num_ctx`/`keep_alive`), sidecar RAG embeddings/reranker GPU (`embed-server-gpu.py`), OCR PaddleOCR GPU. **Fine-tune QLoRA de Gemma sur le manga** (unsloth → adapter GGUF → `ollama create gemma4-manga`). Doc : `docs/operations/shenron/gpu-local.md`.
- **OCR manga — fix recognizer FR** : `transcribe-manga.py` forçait le recognizer CN/EN sur du français (accents/apostrophes détruits) → `lang="fr"` (PP-OCRv6 latin) + détecteur server sur GPU.

### Changed

- **Zéro placeholder** : suppression des « Bientôt disponible » (tomes/chapitres non dispo), masquage des tomes/volumes sans scan, nullification des races « Inconnue ». Les champs absents sont masqués (jamais « Inconnu »).
- **Onglet « Dragon Ball »** du lecteur manga : présente désormais l'édition couleur + les tomes disponibles (plus de page de placeholders).
- **bxc reconstruit** (`~/bxc`, rust-bridge + standalone) ; le binaire `--compile` ayant un bug d'embed CDP (`awaitPromise is not defined`), le `bxc` global route vers la source qui fonctionne à 100 %.

### Fixed

- **Reverse-sync Neon→SQLite réparée** : elle était cassée par des NULL dans des colonnes NOT NULL côté SQLite (`db_planets.is_destroyed`, `db_assets.source_id/license_key/created_at`). Valeurs par défaut posées en Neon ; `ingest-fandom-full.ts` pose `is_destroyed=0`.
- **Cache CDN** : `force-dynamic` → ISR (`/wiki/episodes`, `/actualites`, `/stats`, `/commands`) ; `generateStaticParams` ajouté (`/wiki/episodes/[id]`, `/wiki/manga/[id]`, `/wiki/manga/volume/[id]`, `/wiki/arcs/[slug]`, `/post/[slug]`) ; éditeur média épisode passé en îlot client (`useMe`) pour rendre la page cacheable.
- **A11y** : ARIA d'onglets (UniverseTabs, MangaVolumeGrid), états `focus-visible` (CharacterGrid, cartes sagas/épisodes, lecteurs), `aria-label` du lecteur manga.
- **SEO** : `generateMetadata` accueil + `/shop`, OG images absolues sur `/post/[slug]`.

## [Unreleased] — 2026-06-10

### Added

- **Entraînement SFT local approfondi (8 époques)** : Résolution du data shift où le modèle local de 29M d'attention s'effondrait et renvoyait du vide face aux contextes longs de production. Harmonisation globale de la taille de contexte à **800 caractères** (générateur SFT `corpus_export.ts`, formateur de prompt `dbz_llm.py` et fusion RAG `llm.ts`).
- **Inférence Parallèle des Embeddings & RAM Systemd** : Parallélisation de l'inférence CPU via un pool de 6 promesses concurrentes et traitement par lots (batch size 64) sur les 27 653 chunks du corpus (réduction de 3h à 40min). Redimensionnement de `shenron-embed.service` (`MemoryHigh=5G`, `MemoryMax=6G`) pour éviter les blocages de RAM et I/O wait.
- **Résolution des verrous SQLite & Timeouts bxc** : Élimination des erreurs `SQLITE_BUSY` lors de la reconstruction de l'index RAG en remplaçant la copie directe par un `VACUUM INTO` à chaud. Sécurisation du crawl massif avec un timeout robuste de 30 secondes pour tuer les processus `bxc scrape` suspendus.

## [Unreleased] — 2026-06-02

### Added

- **Assistant Dragon Ball conversationnel local** — vrai modèle capable servi en local (llama.cpp, **Qwen2.5-3B-Instruct**, port **:5008**, `shenron-llm.service`), aucune API externe. Conversation naturelle + raisonnement + **mémoire** (historique par session dans Redis), détection du bavardage (un « bonjour » = vraie réponse, plus de dump d'archives), faits via RAG **reformulés** dans la voix du persona. Branché bot (Discord autonome) + site (FloatingAssistant, mémoire par navigateur). _NB : un premier modèle entraîné from-scratch (29M, `dbz_llm.py`) s'est révélé trop petit pour converser — conservé comme artefact, non utilisé en prod._
- **RAG massivement enrichi** — crawl concurrent multi-wiki FR+EN (`crawl-fandom-rag.ts`, via `action=parse`) : **~7000 entités / 36k chunks** (vs 58 personnages). Indexation Discord complète sans cap (`index-discord-full.ts`). Éval honnête `eval-own.ts` + dashboard `/admin/evaluations`. Doc (retirée depuis) : `docs/llm-maison.md`.

### Changed

- **Next.js bumpé `16.3.0-canary.21` → `.37`** (catalog racine + override + `@next/env`) — doctrine nightly. Type-check, lint, `next build` et déploiement prod verts.

### Fixed

- **`better-auth` épinglé exact `1.6.11`** (catalog) — `@better-auth/kysely-adapter@1.6.13` importe `DEFAULT_MIGRATION_TABLE`, absent de `kysely@0.29.2` → casse le build Turbopack du site (Vercel re-résout `^1.6.11` vers la version cassée). Pin exact = résolution déterministe (1.6.11 verrouille lui-même `kysely@^0.28.17`).

### Ops

- **Open-source** — `aphrody-code/shenron` passé **public** (2026-06-02). Ajout `LICENSE` (**Apache-2.0**) + `SECURITY.md` racine ; README/CLAUDE.md alignés (badge, rationale deploy Vercel).
- **Historique git purgé de toute PII** — `git-filter-repo` sur **toutes les branches + refs PR** : suppression des dumps SQLite (`*.db`/`*.sqlite`, dont un backup de 5860 membres), `apps/bot/data/guild-scan.json` (scan de 5764 membres Discord), `.recovery-checkpoint.json`. `.gitignore` durci (`*.db`/`*.sqlite*` global + exports runtime). Audit : aucun secret/token n'était commité. `fr-episode-titles.json` (donnée publique) conservé.
- **Sync Neon↔SQLite rétablie** — timers `shenron-neon-sync.timer` (forward runtime+news, 30 min) + `shenron-neon-pull.timer` (reverse wiki éditorial, 15 min) réinstallés/activés + env `~/.shenron-neon.env` recréé (600). Resync forward vérifié (23 tables, 9146 lignes, 0 mismatch) ; wiki déjà aligné.

## [Unreleased] — 2026-06-01

### Added

- **RAG SOTA — récupération hybride + reranking** (`apps/bot/src/lib/{embeddings,rag}.ts`, `apps/bot/embed-server.ts`) — passage du FTS5 keyword pur à un pipeline 2 étages 100 % local, FR+JP : étage 1 = récupération **hybride** BM25 (`rag_chunks` FTS5) + embeddings denses multilingues (`rag_vectors`, modèle `Xenova/multilingual-e5-small` 384d, cosinus exact brute-force) fusionnés en **RRF** (k=60) ; étage 2 = **reranking cross-encoder** (`Xenova/bge-reranker-base`) du top-15. Sidecar dédié `shenron-embed.service` (port 5007 loopback, 2 modèles chauds, `MemoryMax=3G`) — `embeddings.ts` (heavy) n'est **jamais** importé par le bundle bot, `rag.ts` (runtime léger) fetch HTTP vers le sidecar. Build offline : `bun --filter @shenron/bot run rag:build` (override `RAG_DB=/path` pour tester sur copie). Dégradation gracieuse 3 niveaux (`mode` ∈ `hybrid+rerank | hybrid | lexical`). Consommateurs : `/api/public/rag/search` (REST), `ragSearch` (GraphQL), commande Discord `/ask`, recherche du site (`dbUniverse.rag`).
- **API GraphQL publique read-only** (`apps/shenron/bot/src/api/graphql.ts`) — endpoint `/graphql` sur le `Bun.serve` du bot, code-first **Pothos** + **graphql-yoga**, GraphiQL activé, CORS public, garde-fou profondeur max 10. Expose le wiki (`characters`/`planets`/`sagas`/`episodes`/`techniques`/`transformations`/`movies`/`games`/`races`) + relations + `ragSearch` (RAG hybride) + `counts`. Deps : `graphql@16 graphql-yoga@5 @pothos/core@4`.
- **OpenAPI 3.1 + UI Scalar** (`apps/shenron/bot/src/api/openapi.ts`) — spec statique servie à `/api/openapi.json` (CORS public, cache 1 h) et UI interactive **Scalar** à `/api/docs` (CDN, zéro dep). Couvre la surface REST publique (RAG / Wiki / Insights / Médias).
- **Commande Discord `/ask`** (`apps/shenron/bot/src/commands/wiki/Ask.ts`, persona Whis) — question FR en langage naturel → RAG hybride+rerank → embed sourcé (résultats classés, `kind` iconifié, snippets, liens vers le site) + bouton **« Ouvrir le meilleur résultat »**. Dégradation gracieuse.
- **Site — animations cinématiques** (`apps/shenron/site/src/components/ViewTransition.tsx`, `app/globals.css`, `next.config.ts`) — **View Transitions API** (morph d'élément partagé grille→fiche personnages/planètes, slides directionnels nav-forward/back via `ViewTransition` isomorphe + `experimental.viewTransition: true`), scroll-driven animations CSS natives (`animation-timeline: view()` reveal staggeré), ki-glow au survol (`@property --ki-angle`), hero ken-burns enrichi + wordmark glow. `prefers-reduced-motion` respecté, cache CDN préservé (pages Static/SSG), zéro framer-motion (motion / CSS natif).

## [Unreleased] — 2026-05-31

### Added

- **Home cinématique full-page « Codex Shenron »** (`apps/site/src/components/home/*`, `app/page.tsx`) — réécriture complète de la home en 7 panneaux plein écran scroll-snap (navigation molette + clavier + tactile), fonds animés des meilleures scènes DB (ken-burns + grade d'ère + grain + aura ki + letterbox), et état **réel + live** du bot (SSR + poll 25 s + SSE `a2a/events` → power-levels animés, gardiens en ligne, flux d'événements). Réutilise `motion` / CSS natif (`animation-timeline: view()`), zéro framer-motion.
- **Scènes d'épisode** (end-to-end) — colonnes `db_episodes.frames` (jsonb `EpisodeFrame[]`) + `scene_preview` ; extraction `apps/shenron/bot/scripts/extract-dbz-frames.ts` (ffmpeg vidéo locale) et `scripts/scrape-dbz-fandom-frames.ts` (API MediaWiki, méthode rpbey) ; orchestrateur `apps/shenron/bot/scripts/build-episode-scenes.ts` (frames + `preview.mp4`) ; ingest Neon gardé `apps/shenron/bot/scripts/ingest-episode-frames.ts` ; affichage wiki (`/wiki/episodes/[id]` : hero `AnimatedMedia` + galerie + export GIF).
- **Composants média site** (`apps/site/src/components/media/*`) — `AnimatedMedia` (video/gif lazy a11y), `BackgroundImage`/`HeroBackground` (next/image fill, variantes kenburns/parallax CSS), `encodeGif` (`modern-gif`, frames→GIF browser).
- **Télémétrie first-party RGPD** (`apps/site/src/lib/{telemetry,consent,recommendations}.ts`, `app/api/telemetry`, `components/{ConsentGate,TrackView}`) — `track()` typé fan-out **Vercel Analytics + GTM dataLayer + Postgres** (tables `site_events`/`user_preferences`), anonymisation (hash salé, anonId httpOnly), **Google Consent Mode v2**, fondation recommandations/personnalisation (co-vues + affinité + populaire).
- **Google Tag Manager** (`GTM-KLSS5787`) via `@next/third-parties/google` + `<noscript>`.
- **Pages wiki dédiées Personnages + Planètes** (`app/wiki/personnages`, `app/wiki/planetes`) — index manquants jusqu'ici (persos/planètes browsables uniquement via le fourre-tout `/wiki/dragon-ball`). `CharacterGrid` client (`components/wiki/`) : grille filtrable recherche + facettes par race, compteur live. Routes détail inchangées sous `/wiki/dragon-ball/{character,planet}/…`.
- **`lib/config.ts` — source unique des URL/API du site** (client-safe) : `API_URL` (API bot), `ASSET_BASE` (assets bot), `SITE_URL`, `DISCORD_INVITE` + helpers `apiUrl()`/`assetBaseUrl()`. `dbUniverse.counts()` (un round-trip groupé) pour les comptes réels du wiki.

### Changed

- **bxc crawl bumpé sur 0.5.4** — `apps/shenron/bot/scripts/ingest/bxc-ingest.ts` réécrit (sortie `bxc scrape` = JSON), `BXC_DIR`/`BXC_PROFILE` env, profils `static|fast|http|stealth|max` (le profil `ghost` n'existe plus).
- **Home recadrée « Voyage à travers l'univers Dragon Ball »** — narratif d'exploration centré contenu ; le mot « wiki » retiré de toute la vitrine (héro, summon, rôle Whis, description SEO globale, 404). CTA « Commencer le voyage », panneau univers titré « Voyage à travers l'univers ».
- **Hub `/wiki` à comptes dynamiques** — les ~9 nombres codés en dur (« 58 personnages », « 25 films »…) remplacés par `dbUniverse.counts()` (Neon réel) → plus de désynchro quand la DB grossit. Copies landing/metadata rendues evergreen.
- **Unification URL/API du site** — ~14 défauts `https://bot.dragonballfr.com`, ~9 littéraux `discord.gg/dbfr` et l'URL site, dispersés dans ~27 fichiers → collapsés sur `lib/config.ts`. Future migration de domaine = 2 env vars au lieu de 27 fichiers. `auth*` / allowlist télémétrie / branding OG volontairement épargnés ; bot (producteur unique d'API) non concerné.

### Fixed

- **`/wiki/dragon-ball` → 308 dur** via `next.config` `redirects()` vers `/wiki/personnages` (un `permanentRedirect()` en composant dégradait en page 200 + `<meta refresh>` à cause du streaming du layout `/wiki`). Fourre-tout « Encyclopédie » (doublon de Films/Jeux) supprimé.
- **FAB Discord invite cassée** — `DiscordInviteFAB` retombait sur `https://discord.gg/votre_invite_ici` si `NEXT_PUBLIC_DISCORD_INVITE_URL` absent → désormais `DISCORD_INVITE` (défaut `discord.gg/dbfr`).

### Ops

- **`ops(domaine)` : migration prod vers `dragonballfr.com`** — le site bascule sur `https://dragonballfr.com` (canonical, OG, liens publics) et l'API/assets du bot sur `https://bot.dragonballfr.com`. Les alias historiques `dragonballfr.com` / `dbfr.vercel.app` (site) et `bot.dragonballfr.com` (API) restent conservés (redirections / origines de confiance), mais ne sont plus le domaine de référence.
- **Infra dragonballfr.com** — vhost VPS `deploy/nginx/bot.dragonballfr.com.conf` (proxy `:5006` + cache CDN long sur `/assets/`), cert Let's Encrypt `bot.dragonballfr.com`, DNS OVH (apex/www → Vercel, `bot` → VPS), env Vercel (`BETTER_AUTH_URL`/`SHENRON_API_URL`/`NEXT_PUBLIC_SHENRON_API_URL`). Compte OVH `gl839461-ovh`.
- **Schémas** — colonnes Neon `bot.db_episodes.{frames,scene_preview}` ; tables Postgres site `site_events` + `user_preferences` (migration `apps/site/src/db/migrations/0000_*`, appliquée).
- **Discord OAuth** — redirect URIs à déclarer côté portail pour `dragonballfr.com`/`bot.dragonballfr.com` (app `1497194276025663680`).

## [Unreleased] — 2026-04-25

### Added

- **API REST (`Bun.serve`) tscord-compatible** — surface alignée sur les controllers de `@aphrody/tscord`, permet à un fork de [`barthofu/tscord-dashboard`](https://github.com/barthofu/tscord-dashboard) de piloter shenron. Bind `127.0.0.1:5006` par défaut, auth Bearer (`API_ADMIN_TOKEN`).
  - **Health** : `/health/{check,latency}` (public) + `/health/{usage,host,monitoring,logs}` (admin)
  - **Stats** : `/stats/totals` (users/guilds/commands), `/stats/interaction/last`, `/stats/guilds/last`
  - **Bot** : `/bot/guilds`, `/bot/commands`, `/bot/commands/:name` (full schema avec options/choices)
  - **Cron** (`CronRegistry` centralisé, registres `voice-xp-tick`, `jail-expiry`, `bio-role-scan`) : `GET /cron` (last/next run, durée, erreurs) · `POST /cron/:name/trigger` (déclenchement manuel)
  - **Services** : `GET /services` (list whitelist) · `POST /services/:service/:action` (achievements.refresh, economy.addZeni, level.addXP, settings.set, translate.probe, moderation.countWarns, wiki.search…)
  - **Database CRUD générique** sur 16 tables whitelist : `GET /database/tables` · `GET /database/:table?limit&offset` · `GET/PUT/DELETE /database/:table/:id` · `POST /database/:table`. `mutableColumns` par table pour empêcher l'édition de colonnes sensibles.
  - **OpenAPI 3.0.1** auto-généré sur `/openapi`.
- **`StatsService`** — équivalent du `Stats` service tscord, sans deps `pidusage`/`node-os-utils` (lit `process.memoryUsage`/`process.cpuUsage` + `node:os` natifs).
- **`CronRegistry`** — singleton qui collecte les `setInterval` des events (VoiceXP, JailExpiry, BioRole) et expose `lastRunAt`, `lastDurationMs`, `runCount`, `lastError`, `nextRunAt`.
- **`ApiServer`** — Bun.serve natif avec `routes` Map, params `:name`/`:id` typés, error handler global, `Response.json` + `req.json()` web-standard. Lance dans `clientReady` après `boot-audit`.
- **`/translate`** — OCR d'image + traduction VF (ou EN/ES/DE/IT/JA), 100 % FOSS via **Tesseract** (Apache 2.0, `Bun.spawn` stdin) + **LibreTranslate** (AGPL-3.0, Docker self-host). Slash command **et** menu contextuel **"Traduire en VF"** (clic droit message → Apps). Hard caps prod : image ≤ 10 MiB, timeout tesseract 30 s, timeout LibreTranslate 8 s, garde SSRF (refuse `file://`, IPs privées, `localhost`). Probe au boot dans `boot-audit.ts` — la commande devient inactive avec message d'erreur explicite si l'un des deux est down.
- **`/config`** — slash group admin (dashboard MVP) : `/config list/set/unset` pour les overrides runtime (XP rates, cooldowns, salons), `/config channel <type> <salon>`, `/config level-reward-set/-remove/-rewards`. Persisté en table `guild_settings` (key/value, cache 30 s) → override les constantes hardcodées sans redéploiement. Vérifie la **hiérarchie de rôles** sur `level-reward-set` (refuse si rôle ≥ rôle bot).
- **Challenge buttons** — nouveau `src/lib/challenge.ts` (helper Accept/Decline réutilisable, customId `challenge:<scope>:<action>:<key>`). Câblé dans `/pendu joueur` et `/morpion joueur` : message de défi avec boutons **✅ Accepter** / **❌ Refuser** (timeout 60 s). La partie ne démarre qu'après acceptation explicite de l'adversaire.
- **`/pendu` amélioré** — embed avec **nombre de lettres** affiché, lettres trouvées vs ratées triées (`Array.toSorted`), 7 frames ASCII du pendu (0→6 erreurs), mot révélé en `||spoiler||` à la défaite.
- **`/morpion` amélioré** — embed dynamique, IA défensive (gagner > bloquer > centre > coin > random), ligne gagnante surlignée en vert.
- **Texte double-police** — nouveau `canvas-kit.ts::textDoubleFont` qui superpose deux polices avec offset/blur (Saiyan Sans glow + Inter Display Black net) pour effet relief DBZ. Appliqué au pseudo de `/scan` et au titre des gauges `/gay` / `/raciste`.
- **Salon des accomplissements séparé** — nouvelle var `ACHIEVEMENT_CHANNEL_ID` + `resolveAchievementChannel` (retombe sur `ANNOUNCE_CHANNEL_ID` si absent). Notifs 🏆 envoyées en `EmbedBuilder` brand au lieu de plain text.
- **Helpers embed** — `src/lib/embeds.ts` (`brandedEmbed`, `successEmbed`, `errorEmbed`, `warningEmbed`) inspirés de `@aphrody/tscord/utils/functions/embeds`, sans tirer la stack tscord complète.
- **Service `SettingsService`** — table `guild_settings` (migration `0001_lazy_scrambler.sql`), validation par type (int/snowflake/string/bool), invalidation cache après set, mono-guild assumed (le bot est verrouillé sur `env.GUILD_ID`).
- **Service `TranslateService`** — encapsule Tesseract CLI + LibreTranslate, méthode `probe()` au boot pour détecter la dispo runtime, validation URL anti-SSRF (`isIP`, ranges privés RFC1918/loopback/link-local/ULA).
- **`apps/shenron/bot/scripts/setup-translate.sh`** — script idempotent qui installe Tesseract via apt (packs `fra/eng/jpn/spa/deu/ita`) et lance LibreTranslate en Docker (`127.0.0.1:5000` bind, modèles `en,fr,ja,es,de,it`, `LT_DISABLE_WEB_UI=true`). Healthcheck 3 min.

### Changed

- **Workspace** — `apps/shenron` retiré de l'exclusion `!apps/shenron` du root `package.json` du monorepo VPS. Les packages `@aphrody/{di,discordx,importer,pagination}` passent en `workspace:*`, `discord.js` et `typescript` en `catalog:`.
- **`MessageXP.ts`** — `resolveAchievementChannel` est désormais résolu **lazy** uniquement si on a un succès à annoncer (`isFirstMessage || granted.length > 0`). Évite un `client.channels.fetch` HTTP par messageCreate (rate-limit Discord sur serveurs actifs).

### Fixed

- **Fuites mémoire potentielles `/morpion`** — Map `games` GC manquant. Ajout de `setTimeout(games.delete, 30 min).unref()` après chaque création.
- **Race condition `/pendu`** — un user qui clique "Accepter" après expiration démarrait quand même. Check `expiresAt <= Date.now()` dans `onChallengeButton`.
- **Tous les `setTimeout`** — `.unref()` ajouté pour ne pas garder l'event loop éveillé.
- **Tesseract hang sur image malicieuse** — hard kill via `setTimeout(proc.kill, 30s)` + cap `content-length` 10 MiB.
- **LibreTranslate freeze user 30 s** — timeout descendu à 8 s, message d'erreur explicite avec URL configurée.

## [Unreleased] — 2026-04-24

### Added

- **Salon de commandes dédié** — nouvelle var `COMMANDS_CHANNEL_ID` + guard `CommandsChannelOnly` appliqué aux commandes user-facing (`/shop`, `/buy`, `/eprofil`, `/fusion`, `/solde`, `/gay`, `/raciste`, `/scan`, `/bingo`, `/morpion`, `/pendu`, `/pfc`, `/profil`, `/top`, `/niveau`, `/wiki`, `/races`, `/planete`). Hors du salon ciblé → reply éphémère. Commandes modération / admin / tickets / vocaux restent utilisables partout.
- **Salon d'annonces** — nouvelle var `ANNOUNCE_CHANNEL_ID` + helper `src/lib/announce.ts::resolveAnnounceChannel`. Les messages de level-up (texte **et** vocal), quête quotidienne, premier message, succès pattern-based sont publiés dans ce salon unique au lieu du salon d'origine.
- **Level rewards DBZ** — seed automatique de la table `level_rewards` avec 10 rôles canoniques (Kaioken → Perfect Ultra Instinct) mappés aux paliers `LEVEL_THRESHOLDS`. Script `bun run db:seed-levels` + intégré dans `db:seed-all`.
- **Audit boot-time** — nouveau `src/lib/boot-audit.ts` exécuté à `clientReady`. Vérifie pour chaque ID env : existence du salon/rôle sur la guild, type attendu (text/category/voice), position hiérarchique vs bot. Signale les 10 rôles level-reward en cas d'injoinables. Log unique `✓ boot-audit OK` ou warnings détaillés.
- **Scan de la guild** — `apps/shenron/bot/scripts/scan-ids.ts` dump 172 salons + 185 rôles + 5756 users (avec rôles de chaque user) dans `data/guild-scan.json`. Sert de source de vérité pour le ciblage des vars env et le seed des level-rewards.

### Changed

- **GUILD_ID** basculé du serveur de test (`1497167233280118896`) vers la prod Dragon Ball FR (`934894610545770506`). 41 commandes ré-enregistrées sur la nouvelle guild.
- **`.env` rempli** depuis le scan :
  - `LOG_MESSAGE_CHANNEL_ID` / `LOG_SANCTION_CHANNEL_ID` / `LOG_ECONOMY_CHANNEL_ID` / `LOG_JOIN_LEAVE_CHANNEL_ID` / `LOG_LEVEL_ROLE_CHANNEL_ID` / `LOG_TICKET_CHANNEL_ID` → `1032622751845990401` (💾・logs, salon unique du serveur)
  - `MOD_NOTIFY_CHANNEL_ID` → `1142417515004317748` (🛠️・moderation)
  - `JAIL_ROLE_ID` → `1405635615827034194` (**Jugé par Enma**, 6 jailed actifs) — substitué au badge cosmétique _JAIL_ (0 membre)
  - `URL_IN_BIO_ROLE_ID` → `935209498862317698` (.gg/dragonballfr)
  - `TICKET_CATEGORY_ID` → `1034596363096301719` (⌈🌟⌋ DB FR)
  - `SERVER_INVITE_URL` → `https://discord.gg/dragonballfr`
- **Wiki Dragon Ball** — DB peuplée via `bun run db:seed-all` : 58 personnages, 20 planètes, 43 transformations depuis `dragonball-api.com`. Descriptions en espagnol (endpoint FR upstream supprimé, confirmé via `?lang=fr`/`lang=en`/`Accept-Language`). Footer des embeds annote `source: dragonball-api.com`.

### Fixed

- **`/wiki` / `/races` / `/planete`** retournaient "introuvable" → DB seedée, les trois commandes fonctionnent avec autocomplete.
- **Level-up vocal silencieux** — `VoiceXP` ne passait pas de salon à `handleLevelUp`, aucun message posté. Désormais résout `ANNOUNCE_CHANNEL_ID` et publie correctement.

### Notes opérationnelles

- Le rôle **Shenron** (integration) doit rester **au-dessus** de tous les rôles attribués (.gg/dragonballfr à la position 97, rôles level-up jusqu'à 94). Boot-audit confirme position actuelle du bot = 148.
- Les tickets créés par `/ticket-panel` tomberont sous la catégorie DB FR (à côté de 🔖・ticket).
- `VOCAL_TEMPO_HUB_ID` laissé vide : aucun hub vocal "➕" unique sur le serveur (plusieurs par catégorie de jeu). Feature inactive tant qu'une var n'est pas définie.
