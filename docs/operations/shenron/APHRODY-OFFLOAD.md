# Déport des traitements Shenron vers Aphrody

État du code vérifié le 2026-09-26 ; contrôles d'exploitation historiques
datés du 23 septembre ci-dessous. La carte actuelle des capacités et frontières
est [`APHRODY-ECOSYSTEM.md`](../../architecture/shenron/APHRODY-ECOSYSTEM.md). Aphrody AI possède déjà le
MCP unifié `aphrody-mcp` et les outils `dragonball.*` ; l'ancien service
`shenron-mcp` est supprimé. La disponibilité des services runtime et le
raccordement actif de `RAG_BACKEND` restent à établir par Aphrody-infra et une
sonde live : les anciens constats ci-dessous ne prouvent pas leur état actuel.

## Calcul Shenron depuis le monorepo — 2026-10-03

La voie de remise en service est le mode `--compute-only` des constructeurs et
adaptateurs existants. Elle sélectionne `aphrody-ai-http` et
`aphrody-shenron-embed`, avec les trois binaires `aphrody-mcp`, `aphrody-embed`
et `aphrody-llama-daemon`. Le compagnon daemon est construit depuis le même
commit que le gateway. Le modèle et sa LoRA, les poids E5, les bases, Redis et
les fichiers privés restent dans leurs stores protégés.

Le contrôle live du 3 octobre confirme le bot et le site actifs sur le VPS,
les deux unités de calcul inactives et le RAG public en `index_unavailable`.
La copie locale de production sert de corpus de qualification : PostgreSQL
éditorial réel, Redis réel, exports Dragon Ball frais et index E5 PostgreSQL.
Son ingestion est en cours. Le préchargement complet refuse actuellement la
qualification ; la mesure provisoire précédente (Recall@5 75,58 %) reste
inférieure au seuil de 80 %. Ces constats ne constituent pas une activation.

Préparer les sources depuis un commit contenant le mode compute, puis construire :

```bash
bash scripts/build/build-aphrody-stack-release.sh --compute-only --plan "$PWD" "$(git rev-parse HEAD)"
bash scripts/build/build-aphrody-stack-release.sh --compute-only "$PWD" "$(git rev-parse HEAD)"
```

Le constructeur vérifie les sources externes avec leur propriétaire existant,
exporte le commit et fige les dépendances de chemin avec leurs empreintes.
Les trois builds passent successivement par `cargo-serial.sh`, avec sccache et
deux jobs par défaut. La sortie privée contient `SOURCE.json`, `RELEASE_ID`,
`RELEASE_SHA`, `SHA256SUMS`, les unités et la migration RAG ; aucun `SMOKE.json`
n'est produit par un build. Les logs et le snapshot sont conservés si un build
échoue. Le constructeur ne déploie ni ne redémarre de service.

Servir les binaires candidats avec le profil privé Shenron, puis qualifier :

```bash
bun scripts/tools/shenron/scripts/ops/eval-aphrody-rag.ts --ci --attest-release /chemin/prive/de/la/release
```

Cette commande exige le préchargement complet par `requireLiveRag`, vérifie les
listeners et les empreintes des processus MCP/E5, puis utilise l'intégralité
du gold du commit de la release. Elle impose Recall@5 ≥ 80 %, p95 < 8 s,
zéro erreur et un mode hybride. Une question reçoit les passages Dragon Ball
retrouvés ; le modèle managé doit répondre en moins de 90 s avec une de leurs
URL. Le daemon doit appartenir à la release et le processus modèle doit avoir
chargé la LoRA configurée. Le corpus et les binaires sont revérifiés avant
l'écriture atomique de `SMOKE.json` (`aphrody-compute-smoke/v1`). La preuve
contient les empreintes du modèle et de la LoRA, sans réponse brute ni secret.
Cette sonde ne remplace pas une qualification complète du modèle ou du ML.

Le temps de démarrage froid Qwen+LoRA déjà mesuré est de 111 s, supérieur au
timeout client de 90 s ; la disponibilité avant le raccordement produit reste
donc à établir. Le reranker et un nouveau cycle d'entraînement ne sont pas
qualifiés par ces résultats.

Sur le VPS, prévoir un store RAG dérivé dédié : pgvector 0.8.1 y est disponible,
alors qu'il est absent sur DBFR. DBFR conserve `shenron_site` comme base
éditoriale primaire. Le DDL canonique est
[`0001_shenron_postgres.sql`](../../../crates/ai/rag/migrations/0001_shenron_postgres.sql)
(documents, vecteurs E5 384 et invalidation transactionnelle du cache) ; le
gateway n'exige pas de table de chunks séparée. Sauvegarde, transfert vérifié,
provisionnement et raccordement restent à réaliser. Les anciens dumps et les
59 995 passages historiques ne qualifient pas ce corpus frais.

Après qualification du bundle, des données et du catalogue, la commande Infra
ci-dessous décrit le déploiement sans mutation :

```bash
aphrody-infra deploy --target vps --stack aphrody-compute --release /srv/aphrody/releases/ID
```

`--apply` appelle le même adaptateur avec `--compute-only`. Le préflight exige
une attestation liée aux checksums, le profil AI privé et les poids disponibles ;
les unités site/Web/A2A doivent être inactives car elles partagent `current`.
Les probes après activation portent sur les processus réellement lancés,
l'authentification, E5, le chat, la santé et le RAG hybride. Le backup conserve
mode et roster ; `--restore BACKUP` restaure uniquement ce roster et le lien
`current`. Aucun retour arrière réel de ce mode n'a encore été exécuté sur VPS.
Le catalogue marque encore le calcul retiré : le réconcilier après les preuves
requises, avant toute activation, sans réactiver les anciennes routes publiques.

## Frontières de service

| Fonction | Propriétaire cible | Contrat introduit | État du raccordement Shenron |
| --- | --- | --- | --- |
| Génération LLM du bot et du pipeline IA | Aphrody AI + Gemini Web | `POST /api/v1/shenron/llm/chat` avec `model=gemini-web/flash` | Client branché ; la génération reçoit les passages du RAG Aphrody ; réponse de repli du bot conservée |
| OCR des images du bot, lots manga/databooks et scripts historiques | Aphrody AI + Gemini Web | `POST /api/v1/shenron/ocr` avec `engine=gemini-web`, `/vision/structured` avec `model=gemini-web/flash` | Images envoyées par le client Rust Gemini Web ; PP-OCR conserve les lots exigeant des polygones ; arbitrage visuel des lots confié à Gemini Web ; qualité sur pages réelles à mesurer |
| Recherche et ingestion RAG | Aphrody AI | `GET /api/v1/shenron/rag/search`, `POST /api/v1/shenron/rag/ingest` | 59 995 passages importés dans PostgreSQL Aphrody ; recherche lexicale vérifiée sur la release active ; fusion E5 non active |
| Traduction databooks JA→FR | Aphrody `aphrody-translate` local, orchestré par Shenron | CLI one-shot `--source ja --target fr --backend google` | Branché et vérifié en isolation ; Shenron conserve le lexique, les juges, le dépôt PostgreSQL et l'ingestion RAG. Ce n'est pas une route API distante et le backend BXC reste un repli séparé |
| Crawl Web générique et collecteurs spécialisés | Aphrody Web/BXC | `/api/v1/web/crawl`, `/api/v1/web/scrape` | Crawl et scrape HTTP vérifiés en production ; indexation des passages corrigée et vérifiée sur un binaire candidat isolé, en attente de release |
| MCP calcul et éditorial Shenron | Aphrody AI | `aphrody-mcp` unifié ; `dragonball.*` (30 publics, 5 admin) et capacités locales/AI selon features | Code compilé dans `crates/ai/mcp`; l'ancien `apps/shenron-mcp` (not in repo), OAuth dédié et endpoint public sont retirés. L'activation courante dépend du catalogue infra et du client local. |
| Opérations de bureau non headless | Aphrody OS local | `aphrody-kernel` | Audit des chemins Shenron actifs : aucun navigateur visible ni contrôle de fenêtre à migrer ; capacité locale Aphrody OS disponible pour de futurs parcours interactifs |

Les routes AI sont privées et exigent `APHRODY_SHENRON_API_TOKEN` identique côté service et client. Le client AI n'accepte que HTTP sur loopback. Le client Web exige `APHRODY_BXC_API_TOKEN` et HTTPS (ou HTTP loopback). Aucun jeton ne doit être placé dans les commandes, journaux ou commits.

## Capacités Aphrody effectivement examinées

- **Deux RAG distincts.** Le RAG générique Aphrody emploie SQLite FTS5, des vecteurs denses en BLOB, une fusion RRF (k=60) et un reranker facultatif. Le contrat Shenron est une autre voie : documents éditoriaux et filtres dans PostgreSQL, vecteurs E5 384 dimensions dans pgvector, recherche lexicale puis fusion lexicale/vectorielle quand l'embedder compatible répond. Les 59 995 vecteurs stockés ne suffisent pas à activer cette dernière étape : il faut aussi vectoriser la requête avec le même modèle. Le mode renvoyé par l'API fait foi.
- **OCR et modèle visuel.** `aphrody-ocr-core` fournit les statuts `Text`, `NoText`, `Unreadable`, `NeedsReview` et `ProcessingError`, les polygones en pixels originaux, confiance, provenance et audit des scripts étrangers/boucles. PP-OCR/ONNX sert aux lots où la géométrie compte. Le SDK Rust Gemini Web sait authentifier une session, envoyer du texte ou une image et sélectionner Flash Lite, Flash ou Pro ; Shenron choisit Gemini Web pour la lecture visuelle et la réponse à partir des passages RAG. Ce modèle ne remplace pas les polygones mesurés de PP-OCR. Le contrat de code existe, mais aucune réponse Gemini authentifiée n'a été obtenue.
- **Web et navigateur.** BXC sait extraire, crawler, conserver le Markdown/HTML, les métadonnées et les passages recherchables dans SQLite. Son API navigateur possède notamment les profils `static`, `http` et `render` ; `render` exécute JavaScript dans la bibliothèque V8 native en processus. D'autres alias figurent dans l'API TypeScript, mais leur disponibilité via l'API HTTP déployée n'est pas prouvée. Le navigateur visible, les fenêtres et l'interaction non headless relèvent d'Aphrody OS local (`aphrody-kernel`/`aphrody-browser`), pas du crawler VPS.
- **MCP.** `aphrody-ai-http` expose le calcul RAG, OCR, embeddings, vision et LLM sous jeton privé. Le binaire local unifié `aphrody-mcp` porte les outils publics/admin `dragonball.*` et appelle les API Shenron ; les tâches A2A sont déposées côté hub du site. L'unité et l'URL publiques de l'ancien `shenron-mcp` n'existent plus. Le kernel MCP d'Aphrody OS reste une autre autorité, dédiée au poste. Compiler un outil ne prouve pas qu'un service ou un backend est actif.

Contrôle de production du 23 septembre 2026 : `aphrody-ai-http` répond sur `8789` avec `rag=true`, `llm=false`, `ocr=false` et une recherche « Son Goku » renvoie trois résultats en mode `lexical`. La route Web publique authentifiée `/api/v1/web/crawl/stats` répond 200 ; un scrape de `dragon-ball-official.com` et un crawl borné ont réussi. La release Web active a stocké la page sans aucun passage (`scrapes=1`, `chunks=0`) : sa recherche ne pouvait donc pas la retrouver. Un binaire candidat isolé, utilisant la correction `upsertDocument` et le découpage du Markdown lorsque l'extracteur natif ne produit rien, a indexé 11 passages et retrouvé l'URL officielle via HTTP. Ce binaire a été arrêté ; la release active n'a pas reçu ce correctif.

Gemini Web utilise la session Google signée du service Aphrody, lue depuis `APHRODY_SHENRON_GEMINI_COOKIE_FILE`. La release attend `/srv/aphrody/shared/ai/google-cookies.json`, propriétaire `aphrody`, mode `0600`. Le modèle ne fournit pas de géométrie OCR mesurée : les traitements de planches qui exigent des polygones continuent d'appeler PP-OCR dans Aphrody, puis soumettent leur revue visuelle à Gemini Web. Les réponses RAG utilisent les passages du moteur Aphrody ; Gemini Web n'est pas l'index ni la source de vérité. Une session absente ou rejetée produit une erreur, sans prétendre que le modèle a répondu.

Contrôle local du 23 septembre 2026 : le fichier de session existe, mais Google renvoie une page de connexion sans le jeton de session attendu. Un appel OCR HTTP réel avec une image synthétique atteint bien Aphrody et échoue avec `Gemini Web page bootstrap failed` (502). Une nouvelle session Google valide est nécessaire pour prouver l'OCR et la génération RAG de bout en bout. Ce constat ne valide ni la session ni les services de production.

## Bascule RAG contrôlée

1. Démarrer Aphrody AI avec PostgreSQL et les routes Shenron, puis vérifier `/api/v1/shenron/health` avec le jeton.
2. Faire une prévisualisation sur une **copie ou un instantané cohérent** de la SQLite RAG avec `bun scripts/ops/offload-rag-to-aphrody.ts --db <chemin>`. Elle vérifie les lignes et ne les écrit pas. Une URL source absente ou non HTTP(S), un titre ou un contenu vide bloquent l'import au lieu de fabriquer une citation.
3. Copier les passages avec `--apply` via l'API ou générer `--pg-csv <fichier>` pour un import transactionnel PostgreSQL. La clé `shenron:<rowid>` rend l'opération rejouable ; `originSourceId`, `entity`, `kind` et `lang` préservent les filtres. Ne pas utiliser le `rag-build.ts` historique sur la base servie : il recrée des tables.
4. Exécuter `bun scripts/ops/eval-aphrody-rag.ts --ci`. Le rappel doit être mesuré sur le jeu d'or avant d'activer le runtime. Le seuil par défaut de Recall@5 est 0,8 (`RAG_CI_RECALL5_MIN`). L'évaluation actuelle porte sur la recherche lexicale PostgreSQL ; elle ne valide pas la fusion vectorielle.
5. Après validation, définir `RAG_BACKEND=aphrody` pour le bot et le site. La recherche et les filtres passent alors par Aphrody ; le contexte utilise son contenu renvoyé (tronqué à 8192 caractères par résultat) et n'interroge plus la table locale RAG. Le champ `mode` reflète `lexical`, `hybrid` ou `hybrid+rerank` selon le moteur réellement utilisé.

Les routes locales restent présentes tant que les appels et les tests qui en dépendent n'ont pas été migrés. Une panne Aphrody remonte comme échec de recherche ; le bot ne lance pas silencieusement un calcul RAG local lorsque `RAG_BACKEND=aphrody`.

## Synchronisation continue

En mode `RAG_BACKEND=aphrody`, les commandes historiques de reconstruction et de resynchronisation du RAG délèguent à `packages/shenron/pipeline/scripts/rag-sync-aphrody.ts`. Chaque source éditoriale est rendue depuis PostgreSQL, validée puis envoyée à Aphrody avec des identifiants déterministes et un identifiant de génération. Le script tient un manifeste local ignoré par Git et ne réécrit pas une source inchangée. Après réception de tous les documents, `/api/v1/shenron/rag/sync/finish` vérifie le nombre annoncé et masque logiquement les anciens passages de cette source (`metadata.visible=false`). La recherche, les statistiques et la lecture par identifiant ignorent les passages masqués. Un lot incomplet ne déclenche pas le masquage ; des doublons peuvent rester visibles jusqu'à la reprise du lot. Une source vide exige une revue explicite et n'est jamais masquée automatiquement.

La bascule initiale doit synchroniser toutes les sources et comparer les compteurs et le jeu d'or avant activation du bot. Le manifeste est un cache de travail : avant de sauter une source inchangée, le synchroniseur vérifie son compteur et une entrée déterministe dans Aphrody. Sa présence seule ne prouve pas que le corpus distant est intact. Le corpus initial importé depuis SQLite reste la source de comparaison et n'est pas supprimé.

Le 23 septembre 2026, une sauvegarde cohérente du réplica SQLite DBFR a été vérifiée par SHA256, puis ses 59 995 passages ont été importés par transaction dans `aphrody_rag_documents` sur le VPS. Les contrôles post-import trouvent 59 995 clés distinctes, aucune valeur vide dans les champs de citation et aucune URL invalide. Le CSV conservé hors dépôt a pour SHA256 `6e701d148d79a276e9c4d8eb504d029e0ee5260f600942f4c70df378f53f1d25`. Les index de corpus et de recherche sont reproductibles avec `scripts/shenron-rag-indexes.sql` (not in repo) dans le dépôt Aphrody AI. La source SQLite n'a pas été supprimée.

La première évaluation PostgreSQL en lecture seule donnait Recall@5 = 0,3430 sur 172 cas ; la baseline lexicale SQLite sur la même sauvegarde donnait 0,7267. Après correction du classement, les paramètres produits par les fonctions Rust et la requête SQL extraite du service ont été évalués sur PostgreSQL : Recall@5 = 0,8663 (149/172), 9/9 questions japonaises, 3/4 questions manga, p95 = 1,891 s et maximum = 4,732 s. La requête respecte le délai de recherche de 8 s sur ce jeu. Ce contrôle n'a pas traversé HTTP ni les services déployés : maintenir `RAG_BACKEND=aphrody` désactivé en production jusqu'à la vérification de la release et des modèles réels.

Le corpus SQLite contient aussi 59 995 vecteurs alignés aux passages, produits par `Xenova/multilingual-e5-small` en 384 dimensions. Ils ont été importés dans la table pgvector Aphrody : 59 995 lignes, 59 995 documents distincts et dimensions min/max 384/384 après COMMIT. Le CSV source vérifié a pour SHA256 `4f3c1debdd6e212352c214485281ee1fb52cdaa46d3c98bae265e6a94c9e5a7b`. La fusion côté Aphrody refuse un embedder d'un autre modèle ou d'une autre dimension. L'évaluation lexicale ci-dessus précède le chargement du service E5 et ne mesure donc pas la fusion vectorielle.

Le service E5 Aphrody a ensuite été chargé avec les poids officiels q8 et cinq vecteurs reconstruits ont atteint une similarité cosinus de 0,99736 à 0,99832 contre l'archive. Une copie du cache avait été vérifiée sur le VPS (SHA256 ONNX `f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193`, tokenizer `0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39`), et un service temporaire a répondu `/health` 200 et `/v1/embeddings` 200 ; il a été arrêté après le contrôle. Une évaluation en lecture seule a généré les 172 requêtes avec ce service, exécuté le SQL lexical Rust et la recherche pgvector HNSW, puis appliqué la même fusion RRF k=60 et déduplication d'URL : Recall@5 lexical 0,8663, vectoriel 0,7558, hybride **0,9186** ; Recall@10 hybride 0,9767 ; MRR hybride 0,7931. Les artefacts sont sous `var/runs/20260923-shenron-aphrody-offload/evidence/eval-hybrid.*`. Lors du nouveau contrôle du 23 septembre, le chemin attendu `/srv/aphrody/shared/models/shenron-e5` est vide et aucun cache E5 compatible n'a été trouvé dans les chemins Aphrody inspectés. Le cache antérieurement vérifié doit être localisé ou restauré avant l'activation du service permanent. Cette évaluation ne traverse pas l'API HTTP déployée.

## Crawl distant

`bun scripts/ops/aphrody-web-crawl.ts <https-url> --max-depth 1 --max-requests 25 --wait` soumet un crawl borné, puis attend son statut. `bun run pipeline crawl custom <https-url>` soumet le même travail sans attendre. Les pages sont indexées côté Aphrody Web ; aucune importation éditoriale PostgreSQL ou RAG n'est implicite. Les tâches spécifiques `official`, `kanzenshuu`, `dragonballcn` et `databooks` conservent leurs extracteurs tant que leur transformation et leur stockage n'ont pas de contrat distant.

Les identifiants et états de jobs sont en mémoire du processus BXC : un redémarrage efface le statut du job, même si les pages déjà indexées restent stockées. Le crawl distant est headless. Les collecteurs spécialisés récupèrent les pages par Aphrody Web et gardent leur extraction métier, leur suivi et leur stockage dans Shenron.

## Validation nécessaire avant publication

- Compiler et tester séparément Aphrody AI, Aphrody Web et Shenron ; comparer le jeu d'or RAG sur les données réelles.
- Sur le VPS observé le 23 septembre, PostgreSQL `aphrody.aphrody_rag_documents.id` est un UUID. Le rôle système `aphrody` peut écrire via l'authentification locale ; `ubuntu` est en lecture seule. L'unité AI doit donc s'exécuter sous `aphrody` avec une URL de connexion au socket local sous ce même rôle. L'import réel de 59 995 lignes est terminé et vérifié.
- Vérifier avec les services réels : premier import dans un corpus vide, une requête RAG filtrée, un appel LLM, une image OCR et un crawl dont les pages apparaissent dans l'index BXC.
- Vérifier la release active et les secrets de service via `aphrody-infra` avant toute bascule de trafic. Les changements de code de ces dépôts ne constituent pas un déploiement.

Contrôle VPS actualisé le 23 septembre 2026 : `aphrody-ai-http` et `aphrody-web-api` sont actifs ; le jeton Shenron privé a été provisionné côté AI et dans un fichier client root `0600`, sans être affiché. La configuration Web active a été corrigée pour écouter sur `3007` et écrire dans `/srv/aphrody/shared/bxc/storage` ; Nginx route `/api/v1/web/` vers ce port. `aphrody-shenron-embed`, `shenron-mcp`, `shenron-bot` et `shenron-site` restent absents/inactifs, leurs ports `8790`, `5010`, `5006`, `5011` fermés. La release AI active ne contient pas encore le raccordement Gemini Web récent ; sa session Google de production manque, et la session locale testée est rejetée. La construction immuable exige toujours les trois checkouts propres et épinglés ; les changements de code n'ont pas été déployés. Aucun trafic Shenron n'a été basculé.

Tentative d'activation de `RAG_BACKEND=aphrody` en production, le 23 septembre 2026, **NON_FAIT, retour arrière appliqué**. La release déployée (`/srv/shenron/current` -> `63426cfb`) lit `RAG_BACKEND` au runtime dans le bot (`lib/rag.ts`, `api/server.ts`, `TrainingService`, `semantic-cache`, `commands/wiki/Ask.ts`) et dans le site (`lib/site-rag.ts`). Le client `@shenron/pipeline/aphrody` (`packages/shenron/pipeline/src/aphrody/compute.ts`) lit `APHRODY_SHENRON_API_URL` et `APHRODY_SHENRON_API_TOKEN`. Ces deux noms sont bien présents dans `/etc/aphrody/shenron-compute-client.env`, chargé par les deux unités. Les fichiers `/etc/rose-griffon/shenron-bot.env` et `shenron-site.env` ont été sauvegardés sous `/srv/shenron/shared/deploy-backups/20260923T202208Z/`, puis ont reçu `RAG_BACKEND=aphrody`. `shenron-bot` a été redémarré, puis `shenron-site` (20:22 UTC). La recherche publique `/api/public/rag/search` répondait bien par Aphrody : les rowid correspondent aux `sourceId` `shenron:<n>`, avec 4/4 requêtes servies (Goku, Vegeta, Freezer, Shenron) et `/api/public/rag/context` fonctionnel. Le mode renvoyé restait `lexical` et non hybride. La vérification a échoué sur trois régressions. Le chat public sans session du site (`/api/chat`) a renvoyé HTTP 503, car il appelle directement `/api/v1/shenron/llm/chat` d'Aphrody, qui répond 502 : `/api/v1/shenron/health` annonce `llm:false, ocr:false`. `/api/ia/status` du bot a renvoyé 500, car `/api/v1/shenron/rag/stats` répond 404 dans la release Aphrody active. Enfin, l'`AutoEvalCron` du bot a journalisé deux `HTTP 503` sur `/api/v1/shenron/rag/search` pendant la rafale d'évaluation au démarrage. Les sauvegardes ont été restaurées et les unités redémarrées. Après retour arrière, les deux unités sont actives et aucun processus ne porte `RAG_BACKEND`. `/api/public/rag/search` renvoie 200 avec 3 résultats, `/api/ia/status` 200, `/api/chat` 200 et `/` 200. Commande de retour arrière (sur `vps`) : `sudo cp -a /srv/shenron/shared/deploy-backups/20260923T202208Z/shenron-bot.env /srv/shenron/shared/deploy-backups/20260923T202208Z/shenron-site.env /etc/rose-griffon/ && sudo systemctl restart shenron-bot && sudo systemctl restart shenron-site`. Avant une nouvelle tentative, il faut qu'Aphrody AI expose `llm/chat` (`llm:true`) et `rag/stats`, que le service E5 soit actif pour obtenir le mode `hybrid`, et que la limite de concurrence de `rag/search` supporte la rafale `AutoEvalCron`. Une autre option serait de n'activer que le bot, car sans la variable, le site délègue le chat au bot.
