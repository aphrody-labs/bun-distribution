<!-- SPDX-License-Identifier: Apache-2.0 -->

# Moniteur Discord Omar — observation 2026-10-08 22:05 UTC

## Portée et preuve

Déploiement via `yolo ops discord deploy omar-monitor --target vps --apply`,
depuis le worktree Aphrody dédié. Le build local du bundle a réussi. Le probe
du candidat a confirmé la guilde `1554189180030947338`, le salon de réponse
`1557354118710829117`, le Gateway Discord et l’app-server Codex dédié.
Le cache Gateway a exposé 15 salons et fils actifs. La réconciliation initiale
a terminé pour les 15; les 15 marqueurs SQLite (`history_complete` et
`history_complete_<id>`) sont vrais et `all_guild_channels_since` vaut
`1557863988740493344`.

Le workflow Infra a vérifié le SHA-256 après transfert, le protocole du runtime
Yolo épinglé, la file durable sans objectif actif, puis le plan systemd. Le
service a été activé et son contrôle immédiat a réussi.

## État observé

- `aphrody-discord-omar-monitor.service`: `enabled`, `active`, PID `1954130`.
- `ExecMainStatus=0`, `NRestarts=0`, `gatewayConnected=true`, `draining=false`.
- File : 3 `achieved`, 4 `blocked`, 1 `ignored`, 7 `pending`, aucun objectif
  `planning` ou `executing`.
- Bundle `/srv/aphrody-lab/omar-monitor.mjs` : SHA-256
  `cf55c813844afdd216182d840ff64a22a5e2147082f6ed9829f9f0bbb7a72d01`.
- Politique `/srv/aphrody-lab/omar-monitor-policy.json` : SHA-256
  `d737f235fc81d0f757d1a371e24ea05921f42b1680c13a10a1c08547247eae81`.
- `/srv` disposait de 4,9 Gio libres à l’observation.

## Livraison

La route SFTP native d’Infra ne pouvait pas joindre `10.200.77.1:22` depuis
la session locale. Le workflow utilise donc les commandes SSH `aphrody infra`
pour transférer des blocs gzip bornés, puis vérifie le SHA-256 des fichiers
reconstruits avant installation. Le répertoire temporaire est traversable
par le compte de service; les fichiers d’état, l’authentification et la file
SQLite restent dans leurs emplacements protégés.

Le plan systemd doit être validé en root, car `systemd-analyze verify` contrôle
le binaire Yolo sous `/home/ubuntu`, inaccessible au compte SSH `omar`. Le
workflow exécute cette validation avec `sudo -n`; l’activation vérifiée utilise
le même service déclaré.

Cette observation ne prouve pas que les 7 objectifs `pending` sont terminés.
La release et l’unification VNC/computer-use restent des chantiers distincts.

## Recontrôle — 2026-10-09

Le service `aphrody-discord-omar-monitor.service` répond `active/running`,
PID `2026120`, `ExecMainStatus=0`, `NRestarts=0`. Le contrôle `--ready-check
--expect-pid 2026120` a confirmé que le reçu appartient au processus vivant.
Reçu observé le 2026-10-08 à 22:15:33 UTC : Gateway connecté, non drainé,
15 salons en cache, historique complet dans SQLite (15 marqueurs) et curseur
initial `1557863988740493344`.

Empreintes installées relues sur VPS :

- Bundle : `1edbd1b4087ff50932631004610af427d9cf47dd8016af4f6d773ba004aa1d67`.
- Politique : `d737f235fc81d0f757d1a371e24ea05921f42b1680c13a10a1c08547247eae81`.

La file compte 3 `achieved`, 10 `blocked` et 2 `ignored`; aucun objectif
n’est actuellement en attente ou en cours. Cinq objectifs bloqués ont un
thread exécuteur, un est affecté à `local` avec thread, et cinq sont affectés à
`owner-wsl` sans thread exécuteur. Depuis le VPS, SSH vers `10.200.77.2:22`
expire après cinq secondes. Le poste de travail de cette session n’a pas
d’interface WireGuard active ni de commande `wg`; cette session ne peut donc
pas rétablir ce lien. Les cinq objectifs concernés restent ouverts et le
moniteur reste actif.
