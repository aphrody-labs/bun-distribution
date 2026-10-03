# Plan d’intégration du bot Shenron

> État préparé le 28 septembre 2026 depuis Shenron `main` et le monorepo
> Aphrody Discord. Ce document est un plan d’exécution, pas une preuve que la
> migration ou un déploiement a eu lieu. Les versions et chiffres ci-dessous
> sont des observations du checkout local à cette date; les agents doivent les
> revérifier avant de modifier le graphe de dépendances.

## Mandat et résultat attendu

Brancher `shenron/apps/bot` sur les packages Discord maintenus dans
`/home/aphro/src/aphrody-discord`, puis supprimer de Shenron les copies
redondantes qui les fournissent déjà. Shenron reste propriétaire du bot, de ses
commandes, événements, données, services et APIs. Aphrody Discord devient la
source commune du framework et des clients Discord.

Le résultat attendu est un graphe de dépendances unique et traçable :

- le SDK `discord.js` et ses dépendances restent résolus depuis le registre npm
  à la version de Shenron (actuellement `14.27.0`);
- `discordx` (nom upstream, auparavant emballé chez Shenron sous
  `@aphrody/discordy`), `@discordx/di` et `@discordx/pagination` viennent du
  checkout frère pendant le développement, avec repli registry par version;
- `@discordx/internal` et `@discordx/importer` sont les trois autres packages
  DiscordX à consommer depuis ce même workspace (ils restent transitifs si
  seuls les manifestes en ont besoin);
- aucun code du bot ni aucune donnée runtime ne sont déplacés dans
  `aphrody-discord`.

Ne pas publier de package, toucher aux données SQLite/PostgreSQL, exécuter de
seed/migration en production, déployer le bot ou modifier les identifiants et
permissions Discord dans ce plan. Une intégration source locale et réversible
est le premier palier; la production relève ensuite du flux `aphrody-infra`.

## État observé dans Shenron

### Monorepo et versions

- Bun workspace avec `packageManager: bun@1.4.2`, `minimumReleaseAge = 259200`
  pour les nouvelles résolutions, TypeScript `7.0.2`, Oxlint/Oxfmt et Turborepo.
- Application concernée : `apps/bot` (not in repo), package `@shenron/bot`; build Bun,
  `bun build --compile`, exécution Gateway Bun et imports TypeScript en source.
- Le catalogue Shenron fixe `discord.js` à `^14.27.0`. Aphrody Discord publie
  également une copie source locale de Discord.js, version `14.16.3`; elle ne
  correspond pas au SDK déjà utilisé par Shenron et ne doit donc pas être liée
  au bot. Garder `14.27.0` depuis npm jusqu’à ce que la version source locale
  soit alignée et vérifiée séparément.
- `apps/bot` (not in repo) déclare `@aphrody/discordy` (`catalog:`), `@aphrody/di`
  (`workspace:*`), `@aphrody/pagination` (`workspace:*`) et `discord.js`
  (`catalog:`). Les imports directs de framework sont nombreux dans commandes,
  événements, gardes, services et API; le client Discord.js est également
  utilisé directement partout.
- Les packages Shenron `packages/discordy` (not in repo), `packages/di` (not in repo),
  `packages/internal` (not in repo), `packages/importer` (not in repo) et `packages/pagination` (not in repo) reprennent
  les sources/contrats du projet DiscordX amont avec noms et versions Aphrody.
  Ils sont les doublons prioritaires à retirer après bascule des consommateurs.
  `packages/discordy` (not in repo) contient aussi des tests et un README à inventorier avant
  suppression; toute différence locale réellement Shenron doit être migrée,
  pas jetée.

### Runtime et chargement du bot

`apps/rg/bot/src/index.ts` installe `reflect-metadata`, configure TSyringe comme
moteur d’injection de DiscordX, importe le barrel latéral `src/_entries.ts`,
applique les migrations SQLite au démarrage, vérifie l’espace vectoriel RAG,
hydrate les caches, crée un client Gateway unique, enregistre les commandes,
démarre l’API locale après `clientReady`, puis connecte Shenron. Le client
utilise `botId: "shenron"`, les intents réunis depuis `src/lib/personas.ts`,
les partials et limites de cache/sweepers propres au bot. Les listeners
`interactionCreate`, `guildCreate`, arrêt SIGINT/SIGTERM et les contrôles
mono-guilde font partie du comportement à préserver.

Les commandes et événements sont chargés par décorateurs DiscordX. Le générateur
`apps/shenron/bot/scripts/gen-entries.ts` produit statiquement `src/_entries.ts` pour
que le bundle compilé Bun/SWC conserve ces modules. Après toute modification
commande/event/guard, exécuter `bun run gen:entries` dans le package bot et
inclure le fichier généré.

### Surfaces et volume inspectés

Le relevé a couvert les manifests/configs, le graphe d’import Discord, tous les
fichiers source TS de `apps/bot/src` (not in repo) (146 fichiers TS à la date du parcours),
les catégories commands (31), events (19), guards (7), services (40 fichiers
dont jeux), les API, DB, libs, workers, tests, ainsi que les scripts TS (128).
Le répertoire `assets/` et les exports de données volumineux ont été exclus du
parcours ligne par ligne : ils ne sont pas des dépendances de framework; leur
contenu n’est pas candidat au déplacement ou à la suppression. Aucune donnée
runtime ignorée (`apps/shenron/bot/data`, `var`, SQLite, médias locaux) ne doit être
ajoutée au dépôt Aphrody Discord.

Intégrations Discord identifiées :

- Framework et décorateurs : `Bot`, `Discord`, `On`, `Once`, `Guard`, `Slash`,
  `SlashOption`, `SlashChoice`, `SlashGroup`, composants boutons/modales/selects,
  `ArgsOf`, `Client`, `DIService`, `executeInteraction`,
  `initApplicationCommands`.
- Injection : `tsyringe` et `tsyringeDependencyRegistryEngine` de
  `@aphrody/di`; services résolus/injectés par constructeur et classe Client
  enregistrée comme singleton.
- Client/API Discord : types et classes du package `discord.js` (Client,
  interactions, intents, permissions, messages, guildes, rôles, embeds,
  composants, pièces jointes, voice, REST, channels, users, cache options).
- Pagination : `Pagination`, `PaginationResolver` dans commandes Wiki, Canon,
  Databooks, Economy et Level.
- Discord REST/webhooks indépendants du framework : wrappers locaux
  `src/lib/discord-rest.ts`, `src/lib/discord-webhook.ts` et outils de
  `apps/shenron/bot/scripts/lib/discord-rest.ts`; vérifier s’ils restent utiles après migration,
  ne pas les remplacer automatiquement par `@discordjs/rest`.
- Les 128 scripts contiennent des clients Gateway d’administration/import,
  outils de scan/historique et des clients REST. Ils doivent compiler contre
  une seule instance/une seule version de `discord.js`, mais ne doivent pas
  importer le framework s’ils n’en ont pas besoin.

Domaines fonctionnels à garder dans Shenron : commandes admin, économie,
mini-jeux, giveaways, niveaux, modération, race, tickets, utilitaires, vocal,
wiki/canon/databooks, listeners de modération/logs/niveaux/économie, jobs
cron, services de progression/modération/wiki/actualité, RAG/LLM et API
REST/GraphQL/dashboard. Les services de domaine et les appels DB ne sont pas
des doublons DiscordX.

## Architecture de cible

Le bot reste une application Bun/TypeScript du monorepo Shenron. En
développement, le workspace Shenron inclut les cinq répertoires packages du
checkout frère via des chemins relatifs, par exemple
`../aphrody-discord/packages/discordx` et
`../aphrody-discord/packages/di`. Bun 1.4.2 résout ces workspaces frères et
enregistre leurs chemins dans `bun.lock`.

Dans les manifests Shenron, déclarer les dépendances DiscordX avec leurs
versions semver publiées, **pas** `workspace:*` : quand le checkout frère est
présent et déclaré dans le workspace, Bun doit sélectionner le package local
dont la version satisfait le range; quand le checkout manque (installation de
release/production), Bun doit pouvoir récupérer cette même version depuis npm.
Vérifier les règles de correspondance locale de Bun sur chacun des cinq
packages, puis contrôler le lockfile dans les deux environnements. Le choix du
SDK est distinct : conserver `discord.js` `^14.27.0` dans le catalogue et le
résoudre sur npm; ne pas inclure `../aphrody-discord/packages/discord.js` dans
les workspaces Shenron et ne pas installer le snapshot source `14.16.3` dans le
bot.

Les cinq packages DiscordX à maintenir dans Aphrody Discord et à exposer en
workspace frère sont :

1. `discordx` (`packages/discordx` (not in repo)), consommé directement par le bot;
2. `@discordx/di` (`packages/di` (not in repo)), consommé directement par le bot;
3. `@discordx/pagination` (`packages/pagination` (not in repo)), consommé par les commandes;
4. `@discordx/internal` (`packages/internal` (not in repo)), dépendance interne;
5. `@discordx/importer` (`packages/importer` (not in repo)), dépendance interne/outillage.

Déclarer seulement ceux qui sont requis comme workspaces, mais conserver le
graphe de cinq packages source dans Aphrody Discord. Les manifests upstream
utilisent `workspace:^` entre eux; l’installation doit prouver qu’ils se
résolvent vers le même checkout et qu’en l’absence de celui-ci les ranges
semver retombent sur les versions publiées. Le SHA de `aphrody-discord` doit
être révisé et reproductible en développement/CI, sans téléchargement implicite
de sa branche `main` pendant le build. Aucune version locale de Discord.js ne
doit se glisser dans ce graphe du bot.

Préserver l’identité et le flux actuels des deux dépôts. Vérifier les remotes,
branches et changements non commités dans les checkouts existants avant l’exécution;
préserver les changements concurrents ; livrer les lots autorisés selon AGENTS.md.

## Plan d’exécution en vagues

### Vague 0 — Baseline, provenance et compatibilité

1. Lire les règles `AGENTS.md` applicables dans les deux dépôts, vérifier
   l’état Git, les SHAs, branches et remotes; confirmer qu’aucun travail local
   n’est perdu.
2. Dans Aphrody Discord, relever SHA de DiscordX et Discord.js, manifestes,
   licences, exports et versions réelles des packages. Confirmer que le SDK
   `14.27.0` reste fourni par npm dans Shenron et que le snapshot source
   `14.16.3` n’est pas sélectionné par son workspace frère. Comparer les APIs
   utilisées par Shenron aux exports/types DiscordX visés.
3. Comparer les cinq copies Shenron (`discordy`, `di`, `internal`, `importer`,
   `pagination`) à leurs homologues upstream, y compris les patches et tests.
   Produire un diff de provenance par package; réimplémenter uniquement un
   patch local nécessaire dans Aphrody Discord et le documenter.
4. Vérifier la résolution Bun des cinq packages du workspace frère, les
   dépendances semver locales et leur repli npm en masquant temporairement le
   checkout frère; vérifier que `discord.js` reste la version npm attendue. Ne
   pas encore supprimer de manifestes ni de dossiers.
5. Capturer la baseline sans secrets : inventaire des exports slash (nom,
   groupe, description/options/permissions/contextes), listeners enregistrés,
   scripts package, versions et nombres de fichiers; tests offline actuels.
   Aucun login Discord ni appel mutateur aux services réels.

**Sortie/gate :** décision écrite sur le SHA DiscordX, la méthode de workspace,
le repli registry, les patches locaux et une baseline de manifestes/commandes.
Le client reste sur npm `14.27.0`; ne pas résoudre avec deux versions installées.

### Vague 1 — Câbler la source unique sans retirer l’ancien code

1. Déclarer les cinq packages DiscordX requis comme chemins workspace relatifs
   depuis Shenron; ne pas déclarer le package source local `discord.js`.
   Enregistrer le SHA source dans la doc du monorepo et verrouiller les chemins
   sélectionnés dans `bun.lock`.
2. Utiliser les noms canoniques upstream dans `apps/rg/bot/package.json` :
   `discordx`, `@discordx/di`, `@discordx/pagination` avec ranges semver
   publiés compatibles avec les versions locales du SHA choisi. Ces
   dépendances doivent accepter le repli npm en l’absence du checkout frère.
   Garder `discord.js` depuis le catalogue npm à `^14.27.0`; il n’est pas un
   workspace dependency.
3. Remplacer les imports de `@aphrody/discordy` par `discordx`,
   `@aphrody/di` par `@discordx/di`, `@aphrody/pagination` par
   `@discordx/pagination`. Garder imports `discord.js` et les APIs publiques
   intactes. Ne pas modifier des imports similaires utilisés hors bot sans
   audit du consommateur.
4. Adapter au besoin la résolution des exports/types ESM/CJS pour Bun/TS7,
   décorateurs legacy (`experimentalDecorators`, metadata), preload
   `reflect-metadata`, build compilé, tests Bun et éditeur; ne pas remplacer le
   système de décorateurs avant preuve que l’upstream ne fonctionne pas.
5. Vérifier qu’un seul `discord.js` est résolu transitivement pour bot, DiscordX,
   pagination et scripts. Aucun alias ou patch ne doit créer une deuxième
   classe `Client` (sinon DI/decorators échouent à reconnaître les instances).

**Gate :** installation propre depuis le lock, `bun run gen:entries`,
typecheck, lint, tests du bot et build compilé réussis; import à blanc du
framework sans token valide; tests des commandes/export API passent. Aucun
fichier de `packages/*` Shenron supprimé dans cette vague.

### Vague 2 — Parité fonctionnelle et comportement d’exécution

1. Valider sur fixtures/clients simulés : découverte des commandes, génération
   slash, groupes et options, permission guards, interactions bouton/modal/
   select, gestion erreurs, injection des services, `clientReady`, event
   handlers et arrêt propre.
2. Comparer le manifeste de commandes de baseline à celui produit après
   migration; toute différence de nom, type, option, permission ou description
   est un bug tant qu’elle n’est pas attendue/documentée.
3. Valider les interactions qui utilisent pagination (Wiki, Canon, Databooks,
   Economy, Level) : contrôles customId, ownership, expiration, ephemeral,
   nombre de lignes et transitions de pages.
4. Valider les services et commandes qui manipulent embeds, messages,
   voice, tickets, modération, rôles, pièces jointes, cache et intents avec
   tests ciblés/mocks. Garder les appels live derrière une commande manuelle,
   jamais pendant les gates automatiques.
5. Vérifier l’absence de double login Gateway, de collision d’events ou de
   `InteractionCreate` routé deux fois; conserver un client et le filtre
   mono-guilde existants.
6. Rejouer les builds des scripts nécessitant le SDK Discord sans secrets;
   annoter les scripts purement live comme non exécutés.

**Gate :** parité vérifiée et tests de bot verts. Le build compilé et le
typecheck sont obligatoires avant de considérer le nouveau graphe utilisable.

### Vague 3 — Suppression des copies redondantes dans Shenron

1. Après gate verte, supprimer les manifests et le code des packages Shenron
   `packages/discordy` (not in repo), `packages/di` (not in repo), `packages/internal` (not in repo),
   `packages/importer` (not in repo), `packages/pagination` (not in repo), ainsi que leurs exports,
   dépendances, références de workspace, scripts, tests, docs, CI, changesets,
   catalogues et liens de build.
2. Garder tout patch utile aux besoins Shenron dans Aphrody Discord au bon
   package et avec un test upstream/local; ne pas transformer un package
   public upstream en paquet Shenron privé.
3. Nettoyer la racine de Shenron : catalogue `discord.js`, dépendances,
   scripts `build`, `type-check`, lint/audit, Turborepo, lockfile; supprimer les
   versions package spécifiques uniquement après `rg` de tous les imports,
   filtres, pipelines CI et docs.
4. Conserver `reflect-metadata`, `tsyringe` et les autres outils nécessaires au
   domaine s’ils restent directement utilisés. La duplication de code ne
   justifie pas de retirer un runtime utilisé ailleurs.
5. Mettre à jour README/STACK/DEV-LOCAL/DEPLOY et les documents bot concernés :
   indiquer le checkout Aphrody Discord comme source, comment l’obtenir et
   comment mettre à jour le SHA. Supprimer les instructions obsolètes de
   build/publish internes des packages supprimés.

**Gate :** `rg` ne trouve plus d’imports ou d’alias `@aphrody/discordy`,
`@aphrody/di`, `@aphrody/internal`, `@aphrody/importer`, `@aphrody/pagination`
dans le monorepo Shenron (hors historique/notes de migration explicitement
étiquetés); `bun install --frozen-lockfile` ou équivalent Bun, contrôle du
catalogue/workspaces, builds/tests bot et checks repo pertinents réussis.

### Vague 4 — Reproductibilité, CI et verrouillage amont

1. Ajouter une vérification automatique du SHA attendu du dépôt source et des
   packages requis; l’échec doit expliquer comment synchroniser les sources déclarées, sans
   télécharger silencieusement `main`.
2. S’assurer que le checkout existant du monorepo documente/installe Aphrody Discord
   sous un chemin relatif stable. Pour CI, checkout au SHA exact; aucun chemin
   `/home/aphro/...` codé en dur dans manifestes ou scripts.
3. Vérifier le comportement Bun de `discord.js` malgré son champ `engines.node`
   upstream. Typecheck n’est pas une preuve runtime : ajouter un smoke test Bun
   isolé (imports SDK, Gateway non connecté, REST de mock) et enregistrer les
   limites connues.
4. Mettre à jour la provenance amont et les notices de licence; ne pas écraser
   les licences ou auteurs Discord.js/DiscordX. Garder les changements
   Aphrody isolés et traçables au SHA amont.
5. Livrer l’intégration comme changement de code réversible; toute publication
   npm, push à l’amont public Discord, lancement live ou déploiement est hors
   de ce plan.

## Contrôles à exécuter

Les commandes réelles doivent être déterminées par les manifests une fois le
prototype workspace fait. Minimum attendu dans le monorepo Shenron :

```sh
bun install --frozen-lockfile
bun --filter @shenron/bot run gen:entries
bun --filter @shenron/bot run type-check
bun --filter @shenron/bot run lint
bun --filter @shenron/bot test
bun --filter @shenron/bot run build
bun run check:catalog
bun run check:packages
git diff --check
```

Dans Aphrody Discord, exécuter les contrôles ciblés DiscordX/Discord.js requis
par l’impact réel, sans lancer toute la suite upstream si elle est sans lien.
L’état vert de Shenron seul ne prouve pas le fonctionnement du code Discord.js
sur Bun; conserver le smoke test runtime. Générer les entrées bot avant les
tests/build, et vérifier le diff généré.

## Risques et invariants de sécurité

- **Versions source/référence :** Aphrody Discord publie un snapshot source
  Discord.js `14.16.3`, tandis que Shenron consomme npm `14.27.0`. Le bot garde
  le SDK npm jusqu’à alignement et vérification du package source local.
- **Résolution des workspaces frères :** Bun 1.4.2 sait résoudre
  `../child/packages/...` et en verrouiller les chemins. Il reste à vérifier
  dans le projet le repli npm des dépendances semver quand le checkout frère
  est absent; `workspace:*` l’empêcherait.
- **Singleton Discord.js :** DI, `instanceof`, décorateurs, classes de builders
  et interactions échouent si plusieurs copies du SDK chargent leurs classes.
- **Publication upstream :** le package source Discord.js est du JavaScript
  pur upstream même si le bot Shenron est écrit en TypeScript. Conserver cette
  séparation; ne pas forker/réécrire la bibliothèque pour satisfaire la règle
  qui concerne le code applicatif du bot.
- **Moteurs Node/Bun :** le package SDK npm de Shenron annonce un moteur Node;
  l’usage sous Bun doit rester couvert par les contrôles actuels et un smoke
  test runtime. Ne pas annoncer une garantie officielle Bun non déclarée
  upstream.
- **Secrets et données :** ne jamais copier `.env*`, tokens, cookies, SQLite,
  corpus RAG, médias générés ou sorties runtime vers Aphrody Discord; ne pas
  les afficher dans logs de commande. Aucune connexion Discord requise pour
  les tests par défaut.
- **Comportement du bot :** une différence de commandes, intents, permissions,
  cache, pagination, mono-guilde ou ordre d’initialisation bloque la suppression
  des copies jusqu’à résolution.
- **Production et données canoniques :** ne lancer aucun seed, migration,
  écriture éditoriale ou déploiement pendant cette intégration. Shenron conserve
  la propriété des APIs, du bot et des données; `aphrody-infra` garde celle des
  releases et unités système.

## Décision de clôture

La migration est terminée uniquement quand le bot résout un seul checkout
épinglé de Discord.js/DiscordX, les doublons du monorepo Shenron ont été retirés
après parité vérifiée, le lock est reproductible avec une installation gelée dans le checkout existant, et les
gates build/typecheck/lint/tests/smoke sont observées vertes. Le commit doit
contenir les références exactes amont et les checks réellement exécutés; ne
pas publier ni déployer dans la même étape.

## Avancement d’intégration — 28 septembre 2026

Le câblage a été appliqué dans Shenron : les cinq copies
`packages/{discordy,di,internal,importer,pagination}` ont été retirées; le bot
importe `discordx`, `@discordx/di` et `@discordx/pagination`; le workspace Bun
relie les cinq paquets DiscordX du checkout frère et conserve `discord.js`
`14.27.0` depuis le registre. Le bot construit les exports `dist/` DiscordX
avant typecheck, démarrage, build et tests. Le contrôle de catalogue ignore les
manifests de workspaces externes afin de ne pas imposer les règles Shenron au
monorepo amont. Voir les commits Shenron et Aphrody Discord associés à ce plan.

Contrôles observés : le build des cinq paquets DiscordX, `@shenron/bot`
`type-check`, `check:catalog`, `check:packages` et Oxlint passent. Oxlint émet
trois avertissements préexistants dans `server.ts` et deux tests.
`bun test tests` du bot compte 328 réussites, 9 échecs et 7 erreurs; les erreurs
visibles incluent le binaire BXC local différent de l’attendu, un fixture
DragonBallCN absent et deux suites qui lèvent avant exécution. Le test runner
DiscordX n’a pas pu terminer ses six suites : `@discordjs/collection` manque
dans la résolution du checkout source; les quatre autres packages n’ont pas de
tests trouvés sous `tests/`. Ces suites et erreurs restent des tâches ouvertes,
pas des résultats verts à revendiquer.

La connexion runtime Discord et le build du bundle Shenron ne sont pas exercés
dans cette passe. Aucun déploiement, accès à la base, seed ni publication npm
n’a été effectué.
