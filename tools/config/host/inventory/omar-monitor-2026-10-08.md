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

## Recontrôle — 2026-10-08 22:18 UTC

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
expire après cinq secondes. Son pair WireGuard n’a plus de handshake depuis
environ 8 h 25; le port 22 de `10.200.77.4` répond, mais ce PC est un autre pair
et ne remplace pas le worker WSL. Le poste de travail de cette session n’a pas
d’interface WireGuard active ni de commande `wg`; cette session ne peut donc
pas rétablir ce lien. Les cinq objectifs concernés restent ouverts et le
moniteur reste actif.

## Repli worker installé — 2026-10-08 22:30 UTC

Le workflow `yolo ops discord deploy omar-monitor --target vps --apply` a
construit, transféré, hashé, sondé et activé le bundle
`63ab825e57de336d716828f7ab78aeda7935ba6ccbe84995567bdcfb6436e05b`.
La politique n’a pas changé (`d737f235fc81d0f757d1a371e24ea05921f42b1680c13a10a1c08547247eae81`).
Le service est `active/running`, PID `2138001`, `NRestarts=0`,
`ExecMainStatus=0`. Le contrôle readiness a confirmé le PID.

Au démarrage, la nouvelle version a remis en file les 2 pings auparavant
`ignored` et les 5 objectifs `owner-wsl` qui n’avaient aucun thread. Elle
attribue un objectif de traitement à toute mention valide, même quand le
planificateur n’extrait pas de demande détaillée. Si le worker distant ne peut
pas s’initialiser, un thread Codex séparé démarre sur le VPS avec l’instruction
de ne pas prétendre avoir modifié l’autre hôte ni d’y déplacer son travail.

Reçu du 2026-10-08 à 22:30:03 UTC : Gateway connecté, 15 salons, 15 threads
moniteur; 3 `achieved`, 9 `blocked`, 1 `executing`, 2 `pending`; 13/15
objectifs ont un thread exécuteur. Le worker actif traite un objectif, les deux
autres attendent leur tour. Les objectifs `blocked` restent ouverts; la tâche
reste en cours jusqu’à ce que les 15 pings aient un worker et que les
dépendances réelles soient qualifiées.

## Vérification de la file — 2026-10-08 22:35:34 UTC

Le service est toujours `active/running`, PID `2138001`, `NRestarts=0`,
`ExecMainStatus=0`; le contrôle `--ready-check --expect-pid 2138001` répond
`ready=true`. Les SHA-256 relus sont toujours bundle
`63ab825e57de336d716828f7ab78aeda7935ba6ccbe84995567bdcfb6436e05b` et
politique `d737f235fc81d0f757d1a371e24ea05921f42b1680c13a10a1c08547247eae81`.
Le reçu confirme Gateway connecté, historique complet, 15 salons et curseur
`1557863988740493344`. Les 15 jobs ont chacun un thread moniteur et un thread
exécuteur : 4 `achieved`, 10 `blocked`, 1 `executing`, aucun worker en attente.
Les blocages restent ouverts; cette preuve porte sur le lancement des agents,
pas sur l’achèvement de chaque demande.
