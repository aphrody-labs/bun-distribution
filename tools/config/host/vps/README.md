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

Disposition unique (`layout.json`, appliquée le 2026-10-09) : `~/src` et `~/apps` sont des montages bind (fstab) sur le volume, `~/archive` et les dossiers de build de `/` (`fork-target`, `xmsvc`, `llama-build`, `tools-build`, `~/.cargo/{registry,git}`) pointent vers `~/build`, `/srv` est supprimé, `/home/omar/src` pointe vers `/home/ubuntu/src`, le runner `aphrody-shenron-build-runner` tourne sous `ubuntu` depuis `~/build/runners/shenron` (le compte `shenron-build` reste sans service).

Reste à faire : `~/yolo/w` (28 Go, workspaces des builds yolo en cours) à déplacer vers `~/build` une fois le build arrêté ; les volumes Docker non utilisés (19,9 Go) ne sont pas supprimés sans copie vérifiée.

Tuned : non retenu (le profil `throughput-performance` force `vm.swappiness=10` et `dirty 40/10`, contraire à la config zram) ; paquet purgé.

Mullvad Web/Shenron crawl (scopé, appliqué 2026-10-11) : `aphrody-mullvad-netns.service` crée/réutilise `mullvad` et un veth privé 10.200.1.0/30; `aphrody-mullvad-socks.service` expose `microsocks` uniquement sur 10.200.1.2:1080 dans ce namespace. La table nft `aphrody_mullvad` refuse les clients du port SOCKS qui ne viennent pas du pair local 10.200.1.1. `aphrody-mullvad-loopback.socket` et son service ne publient le proxy que sur 127.0.0.1:1080; c'est la seule cible ajoutée à `PermitOpen` pour le forward SSH. `/etc/tmpfiles.d/aphrody-mullvad.conf` prépare le point d'attache des namespaces à chaque boot. La route par défaut de l'hôte et wg1 restent hors namespace. Le fichier root-only `/etc/wireguard/mullvad.key` est utilisé directement par `wg set private-key` et n'est ni copié ni journalisé. `aphrody-mullvad-switch jp` n'accepte que Tokyo/Japon; en panne d'API il conserve seulement un cache japonais validé, sans fallback US. Les crawls locaux utilisent le proxy Aphrody Web natif avec `--proxy socks5h://127.0.0.1:1080`. Le SOCKS n'écoute jamais sur une adresse publique.
