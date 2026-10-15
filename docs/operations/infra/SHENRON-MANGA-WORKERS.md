<!-- SPDX-License-Identifier: Apache-2.0 -->

# Workers manga permanents

Le catalogue Infra possède `shenron-manga-workers.service` sur la fabrique VPS.
Shenron possède `scripts/ops/manga-source-pool.ts` ; Bun fournit le runtime,
les Workers et les capacités natives. Aucun nouveau checkout n'est créé.

Le service lance huit workers par `bun run bd -n -j2` depuis
`/home/ubuntu/src/bun`. Le mode `-n` réutilise le binaire source déjà construit ;
il ne qualifie pas les modifications ultérieures du checkout. Le lanceur détache
le superviseur et écrit `pool.pid`, puis rend le verrou du build. systemd suit
ce PID avec `Type=forking`, arrête tout le groupe et reprend après une panne.
La file SQLite et les checkpoints restent dans le dossier privé
`/home/ubuntu/.aphrody/profiles/dbfr/jobs/manga-source-pool`.

## Réseau et données

`NetworkNamespacePath=/run/netns/mullvad` réutilise la sortie Tokyo existante.
Le bind en lecture seule du résolveur `/etc/netns/mullvad/resolv.conf` évite
d'utiliser le stub DNS de l'hôte, inaccessible dans ce namespace réseau.
Avant installation, vérifier que `aphrody-mullvad-netns.service` est actif et
que les crawls déjà lancés restent vivants ; ne pas recréer le namespace ni
changer les clés, les routes ou le relais partagé pour installer les workers.
Le pool vérifie la sortie japonaise avant traitement. Le daemon natif Bun VPN
isolé, lorsqu'il est déconnecté faute de compte/device, ne constitue pas une
preuve de connexion japonaise native.

`progress.json` est privé ; `public-progress.json` est la projection expurgée
destinée au statut public. L'option `--public-progress-file` écrit uniquement
cette projection, atomiquement en mode 0644, dans
`/var/www/aphrody-status/manga-source-pool.json`. Infra crée ce dossier public
en mode 0755, propriétaire `ubuntu`. Le serveur CDN existant sert exclusivement
ce fichier à `https://cdn.aphrody.com/status/manga-source-pool.json`, sans cache
et sans accès au dossier privé des jobs. Les captures brutes et les secrets ne sont pas des
artefacts publics. Une découverte ne constitue ni une publication, ni une
preuve de planches disponibles, ni une indexation complète. Les médias publiés
passent par les writers et contrôles éditoriaux de Shenron.

## Plan avant activation

1. Vérifier les SHA Bun/Shenron, le binaire source exécuté, les gates du pool,
   les revendications concurrentes et la présence du namespace Tokyo actif.
2. Relire l'unité du catalogue, `systemd-analyze verify`, les limites et le
   dossier PID privé. Consigner la commande d'installation et le rollback
   avant toute modification d'hôte.
   Vérifier aussi `nginx -t` avant rechargement de l'unique route publique.
3. Par `aphrody infra ssh exec --host vps`, installer uniquement cette unité
   du catalogue dans `/etc/systemd/system`, puis `daemon-reload` et
   `enable --now shenron-manga-workers.service`.
4. Vérifier `is-enabled`, `is-active`, `MainPID`, namespace du superviseur,
   huit workers réels, progression de la file et reçu d'egress japonais.
   Contrôler la projection publique séparément de la progression privée.

La commande de contrôle du catalogue est
`aphrody infra service status --id shenron-manga-workers --target vps`.
Le rollback arrête et désactive uniquement `shenron-manga-workers.service` ;
il conserve la file, les données et le namespace partagé. Aucune purge n'est
nécessaire pour reprendre le service.

Avant le premier démarrage réel du pool, le statut public initial indique
`state=degraded`, `runtimeState=waiting_source_build`, zéro worker actif et
des compteurs inconnus à `null`. Son horodatage correspond à une observation
réelle du service. Il ne prétend pas connaître une file qui n'a pas encore été
ouverte. Les snapshots ultérieurs proviennent exclusivement du pool qualifié.

L'activation et la permanence réelle se prouvent sur l'hôte ; la présence de
cette unité dans Git n'est pas une preuve de déploiement ni de travail effectué.

## État vérifié le 15 octobre 2026 à 12 h 48 UTC

L'unité est installée sur `vps-203bea89`, activée au démarrage et en cours de
démarrage (`enabled`, `activating/start`). Le lanceur source attend le verrou
du build Bun existant, propriétaire PID `3756265` ; aucun second build n'a été
lancé par cette installation. Le PID de contrôle est `3796733`, son wrapper
source `3796740`. Aucun superviseur ni huit workers source opérationnels ne
sont encore attestés à cette observation (`MainPID=0`).

La qualification du code Shenron `9911a5fe` compte cinq tests et 52 assertions,
dont huit Workers réels avec le runtime installé ; le contrôle natif des
476 fichiers est vert. Cette preuve ne remplace pas les reçus du runtime source.
La session `manga-workers-infra-start` et les fichiers privés
`infra-service-start.log` / `infra-service-start.exit` suivent l'action Infra ;
un timeout d'observation SSH n'autorise pas le redémarrage du job existant.
