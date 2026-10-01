# Shenron — Dragon Ball integration guide

This guide and its referenced Dragon Ball skills are part of the unified
[`aphrody` plugin](../README.md), alongside the Aphrody AI and OS capabilities.

Plugin local de Shenron pour les assistants compatibles. Il donne accès à des
compétences éditoriales Dragon Ball, à la recherche publique et, si le client
est autorisé, aux outils d'administration du serveur MCP.

## Frontières des services

- **Shenron** détient les données éditoriales du site et du bot. PostgreSQL
  `shenron_site` est la source de vérité ; SQLite du bot est un réplica local
  pour les fonctions qui en ont besoin.
- **Aphrody** héberge le compute IA, les embeddings et le transport MCP. Le
  corpus RAG Aphrody est un index de recherche distinct, pas une copie de la
  base éditoriale.
- **aphrody-infra** possède les unités systemd, les routes réseau, les releases
  et les secrets de service. Ce plugin ne déploie ni ne configure ces éléments.
- **Le contenu Dragon Ball de ce plugin** contient des consignes et une
  connexion locale. Il ne porte
  aucun secret, ne se connecte pas directement à PostgreSQL et ne remplace pas
  les APIs de Shenron.

Les noms d'hôtes, capacités et états de production peuvent évoluer. Pour un
diagnostic, interroger les sondes et les outils disponibles au moment de la
demande ; ne pas déduire l'état courant d'une documentation versionnée.

## MCP Shenron

La configuration [`.mcp.json`](../.mcp.json) démarre le MCP unifié local
`aphrody-mcp` en stdio. Les outils Shenron y sont nommés `dragonball.*`.
Le MCP HTTP public `mcp.dragonballfr.com` et l'ancien processus
`apps/shenron-mcp` ont été retirés ; ne les reconfigurez pas.

- Le serveur expose 30 outils publics pour RAG, wiki,
  manga, databooks, canon, chronologie, bot, actualités et A2A. La plupart
  consultent des données ; `a2a_send` dépose une tâche et a donc un effet
  externe.
- Cinq outils admin sont enregistrés : `dragonball.admin_databooks_deposit`,
  `dragonball.admin_bot_commands`, `dragonball.admin_bot_command_execute`,
  `dragonball.admin_services` et `dragonball.admin_service_action`. Ils
  nécessitent les jetons API correspondants dans l'environnement du processus
  MCP et échouent fermés sans autorisation.
- `dragonball.admin_databooks_deposit`, `dragonball.admin_bot_command_execute`
  et `dragonball.admin_service_action` écrivent ou déclenchent une action. Lire
  leur schéma et inspecter les options avant de les appeler.
- Le catalogue n'expose pas `admin_aphrody_doctor`, `admin_aphrody_git`, de
  commande générique `admin_ai` ni de génération LLM. Pour les opérations
  locales, lancer directement le CLI Aphrody ; pour le chat, utiliser
  `dragonball.rag_ask` et vérifier les passages cités.
- Il n'existe pas de shell ou de proxy HTTP arbitraire exposé par ces outils.

Les outils admin appellent Shenron depuis le processus local `aphrody-mcp`.
`SHENRON_API_ADMIN_TOKEN` et `SHENRON_DATABOOKS_API_TOKEN` sont lus par ce
processus ; leurs valeurs ne doivent jamais être ajoutées aux fichiers du
plugin, arguments d'URL, prompts ou commits. MCP stdio n'ajoute pas de session
OAuth : si un appel admin répond 401/403, rester en lecture seule et faire
corriger l'environnement autorisé par l'opérateur. Ne pas chercher ni
copier un jeton depuis l'hôte.

La présence d'une connexion MCP dans ce dépôt ne prouve ni que le binaire est
sur le `PATH`, ni que les API sont joignables. Vérifier `aphrody-mcp --help`,
puis négocier `tools/list` avec le client MCP. Les noms actuels sont préfixés
par `dragonball.`.

## Règles de réponse

1. Chercher les faits avec `rag_search` ou `rag_context`, puis ouvrir les
   sources citées. Un classement RAG est un outil de découverte, pas une preuve.
2. Pour un champ structuré, préférer `wiki_get` ou `wiki_search`. Pour le canon,
   consulter `canon_check` et `canon_references` ; respecter le cas
   `origine: fallback` sans inventer de verdict.
3. Séparer manga, anime, databooks et jeux. En cas de divergence, nommer les
   supports et citer les sources disponibles.
4. Avec `rag_ask`, la prose `answer` est rédigée par le LLM via aphrody-ai-http ;
   une indisponibilité renvoie une erreur 503, jamais un texte de repli. Traiter
   les passages et leurs URLs comme les éléments vérifiables.
5. Pour une donnée non trouvée, dire qu'elle n'est pas établie par les sources
   consultées. Ne pas compléter depuis la mémoire du modèle.
6. Une écriture wiki ou databook est une action éditoriale. Ne la faire que si
   la demande la vise explicitement, avec références vérifiées et mécanisme de
   révision de Shenron.

## Compétences et agents

| Élément | Usage |
| --- | --- |
| `dragon-ball` | Recherche factuelle, RAG, wiki, manga et sources |
| `dragon-ball-canon` | Doctrine et preuves de canonicité |
| `dragon-ball-japonais` | Lexique et traduction japonais Dragon Ball |
| `databooks-ocr` | Lecture visuelle de lots et format JSONL de relecture |
| `shenron-admin` | Usage autorisé et prudent des outils MCP `admin_*` |
| `toriyama-svg` | Création vectorielle à partir de références mesurables |
| `dbfr-wiki` | Préparation de fiches sourcées |
| `dbfr-traducteur` | Traduction japonaise avec lexique du dépôt |
| `dbfr-ocr` | Transcription visuelle sans écriture directe en base |

## Propriété des sources

- Entrée unique du plugin et skills : `aphrody-ai/plugins/aphrody/`.
- Source de vérité des données éditoriales et du code du site/bot : dépôt Shenron.
- Code du transport MCP : `aphrody-ai/crates/aphrody-mcp/src/dragonball_tools.rs`
  et `aphrody-ai/crates/aphrody-mcp/src/http_rest.rs`.
- Contrats de services et déploiement : dépôt `aphrody-infra`.

Les skills et le transport MCP sont deux surfaces distinctes : les outils
`dragonball.*` sont enregistrés dans `aphrody-mcp`; les données éditoriales et
leurs contrats restent maintenus dans Shenron. Modifier chaque implémentation
dans son dépôt propriétaire et ne pas traiter les skills comme une source de
vérité des données.

## Installation locale

Le plugin unique se trouve dans `aphrody-ai/plugins/aphrody`. Ses manifestes
Claude Code, Codex et Antigravity ainsi que ses configurations MCP distribuent
les skills Dragon Ball et Aphrody ensemble. Vérifier que la skill `dragon-ball`
est découverte et que le serveur MCP local répond. Les chemins de marketplace
dépendent du client et de la publication effectivement configurée.

Licence Apache-2.0.
