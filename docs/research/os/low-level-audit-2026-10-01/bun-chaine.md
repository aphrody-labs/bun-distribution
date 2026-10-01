# Audit axe « bun-chaine » — côté Bun/TypeScript et chaîne d'approvisionnement (2026-10-01)

Niveau de preuve global : P1 (statique, lecture seule, aucun cargo/bun install/bun test/--apply exécuté).
[V] = vérifié dans le code ou sur le disque ; [P] = plausible, non reproduit.

Cadrage (correction du propriétaire reçue en cours d'audit, docs/reference/os/YOLO-AUTHORITY.md) : Aphrody est un OS YOLO.
Les hooks de plugins d'agents et les ops puissantes de `@aphrody/workspace` sont l'autorité voulue ; ce rapport ne recommande
NI sandbox, NI confirmation, NI approbation. Le confinement au `--root` est jugé comme garde contre les BUGS de chemin, pas
contre un attaquant. Restent traités : fiabilité des ops qui écrivent/suppriment (dry-run annoncé non tenu, écrasement sans
sauvegarde), chaîne d'approvisionnement, secrets, intégrité du binaire Bun et de `bun:aphrody`, exactitude des revendications,
réutilisation de briques mûres.

## 0. Périmètre réellement lu

- `packages/infra/workspace/src/` : ops.ts (349 l., tout), workspace-clean.ts, workspace-repair.ts, cargo-package-repair.ts,
  git-attribution.ts, pipeline-catalog.ts, runtime.ts, bridges.ts, binaries.ts, bun-upstream-docs.ts, bun-docs.ts, spaceui-icons.ts,
  agent-plugin-sync.ts, agent-home.ts (470-547), agent-live.ts (100-160, 360-420), agent-home-drive-sync.ts (1-70), bun-native.ts
  (20-145, 270-384), tauri-sync.ts (76-106, 375-600, 560-815), tauri.ts (150-230), tauri-apps.ts (495-542), bun-workspace.ts (40-110,
  210-385), workspace-deps.ts, ecosystem-deps.ts (90-135), consolidation.ts (1-200, 295-360, 365-760, 940-1088),
  docs-consolidation.ts (540-570, 1090-1420, 1740-1957), infra-config-import.ts / infra-scripts-import.ts /
  source-licenses-import.ts (parties d'écriture), rg.ts (290-420, 540-640), web-migration.ts (150-192), runtime-gate.ts (50-104).
  Les autres ops de `ops.ts` ont été classées par grep (spawn / rm / writeFile), pas lues en entier.
- `packages/os/kernel-client/src/index.ts` (tout), `packages/os/winclean/winclean_maintenance_workflow.ts` (tout),
  `packages/interop/native/src/{library,native-artifact}.ts`, `packages/web/agent-browser/{src/engine.ts,service.ts,config.ts,bin}`,
  `packages/shenron/pipeline/src/bxc/spawn.ts`, `packages/ai/google/src/drive-sync.ts` (70-105).
- `apps/shenron/bot/src/api/{server.ts (6735-6945, 3236-3250), request-guards.ts}`.
- `scripts/` : ops/{purge-attribution,repo-sync (120-260)}.ts, source-sync.ts (160-199), nie/sync-main.ts (extraits),
  assets/cdn.ts (160-251), iecode/publish-rust-crates.sh, aphrody/vps-setup-all.sh, atomic-deploy-bundle.sh (1-160),
  rg/inagle/pipeline/lua-pipeline.ts (extraits) + greps ciblés (curl|sh, rm -rf, eval, execSync, shell:true).
- `.github/workflows/rg-migration.yml` et les 7 workflows inertes `.github/{rg,shenron}/workflows/*.yml` (tous).
- 101 `package.json` suivis (analyse python), `bun.lock` (grep/regex), `bunfig.toml`, `package.json` racine, `patches/` (en-têtes),
  `.gitignore`, `.coord/` (listing, claims.rs, lock.rs), `config/ai/plugins/**`, `plugins/**`, `.claude*`, `.codex*`,
  `config/{bun-fork,web,tauri-upstream}.json`, `docs/migration/BUN-FORK-UNIFIED-NATIVE.md`, `docs/operations/infra/BUN-FORK-OPERATIONS.md`,
  `docs/reference/infra/GITHUB-OWNERSHIP.md`, `docs/migration/BUN-NATIVE-PACKAGE.md` (début), `source-map.json` (clé `roots`).
- Binaire Bun de l'hôte (`~/.bun/bin/bun`) et paquet global `@aphrody/bxc@0.9.15` (postinstall).

## 1. Opérations de `ops.ts` qui écrivent ou suppriment : garde, confinement, sauvegarde

Légende : DR = dry-run par défaut (écriture seulement avec drapeau) ; SAV = sauvegarde ; CONF = confinement au `--root`.

| Op (fichier) | Effet | Garde | CONF | SAV | Verdict |
|---|---|---|---|---|---|
| `workspace-clean` (workspace-clean.ts:49-84, 93) | `rm -rf` de dossiers `target/dist/build/.cache/...` | DR ; `--apply` ; ignorés par git ou `__pycache__` ; symlinks sautés (57) ; dossiers suivis protégés (61) | oui (walk depuis root) | non (régénérable) | BON. Défauts : `check-ignore` seul (67) donc un `build/` ignoré à l'intérieur d'un dépôt imbriqué non suivi est supprimé ; `tracked.some` en O(n*m) (61) |
| `workspace-repair` (workspace-repair.ts:34-62) | lance `nu <os-root>/scripts/fix-refs.nu` puis `workspace-deps` | DR (`--apply` relayé) | racines passées en argument | non | CASSÉ : le script n'existe plus à `<os-root>/scripts/fix-refs.nu` ; il est à `scripts/tools/os/scripts/fix-refs.nu` ; `aphrody-os` n'existe plus (`ls /home/aphro/aphrody-os` : absent) |
| `cargo-package-repair` (cargo-package-repair.ts:7-51) | réécrit `-p-xxx` en `-p aphrody-xxx` dans les fichiers suivis | DR ; `--apply` ; `git grep` (symlinks ignorés) | par dépôt | non (git) | BON |
| `docs-consolidate apply` (docs-consolidation.ts:1153-1364) | `rename`, `unlink`, `writeFile`, `rmdir`, réécriture de liens, mise à jour de source-map.json | DR ; `--write` (1796) ; préconditions sha256 (1176-1215) ; fichiers sales sautés ; liste `--protect` | NON (voir BC-05) | non | À CORRIGER. Piège : `--apply <fichier>` (1791) n'est PAS l'interrupteur d'écriture (c'est `--write`, 1795) |
| `consolidation <action>` (consolidation.ts:365-1088) | écrit source-map.json (26 Mo), nested-source-map.json, copie docs/scripts/licences/config | AUCUN dry-run, AUCUN `--apply` ; imports : `wx`/`COPYFILE_EXCL`, hash source, `startsWith(root+"/")` | partiel : imports oui (≈480, 640-700), `inventory` non | non | DANGEREUX par défaut (BC-02) |
| `bun-upstream-docs` (bun-upstream-docs.ts:56-98) | `git reset --hard`, `rm -rf upstream/bun`, `rm -rf docs/n2b/bun`, copie | AUCUN | non | non | DANGEREUX (BC-04) |
| `bun-docs fetch` (bun-docs.ts, fetchBunReference) | télécharge 11 fichiers `bun.com`, écrase `packages/infra/workspace/docs/bun/*` | `--check` | oui (dossier fixe) | non (git) | `--check` compare au site distant vivant : gate non reproductible (échoue dès que bun.com change) ; aucun hash épinglé |
| `tauri-sync --apply` (tauri-sync.ts:705-790) | réécrit Cargo.toml, package.json, config, miroirs, schémas ; lance le gate | `--apply` explicite ; refuse si patch cassé ; snapshot + `restore` (698-700, 783) | racine | OUI (snapshot mémoire) | BON ; `restore` ne supprime pas les fichiers créés (`text !== null` seulement) ; voir BC-07 |
| `tauri-apps --fix` (tauri-apps.ts:511, 524-529) | corrige `$schema` des tauri.conf | DR (rapport) | racine | non (git) | BON |
| `pipeline-catalog --apply` (pipeline-catalog.ts:115-116) | écrase `config/pipeline.json` | DR (affiche) | `join(root)` sans `resolve` | non (git) | ACCEPTABLE |
| `git-attribution --apply` (git-attribution.ts:60-114) | recrée les commits sans trailers puis `update-ref` | DR ; CAS `update-ref new old` | par dépôt | reflog | ACCEPTABLE ; le « dry run » écrit déjà des objets (`commit-tree`, 88) |
| `spaceui-icons --prune` (spaceui-icons.ts:130-239) | supprime les doublons archivés | DR (`--plan`) ; manifeste + sha256 + `safeRelativePath` (68-70) | oui | manifeste | EXEMPLAIRE (à garder) |
| `workspace-deps --apply` (workspace-deps.ts) | retire des dépendances `workspace:`/`file:` et ajoute des `paths` tsconfig vers un dépôt frère | DR | non (`--sibling`) | non | OK mais produit des chemins relatifs inter-dépôts (héritage multi-dépôts) |
| `ecosystem-deps --write` (ecosystem-deps.ts:100-134) | réécrit Cargo.toml/package.json de dépôts FRÈRES | DR (échec si dérive sans `--write`) | non : racines `join(dirname(ai), "aphrody-os")`… | non | HÉRITAGE : cible des dépôts qui n'existent plus |
| `bun-workspace --fix` (bun-workspace.ts:331-332) | réécrit tous les `package.json` suivis (JSON.stringify 2 espaces) | DR | racine | non (git) | OK ; reformate les fichiers |
| `agent-plugin-sync` (agent-plugin-sync.ts:70-187) | écrit `.agents/*`, SUPPRIME `plugins/.claude-plugin`, réécrit `~/.claude/settings.json` et `~/.gemini/config/skills.json` | INVERSÉ : écrit par défaut, `--dry-run` n'affiche que l'inventaire | non (`--root`) | non | CASSÉ + écriture globale (BC-06) |
| `agent-home` (agent-home.ts:480-547) | écrit REPOS.md/TOOLS.md dans `~/.aphrody/workspaces/*` | écrit par défaut ; `--dry-run` | `--workspace` libre | OUI pour un fichier non généré (`.before-agent-home-<ts>`, mode 0600, `wx`, 531-536) | BON |
| `agent-live` (agent-live.ts:376-413) | `.coord/shared/LIVE.{json,md}` | n/a | oui | n/a | BON : tmp + `rename`, mode 0600 |
| `tauri` / `drive-daemon` stage (tauri.ts:160-169, 216-223) | `copyFile` des sidecars dans `src-tauri/binaries` et `target/<profil>` | aucune | non | non | `copyFile` sur un exécutable en cours d'usage : ETXTBSY [P] |
| `bun-native` (bun-native.ts:292-371) | publie `native/<triple>/` et `manifest.json` | tmp + `rename`, sha256, smoke avant publication | oui | n/a | BON (à garder) |
| `infra-*-import`, `source-licenses-import` (consolidation) | copient vers docs/scripts/config | `wx`, `COPYFILE_EXCL`, hash, préflight HEAD source | `startsWith(target+"/")` | non | BON ; `source-map.json` réécrit en fin de course sans tmp+rename |
| `rg inventory --out`, `repository-state --out`, `stack-dedup --out` | un JSON | n/a | `--out` libre | non | OK |
| `iecode-sync` (scripts/nie/sync-main.ts) | `git push`, `scp`, `mv` distants | DR par défaut, `--apply` ; `ssh --` | n/a | non | BON (`quote()` + `--`) |
| `rg deploy --apply` / passthrough (`rg.ts:593-606`, `ops.ts:334-348`) | délègue à `aphrody-infra` | DR côté Rust | n/a | n/a | tout nom d'op inconnu est relayé à `aphrody-infra` (ops.ts:334-348) : pas de liste d'ops |

### Les 5 pires défauts de confinement/garde (bugs de chemin et de défaut, pas d'attaquant)

1. `packages/os/winclean/winclean_maintenance_workflow.ts:12,68,93,131-137` + dernière ligne `run().catch(console.error)` [V]
   `ROOT = process.cwd()`, aucun `--root`, aucun dry-run, aucune garde `import.meta.main` (importer le module exécute la suppression).
   Supprime `target`, `.turbo`, `.cache`, `var/runs`, `dist/tmp` (68), efface tout `*.log/.pdb/.ilk/.dmp/.dump/.tmp/.tsbuildinfo`
   hors chemins contenant `fixtures` (93), puis efface les doublons byte-exacts (> 20 Ko) dont le chemin ABSOLU contient la
   sous-chaîne `var`, `tmp`, `cache` ou `backup` (131-137 : `variant.rs`, `cache.rs`, `invariant`... correspondent). Sans git (contrairement
   à workspace-clean), ne saute que `.git node_modules target .cargo` (14). Lancé depuis `~` : supprime `~/.cache` et `~/target`.
2. `packages/infra/workspace/src/consolidation.ts:365,983,1002,1057,1066` [V mécanisme, P effet]
   L'action par défaut `inventory` réécrit `docs/migration/source-map.json` et le jumeau Python sans dry-run, sans tmp+rename, sans copie.
   Une racine absente est simplement sautée (983 `skip missing checkout`) ; l'état d'import précédent est perdu si son parsing échoue
   (1002). Or `/home/aphro/src` n'existe pas sur cette machine : 14 racines sur 15 de la carte (`sourcePath src/*`) sont absentes. Un run
   aujourd'hui réécrirait la carte de migration avec 2 racines.
3. `packages/infra/workspace/src/bun-upstream-docs.ts:67-73,96-98` [V]
   Aucun garde. Sur un clone existant : `git reset --hard FETCH_HEAD` (69) détruit tout travail local du fork. Sans `.git` :
   `rm(upstream/bun, recursive, force)` (73) supprime un répertoire importé sans historique (c'est exactement là que CLAUDE.md place
   le fork Bun, et les six autres entrées de `upstream/` n'ont pas de `.git`). `rm docs/n2b/bun` (96) sans copie.
   Pas de `--` avant `ref` (67) : un `--ref` commençant par `-` est lu comme option git.
4. `packages/infra/workspace/src/docs-consolidation.ts:1178-1183, 1353-1364` [V]
   Les chemins du plan JSON (`path`, `to`, `canonical`, `sources[].path`) passent par `join(root, …)` sans vérifier qu'ils restent sous
   `root` (aucun `startsWith`) : un `..` dans un plan fait `rename`/`unlink`/`writeFile` hors dépôt. Seule la précondition sha256 protège.
   `existsSync(to)` (1178) puis `rename` (1358) : fenêtre de course, et `rename` écrase. `writeFile` (1360, 1364) suit les symlinks
   et n'est pas atomique (tronque puis écrit). Aucune sauvegarde du fichier dirty réécrit.
5. `packages/infra/workspace/src/agent-plugin-sync.ts:16,44,78-83,98-123,151-176` [V]
   Racine par défaut `…/aphrody/aphrody-ai` (n'existe pas : 4 `..` depuis `src/` donnent la racine du monorepo, puis `aphrody-ai`) et
   `plugins/aphrody` (le plugin est à `config/ai/plugins/aphrody`) : 0 skill découvert, mais l'op écrit quand même : `rmSync` récursif
   de `<root>/plugins/.claude-plugin` (82), inscription d'un marketplace « directory » vers ce chemin inexistant dans
   `~/.claude/settings.json` (120-123, sans sauvegarde, non atomique), réécriture de `~/.gemini/config/skills.json` (151-176, `JSON.parse`
   hors `try` en 154 : crash après écritures partielles). Écrit par défaut ; `--dry-run` n'affiche que `components.json`.
   Imprime « synced the unified Aphrody plugin » (178) malgré 0 skill.

Autres gardes faibles, moindres : `scripts/assets/cdn.ts:170-171,242` (`rm -rf --out`, `--out .` efface le dossier courant) ;
`workspace-clean.ts:67` ; `pipeline-catalog.ts:115` (`root` non résolu) ; `scripts/source-sync.ts:163-186` (verrou PID avec suppression de
verrou « périmé » : course classique, ce qui contraste avec `FileLock`/flock du Rust) ; `scripts/ops/repo-sync.ts:229-244` (`git add -A` protégé
seulement par une liste de refus de noms, `sensitivePath`).

## 2. Sous-processus et entrées non fiables

Constat général [V] : le TS de `@aphrody/workspace` appelle les sous-processus en argv (jamais de chaîne shell) : `git -C`, `cargo`, `nu`,
`powershell -NoProfile`. Seuls `sh -c` sont des constantes (repository-health.ts:38-45, runtime-gate.ts:58,74 : `python -c` constant).
À garder.

Défauts de robustesse (pas de sandbox demandé) :
- `scripts/rg/inagle/pipeline/lua-pipeline.ts:97,211,226` : `execSync(\`rz-bin -z "${…file}"\`)`, `luadec-all "${srcPath}"`, `unluac "${srcPath}"`
  avec des noms de fichiers issus d'extractions de jeu : un nom contenant `"`, `$(` ou une apostrophe casse la commande ou l'exécute [V code, P déclenchement].
  Passer en `Bun.spawn([bin, path])`.
- `apps/shenron/bot/src/api/server.ts:6759` : `bash -c "cat >> ${COORD_MESSAGES}"` interpole un chemin (cwd ou `COORD_DIR`) alors que le cas voisin
  (6911-6918) passe les valeurs en arguments positionnels, avec le commentaire « ne JAMAIS réinterpoler ». Incohérence interne ; un cwd avec espace casse l'écriture.
- `packages/shenron/pipeline/src/bxc/spawn.ts` (resolveBxcPath/resolveBxcCommand) : résolution de bxc par `process.cwd()/../aphrody-web/apps/bxc/bin/bxc.mjs`,
  puis `…/aphrody-web/apps/bxc/src/cli/index.ts` (5 `..` depuis `src/bxc`, soit un dossier `aphrody-web/` à la racine du dépôt) en priorité sur le binaire
  installé, puis `~/.local/bin`, `~/bxc`, `~/.bun/bin`, `/usr/local/bin`, PATH. Chemins hérités du multi-dépôts ; l'ordre dépend du cwd et du `mtime`, sans empreinte [V].
- `packages/web/agent-browser/src/config.ts:203-209` : parmi les candidats existants, le binaire `aphrody-web` au `mtime` le plus récent gagne
  (un `target/debug` plus récent bat une release installée) [V].
- `scripts/tools/ai/scripts/bench-*.ts:30-35` : `spawnSync("bun", [fichier], { shell: true })` inutile (arguments constants).
- `scripts/rg/sauvegarde.ts:283` : commande distante construite par gabarit `ssh … ${\`rm -f … && ln -s …\`}` : les variables sont des constantes du fichier, risque faible.
- À garder : `scripts/nie/sync-main.ts` (`ssh --`, `quote()`), `scripts/shenron/sync-bxc-crawls.ts:104` (`shellQuote`), `scripts/ops/repo-sync.ts:120` (valide au lieu d'échapper).

## 3. Chaîne d'approvisionnement JavaScript

Mesures en place [V] : `bunfig.toml` = `linker=isolated`, `hoist=false`, `saveTextLockfile=true`, `minimumReleaseAge=259200` (3 jours) ; vérifié par
`bun-workspace` (bun-workspace.ts:274-295). `trustedDependencies` racine = 5 paquets (`@parcel/watcher`, `bun`, `esbuild`, `lmdb`, `msgpackr-extract`).
101 `package.json` suivis : AUCUN script `preinstall/install/postinstall/prepare` ; seulement `prepack`/`prepublishOnly` (koharu/bridge, rg/azalee, rg/inagle,
rg/patreon-bun, ui/canvas). AUCUNE dépendance git/URL/`file:`/`link:` dans les manifestes ; aucun `overrides`/`resolutions`. `bun.lock` : 3 692 paquets npm avec
intégrité sha512, 0 sans intégrité. Les dépendances git Rust sont épinglées par SHA complet (`oxc` `31d5266e…`, `hf-hub`, `tauri-specta` par tag + commit dans Cargo.lock).

Défauts :
- `bun.lock:7368` : `uWebSockets.js@github:uNetworking/uWebSockets.js#cfc9a40` (tag `v20.52.0` résolu en commit court de 7 caractères, via `@colyseus/uwebsockets-transport`,
  bun.lock:2414). Intégrité sha512 présente, mais seule dépendance non-registre du lockfile.
- `trustedDependencies` hors racine : `packages/rg/inagle/package.json` déclare `["esbuild"]` ; Bun ne lit que celui de la racine [P : comportement documenté de Bun, non reproduit ici].
- `bun-workspace` ne contrôle ni les scripts de cycle de vie, ni les dépendances git/URL, ni `trustedDependencies`/`overrides` : la politique n'est appliquée qu'à
  moitié (bunfig OK, manifestes non).
- `packages/fut/fut/package.json` : pair optionnel `@aphrody/bxc >=0.9.0` (bun.lock:661-664) hors workspace, résolu depuis le registre si installé ; `packages/rg/types`
  (pair `@rosegriffon/db ^1.0.0`) et `packages/ui/canvas` (pair `@aphrody/bun ^3.3.0`, paquet `private: true` donc jamais publié) utilisent des plages semver pour un nom interne.
  `catalog` fige `@aphrody/canvas` à `0.1.99` exact ; si la version du workspace dérive, la résolution part au registre [P].
- Noms internes : 90 paquets nommés, 45 sans `private: true` (publiables), 36 avec `publishConfig.access=public`. Portées : `@aphrody` (41, existe sur npm selon
  docs/reference/infra/GITHUB-OWNERSHIP.md), `@rosegriffon` (29), `@shenron` (9), `@fixture` (4), `@koharu` (3), `@rose-griffon` (1) : la propriété npm des portées hors
  `@aphrody` n'est pas vérifiable hors ligne. Aucun workflow actif ne publie.
- Cohérence du clone propre : `packages/ui/m3/package.json` et `m3-next-migrate/package.json` (suivis) dépendent de `@aphrody/scaffold` (`workspace:*`), mais
  `packages/ui/scaffold` et `packages/ui/web-to-tauri` ne sont PAS suivis (`git ls-files` vide) alors que bun.lock:1717-1738 les contient : `bun install --frozen-lockfile`
  échoue sur un clone propre tant qu'ils ne sont pas commités [V].
- 11 symlinks `node_modules/` sont suivis dans git (22 symlinks suivis au total), par exemple `packages/infra/workspace/node_modules/@typescript/typescript6` ->
  `node_modules/.bun/@typescript+typescript6@6.0.2/…` et `typescript-compiler-api` -> `typescript@5.9.3`, alors que le catalogue épingle TypeScript 7.0.2 et que
  `@aphrody/workspace` dépend de `@typescript/typescript6 ^6.0.2` (packages/infra/workspace/package.json) : trois versions de TypeScript, liens dépendants d'un store local [V].
- Paquet global `@aphrody/bxc@0.9.15` (consommé par shenron/pipeline) : `scripts/postinstall.ts` (203-244) télécharge le binaire Lightpanda « nightly » depuis GitHub et
  `src/native/install.ts:313-316` télécharge curl-impersonate, sans aucun contrôle de hash/signature (grep sha256/checksum/integrity/verify : 0 occurrence) ; surcharges
  `LIGHTPANDA_DOWNLOAD_URL`/`LIGHTPANDA_RELEASE_TAG`. Les versions globales `@aphrody/x 1.2.5` et `xai 1.1.5` retardent sur le monorepo (1.3.0 / 1.1.6) [V].
- `scripts/aphrody/vps-setup-all.sh:177,188,195` : `curl … | sh` pour rustup, `curl https://bun.sh/install | bash` et uv, versions non épinglées (le Bun du VPS n'est donc pas le
  1.4.2 de `packageManager`) ; `scripts/setup.nu:17`, `scripts/tools/ui/drive/scripts/setup.ps1:238` idem [V].
- `scripts/ops/purge-attribution.ts:113` : `uvx --from git-filter-repo` sans version ni hash ; `scripts/iecode/publish-rust-crates.sh:14-19` : `cargo publish --locked --allow-dirty`
  (publication irréversible d'un état éventuellement non commité, sans mode essai) [V].
- Rust : `crates.io` 1 962 paquets, 32 git, 184 chemins (metadata-after.json). Aucun `deny.toml`, `supply-chain/` ni `.cargo/audit.toml` suivis ; `cargo-deny` et `cargo-audit` sont
  installés dans `~/.cargo/bin` mais sans configuration : l'agent `cargo-auditor` demande un `deny.toml` obligatoire qui n'existe pas [V].

## 4. CI (GitHub Actions)

Un seul workflow est actif : `.github/workflows/rg-migration.yml`. GitHub ne lit que `.github/workflows/`, `.github/dependabot.yml` et `.github/CODEOWNERS` ; tout ce qui est sous
`.github/rg/` et `.github/shenron/` (6 workflows, 2 dependabot, 2 CODEOWNERS, 2 modèles) est INERTE [V].

Workflow actif (rg-migration.yml:1-43) : `pull_request` (pas `pull_request_target`, donc pas de secrets pour les forks : correct) ; aucun bloc `permissions` (jeton aux droits par défaut du dépôt) ;
`actions/checkout@v4` et `oven-sh/setup-bun@v2` épinglés par tag (pas de SHA) ; `persist-credentials` par défaut ; `bun install --frozen-lockfile` sans `--ignore-scripts` (les 5 paquets de confiance
s'exécutent) ; filtre `paths` limité à RG/infra/workspace : une PR qui ne touche que `crates/**` n'est contrôlée par rien ; ni `cargo`, ni `gitleaks`, ni `cargo deny`. `bun-version: 1.4.2` (stable), alors
que CLAUDE.md annonce un Bun canary/nightly épinglé.

Défauts latents dans les workflows inertes (à corriger avant de les déplacer sous `.github/workflows/`) :
- `.github/shenron/workflows/release.yml:74` : `TAG="${{ github.event.inputs.tag || github.ref_name }}"` dans un `run:` (injection de gabarit : un nom de tag peut contenir `$(…)`, `;`).
  `permissions: contents: write` au niveau workflow (12-13), donc aussi pour le job de build ; `oven-sh/setup-bun@v2` sans `bun-version` (30) ; `softprops/action-gh-release@v3` par tag (90).
- `update-deps.yml:121-123,146-148,174` : `bun update` puis `bun run test` avec `contents: write` + `pull-requests: write` (du code de dépendances fraîches s'exécute avec un jeton d'écriture) ;
  `peter-evans/create-pull-request@v8` par tag.
- `aphrody-ci.yml:15` : `uses: aphrody-code/aphrody-infra/.github/workflows/aphrody-reusable-ci.yml@main` (branche mutable d'un autre dépôt).
- `site-artifact.yml` : bonnes pratiques (permissions read, `persist-credentials: false`, retention 7 j, sidecar sha256) mais le sidecar voyage dans le même artefact (pas d'attestation) ; `environment: production`
  avec `secrets.SITE_BUILD_DATABASE_URL` (208) sur un `workflow_dispatch`.
- `codeql.yml` : JS/TS seulement, correct mais inerte.

## 5. Hooks de plugins d'agents (inventaire, sans prescription de sandbox)

Inventaire [V] : zéro `hooks.json`, zéro `PreToolUse/PostToolUse/SessionStart/matcher` dans `config/ai/plugins/**`, `plugins/**`, `.claude*`, `.codex*` (grep). Le plugin `aphrody`
(`config/ai/plugins/aphrody`) ne contient que `agents/`, `skills/`, `schemas/`, `yolo.json`. `.claude/shenron/settings.json` et `.codex/rg/config.toml` ne sont pas aux chemins que les CLI chargent
(`.claude/settings.json`, `.codex/config.toml`) : inertes ; le premier désigne `C:\Users\aphro\src\aphrody-os` (chemin Windows de dépôt disparu). `plugins/rose-griffon/.mcp.json` = `{"mcpServers": {}}`.
`~/.claude/settings.json` : aucun hook, aucun plugin `aphrody` activé (la sync n'a donc pas tourné ou a été défaite). Les hooks réels (agy : `aphrody agy-loop hook`, `SessionStart`) vivent dans
`~/.gemini/config/plugins/aphrody/hooks.json`, hors dépôt (docs/reference/ai/agy-cli/aphrody-agy-map.md:198-210). Conclusion : ouvrir ce dépôt n'exécute aucun hook ; l'autorité des hooks installés est
voulue (YOLO). Seul constat de fiabilité : `agent-plugin-sync` est cassé (BC-06).

Règles `.coord` (AGENTS.md) : `FileClaim` (crates/os/a2a-coord/src/claims.rs:25-52) prend des verrous `flock` hex-encodés par composant (ancêtres partagés, feuille exclusive), rejette `..` et symlinks :
conception correcte. Limites de fiabilité : (a) seul `aphrody a2a invoke --claim` (apps/cli/src/commands.rs:258-265) les prend ; AUCUNE op de `@aphrody/workspace` (consolidation, docs-consolidate,
pipeline-catalog…) ne consulte les claims [V : grep `claims/locks` dans workspace/src = 0] ; (b) `.coord/claims/*.json` est de la prose libre à propriétaire auto-déclaré (`"owner": "claude (…)"`) ;
(c) comparaison de composants sensible à la casse : deux casses d'un même dossier donnent deux verrous (DrvFs/Windows/macOS) [P] ; (d) `.coord/` est dans .gitignore (`/.coord/`, `**/.coord/`) : état non versionné.

## 6. Secrets

[V] Rien de réel dans l'arbre ni l'historique récent.
- `.env` racine : NON suivi (`.gitignore:89`), mode 0600 ; contient 16 noms de variables dont des CHEMINS vers des JSON de crédentiels (valeurs non lues). `.env.example` seul suivi.
- `git grep` des motifs `AKIA…`, `ghp_`, `github_pat_`, `xox[baprs]-`, clés privées PEM, `AIza…`, `sk-ant-`, `glpat-`, `npm_…`, jeton Discord : 4 fichiers, tous des fixtures/exemples
  (`crates/ai/messaging/src/channels/slack.rs:481,484` `xoxb-test…` ; `crates/infra/infra/src/secrets/scanner.rs:206` ; `crates/os/drive/core/src/crypto/cloud_credentials.rs:380` `AKIA…EXAMPLE` ;
  `docs/guides/discord/apps/guide/content/docs/legacy/preparations/app-setup.mdx:38` exemple de doc).
- `git log --all --pickaxe-regex -S…` sur 169 commits : 3 commits (`da1830a1`, `827bf08a`, `d406f11b`), les mêmes fixtures.
- JSON de config (134 fichiers examinés) : 27 clés au nom évocateur, toutes de la prose de politique ou des empreintes sha256 ; `config/secrets.template.json` contient des valeurs chiffrées `ENC[…_GCM,data:…]`.
- `.gitignore` couvre `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.sqlite*`, `*.db`, `/secrets/`, `/cookies/`, `/.npmrc`, `.claude/settings.local.json`.
- Observations de modes (fiabilité, pas d'action de sandbox) : `ai.json` en 0777 et `host/` en 0777 à la racine du dépôt (WSL/DrvFs probable).
- Aucun `gitleaks`/`trufflehog` actif : `config/rg/.gitleaks.toml` et `docs/rg/root/.gitleaks.toml` existent mais aucun workflow actif ne les appelle.

## 7. Fork Bun et `bun:aphrody` : emplacement, épinglage, confiance

Constats [V] :
- Le fork n'est pas dans le dépôt : `upstream/` = `mcp-server-tauri`, `simdutf-rio`, `tauri-driver`, `tauri-plugin-dialog`, `tauri-plugin-webdriver`, `victauri`, sans `.git` (aucun gitlink, pas de `.gitmodules`).
  CLAUDE.md : « Keep Bun, Oxc and other upstream forks in `upstream/` with pinned revisions » : non tenu. Oxc est consommé en dépendance git épinglée par SHA (Cargo.toml:40-44, 214-217).
- Le fork est censé vivre à `/home/aphro/src/bun` (docs/migration/BUN-FORK-UNIFIED-NATIVE.md:49-83) : `/home/aphro/src` n'existe pas sur cette machine ; la carte de migration (`source-map.json`, `observedAt`
  2026-09-29T13:59:45Z) liste `bun upstream-pinned a2671046` et `oxc 31d5266e` à `src/bun`, `src/oxc` : absents.
- Le Bun réellement utilisé : `~/.bun/bin/bun`, 79 500 640 octets, version 1.4.2, sha256 `a83d2637 67d839e4 d2649ca8 e35d07159 c7afc99a fc96d731 ced29e05 6dda0c` (concaténé : `a83d263767d839e4d2649ca8e35d07159c7afc99afdc96d731ced29e056dda0c`), build-id
  `5afca2666bfab860…`. `grep -c "bun:aphrody"` = 0 et `APHRODY_FFI_LIB` absent : c'est un Bun amont, PAS le fork. Aucun hash de binaire Bun n'est consigné dans le dépôt.
- Épinglage : `config/bun-fork.json` pointe `main` = `a2671046…` (module v1, `moduleTestsPassed: 8`), alors que le changement agrégé que les docs invoquent (14 tests, `APHRODY_FFI_LIB` unique) est le commit `0ba45879` de la branche
  `claude/aphrody-unified-ffi` (PR brouillon, BUN-FORK-UNIFIED-NATIVE.md:5-9). Aucun code ne lit `config/bun-fork.json` (`git grep` : références seulement dans PLAN.md et des JSON de migration) : épinglage sans vérification.
- Dérive documentaire : BUN-FORK-UNIFIED-NATIVE.md:23,70,72,84 renvoie à `packages/bun/aphrody/…` ; `packages/bun/` ne contient que `test-dom`. Le chargeur est `packages/interop/native` (paquet `@aphrody/bun`, `private: true`).
  Commande de reproduction (84) : chemins `/home/aphro/src/bun/build/debug/bun-debug` et `target/debug/libaphrody_ffi.so` (1,9 Go) absents ou non reproductibles ici.
- Preuve CI du fork : « lint et types seulement » (BUN-FORK-UNIFIED-NATIVE.md fin) ; aucun artefact multi-plateforme, aucune somme de contrôle de binaire fork, aucune signature.
- Confiance dans le chargeur natif (packages/interop/native/src/native-artifact.ts:177-200, library.ts:294-352) : `manifest.json` placé à côté du `.so`, sha256 du `.so` comparé à celui du manifeste ; le hachage et `dlopen(path)` sont deux
  ouvertures distinctes du chemin ; avec `APHRODY_FFI_DEV=1`, un `APHRODY_FFI_LIB` sans manifeste n'est pas vérifié (native-artifact.ts:183-186). BUN-NATIVE-PACKAGE.md reconnaît lui-même : « internal artifact consistency,
  not publisher authentication » : l'énoncé est exact ; ne pas le citer comme une chaîne de provenance.
- `.env` : Bun charge automatiquement `.env*` du cwd ; un `APHRODY_FFI_LIB` + `APHRODY_FFI_DEV=1` dans un `.env` suffit à changer la bibliothèque chargée [P, mécanisme documenté de Bun].
- `packageManager bun@1.4.2` / `engines.bun >=1.4.2` / CI `bun-version: 1.4.2` : cohérents entre eux ; CLAUDE.md dit « pinned Bun canary/nightly » : écart de formulation.

## 8. Briques existantes à réutiliser (toutes « à évaluer » ; licences déclarées à confirmer, non vérifiables hors ligne)

| Besoin | Brique | Licence déclarée | Dans Cargo.lock ? | Remplace |
|---|---|---|---|---|
| Politique crates (licences, sources, bans, advisories) | `cargo-deny` (déjà dans `~/.cargo/bin`, aucune config suivie) | MIT OR Apache-2.0 | non (outil) | `deny.toml` absent ; scripts de vérification maison |
| Advisories RustSec | `cargo-audit` (installé) | Apache-2.0 OR MIT | non (outil) | idem |
| Audit humain des dépendances | `cargo-vet` | Apache-2.0 OR MIT | non (outil) | absent |
| Âge minimal des crates | Renovate `minimumReleaseAge` (ou équivalent) | AGPL-3.0 (service/app GitHub) | n/a | l'asymétrie de tauri-sync (npm 3 j, crates 0 j) |
| Analyse statique des workflows | `zizmor` | MIT | n/a | détecte `release.yml:74`, tags non épinglés, jetons trop larges |
| Épinglage d'actions par SHA | Renovate `pinGithubActionDigests`, `pin-github-action`, `ratchet` | variables | n/a | tags `@v4`/`@v2` |
| Lint de workflows | `actionlint` | MIT | n/a | — |
| Secrets (arbre + historique + hook) | `gitleaks` (config RG déjà présente, inerte) ; `trufflehog` (AGPL-3.0, à lire avant adoption) | MIT ; AGPL-3.0 | n/a | `sensitivePath` de repo-sync.ts |
| Vulnérabilités JS + Rust | `osv-scanner` ; `bun audit` | Apache-2.0 ; n/a | n/a | — |
| Scripts d'installation Bun | `[install.security] scanner` de Bun (API de scanner) ou une règle ajoutée à `bun-workspace` | n/a | n/a | contrôle manquant des cycles de vie / dépendances git |
| Attestation de binaire | attestations d'artefacts GitHub / `cosign` ; `SHASUMS256` des releases Bun | Apache-2.0 | n/a | manifeste auto-attesté de `bun-native` |
| Doublons et nettoyage | `git clean -ndX` (essai), `cargo-sweep`, `kondo`, `fclones` | — / Apache-2.0 / MIT / MIT | n/a | `winclean_maintenance_workflow.ts` (dédoublonnage par sous-chaîne) |

Ce qui est de l'enrobage d'un outil externe et ce qui est natif first-party (côté cet axe) : `@aphrody/workspace` est de l'orchestration TypeScript autour de `git`, `cargo`, `bun`, `nu`, `ssh` et du binaire Rust `aphrody-infra`
(enrobage) ; la logique d'inventaire/migration (hashs, cartes, imports `wx`) est first-party. `bun:aphrody` n'existe sur cette machine que comme documentation : aucun binaire fork n'est présent.

## 9. Constats classés (≤ 15)

| ID | Sév. | chemin:ligne | Constat | Preuve |
|---|---|---|---|---|
| BC-01 | HAUTE | packages/os/winclean/winclean_maintenance_workflow.ts:12,68,93,131-137 | Maintenance destructive au cwd, sans dry-run ni `--root` ni git, exécutée à l'import ; suppression de « doublons » par sous-chaîne `var/tmp/cache/backup` du chemin absolu | [V] lecture intégrale ; effet [P] |
| BC-02 | HAUTE | packages/infra/workspace/src/consolidation.ts:365,983,1002,1057,1066 | `consolidation` (action par défaut) réécrit source-map.json (26 Mo) sans garde ; racines manquantes sautées ; 14/15 racines absentes aujourd'hui | [V] mécanisme, `ls /home/aphro/src` absent |
| BC-03 | HAUTE | config/bun-fork.json:1-24 ; docs/migration/BUN-FORK-UNIFIED-NATIVE.md:5-9,23,70,84 ; CLAUDE.md | Fork Bun absent (ni `upstream/bun` ni `~/src/bun`), Bun hôte = amont 1.4.2 sans `bun:aphrody`, épinglage sur `main` (pas `0ba45879`), jamais lu par un gate, chemins de doc morts | [V] `grep -c bun:aphrody`=0, listing |
| BC-04 | HAUTE | packages/infra/workspace/src/bun-upstream-docs.ts:67-73,96-98 | `reset --hard` + `rm -rf upstream/bun` sans dry-run ; `--ref` sans `--` | [V] |
| BC-05 | MOYENNE | packages/infra/workspace/src/docs-consolidation.ts:1178-1183,1353-1364,1791-1796 | Chemins de plan non confinés, `writeFile` suit les symlinks et non atomique, `rename` écrase ; `--apply <fichier>` n'est pas l'écriture (`--write` l'est) | [V] |
| BC-06 | MOYENNE | packages/infra/workspace/src/agent-plugin-sync.ts:16,44,82,120-123,151-176,178 | Op cassée (racine `aphrody-ai`, `plugins/aphrody` obsolètes) qui écrit par défaut dans `~/.claude` et `~/.gemini` sans sauvegarde et annonce un succès à 0 skill | [V] |
| BC-07 | MOYENNE | packages/infra/workspace/src/tauri-sync.ts:533,586,698-700 ; config/tauri-upstream.json (gate) | npm en quarantaine 3 j, crates.io appliquées au plus récent sans âge ; le gate lance `bun install` puis `cargo check` (build.rs de versions fraîches) ; `restore` ne retire pas les fichiers créés | [V] |
| BC-08 | MOYENNE | .github/workflows/rg-migration.yml:1-43 ; .github/{rg,shenron}/ | 1 seul workflow actif (RG seulement, sans `permissions`, actions par tag) ; 6 workflows + dependabot + CODEOWNERS inertes ; défauts latents (release.yml:74, update-deps.yml:121-148, aphrody-ci.yml:15) | [V] |
| BC-09 | MOYENNE | package.json (trustedDependencies) ; bun-workspace.ts:274-295 ; bun.lock:7368,661-664 | Politique Bun appliquée à moitié (bunfig vérifié, cycles de vie/URL/`trustedDependencies` non) ; dépendance github `uWebSockets.js` à commit court ; pair `@aphrody/bxc` hors workspace | [V] |
| BC-10 | MOYENNE | packages/ui/m3/package.json ; packages/ui/scaffold (non suivi) ; packages/infra/workspace/node_modules/* (suivis) | Clone propre : `@aphrody/scaffold` et `web-to-tauri` non suivis mais dépendus ; 11 symlinks `node_modules` suivis vers TS 5.9.3/6.0.2 alors que le catalogue dit 7.0.2 | [V] `git ls-files` |
| BC-11 | MOYENNE | ~/.bun/install/global/node_modules/@aphrody/bxc/scripts/postinstall.ts:203-244 ; scripts/aphrody/vps-setup-all.sh:177,188,195 ; scripts/ops/purge-attribution.ts:113 ; scripts/iecode/publish-rust-crates.sh:14-19 | Téléchargements d'exécutables sans hash (Lightpanda nightly, curl-impersonate), `curl \| sh` non épinglés (Bun, rustup, uv), `uvx` non épinglé, `cargo publish --allow-dirty` | [V] |
| BC-12 | MOYENNE | apps/shenron/bot/src/api/server.ts:6741-6759,6799-6804,6921 ; apps/shenron/bot/src/api/request-guards.ts:94-112 | Pont A2A du bot : écriture `.coord` sans jeton par défaut (`SHENRON_A2A_ENFORCE` inactif), `/tmp/dbfr-tasks.lock` et `/tmp/.coord-tasks.tmp` prévisibles, `bash -c` interpolé, regex `/apps/bot` obsolète (monorepo : `apps/shenron/bot`) | [V] ; exposition réelle [P] |
| BC-13 | BASSE | packages/interop/native/src/native-artifact.ts:177-200 ; library.ts:350-352 | Attestation auto-hébergée à côté de l'artefact, hash puis `dlopen` en deux temps, sans vérification sous `APHRODY_FFI_DEV=1` ; la doc l'admet | [V] |
| BC-14 | BASSE | packages/infra/workspace/src/workspace-repair.ts:34 ; ops.ts:334-348 ; runtime.ts:26-50 ; bun-docs.ts | `workspace-repair` cible un script et un dépôt disparus ; toute op inconnue est relayée à `aphrody-infra` (binaire pris dans `~/.local/bin` puis PATH sans hash) ; `bun-docs --check` dépend du site distant | [V] |
| BC-15 | BASSE | scripts/rg/inagle/pipeline/lua-pipeline.ts:97,211,226 ; scripts/assets/cdn.ts:170-171 ; scripts/source-sync.ts:163-186 | Commandes `execSync` à chaîne avec noms de fichiers, `rm -rf --out`, verrou PID avec course de suppression | [V] code |

## 10. Correct et à garder

`spaceui-icons --prune` (plan par défaut, manifeste + sha256 + `safeRelativePath`) ; `bun-native` (publication tmp + rename, sha256, smoke avant publication) ; imports `infra-*`/`source-licenses` (`wx`/`COPYFILE_EXCL`,
préflight HEAD) ; `workspace-clean` (git-aware, dry-run, symlinks sautés) ; `tauri-sync --apply` (snapshot + restauration, refus si patch cassé) ; `agent-home` (sauvegarde `.before-agent-home-*`) ; `agent-live` (tmp + rename,
0600) ; `scripts/atomic-deploy-bundle.sh` (root, `realpath` confiné à `bundles/`, `SHA256SUMS`, épinglage du commit infra, restauration ordonnée) ; `.coord` `FileClaim` (verrous OS) ; `minimumReleaseAge=259200` ;
dépendances git Rust épinglées par SHA ; `pull_request` (pas `_target`) dans le workflow actif ; absence totale de scripts de cycle de vie dans les 101 manifestes ; aucun secret réel détecté.

## 11. Cinq recommandations priorisées (sans sandbox ni confirmation)

1. Supprimer ou réécrire `winclean_maintenance_workflow.ts` : mêmes règles que `workspace-clean` (git, dry-run, `--apply`, `--root`, correspondance par segment de chemin, pas par sous-chaîne) ou la remplacer par `git clean -ndX` + `fclones`/`cargo-sweep` ; ajouter `import.meta.main`.
2. Geler `consolidation`/`bun-upstream-docs` : `--apply` + écriture tmp+rename + copie `.bak` de source-map.json, abandon si `missingRoots` non vide ; la migration étant faite, déclarer ces ops « archivées » dans l'aide. Corriger le défaut `rm -rf upstream/bun` (exiger `.git`, `--` avant `ref`).
3. Intégrité Bun : consigner dans `config/bun-fork.json` le commit réellement requis (`0ba45879` ou son merge), le sha256 du binaire Bun/fork et du `.so`, faire lire ce fichier par `bun-workspace`/`runtime-versions`, corriger les chemins `packages/bun/aphrody` des docs, et dire explicitement que l'hôte exécute un Bun amont.
4. CI et chaîne JS/Rust : activer sous `.github/workflows/` une CI qui lance `cargo deny`, `gitleaks`, `zizmor` et `bun audit`, avec `permissions: contents: read` et actions épinglées par SHA ; ajouter à `bun-workspace` les contrôles manquants (cycles de vie, dépendances git/URL, `trustedDependencies`) ; aligner `tauri-sync` sur l'âge minimal pour les crates.
5. Réparer la reproductibilité du clone propre : commiter `packages/ui/scaffold` et `web-to-tauri`, retirer les 11 symlinks `node_modules` suivis, épingler `uWebSockets.js` et `@aphrody/bxc`, remplacer les `curl | sh` par des versions + sommes de contrôle, et mettre `agent-plugin-sync`/`workspace-repair` en conformité avec la disposition actuelle ou les retirer.

## 12. NON EXAMINÉ

- Toute exécution : aucun `bun test`, `bun install`, `--apply`, cargo, workflow ; les effets BC-01, BC-02, BC-04 sont déduits du code.
- Ops de `ops.ts` non lues en détail : monorepo-gate, runtime-gate (hors 50-104), ai-release-gate, ui-verify, desktop-smoke, docs-links, docs-overlaps, windows-paths, gitignored-audit, vendor-license-audit, monorepo-audit,
  repository-health, repository-state, stack-dedup (sauf spawn/--out), ui-dedup-manifest, spaceui-to-m3, spaceui-icons (début), iecode-doctor, koharu-release, web-to-tauri/scaffold (spawnés), discord.ts, shenron.ts, cargo-boundaries,
  imports-exports, bun-reference, drive-upstream-audit, submodule-inventory (détail), automation-inventory, powershell-syntax.
- `packages/ai` (hors drive-sync), `packages/discord`, `packages/fut`, `packages/rg`, `packages/koharu`, `apps/koharu/editor`, `apps/rg/{bot,website}`, `apps/shenron/site` : balayage grep (spawn, eval, rm) seulement ; `packages/fut/fut/src/extension/pageHook.ts:365` contient un `eval(code)` non analysé.
- `scripts/` hors extraits cités : `scripts/build/**`, `scripts/dev/**`, `scripts/migration/**`, `scripts/release/**`, `scripts/tools/**` lus par grep ; `atomic-deploy-{shenron,rg,aphrody-*}.sh`, `provision-*.sh`, `install-vps-adapter.sh` non lus (seul `atomic-deploy-bundle.sh` 1-160).
- `patches/*.patch` : en-têtes seulement (le patch `tauri-plugin-mcp-bridge` de 50 Ko n'est pas relu) ; `upstream/*` : listing seulement.
- Propriété réelle des portées npm (`@rosegriffon`, `@koharu`, `@shenron`) et du dépôt `aphrody-code/oxc` : non vérifiable hors ligne. Contenu des paquets `@aphrody/*` publiés sur le registre : seule la copie globale `@aphrody/bxc@0.9.15` a été lue.
- Version et licence exactes des briques du §8 : déclarées de mémoire, non vérifiées ; présence dans `Cargo.lock` non applicable (outils externes).
- `docs/migration/*.json` : empreintes comptées (48 fichiers sur 70 contiennent du sha256) mais non recalculées ; aucune vérification que les cibles correspondent aux hash enregistrés.
- `bun.lock` : analysé par regex (3 693 entrées), pas de résolution complète ; scripts de cycle de vie des dépendances transitives (esbuild, lmdb, msgpackr-extract, @parcel/watcher) non lus.
- `~/.npmrc`, `~/.ovh.conf`, `~/.bash_secrets`, `~/.shenron-neon.env` : volontairement non lus.
- `kernel-client` : relu ; le repli `/tmp/aphrody-os-<user>.sock` et l'absence de contrôle de propriétaire sont déjà OS-03 (vague 1) ; dans la doctrine YOLO (domaine de confiance mono-utilisateur) ils ne sont pas repris ici.
