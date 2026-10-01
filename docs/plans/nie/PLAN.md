# NIE → Aphrody : plan unique d'absorption

> **Décision du 2026-09-30 :** IECODE (`/home/aphro/iecode`) est l’unique propriétaire de tout code IEVR/NIE. Aucun crate, module, outil ou binding spécifique au jeu ne doit être ajouté à Aphrody, `src` ou `aphrody-py`. Les intégrations spécifiques au jeu retirées d’Aphrody ont été supprimées après vérification des équivalents IECODE.


Statut : **incomplet**, 2026-09-29. Ce fichier est la seule liste active du
chantier NIE ; les anciens plans restent dans l'historique Git. Il applique le
[plan Aphrody racine](../workspace/PLAN.md#nie-convergence), son
[architecture](../../architecture/workspace/ARCHITECTURE.md), la
[matrice NIE](../../reference/workspace/NIE-CAPABILITY-MAP.md) et les catalogues
[Infra](../../reference/infra/ecosystem/ECOSYSTEM.md). Les plans de chaque
propriétaire fixent leurs API et leurs gates. Relever leurs heads, manifests et
états installés à chaque lot : les observations ci-dessous sont datées.

## Résultat recherché

IECODE possède le jeu IEVR et sa reconstruction ; les capacités réutilisables
entrent dans les propriétaires Aphrody existants. Aucun dépôt ou produit
`aphrody-engine` nouveau. Aphrody livre une seule navigation M3, un hôte
Tauri courant, au plus un hôte natif wgpu justifié par le 3D, un
`aphrody-site` public, un CLI `aphrody`, un MCP `aphrody-mcp`, un RAG, un
Explorer Files et un kernel OS. Inacord est une fonctionnalité, pas une app
Tauri, un serveur ou un design system parallèle. Les vues terminal, shell,
navigateur et administration restent hors de la webview grand public.

Le dépôt NIE devient une référence historique seulement quand chaque
comportement, donnée, appelant, route, commande, script et licence a un
propriétaire effectif. Les assets de jeu, bases et sauvegardes ne sont pas
assimilés à du code source. La licence commerciale NIE et la licence FSL
Drive restent distinctes des licences Aphrody ; aucun déplacement Git ne
change les droits de distribution.

## État mesuré et correction de trajectoire

- Le lot initial a déplacé **686 fichiers suivis** depuis NIE
  `5714a3344f9190b4af558c79cb44fe804c5c9a74`. La
  [manifeste SHA-256](../../reference/nie/SOURCE-TRANSFER-MANIFEST.json) donne chaque
  source, destination et empreinte initiale. UI `279dc54` et Web
  `6f966cc` ont été publiés sur leurs remotes actuels `aphrody-code`.
  IECODE `003e043` possède les paquets Bun transférés. Ce lot retire les
  copies de source NIE suivies par le manifeste ; il ne qualifie ni la parité
  fonctionnelle ni l'activation des destinations.
- `aphrody-ui/apps/nie-web` est **hors workspace Bun actif**. Ses imports
  Radix/Rosegriffon, son build Wasm et son hôte navigateur restent à intégrer.
  Les paquets `asset-source`, `nie-bridge` et `nie-media` ont été déposés
  dans UI pour préserver la source ; leur propriétaire final est à scinder
  selon les contrats ci-dessous. Leur présence ne prouve aucun parcours livré.
- `aphrody-web/crates/ievr-site` est une bibliothèque de migration optionnelle
  dans `aphrody-site`. Le site courant compile sans cette feature. Son
  activation échoue sur les JSON de jeu `formations-full` et
  `skills-cutin*` absents ; routes, auth et assets n'ont pas encore la parité.
  L'ancien `main.rs` n'est pas un second binaire Cargo actif.
- `@aphrody/workspace` dans Infra découvre les workspaces Bun et leurs locks
  individuels ; `src` n'est pas un workspace Bun global. IECODE a enregistré
  `@aphrody/nie`, `@nie/game` et `@nie/plugin`, mais `@nie/game` ne
  typechecke pas sans le vrai `formations-full.json`. Aucun JSON vide ne
  remplace cette donnée. La source NIE restante dépend encore de données
  effacées ou ignorées.
- Les trois packages Bun IECODE précédemment copiés dans `aphrody/packages/iecode/`
  et leurs entrées workspace ont été retirés le 2026-09-29 faute de parité ABI,
  données et licences. `@aphrody/bun-test-dom` reste le preload DOM générique;
  aucun loader IEVR n'est actif dans ce monorepo. Le registre d'extraction Bun
  conserve les hashes et chemins historiques.
- La destination GitHub est `aphrody-labs` selon
  [Infra](../../reference/infra/GITHUB-OWNERSHIP.md). Le transfert d'un repo,
  le changement de remote et le push d'une release sont des étapes distinctes ;
  préserver les commits déjà publiés et les redirections.

## Matrice de propriété et interfaces uniques

| Source NIE / collision | Propriétaire final | Travail de séparation |
| --- | --- | --- |
| `nie-core`, `nie-data`, `nie-formats`, `nie-save`, `nie-lua`, `nie-runtime`, `nie-net`, forge, wiki, Steam, `niepy` | IECODE | Déplacer du parseur aux bindings, conserver formats et fixtures byte-exactes, fusionner avec `iecode-core/re/pipeline/ffi` sans écraser leurs API. |
| `@nie/game`, `@aphrody/nie`, chargeurs Bun `@nie/plugin` | IECODE | Une implémentation de règles et une ABI C versionnée ; Bun devient un binding, pas un second moteur. Garder les anciens exports comme façade temporaire. |
| `asset-source`, `nie-bridge`, `nie-media` actuellement déposés dans UI | IECODE pour URLs, DTO et médias IEVR ; Core pour messages neutres interprocessus ; OS/Web pour transport ; UI pour l'adaptateur de vue | Découper à la frontière des imports réels, migrer les consommateurs, puis retirer les paquets sources déposés au mauvais niveau. Ne pas ajouter une deuxième VFS ou un deuxième client MCP. |
| `nie-ui`, `nie-web`, Inacord, Explorer, éditeur, jeu navigateur | UI pour M3, composants, hôtes et routes de produit ; IECODE pour actions, état, règles et assets IEVR | Intégrer les vues utiles dans l'unique `app-ui`, rendre les capacités d'hôte explicites, enlever Radix/Rosegriffon et la navigation doublée. `nie-web` ne devient pas une app produit autonome. |
| `nie-site`, `nie-model-serve`, /f, /b, /api/v1, assets, updater, SSE | Web `aphrody-site` public ; IECODE pour handlers métier ; Infra pour routes installées | Un routeur/session publics ; comparer méthodes, corps, statuts, cache, auth, Range et URLs héritées avant extinction des anciens services. Le modèle 3D du jeu n'est pas un serveur d'inférence AI. |
| `nie-cli`, `nie-mcp`, indexation sémantique et scripts d'agent | AI `aphrody` / `aphrody-mcp` / `aphrody-rag` ; IECODE pour les opérations de jeu | Préserver noms et sorties des commandes et des 19 outils `nie.*` ; retirer le sous-processus NIE et le plugin doublon après migration des clients. |
| RE, fichiers, jobs, compression, rendu et recherche génériques | OS pour kernel/Files/RE/jobs ; UI pour rendu M3 et 3D ; Core/Native pour primitives réellement neutres | Mesurer les doublons `iecode-re`/`aphrody-re`, VFS/Explorer et renderers par API et consommateur. Un besoin de nom semblable ne justifie pas un déplacement. |
| Déploiement, ports, TLS, sauvegardes, release et workspace Bun | Infra | Utiliser catalogues et `@aphrody/workspace` existants ; aucune configuration de production cachée dans NIE, UI ou Web. |

Shell garde PTY/VT/Nushell ; Koharu le traitement manga jusqu'à son absorption
prévue par le plan racine ; Discord le transport jusqu'à sa greffe dans AI.
Aucun crate IEVR entier n'entre dans ces dépôts par proximité de vocabulaire.
Bun et Oxc restent des forks amont séparés. Base UI et Tailwind sont les forks
M3 dans UI ; `@radix-ui` est exclu du graphe actif.

## Décisions d'architecture arrêtées

Le [plan racine](../workspace/PLAN.md) fixe maintenant la cible des dépôts et le
[choix de dépôt M3](../workspace/PLAN.md#m3-repository-decision). Les choix spécifiques
au chantier NIE sont :

- Les crates et packages propres au jeu IEVR rejoignent IECODE ; seules les
  capacités Rust/Bun génériques rejoignent `aphrody`, et Python suit la même
  frontière entre le scripting IEVR d'IECODE et l'outillage générique de
  `aphrody-py`. Pas de
  dépôt NIE/engine séparé. `aphrody-m3-tokens` et ses packages restent également dans
  le monorepo `aphrody`; les packages npm gardent leurs noms et APIs.
- Le crate `nie-ffi` expose l'adaptation du domaine, tandis que `aphrody-ffi`
  demeure l'unique agrégateur FFI Aphrody. Le build Emscripten est un artefact
  séparé à chargement explicite issu des mêmes bibliothèques, jamais une
  deuxième bibliothèque chargée dans Bun.
- Tauri reste l'unique hôte desktop distribué. Jeu, Explorer, éditeur et
  Inacord deviennent des modes de l'app UI. Aucun host Bevy/winit séparé par
  défaut ; un host GPU dédié exige une preuve de parcours IEVR non satisfait
  dans les hôtes qualifiés et appartient à l'app Aphrody s'il est nécessaire.
  Bevy n'est pas une dépendance de rendu imposée ; UI possède le renderer
  générique et IECODE les scènes/actions IEVR.
- Le navigateur accède aux données de jeu par l'API Files typée et autorisée
  OS/Web. Les routes `/f` et `/b` ne sont pas exposées comme lecture brute au
  frontend. Garder côté serveur les redirections/adaptateurs temporaires,
  Range/ETag et streaming borné ; aucun bundle VFS complet ne remplace l'API.
- Les jeux de données et sauvegardes restent hors Git avec provenance,
  empreinte et droits vérifiés ; seules les fixtures redistribuables entrent
  au dépôt. Garder les licences/notices commerciales par source. Pas de
  publication tant que les droits n'autorisent pas le package exact.
- `aphrody-site` est l'unique origine publique et `aphrody-mcp` le seul MCP
  publié. Garder routes/outils/commandes de compatibilité jusqu'à migration
  vérifiée des consommateurs et exercice du rollback.
- `aphrody` possède un workspace Cargo et un workspace Bun pour les sources
  Aphrody. Bun, Oxc, Base UI et Tailwind gardent leurs workspaces et lockfiles
  amont épinglés : la fusion des sources Aphrody ne réécrit pas les forks.

## Séquence ouverte

### P0 — sécuriser la vérité avant une nouvelle suppression

- [ ] Comparer le manifest de transfert aux heads actuels et à `git ls-files` ;
  classer chaque source Rust/Bun/Python, script, route, bin, test, document et
  `include_str!` restant. Réparer les liens, `.gitmodules` racine et la
  génération du manifeste de fermeture ; ne pas embarquer les modifications
  concurrentes d'un autre dépôt.
- [ ] Reconstituer depuis les entrées autorisées les tables de formation,
  skill cut-in, wiki et inventaire indispensables à la compilation. Le jeu
  installé de 57 Go et les bases récentes ne sont pas présents dans ce
  checkout ; la récupération doit identifier provenance, hash et droits.
  Garder sauvegardes et index CPK récupérés hors Git et hors des copies
  locales inutiles. Terminer l'import `nie-pg` depuis l'installation
  autorisée et exposer shops, galeries et rosters par requêtes typées. Aucun
  fichier factice.
- [ ] Préserver le `license-file` commercial des crates NIE, examiner les
  notices des forks et vérifier les droits des fixtures avant toute nouvelle
  distribution. Le staging Aphrody qui déclarait MIT a été retiré; aucun
  paquet ne publie une licence qu'il ne possède pas.
- [ ] Geler une matrice exécutable ancienne → nouvelle par commandes, 19
  outils MCP, endpoints, vues, données, fixtures et hôtes. Chaque ligne a un
  propriétaire, un consommateur, un résultat ancien, un résultat nouveau,
  un cas d'erreur et un rollback.

### P1 — bibliothèques et contrats avant les hôtes

- [ ] IECODE absorbe les crates IEVR en ordre formats → VFS/data/save →
  règles/Lua/runtime → forge → FFI/Wasm ; il compare `python/niepy` à
  `src/niepy` par exports, chargement FFI et Ren'Py. Préserver les aliases
  le temps de migrer les consommateurs ; couper la dépendance de la FSM
  `nie-app` au renderer UI avant de fermer NIE.
- [x] Première crate feuille : `nie-data` transférée sans copie résiduelle vers
  `iecode/crates/ievr-data` (`iecode-ievr-data`, bibliothèque `nie_data`).
  254 fichiers suivis, initialement 252 byte-identiques et 2 adaptés, puis
  formatage mécanique selon IECODE ; les 98 tests unitaires et les 1 516
  tests du workspace IECODE passent (1 ignoré), ainsi que Clippy. Le
  consommateur NIE `nie-ocgen` compile, mais
  `nie-core` reste bloqué par trois JSON de jeu absents. La provenance, la
  limite de licence et le rollback sont dans
  [IEVR-DATA-MIGRATION](../../reference/iecode/IEVR-DATA-MIGRATION.md).
- [ ] Core ne reçoit que les messages partagés entre processus : identités,
  capacités, erreurs, jobs et événements. OS expose une API Files/VFS
  unique ; IECODE y adapte les archives CPK et schémas du jeu sans second
  Explorer ni index. AI, Web et UI consomment ces contrats sans cycle.
- [ ] Décomposer les paquets déposés en UI au premier lot et corriger leurs
  imports dans les propriétaires finaux. Infra `@aphrody/workspace` vérifie
  les workspaces, exports, scripts et locks. Les workspaces Aphrody sont
  réunis dans `aphrody`; les workspaces/lockfiles upstream restent épinglés
  et indépendants.

### P2 — un client et un site réellement activés

- [ ] UI fusionne Inacord et les composants utiles dans `app-ui` :
  M3 personnalisable, Base UI/Tailwind, clavier, lecteur d'écran, tactile,
  fenêtres et permissions d'hôte. Remplacer chaque import Radix/Rosegriffon,
  les faux parcours et la navigation dupliquée. Ne pas remettre shell,
  navigateur ou console dans la webview grand public.
- [ ] Web extrait les handlers IEVR de l'adaptateur transféré et monte les
  routes dans `aphrody-site` après restauration des données et compilation
  de la feature. Faire correspondre /api/v1, /f, /b, /assets, /model,
  downloads, updater, SSE, health, statuts, ETag, auth et assets ; gérer
  préfixes et redirections pour les anciens clients. Le Site garde une seule
  session publique et les routes RG/Shenron restent chez leurs domaines.
- [ ] Qualifier Tauri comme unique bureau Aphrody et intégrer les modes utiles
  de jeu, Koharu et Files dans les hôtes prévus. Pas de nouvel hôte distribué ;
  un hôte GPU intégré à l'app n'est construit que si un parcours IEVR échoue
  aux critères mesurés dans Tauri/web. Aucun ancien `nie-explorer`,
  `nie-editor`, `nie-game` ou hôte Inacord ne redevient une app distribuée.

### P3 — commandes, données et production

- [ ] AI remplace les commandes NIE dans `aphrody`, les 19 outils dans
  `aphrody-mcp` et le RAG IEVR dans `aphrody-rag`, avec adaptateurs IECODE
  et annulation/erreurs réelles. Retirer le relais `nie-mcp` seulement quand
  les appels externes et scripts utilisent le nouvel endpoint.
- [ ] Infra migre les sources canoniques survivantes vers `aphrody-labs`
  selon son plan GitHub : Bun d'abord ; vérifier SHAs, upstream, accès,
  Actions, packages, remotes, gitlinks et URLs après chaque transfert.
  Replacer les scripts de release/site de NIE dans le contrôle Infra avant
  de supprimer leur dernière commande utilisée.
- [ ] Migrer données, sauvegardes, schémas et état utilisateur avec hashes,
  sauvegarde hors hôte, redémarrage et retour arrière exercé. N'activer
  aucune ancienne unité NIE uniquement parce que son code a été copié.

### P4 — fidélité IEVR et fermeture de NIE

- [ ] Re-mesurer la forge G4–G6 sur le jeu courant : frontières
  d'instructions autour de `0x14003e85d`, `vpaddw` VEX.256, candidat
  Cross, fin des lectures de référence G4/G5, provenance et sortie binaire
  indépendante octet pour octet. Dater hôte, revision et hash des entrées.
- [ ] Terminer Lua `lua_Integer` 32 bits, cycle de ressources, entrée,
  audio, animation, scènes et dispatcher global ; borner toute évaluation
  Lua publique. Prouver l'égalité d'état native/Wasm pour mêmes entrées et
  instants.
- [ ] Couvrir les 38 écrans de référence : configs, fonts, localisation,
  ressources d'ouverture, identité de l'action `title_menu_2`, six étapes
  avatar, Options, contrôles, `story_mode_top_menu`,
  `chronicle_mode_top_menu`, `soccer_formation_menu`,
  `players_universe_menu`, `ability_learning_board_menu`, stade, coach,
  aura et quêtes. Reproduire scroll de liste, focus `ListScroll` et
  `mLockFocusIdx` ; exiger assets/actions corrects, géométrie statique à
  ≤1 pixel en 1920×1080, SSIM ≥0,99 et fixtures déterministes.
- [ ] Finir 3D/authoring : clips → poses GLB, morphs, skinning GPU,
  vêtements 19–21, projets, transactions, undo/redo, prefabs, aller-retour
  GLB/VRM et VMC/OSC. Vérifier la parité CPU/GPU et l'égalité sémantique
  après réimport.
- [ ] Fusionner les doublons internes de croissance, skills, détection de
  formats, G4CM, règles d'équipe, vue web et scoring de traduction. Garder
  des façades de compatibilité jusqu'au dernier appelant ; réduire les
  dépendances Wasm atteignables et son budget mesuré. Reconstruire le
  module Lua Wasm et sa readiness, remplacer les lectures frontales brutes
  /f et /b par l'API Files typée et autorisée avec Range/ETag et streaming
  borné. Garder Bevy optionnel et qualifier `nie-render`/`nie-render3d` par leurs
  consommateurs, parité et coût. Archiver toute crate sans consommateur
  après préservation de sa provenance et de sa référence de portage.
- [ ] Clore chaque ligne de la matrice par comparaison fonctionnelle,
  performance et erreurs sur l'artefact installé ; préserver archives,
  tags, licences et provenance. Retirer NIE, ses bins et ses services
  seulement avec zéro consommateur actif, source closure publiée et rollback
  démontré. Le plan devient vide après transfert de ses preuves, sans
  recopier les tâches terminées dans un autre plan NIE.

## Preuve par lot

Consigner dans le dépôt propriétaire : source SHA, destination SHA, hash des
fichiers/données, anciens et nouveaux exports/routes/commandes, consommateurs
migrés, versions de schéma, hôtes, sortie des gates applicables, checks non
exécutés, comparaison de l'échec et chemin de retour. Infra épingle la
fermeture de sources et la release ; ce fichier garde seulement les tâches
encore ouvertes. Une compilation ou un transfert Git ne vaut jamais parité
d'un parcours installé.
