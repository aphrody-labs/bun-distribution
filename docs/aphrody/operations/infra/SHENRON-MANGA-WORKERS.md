<!-- SPDX-License-Identifier: Apache-2.0 -->

# Workers manga permanents

Le catalogue Infra possède `shenron-manga-workers.service` sur la fabrique VPS.
Shenron possède `scripts/ops/manga-source-pool.ts` ; Bun fournit le runtime,
les Workers et les capacités natives. Aucun nouveau checkout n'est créé.

Le service lance seize workers avec le binaire installé qualifié
`/home/ubuntu/.bun/bin/bun-1.4.4` depuis `/home/ubuntu/src/shenron`.
La révision attendue est `dfde053a3045d6076ad315b6f63160c4ced71513`.
Le lanceur détache le superviseur et écrit `pool.pid`. systemd suit
ce PID avec `Type=forking`, arrête tout le groupe et reprend après une panne.
La file SQLite et les checkpoints restent dans le dossier privé
`/home/ubuntu/.aphrody/profiles/dbfr/jobs/manga-source-pool`.
La directive propriétaire du 15 octobre 2026 ouvre les douze vCPU de la fabrique
(`CPUQuota=1200%`), avec `MemoryHigh=16G`, `MemoryMax=20G` et 2048 tâches au plus.
Elle conserve de la marge pour les autres jobs qualifiés et n'alloue pas
artificiellement de mémoire. Les limites ne changent pas le parallélisme des
builds ni les processus appartenant à d'autres sessions.

## Capacités explicites

L'argument `--capabilities-file` lit le fichier privé en mode 0600
`runtime-capabilities.json` du job. Le schéma
`shenron-manga-pool-capabilities/v1` lie la configuration à l'exécutable et à
sa révision. `search.owner=bun-cli-search` et `search.state=unavailable`
signalent explicitement que la recherche Google anonyme n'est pas disponible
dans ce runtime. Les tâches concernées conservent leur motif et leur reçu en
`capability_unavailable`, différées de 24 heures, sans appel réseau ni autre
fournisseur implicite. La collecte des URL éditeurs connues et l'indexation
native privée continuent. La projection publique expose cet état séparément.

Le Bun installé a qualifié huit Workers réels, le DOM Obscura et deux captures
éditeurs réelles avec frontière, index et rejeu sans duplication. Son module
`bun:google` expose un client authentifié Google APIs, pas la recherche anonyme.
L'unique essai anonyme de `aphrody web search` a rencontré un écran anti-bot ;
ce refus reste consigné et n'a pas été contourné. Les reçus privés sont dans
les jobs `manga-installed-direct-qualification-20261015` et `manga-source-pool`.

Le build source Bun partagé continue indépendamment. Passer à une autre
révision ou réactiver la recherche exige la qualification du binaire et du
port réels, puis une configuration explicite par Infra. Le service ne lance
aucun build et ne modifie pas le namespace réseau.

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

1. Vérifier les SHA Bun/Shenron, le binaire installé et ses capacités déclarées, les gates du pool,
   les revendications concurrentes et la présence du namespace Tokyo actif.
2. Relire l'unité du catalogue, `systemd-analyze verify`, les limites et le
   dossier PID privé. Consigner la commande d'installation et le rollback
   avant toute modification d'hôte.
   Vérifier aussi `nginx -t` avant rechargement de l'unique route publique.
3. Par `aphrody infra ssh exec --host vps`, installer uniquement cette unité
   du catalogue dans `/etc/systemd/system`, puis `daemon-reload` et
   `enable --now shenron-manga-workers.service`.
4. Vérifier `is-enabled`, `is-active`, `MainPID`, namespace du superviseur,
   seize workers réels, progression de la file et reçu d'egress japonais.
   Contrôler la projection publique séparément de la progression privée.

Le démarrage peut attendre jusqu'à deux heures le verrou du build source canonique.
Cette attente évite les cycles de redémarrage de dix minutes pendant un build
qui progresse lentement en IO. Le délai ne prouve aucune activité des Workers.
Pour appliquer uniquement ce changement, relire le plan, vérifier l'unité,
installer le fichier du catalogue et recharger systemd ; ne relancer que notre
unité si elle attend encore sans `MainPID`, jamais le propriétaire du build.

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

## Statut public vérifié le 15 octobre 2026 à 12 h 57 UTC

La route exacte `https://cdn.aphrody.com/status/manga-source-pool.json` répond
200 avec `Content-Type: application/json` et `Cache-Control: no-store`.
Le snapshot initial, âgé de 36 secondes au contrôle, indique l'attente du build,
zéro worker actif et des compteurs non connus à `null`. La vérification refuse
les clés inattendues et les chemins ou noms de secrets privés. `/status/` et
`/status/progress.json` répondent 404 ; POST sur le fichier répond 403 ; la
santé CDN existante répond toujours 200.

Le répertoire public appartient à `ubuntu` en mode 0755, le fichier en 0644.
Nginx a passé son contrôle de syntaxe avant rechargement. Le service a été
redémarré une seule fois pour prendre son nouvel argument de projection publique,
pas à cause d'un délai d'observation. Il reste activé et en attente du build
source existant ; le nouveau PID de contrôle est `3833867`. Le build partagé
et le daemon VPN natif isolé sont restés vivants. Cette publication du statut
ne démontre ni huit workers source opérationnels ni la complétude des médias.

## Runtime installé actif, vérifié le 15 octobre 2026 à 14 h 08 UTC

L'unité effective est `active/running`, `MainPID=4051905`, sans redémarrage
automatique, après démarrage à 13 h 55 min 38 s. Elle utilise temporairement
`/home/ubuntu/.bun/bin/bun-1.4.4`, révision
`dfde053a3045d6076ad315b6f63160c4ced71513`. Le lancement source reste la cible
du catalogue ; le build source partagé est encore actif. Cette observation
qualifie exclusivement le runtime installé.

`workers.json` atteste les 16 accusés de disponibilité avant `ready.json` ;
le superviseur compte 40 threads à cette observation. La présence effective
du PID dans `/system.slice/shenron-manga-workers.service` et dans son fichier
`cgroup.procs` a été relue. Les plafonds effectifs sont `cpu.max=1200000 100000`
(12 CPU), `memory.high=17179869184`, `memory.max=21474836480` et `pids.max=2048`.
Le namespace réseau du PID correspond au namespace Tokyo existant. Cela ne
prouve pas un tunnel natif Bun VPN.

Le pool possède désormais la projection publique ; aucun lanceur manuel de
bootstrap n'est actif ni planifié. Son garde refuse l'écriture si le pool
possède un PID vivant ou si le service a un `MainPID`. Le GET public répond
200 et `no-store`, avec `state=running`, 16 workers initialisés et cinq tâches
occupées au relevé. Le nombre de tâches terminées ne mesure ni des pages
publiées ni des tomes complets. La recherche est déclarée `unavailable` car le
runtime installé ne supporte pas le CLI requis ; aucune boucle de retry ne
doit masquer cette limite.

Le reçu privé `manga-source-pool/operator-active-runtime-proof-20261015140837691.json`
conserve la participation cgroup actuelle. Les reçus précédents restent des
observations historiques, et ne remplacent pas cette relecture du processus.

## Rechargement des sources vérifié le 15 octobre 2026 à 15 h 30 UTC

Root a livré les deux fichiers du lot Shenron
`efb921af69b27296edba293edecb3a68b925fc3e` par staging SFTP, comparaison des
SHA avant remplacement et sauvegardes relues. La projection récupère uniquement
les reçus UTF-8 à BOM dont les octets originaux sont encore vérifiables ; les
23 reçus EUC-JP non récupérables restent refusés. Les tests du lot rapportent
21 tests, 140 assertions et 264 reçus originaux inchangés, dont 241
reconstructions exactes. Ce relevé documentaire ne rejoue pas ces tests.

L'adapter catalogue `service restart --target vps` avait échoué en conservant
l'ancien PID `4167233`. L'action réussie de root, vers 15 h 23 UTC, est :

```sh
aphrody infra ssh service --host vps --action restart shenron-manga-workers.service --json
```

La relecture indépendante confirme `enabled`, `active/running`,
`MainPID=140289` et un démarrage systemd à 15 h 23 min 00 s. Les reçus
`workers.json` et `ready.json` attestent 16 workers et la même révision Bun
`dfde053a3045d6076ad315b6f63160c4ced71513` à 15 h 23 min 02 s. Le reçu
d'egress indique Japan/Tokyo à 15 h 23 min 02,210 s ; il atteste la sortie
existante, pas un nouveau tunnel Bun VPN.

La relecture SHA confirme la projection
`9364a6d1b7b96c46f4d8f182717ea367982b0c76d6b64dde1d58b5b3903de86e`
et le test BOM
`178a49d7f02af675b7f3eee47075630cbbfeafefc3fae9fa8aa229b59c260a09`.
Les deux sauvegardes correspondent aux SHA avant remplacement du plan.
Les reçus privés `plan.json` et `source-applied.json` du job
`root-pool-source-reload-20261015` séparent le remplacement à 15 h 20 min 36 s
du redémarrage ultérieur ; `serviceRestarted:false` dans le second décrit
uniquement cet instant intermédiaire.

Root a observé à 15 h 25 min 08 s `projected=3966`, `changed=241`,
`indexed=241`, `emitted=0` et `publicWrites=0`. Le cycle relu à
15 h 28 min 06,071 s conserve `projected=3966`, avec `changed=0`,
`index=null`, `emitted=0`, `quarantined=3989` et aucune écriture publique ou
éditoriale. Ces deux cycles ne sont pas des compteurs cumulatifs de pages.
Aucun nouveau tome complet n'est démontré. L'observation expurgée et les SHA
des preuves sont dans
[l'inventaire daté](../../../../infra/config/host/inventory/shenron-manga-workers-source-reload-2026-10-15.json).
Ce lot documentaire ne change ni unité, catalogue, service, données ni namespace.
