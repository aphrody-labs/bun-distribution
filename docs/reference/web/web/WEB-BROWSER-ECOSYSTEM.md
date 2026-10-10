<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Web Browser : carte des composants

Cette carte décrit les composants exécutables dans les dépôts `aphrody-web`,
`aphrody-os` et `aphrody-ai`. Le nom public est **Aphrody Web Browser**. Certains noms de
paquets et d'outils historiques restent des identifiants de compatibilité.

| Couche | Autorité et rôle | Accès programmatique |
| --- | --- | --- |
| `aphrody-kernel` / `aphrody_web` | Autorité locale des outils et des événements ; Obscura rend les pages ; le fournisseur MCP héberge le transport HTTP et les missions. | Rust `Kernel::call` ou client IPC, Bun `@aphrody/os`, Python `WebBrowserClient.call_tool`, MCP |
| `apps/bxc/src/api/browser.ts` (not in repo) | Pages, contextes et transport CDP intégrés. | Bun `@aphrody/bxc` et `@aphrody/bxc/browser` |
| `apps/bxc/src/api/WebBrowser.ts` (not in repo) | Passes autonomes bornées, reprise de frontière, recherche de passages et miroir. | Bun `WebBrowser` ; outils `web_browser_*` du noyau |
| `MassiveCrawler` / `RequestQueue` | Frontière SQLite, déduplication URL/contenu, politiques par domaine, robots, Crawl-delay, reprise et recrawl. | Bun `@aphrody/bxc/crawler` |
| `BxcDB` | Documents et passages SQLite/FTS5, provenance et vecteurs locaux facultatifs. | Bun `@aphrody/bxc/db`, `WebBrowser.search`, `web_browser_index_search` |
| `src/cluster` et `AphrodyPg` | Frontière répartie et sink PostgreSQL déjà disponibles pour les volumes supérieurs à une machine ; l'autopilote local reste une instance. | Worker et serveur de cluster existants, `APHRODY_PG_URL` |
| `aphrody-rag`, `aphrody-rag-core`, `aphrody-rag-eval` | Indexation, fusion, recherche et évaluation RAG de la couche AI Aphrody. | Bibliothèques Rust et commandes Aphrody |
| `mirrorSite` | Copie HTML et assets, manifestes, budgets pages/assets/octets. | Bun `@aphrody/bxc/mirror`, `WebBrowser.mirror`, `web_browser_mirror` |
| Acteur RAG | Recherche et extraction de sources en sortie JSON ; la façade ajoute ses passages à l'index commun. | Bun `runActor`, `WebBrowser.research`, `web_browser_rag_research` |
| Acteur site-to-API | Crawl borné, extraction structurée, schéma OpenAPI, types et passages citables dans l'index commun. | Bun `runActor`, `web_browser_site_to_api` |
| Tauri/Wry | Session et prévisualisation de fenêtre, client du noyau. | API de l'application Aphrody OS |
| `aphrody-yolo` | Orchestration des missions et agents, client des outils du noyau. | Client IPC du noyau |

## Cycle d'une mission

`WebBrowser.start()` enchaîne des passes de 16 requêtes par défaut, avec deux
travailleurs maximum, un travail simultané par domaine et une seconde minimale
entre requêtes du même domaine. La frontière et l'index sont conservés sous
`~/.aphrody/web-browser/`. Le premier démarrage part de quelques pages
publiques intégrées si aucune URL n'attend déjà dans la frontière. Les liens
découverts alimentent les passes suivantes. `stop()` termine la passe et
libère les ressources. `crawl()` effectue une seule passe et peut reprendre
la même frontière dans un autre processus. Le crawl et le miroir appliquent
`robots.txt` ; le miroir limite aussi pages, assets et octets.

```ts
import { WebBrowser } from "@aphrody/bxc/web-browser";

const browser = new WebBrowser();
await browser.crawl({ seeds: ["https://example.org"], maxRequests: 8 });
const passages = browser.search("example", 5);
console.log(passages.map(({ url, text, fetchedAt }) => ({ url, text, fetchedAt })));
const research = await browser.research("example", 3);
console.log(research.indexed, research.hits.length);
```

Le noyau publie `web_browser_crawl`, `web_browser_autopilot_start`,
`web_browser_mission_status`, `web_browser_mission_stop`,
`web_browser_index_search`, `web_browser_mirror`,
`web_browser_rag_research` et `web_browser_site_to_api`. Le processus du
fournisseur doit rester vivant pour qu'une boucle d'autopilote continue ;
la frontière et l'index demeurent disponibles après son arrêt.

## Limites observées

- « Tout le Web » est un espace ouvert : aucune exécution finie ne peut
  promettre une couverture exhaustive. Les sources par défaut sont des points
  de départ, et l'expansion dépend des liens rencontrés.
- La recherche FTS5 et les passages citables fonctionnent localement ; les
  vecteurs s'activent uniquement si un modèle local est configuré.
- Les workers de cluster et l'index RAG Rust existent, mais la façade
  `WebBrowser` n'orchestre pas encore automatiquement leur déploiement ou leur
  fusion avec l'index local. `APHRODY_PG_URL` active le sink PostgreSQL du
  crawler quand le service est disponible.
- L'acteur RAG recueille des sources ; la synthèse multi source, la vérification
  croisée et l'évaluation de réponses restent des étapes de recherche à
  piloter au dessus des résultats. L'acteur site-to-API traite actuellement
  sa file en série.
- Le miroir arrête la lecture des réponses HTTP dès le plafond atteint. Le
  transport natif peut encore conserver son propre tampon interne, qui n'est
  pas plafonné par ce lecteur.
- L'installation du binaire et le redémarrage du noyau déterminent la date à
  laquelle les nouveaux outils deviennent visibles dans une session en cours.
