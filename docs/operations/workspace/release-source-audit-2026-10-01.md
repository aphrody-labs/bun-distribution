<!-- SPDX-License-Identifier: Apache-2.0 -->
# Préparation des releases et transferts — 2026-10-01

## Portée et niveau de preuve

Ce rapport décrit le checkout Aphrody observé le 2026-10-01 et les contrôles
rejoués pendant cette correction. Les sources de vérité sont les manifests,
les scripts du checkout, les métadonnées Cargo fournies par l'intégrateur,
la configuration de l'hôte et les API GitHub/crates.io. Les états de publication
et les nombres de fichiers modifiés sont des instantanés ; les autres agents
peuvent les faire évoluer.

La correction de ce lot ajoute un audit reproductible à
[`@aphrody/workspace`](../../../packages/infra/workspace/README.md) et rectifie
ce rapport. Elle ne modifie pas les manifests Cargo, les lockfiles, les sources
amont, les bootstraps ou les dépôts distants. Les travaux antérieurs présents
dans le checkout ne sont pas tous commités ou publiés.

Context7 a été consulté pour Cargo : manifeste, dépendances de plusieurs
origines et résolution SemVer. Le skill `aphrody:rust-best-practices-2026`
a servi de checklist ; son snapshot de mai ne remplace pas la configuration
actuelle. Le pin du dépôt est Rust **1.98.1**, le `rust-version` hérité **1.97**,
l'édition héritée **2024** et le resolver **3**. Le wrapper global `sccache`
est configuré ; les règles du dépôt imposent le wrapper Cargo sérialisé.

## Changements présents dans le checkout et sur l'hôte

- [`config/system-packages.json`](../../../config/system-packages.json) déclare
  nextest, deny, audit, machete, expand, hack, zigbuild, xwin et cargo-update.
  Les bootstraps [`Bash`](../../../scripts/bootstrap.sh) et
  [`PowerShell`](../../../scripts/bootstrap.ps1) passent par **cargo-binstall**
  pour ces outils ; Cargo compile cargo-binstall seulement s'il manque.
- Les bootstraps acceptent `--canary` / `-Canary` pour ajouter nightly et des
  targets. Ils synchronisent le workspace Python voisin lorsqu'il existe.
  Une installation Linux/Windows complète depuis un clone propre n'est pas
  démontrée par la lecture de ces scripts.
- [`cargo-serial.sh`](../../../scripts/build/rust/cargo-serial.sh) garde les
  messages de verrou hors stdout. Le wrapper
  [PowerShell](../../../scripts/build/rust/cargo-serial.ps1) emploie un mutex
  Windows ; les deux limitent les jobs à six et désactivent l'incrémental.
  Le verrou Windows et le verrou WSL ne sont pas un verrou partagé entre OS.
- [`channel-cargo.sh`](../../../scripts/build/rust/channel-cargo.sh) sélectionne
  le pin de `rust-toolchain.toml` pour `stable`, et le canal mobile `nightly`
  pour `canary`, puis délègue au wrapper commun. Cela ne définit pas encore
  les versions de crates, les tags ou la promotion stable/canary.
- Le [timer utilisateur](../../../config/systemd/user/aphrody-rust-update.timer)
  est actif ; prochaine échéance observée : **2026-10-05 00:55:54 CEST**.
  Son script appelle `rustup update stable nightly` puis le wrapper Cargo pour
  `+stable install-update --all`. Il conserve les lockfiles du workspace,
  les pins Bun/uv et le pin Rust du dépôt. Mettre à jour le canal `stable`
  n'actualise pas automatiquement le pin **1.98.1**.
- L'inventaire `~/.cargo/.crates.toml` et les exécutables confirment
  cargo-expand **1.0.126**, cargo-hack **0.6.45**, cargo-zigbuild **0.23.4**,
  cargo-xwin **0.23.1**, cargo-update **22.1.1**. Leur présence ne prouve pas
  une compilation croisée ou la disponibilité de chaque SDK/linker cible.

Le [guide cross-build](rust-toolchains-and-cross-builds.md) décrit les outils
et les étapes de qualification ; il ne constitue pas un résultat de build.

## Audit Cargo reproductible

L'intégrateur a rejoué `cargo metadata --no-deps --format-version 1` via le
wrapper avec succès. L'audit courant retrouve les observations suivantes :

| Observation | Nombre | Interprétation |
| --- | ---: | --- |
| Membres Cargo actifs | 184 | Le nombre 186 du plan racine est un autre instantané. |
| Membres autorisant crates.io par leur politique `publish` | 184 | Aucun `publish = false` ni restriction excluant crates.io. |
| Dépendances par chemin | 481 | Arêtes directes, tous kinds et targets ; pas des crates uniques. |
| Dépendances Git | 20 | Arêtes directes ; toutes sans version de repli registry. |
| Dépendances par chemin avec exigence `*` | 275 | 271 normal/build et 4 dev. |
| Arêtes normal/build path ou Git sans version registry | 291 | 271 path + 20 Git ; publication à corriger. |
| Arêtes par chemin extérieures au checkout | 1 | `aphrody-tauri-wrap` → `tauri-plugin-mcp-bridge`. |
| Groupes de dépendances registry à intervalles caret disjoints | 7 | Migration d'API à qualifier avant uniformisation. |

Les 148 suppressions de `publish = false` ont été appliquées précédemment.
**Correction du précédent rapport : `publish = true` est accepté par le Cargo
installé**, et apparaît dans 30 manifests actifs acceptés par les métadonnées.
L'absence du champ autorise aussi la publication par défaut. Ce champ ne prouve
ni le packaging, ni la disponibilité des versions sur crates.io, ni un upload.
La [documentation Cargo](https://doc.rust-lang.org/cargo/reference/manifest.html#the-publish-field)
décrit les restrictions `false` et les listes de registries ; le comportement
`true` est confirmé par l'outil installé, pas déduit de l'absence d'un exemple.

Le chemin externe est
`../source/mcp-server-tauri/packages/tauri-plugin-mcp-bridge`.
Le clone et son pin doivent rester inventoriés dans
[`config/upstream-sources.json`](../../../config/upstream-sources.json).
Cargo permet de garder une source path/Git en développement **avec une version
registry compatible** servant au packaging. Un simple remplacement du chemin
par Git ne règle pas la publication ; chaque version de repli doit réellement
exister sur crates.io. Les dev-dependencies suivent une exemption distincte.
[Contrat Cargo](https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html#multiple-locations).

Commande d'audit sans installation, publication ou commande Cargo implicite :

```bash
scripts/build/rust/cargo-serial.sh metadata --no-deps --format-version 1 > /tmp/cargo-metadata.json
bun packages/infra/workspace/src/ops.ts cargo-release-audit --metadata /tmp/cargo-metadata.json --out /tmp/cargo-release-audit.json
bun packages/infra/workspace/src/ops.ts cargo-release-audit --metadata /tmp/cargo-metadata.json --check --out /tmp/cargo-release-gate.json
```

Le JSON conserve propriétaires, chemins, kinds, exigences, sources Git,
versions locales candidates et SHA-256 des manifests lus. Les comparaisons de
versions séparent les registries. `--check` contrôle uniquement ces déclarations
et retourne **1 attendu** pour les blocages détectés actuellement. Le rapport
marque toujours `resolutionVerified: false` et `publicationVerified: false` :
une sortie 0 ne constitue pas un feu vert de publication. Les exigences
complexes ou prerelease restent à qualifier ; les versions workspace héritées
d'une dépendance externe ne reçoivent pas de suggestion automatique.
Régénérer les métadonnées après chaque changement de manifest.

## Blocages de résolution et d'alignement

Le contrôle **courant** `cargo metadata --locked` a échoué en ligne sur
`serde-saphyr 0.0.16` → `regex >=1.0,<1.13`, face à `regex 1.13.1` verrouillé
pour `aphrody-infra` avec l'exigence `^1.11`. Cette erreur ne démontre pas que
`^1.11` exige 1.13 ; c'est la sélection verrouillée qui est incompatible.
Le contrôle offline échoue faute de l'entrée d'index `cached_proc_macro` ;
cet échec offline ne constitue pas une seconde preuve du conflit regex.

Les sources amont consultées confirment toutefois une seconde borne :
OXC, au commit `31d5266e150ff17af52f0c2fc798cc27dc9a5a59`, fait dépendre
`oxc_linter` de `lazy-regex ^3.6.0`. Les manifests téléchargés et l'API crates.io
de **lazy-regex 3.6.1** et **lazy-regex-proc_macros 3.6.1** déclarent `regex ^1.13`.
Mistral.rs au commit `3f2515e9b5adc2ac44949c128c50a13b15721294` déclare
`serde-saphyr ^0.0.16` ; l'API crates.io confirme sa dépendance normale
`regex >=1.0,<1.13`. Ces bornes ne se recouvrent pas et Cargo cherche à unifier
les versions compatibles de regex. Un pin global 1.12 ne règle donc pas ce
graphe si lazy-regex 3.6.1 est conservé.
[serde-saphyr](https://crates.io/api/v1/crates/serde-saphyr/0.0.16/dependencies),
[lazy-regex](https://crates.io/api/v1/crates/lazy-regex/3.6.1/dependencies),
[proc-macros](https://crates.io/api/v1/crates/lazy-regex-proc_macros/3.6.1/dependencies),
[résolveur Cargo](https://doc.rust-lang.org/cargo/reference/resolver.html#version-requirements).

Les sept groupes directs à intervalles disjoints sont `aes 0.8/0.9`,
`aes-gcm 0.10/0.11`, `getrandom 0.2/0.4`, `pollster 0.4/1.0`,
`sha1 0.10/0.11`, `sha2 0.10/0.11` et `tokio-tungstenite 0.24/0.26`.
Pour les versions 0.x, changer le minor peut rompre la compatibilité Cargo.
La présence de plusieurs versions incompatibles n'est pas automatiquement une
erreur de résolution : Cargo peut les conserver séparément. Leur alignement
requiert la migration des consommateurs et la conservation des features.
[Contraintes Cargo](https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html#version-requirements).

Les 18 autres groupes divergents ont des intervalles caret compatibles.
L'audit calcule le minimum déclaré commun (par exemple Tokio 1.53.1,
serde_json 1.0.151 et slotmap 1.1.1), sans prétendre qu'il s'agit de la dernière
version publiée ou d'un upgrade testé. Ils peuvent être centralisés dans
`[workspace.dependencies]` en préservant `features`, `default-features`,
renommages et conditions cible, puis validés par l'intégrateur.

## Git, forks et packages Bun

- HEAD local observé : `ac7ac965a72c46e03e11eb4d0a78b37eed262137` ; aucun remote
  local configuré. L'API confirme `aphrody-code/aphrody` privé, branche `main`
  à `4cb90e09eaaa4d854b35563b373686355c21d905`. `git rev-list` entre ces deux
  SHA confirme **205 commits locaux seuls et 710 distants seuls**. Les nombres
  de chemins modifiés évoluent pendant le travail partagé ; l'ancien total
  274 est périmé. Le worker n'a effectué ni commit ni push ; l'intégration Git
  de l'audit est distincte de la préparation d'une release.
- La métadonnée repository racine vise `aphrody-labs/aphrody` ; l'API authentifiée
  renvoie **404** pour ce nom. Cela prouve son indisponibilité pour cette session,
  sans prouver son inexistence pour tous les comptes.
- L'API `aphrody-labs` expose **8 dépôts**, dont **6 forks** GNU/Bun, le dépôt OXC
  et `aphrody-koharu`. Le SHA OXC consommé existe dans `aphrody-labs/oxc` ; les
  dépendances du workspace visent encore l'URL `aphrody-code/oxc` à ce même SHA.
- Le compte `aphrody-code` expose toujours **20 forks** : tauri-plugin-webdriver,
  Victauri, bevy, emu.nintendo.wii.gecko, dust, tailwindcss, tauri, iced,
  cryoglyph, plugins-workspace, base-ui, chipi-spec, spaceui, mcp-server-tauri,
  wasmtime, iced_aw, idb-rs, winit, slog-imgui et imgui-rs. Leur caractère vital
  doit être établi par les consommateurs, les patches et l'avance sur l'amont.
- `rose-griffon` expose **11 dépôts** ; AchilleaWeb et AchilleaBackend restent
  archivés. Aucun gitlink n'est suivi dans `apps/rg` ou `packages/rg` ;
  `git submodule status` n'enregistre aucun sous-module dans ce checkout.
- Les globs de `workspaces.packages` sélectionnent **84 manifests Bun**, dont
  **47 sans `private: true`**, et non 48. L'absence de cette restriction ne
  prouve pas une publication npm. Les identités `@aphrody/*`, `@rosegriffon/*`
  et `@koharu/*` doivent être traitées comme des contrats. Les droits de
  publication npm de `@aphrody-labs` n'ont pas été vérifiés pendant ce lot.

Un transfert ou renommage doit conserver les pins, URLs, licences, imports et
consommateurs. Une conversion RG en sous-modules demande un mapping explicite
repo/dossier, des commits distants accessibles et la vérification des sources
avant remplacement. Les sources existantes restent à préserver jusqu'à la
qualification depuis un clone propre conformément à `AGENTS.md`.

## Actions release restantes et propriétaires

1. **Intégrateur Rust** : qualifier une révision amont ou un patch maintenu
   qui supprime le conflit regex, puis laisser Cargo produire le lockfile.
   L'ancien contrôle de 36 `cargo package --list --no-verify --locked` avait
   échoué ; aucune nouvelle qualification de packaging ne remplace ce résultat.
2. **Intégrateur Rust** : ajouter une version registry vérifiée aux 271 arêtes
   path normal/build et aux 20 arêtes Git, centraliser les contraintes qui se
   recouvrent, et migrer les sept groupes disjoints avec leurs propriétaires.
   Le JSON donne la version réelle de chaque cible locale comme candidate,
   sans certifier qu'elle est déjà publiée.
3. **Workspace/Infra** : utiliser `upstream-sources verify` et l'inventaire
   `consolidation` existants pour pins, patches, licences et consommateurs.
   Qualifier les bootstraps et SDK sur les hôtes cibles ; l'audit de déclarations
   ne remplace pas cette installation depuis un clone propre.
4. **Release** : vérifier descriptions, licences, fichiers inclus, accès
   crates.io/npm, versions déjà publiées, ordre de publication, tags et
   promotion stable/canary ; exécuter le packaging puis les gates ciblés.
5. **Git/Infra** : réconcilier les deux historiques et la destination de push,
   établir la liste des forks à transférer et le mapping RG, puis vérifier
   chaque consommateur après les migrations de sources et de scopes.

## Contrôles de ce lot

- Audit déterministe lancé avec les métadonnées courantes : inventaire ci-dessus,
  manifests lisibles, versions des packages cohérentes avec les métadonnées.
- Deux tests Bun sur les intersections Cargo 0.x/1.x, aliases workspace,
  dépendances cible/build, `publish = true`, wildcard explicite et exemption dev :
  réussis. Format Oxc, lint ciblé et typecheck `tsgo` du package : réussis.
- API GitHub/crates.io, sources Cargo téléchargées, versions des outils et
  état du timer consultés en lecture seule.
- L'intégrateur a exécuté les deux contrôles de résolution décrits plus haut,
  tous deux en échec avec des causes distinctes. Le lockfile reste inchangé.
- Les anciens parses Bash/PowerShell et smoke checks sont des résultats du lot
  précédent ; ils n'ont pas été rejoués ici. Aucun build Rust, test produit,
  compilation croisée, publication ou mutation distante n'a été effectué par
  ce worker.
