<!-- SPDX-License-Identifier: Apache-2.0 -->
# Audit des doublons Files, VFS et recherche

État : **INCOMPLET**, relevé le 2026-09-28 dans les checkouts de
`/home/aphro/src`; complété le 2026-10-02 pour le transfert IECODE. Les lignes
qui citent les anciens dépôts sont des observations historiques et ne décrivent
pas leur état actuel. Cet audit inventorie les chevauchements de source et les
consommateurs repérés ; il ne prouve ni parité installée ni absence de toute
utilisation dynamique. Le [plan racine](../PLAN.md) fixe les conditions de
migration et de suppression.

## Copies et implémentations concurrentes

| Priorité | Constat vérifié | Propriétaire et sortie |
| --- | --- | --- |
| P0 | Le cœur Drive OS (historical path: `../aphrody-os/drive/core/`) et le cœur retenu dans UI (historical path: `../aphrody-ui/drive/core/`) contiennent chacun 953 fichiers suivis, avec zéro différence signalée par `diff -qr` au relevé. Les autres crates importées sont aussi communes, sauf les cinq écarts connus de `crates/images`. Le [préparation du démon](../packages/infra/workspace/src/drive-daemon.ts) préfère OS puis utilise la copie UI si OS manque. | OS possède le moteur et le démon. Garder le repli UI jusqu'à preuve du build autonome, de la migration des données, des consommateurs et de la parité installée ; supprimer ensuite le moteur retenu, pas les notices FSL ni la provenance. |
| P0 | Web (historical path: `../aphrody-web/drive-server/`) contient une copie adaptée de `sd-server` issue de UI (historical path: `../aphrody-ui/drive/apps/server/`). Elle dépend déjà du cœur OS et du bundle web UI ; le site (historical path: `../aphrody-web/docs/WEB-RUNTIME.md#passerelle-drive-optionnelle`) n'expose qu'une passerelle optionnelle, sans équivalence complète `/rpc`, `/events`, `/sidecar/*` et SPA. | Web possède le serveur public et la transition `sd-server`. Comparer routes, sessions, SSE, sidecars et déploiement avant de retirer la copie historique. |
| P1 | L'Explorer actif (historical path: `../aphrody-ui/packages/app-ui/src/routes/explorer/`) compte 69 fichiers suivis ; l'Explorer amont retenu (historical path: `../aphrody-ui/drive/packages/interface/src/routes/explorer/`) en compte 66. `diff -qr` signale 14 fichiers communs modifiés et 3 fichiers seulement actifs, donc 52 fichiers communs identiques. Le package UI exclut explicitement l'interface amont des workspaces ; l'Explorer actif interroge `search.files` via `@aphrody/drive-client`. | UI possède la présentation et conserve l'amont comme source de comparaison jusqu'à clôture de la matrice de parité (historical path: `../aphrody-ui/docs/DRIVE-UPSTREAM-DIFF.md`). Ne pas confondre cette archive avec m3-explorer (historical path: `../aphrody-ui/packages/m3-explorer/`), bibliothèque de composants utilisée par l'application. |
| P1 | [Infra](../crates/infra/infra/src/drive.rs) expose un autre `VirtualDriveEngine`, des `DriveFileNode` et des montages local, SFTP, Git et OpenDAL. La [CLI](../crates/infra/infra/src/main.rs) et deux routes de l'[API Infra](../crates/infra/infra/src/api.rs) l'utilisent. L'Explorer UI, lui, passe par le démon Drive. Il s'agit d'une seconde autorité fonctionnelle VFS, sans copie de source. | OS et Contracts doivent posséder objets Files, adresses, droits et opérations. Infra garde destinations, configuration et adaptateurs d'administration ; migrer la CLI et les routes existantes avant de retirer son moteur. |
| P1 | Deux wrappers de `Everything64.dll` existent dans fsindex (historical path: `../aphrody-os/crates/aphrody-fsindex/src/everything.rs`) et search (historical path: `../aphrody-os/crates/aphrody-search/src/everything.rs`), avec leurs propres types, chargement DLL et requêtes. `fsindex` sert l'index CLI AI (historical path: `../aphrody-ai/crates/aphrody/src/index_cmd.rs`) et le repli WinClean (historical path: `../aphrody-os/crates/aphrody-winclean/src/filesystem.rs`). Aucun consommateur externe de `aphrody-search` n'a été trouvé par la recherche statique des sources ; sa BM25 en mémoire vise d'autres corpus. | OS : retenir un fournisseur Windows de fichiers derrière l'API canonique, probablement celui de `fsindex` déjà intégré. Vérifier exports et usages dynamiques avant de retirer l'autre wrapper ; juger la BM25 séparément. |
| P1 | Drive (historical path: `../aphrody-os/drive/core/src/ops/search/query.rs`) sert `search.files` sur bibliothèques, identités et métadonnées ; fsindex (historical path: `../aphrody-os/crates/aphrody-fsindex/src/lib.rs`) garde une seconde base SQLite FTS5 de chemins locaux. L'Explorer (historical path: `../aphrody-ui/packages/app-ui/src/routes/explorer/hooks/useExplorerFiles.ts`) consomme la première, la CLI `aphrody index` et WinClean la seconde. Deux indexations du même répertoire sont donc possibles, mais les schémas et portées diffèrent. | OS et Contracts : définir une recherche Files unique côté produit, avec résultat, permissions, pagination et origine explicites. Qualifier si `fsindex` reste un adaptateur local hors bibliothèque ou alimente Drive ; éviter deux scans persistants des mêmes racines sans besoin démontré. |
| P2 | Deux outils AI exposent le nom `read_file` : agent-tools (historical path: `../aphrody-ai/crates/aphrody-agent-tools/src/read_file.rs`) lit au plus 512 KiB et accepte `cwd`, tandis que tools (historical path: `../aphrody-ai/crates/aphrody-tools/src/builtin/read_file.rs`) accepte les lignes et une limite par défaut de 1 MiB. Le runtime agent (historical path: `../aphrody-ai/crates/aphrody-agent-runtime/src/tools.rs`) enregistre le premier ; le second appartient à un autre registre. | AI : choisir un contrat de lecture et un adaptateur par registre, avec limites et permissions préservées. Ce sont des outils d'agent, pas un troisième Explorer. |

## Surfaces proches qui ne sont pas des doublons du produit

- Le SDK VDFS Drive (historical path: `../aphrody-os/drive/crates/sdk/src/vdfs.rs`) est une façade
  d'extension dont les appels hôte paniquent encore : il ne constitue pas un
  second moteur opérationnel. Ne pas compter ses stubs comme parité VFS.
- Le RAG AI (historical path: `../aphrody-ai/crates/aphrody-rag/src/search.rs`) recherche des
  fragments de contenu par lexical, vecteur et reclassement ;
  search_text (historical path: `../aphrody-ai/crates/aphrody-agent-tools/src/search_text.rs`)
  appelle `rg` dans un espace de travail. Leurs corpus et permissions sont
  distincts de `search.files`.
- Yazi dans Shell (historical path: `../aphrody-shell/docs/YAZI.md`) est un gestionnaire de
  fichiers terminal externe optionnel, non embarqué comme second Explorer.
  Les recherches RG, Shenron et BXC portent sur leurs domaines respectifs.
- Le VFS Python IEVR est détenu par IECODE dans
  [`src/niepy`](../../iecode/src/niepy/). Les règles et le plan IECODE
  confirment ce propriétaire unique ([AGENTS.md](../../iecode/AGENTS.md),
  [PLAN.md](../../iecode/PLAN.md)); le [manifeste de transfert](../../iecode/docs/migrations/ievr-to-iecode-2026-10-01.json)
  conserve la provenance. Au contrôle du 2026-10-02, l'ancien chemin de copie
  Ren'Py `src/iepy/inazuma-love/game/libs/nie/python-packages/niepy/` n'existait
  plus dans le checkout IECODE. L'ancien décompte de copies est donc historique;
  cette vérification de chemins n'exclut pas d'autres consommateurs dynamiques.

## Ordre de résolution

1. Figer les révisions et la matrice de fonctions amont ; marquer chaque
   copie comme active, archive de comparaison ou repli de build.
2. Publier le contrat Files dans Contracts, avec adresses, résultats de
   recherche, capacités, erreurs et politique d'accès ; migrer OS, Web, AI,
   UI et les commandes Infra consommatrices.
3. Comparer données, index, recherche, montages et parcours UI sur les mêmes
   corpus avant toute suppression. Inclure Windows Everything et les cas
   hors ligne, cloud et synchronisation.
4. Retirer uniquement les copies devenues sans consommateurs et préserver
   licences, attributions et archive nécessaire à la preuve de parité.

La recherche statique et `diff -qr` ci-dessus sont des constats de source.
Aucun test d'exécution ni migration de données n'a été lancé dans cet audit.
