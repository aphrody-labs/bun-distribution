<!-- SPDX-License-Identifier: Apache-2.0 -->
# Site produit Rust : VPS, port 80

Directive propriétaire du 2026-10-09 : site natif sur le port 80 du VPS et du PC.
Ce runbook ne configure que le VPS ; le poste a son propre propriétaire/contexte.
Il complète [les releases immuables](IMMUTABLE-RELEASES.md), sans activer l'ancien
bundle Aphrody retiré.

## Contrat déclaré

Le service `aphrody-site` du catalogue utilise `runtime: rust`, `host: vps`,
`port: 80`, `publicProxy: direct-rust`, la santé `/health`, et le propriétaire
`../bun/packages/web/rust/crates/site`. Il sert les catalogues produit en lecture et le SSR natif.
Aucun endpoint MCP/Infra/credentials, accès hôte WebOS ou serveur JS n'est ajouté.

Unité source : `tools/config/host/systemd/aphrody/aphrody-site.service`.
Processus : `/home/ubuntu/apps/aphrody/current/bin/aphrody-site`, utilisateur système
`aphrody-site`, `NoNewPrivileges`, filesystem en lecture, capacité unique
`CAP_NET_BIND_SERVICE`. Pas de `setcap` global sur le binaire, pas d'exécution
root, pas de proxy Nginx nécessaire au port 80. Nginx observé inactif reste tel
quel ; les autres services et jobs ne sont pas arrêtés.

## Qualification du build isolé

La factory reçoit uniquement les sources `../bun/packages/web/rust/crates/site`, les templates suivis
`../material/packages/m3/templates` et le lockfile, accompagnés de tailles/SHA-256. La projection
workspace ne contient que `aphrody-site` et les mêmes pins de dépendances ; Cargo
normalise son lockfile de sous-ensemble en préservant les versions/checksums du
lockfile source. Comparer chaque dépendance registry du sous-ensemble à la source,
sans résoudre les derniers patchs permis par les ranges. Garder les deux lockfiles et le manifeste
de sources dans la preuve, sans prétendre que le lockfile complet est identique.

Les transferts se font par `aphrody infra ssh sftp --put`, ou `infra_sync` lorsqu'il
est qualifié. Ici le transport rclone a été interrompu après blocage constaté ;
le SFTP natif installé a réussi. Aucune clé ou session fournisseur transférée.

Le wrapper Cargo installé de la factory sérialise les compilations ; fan-out
limité à deux jobs, priorité nice 19 et sccache global conservé. Tests, Clippy
strict et release sont scoped `-p aphrody-site`, sans moteur/V8/CEF/Bun build.
Une commande asynchrone est observée par son tmux/PID/log, jamais relancée sur
simple timeout. L'échec offline pour dépendance manquante a été corrigé par un
fetch verrouillé avant les gates offline ; aucun nouveau checkout amont.

## Activation

Après les gates et le smoke natif, calculer SHA-256 du manifeste de sources et
du binaire. Le script propriétaire est
`scripts/tools/infra/deploy-native-site-vps.ps1` :

```powershell
./scripts/tools/infra/deploy-native-site-vps.ps1 `
  -SourceManifestSha256 <64-hex> -BinarySha256 <64-hex>
./scripts/tools/infra/deploy-native-site-vps.ps1 `
  -SourceManifestSha256 <64-hex> -BinarySha256 <64-hex> -Apply
```

Le plan est sans mutation. Apply vérifie le catalogue et le port libre, contrôle
les hashes, conserve l'unité précédente et son checksum sous
`/home/ubuntu/apps/aphrody/shared/native-site-backups/<date>`, puis installe une release
`/home/ubuntu/apps/aphrody/releases/native-site-<hash>`. Les templates sont root-owned et
immuables ; `current` est basculé atomiquement. Le script vérifie l'unité systemd,
active/enable le service et contrôle santé, cinq docs, six templates, pages/CSS,
PID natif, UID et capacités. Un échec après modification restaure l'unité/lien
précédents ; le diagnostic conserve la release pour analyse.

## Preuves à conserver

Enregistrer source hash, binaire hash, lockfile de build, résumé des gates,
release cible, systemd `MainPID/User/ExecStart/AmbientCapabilities`, `/proc/PID/exe`
et bind :80. Puis vérifier depuis Windows l'HTTP du VPS et comparer les réponses
docs/templates au catalogue original. Une réussite locale du VPS seule ne prouve
pas l'ingress externe ; inversement un HTTP 200 seul ne prouve pas un PID Rust.

## Reçu live 2026-10-09, 05:28 UTC

- Release : `/home/ubuntu/apps/aphrody/releases/native-site-02d5e8dba8849368`.
- Source snapshot : HEAD de contexte `c58e93d6dc1b4b2d420c3c929a40c67dd071d2f4`,
  avec sources site alors non commitées ; identité autoritative du snapshot :
  SHA256 manifeste `02d5e8dba884936830dc12dcc2daa6744e571d26175a563522dde70410fc7d55`.
  105 fichiers/814616 octets ; SHA-256 transit contrôlés. Aucune dérive des sources
  site par rapport au worktree lors de la réception.
- Build lock : `43a167579c0b80e2b46aab408e2fe253c90f369dec78f8eaa1e7b79fae220b6e`.
  128 entrées ; toutes dépendances registry du sous-ensemble correspondent aux
  versions et checksums du lock source. Aucun moteur compilé.
- Binaire ELF Linux x86-64 glibc, 3618632 octets, SHA256
  `11914868a7a88ad4c6c18410b6b2a406afd918361b2a2528098db9f11595fc0a`.
  17 tests passent, Clippy strict all-targets passe, build release passe.
- Smoke sous environnement minimal : santé 204, cinq docs, six templates.
  `ldd` : libc/libm/libgcc et loader Linux, aucun moteur JS lié.
- `aphrody-site.service` active et enabled, PID `3744372`, UID `993`
  (`aphrody-site`), `/proc/PID/exe` pointe sur ce binaire et son hash correspond.
  Bind direct `0.0.0.0:80`, capacités bounding/ambient uniquement
  `cap_net_bind_service`. Le processus est géré par systemd.
- Depuis Windows : `http://51.77.147.152/health` répond 204 ; comparaison HTTP
  `/api/docs` exacte, `/api/templates` mêmes six records/contenus/dépendances.
  L'ordre des fichiers diffère pour base/desktop : tri natif bytewise contre
  ancien `localeCompare`. Ce reçu ne revendique pas une réponse templates
  identique quant à cet ordre, ni la parité interactive UI complète.
- Première activation refusée par `systemd-analyze verify` avant création du
  lien current ; rollback exécuté. Script corrigé, release immutable hash-vérifiée
  réutilisée, seconde activation et contrôles live réussis. Le compte dédié et
  cette seule unité ont été ajoutés ; pas d'arrêt des autres services/jobs.

Ce reçu ne prouve pas l'installation sur le PC, TLS, Alpine/musl ou la conversion
complète des applications. Le port 80 du VPS sert réellement le site Rust décrit.
