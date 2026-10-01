# MCP Shenron et GraphQL

> **S'applique quand :** un client MCP est connecté à `aphrody-kernel mcp` (ou à `aphrody-mcp`) construit avec la fonctionnalité `dragonball`. **Sinon :** passe par l'API REST (`api.md`) ; la section GraphQL ne dépend pas du MCP.

## MCP Dragon Ball via Aphrody

Le plugin déclare le serveur `aphrody-kernel mcp` (stdio) ; le noyau héberge les
outils du serveur `aphrody-mcp` (`aphrody-mcp server`, enregistrés dans
`crates/ai/mcp/src/main.rs`). Les outils Shenron portent le préfixe
`dragonball.*` côté serveur ; Claude Code les affiche `dragonball_*`
(`mcp__plugin_aphrody_aphrody__dragonball_*`). L'ancien endpoint public
`mcp.dragonballfr.com` et l'ancien serveur Bun séparé `shenron-mcp` sont retirés
(le code source de ce dernier n'est plus dans le dépôt).

Le serveur possède deux catalogues (37 outils `dragonball.*`, comptés dans les
sources le 2026-10-01) :

- **32 outils publics** pour RAG, sources, couverture, wiki, manga, databooks,
  canon, chronologie, bot, actualités et A2A. La plupart consultent des données ;
  `a2a_send` dépose une tâche et a donc un effet externe ; `manga_scanlate` et
  `databooks_scanlate` exigent la fonctionnalité Koharu et ses modèles.
- **5 outils admin** : dépôt databooks, lecture du catalogue des commandes bot,
  exécution de commande, catalogue et actions de service. Ils appellent les API
  d'administration Shenron avec leurs secrets d'hôte ; le transport stdio ne
  fournit pas OAuth.

La liste renvoyée par `tools/list` est l'autorité pour le binaire local. Elle ne
prouve pas que les API éditoriales, le RAG vectoriel ou le LLM sont joignables.

### Connexion

Configure le client MCP avec `aphrody-kernel mcp` (ou `aphrody-mcp`, stdio) et
vérifie son catalogue d'outils. Les outils publics ne requièrent pas de jeton Shenron.
Les outils admin reçoivent leurs secrets API depuis l'environnement autorisé
du processus ; ne mets jamais un secret dans une URL, `.mcp.json`, le dépôt,
un script ou une conversation.

Les API d'administration vérifient `SHENRON_API_ADMIN_TOKEN` et
`SHENRON_DATABOOKS_API_TOKEN`. Le plugin ne lit ni ne distribue leurs valeurs.
Si un appel admin manque d'autorisation, rester sur les outils publics et faire
corriger l'environnement approuvé par l'opérateur.

### Outils publics

Les 32 noms de base, vérifiés dans les sources le 2026-10-01 :

```text
dragonball.rag_search dragonball.rag_context dragonball.rag_ask
dragonball.sources dragonball.data_coverage
dragonball.wiki_search dragonball.wiki_list dragonball.wiki_get dragonball.wiki_categories
dragonball.manga_search dragonball.manga_tomes dragonball.manga_page
dragonball.manga_chapitre dragonball.manga_planche dragonball.manga_recherche
dragonball.manga_scanlate dragonball.chronologie dragonball.databooks_search dragonball.databooks_planches
dragonball.databooks_get dragonball.databooks_scanlate
dragonball.canon_check dragonball.canon_references
dragonball.bot_stats dragonball.bot_personas dragonball.bot_leaderboard
dragonball.bot_commands dragonball.news dragonball.a2a_send
dragonball.a2a_task_status dragonball.a2a_task_list dragonball.a2a_agent_card
```

Les champs et paramètres sont définis par les schémas MCP reçus du serveur.
Inspecte ces schémas plutôt que de supposer qu'une ancienne fiche API est à
jour. `a2a_send` a un effet externe et dépose une tâche ; ne l'appelle que si
une délégation est demandée. Il ne prouve pas qu'un pair l'a acceptée ou
terminée. Vérifie son état avec `a2a_task_status` ou `a2a_task_list`.

### Outils admin

Le serveur Aphrody enregistre ces cinq outils admin (secrets : `SHENRON_API_ADMIN_TOKEN` pour le bot, `SHENRON_DATABOOKS_API_TOKEN` pour le dépôt databooks ; voir `shenron-admin`) :

```text
dragonball.admin_databooks_deposit
dragonball.admin_bot_commands
dragonball.admin_bot_command_execute
dragonball.admin_services
dragonball.admin_service_action
```

Avant un appel qui écrit ou exécute, consulte d'abord le catalogue et le schéma
de l'outil, vérifie que la demande utilisateur vise bien cette action, puis
contrôle le résultat séparément. Les données de service sensibles ne doivent
pas être recopiées dans le contenu MCP. Ce catalogue ne contient pas de chat
admin ni d'outil générique de génération LLM. Les opérations locales Aphrody
passent par son CLI.

### Vérifier le catalogue public

```bash
aphrody-mcp --help
```

`aphrody-mcp --help` décrit le serveur et rappelle que l'ensemble d'outils
dépend des fonctionnalités Cargo de la construction. Pour l'appel `tools/list`,
utilise le client MCP afin qu'il négocie correctement
le transport et les versions du protocole. Évite de recopier un exemple JSON-RPC
ancien quand le SDK du client gère déjà l'initialisation.

## GraphQL Shenron

GraphQL est une interface de lecture pour parcourir les relations entre entités.
Le schéma et les autorisations peuvent évoluer ; inspecte le schéma courant
avant de composer une requête. L'URL
`https://bot.dragonballfr.com/graphql` répondait le 2026-10-01 (la requête
`{ counts { characters planets sagas } }` ci-dessous a été exécutée avec
succès), mais le serveur peut exposer ou retirer cette route selon la release. En cas d'erreur, utilise les outils MCP ou
l'OpenAPI public courant plutôt que de supposer que GraphQL est disponible.

Exemple, vérifié le 2026-10-01 mais à revérifier contre le schéma du serveur :

```graphql
{
  counts {
    characters
    planets
    sagas
  }
}
```

N'envoie pas de mutation GraphQL depuis ce plugin. Les écritures éditoriales
passent par les flux d'administration Shenron autorisés et versionnés.
