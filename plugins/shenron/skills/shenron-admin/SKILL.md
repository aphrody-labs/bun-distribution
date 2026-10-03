---
name: shenron-admin
description: "Administration Shenron via les outils MCP dragonball_admin_* (dépôt databooks, commandes bot, actions de service). Utiliser seulement sur demande explicite et avec jeton fourni par l'opérateur ; sinon lecture seule."
---

# Administration MCP Shenron

> **S'applique quand :** un client MCP connecté à `aphrody-kernel mcp` expose les outils `dragonball_admin_*` et l'opérateur a fourni les secrets dans l'environnement du processus. **Sinon :** reste en lecture seule (`dragonball_*` publics, skill `dragon-ball`), ne tente aucun contournement et rapporte que l'administration n'est pas disponible.

Les outils `dragonball.admin_*` (affichés `dragonball_admin_*` par Claude Code ;
préfixe complet `mcp__plugin_aphrody_aphrody__dragonball_admin_*`) sont
enregistrés par le MCP unifié `aphrody-mcp` (crate `crates/ai/mcp`, fonctionnalité
`dragonball`), que `aphrody-kernel mcp` héberge, et appellent les API d'administration Shenron. Ils requièrent
les secrets API autorisés dans l'environnement du processus ; ne les ajoute
pas à la configuration du plugin. Leur absence dans `tools/list` signifie que
le binaire ou son build n'expose pas cette capacité ; ne tente pas de contourner
ce contrôle.

## Secret et identité

Les noms de secrets lus par les outils sont `SHENRON_API_ADMIN_TOKEN` (API
d'administration du bot) et `SHENRON_DATABOOKS_API_TOKEN` (dépôt databooks du
site) ; sans eux les outils échouent sans rien écrire. L'outil séparé
`dbfr_deposit` (fonctionnalité `dbfr`, absent du catalogue habituel) lit un autre
secret, `DBFR_TOKEN`. Cette skill et le client n'ont pas besoin de connaître
leurs valeurs.

- N'affiche, ne demande, ne recherche et ne copie jamais une valeur de jeton.
- Ne passe jamais un jeton en argument de commande, URL, variable ajoutée au
  dépôt, capture d'écran ou message.
- Authentifie le client par le mécanisme officiel disponible. Si l'autorisation
  échoue, rapporte l'erreur sans essayer d'autres identifiants.
- Ne confonds pas le jeton d'administration MCP, le jeton d'API Shenron et le
  jeton de dépôt databooks : ils ont des rôles distincts.

## Outils de lecture

- `dragonball_admin_bot_commands` : lire le catalogue avant toute commande.
- `dragonball_admin_services` : lire le catalogue d'actions avant toute action de service.

Le catalogue actuel ne fournit pas d'outils `admin_aphrody_doctor`,
`admin_aphrody_git`, `admin_ai` ou de chat admin. Pour les opérations locales,
utilise le CLI Aphrody directement. Pour l'état IA, utilise une sonde
documentée et un appel de capacité autorisé ; ne confonds pas santé HTTP,
embeddings, RAG et génération.

Rapporte les champs utiles et masque toute valeur sensible qui pourrait
apparaître dans une sortie.

## Outils qui écrivent ou exécutent

- `dragonball_admin_databooks_deposit` (paramètres `databookId`, `pages` :
  liste de `{number, text}`) écrit une fusion ciblée de transcriptions déjà
  relues dans Shenron et crée des révisions. Ne l'utilise qu'avec un dépôt
  explicitement demandé et un résultat OCR comparé au scan. N'envoie pas de
  texte incertain ou de valeur vide.
- `dragonball_admin_bot_command_execute` (paramètres `invocation`, `options`,
  `channelId`) exécute une commande Discord sous l'identité du
  bot. Choisis uniquement une commande du catalogue et ses paramètres
  documentés. Une demande d'information ne justifie pas d'exécuter une
  commande mutatrice.
- `dragonball_admin_service_action` (paramètres `service`, `action`,
  `arguments`) accepte un service et une action du catalogue
  `dragonball_admin_services`, pas un shell arbitraire. Lis la description, les arguments
  et l'effet attendu avant l'appel. Les redémarrages affectent la production.

L'utilisateur doit avoir demandé l'action d'écriture ou l'opération précise.
Pour une demande de diagnostic, reste aux outils de lecture. Après une action,
vérifie son résultat avec une sonde ou une lecture indépendante ; ne déduis pas
la réussite de la seule réponse de l'outil.

## Séparation des données

Les outils admin passent par les APIs de Shenron ou les fonctions explicitement
autorisées d'Aphrody. Le plugin n'ouvre pas de connexion directe à PostgreSQL,
ne modifie pas la base et ne contourne pas l'historique de révision.

## Ré-ancrer les sources d'une fiche wiki

Pour réparer une fiche existante sans bibliographie, utilise depuis le monorepo
Aphrody (Shenron y est importé sous `apps/shenron`) le script éditorial `bun apps/shenron/site/scripts/reancre-sources-wiki.ts`.
Lance d'abord une simulation ciblée (`db_characters --ids <id>
--sans-sources --limite 1`), puis lis chaque extrait et confirme qu'il
documente la fiche. Le RAG est un outil de découverte ; la référence primaire
et son passage exact fondent la citation. Écris seulement les identifiants
revus, explicitement avec `--ecris`, puis relis `article_sources` et la
révision PostgreSQL. Le script préserve le texte de l'article. Ne remplace pas
ce flux par une écriture MCP non documentée ni par un lot sans revue.
