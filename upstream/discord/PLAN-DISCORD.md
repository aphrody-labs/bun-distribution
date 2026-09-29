# PLAN-DISCORD — clôture de bout en bout

Référence : 28 septembre 2026. Feuille d'exécution de la prochaine session
`aphrody-discord`. [`docs/PLAN.md`](docs/PLAN.md) décrit l'architecture;
[`docs/architecture`](docs/architecture/README.md) contient les audits des
bots. Les constats datés ci-dessous doivent être revérifiés avant action.

## Mandat et mode d'exécution

Livrer un cadre Discord partagé, reproductible, publié et exploité par les
applications Aphrody. `aphrody-discord` possède contrats et transport communs;
chaque application garde ses commandes, données, autorisations métier et
secrets. `aphrody-infra` possède DNS, TLS, Nginx, systemd et releases.

Travailler sans confirmation pour les choix techniques réversibles : inspecter,
corriger, valider, committer et pousser chaque lot cohérent. Identité Git :
`aphrody-code <contact@aphrody.com>`. Préserver les modifications concurrentes
et les licences upstream. Ne jamais verser dans Git ou les logs un `.env`, un
jeton, un code OAuth, une URL de callback réelle ou une base de production.
Une restriction exigeant une approbation Discord externe reste `INCOMPLET` avec
preuve; poursuivre les fonctionnalités standard indépendantes. Une permission
de bot ou un consentement OAuth ne prouve pas que la capacité existe.

## Blocages observés

| ID    | État au 28 septembre 2026                                                                                                                                      | Preuve de fermeture                                                                           |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| AD-01 | `bun run typecheck` échoue dans `@discordjs/ui` (`baseUrl` retiré par TS 7) et `@discordjs/docgen` (TypeDoc 0.25.13 et types TS anciens).                      | Typecheck de chaque workspace et de la racine vert sans masquage d'erreur.                    |
| AD-02 | Les workflows de publication et documentation gardent pnpm/Node et des actions `@main`/`@master`; le build CI ne lance pas format ni typecheck.                | CI Bun reproductible, actions figées, gates complètes avant publish.                          |
| AD-03 | `@aphrody/messaging` est privé, exporte le source TS et n'a qu'un typecheck.                                                                                   | Exports, types, artefact, tests REST et installation externe vérifiés.                        |
| AD-04 | Le callback OAuth Carbon échange le code et affiche le profil; il ne conserve ni grants, ni refresh tokens, ni identifiants webhook malgré `webhook.incoming`. | Parcours par capacité, session et révocation testées; webhook exploité ou scope retiré.       |
| AD-05 | `bot.aphrody.com` sert Gateway, HTTP interactions, `/ping` et OAuth. L'utilisateur a confirmé un aller-retour OAuth.                                           | Smoke d'une release figée, monitoring, permissions de production et rollback démontrés.       |
| SH-01 | Shenron lie cinq workspaces DiscordX hors racine; Turbo échoue sur cette découverte, tandis que sa CI ne clone que Shenron.                                    | `bun ci` et gates Shenron passent en checkout vierge sans dossier frère implicite.            |
| SH-02 | Plusieurs tests Shenron ne résolvent pas `@discordjs/collection` depuis `@discordjs/rest`.                                                                     | Graphe Discord.js unique et résolution reproductible.                                         |
| SH-03 | Tests Shenron : ancien libellé `bxc`, fixture DragonBallCN manquante; dernier essai strict : 9 échecs, 7 erreurs, 337 tests.                                   | Attentes corrigées selon le contrat actuel, fixture légitime réparée, suite stricte verte.    |
| SH-04 | Services Shenron actifs, mais release `/srv/shenron/current` sur `4cac743f`, alors ancêtre de 59 commits du `main` local.                                      | Build depuis SHA propre, activation Infra, SHA actif et sondes vérifiés, rollback disponible. |

La release Discord de développement observée était
`30f49b8913c01ef5cbc92e7ff557e757e20b776e`; le dépôt était à
`a36a2b9e`. Ces SHA sont historiques. Les métriques de
`../aphrody-ai/docs/ROADMAP-AGENT-PILLARS.md` le sont aussi. Les objectifs
éditoriaux RAG/OCR Shenron ne constituent pas une gate Discord.

### Relevé de vérification — 29 septembre 2026

Avec Bun 1.4.2 et le lockfile courant, `bun install --frozen-lockfile`,
`bun run format`, `bun run check`, `bun run build` (39 tâches) et
`bun run build:typedoc` (32 tâches) passent localement. La suite REST ciblée
compte 103 tests réussis et un ignoré. Les workflows documentation et release
utilisent Bun et des actions figées; la publication n'est plus déclenchée par
un simple push.

`bun run typecheck` passe sur 61 tâches : le test de déclarations de
`discord.js` est vérifié en mode module préservé avec résolution bundler,
et son accès à `choices` est borné; `tsd` passe aussi. `bun run test` passe sur
38 tâches. Une règle Bun bornée à `@discordjs/ws@1.2.3` résout son import de
`@discordjs/util` vers 1.2.0, qui fournit `polyfillDispose`, sans changer le
paquet vendored. Docgen utilise TypeScript 6 pour son TypeDoc 0.28, dont le
peer n'accepte pas TypeScript 7. L'alignement complet de la famille Discord.js
et les gates des consommateurs restent nécessaires. Aucun paquet ni release de
production n'est déclaré prêt sur cette preuve locale.

`@aphrody/messaging` produit désormais un tarball avec ESM, déclarations et
licence; son import et son typecheck TypeScript 7 passent depuis un projet Bun
extérieur au monorepo. Ses neuf tests Bun couvrent les envois, les erreurs,
l'énumération de salons, l'annulation, la reprise après `429` et le retour paginé
jusqu'au curseur du poller.
L'adaptateur utilise désormais `@discordjs/rest` pour les limites et reprises.
Le paquet reste privé tant que les gates globales et l'intégration des
consommateurs ne sont pas terminées.

L'exemple Carbon sépare localement `/oauth/login` (`identify` seulement) de
`/oauth/install` (`bot applications.commands`). Le callback consomme `state`
une fois, révoque le jeton après lecture du profil et crée une session locale
d'une heure; refus, expiration, rejeu, révocation en échec et déconnexion sont
testés. Le profil de permissions de production, les capacités facultatives et
un smoke de la release active restent à qualifier.

### Release Discord dev — 29 septembre 2026, 08:50 UTC

L'adaptateur Infra a activé l'artefact immuable du commit
`084964f4a95c1d4231a75d282b61c371b4852120` sur la VPS. Le manifeste et
`SHA256SUMS` passent dans la release active; `aphrody-discord-dev.service` est
actif, `/healthz` public répond 200 avec Gateway connecté, et la guilde de
développement expose la commande `ping`. Le certificat `bot.aphrody.com`
expire le 27 décembre 2026. `/oauth/login` répond 302 avec le seul scope
`identify` et un cookie d'état; `/oauth/install` répond 302 avec `bot
applications.commands` et `permissions=8`. Sans session, `/oauth/session`
répond 401. Le callback de refus et son rejeu répondent 400 et effacent le
cookie d'état; une déconnexion même origine répond 204, une origine tierce 403.
L'aller-retour de consentement réel avec le nouveau callback et le rollback
de cette release ne sont pas encore prouvés.

### Release Discord dev — 29 septembre 2026, 08:56 UTC

L'adaptateur Infra a activé l'artefact immuable du commit
`4cf6332cdc66b3ec9c0f2b0c288f0a3024acf808`. Les checksums de la release
active passent, le service est actif et `/healthz` public répond 200 avec
Gateway connecté. `/oauth/login` et `/oauth/install` répondent 302 avec les
scopes attendus, `/oauth/session` sans cookie répond 401. La limite de 60
tentatives par minute est présente dans le bundle et testée localement; elle
n'a pas été déclenchée sur la VPS afin de ne pas bloquer temporairement les
connexions de développement. Un exercice de retour arrière a réactivé
`084964f4a95c1d4231a75d282b61c371b4852120`, vérifié `/healthz` et le
Gateway, puis réactivé `4cf6332cdc66b3ec9c0f2b0c288f0a3024acf808` avec
les mêmes sondes vertes. Le consentement réel reste ouvert.

## Séquence exécutable

### 0. Reconstituer la vérité courante

1. Lire les règles, `README.md`, ce plan, `docs/PLAN.md`,
   [`docs/UPSTREAMS.md`](docs/UPSTREAMS.md), [`docs/STACK.md`](docs/STACK.md)
   et les audits. Dans Shenron lire `AGENTS.md`, `docs/GOALS.md`,
   `docs/ADMIN-REPORTS.md`, `docs/INFRA-DELEGATION.md`. Dans Infra lire les
   contrats et runbooks de release. `aphrody-ui` appartient à son agent : ne
   pas l'inspecter ni le modifier.
2. Relever branches, SHAs, arbres Git, lockfiles, versions upstream/publiées,
   workflows et release active. Revalider scopes, intents et interactions dans
   la [documentation officielle Discord](https://docs.discord.com/developers/topics/oauth2)
   et les fonctions Bun dans la [documentation Bun](https://bun.com/docs/pm/cli).
   Lister les variables de configuration par nom seulement.
3. Construire le graphe imports/exports/versions avec le compilateur TS, les
   manifestes et au besoin Knip. Séparer code exécuté, exemples, documentation
   et scripts. Conserver provenance et licences des snapshots upstream.
   Supprimer un paquet seulement après preuve de non-usage et gate consommateur.
4. Écrire un relevé daté des commandes, codes retour, SHA actifs et nouveaux
   blocages. Une tâche soumise à un autre dépôt n'est pas un résultat.

**Sortie :** inventaire vérifiable et blocages reproductibles.

### 1. Rendre la base Bun et les paquets upstream reproductibles

1. Faire réussir `bun ci` depuis `bun.lock` en checkout propre avec Bun épinglé.
   Garder les patches Aphrody isolés et documentés pour rejouer les mises à
   jour Discord.js/DiscordX.
2. Corriger `@discordjs/ui` et `@discordjs/docgen` à la source. Si TypeDoc
   upstream exige un TypeScript distinct, borner cette version au paquet,
   documenter la matrice et vérifier les artefacts; ne pas désactiver le gate
   racine. Réparer également les types Node effectivement nécessaires.
3. Aligner `discord.js`, `@discordjs/*`, DiscordX et leurs peers. Vérifier
   `exports`, déclarations, build et import dans un projet Bun extérieur au
   monorepo. Garder une seule version runtime là où les classes interagissent.
4. Migrer les workflows Aphrody de publication/docs sur Bun, épingler leurs
   actions et y exécuter format, lint, typecheck, docs, build et tests. Séparer
   publication d'un simple push sur `main`; aucun publish sur gate rouge.

**Sortie :** tous les gates racine verts en CI et installation externe prouvée.
Discord.js upstream déclare Node comme runtime pris en charge : noter toute
limite Bun mesurée au lieu de supposer le support.

Le gate `bun run verify:messaging-pack` construit `@aphrody/messaging`, crée
son tarball, l'installe dans un projet Bun extérieur et vérifie les exports
runtime et les déclarations TypeScript 7 en mode NodeNext. Il est branché sur
les workflows de build, documentation et publication; les exécutions GitHub
de ces nouveaux workflows restent à constater.
Le déclenchement manuel du workflow Build sur `6a5a97a3` a créé le run
`36546582881`, terminé `startup_failure` avant tout job ou log. Le workflow
est actif et les Actions du dépôt sont activées; la cause GitHub reste à
diagnostiquer. Les gates locaux, dont l'installation externe, passent.

### 2. Livrer un noyau partagé sans deuxième pile réseau

1. Stabiliser `@aphrody/messaging` : messages, pièces jointes, salons,
   erreurs, capacités, pagination, annulation et injection du transport.
   Produire exports/types/version installables; tester les contrats Rust AI
   via une frontière IPC/HTTP explicite sans casser son CLI natif.
2. Réutiliser le REST maintenu choisi : limites Discord, `429` et
   `retry_after`, timeouts, erreurs, pagination, annulation et audit de logs.
   Conserver le poller historique seulement si un cas réel le justifie.
3. Définir une connexion Gateway par application : intents explicites,
   reconnexion, readiness, fermeture, health et shards si nécessaires. Définir
   séparément HTTP interactions : Ed25519 sur corps brut, PING, ACK/defer dans
   le délai Discord, suivi, idempotence et erreurs. Choisir **un seul** mode de
   livraison des interactions par application.
4. Écrire des adaptateurs fins pour Discord.js/DiscordX et Carbon lorsque
   leurs APIs apportent la capacité requise. Rendre l'enregistrement des
   commandes explicite par environnement. Interdire les clients REST/Gateway
   parallèles cachés dans les consommateurs.
5. Ajouter tests Mock Fetch/WebSocket/signatures, tests des exports publiés et
   règle d'import empêchant le retour des clients supprimés.

**Sortie :** contrats documentés, paquet installable, erreurs et interactions
testées, propriétaire unique de chaque connexion.

### 3. Fermer OAuth, installation et permissions

1. Séparer connexion utilisateur minimale, installation bot/commandes et
   capacités facultatives. Demander un scope seulement quand l'API associée
   est implémentée. Réserver `permissions=8` à la guilde de développement
   `1554189180030947338`; définir un profil production à permissions et
   intents minimaux, avec approbations Discord effectivement accordées.
2. Tester `state` et cookie à usage unique/expiration, refus, erreur Discord,
   rejeu, rotation et récupération. Protéger session serveur, redirections,
   CSRF, limites de débit et logs. Vérifier le redirect enregistré dans le
   Developer Portal sans réutiliser une URL contenant un code.
3. Chiffrer les access/refresh tokens nécessaires dans un stockage privé
   exploité par Infra; rafraîchir, révoquer et purger. Si `webhook.incoming`
   reste demandé, stocker et gérer son identifiant/jeton; sinon retirer le
   scope. Vérifier les permissions côté serveur à chaque action.
4. Tenir la matrice `scope → API → stockage → test → approbation Discord`.
   Laisser hors du parcours web les scopes RPC locaux, indisponibles ou hors
   liste tant que fonction et approbation n'existent pas. Administrator ne
   donne ni scope OAuth ni intent privilégié.

**Sortie :** tests succès/échec/expiration/rejeu/révocation/webhook et smoke
réel depuis `/oauth/login`. Le succès OAuth déjà confirmé par l'utilisateur
n'est qu'une preuve du parcours de développement actuel.

### 4. Migrer les applications et retirer les doublons

| Consommateur   | Action                                                                                                                                                                                                                                                                                     | Gate                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Aphrody AI     | Raccorder notifications et transport partagé au client Rust via interface explicite; laisser logique agent et secrets chez AI.                                                                                                                                                             | Tests de contrats et notification en guilde de test.                              |
| RG et Achilléa | Revérifier les audits dans [`docs/architecture/upstreams`](docs/architecture/README.md); remplacer connexions et REST dupliqués, garder files, données et commandes métier.                                                                                                                | Une pile par bot, CI locale et smoke de guilde.                                   |
| NIE Wunderbot  | Vérifier qu'une application actuelle existe; l'audit n'attestait qu'un paquet historique.                                                                                                                                                                                                  | Migration si code actif, sinon `NON_FAIT` motivé.                                 |
| Shenron        | Résoudre les cinq workspaces externes avec versions publiées/pinnées ou clôture de sources explicite en CI/release; retirer le couplage Turbo externe. Unifier Discord.js, réparer `@discordjs/collection`, les tests BXC et la fixture. Régénérer les entrées après commande/event/guard. | `bun ci`, audits, typecheck, lint, tests stricts et smoke depuis checkout vierge. |

Shenron garde son bot Bun/TypeScript, ses données et API éditoriales. Réparer
les attentes BXC selon le contrat présent; ne pas réintroduire un ancien
bridge pour satisfaire un test périmé. Actualiser ou retirer
`../shenron/PLAN-BOT-SHENRON.md` quand la migration y est reflétée. Ne pas
toucher `aphrody-ui` dans cette campagne.

**Sortie :** chaque consommateur actif utilise une version ou un SHA traçable,
ses gates passent et aucun runtime ne dépend d'un checkout frère implicite.
Les facades provisoires ont des usages mesurés et une échéance de retrait.

### 5. Publier, déployer, observer

1. Publier uniquement les paquets prêts, depuis commit propre, avec licences,
   exports, types, changelog et versions cohérentes. Garder la racine privée.
   Prendre tout jeton npm dans le stockage privé existant, sans l'imprimer.
   Vérifier installation depuis le registre, transitifs et provenance; pinner
   chaque consommateur sur version publiée ou SHA immuable.
2. Bâtir la release Discord depuis un SHA figé avec
   `aphrody-infra/scripts/build-aphrody-discord-release.sh`. Respecter les
   préconditions de l'adaptateur Infra : checksums, secrets hors release,
   rollback. Tester d'abord la guilde de développement, puis santé Gateway,
   interactions signées, commandes, OAuth, renouvellement TLS et journaux.
3. Bâtir Shenron site et bot depuis une source propre alignée sur les paquets
   Discord. Activer avec l'adaptateur immutable Infra; vérifier SHA actif,
   unités, HTTPS, commandes et retour arrière. Ne jamais déduire la production
   du SHA de `main`. Laisser sauvegardes et données sous politique Infra.
4. Étendre RG/AI après leurs gates et smokes isolés. Publier notes de version,
   matrice des capacités et sondes. Revenir à la release précédente si santé
   ou commandes échouent, puis corriger avant une nouvelle activation.

**Sortie :** releases actives identifiées par SHA, CI correspondante verte,
sondes publiques et guilde OK, rollback démontré, aucun secret dans artefact.

## Commandes et preuves minimales

Exécuter depuis la racine correspondante après `git status --short --branch`.
Tout échec reste visible et devient un blocage à corriger; ne pas retirer le
gate pour obtenir du vert.

```sh
# aphrody-discord, checkout propre
bun ci
bun run format
bun run check
bun run typecheck
bun run build:typedoc
bun run build
bun run test

# shenron, après résolution reproductible des dépendances Discord
bun ci
bun --filter @shenron/bot gen:entries
bun run check:catalog
bun run deps:dedupe:check
bun run check:packages --strict
bun run audit:architecture
bun run audit:scripts
bun run type-check
bun run lint
bun run test:ci
```

Ajouter en CI les nouveaux tests OAuth, signatures, REST et exports. Pour
chaque release joindre SHA source, lockfile, version Bun, codes retour, sondes
et SHA actif après activation. Suivre le runbook
`../aphrody-infra/docs/IMMUTABLE-RELEASES.md` en vigueur; ne pas exécuter un
script de déploiement depuis un chemin ou un état supposé.

## Définition de terminé

- **Cadre partagé :** install propre, format/lint/typecheck/docs/build/tests
  verts, exports et licences valides, une pile Discord par application.
- **Sécurité :** scopes liés à du code testé; OAuth, interactions, permissions,
  secrets et erreurs couverts; profil production distinct de la guilde admin.
- **Consommateurs :** AI, RG/Achilléa et Shenron actifs migrés et vérifiés;
  NIE classé selon son code présent. Aucun dossier frère requis implicitement.
- **Exploitation :** artefacts immuables, SHA actif, sondes réelles, rollback
  vérifié et propriété Infra respectée.

Fermer chaque blocage avec commit, workflow, sortie de commande ou sonde
horodatée. Conclure `FAIT`, `INCOMPLET` ou `NON_FAIT` par résultat; préciser
cause et prochaine action pour tout reste. Une approbation Discord non obtenue
ou une application NIE absente ne sont jamais déclarées résolues.
