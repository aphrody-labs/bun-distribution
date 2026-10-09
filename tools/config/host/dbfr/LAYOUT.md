# Disposition unique des hôtes Aphrody (vps, dbfr) : décision du 2026-10-09

Consigne du propriétaire : tout fusionner dans UN SEUL home par hôte. Plus de /srv. Docker en direct. Plus de checkouts en double, de builds multiples ni de services multiples. Tout est centralisé, unifié et dédupliqué agressivement. **dbfr doit descendre à 50 % d'usage disque maximum** (/ fait 96G, donc ≤ 48G utilisés ; aujourd'hui 79G).

## Home unique : `/home/ubuntu` sur chaque hôte

| Chemin | Contenu | Remplace |
| --- | --- | --- |
| `~/src/<repo>` | UNE seule copie git par dépôt : `aphrody`, `bun`, `shenron`, `forks/<nom>` | release/aphrody, aphrody-root, bun-src, yolo/src/*, shenron-docker, shenron-release, /srv/aphrody-build/workspaces/*, /srv/aphrody/shared/agent-workspaces/*, /home/omar/src/* |
| `~/apps/<app>/` | runtime d'un service : `compose.yaml`, `.env`, `data/` (bind mounts), `releases/` (la courante seulement, aucun lien `previous`, aucune copie `.bak`/`.prev`/`.pre-layout`) | /srv/aphrody*, /srv/shenron*, /srv/app, /etc/aphrody/container, /opt/aphrody-discord-sync |
| `~/apps/compose.yaml` | UN seul projet compose par hôte (nom `aphrody`) qui fait `include:` de chaque `~/apps/<app>/compose.yaml` | les projets `aphrody`, `aphrody-bun`, `shenron` (2 fichiers de release) |
| `~/build/` | espace de build, caches et artefacts (vps seulement) | /srv/aphrody-build |
| `~/archive/` | données froides (vps seulement, dont les archives venues de dbfr) | /srv/archive, sauvegardes froides de dbfr |
| `~/.aphrody/` | état Aphrody (APHRODY_HOME), inchangé | — |

## Règles

- **Docker en direct** :
  - les conteneurs démarrent par Docker (`restart: unless-stopped`) depuis `~/apps/compose.yaml` ;
  - les unités systemd qui ne font qu'envelopper un `docker compose up` (shenron-*-docker.service, aphrody-container.service, etc.) sont supprimées après la bascule ;
  - les vrais démons hors conteneur restent des unités systemd, mais pointent vers `~/apps` ou `~/src`.
- **Dédoublonnage des services** : une fonction = un service. Exemples :
  - sonde Bun : `aphrody-bun-probe.service` + le conteneur `aphrody-bun-prod` + la sonde kind ⇒ en garder une seule sur dbfr, plus la sonde k8s ;
  - `aphrody-omar-bun-probe` sur le vps ;
  - deux fichiers compose shenron ;
  - releases multiples.
- **Checkouts** : avant de supprimer une copie en double, vérifier `git status --porcelain` et `git log --branches --not --remotes`. Le travail unique est poussé sur une branche du dépôt aphrody-labs correspondant (`rescue/<hôte>-<chemin>`), et les modifications non commitées sont sauvées en patch dans `~/archive/rescue/`. Ensuite seulement, suppression.
- **Omar** :
  - son compte et son accès SSH (authorized_keys) sont conservés ;
  - il rejoint le groupe `aphrody`, qui a lecture/écriture sur `~ubuntu/src` et `~ubuntu/apps` (setgid + ACL par défaut). `/home/ubuntu` est en 0750 avec le groupe aphrody ;
  - ses copies de projets (`/home/omar/src/*`) sont fusionnées dans `~ubuntu/src` (travail unique sauvé comme ci-dessus), avec un lien symbolique `/home/omar/src -> /home/ubuntu/src` ;
  - ses fichiers personnels hors projets restent en place, mais les doublons exacts avec `~ubuntu` sont dédupliqués en hardlinks (`jdupes -L` ou `rdfind -makehardlinks true`).
- **Transition sans casse** : après chaque déplacement `/srv/X → ~/…`, laisser un lien symbolique `/srv/X -> nouvelle cible` tant que le code n'est pas basculé. Un agent code (C:\aphrody) remplace toutes les références codées en dur et retirera ces liens à la fin. Quand ton hôte est migré, écris `/home/ubuntu/.aphrody/layout-migrated` (JSON : date, liste des anciens chemins → nouveaux, liens de transition restants).
- **Données** :
  - aucun volume, aucune base ni aucune donnée unique supprimés sans copie vérifiée ;
  - avant de déplacer une base : `pg_dump` / `redis BGSAVE` vers `~/archive/` ;
  - les déplacements sur le même système de fichiers se font par `mv` (renommage instantané, pas d'espace en plus).
- **Dédoublonnage agressif** : `jdupes -r -L` (hardlinks) sur `~/apps`, `~/archive`, `~/src` (hors .git) et les données site/wiki/assets. Les caches régénérables sont supprimés (node_modules d'anciennes releases, target/, .next/, __pycache__, caches uv/pip/npm des comptes).
- **dbfr ≤ 50 %**, dans cet ordre :
  1. doublons de checkouts et de releases ;
  2. images Docker non utilisées ;
  3. dédoublonnage ;
  4. données froides (sauvegardes, archives, anciennes releases, modèles NON chargés par un service actif) transférées vers `vps:~/archive/dbfr/` par rsync (`rsync -aHAX --checksum`), vérification par `rsync -n --checksum` à vide, PUIS suppression sur dbfr.

  Ne jamais déplacer ce qu'un service actif lit (vérifier avec `lsof +D`, les volumes des conteneurs et les ExecStart).

## Retour arrière = rebuild (décision du 2026-10-09)

On ne garde que la version courante de tout. Aucune release N-1, aucun binaire `.bak`/aphrody.N-1, aucune archive de migration ou de purge. Pour revenir en arrière, on reconstruit depuis git ou un tag. Seule exception : le dernier backup hors hôte des bases prod (un seul, le plus récent, vérifié). L'activation garde l'ancienne release le temps du contrôle de santé, puis `clean.ts` la supprime (`scripts/aphrody/deploy` de aphrody-labs/bun).

### Purge restante (interrompue le 2026-10-09 à 17:40 UTC, rien n'a encore été supprimé sur les hôtes)

Garde-fous : après chaque étape, aphrody.com et `https://cdn.aphrody.com/s/manifest.json` répondent 200, `systemctl --failed` est vide et `bun scripts/aphrody/docker-doctor.ts dbfr vps` (dépôt bun) affiche 7/7. Ne pas supprimer `alpine:3.24` : docker-doctor l'utilise.

Sur dbfr, inventaire fait, suppressions à exécuter :
- CDN : `rm -rf ~/apps/cdn/releases/946758212b4e ~/apps/cdn/src.prev` (en service : `7a1d7777796f`).
- Site : dans `~/apps/downloads/site/releases`, tout sauf la cible de `current`.
- Discord : dans `~/apps/discord/releases`, tout sauf `4cf6332cdc66b3ec9c0f2b0c288f0a3024acf808`.
- Shenron : `~/apps/shenron/releases/docker-48530b178df88416ce6094d549bfc0d282fa68fb`, `~/apps/shenron/deploy-backups/*`, `~/apps/shenron/current/{compose.yaml,release.json}.bak-*`.
- aphrody-bun : le lien `current` pointe vers `releases/6cdb9e9` qui n'existe pas (la release est sous `releases/releases/6cdb9e9`). La dernière activation est `12fd6f9` : `ln -sfn /home/ubuntu/apps/aphrody-bun/releases/12fd6f9 ~/apps/aphrody-bun/current`, puis `rm -f ~/apps/aphrody-bun/previous` et suppression des autres releases et de `releases/releases`.
- Infra : `~/apps/infra/adapter-backups`, `~/apps/infra/migrations/*`, et dans `~/apps/infra/adapters` tout sauf `f69b9eab…` (celui installé dans `/usr/local/sbin` à 12:10).
- Copies : `~/apps/{aphrody,aphrody-bun}/compose.yaml.pre-layout`, `~/apps/downloads/app/server.ts.bak-20261009`, `~/shenron-adapter-*`, `~/archive/host-purge-2026-10-09`, `~/archive/units-2026-10-09`, `/var/backups/*.bak-D-20261009`, `/var/backups/aphrody-infra-deploy-shenron-container.before-P-20261009`, `/var/backups/aphrody-sysctl`, `/var/tmp/aphrody-pc-mcp-forward.service.bak-D`, `/etc/{environment,fstab}.bak`, `/etc/ssh/sshd_config.bak-20260811`, `~/.ssh/authorized_keys.bak-20261005-shenron-cdn`. Les fichiers vivants d'Omar (`/etc/ssh/sshd_config.d/60-omar.conf`, `/etc/ssh/authorized_keys.d/omar`) restent ; vérifier `sudo sshd -t` avant de retirer leurs `.bak`.
- Doublon rclone : `~/.local/bin/rclone` (1.75.1) masque `/usr/local/bin/rclone` (1.76.0-DEV, celui que déclare `runtime.json`) ; supprimer celui de `~/.local/bin`.
- Unités : `aphrody-discord-ai-lab.service` et `aphrody-discord-debate.service` sont désactivées, et leur `ExecStart` vise `/srv/aphrody-lab`. Les retirer quand `/srv` disparaît.
- Docker : rien à purger (cache de build vide, aucun conteneur arrêté).

Sur le vps, l'inventaire reste à faire (`du` lancé dans `~/build/tmp/purge/du.txt`). Cibles :
- `~/build/archive/{vps,dbfr-archive,k-archive}` et `~/build/archive/dbfr` (sauf le dernier backup des bases prod) ;
- `~/build/archive/rescue` : pousser d'abord les patchs et le bundle sur des branches `rescue/*` ;
- les liens `~/{archive,dbfr-archive,k-archive}` ;
- `~/apps/{cdn-src,shenron-cdn-src,shenron-cdn-state}` s'ils doublonnent `~/src/forks` ;
- `docker builder prune -a` et les images sans conteneur, sauf `alpine:3.24` et `ghcr.io/aphrody-labs/bun:1.4.3-aphrody.3`.
