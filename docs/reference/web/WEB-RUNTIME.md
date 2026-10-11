<!-- SPDX-License-Identifier: Apache-2.0 -->

# Runtime web unifié : Aphrody Web Browser, Bun et N2B

`aphrody-web` conserve les capacités web (N2B vit dans `aphrody-compat`) ; il ne les réduit pas à un
simple navigateur ou à une conversion TypeScript. La centralisation porte sur
les frontières d'exécution, les contrats et les sorties, jamais sur une
suppression de fonctionnalités.

## Frontière de dépôt et origine publique

`aphrody-web` owns the Aphrody Web product: `docs/products/web/crates/aphrody-site` (HTTP origin),
`apps/bxc` (not in repo) (Bun implementation), `crates/aphrody-web-*`, Obscura
(`crates/aphrody-obscura`), the `bxc-test` and `x`
packages, and `docs/web` (not in repo) (`@aphrody/fut` is hosted in standalone repository `../fut`). `aphrody-os` owns the kernel and the subsystem contract
(`aphrody-subsystem`) that `aphrody-browser` implements.
The sibling `aphrody-ai` repository owns agents, models, RAG, AI MCP, the CLI,
`aphrody-gemini-web`, `aphrody-embed` (the `aphrody-embed worker` process) and `@aphrody/xai`. It consumes OS
contracts without copying BXC. Web FFI launches Gemini through local JSON
stdin/stdout, avoiding an inverse Cargo dependency. The native embedding
bridge exports the BXC ABI and calls one persistent AI worker over bounded
stdin/stdout frames. Local FFI probes cover embedding, reranking and fallback;
the installed bridge and production host have not been updated.

`aphrody-site` est l'origine HTTP du produit web OS. Il sert les API navigateur,
indexation, BXC et N2B. Son transport MCP HTTP utilise RMCP et expose trois
outils web en lecture seule. Il ne sert ni A2A, ni RAG IA, ni registre de modèles.
Nginx route `/api/v1/a2a` et la carte d'agent directement vers le service IA
sur `127.0.0.1:8788`, et `/api/v1/{models,rag/*}` vers le backend IA sur
`127.0.0.1:8789`. Le manifeste `/ai.json` est lu directement dans le dépôt IA
par Nginx. Ces services restent propriétaires de leurs protocoles et données.
Les statistiques SEO/BXC du site lisent uniquement PostgreSQL Web via
`APHRODY_WEB_DATABASE_URL` (alias compatible `APHRODY_SITE_DATABASE_URL`).
Si les deux variables divergent, le site refuse la connexion. PostgreSQL Web
porte `aphrody_bxc_rankings` et `aphrody_seo_entities` ; le RAG IA reste dans
sa propre base. Les rankings du site sont lus directement dans PostgreSQL Web,
sans cache Redis susceptible de masquer des données périmées. Les lectures REST
et MCP excluent les anciennes lignes sans provenance d'observation ; l'import
exige une source, une date UTC, une URL de preuve et au moins une métrique
observée. Les valeurs absentes restent SQL `NULL`.
L'index de pages Web BXC vit dans SQLite à `BXC_DB_PATH`, sous la racine
persistante `BXC_DIR` ; le site consulte cet index via l'API Web locale.

Le backend privé `aphrody-mcp http` écoute par défaut sur `127.0.0.1:8789`
et expose `/healthz`, `/api/v1/models`, `/api/v1/rag/query` et
`/api/v1/rag/stats`. Le RAG nécessite `APHRODY_MCP_DATABASE_URL` côté IA ;
sans connexion valide, il rapporte son indisponibilité. Le catalogue de
modèles provient du registre local `aphrody-models` et vérifie les fichiers
présents. En production, `APHRODY_HOME` pointe vers
`/home/ubuntu/apps/aphrody/shared/ai` pour l'état et les modèles IA.
Avec `APHRODY_MCP_DATABASE_URL`, `aphrody rag web-ingest <url>` utilise le
scraper OS puis écrit dans la base PostgreSQL IA, corpus `bxc_crawl` ; les
commandes IA `rag search` et `rag stats` lisent cette même base. Cette voie
annonce une recherche lexicale tant que les vecteurs ne sont pas indexés.
L'option IA explicite `--db` sélectionne l'index SQLite local.

La plateforme expose des API à la demande pour navigation, indexation du Web,
rendu de pages et canvas, ainsi qu'une distribution d'assets M3. Le site monte une passerelle authentifiée
`/api/v1/web/{scrape,crawl,extract,page,index/search,crawl/stats}` vers le
service BXC local ; `scrape` accepte le profil de rendu. L'API authentifiée
`POST /api/v1/canvas/render` utilise `aphrody-render` pour produire un vrai PNG
M3 et limite la scène à 1024 × 1024 pixels, 64 nœuds, 4 Mio de JSON et deux
rendus simultanés. `GET /cdn/m3/*` distribue un ensemble explicite de CSS,
polices OFL et licences depuis les sources OS embarquées, avec ETag et cache.
Preuve historique : la release VPS `20260923T134927Z-00014367-3e35f4ba` a été
vérifiée le 2026-09-23 (quatre services actifs au démarrage, Web statique et
rendu JS authentifiés en 200, accès sans jeton en 401, CDN M3 et API IA en 200).
Cette observation décrit uniquement cet état daté; elle ne prouve pas la
disponibilité actuelle. Le catalogue, les probes et les releases courantes
relèvent de `aphrody-infra`.

La passerelle web refuse les appels sans `APHRODY_SITE_WEB_API_TOKEN` (alias
`APHRODY_BXC_API_TOKEN`), limite les
requêtes à 1 Mio et l'amont `APHRODY_SITE_WEB_UPSTREAM` à HTTP en loopback
(défaut `127.0.0.1:3007`). Si le service BXC demande son propre jeton,
`APHRODY_SITE_WEB_BACKEND_TOKEN` le transmet uniquement à cet amont local.
Le service backend Bun exige `BXC_API_TOKEN` et écoute sur `127.0.0.1:3007` ;
son unité systemd de référence se trouve dans `aphrody-infra`.

### Passerelle Drive optionnelle

`aphrody-site` peut relayer l'API du `sd-server` Drive encore hébergé dans
`aphrody-ui/drive/apps/server`. Une copie additive du binaire source est dans
[`drive-server/`](../../products/web/drive-server/README.md), workspace FSL séparé qui lie le
cœur Drive d'`aphrody-os` au bundle web compilé d'`aphrody-ui`. Elle est
désactivée par défaut : sans
`APHRODY_SITE_DRIVE_UPSTREAM`, `/api/v1/drive/*` répond 404. Pour l'activer,
configurer une origine HTTP en loopback, par exemple
`APHRODY_SITE_DRIVE_UPSTREAM=http://127.0.0.1:8080`. Les requêtes exigent le
jeton Bearer du site (`APHRODY_SITE_WEB_API_TOKEN`). Si le serveur Drive exige
son authentification Basic, fournir `APHRODY_SITE_DRIVE_BASIC_AUTH` au format
`utilisateur:mot-de-passe` au processus du site ; cette valeur ne passe jamais
par le client web.

Les chemins autorisés sont `GET /api/v1/drive/health`,
`POST /api/v1/drive/rpc`, `GET /api/v1/drive/events` (SSE) et
`GET /api/v1/drive/sidecar/{library_id}/{content_uuid}/{kind}/{variant}`.
Les réponses SSE et sidecar sont transmises par flux avec contrôle de débit,
sans chargement complet en mémoire. Les réponses authentifiées portent
`Cache-Control: private, no-store`, et un refus Basic de l'amont est signalé
comme erreur de configuration 502. Le corps RPC est limité à 1 Mio. Le site
conserve son portail `/`, son `/health` JSON et son authentification Bearer.
Un client `fetch` ou serveur qui transmet le header Bearer peut lire le SSE ;
`EventSource` natif dans le navigateur ne peut pas ajouter ce header et n'est
pas pris en charge par cette passerelle avant un contrat de session adapté.
Le bundle SPA Drive et les chemins directs historiques de `sd-server` restent
servis par l'ancien processus : cette passerelle ne prétend pas les remplacer.
La source Drive relève de FSL-1.1-ALv2 et ses restrictions d'hébergement doivent
être vérifiées avant toute offre cloud à des tiers.

```text
source JS/TS ── OXC ───────────────► N2B : règles, codemods, rapports, génération
                                          │ jamais d'exécution du source audité
Bun / TypeScript ── JavaScriptCore ─► build, test, scripts, FFI @aphrody/bun
                                          │
HTTP statique ─────────────────────► aphrody-web-extract : contenu, Markdown,
                                      canonical, chunks, SimHash
page dynamique ── Obscura / V8 ────► aphrody-web-service ─► même extraction
                                          ├─ aphrody-web : CLI, CDP, MCP, scrape
                                          └─ aphrody-browser : outils aphrody-mcp
```

The kernel registers one `aphrody_web` subsystem for the Obscura browser tools
and the configured Aphrody Web Browser MCP provider. `web_browser_fetch` routes the
`render` profile to Obscura; other profiles use the provider's HTTP/browser backend.
Without the provider, those profiles report an unavailable backend instead of
silently returning Obscura output under a curl profile name.

Tauri/CEF is the desktop webview lane. `window_open` creates an interactive
preview window for an `http` or `https` URL with no Aphrody desktop capability.
It is useful for human-visible inspection; it is deliberately not used for crawling, extraction, automation
or artifact production. Those operations remain in the deterministic Obscura/V8
lane above.

## Propriété fonctionnelle

| Surface           | Capacités maintenues                                                                                                              | Propriétaire canonique                                                                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web/Chrome        | fetch, scrape concurrent, `--eval`, proxy, stealth, V8 flags, CDP, serveur MCP, sortie HTML/texte/liens/Markdown/brute            | `aphrody-web-engine` (`aphrody-web`) + Obscura                                                                                                                                                                             |
| Extraction        | HTML, contenu principal, métadonnées/canonical, Markdown, blocs, chunks, SimHash/déduplication                                    | `aphrody-web-extract`                                                                                                                                                                                                      |
| ABI compatibilité | pages persistantes, navigation, évaluation, cookies, headers, blocage de ressources, délais et réseau privé                       | `aphrody-web-render`; conservé tant que chaque contrat ABI n'est pas migré et testé                                                                                                                                        |
| Browser OS        | navigation, snapshot, formulaire, extraction, capture, PDF, cookies, onglets et scripts via les outils `browser_*`                | `aphrody-browser` via `aphrody-web-service`                                                                                                                                                                                |
| N2B               | analyse AST OXC, scanners, règles/codemods, registry, rapports, GitHub audit, prompt, app/win32/linux/wasm/bin/rust/bunpp/llmstxt | fork `aphrody-labs/bun/packages/bun-n2b` (crates `aphrody-n2b*`, npm `@aphrody/bun-plugin-n2b`), voir [N2B.md](../compat/N2B.md)                                                                                           |
| Bun               | installation, workspaces, build, test, scripts et FFI native                                                                      | [Fork `aphrody-labs/bun`](../upstream-bun/APHRODY-FORK.md) (JavaScriptCore), sans module `bun:aphrody` ; les bibliothèques natives Aphrody passent par `bun:ffi`. Voir la [carte Infra](../infra/APHRODY-BUN-PLATFORM.md). |
| Deno              | cible de génération N2B, pas un runtime de produit Aphrody                                                                        | N2B ; `deno_core` reste limité à l'ABI web de compatibilité                                                                                                                                                                |

Les contrats X/XAI, Google et leurs schémas restent des extensions de
compatibilité. Leur migration exige un adaptateur contractuel et des tests de
parité, pas un renommage superficiel.

## Règles d'exécution

- N2B ne lance jamais le JavaScript qu'il audite. OXC fournit l'AST et les
  transformations structurelles.
- Bun n'est pas un navigateur V8. Il est le runtime de tooling et d'FFI ; son
  moteur est JavaScriptCore.
- Seul le chemin page distante autorise V8. Il refuse `file:`, `data:` et les
  schémas personnalisés. Le rendu `--stealth` refuse SOCKS5 plutôt que de
  réécrire silencieusement le proxy.
- Toute page, statique ou rendue, finit dans `aphrody-web-extract`. Le texte
  de `aphrody-web fetch --dump text` et le Markdown ne maintiennent plus deux
  extracteurs DOM divergents.

## Point de migration

`aphrody-web-service` expose le contrat commun : politique OXC/Bun/V8,
session browser JSON, extraction canonique et `PageArtifact`. `aphrody-browser`
l'utilise déjà ; `aphrody-web` l'utilise pour la politique V8 et les sorties.
Le pipeline reproductible est :

```powershell
aphrody-web fetch https://example.test --dump artifact --output page.json
n2b web page.json --report json
```

Le second appel analyse les scripts inline avec OXC et inventorie les scripts
externes sans les exécuter ni les télécharger implicitement.
La C ABI Aphrody Web reste membre du workspace et ne sera retirée qu'après migration
des pages persistantes/cookies/headers/réseau privé avec couverture de parité.

Validation ciblée :

```powershell
$env:RUSTC_WRAPPER=''
cargo test -p aphrody-web-service -p aphrody-browser -p aphrody-web-engine --locked
bun run runtime:check
```
