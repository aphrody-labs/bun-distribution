<!-- SPDX-License-Identifier: Apache-2.0 -->
# GitHub, identité et livraison automatique Aphrody

Statut : **plan, non déployé**. Observation du 2026-09-28. Ce document coordonne
les propriétaires existants ; [l'architecture](../../architecture/workspace/ARCHITECTURE.md),
les [règles du workspace](../../reference/workspace/AGENTS.md), le [plan de migration GitHub](../../reference/infra/GITHUB-OWNERSHIP.md)
et les plans des dépôts restent les autorités de leurs surfaces. Relever Git heads,
manifests, routes, versions publiées et état des services avant chaque phase.

## État vérifié et choix de composants

| Surface | Constat daté | Décision / limite |
| --- | --- | --- |
| Organisation | Au relevé `gh repo list aphrody-labs` du 2026-09-29 : `aphrody-koharu` privé et cinq forks GNU publics ; les autres sources produit sont encore chez `aphrody-code`. | Migrer les dépôts survivants selon [GITHUB-OWNERSHIP](../../reference/infra/GITHUB-OWNERSHIP.md), en vérifiant chaque transfert, collision et redirection. |
| Identifiants du site | `.env` ignorés par Git dans Infra et `aphrody-web/crates/aphrody-site`, mode `0600`, avec `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`, `BETTER_AUTH_URL` et un `BETTER_AUTH_SECRET` aléatoire commun. | Ce sont des paramètres d'application OAuth pour connecter un utilisateur, **pas** des jetons `gh`, une GitHub App ou une configuration de production. Ne jamais les mettre dans les logs, workflows ou artefacts. Régénérer le secret GitHub communiqué avant activation. |
| Origine publique | `aphrody.com` et `aphrody-site` sont retirés (`config/nginx-routes.json`) ; le service est inactif sur le VPS, HTTPS échoue et `/api/auth/callback/github` répond 404 en HTTP. Le routeur Web (`crates/web/site/src/main.rs`) n'a pas de route OAuth. | Rétablir TLS, service et callback puis vérifier le parcours complet avant d'annoncer le login. Le `.env` local n'est pas chargé par systemd ; l'unité prévoit `/etc/aphrody/aphrody-site.env`. |
| Better Auth | [Better Auth](https://github.com/better-auth/better-auth) est le serveur TypeScript officiel ; [better-auth-rs](https://github.com/better-auth-rs/better-auth-rs) est une implémentation Rust indépendante. crates.io expose `better-auth` **0.10.0** stable et **1.0.0-alpha.3** au relevé ; les deux déclarent `axum ^0.8`, compatible en contrainte avec `aphrody-site` (`axum 0.8.4`). | Télécharger la version alpha pour un **pilote isolé** seulement ; elle est en cache Cargo, pas ajoutée au manifest Web. Qualifier API, schéma, migrations, cookies et compatibilité avec le client avant de choisir la version. Aucune parité avec la version TypeScript courante n'est présumée. |
| API GitHub Rust | [GitHub classe Octocrab comme tiers](https://docs.github.com/en/rest/using-the-rest-api/libraries-for-the-rest-api), et ne liste pas de client Rust officiel. `aphrody-git` utilise déjà `octocrab 0.50` avec REST/GraphQL ; crates.io publie `0.54.2` au relevé. | Réutiliser `aphrody-git` et qualifier une mise à jour d'Octocrab avec son API actuelle ; garder `gh` pour les opérations ponctuelles. Aucune duplication de client. |
| CI et synchronisation | Infra fournit CI réutilisable (`.github/workflows/aphrody-reusable-ci.yml`), appelant (`.github/workflows/aphrody-ci.yml`), déploiement de workflow (`crates/infra/git/src/distribution.rs`) et source sync (`scripts/source-sync.ts`). L'appelant suit `@main`, le déploiement de workflow peut épingler un SHA ; la synchronisation reconnaît seulement `aphrody-code` et sa liste de dépôts est statique. | Faire évoluer ces mécanismes ; ne pas créer un second orchestrateur. Ne pas considérer une configuration présente comme un check GitHub réussi. |

Sources de référence : [flux OAuth GitHub](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps),
[GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/about-creating-github-apps),
[rulesets d'organisation](https://docs.github.com/en/organizations/managing-organization-settings/creating-rulesets-for-repositories-in-your-organization),
[authentification MCP](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
et [SDK Rust MCP](https://github.com/modelcontextprotocol/rust-sdk).

## P0 — Inventaire et contrôleur unique

**Propriétaire : Infra / `aphrody-git`.** Produire un rapport machine lisible,
daté et ignoré par Git qui joint l'API GitHub, l'inventaire Infra, les dépôts
locaux, les gitlinks et les `.gitmodules` imbriqués. Inclure tous les dépôts
`aphrody-*`, Bun, Oxc quand il est réellement forké, `rg`, `nie`, `iecode`,
`shenron` et les forks indispensables relevés dans les manifests. Ne pas ouvrir
le dépôt `aphrody-ui` : son agent propriétaire fournit son état et applique ses
changements. Identifier pour chaque cible : propriétaire GitHub, upstream,
branche par défaut, HEAD local/distant, divergence, version, licence, politique
de publication, CI, artefacts, sous-modules, état de déploiement et agent responsable.

Étendre `source-sync.ts` pour découvrir les propriétaires vérifiés sans accepter
un nom ressemblant à Aphrody comme preuve de propriété. Conserver ses refus des
arbres sales, branches détachées, historiques divergents et auteurs inattendus.
L'index de dépôts autorisés vient des catalogues et de l'API GitHub, avec une
liste d'exclusions explicite ; aucune écriture dans les forks tiers non possédés.
Corriger le checkout `nie` qui empêche actuellement `git status` racine, puis
réconcilier les gitlinks avec des commits publiés. Ne jamais synchroniser un
sous-module par `--remote` aveugle.

**Sortie :** rapport de couverture où chaque dépôt et chaque gitlink a un
propriétaire, une branche, un upstream et un verdict `current/drift/blocked`.
Zéro mutation si la découverte ne peut pas prouver la propriété ou si un état
concurrent est présent.

## P1 — Identité des utilisateurs, GUI, site et MCP

**Propriétaires : Web pour le site et la session publique ; Contracts pour les
types/scopes ; Infra pour TLS, secrets et routes ; agent UI pour la GUI.**

1. Garder trois identités séparées : application OAuth GitHub pour le login
   humain ; compte `aphrody-code` pour Git/CLI déjà configuré ; future GitHub App
   d'organisation pour les automatisations serveur. Les secrets du site vont
   dans le fichier d'environnement externe de l'unité, avec droits minimaux,
   renouvellement et sauvegarde chiffrée. Le secret communiqué est remplacé
   avant déploiement ; le client ID et l'URL de rappel restent vérifiés contre
   l'enregistrement GitHub. Aucune clé dans un binaire GUI ou bundle JS.
2. Comparer `better-auth` Rust stable 0.10.0 et alpha 1.0.0-alpha.3 sur une
   branche de pilote Web : routes Axum, provider GitHub, stockage PostgreSQL,
   migrations réversibles, session, révocation, rotation de clé, cookies,
   configuration `rustls` et taille du graphe. Vérifier l'API par compilation et
   parcours réel avant sélection ; l'alpha n'entre pas automatiquement dans
   `main`. Si le composant échoue, implémenter le flux code GitHub dans l'unique
   service Web avec une bibliothèque OAuth Rust maintenue, sans changer l'URL.
3. Exposer `/api/auth/sign-in/social` et
   `/api/auth/callback/github` seulement selon l'API réellement choisie.
   Utiliser `state` imprévisible, PKCE S256, URI de redirection exacte, code à
   usage unique, validation du profil après échange, scopes minimaux (`read:user`
   et `user:email` seulement si l'email est requis), identité fondée sur l'ID
   GitHub stable, liaison de compte explicite, anti-CSRF, cookies `Secure`,
   `HttpOnly`, `SameSite`, expiration et révocation. Définir le modèle
   utilisateur/organisation et les rôles sans déduire l'accès du seul login.
4. Restaurer `aphrody.com` : DNS, certificat, Nginx, unité, base, migration et
   build immuable ; vérifier HTTPS, retour 302 depuis GitHub, callback,
   session, déconnexion et erreur de `state`. Une route seule ou un `.env`
   présent ne vaut pas service actif. Conserver la compatibilité des routes
   Web/Files existantes et un rollback de schéma et de release.
5. L'agent GUI consomme le contrat de session de Contracts/Web. Pour desktop,
   ouvrir le navigateur système et finir par un retour contrôlé vers l'app,
   avec PKCE et association de la tentative à la session locale. Prévoir les
   parcours web/mobile sans exposer le secret OAuth. Ne pas copier une session
   navigateur brute dans la GUI ; qualifier expiration, révocation et comptes
   multiples sur chaque hôte.
6. Le MCP public est un **resource server** distinct de la connexion GitHub.
   Définir issuer, audience, scopes de lecture/écriture et découverte OAuth
   (`/.well-known/oauth-protected-resource` et métadonnées du serveur
   d'autorisation) selon la version MCP négociée. Protéger aussi les transports
   Streamable HTTP/SSE et les outils dérivés, valider chaque jeton côté serveur,
   lier la session au principal et refuser les scopes insuffisants. Auditer le
   routeur `rmcp` présent avant modification. La GitHub OAuth App ne délivre
   pas à elle seule des jetons d'accès Aphrody pour le MCP : choisir et prouver
   l'émetteur Aphrody avant publication.

**Sortie :** parcours GUI/site/MCP sur un même compte, preuve de séparation des
identités et des scopes, rotation des secrets, rollback, et sondes publiques.

## P2 — Propriété GitHub et branches concurrentes

**Propriétaire : Infra / `aphrody-git`.** Migrer `bun` puis les dépôts approuvés
vers `aphrody-labs` selon [la séquence existante](../../reference/infra/GITHUB-OWNERSHIP.md).
Vérifier pour chaque transfert HEAD, association upstream, règles, webhooks,
Actions, remotes, gitlinks, packages, liens documentaires et redirections. Ne
pas réutiliser l'ancien nom de dépôt qui porte une redirection. Garder
`@aphrody` sur npm ; une migration GitHub ne renomme pas les packages.

Établir un contrat de branches : `main` = source vérifiée, `feature/<sujet>`
pour un changement produit, `fix/<sujet>` pour un correctif,
`agent/<proprietaire>/<sujet>` pour travaux concurrents et
`upstream/<source>/<date>` pour essais de rebase. Un worktree par branche et
agent ; aucun partage d'index, `reset`, stash ou force-push d'un collègue.
Chaque PR porte dépôt, portée, dépendances, migration et preuve des checks.
Appliquer un ruleset `main` avec PR, checks requis, historique non réécrit et
tags protégés ; activer la merge queue uniquement après mesure de capacité et
vérification que les checks s'exécutent sur `merge_group`. Les erreurs CI ou
limites de facturation bloquent la fusion et sont remontées, sans bypass.

Définir dans les dépôts propriétaires un README d'entrée, licence exacte,
description GitHub, CONTRIBUTING, SECURITY, templates d'issues/PR et
`CODEOWNERS` adaptés à la source. Ne pas remplacer les licences des forks ou
copies FSL. Les commits nouveaux suivent `type(scope): résumé` avec types
`feat`, `fix`, `docs`, `refactor`, `build`, `ci`, `chore`; garder l'identité
`aphrody-code <contact@aphrody.com>` pour ses commits. Aucun texte ou
attribution à un assistant dans les commits, PR, contributeurs ou UI.

**Sortie :** règles actives et contrôlées sur un dépôt pilote, puis déploiement
idempotent par `aphrody-git` sur les dépôts éligibles ; exceptions tracées.

## P3 — CI, publication et déploiement sans intervention

**Propriétaires : Infra pour les workflows et hôtes ; chaque dépôt pour ses
gates ; Contracts pour les versions de schéma.** Créer une GitHub App
`aphrody-labs` dédiée aux mutations automatiques : permissions minimales par
opération (`contents`, `pull_requests`, `checks`, `actions`, `packages` et
`administration` seulement où nécessaires), sélection des dépôts et jetons
d'installation courts. Les identifiants OAuth du site ne servent pas à cela.
Conserver les identités `gh` existantes pour le développement, sans les mettre
dans une variable globale de CI. L'app exécute ses mutations via le client
`aphrody-git` et journalise seulement IDs, révisions, résultats et raisons.

1. Unifier la CI déjà réutilisable : caller épinglé à un SHA ou tag protégé,
   versions d'actions vérifiées, permissions par job, `pull_request` sans
   secrets ni code privilégié, cache isolé et matrice par manifest. Lint,
   format, typecheck, tests et contrôles de licence/provenance se déclenchent
   avant fusion ; `main` refait les checks sur le commit fusionné. Les gates
   propres à chaque propriétaire restent obligatoires. Installer le caller
   via `aphrody-git` sans écraser les workflows non gérés.
2. Une fusion dans `main` après checks déclenche construction immuable et
   artefact identifié par commit SHA, SBOM et empreinte. Déployer d'abord en
   canary sur l'hôte déclaré dans Infra, sonder TLS/API/parcours critiques,
   puis promouvoir atomiquement. Échec = retour automatique à l'artefact et
   aux données compatibles précédents ; publier un incident exploitable.
   Aucun déploiement d'un service actuellement retiré avant son gate P1.
3. Versionner les crates et packages `@aphrody` **par package** à partir des
   manifests et dépendances réelles, pas d'un numéro global présumé. Utiliser
   SemVer stable pour API publique, préversions `-canary.<sha>` et
   `-nightly.<date>.<sha>` pour développement ; documenter les dérogations
   des forks. Générer le graphe de changements, mettre à jour contraintes et
   lockfiles, vérifier les schémas/API et compatibilité des consommateurs,
   puis créer PR de version. Publier seulement les crates avec `publish`
   autorisé et les noms npm réellement possédés ; idempotence sur tag/version.
4. Sur tag protégé : reconstruire ou reprendre l'artefact vérifié, publier
   crate/npm/image dans l'ordre de dépendances, attacher les binaires GUI/CLI
   par OS/architecture à une GitHub Release avec checksums et provenance,
   puis promouvoir un manifeste signé de canal. Le lien unique
   `downloads.aphrody.com` est aujourd'hui réservé : activer sa route et son
   index seulement quand les artefacts existent ; y résoudre plateforme,
   canal et version vers un asset immuable. Ne pas prétendre qu'une Release
   GitHub équivaut à un installateur vérifié.
5. La CLI et la GUI lisent ce manifeste via HTTPS, vérifient signature,
   empreinte, plateforme, compatibilité de schéma et canal choisi, téléchargent
   en zone temporaire, puis remplacent atomiquement avec retour arrière.
   Respecter les gestionnaires de paquets installés, signatures Windows et
   contraintes des hôtes ; mesurer les installations qui ont réellement pris
   la version cible.

**Sortie :** un commit `main` pilote produit checks, build, canary, sondes,
promotion ou rollback automatique ; un tag pilote produit une release complète
et un lien de téléchargement valide. Aucun job rouge n'est masqué.

## P4 — Forks, sous-modules et fraîcheur amont

**Propriétaires : Infra pour l'ordonnanceur et les gitlinks ; chaque fork pour
ses patches.** Enregistrer upstream canonique, licence, branche suivie,
version/tête canary ou nightly, patch stack locale, sous-modules imbriqués et
consommateurs. `bun` et Oxc suivent une cadence courte ; les autres forks
suivent une cadence fondée sur activité et vulnérabilités, jamais sur un timer
qui écrase les changements. BXC reste optionnel selon son plan propriétaire.

Un job périodique relève tags, heads, CVE/advisories, `ahead/behind`, API et
diff des patches. Il ouvre une branche et une PR de mise à jour par fork ou
groupe de dépendances cohérent, rebase la patch stack dans un worktree jetable,
exécute les gates du propriétaire et publie les conflits avec leur contexte.
Les sous-modules sont mis à jour dans une PR racine **après** publication et
qualification des commits enfants. Une divergence ou un test cassé laisse la
version en place et crée une tâche datée ; aucun force-push d'historique partagé.
Les sources vendored et licences sont vérifiées avant toute copie. La CI
mesure la dérive plutôt que d'affirmer une parité upstream non prouvée.

**Sortie :** rapport quotidien de dérive et PRs rejouables avec upstream SHA,
patches appliqués, checks, licence et gitlinks exacts.

## Ordre, métriques et critère de clôture

Exécuter P0, puis le pilote P1 et le pilote P2 en branches distinctes ; P3
dépend des comptes, règles et canaux effectivement prêts ; P4 réutilise le
contrôleur et les gates de P0–P3. Les mutations GitHub sont idempotentes,
traçables et bornées ; un échec d'authentification, de droits, de CI ou de
déploiement produit `blocked` avec preuve, jamais un succès fictif. L'agent UI
reçoit les contrats et livre son dépôt lui-même.

Suivre au minimum : couverture de l'inventaire = cibles inventoriées / cibles
détectées ; fraîcheur upstream = âge du commit amont non intégré et nombre de
commits de retard ; taux de CI vert sur `main` et PR ; délai médian PR→merge ;
temps commit→canary→production ; taux de rollback ; taux de publication par
package ; taux de clients GUI/CLI sur version courante. Publier numérateur,
dénominateur, fenêtre temporelle et révision des données. Un plan ne devient
**FAIT** que lorsque les preuves de P0–P4 existent pour les dépôts concernés,
le site, la GUI et le MCP public, avec restauration et téléchargement vérifiés.
