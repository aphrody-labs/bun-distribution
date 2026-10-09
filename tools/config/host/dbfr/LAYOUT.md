# Disposition unique des hôtes Aphrody (vps, dbfr) : décision du 2026-10-09

Consigne du propriétaire : tout fusionner dans UN SEUL home par hôte. Plus de /srv. Docker en direct. Plus de checkouts en double, de builds multiples ni de services multiples. Tout est centralisé, unifié et dédupliqué agressivement. **dbfr doit descendre à 50 % d'usage disque maximum** (/ fait 96G, donc ≤ 48G utilisés ; aujourd'hui 79G).

## Home unique : `/home/ubuntu` sur chaque hôte

| Chemin | Contenu | Remplace |
| --- | --- | --- |
| `~/src/<repo>` | UNE seule copie git par dépôt : `aphrody`, `bun`, `shenron`, `forks/<nom>` | release/aphrody, aphrody-root, bun-src, yolo/src/*, shenron-docker, shenron-release, /srv/aphrody-build/workspaces/*, /srv/aphrody/shared/agent-workspaces/*, /home/omar/src/* |
| `~/apps/<app>/` | runtime d'un service : `compose.yaml`, `.env`, `data/` (bind mounts), `releases/` (courante + 1 précédente au maximum) | /srv/aphrody*, /srv/shenron*, /srv/app, /etc/aphrody/container, /opt/aphrody-discord-sync |
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
