<!-- SPDX-License-Identifier: Apache-2.0 -->

# Installation complète d’un poste de développement Aphrody

Le [parcours Workspace](README.md) distingue la préparation du dépôt de
l’installation du runtime précompilé produit par Yolo. Ce bootstrap développeur
peut installer des outils Cargo et synchroniser les sources : il ne constitue
pas le parcours léger d’une application consommatrice. Voir le
[contrat runtime](../../architecture/runtime-native/README.md).

Ces scripts préparent un checkout neuf : outils système, versions Rust et Bun
épinglées par le dépôt, dépendances Bun, sources Git référencées dans
`tools/config/upstream-sources.json`, dépendances Cargo et workspace Python frère
`../aphrody-py` lorsqu’il existe. Les sources sont synchronisées aux commits
déclarés et leurs patches configurés sont appliqués par le synchroniseur.

## Cloner et installer

Depuis PowerShell :

```powershell
./scripts/clone-and-bootstrap.ps1 -Destination C:\src\aphrody
```

Depuis Ubuntu/WSL :

```bash
bash scripts/dev/clone-and-bootstrap.sh "$HOME/aphrody"
```

Ces lanceurs clonent `aphrody` et le workspace Python `aphrody-py` côte à côte,
puis exécutent le bootstrap. Vérifier que les deux destinations sont libres et que l’accès
aux dépôts privés est configuré avant de lancer le clone.

## Windows

Ouvrir PowerShell depuis la racine du checkout, avec les droits permettant
l’installation Winget et Visual Studio Build Tools, puis lancer :

```powershell
Set-ExecutionPolicy -Scope Process Bypass
./scripts/bootstrap.ps1
```

Le script installe Git, Rustup, Bun, uv, CMake, Ninja, LLVM et les outils C++
MSVC avec le Windows SDK. Redémarrer le terminal après l’installation des
Build Tools pour charger l’environnement MSVC. Les dépôts frères (IECODE, FUT) ne
sont pas des checkouts requis : ils consomment les paquets `@aphrody/*` par le canal
d'archives `yolo ops aphrody-packages prepare`. Un ancien dossier `source` n’est pas
un prérequis universel : consulter les dépendances de la capacité sélectionnée.

## Ubuntu ou WSL

Depuis la racine du checkout :

```bash
bash scripts/dev/bootstrap.sh
```

Le script installe les paquets de base listés dans
`tools/config/system-packages.json`, Rustup et ses cibles, Bun, uv, Nu et les outils
Cargo déclarés, puis synchronise les sources Bun/Cargo et le workspace Python
frère avec `uv`. APT nécessite `sudo`.

Options `--skip-sources`, `--skip-python` et `--canary` pour omettre les
sources, Python ou ajouter Rust nightly et ses cibles. PowerShell utilise
`-SkipSources`, `-SkipPython`, `-SkipNativeTools` et `-Canary`. Omettre les
sources ou les outils natifs ne garantit pas un bootstrap sans compilation :
les scripts installent aussi des outils via le wrapper Cargo. Le script peut
être relancé ; les synchroniseurs et gestionnaires de
paquets évitent les installations redondantes.

Sous Linux avec systemd utilisateur, `bun run update:systemd` vérifie les unités et
`yolo update systemd install --apply` les génère depuis le catalogue d’unités yolo (`packages/engine/core/src/units/catalog.json`)
(dont `aphrody-update.timer`, rapport hebdomadaire sans écriture, et
`aphrody-rust-update.timer`, rafraîchissement des toolchains `stable`/`nightly` et des
sous-commandes Cargo). Le bootstrap installe les versions épinglées; les montées de
version passent par `yolo update` (voir [Mise à jour](../../operations/infra/UPDATE.md)).
Voir aussi le [guide toolchains et compilation
croisée](../../operations/workspace/rust-toolchains-and-cross-builds.md).

## Vérification

```bash
bun run sources
cargo fetch --locked
bun install --frozen-lockfile
```

Les builds complets restent des opérations distinctes : tous les packages ne
sont pas construits automatiquement au bootstrap. Les bibliothèques natives
propres à une cible doivent être déclarées dans le manifeste système avant de
qualifier cette cible.

## Travail dans un checkout partagé

Lire [AGENTS.md](../../AGENTS.md), [PLAN.md](../../PLAN.md) et
[MEMORY.md](../../MEMORY.md), puis vérifier branche et claims avant toute
écriture. Ne pas relancer ce bootstrap comme validation documentaire ou depuis
un worker sans autorisation de la fabrique : il modifie le poste et peut lancer
Cargo. Pour un lot documentaire, suivre les
[gates de documentation](documentation.md#livraison-autonome).

La livraison SDK/runtime, son installation et les gates consommateurs suivent
le [parcours de qualification](runtime-consumer.md). Les commandes ci-dessus
préparent des dépendances ; elles ne démontrent ni migration, ni parité moteur,
ni activation produit.
