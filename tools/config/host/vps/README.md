<!-- SPDX-License-Identifier: Apache-2.0 -->
# Hôte vps : configuration versionnée

Fichiers copiés tels quels sur l'hôte (chemins relatifs à `/`). Appliqué le 2026-10-09.

`runtime.json` (comme `../dbfr/runtime.json`) liste ce qui tourne dans Docker et ce que l'hôte garde en natif, avec la raison ; son bloc `purge` est appliqué par `sudo bun scripts/tools/infra/host-purge.ts --host vps --apply` (sauvegardes vérifiées dans `~/build/archive/vps/host-purge-<date>/`).

- `etc/systemd/system.conf.d/95-aphrody-limits.conf`, `etc/systemd/user.conf.d/95-aphrody-limits.conf` : limites par défaut des unités (nofile/nproc 1048576, TasksMax infini).
- `etc/security/limits.d/95-aphrody-build.conf` : nofile/nproc 1048576 pour tous les comptes.
- `etc/docker/daemon.json` : live-restore, log local, téléchargements/envois parallèles 10/8, GC BuildKit (`builder.gc`, 40 Go gardés). Rechargé par `systemctl reload docker`.
- `etc/fstab.aphrody-build` : lignes qui remplacent l'ancienne entrée `/srv` (volume sdb1) ; le volume est monté sur `/home/ubuntu/build`, et ses sous-dossiers `workspaces` et `apps` sont montés en bind sur `~/src` et `~/apps`.

Disposition du volume de build : `~/build/{cache,artifacts,locks,transient}`, `~/build/workspaces` (vu comme `~/src/<dépôt>`) et `~/build/apps/<app>` (vu comme `~/apps/<app>`, noms de la disposition commune : `cdn`, `lab`, `downloads`…). `~/archive` reste sur le disque racine. Plus de `/srv`.

Sysctl : `/etc/sysctl.d/95-aphrody-vps-build.conf` et `90-aphrody-bun.conf` sont déjà optimisés pour la machine (swappiness 100 avec zram, dirty 5/15 %, inotify, max_map_count, file-max) ; aucun changement ici.

Profil tuned : `throughput-performance` (paquet `tuned`, service activé).

Comptes : `omar` rejoint le groupe `aphrody` ; `/home/ubuntu` passe en `0750` groupe `aphrody` (propriétaire inchangé).

Non appliqué (à traiter ensuite) : fusion des checkouts `/home/omar/src`, des `~/apps` (les données restent dans `~/build/apps`, pas de copie faute de place sur `/`), `shenron-build` gardé tel quel (le runner est enregistré sous ce compte ; ses données ne sont pas déplacées), dédoublonnage des données live (écritures en place).

Tuned : non retenu (le profil `throughput-performance` force `vm.swappiness=10` et `dirty 40/10`, contraire à la config zram) ; paquet purgé.
