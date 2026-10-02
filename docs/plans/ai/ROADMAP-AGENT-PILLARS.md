# ROADMAP-AGENT-PILLARS.md — Piliers Shenron et Aphrody AI

> **Autorité de ce document :** Aphrody AI (`docs/PLAN.md` (not in repo) reste le plan de livraison maître).
> **Propriétaires des faits :** Shenron pour les données éditoriales et l'API;
> Aphrody AI pour le CLI, les outils MCP et les agents; Aphrody UI pour la surface desktop;
> `aphrody-infra` pour les services, routes, hôtes et déploiements.
> **Mise à jour du routage :** 27 septembre 2026.

> **Limite de preuve :** les métriques détaillées ci-dessous sont un instantané
> documentaire daté, reprises depuis les sources et rapports alors disponibles.
> Elles n'ont pas été rafraîchies depuis PostgreSQL ni revalidées par des sondes
> live dans cette consolidation. Ne pas les présenter comme l'état actuel sans
> vérification dans leur dépôt ou système propriétaire.

---

## 1. Architecture & Intégration Souveraine Aphrody AI <-> Shenron

### 1.1 Frontières de responsabilité
- **Shenron** reste propriétaire des données canoniques, PostgreSQL, des routes/API d'administration, de l'autorisation côté serveur, du site et du bot. Les écritures doivent passer par ses APIs et sa journalisation; aucun client Aphrody n'ouvre PostgreSQL directement.
- **Aphrody AI** possède le CLI, les clients et outils MCP, l'orchestration agent et les opérations locales. Les outils d'administration existants sont servis par `aphrody-mcp` et échouent en mode fermé si leurs secrets serveur ne sont pas configurés.
- **Aphrody UI** possède l'application desktop. Son Chat utilise l'app-server et sait rendre des appels MCP typés; il ne reçoit ni jeton admin ni cookie de session Shenron.
- **Aphrody Infra** est l'autorité des services, hôtes, routes et déploiements. Utiliser ses catalogues/runbooks, sans recopier son inventaire ici.

### 1.2 Accès d'administration depuis Aphrody

Le CLI peut découvrir les serveurs et outils MCP configurés avec `aphrody mcp
list`, puis appeler un outil connu avec `aphrody mcp call <serveur> <outil>
--args '<objet JSON>'`. Dans le catalogue observé le 27 septembre, le serveur
`aphrody` expose `dragonball.admin_bot_commands`, `dragonball.admin_services`,
`dragonball.admin_bot_command_execute`, `dragonball.admin_service_action` et
`dragonball.admin_databooks_deposit`. `admin_services` a répondu lors d'un appel
de lecture dans cette consolidation; cela ne prouve pas que les opérations
mutatrices sont autorisées ou que la production est à jour.

Exemples de lectures CLI :

```powershell
aphrody mcp call aphrody dragonball.admin_services --args '{}'
aphrody mcp call aphrody dragonball.admin_bot_commands --args '{}'
```

Avant une action, lire le catalogue pertinent. Exécuter une commande de bot,
une action de service ou un dépôt uniquement à la demande explicite de
l'utilisateur, puis vérifier le résultat séparément. Les secrets
`SHENRON_API_ADMIN_TOKEN` et `SHENRON_DATABOOKS_API_TOKEN` restent dans
l'environnement privé du serveur MCP; ne pas les mettre dans les arguments,
URLs, WebView ou les journaux.

Dans l'UI, les outils passent par l'app-server et le Chat existants, qui
projettent les événements `mcpToolCall`. La configuration MCP doit être
disponible au processus app-server. Le statut d'app-server ne maintient pas de
connexion MCP ni de décompte de tools; aucun panneau desktop autonome ni
connexion Better Auth Shenron n'est actuellement attesté. Cette voie ne doit
pas être décrite comme vérifiée dans l'UI sans essai de session correspondant.

`aphrody shenron auth status` n'inspecte que la présence locale des identifiants
et indique que la session distante n'est pas vérifiée; `auth url` imprime le
formulaire sans secret; `auth test` est une sonde réseau des mécanismes
configurés, pas une validation du chemin admin UI.

---

## 2. Instantané documentaire des 7 piliers — à rafraîchir

```
+-----------------------------------------------------------------------------------+
|                           LES 7 PILIERS SHENRON / APHRODY                         |
+---------------------+-------------------------------+-----------------------------+
| Pilier              | État Réel Observé (Base / OS) | Backlog Restant             |
+---------------------+-------------------------------+-----------------------------+
| 1. Wiki             | 100 % entités fondamentales   | Enrichissement biblio &     |
|                     | (672 persos, 22 sagas, etc.)  | illustrations résiduelles   |
| 2. OCR              | Manga 100 % (12 593 planches) | 2 528 pages databooks en    |
|                     | Databooks : 16 402 p. JA      | quarantaine à relire/filtrer|
| 3. Databooks        | 470 ouvrages catalogués       | Sōshūhen 2-18 (scans WSJ)   |
|                     | 426 avec métadonnées complètes| Sommaires des mini-guides   |
| 4. Manga            | 12 593 planches intégrées     | Synchronisation flux DBS    |
|                     | 519 chapitres originaux       | Découpage fin par bulle     |
| 5. Traduction       | 11 318 pages traduites FR     | 2 556 pages admissibles     |
|                     | Worker boucle opérationnel    | à traduire par lots validés |
| 6. RAG              | 28 583 passages indexés       | Raccordement sidecar E5,    |
|                     | BM25 natif fonctionnel        | Gold eval (Recall@5 > 85%)  |
| 7. Chat LLM         | Persona Tori-bot canonisé     | Streaming dans Next.js /ask |
|                     | Modèles Gemini/locaux testés  | Garde-fous anti-hallucination|
+---------------------+-------------------------------+-----------------------------+
```

---

### Pilier 1 — Wiki & Entités Éditoriales

#### État Actuel Vérifié (PostgreSQL 17 `shenron_site`) :
- **Personnages (`bot.db_characters`)** : 672 / 672 avec `name_ja` (100.00 %).
- **Techniques (`bot.db_techniques`)** : 25 / 25 avec `creator_id` et chapitres d'origine (100.00 %).
- **Transformations (`bot.db_transformations`)** : 17 / 17 canonisées SSJ1/2/3 avec slugs réalignés (100.00 %).
- **Races (`bot.db_races`)** : 18 / 18 avec `name_ja` et origines reliées (100.00 %).
- **Planètes (`bot.db_planets`)** : 62 / 62 sourcées Daizenshuu 4/7 (100.00 %).
- **Sagas Manga (`bot.db_manga_sagas`)** : 22 sagas continues, 519 / 519 chapitres partitionnés sans trou (100.00 %).
- **Films (`bot.db_films`)** : 28 / 28 classés selon la doctrine des 5 Rangs (100.00 %).
- **Mangathèque (`bot.db_manga_chapters`)** : 922 / 922 chapitres avec tomes et dates (100.00 %).
- **Entités Annexes** : Dragons (5/5), Objets (5/5), Lieux (20/20) vérifiés (100.00 %).
- **Traçabilité** : 100 % des modifications consignées dans `public.wiki_revisions` avec snapshots JSON.

#### Backlog Restant :
1. **Enrichissement bibliographique approfondi** : Les fiches principales disposent de références primaires complètes ; les ~600 fiches secondaires nécessitent d'indexer leurs chapitres d'apparition exacte et mentions Daizenshuu 7 / Chōzenshū 1.
2. **Couverture visuelle intégrale** : Compléter l'association des illustrations officielles Toriyama / Daizenshuu sur les fiches d'objets, lieux et artefacts récemment ajoutées.
3. **Modération des propositions communautaires** : Arbitrer les propositions de révision en attente via l'interface `/admin/dashboard` ou les scripts dédiés.

---

### Pilier 2 — OCR & Vision

#### État Actuel Vérifié :
- **Manga** : 12 593 / 12 593 planches transcrites sans lacune (8 238 Dragon Ball classique, 4 355 Dragon Ball Super sur 44 tomes et 103 chapitres).
- **Databooks** : 16 402 pages transcrites en japonais.
- **Ressources locales** : 29 modèles locaux (~61 Go dans `~/.aphrody/models`), accélération CUDA 13.3 sur RTX 4070 (12 Go VRAM). Modèles d'OCR disponibles : `ppocr-v5-mobile`, `dots-ocr`, `florence2`.

#### Backlog Restant :
1. **Traitement de la quarantaine databooks** : **2 528 pages** sont actuellement en quarantaine OCR (`databook_pages` avec drapeau quarantaine / bruit).
   - Ces pages contiennent du bruit OCR, des mises en page complexes (fonds tramés, encarts minuscules, doubles pages d'illustrations).
   - Action requise : Exécuter `relecture-ocr.ts` avec les modèles de vision locaux ou une inspection visuelle assistée pour nettoyer le texte japonais avant injection.
2. **Réingestion validée** : Aucune écriture brute en base sans passage par les filtres de qualité et traçabilité dans `wiki_revisions`.

---

### Pilier 3 — Databooks & Ouvrages de Référence

#### État Actuel Vérifié :
- **Catalogue** : 470 ouvrages référencés dans `bot.db_databooks`, dont 426 avec métadonnées japonaises complètes (`title_ja`).
- **Scans disponibles** : 17 369 pages physiques cataloguées.
- Daizenshuu 1 à 7, Chōzenshū 1 à 4, Landmark, Forever, TV Animation complètement indexés.

#### Backlog Restant :
1. **Sōshūhen Jump Legend volumes 2 à 18** :
   - Suite au signalement #21 résolu, les fausses planches DBFC françaises ont été purgées.
   - Les chapitres 35002 à 35018 restent en statut « À compléter » (`visible = false`).
   - Action requise : Dès acquisition des scans originaux Shueisha B5 du Weekly Shōnen Jump (posters dépliants, pages 4C/2C, dossiers Jump ERA), réintégrer les planches japonaises authentiques.
2. **Indexation des interviews de Toriyama** : Vérifier la correspondance 1:1 entre les sections d'interviews extraites et le registre canonique `docs/products/shenron/toriyama-interviews.md`.
3. **Métadonnées des mini-guides** : Finaliser le catalogage des ouvrages annexes (Carddass, Comics d'animation de films).

---

### Pilier 4 — Manga & Continuité Graphique

#### État Actuel Vérifié :
- 100 % des planches de l'œuvre originale (tomes 1 à 42, 519 chapitres) sont transcrites et associées à leurs tomes et sagas.
- Chapitres spéciaux (Jaco the Galactic Patrolman, Dragon Ball Minus) intégrés.
- Dragon Ball Super : 103 chapitres transcrits.

#### Backlog Restant :
1. **Synchronisation continue DBS** : Lors de la parution de chaque nouveau chapitre dans le *V-Jump*, ingérer les planches, transcrire les dialogues et relier les entités.
2. **Segmentation des dialogues par bulle** : Améliorer le mapping locuteur -> bulle de texte -> coordonnées spatiales pour la recherche visuelle de scènes.

---

### Pilier 5 — Traduction Japonaise vers Français

#### État Actuel Vérifié :
- **Pages traduites** : 11 318 pages de databooks disposent d'une traduction française rigoureuse.
- **Dictionnaire canonique** : Alignement strict sur `dragon-ball-japonais` et `apps/shenron/site/scripts/inventaires/canon-citations-fr.json` (terminologie Toriyama : Kamehameha, Genki Dama, Kaio-ken, Super Saiyan, etc.).
- **Worker d'arrière-plan** : Script `traduction-boucle.ts` opérationnel avec filtres anti-hallucination et élimination du bruit résiduel.

#### Backlog Restant :
1. **Traduction des pages admissibles** : **2 556 pages** transcrites en japonais sont éligibles à la traduction française.
2. **Méthode d'exécution** :
   - Traitement par lots supervisés via `traduction-boucle.ts` (local ou cloud LLM avec contrôle de lexique).
   - Dépôt transactionnel dans `databook_pages.translation_fr` sans injection directe non supervisée (`deposit --apply` par lot vérifié).
   - Journalisation de chaque lot dans `public.wiki_revisions`.

---

### Pilier 6 — RAG (Retrieval-Augmented Generation)

#### État Actuel Vérifié :
- **Corpus documentaire** : 28 583 passages indexés (24 805 databooks, 3 771 wiki, 7 doctrine canon).
- **Moteur lexical** : BM25 natif Bun et FFI SQLite hautement performant.
- **Modèles vectoriels locaux** : `multilingual-e5-small` (384 dimensions) et `bge-reranker-base` configurés dans l'environnement local.

#### Backlog Restant :
1. **Stabilisation du sidecar d'embedding distant** :
   - Rétablir la disponibilité continue du service distant `aphrody-ai-embed` (port 18794 sur VPS via tunnel SSH) pour le mode hybride distant.
2. **Évaluation Golden RAG (Benchmark)** :
   - Le corpus de test `rag-gold.jsonl` contient 172 requêtes d'évaluation.
   - En mode BM25 pur, le Recall@5 mesuré est de 9,3 % (156 requêtes non couvertes dans le top 5).
   - Objectif : Atteindre un Recall@5 > 85 % grâce à la recherche hybride dense (E5) + creuse (BM25) et au reranking.
3. **Indexation des dialogues Manga** : Intégrer les dialogues transcrits des 12 593 planches de manga dans le corpus vectoriel.

---

### Pilier 7 — Chat LLM & Persona Tori-bot

#### État Actuel Vérifié :
- **Persona Canonique** : Persona **Akira Toriyama (Tori-bot)** validé : bienveillant, humble, passionné d'anecdotes de création, rigoriste absolu sur les faits du manga original.
- **Inférence CLI** : `aphrody shenron persona ask` fonctionne localement.
- **Client Gemini** : Validé avec succès via `aphrody antigravity chat`.

#### Backlog Restant :
1. **Intégration UI Next.js (`/ask`)** :
   - Connecter l'endpoint de streaming LLM (Gemini 2.5 Flash / local Qwen) à la route Next.js `/api/agent/v1/ask` et à l'interface utilisateur.
2. **Garde-fous anti-hallucination stricts** :
   - Vérification avant rendu : toute affirmation factuelle doit obligatoirement citer un passage extrait du RAG ou une référence de `public.canon_references`.
   - Rejet automatique des spéculations de fans ou fictions non canoniques (Fandom strictement banni).
3. **Support du Persona Personnalisé** : Permettre aux utilisateurs enregistrés de basculer vers un persona alternatif tout en conservant le garde-fou canonique.

---

## 3. Guide de Démarrage Rapide pour un Nouvel Agent

Lorsqu'un agent démarre une mission sur Shenron :
1. **Vérifier l'environnement** :
   ```powershell
   aphrody shenron doctor
   aphrody shenron auth status
   ```
2. **Consulter les objectifs et anomalies ouvertes** :
   - Lire `docs/products/shenron/GOALS.md`
   - Lire `docs/operations/shenron/ADMIN-REPORTS.md`
3. **Respecter les invariants techniques** :
   - Toujours utiliser `bun` (`bun run ...`, `bun test --isolate ...`).
   - Jamais de suppression physique (`DELETE`) en base de données -> toujours `visible = false`.
   - Ne jamais committer ou afficher de jetons secrets (`.env`, tokens admin, sessions).
   - Consigner chaque modification éditoriale dans `public.wiki_revisions`.
