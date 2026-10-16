<!-- SPDX-License-Identifier: Apache-2.0 -->

# Politique de stockage des VPS

Cette politique fixe la cible de nettoyage : **un clone Git canonique par
projet et une factory de build déclarée par hôte**. Elle couvre les disques et
partitions montés des VPS sélectionnés dans le catalogue Infra. Elle n'autorise
ni le formatage d'un disque, ni l'effacement d'un volume entier, ni une purge
par complément de liste.

## Inventaire obligatoire

Avant toute suppression, enregistrer pour chaque hôte et chaque système de
fichiers local :

- `lsblk --json --bytes --fs` : disques, partitions, UUID, type, taille et
  points de montage ;
- `findmnt --json --output TARGET,SOURCE,FSTYPE,OPTIONS` et
  `df -B1 --output=source,fstype,size,used,avail,pcent,target` ;
- les dossiers les plus volumineux par point de montage, sans suivre les liens
  symboliques ni traverser un autre système de fichiers ;
- les marqueurs Git, chemins canoniques, identité de clone, HEAD, branche,
  remotes expurgés, références locales et distantes disponibles, worktrees,
  sous-modules, modifications suivies et fichiers non suivis ;
- les processus, cwd, descripteurs ouverts, sessions `tmux`, unités actives,
  conteneurs et bind mounts qui référencent chaque candidat.

Inclure `/` et tous les points de montage locaux, y compris les partitions de
build et les volumes séparés. Ne pas parcourir `/proc`, `/sys`, `/dev` ou les
montages éphémères comme des disques de données. Les systèmes réseau et les
hôtes DBFR restent distingués des disques locaux : appliquer leur propre
autorité et leurs propres runbooks. Un montage, une partition ou un clone dont
l'inspection échoue est « inconnu » et reste conservé.

## Clone Git canonique

1. Maintenir un chemin canonique unique par dépôt dans la configuration Infra.
   Le répertoire d'exécution de la factory, les sources externes et les autres
   projets ont chacun un propriétaire explicite. Ne pas inférer qu'un alias de
   bind mount est un deuxième clone.
2. Comparer l'identité Git réelle, les branches et tags locaux, les commits non
   publiés, les upstreams, les worktrees et l'état complet du checkout. HEAD
   égal, branche égale ou dépôt propre à première vue ne suffisent pas à
   établir qu'une copie est redondante.
3. Transférer vers le clone canonique chaque commit, référence, patch suivi et
   fichier non suivi unique. Vérifier les hashes et vérifier que le clone
   canonique peut reconstruire les changements. Conserver provenance et
   licences.
4. Vérifier qu'aucun processus, terminal, service, conteneur, verrou, job ou
   utilisateur n'utilise le checkout. Supprimer ensuite uniquement ce chemin
   redondant explicitement nommé par un plan Infra, puis vérifier les références
   et l'état du clone canonique.

Ne pas utiliser `git reset --hard`, `git clean`, `rm -rf` sur les clones, ni
supprimer des worktrees actifs pour satisfaire le compte de clones. Si des
changements uniques sont encore en cours, reporter le retrait de cette copie.

## Une factory de build par hôte

`tools/config/build-factory.json` déclare la factory, son répertoire de travail,
le cache, les artefacts et le verrou. Une seule factory est active par hôte ;
tous les builds passent par son CLI/transport, ses limites de ressources et son
verrou global. Les workers ou images spécialisés sont des jobs de cette factory,
pas une seconde factory indépendante. Il ne doit pas exister de build simultané
qui contourne le verrou.

Après inventaire, inscrire les sorties terminales à retirer dans la liste
allowlist du propriétaire Infra, avec reçu réussi et chemin exact. Attendre la
fin du job et confirmer processus, verrous, mounts et bind mounts immédiatement
avant le retrait. Garder la factory canonique, les toolchains déclarés, les
artefacts actifs et de rollback, ainsi que les caches partagés retenus par la
configuration. Une cible de build est régénérable seulement si sa source, ses
dépendances et le reçu de réussite existent encore.

## Plan et application

- Employer les opérations Workspace/Infra existantes. Le plan est en lecture
  seule par défaut et nomme chaque chemin, sa classe, sa raison, son système de
  fichiers, sa taille et ses preuves.
- Appliquer un lot seulement si l'inventaire est complet et récent, l'empreinte
  du plan correspond, les candidats sont des chemins canoniques, non montés,
  non utilisés et sans données protégées. Refaire les contrôles d'activité juste
  avant chaque retrait.
- Préserver les sources non fusionnées, données privées, bases, modèles, assets,
  identifiants, conversations, releases, archives de rollback, caches partagés,
  licences, journaux nécessaires et fichiers d'autres utilisateurs.
- Maintenir un reçu privé hors Git contenant le plan, les checksums, le résultat
  de chaque retrait et les mesures `df` avant/après pour chaque système de
  fichiers. Ne jamais inclure de contenu protégé dans le reçu ou Git.
- Ne jamais exécuter `mkfs`, `wipefs`, `sgdisk`, `dd` vers un périphérique,
  `blkdiscard`, le formatage LUKS, `docker volume prune` ou une suppression de
  `/`, `/home`, `/var/lib`, d'une racine de partition ou d'un point de montage.

## Limite de l'outil actuel

`scripts/tools/infra/vps-bun-cleanup.ts` inventorie le home Ubuntu et le volume
`/home/ubuntu/build`, mais ne constitue pas encore l'inventaire de toutes les
partitions, de tous les dépôts ou de tout le stockage du VPS. Son rapport ou son
plan vide ne prouve donc pas que les autres systèmes de fichiers sont propres.
Ne pas l'utiliser pour autoriser un nettoyage global avant que sa couverture
corresponde à cette politique. Le reclaim générique n'est pas un substitut : il
peut purger des caches partagés et ne libère pas nécessairement le volume plein.

Toute extension du script doit d'abord prouver la découverte des montages,
l'exhaustivité des états Git et le refus sûr sur erreur. Un plan incomplet,
expiré, ou ambigu n'autorise aucune suppression.
