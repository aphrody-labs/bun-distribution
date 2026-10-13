<!-- SPDX-License-Identifier: Apache-2.0 -->

# VPS : inventaire Bun et nettoyage contrôlé

Le propriétaire a demandé le 2026-10-11 de suspendre fusion et release, puis
d'inventorier les checkouts Git, les dossiers de `/home/ubuntu` et les processus
du VPS avant de retirer ce qui n'est plus utile au fork Bun courant ou à Aphrody.
Cette demande ne reprend pas les compilations et publications suspendues.

## Script unique

[vps-bun-cleanup.ts](../../../scripts/tools/infra/vps-bun-cleanup.ts) s'exécute
sur le VPS, via le transport Infra existant. Il ne dépend d'aucun package ajouté.

```sh
sudo -n /home/ubuntu/.bun/bin/bun /home/ubuntu/vps-bun-cleanup.ts
```

L'inventaire exporte les marqueurs Git et les dossiers en fichiers NUL,
les états Git, HEAD, branches, remotes expurgés, refs et worktrees, les processus
(PID, nom, exécutable, cwd), les services actifs, les conteneurs, les sessions tmux
et les tailles du disque principal. Les arguments et variables d'environnement
des processus sont inspectés pour l'isolation mais ne sont jamais exportés.
Les rapports restent dans le magasin local Infra ; ils ne sont pas publiés.

Le scan couvre une fois le disque principal et le volume `build`. Les bind mounts
`src` et `apps` réutilisent respectivement `build/workspaces` et `build/apps`.
Les alias Git de `src` font aussi l'objet d'un relevé séparé. Les destinations
externes des liens symboliques ne sont pas suivies. Les scans ont une limite de
dix minutes et leur code de sortie est conservé. Dans les checkouts, les dossiers
source proviennent des index Git (`indexed-directories.nul`) ; ils ne constituent
pas une preuve de présence physique de chaque chemin en sparse checkout.
Les sous-modules enregistrés sont inspectés. Les clones imbriqués non enregistrés
et les descendants des assets, toolchains, caches et sorties générées conservés
ne sont pas parcourus. Ces arbres sont des ensembles protégés, pas des candidats
à supprimer. `--summary` borne la profondeur à sept niveaux.

## État observé, 2026-10-11

- Disque principal : 290 Gio, 52 Gio libres, 83 % utilisés.
- Volume monté sur `/home/ubuntu/build` : 300 Gio, 324 Mio libres, 100 % utilisés.
- `/home/ubuntu` hors montages : 140 220 833 792 octets alloués.
- `builds` : 78 645 047 296 octets, dont fusion Bun 34 024 407 040,
  snapshot release 23 577 210 880, factory 18 982 346 752,
  transport des changements 2 005 417 984 et checkout Obscura 55 660 544.
- Premier inventaire : 41 dossiers directs et 220 processus observés ;
  les scans récursifs ont atteint leur limite initiale de trois minutes.
  Ce passage incomplet ne prouve pas l'absence de dépôts Git.
- Inventaire indexé terminé : 60 chemins avec marqueur Git, 53 identités
  distinctes après déduplication des alias, 145 826 dossiers parcourus et
  216 processus observés sans erreur d'inspection de `/proc`.
- 29 états Git présentent des modifications ; 11 états restent inconnus
  (8 timeouts et 3 marqueurs non inspectables). Les autres états ne présentent
  pas de changement déclaré. Les identités Git non inspectables ne sont pas
  qualifiées comme des checkouts valides.
- La fusion Bun (`obscura`, HEAD `34586e55f42e`) a 554 entrées de statut ;
  `src/bun` (`main`, HEAD `c6654dfe852e`) en a 123. Le snapshot de release a
  aussi une modification. Aucun de ces arbres n'est une copie jetable qualifiée.
- Conteneurs actifs : cache Redis de release Bun, client Steam IECODE,
  build Aphrody et control plane Kubernetes Aphrody.
- Les services site, downloads, fonts, mesh, remote, Mullvad et l'infrastructure
  système sont actifs. La présence de Steam et de Kubernetes ne suffit pas à
  autoriser leur arrêt ni la destruction de leurs données.

Rafraîchissement lecture seule à 09:05 UTC : `lsblk`, `findmnt` et `df -B1`
confirment deux disques de données, `sda` et `sdb`, plus `zram0`. `sda1` monté
sur `/` dispose de 54 927 548 416 octets libres (83 % utilisés) ; ses partitions
`/boot` et `/boot/efi` sont peu utilisées. `sdb1` fournit le volume `data` de
300 Gio, avec 347 004 928 octets disponibles et 100 % d'utilisation. Les points
`/home/ubuntu/apps` et `/home/ubuntu/src` sont des alias bind de sous-répertoires
de ce même `sdb1`, pas deux copies de disque. `/home/ubuntu/builds` contient
cinq répertoires de travail Bun ; plusieurs sessions `tmux` de fusion, release
et previews y sont actives. Ils restent conservés. La purge Docker planifiée
libérerait surtout de la place sur `sda1` et ne résoudrait pas le volume plein.

Les mesures sont datées et les montages ne doivent pas être additionnés comme
s'ils étaient des copies indépendantes. Aucun gain de capacité n'est revendiqué.

## Capacity recheck — 2026-10-13

A fresh read-only inventory through `aphrody infra ssh exec` ran `lsblk
--json --bytes --fs`, `findmnt` and `df -B1`. `/dev/sdb1` is the shared 299.2 GiB
data filesystem mounted at `/home/ubuntu/build`, `/home/ubuntu/src` and
`/home/ubuntu/apps`; it had 243,466,653,696 bytes used and 77,720,858,624 bytes
available (76%). The root filesystem `/dev/sda1` had 96,336,699,392 bytes
available (69% used). `/boot` and `/boot/efi` remain separate system
partitions.

The current build volume therefore already exceeds the requested 50 GB free
capacity. This SSH session did not reclaim that space. The 2026-10-11 report
recorded only 347,004,928 bytes free on the same data volume; the change is
unattributed and must not be reported as this session's cleanup.

A low-priority top-level `du` of `/home/ubuntu/build` stopped at its 18-second
bound (exit 124) and could not read two private package-job temporary
directories. This is an incomplete size/process inventory; no deletion or
service action was taken, and it does not qualify any path for cleanup.

## Suppression

Le script produit un `plan.json` vide : il ne supprime jamais le complément
d'une liste de conservation. Un plan doit nommer chaque sortie de build retirée,
sa raison et un reçu réussi contenant `finishedAt`, `exitCode: 0` et
`outputPath` correspondant exactement à cette sortie.

```sh
sudo -n /home/ubuntu/.bun/bin/bun /home/ubuntu/vps-bun-cleanup.ts \
  --apply /home/ubuntu/.local/share/aphrody/infra/bun-cleanup-EXEMPLE/plan.json \
  --sha256 SHA256_DU_FICHIER_PLAN
```

L'application exige un inventaire intact, récent et sans erreur d'inspection,
prend le verrou de factory déclaré, refuse les chemins non
canoniques, les entrées qui se chevauchent, les montages et bind mounts de
conteneurs actifs, les sources et payloads protégés, puis vérifie de nouveau
l'activité des processus avant chaque suppression. Les erreurs d'inspection
provoquent un refus. Aucun service, conteneur ou processus n'est arrêté par
l'application. Les seuls processus terminés pendant l'audit étaient nos propres
passages d'inventaire remplacés, après vérification de leurs PID et commandes.

Les sources, changements non commités, données, credentials, conversations,
modèles, archives, releases et caches partagés restent protégés. Le propriétaire
a délégué le classement des autres éléments : appliquer la
[politique de stockage VPS](VPS-STORAGE-POLICY.md) et conserver tout élément
actif, unique ou non inspectable. Le catalogue historique `disk-reclaim.json` ne
doit pas être appliqué globalement : certaines entrées purgeraient des caches
nécessaires à la factory actuelle.

## Qualification

TypeScript scoped, oxlint et oxfmt passent pour le script. Le bundling Bun passe.
Le premier passage natif en simulation a terminé avec zéro suppression et a
signalé explicitement les scans incomplets. Les rapports et journaux de reprise
restent sous `/home/ubuntu/.local/share/aphrody/infra/bun-cleanup-20261011*`.
Les résultats de l'inventaire récursif final doivent être consultés avant toute
classification destructive. Aucune compilation d'engine n'est nécessaire.

Rapport final d'analyse :
`/home/ubuntu/.local/share/aphrody/infra/bun-cleanup-20261011-index/inventory.json`.
Le scan signale trois erreurs d'index Git et les états inconnus ci-dessus ;
l'application est donc bloquée. Il ne faut pas transformer un timeout en
preuve d'un checkout propre. Zéro fichier supprimé, zéro service arrêté.

Le contrôle natif d'empreinte du plan refuse une valeur incorrecte avec code 1,
avant toute suppression. Le script refuse aussi les hôtes autres que
`vps-203bea89`. Les états Git désactivent hooks et fsmonitor pour l'inspection
privilégiée ; ils ne lancent aucun fetch ni publication.
