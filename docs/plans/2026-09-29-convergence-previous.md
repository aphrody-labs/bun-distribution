<!-- Archived working-tree plan before the language consolidation plan. Original SHA256: b0533ebafd1dc8d8162342dc709189b5ff1cc3ffea0a1229f42f6bf23c14cd0e. Relative links adjusted for this archive location. Historical observations are not current runtime evidence. -->

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Plan Aphrody : convergence des capacités

Statut : **INCOMPLET**, état relevé le 2026-09-29. Ce plan coordonne les dépôts
sans remplacer leurs plans ni leurs règles. Avant toute exécution, relire les
[règles racine](../../AGENTS.md), l'[architecture](../../docs/ARCHITECTURE.md),
l'[inventaire généré](../../aphrody-infra/docs/ecosystem/ECOSYSTEM.md), les règles du
dépôt propriétaire et ses manifests. Relever les Git heads et l'état installé
au début de chaque session : les constats ci-dessous sont datés.

Le superprojet épingle encore d'anciens commits pour AI, OS, UI et Web alors
que leurs checkouts locaux contiennent les changements décrits ici, déjà
publiés par leurs propriétaires. Le manifest.json généré date du 2026-09-27 ;
le générateur nu/manifest.nu cité par le Justfile est absent de ce checkout.
Le checkout NIE WSL, auparavant vide et sans métadonnées Git essentielles, a
été restauré au gitlink `34c55fa…` ; `git status` racine fonctionne à nouveau.
L'agent 0 doit résoudre les écarts de gitlinks et rétablir une génération
vérifiable du manifeste avant d'épingler les commits voulus, sans modifier à
la main le manifeste ni effacer les états concurrents. Un clone propre du
commit racine actuel ne constitue pas encore une preuve de la migration.

## Cible de consolidation Aphrody

**Cible : neuf dépôts canoniques de plateforme et de produit, plus les forks
Bun et Oxc.** Les propriétaires décrits plus bas restent actifs pendant la
migration. Réduire un dépôt exige de transférer ses consommateurs, ses données,
ses contrats, ses licences et son historique ; une copie de source ne suffit pas.

| Dépôt cible | Autorité après migration |
| --- | --- |
| `aphrody-core` | Renommer/transférer `aphrody-contracts`, puis importer avec histoire préservée les fondations neutres de `aphrody-native`, `aphrody-shell` et `aphrody-compat` : contrats, ABI, PTY/VT/Nushell et Bun/N2B. Aucun lien vers OS, Web, UI ou AI. Garder plusieurs workspaces si un lock unique fait régresser les builds. |
| `aphrody-os` | Kernel, Files/Drive FSL, VDFS, index, jobs, RE générique et politiques système. Le sous-arbre FSL conserve sa licence et ses restrictions propres. |
| `aphrody-ai` | Un CLI `aphrody`, un MCP `aphrody-mcp`, un app-server, un RAG, agents et workers. Absorber le pipeline et la configuration modèle Koharu, puis le transport réutilisable de `aphrody-discord` après migration de RG/Shenron ; leurs commandes et données restent métier. |
| `aphrody-ui` | Contrat M3, forks Base UI/Tailwind, hôte Tauri actuel, candidat natif wgpu, composants Files/Inacord/Koharu et projections web/mobile. Une navigation produit ; aucune vue terminal, shell, navigateur ou administration dans la webview grand public. |
| `aphrody-web` | Une origine HTTP `aphrody-site`, session, routes et assets ; Obscura/BXC et adaptateurs de domaine privés. Les serveurs Drive et NIE transitoires ne deviennent pas des origines publiques supplémentaires. |
| `aphrody-infra` | Plan de contrôle Rust et `@aphrody/workspace` Bun pour inventaire, graphe, qualité, sources, déploiement et rollback. Aucun métier applicatif ni second registre. |
| `iecode` | Tout IEVR/Victory Road : formats, VFS du jeu, règles, forge, données, bindings Rust/Bun/Python et actions de domaine ; absorption de NIE sous sa licence propre. |
| `rg`, `shenron` | Domaines, bases, contenus, commandes et parcours publics distincts ; ils consomment les bibliothèques Aphrody. Leur fusion éventuelle demanderait une preuve séparée de parité des identités, domaines, données et licences. |

Cette cible fait passer les **15 dépôts du catalogue daté** à neuf : quatre
fondations deviennent `aphrody-core`, tandis que NIE, Koharu et Discord cessent
d'être autonomes après absorption. Bun et Oxc restent des forks séparés pour
conserver leur relation upstream ; Base UI et Tailwind restent sous UI. Le
superprojet `src` ne sera retiré qu'après remplacement de ses gitlinks et de
son manifeste par une fermeture de sources épinglées dans Infra. `fut` et
tout dépôt absent du catalogue doivent être classés avant le décompte final.

**Applications à livrer.** Aphrody a un hôte de bureau courant `aphrody-app`
(Tauri) et au plus un hôte natif wgpu pour les besoins 3D non couverts, qualifié
séparément ; un site public `aphrody-site` ; un CLI, un MCP, un moteur RAG, un
Explorer Files et un kernel OS. Inacord, Drive, Koharu et Spacebot sont des
fonctionnalités de ces hôtes. RG, Shenron et IECODE gardent leurs parcours
métier réels tant que les remplacer ferait régresser leurs utilisateurs. Un
paquet interne ou un worker n'est pas une nouvelle application publique.

**Bun et livraison.** `src` est aujourd'hui un superprojet Git, pas un
workspace Bun. Le relevé `bun run packages:status` d'Infra du 2026-09-29
découvre treize racines Bun avec leurs propres `bun.lock`. `@aphrody/workspace`
est l'entrée commune existante pour les manifestes, audits et commandes ; le
contrôle Rust d'Infra garde les mutations. Le faire évoluer vers le graphe
cible et des gates par paquet sans imposer un lockfile géant. Un workspace
Bun unique exige d'abord la reproduction des versions, exports, scripts et
builds de chaque propriétaire sur les hôtes annoncés.

**Organisation GitHub.** `aphrody-labs` est la destination prévue. Le relevé
`gh repo list aphrody-labs` du 2026-09-29 montre déjà `aphrody-koharu` privé
et cinq dépôts GNU ; les plans Infra disant que l'organisation est vide sont
datés. Suivre [sa séquence de transfert](../../aphrody-infra/docs/GITHUB-OWNERSHIP.md) :
Bun d'abord, puis les dépôts survivants, avec vérification des collisions,
SHAs, fork upstream, règles, Actions, packages, remotes, gitlinks et
redirections. Garder `aphrody-code <contact@aphrody.com>` comme identité de
commit et le scope npm `@aphrody`. Les commits UI `279dc54` et Web `6f966cc`
sont déjà publiés sur leurs remotes `aphrody-code` ; leur transfert futur doit
préserver ces SHAs.

### Ordre commun et critère de réduction

1. **P0 — vérité et graphe.** Infra actualise le catalogue ; relever heads,
   licences, URLs, imports, dépendances Cargo/Bun/uv, données et services
   installés. Réparer `.gitmodules` et la génération du manifeste racine :
   `git submodule status` échoue actuellement faute de mapping pour
   `aphrody-discord`. Geler les parcours Drive, NIE, Koharu, Discord, RG et
   Shenron avec fixtures et propriétaires actuels.
2. **P1 — contrats et données.** Versionner les seuls messages qui traversent
   un processus dans Core ; garder les API internes chez leurs propriétaires.
   Sauvegardes vérifiées, schémas, migration des consommateurs et rollback
   précèdent tout déplacement de service ou de base.
3. **P2 — absorption par capacité.** IECODE reçoit le domaine NIE ; OS garde
   Files, jobs et RE ; AI reprend CLI/MCP/RAG, le pipeline Koharu et Discord ;
   UI reçoit M3, Inacord et l'éditeur Koharu ; Web reçoit les routes publiques. Une source
   importée reste une source de migration tant que son parcours n'est pas livré.
4. **P3 — organisation et installation.** Migrer les dépôts survivants vers
   `aphrody-labs` selon Infra ; publier depuis une fermeture de SHAs et locks
   propre. Qualifier site, Tauri, éventuel wgpu, web/mobile, CLI/MCP et
   applications de domaine par parcours, erreurs et données.
5. **P4 — fermeture.** Retirer un dépôt, app, binaire ou copie seulement si la
   matrice ancienne → nouvelle autorité n'a aucun consommateur non migré, que
   les gates du propriétaire et le rollback installé passent, et que
   historique et licences restent accessibles. Actualiser Infra, liens et
   gitlinks dans le même lot.

Le [plan NIE unique](../../nie/PLAN.md) détaille son absorption. Les plans Drive,
AI, M3, Infra, IECODE et Discord restent les autorités de preuve par capacité ;
la cible ci-dessus fixe la topologie et l'ordre commun.

## Objectif et frontières

Files est une zone du produit Aphrody, pas une application Drive séparée.
Absorber toutes les capacités utiles de Spacedrive et de SpaceUI veut dire
attribuer à chacune un propriétaire, un parcours réel, un contrat versionné,
une preuve de comportement et une voie de migration des données. Le bureau
vise Rust et M3 natif selon le [plan multi-hôtes](../../aphrody-ui/docs/design/M3-MULTI-HOST-PLAN.md) ;
Tauri reste l'hôte actuellement intégré. Web et mobile utilisent le même
contrat fonctionnel avec des capacités d'hôte explicites. Navigateur, PTY,
terminal et administration ne deviennent pas des vues de la webview grand
public. Le framework M3 reste indépendant de Drive et AI ; les forks Base UI
et Tailwind servent la projection DOM, et Radix est exclu du graphe actif.

L'absorption fonctionnelle ne change aucune licence. Le moteur et le serveur
Drive importés sont FSL-1.1-ALv2, isolés et attribués ; les
[termes Drive](../../aphrody-os/drive/LICENSE) restreignent les services cloud ou
managés à des tiers. « Cloud » signifie ici les volumes personnels et la
synchronisation d'appareils. Une offre hébergée pour des tiers exige des droits
distincts ou une implémentation indépendante. Ne pas présenter la source FSL
comme Apache-2.0.

## État de départ, sans présumer une parité

| Surface | Source présente | Preuve encore requise |
| --- | --- | --- |
| OS | [Copie Drive FSL](../../aphrody-os/drive/README.md) avec cœur, démon, CLI, adaptateurs, schéma et patches. Le build UI préfère son démon et garde un repli pour un checkout autonome. | Démarrage installé, migration des bibliothèques et identités, synchronisation, actions, sécurité des aperçus et données après redémarrage. |
| Web | [sd-server transitoire](../../aphrody-web/drive-server/README.md) dans Web et [passerelle Drive](../../aphrody-web/docs/WEB-RUNTIME.md#passerelle-drive-optionnelle) optionnelle dans aphrody-site. | API, session navigateur, SSE, sidecars, bundle SPA, autres routes du site et bascule de déploiement. La passerelle n'est pas encore le remplacement intégral du serveur historique. |
| UI | Files, File Kinds, Jobs et Redundancy sont reliés à des hooks réels ; l'[audit amont](../../aphrody-ui/docs/DRIVE-UPSTREAM-DIFF.md) recense les écarts de source. | Overview réel, tous les fournisseurs cloud, parcours installés, mobile, accessibilité et parité de chaque action. |
| AI | Le [plan Spacebot/Drive](../../aphrody-ai/docs/PLAN.md#spacebot-and-drive-ai-parity) distingue runtime et pages amont fictives. | Enrichissement de fichiers, mémoire, actions AI, annulation et filtrage de sécurité réellement branchés. L'archive Drive retourne encore un verdict toujours favorable. |
| Socle | Contracts, OS, Web, AI, UI et Infra ont des propriétaires et des API existantes. | Un contrat Files cohérent, une preuve de non-régression et la fermeture des copies transitoires. |

La présence de blobs, un cargo check ou une route affichée ne prouvent pas la
parité de l'application installée. Les trois pages Spacedrive Memories,
Autonomy et Schedule sont des placeholders dans la révision auditée ; elles ne
comptent pas comme fonctions opérationnelles perdues. En revanche, l'hôte
mobile amont absent et les fonctions réelles non raccordées restent des écarts.
Les [doublons Files, VFS et recherche](../../docs/FILE-SURFACE-AUDIT.md) relevés dans
les checkouts sont à résoudre selon ces mêmes gates, avec migration des
consommateurs avant suppression des copies.

## Autorités et décision sur le backend du site

| Dépôt | Autorité | Contrat exposé |
| --- | --- | --- |
| aphrody-contracts | IDs, schémas neutres, erreurs, événements et versions | Types Rust/TS et compatibilité ; aucune dépendance inverse. |
| aphrody-os | VDFS, bibliothèques, volumes, index, sync, sidecars, jobs, démon et politique système | Service local supervisé et API Files typée, sans crate AI. |
| aphrody-web | aphrody-site, origine HTTP publique, auth/session, transport et assets web | API publique unifiée. sd-server reste privé et transitoire jusqu'à parité. |
| aphrody-ai | App-server, agents, modèles, mémoire/RAG, OCR et workers | Capacités AI par processus et contrats ; aucune dépendance AI dans UI, OS ou Web. |
| aphrody-ui | M3, navigation unique, hôtes et présentation Files | Client des contrats et adaptateurs hôte, sans base Drive dans la webview. |
| aphrody-infra | Routes, services, destinations, release et rollback | Topologie et preuve d'installation ; aucun registre parallèle à la racine. |

**aphrody-site reste l'origine HTTP publique**, pas un nouveau produit serveur.
L'agent Web relève d'abord les besoins réels de Files, Chat, Models et des apps
AI, puis compare aphrody-site, sd-server et l'app-server AI. Il choisit une
refonte interne du site ou un service privé derrière le site selon les mesures
de cohérence, latence, isolation et compatibilité. L'autorité de session
publique reste unique ; OS et AI gardent leurs données et workers. Une
réécriture complète n'est recevable qu'avec un remplacement exécutable,
migration des clients et données, compatibilité des routes et rollback.

Le contrat public cible couvre les bibliothèques, entrées/identités,
recherche/tri/pagination, mutations, jobs, sidecars et requêtes Range,
événements ordonnés/rejouables, SSE utilisable par un client navigateur,
annulation, capacités, erreurs versionnées, auth/scopes, limites de taille et
assets offline. Il préserve aussi les routes non Drive du site, leur SEO,
leurs statuts HTTP et leurs sessions. Un proxy vers plusieurs propriétaires
peut être interne ; il ne devient pas une seconde origine publique.

## Mandats des sous-agents de la prochaine session

Le coordinateur attribue **un dépôt propriétaire par agent**. Deux agents ne
modifient pas le même dépôt sans worktrees séparés et coordination explicite.
Chaque agent publie son commit, la preuve de validation et ses besoins envers
un autre propriétaire ; il n'édite pas le dépôt voisin. Le coordinateur
actualise ensuite les gitlinks de la racine sans embarquer les états sales
préexistants. Commencer par 0–2, puis paralléliser les implémentations après
publication des contrats.

| Agent / dépôt | Travail assigné | Sortie exigée |
| --- | --- | --- |
| 0 — racine src | Relever heads, gitlinks, licences, états Git et dépendances ; maintenir l'ordre des migrations. | Révisions publiées, liens vers preuves par propriétaire, gitlinks mis à jour après leurs commits. |
| 1 — aphrody-contracts | Définir Files v1 en cartographiant les RPC Drive existants : IDs, volumes, pagination, actions, tâches, événements/cursors, erreurs, auth scopes et négociation de capacités. | Schémas et types générés additifs, journal de compatibilité et consommateurs OS/Web/AI/UI migrés. |
| 2 — aphrody-ui, audit | Transformer l'[audit amont](../../aphrody-ui/docs/DRIVE-UPSTREAM-DIFF.md) en matrice par parcours Spacedrive, SpaceUI et Spacebot : desktop, serveur, CLI, cloud, mobile, données, clavier et accessibilité. | Révision amont épinglée, preuve source, état présent/modifié/absent/intentionnel, propriétaire et scénario de validation pour chaque ligne. |
| 3 — aphrody-os | Faire du backend importé l'implémentation canonique : démarrage, bibliothèques, migrations, index, sync, adaptateurs, sidecars et jobs. Corriger la sécurité des aperçus et remplacer le faux verdict d'archive par un contrat AI effectif ou une indisponibilité explicite. | Démon/CLI installables, migration réversible vérifiée par identité et checksum, opérations qualifiées dans la matrice. |
| 4 — aphrody-web | Auditer aphrody-site, sd-server, UI et besoins AI ; refondre site, session, API Files, streaming, assets, limites, annulation, erreurs et observabilité sans perdre les routes existantes. | Site seul public, contrat HTTP complet, anciens clients/URLs servis ou migrés ; sd-server privé sans fonctionnalité unique. |
| 5 — aphrody-ai | Relier app-server et vrai runtime Spacebot aux objets Files par Contracts/OS : recherche, extraction, OCR, embeddings, mémoire, actions, jobs et sécurité d'archive. | Parcours objet → job → artefact → UI, refus honnête si indisponible, annulation/reprise et filtrage avant indexation prouvé. |
| 6 — aphrody-ui, produit | Migrer les consommateurs au contrat canonique, finir Files/Overview sur données réelles, qualifier thème M3 personnalisable et hôtes web, desktop et mobile. Réutiliser les GUI Rust disponibles avant une réécriture wgpu. | Parcours installés, actions/événements réels, clavier/lecteur d'écran, responsive/tactile ; aucune suppression de copie avant migration des consommateurs. |
| 7 — aphrody-infra | Réconcilier catalogues routes/services et stockage pour site, OS et AI ; préparer sauvegarde, déploiement progressif et retour arrière. | Bundle épinglé, restauration démontrée, sondes et rollback ; aucune activation cloud hébergée FSL sans droits. |
| 8 — aphrody-native | Vérifier les besoins réels de FFI, médias et accélération de Files/AI sans déplacer le moteur FSL. | API réutilisée et mesure si modification, ou constat documenté « aucun changement requis ». |
| 9 — aphrody-shell | Garder PTY/VT et commandes dans Shell/OS, hors webview ; vérifier les références d'objets Files nécessaires. | Contrat d'ouverture/commande et sortie si requis, sans seconde UI shell. |
| 10 — aphrody-compat | Qualifier Bun/N2B, génération TS, workspaces et audits d'imports/exports pour UI/Web, sans protocole métier dupliqué. | Builds et génération reproductibles, entry points documentés, ou constat d'absence d'impact. |
| 11 — aphrody-koharu | Vérifier les objets/médias Drive utilisés par l'éditeur et ses jobs ; garder le manga chez Koharu. | Adaptateur de référence Files versionné si requis, sans copier Drive. |
| 12 — aphrody-discord | Vérifier si les transports exposent Files/AI ; laisser commandes et auth à l'application consommatrice. | Contrat nécessaire ou constat documenté d'absence d'impact, sans accès direct à la base Drive. |

## Ordre et gates de bascule

1. **P0 — Inventaire et droits.** Agents 0–2 figent les révisions, licences,
   parcours et écarts. Couvrir explorer, recherche, tags, sources et cloud,
   sync/partage, redondance, aperçus, jobs, CLI, sauvegarde, serveur, mobile
   et AI. Ne fermer aucune ligne sur présence de source seule.
2. **P1 — Contrats et données.** Contracts publie API/événements/compatibilité ;
   OS et Web valident capacités et identifiants, AI/UI leurs besoins. Définir
   migration de ~/.spacedrive vers ~/.aphrody/drive, versions de schéma,
   sauvegarde, reprise et rollback avant toute bascule.
3. **P2 — Implémentation.** OS termine le moteur, Web refond aphrody-site,
   AI raccorde ses workers. Native, Shell, Compat, Koharu et Discord ne
   changent que pour un besoin démontré. Chaque agent livre preuves et commit.
4. **P3 — Présentation.** UI raccorde les parcours et qualifie les hôtes.
   Le navigateur sert la même application grand public avec permissions
   adaptées ; mobile a ses propres gates d'installation et d'accessibilité.
5. **P4 — Comparaison et bascule.** Infra compare ancien et nouveau sur un
   corpus sauvegardé : contenu, UUID, métadonnées, actions, erreurs, flux,
   sidecars, SSE, sessions, site existant, latence et mémoire. Bascule
   progressive avec surveillance et rollback réellement exercé. Retirer
   les anciennes copies après migration des consommateurs **et** des données.

Pour chaque fonction, « aucune régression » exige un parcours amont observable,
sa projection Aphrody, son contrat, l'état des données avant/après, le résultat
sur les hôtes annoncés et le comportement d'échec. Les gates des propriétaires
s'appliquent aux futures implémentations ; échecs et contrôles non exécutés
restent visibles. Clore le programme seulement quand la matrice n'a plus de
perte inexpliquée et que la release installée possède une voie de retour.

<a id="nie-convergence"></a>
## Convergence de NIE vers IECODE et Aphrody

**Décision : IECODE reçoit toute la couche propre à IEVR ; les dépôts Aphrody
reçoivent les capacités génériques et les hôtes communs. Aucun nouveau dépôt
`aphrody-engine`.** La
[matrice de capacités NIE](../../docs/NIE-CAPABILITY-MAP.md) affecte les 46 crates,
les entrées Bun et les surfaces uv à leurs propriétaires existants. Elle part
du gitlink NIE `34c55fa1da54f715bb78ac336167fe18b13f9cca` et du
[catalogue Infra régénéré](../../aphrody-infra/docs/ecosystem/ECOSYSTEM.md#nie),
après restauration du checkout WSL. Le dépôt NIE reste une référence tant que
ses consommateurs, données, routes, scripts et preuves n'ont pas migré. Sa
licence commerciale et les assets du jeu gardent leurs frontières de
distribution ; ce plan ne réactive aucun service NIE sur le VPS.

L'unicité demandée se juge sur les entrées réellement exposées : un plugin
agent, un serveur MCP, une API UI M3, un hôte Tauri, un hôte 3D natif wgpu,
un CLI public, un moteur RAG, un pipeline RE, un Explorer Files, un kernel OS
et une origine HTTP Aphrody. Les bibliothèques internes et adaptateurs de
domaine ne créent pas une seconde autorité. L'état actuel ne satisfait pas
encore ces invariants : le plugin déclare deux MCP, `aphrody-mcp` relaie
`nie-mcp`, `aphrody-model-view` est un autre binaire Tauri, `nie-editor` et
`nie-game` sont des hôtes natifs distincts, et `nie-site` sert encore ses
propres routes. Ne pas présenter une façade unifiée comme une migration finie.

1. **P0 — Inventaire et droits : Infra + racine.** Garder le checkout NIE,
   les gitlinks et le [catalogue généré](../../aphrody-infra/docs/ecosystem/ECOSYSTEM.md)
   vérifiables. Relever chaque consommateur Rust/Bun/Python, bin, outil MCP,
   route, script et donnée ; trancher la divergence entre le `LICENSE`
   commercial Cargo et le `MIT` déclaré par `@aphrody/nie`. Préserver les
   archives, notices et fixtures sans copier les assets du jeu par défaut.
2. **P1 — Fondations : IECODE, Contracts et OS.** IECODE reçoit formats,
   règles, données, sauvegardes, wiki, forge et adaptateurs IEVR sous leur
   licence ; les bibliothèques génériques déjà dans IECODE sont rapprochées
   des propriétaires Aphrody sans copier deux fois leur logique. Contracts
   publie seulement les messages réellement partagés. OS garde kernel,
   Drive/VDFS, jobs et RE générique. Couper la dépendance actuelle de la FSM
   IEVR `nie-app` au renderer UI avant la greffe, afin que IECODE puisse
   consommer Aphrody sans créer de dépendance inverse.
3. **P2 — Consommateurs : AI, Web et UI.** AI expose les commandes IEVR
   d'IECODE dans `aphrody`, les outils dans `aphrody-mcp` et l'indexation
   sémantique dans `aphrody-rag`. Web absorbe les hôtes HTTP `nie-site` et
   `nie-model-serve` dans `aphrody-site`, avec les handlers métier fournis par
   IECODE. UI intègre Inacord à Files et l'éditeur/jeu aux hôtes communs ;
   IECODE fournit leurs modèles et actions IEVR, M3/Base UI les composants
   génériques, sans Radix actif. Retirer chaque ancien binaire ou paquet
   seulement après migration de ses clients et scripts.
4. **P3 — Contrôle des autres propriétaires.** Shell conserve PTY/VT et
   Nushell, Koharu le manga 2D, Discord le transport, Compat Bun/N2B,
   Native les primitives neutres et Infra la topologie. Aucun crate NIE
   entier ne doit entrer dans Shell, Koharu ou Discord par simple proximité
   de nom ; une primitive commune exige un usage et une licence établis.
5. **P4 — Bascule sans régression.** Rejouer les gates du [plan NIE](../../nie/PLAN.md) :
   provenance forge G4–G6, octets golden, formats et saves, parité
   native/headless/wasm, captures et écrans, persistance Inacord, URLs,
   erreurs et assets. Qualifier les applications Tauri et wgpu installées,
   le site, les données sauvegardées et le rollback. `nie-wasm` rend encore
   une interface 2D partielle : la présence du code ne prouve pas le jeu
   fidèle. Retirer NIE seulement avec une matrice de consommateurs vide et
   une preuve de parcours pour chaque fonction.

Les prochains agents travaillent chacun dans leur dépôt propriétaire et
publient un handoff vérifiable avant toute suppression dans NIE :

| Dépôt | Mandat NIE | Handoff requis |
| --- | --- | --- |
| `iecode` | Absorber la couche IEVR, jeux de données, forge, formats et bindings de domaine. | API de bibliothèque, licence/provenance, schémas migrés et gates G4–G6. |
| `aphrody-contracts` | Versionner les seuls messages Files/game qui traversent un processus. | Schémas compatibles consommés par OS, IECODE, Web, AI et UI. |
| `aphrody-os` | Garder kernel, Files, jobs et RE générique ; intégrer la source CPK IECODE. | Un adaptateur sans second index Files ni cycle de dépendance. |
| `aphrody-ui` | Unifier M3, Explorer, Tauri et hôte wgpu ; consommer les vues IEVR d'IECODE. | Parcours installés, accessibilité, comparaison des renders et suppression qualifiée des hôtes concurrents. |
| `aphrody-web` | Servir les handlers IECODE par `aphrody-site` et migrer les URLs NIE. | Routes, sessions, assets, streaming, protections et rollback comparés. |
| `aphrody-ai` | Exposer le CLI, MCP et RAG uniques par adaptateurs IECODE. | Parité des commandes, des 19 outils `nie.*` et de l'indexation avec données autorisées. |
| `aphrody-infra` | Maintenir catalogue, topologie, mesures, bundle et restauration. | Source closure et plan de déploiement sans réactiver les anciens services. |
| `aphrody-native`, `aphrody-compat` | N'absorber que les primitives neutres prouvées, respectivement native et Bun/N2B. | Dépendances et provenance qualifiées, ou constat « aucune greffe ». |
| `aphrody-shell`, `aphrody-koharu`, `aphrody-discord` | Vérifier les consommateurs ; ne recevoir aucun crate IEVR entier. | Constat d'absence d'impact ou adaptateur précis, sans second PTY, moteur manga ou bot. |

<a id="bun-adapter-handoffs"></a>
## Chantier parallèle conservé : adaptateur Bun pour Qwen3-Coder 30B

D3T demeure **INCOMPLET** et indépendant de la migration Drive. L'autorité
est le [plan AI D3T](../../aphrody-ai/docs/PLAN.md#d3t--qualify-a-bun-coding-adapter-for-qwen3-coder-30b)
et le [runbook d'entraînement](../../aphrody-ai/docs/training.md#bun-qwen3-coder-30b-adapter-delivery).
Le fork Bun fournit d'abord un commit propre, sa base amont et des tâches de
référence épinglées. AI fournit les données à provenance vérifiée, le QLoRA
MoE, l'export et la comparaison avec le modèle de base. Infra fournit un hôte
30B après un pilote mémoire mesuré ; la racine épingle les révisions acceptées.
Au relevé précédent, le fork suivait la base amont
a4f1429148114ddc3bccc13764781be27a7a9523 avec des modifications locales ;
vérifier de nouveau ce constat avant de figer un jeu de données. AI possédait
un modèle Q4_K_M épinglé, un worker LoRA pleine précision, un export gardé et
un runtime llama.cpp, mais pas encore de QLoRA qualifié. Le GGUF d'inférence
ne sert pas de base d'entraînement : employer les safetensors officiels puis
valider l'adaptateur contre le modèle GGUF exact. Le runbook place une cible
initiale de 48 Gio de mémoire GPU pour le pilote 30B.
Le GPU local 12 Gio sert au pipeline et à l'inférence hybride, pas à prouver
la capacité d'entraînement 30B. Un téléchargement ou une loss d'une étape ne
clôt ni D3T ni ce plan.
