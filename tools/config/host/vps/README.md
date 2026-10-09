<!-- SPDX-License-Identifier: Apache-2.0 -->
# Hôte vps : configuration versionnée

Fichiers copiés tels quels sur l'hôte (chemins relatifs à `/`). Appliqué le 2026-10-09.

- `etc/systemd/system.conf.d/95-aphrody-limits.conf`, `etc/systemd/user.conf.d/95-aphrody-limits.conf` : limites par défaut des unités (nofile/nproc 1048576, TasksMax infini).
- `etc/security/limits.d/95-aphrody-build.conf` : nofile/nproc 1048576 pour tous les comptes.
- `etc/docker/daemon.json` : live-restore, log local, téléchargements/envois parallèles 10/8, GC BuildKit (`builder.gc`, 40 Go gardés). Rechargé par `systemctl reload docker`.
- `etc/fstab.aphrody-build` : ligne qui remplace l'ancienne entrée `/srv` (volume sdb1) ; le volume est monté sur `/home/ubuntu/build`.

Disposition du volume de build : `~/build/{cache,workspaces,artifacts,locks,transient,archive}` et `~/build/apps/<app>` ; `/srv/<nom>` ne contient plus que des liens symboliques de transition vers ces chemins.

Sysctl : `/etc/sysctl.d/95-aphrody-vps-build.conf` et `90-aphrody-bun.conf` sont déjà optimisés pour la machine (swappiness 100 avec zram, dirty 5/15 %, inotify, max_map_count, file-max) ; aucun changement ici.

Profil tuned : `throughput-performance` (paquet `tuned`, service activé).
