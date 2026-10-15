<!-- SPDX-License-Identifier: Apache-2.0 -->

# Shenron Docker releases on DBFR

The owner-directed topology is WSL for source editing, VPS for builds, and DBFR
for Shenron production. Aphrody provides Shenron's backend capabilities. Infra
owns activation, public ingress, protected state and rollback.

`aphrody infra deploy --target dbfr --stack shenron --release RELEASE --apply`
uses the canonical adapter for both sealed container releases and historical
systemd releases. A directory containing `compose.yaml` dispatches to its
container verifier before the historical adapter can reconstruct source or run Bun.
Install both adapter files with `scripts/tools/install-vps-adapter.sh --stack shenron`
from a committed, sealed adapter package. The package's source manifest includes
the container helper, and `ADAPTER.json` records its installed hash.

The container release directory is `releases/<commit>` or
`releases/docker-<commit>`. Its `release.json` contains:

```json
{
  "schemaVersion": 1,
  "runtime": "docker",
  "repository": "shenron",
  "target": "dbfr",
  "commit": "FULL_40_CHARACTER_SHA",
  "imageId": "sha256:FULL_IMAGE_ID",
  "files": { "compose.yaml": "SHA256", "deploy.env": "SHA256" },
  "publicVfs": { "path": "/home/ubuntu/apps/shenron/shared/server/data/shenron-vfs.sqlite", "sha256": "SHA256" }
}
```

The adapter checks both file hashes, the loaded image's ID, platform and source
revision, both workloads' image identity and container policy, and the protected
environment files' containment and 0600 permissions. It checks the public VFS
checksum, SQLite integrity, public profile, absence of private rows and a nonempty
RAG corpus. Missing assets are a failed preflight, not an available capability.
Environment values and Compose diagnostics are never printed.
Keep each VFS at an immutable version-specific path under the server data store;
retain the previous version while its release is available for rollback. Replacing
a shared VFS in place invalidates the previous release's integrity check.

Activation is serialized. The old systemd Shenron writers must already be stopped.
One Compose project owns site, bot and the optional gateway; production performs no build or image pull.
The adapter switches `current`, waits for every container health check and verifies
their running state. A failure stops the candidate and restores the previous sealed
release. A rollback record is retained under `deploy-backups/docker-*` (0700).
Invoke the same adapter with `restore BACKUP` to repeat rollback; it refuses to
overwrite a newer activation. Docker's `unless-stopped` policy provides boot
activation through the Docker daemon.

Public nginx/TLS/DNS probes, an authenticated backend operation, Discord Gateway
readiness and data-transfer integrity remain separate required cutover evidence.
Neither a version command nor a container health check proves those requirements.
Remove the VPS runtime and temporary forwarding only after DBFR's public routes
and protected data are qualified. Never package environment files, conversations,
private databases or model weights inside the image or Git release.

## Gateway bundle and sealing

The gateway uses its own immutable Aphrody image while site and bot share the
Shenron image. Add `images.gateway` with `id` (Docker SHA-256 image ID) and
`commit` (40-character Aphrody revision). Every gateway image must be Linux amd64
and carry the matching OCI revision. Its runtime user is `0:0` for the TLS master;
its exact added capabilities are `NET_BIND_SERVICE`, `SETUID`, `SETGID`, with all
other capabilities dropped and `no-new-privileges` enabled. Workers remain
unprivileged. All workload root filesystems are read-only.

Copy canonical `tools/config/host/nginx/shenron/*.conf` into the release's `nginx/`
directory, and public static files into `public/`. Every file is sealed. Mount
`nginx/` read-only at `/etc/nginx/conf.d`. Mount only the public shared directories
`site/wiki`, `bot/assets` and `site/public-extra` at their corresponding
`/home/ubuntu/apps/shenron-cdn/{wiki,assets,site-extra}` paths. Other static mounts must be
sealed files or directories from the release. Private bot data, conversations,
agent homes and unrelated TLS identities cannot be mounted in the gateway.

Provision `/etc/aphrody/shenron-tls` through Infra as a protected, dedicated TLS
store containing only the required Shenron certificates and keys, preserving the
`live/` to `archive/` links. Mount it read-only at `/etc/letsencrypt`. Do not mount
the host's entire certificate store or copy keys into a release or image. Provide
writable nginx runtime/cache directories with tmpfs, including `/run`,
`/var/lib/nginx` and `/var/cache/nginx`.

Assemble on the build VPS, transfer only public release files to DBFR, load the
images, and seal on DBFR against the qualified public VFS:

```sh
python3 scripts/release/seal-shenron-docker-release.py RELEASE \
  --commit SHENRON_COMMIT --image-id SHENRON_IMAGE_ID \
  --public-vfs /home/ubuntu/apps/shenron/shared/server/data/VERSION/shenron-vfs.sqlite \
  --gateway-image-id GATEWAY_IMAGE_ID --gateway-commit APHRODY_COMMIT
sudo aphrody-infra-deploy-shenron verify RELEASE
```

The sealing command refuses an existing manifest, unexpected files and symlinks.
It hashes public release files and the external VFS; it does not verify runtime
availability itself. The canonical adapter supplies that preflight. PostgreSQL,
Redis and backend inference remain protected host capabilities until their own
checksum-verified migration and rollback qualify; application/gateway packaging
alone does not establish a full database/backend container migration.

## Complete bundle assembly and protected-state conversion

`assemble-shenron-docker-release.py` consumes the product owner's application
Compose with `--no-env-resolution`, removes build declarations, pins app image
IDs, selects the versioned VFS and adds the canonical gateway. Its nginx scratch
subdirectories use UID/GID 33 to avoid forbidden chown during startup; its open
file limit is 65535. Run on DBFR with the matching committed Infra source package:

```sh
python3 scripts/release/assemble-shenron-docker-release.py RELEASE \
  --app-compose PRODUCT_COMPOSE --image-id APP_IMAGE_ID \
  --gateway-image-id GATEWAY_IMAGE_ID --public-vfs PUBLIC_VFS
```

Images are built on VPS, exported with `docker image save IMAGE_ID`, checksum
verified after authenticated transfer, then loaded on DBFR with `docker image
load`. Compare `docker image inspect` IDs before sealing. No build or pull occurs
at activation. The initial apps/gateway bundle can consume existing protected
host PostgreSQL and Redis while their replacement is qualified.

Read-only DBFR inventory on 2026-10-07 found PostgreSQL 18.6 Ubuntu
`18.6-0ubuntu0.26.04.1` with plpgsql, pg_trgm and unaccent, 2.3 GiB data, no
external tablespaces; Redis 8.0.5 (`5:8.0.5-1`), 236 MiB, RDB persistence and AOF
disabled. The state Dockerfile pins those packages on Ubuntu 26.04 to preserve
platform/collation compatibility. Build and verify the actual image before use;
package availability and PostgreSQL collation versions remain runtime gates.

For coordinated conversion, stop all app writers and the host PostgreSQL/Redis
units through Infra, then run `sudo python3 scripts/migration/shenron-state-container.py
--apply`. The command requires a fresh `/home/ubuntu/apps/shenron/shared/state`, stopped units,
no Shenron containers and a clean PostgreSQL shutdown. It checksum-copies data,
configuration and Redis RDB, checks originals stayed unchanged, preserves PG TLS
credentials privately, normalizes Redis owned runtime paths and writes a private
`VERIFIED.json`. Original host stores stay intact. Failure never activates the
partial destination. Redis ACL/include paths must be reviewed privately before
cutover; referenced external ACL files require separate protected migration.

Then assemble with `--state-image-id STATE_IMAGE_ID`; seal with
`--service-image postgres STATE_IMAGE_ID APHRODY_COMMIT` and
`--service-image redis STATE_IMAGE_ID APHRODY_COMMIT`. These services retain their
observed numeric identities, host-loopback ports and auth configuration. The
adapter requires host writers inactive, both database services together, sealed
image identities, read-only roots and mounts contained in verified state.
Verify database/role counts, extensions, collation version, real authenticated
SQL, Redis key count and representative values privately before resuming apps.

Optional `--chat-image-id` and `--model-path` add the qualified Shenron chat v2 CPU
service at loopback 8799. Since 2026-10-09 `--model-path` is the single merged GGUF
(`shared/models/shenron-chat-v2/shenron-chat-v2-merged-Q4_K_M.gguf`, LoRA merged by
`llama-export-lora` b11415 into the F16 base then re-quantized with the unsloth
imatrix); `--adapter-path` only restores the old runtime LoRA. The service runs with
`--cache-ram 256 -fa on -ctk q8_0 -ctv q8_0 --no-repack` (llama.cpp defaults to an 8 GiB
host prompt cache, which pushed DBFR 6.9 GiB into swap; `--no-repack` keeps the weights in
the file mmap: RssAnon 0.7 GiB instead of 2.4 GiB, 746-token prompt at 19.9 instead of
21.8 tok/s, generation unchanged at about 6-8 tok/s). Every service carries
`mem_limit` = `memswap_limit` (chat 5g, postgres 2560m, redis 1536m, site 768m,
bot 512m, gateway 256m). Build `llama.Dockerfile` from only the
qualified b11415 runtime. Keep weights and adapter under the protected
`shared/models` store, transferred with verified checksums; never put them in the
image. Seal using `--service-image chat IMAGE_ID APHRODY_COMMIT`. Verify a real
OpenAI-compatible authenticated chat operation and available memory on DBFR;
this definition does not qualify OCR, embeddings or additional backend models.

For rollback after protected-store conversion, stop container writers first and
preserve the latest container-owned state. Restoring the original host snapshot
after production writes would lose changes: reconcile/checksum-transfer the
latest store back under a clean shutdown before resuming host units. Ordinary
release rollback should reuse the same qualified container-owned state. The
adapter does not automatically reverse this protected-data conversion.

## Grant S3 temporaire du bot

Sur `dbfr`, le service existant `shenron-cloudflare-s3-renew.service` reste
l'unique émetteur, déclenché par son timer de dix minutes. Son propriétaire
déclaratif est
[`shenron-cloudflare-s3-renew.service`](../../../tools/config/host/systemd/shenron/shenron-cloudflare-s3-renew.service).
Le jeton Cloudflare parent reste dans `LoadCredential`, et le profil émetteur
`/etc/aphrody/cloudflare/shenron-s3.json` reste root:root, mode0400.

L'artefact Shenron `deploy/cloudflare/cli/s3-profile.ts` du commit
`59c80cf0d67c44837483623eff15be7e56b2afb3` a pour SHA-256
`310007a22600a8a803e6b071b06dd71c90236e51cc3625934df9d6d240c9ade2`.
Il projette uniquement le grant temporaire `object-read-write`, limité aux
préfixes `_objects/` et `_migration/`, vers
`/home/ubuntu/apps/shenron/shared/bot/data/source-pipeline/credentials/s3.json`.
Les dossiers `source-pipeline` et `credentials` sont UID1000:GID1000, mode0700 ;
le fichier est mode0400. Le remplacement est atomique après application des
permissions et de l'identité. Le répertoire parent du montage conserve ses
permissions existantes ; il ne constitue pas la frontière de confiance privée.

Dans le conteneur UID1000, la configuration du pipeline utilise
`store.profile=/app/data/source-pipeline/credentials/s3.json` et
`store.consumerProfileRoot=/app/data/source-pipeline/credentials`.
Cette configuration est privée et son hash appartient au plan du pipeline.
Ne pas monter le profil root ni transmettre le jeton parent au bot.
L'absence de `store.sdkModule` sélectionne le fournisseur Curl natif qualifié ;
une capacité manquante reste une erreur explicite.

Avant application par Infra, vérifier le SHA de l'artefact, sauvegarder le
script et l'unité précédents, vérifier les chemins sans symlink et créer les
deux dossiers privés. Le sandbox conserve `ProtectSystem=strict` et autorise
uniquement le répertoire `credentials` supplémentaire dans `ReadWritePaths`.
Après application, relire le grant comme UID1000 dans le bot, vérifier portée,
expiration et mode sans afficher les clés, puis relancer le même service pour
qualifier le remplacement atomique. Le plan et les reçus privés du déploiement
du15octobre2026 se trouvent dans
`/etc/aphrody/cloudflare/operations/consumer-projection-59c80cf0/`.
Le rollback restaure les fichiers sauvegardés et recharge systemd, sans effacer
le profil privé ni modifier le timer. Cette provision ne démarre aucun job du
bot et n'active pas Canon ; ces opérations exigent le runtime qualifié.

## Collecte VPN dans un enfant privé

Le bot DBFR utilise le réseau hôte : il reste contrôleur et ne lance jamais le
daemon VPN dans son propre espace réseau. Le propriétaire de jobs existant
[`aphrody-build.ts`](../../../scripts/build/container/aphrody-build.ts) expose
le mode fini `source-job`, typé `shenron-source-vpn`. Son contrat et ses bornes
vivent dans
[`shenron-source-job.ts`](../../../scripts/build/container/shenron-source-job.ts).
Le contrôleur Infra exécute ce mode sur l'hôte explicite du plan, via le tunnel
existant ; aucun service, timer, socket Docker ou accès SSH n'est ajouté au bot.

La configuration privée désigne `vps` ou `dbfr`, l'ID immuable de l'image bot
déjà qualifiée, le runtime complet et son SHA, ainsi que `pipeline.mjs` et son
SHA. Ce bundle est produit par le build canonique du bot Shenron et livré avec
son reçu dans `/usr/local/lib/shenron/`. Pas de seconde fabrique d'image.
Le mode monte ces artefacts en lecture seule et ne reçoit pas `DATABASE_URL`,
de profil SQL ou de fichier d'environnement de production. Les seuls montages
mutables sont le volume privé de collecte et l'état privé du daemon ; le
sous-dossier de credentials du pipeline est masqué dans l'enfant.

`dataRoot` correspond côté DBFR à
`/home/ubuntu/apps/shenron/shared/bot/data/source-pipeline`, monté dans l'enfant
sur `/app/data/source-pipeline`. La configuration du pipeline est `config.json`
dans ce volume, impose `collectionIsolation: "required"` et garde ses chemins
d'entrée, policy, jobs et crawl dans ce volume logique. Si Search est présent,
son `cookieJar` est `/job/google-cookies.json`, projection en lecture seule du
jar canonique privé de cet hôte. Préserver un jar différent sur l'autre hôte.
Les profils S3 et SQL restent réservés au contrôleur après la collecte.

La configuration désigne aussi un `vpnStateRoot` privé distinct, un répertoire
de ressources avec `relays.json` et son SHA, et une échéance de 1 000 à 900 000 ms.
Les chemins doivent être absolus, privés, sans symlink ni injection d'options
de montage. Le cache de relais officiel préparé le15octobre2026 sur les deux
hôtes réside dans
`~/.aphrody/private/vpn-isolated-20261015/resources/relays.json` ; son reçu
sépare validation structurelle, parseur Rust et vérification Sigsum. Ne pas
qualifier le fichier vide de `vendor/mullvad/dist-assets/relays/relays.json`.

Créer un plan neuf, puis appliquer uniquement son hash exact :

```sh
bun scripts/build/container/aphrody-build.ts source-job plan --config /private/source-job.json --plan /private/source-job-plan.json
bun scripts/build/container/aphrody-build.ts source-job apply --config /private/source-job.json --plan /private/source-job-plan.json --plan-sha256 SHA256_DU_PLAN
```

Le plan épingle les artefacts, le jar, la configuration, l'identité de la
machine, ses namespaces, son résolveur et sa route par défaut. Le mode crée un
conteneur privé bridge, jamais host, avec deux CPU, mémoire et swap bornés à
1 024 Mio, 128 processus et `/dev/net/tun`. Ces limites demandent une mesure réelle
du crawl complet avant activation ; les fixtures ne qualifient pas son pic
mémoire. Le daemon root possède seul son firewall ; la collecte tourne en
UID1000. Ses chemins settings/cache/resources/RPC sont explicites et séparés.
`TALPID_DNS_MODULE=static-file` force le backend qui écrit en place dans le
résolveur Docker privé ; le backup Mullvad reste dans le filesystem éphémère
du conteneur, sans montage de `/etc` ou du D-Bus hôte.

Le compte est lu dans le keyring OS `bun-vpn`/`mullvad-account` et fourni au RPC
par `bun vpn login --stdin`, jamais en argument ou dans un fichier intermédiaire.
Avant collecte, vérifier état connecté, sortie Mullvad officielle et TLS Google.
La collecte appelle uniquement `collectSourcePipeline`, puis publie un reçu
privé avec les hashes du propriétaire Shenron. Le contrôleur valide ce reçu
avant son propre plan/apply/verify SQL, CAS et RAG, hors du VPN. Un reçu de
collecte ne signifie pas que toutes les sources ou la livraison sont complètes.

Le verrou et les labels plan/instance empêchent un teardown d'un conteneur
étranger. Annulation et échéance provoquent TERM puis KILL bornés, arrêt du
conteneur et relecture des invariants réseau hôte. Une activation exige encore
le runtime natif qualifié, le parseur Rust des relais, le bundle producteur,
la mesure en conteneur et la configuration protégée du contrôleur existant.
Les namespaces Japon et Google-US déjà actifs sur VPS gardent leur
propriétaire WireGuard ; ne pas y superposer un daemon Mullvad.

### Transport du bot vers la fabrique existante

Le timer utilisateur VPS `shenron-auto-deploy.timer` déclenche un service
oneshot toutes les deux minutes après sa fin. Le volume privé DBFR n'est pas
monté sur VPS. L'option `sourceCollection` de la configuration existante de la
fabrique contient uniquement `host: "dbfr"` et les références `runtime`,
`owner`, `jobConfig`, chacune avec chemin absolu et SHA-256. L'option reste
absente avant qualification ; aucune activation n'est implicite.

Le service existant supervise un enfant `source-controller` pendant ses builds
bloquants, sans second timer ni second service. Cet enfant traite au plus une
requête à la fois et attend deux minutes entre les passages. Il utilise le
propriétaire SSH Infra existant pour exécuter sur DBFR l'artefact propriétaire
fixe et vérifié, sous UID1000 pour accéder au keyring OS de cet utilisateur.
Il n'accepte aucun chemin d'exécutable, image, flag privilégié ou commande
depuis les messages du bot. Une commande distante vérifie les hashes avant
`source-job drain --config PRIVATE --config-sha256 HASH`. Au terme du build,
le parent demande l'arrêt après la requête courante, rejoint l'enfant avec une
échéance bornée, puis termine son groupe de processus si nécessaire.

Le callback du bot écrit uniquement dans
`/app/data/source-pipeline/control/requests/UUID.json`, mode0600 :

```json
{
  "schema": "shenron-source-request/v1",
  "requestId": "UUID",
  "configPath": "/app/data/source-pipeline/config.json",
  "configSha256": "SHA256_DE_LA_CONFIGURATION"
}
```

Le contrôleur lit ce même chemin via
`/home/ubuntu/apps/shenron/shared/bot/data/source-pipeline/control` sur DBFR.
Les sous-dossiers sont mode 0700, UID 1000, sans symlink. Les requêtes sont
bornées à 4096 octets et 128 fichiers en attente ; les réponses à 65536 octets.
Le mutex SQLite natif privé libère son verrou à la mort d'un processus ; il
ne remplace pas la queue ni les checkpoints du crawler canonique.

Le profil privilégié approuvé reste hors du volume du bot. Pour chaque
requête, le contrôleur vérifie son hash, construit et conserve un nouveau
plan du job typé, écrit une barrière de démarrage, puis exécute la collecte.
Le journal privé `control/jobs/UUID` conserve requête, plan, barrière et résultat.
Un résultat sauvegardé est rejoué sans nouvelle collecte ; une barrière seule
produit `ERR_SOURCE_JOB_STATE_UNCERTAIN`, jamais une relance aveugle.
Un message privé malformé est déplacé intact dans un journal de rejet avec
un code fixe sans contenu exposé ; le tick suivant peut traiter une requête
valide. Un ancien message déjà répondu rejoint son journal. Les objets de
fichiers non sûrs et les dépassements du budget global bloquent le traitement.

La réponse atomique `control/responses/UUID.json`, mode 0600, lie `requestId`,
`configSha256`, `status` et le reçu `collection` du propriétaire Shenron.
`status: "complete"` signifie seulement que le transport de collecte a réussi ;
le contrôleur applicatif conserve les gates de complétude des sources et de
livraison. Les erreurs exposent uniquement
`ERR_SOURCE_JOB_COLLECTION_FAILED` ou `ERR_SOURCE_JOB_STATE_UNCERTAIN`.
Le bot valide les pins puis supprime uniquement ses messages consommés.
L'annulation supprime sa requête ; le watcher propriétaire annule le job
actif et détruit son enfant privé. Le conteneur possède aussi une échéance
autonome pour ne pas survivre indéfiniment à une rupture SSH. Le sous-dossier
`control`, comme `credentials`, est masqué dans l'enfant VPN.

## Builds on the VPS: the `aphrody-build` image

Shenron's Rust, WASM, Bun install and bot steps run in Aphrody's single VPS build image
(`aphrody-build:latest`, see [CONTAINER.md](../container/CONTAINER.md#vps-build-image-aphrody-build)), never directly
on the host toolchain. Shenron owns the call sites: `scripts/build/container.ts` (not in repo) (same run contract as
`aphrody-build.ts run`), `scripts/ops/release-host.ts` (not in repo) and the self-hosted workflows.

- **Release** (`bun scripts/ops/release.ts`, user `ubuntu`): `release-host.ts build` checks the image against the
  checkout (`container.ts --check`: Rust channel and `wasm-bindgen` labels), then runs `bun install`,
  `shenron-mcp`, `shenron-ffi`, Koharu and shenron-re WASM and the bot in the container. The site keeps its own
  bounded Node 22 container (`build-site-external.ts`); assembly and the protected site environment stay on the host
  (`sudo -n`).
- **Build tree**: the release builds in `~/shenron-release`, a detached worktree of `~/shenron` forced onto
  `origin/main` (`checkout -f --detach`, `clean -ffd`; ignored caches and `target/` are kept). The release of
  2026-10-07 ended in `== EXIT 1` because it fast-forwarded the editable `~/shenron` itself and uncommitted edits
  there blocked `git merge --ff-only`; edits in `~/shenron` no longer affect a release.
- **Runner** (`aphrody-vps-shenron`, user `ubuntu`, group `aphrody`, already in `docker`): `server-artifact.yml` runs
  `bun ci` and `scripts/build/server.ts` (not in repo) through `container.ts --target-volume shenron-ci` (the runner cleans its
  checkout between jobs; `target/` lives in a volume). The production public VFS is a workflow input, default
  `/home/shenron-build/data/shenron-vfs.public.sqlite` (public profile, staged with a verified SHA-256);
  `factory-check.yml` verifies the image and its tools as the runner user.
- Rebuild the image whenever `rust-toolchain.toml`, `packageManager` or the `wasm-bindgen` lock version changes:
  from a clean Aphrody checkout on the VPS, `bun scripts/build/container/aphrody-build.ts image`.
