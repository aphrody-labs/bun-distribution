<!-- SPDX-License-Identifier: Apache-2.0 -->
# Fabrique SSH : lot borné du 2026-10-09

Le propriétaire a demandé l'orchestration parallèle des travaux critiques Bun et
Aphrody avec une échéance d'une heure. Les observations ci-dessous couvrent la
fabrique SSH ; elles ne constituent pas une clôture de tous les plans.
Les règles et allocations viennent du [contexte](windows-native.md), de
[vps-cargo.json](../../../../tools/aphrody/config/host/vps-cargo.json) et du
[catalogue de fabrique](../../../../tools/aphrody/config/build-factory.json).

Les appels distants passent par `infra_exec` du MCP Aphrody local canonique.
L'endpoint Fleet reste un contexte VPS distinct. Aucun WSL n'a été démarré.

## Ressources et travaux existants

Observation du 2026-10-09 à 05:44 UTC : VPS joignable, Linux x86_64, 12 CPU,
45 GiB de RAM dont 34 GiB disponibles, swap 23 GiB dont 3,9 GiB utilisés.
Le disque racine mesure 290 GiB ; 82 GiB restent disponibles, utilisation 72 %.
La capacité totale annoncée ne représente donc pas l'espace libre.

Le CPU est déjà saturé : seconde mesure `vmstat`, 89 % utilisateur, 11 % système,
0 % inactif et 133 processus exécutables. La charge moyenne sur une minute
atteint 197. Les travaux existants comprennent un check Cargo Android, plusieurs
Ninja Bun, des compilations COSMIC/aPorts et un gate Python du fork Bun.
Les conteneurs COSMIC et aPorts ont des plafonds mémoire de 6 et 8 GiB ; le gate
Python dispose de 2 CPU et 10 GiB. Un autre conteneur noyau utilise jusqu'à
10 CPU. Les sessions tmux et les conteneurs existants ont été préservés.

Le verrou lourd déclaré est libre à cette mesure, mais les compilations
existantes prennent aussi des verrous dans leurs propres contextes Docker.
Un verrou libre ne suffit donc pas à qualifier un nouveau build lourd.
Aucun Cargo supplémentaire, changement de service, remplissage artificiel,
suppression de cache ou déplacement de donnée protégée n'a été exécuté dans ce lot.

À 06:02 UTC, les travaux existants ont porté le disque à 78 % d'utilisation,
66 GiB disponibles ; la RAM disponible reste de 30 GiB. Le CPU reste saturé
(88 % utilisateur, 12 % système, 133 processus exécutables). Toutes les fenêtres
tmux créées par le présent lot ont terminé ; la fenêtre `vps-cargo:idle`
préexistante est conservée.

## Vérifications de fabrique

Sur Windows natif, les sept suites `build-factory*.test.ts` sélectionnées passent :
23 tests réussis, 45 tests Linux ignorés, zéro échec et 240 assertions.
Ce résultat ne qualifie pas les tests procfs, `flock` et annulation Linux.

Le clone Aphrody du relais VPS est à
`cc96c4651a973852d1df132e254550de504af06c`. Dix-sept fichiers propriétaires,
tests et wrapper Cargo ont été comparés par SHA-256 à ceux du checkout Windows :
ils sont identiques. Le préchargement DOM, les exports de chemins et la
configuration Bun ont également été comparés. Le premier essai Linux s'arrête
avant les tests parce que le clone du relais n'a pas de `node_modules`.

Un snapshot privé de 448 KiB reprend les fichiers exacts, leurs configurations
et le préchargement DOM. Seuls les liens de résolution vers `@aphrody/paths`
et le `@happy-dom/global-registrator` 20.14.5 déjà installé sont ajoutés dans
ce snapshot ; le clone partagé et les stores installés ne sont pas modifiés.
La version 20.14.5 correspond au lock du checkout. Les quatre tests Linux de
concurrence passent dans ce contexte, 26 assertions, zéro échec.

Le premier gate Linux complet trouve 66 tests réussis et deux échecs : un index
de gitlink modifié contourne le contrôle et atteint une mise à jour refusée par
Git ; le délai d'un job laisse son propriétaire actif après le reçu terminal.
Un probe ciblé confirme que `/usr/bin/timeout` est uutils coreutils 0.10.0 et
laisse ce descendant actif avec `--signal=KILL`. Seul le PID de ce probe,
identifié comme créé par le présent lot, a été terminé.

Deux corrections sont déléguées au présent lot par l'intégrateur :

- Le contrôle des sources compare explicitement les gitlinks de l'index à HEAD
  avec `--ignore-submodules=none` avant toute mise à jour. Le test vérifie un
  refus contrôlé de code 2, sans modifier le pin de l'index ni le HEAD du
  sous-module, même avec `submodule.ignore=all`.
- Le superviseur Bun possède une session et un groupe de processus distincts.
  Au délai, il signale ce groupe uniquement, attend sa terminaison dans procfs
  puis écrit le reçu. Les tests vérifient le code 124, l'arrêt du heartbeat,
  la libération des verrous, la survie d'un propriétaire indépendant et la
  conservation d'un échec normal de code 19.

Les fichiers corrigés sont transférés uniquement dans le snapshot privé par
l'upload SFTP natif `aphrody infra ssh sftp --put`, puis comparés par SHA-256.
Le dernier gate Linux complet, de 06:00:43 à 06:01:26 UTC, termine avec le reçu
de code 0 : **68 tests réussis, zéro ignoré, zéro échec, 529 assertions**.
Il conserve le préchargement DOM déclaré et la priorité `nice 10`. Une fenêtre
tmux propre et un groupe de processus possédé bornent ce job à 180 secondes.
Les logs et codes de sortie restent dans le home opérationnel privé, hors Git.

Le check TypeScript 7 strict des quatre fichiers corrigés, oxlint, oxfmt et
le contrôle de whitespace passent. Les trois suites concernées sur Windows
passent également : neuf réussites, seize tests Linux ignorés, zéro échec.
Le flag du fork `--no-orphans` ne doit pas être ajouté au lanceur de ces suites :
il se propage aux sous-processus et invalide leurs fixtures d'orphelins et de
daemons intentionnels. L'essai avec ce flag a été diagnostiqué et remplacé par
le lancement standard avec un délai possédé à l'extérieur des fixtures.

## Catalogue et limite du lot

Le binaire Windows installé `aphrody 1.0.0-canary` échoue à `infra validate`
sur douze invariants du worktree concurrent : statut `activation-requested`
non reconnu, routes retirées opposées au service `aphrody-site`, ports de routes
8083 opposés au port santé 80, port Gemma 8798 absent des ports internes,
port site 80 déclaré public et port MCP 8793 absent des ports internes VPS.
Les fichiers de catalogue appartiennent à des travaux concurrents ; aucun
changement n'est appliqué ici. La validation de la source intégrée et du
catalogue final reste une gate de l'intégrateur.

Les gates Rust du checkout Windows restent sérialisées par
`scripts/dev/windows-cargo.ps1`, mutex `Local\AphrodyCargoBuild`, sccache natif
conservé. `aphrody-command` dépend directement du rendu Obscura et des fonctions
MCP par défaut : `--no-default-features` sur le paquet ne retire pas cette
fermeture de dépendances. Les petits propriétaires site, certificats, mémoire,
Infra et app-server peuvent être vérifiés avant les consommateurs larges.

Cette preuve sépare le contrôle des ressources, les tests d'orchestration,
les builds produits et leur activation. Les travaux Bun/COSMIC/Python déjà
actifs conservent leurs propriétaires et leurs reçus ; leurs résultats ne
sont pas attribués au présent lot. Le reçu existant COSMIC musl `j10c` termine
à 05:44 UTC avec le code 101 : le linker ne trouve pas la bibliothèque statique
`xkbcommon`. Le reçu existant Bun musl `j5b` termine à 05:35 UTC avec le code 1
sur une sous-commande Ninja. Ces builds produits ne sont pas relancés ici.
