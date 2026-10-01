<!-- SPDX-License-Identifier: Apache-2.0 -->
# Installation complète d’un poste de développement Aphrody

Ces scripts préparent un checkout neuf : outils système, versions Rust et Bun
épinglées par le dépôt, dépendances Bun, sources Git référencées dans
`config/upstream-sources.json`, dépendances Cargo et workspace Python frère
`../aphrody-py` lorsqu’il existe. Les sources sont synchronisées aux commits
déclarés et leurs patches configurés sont appliqués par le synchroniseur.

## Cloner et installer

Depuis PowerShell :

```powershell
./scripts/clone-and-bootstrap.ps1 -Destination C:\src\aphrody
```

Depuis Ubuntu/WSL :

```bash
bash scripts/clone-and-bootstrap.sh "$HOME/aphrody"
```

Ces lanceurs clonent `aphrody` et le workspace Python `aphrody-py` côte à côte,
puis exécutent le bootstrap. Les deux destinations doivent ne pas exister.

## Windows

Ouvrir PowerShell depuis la racine du checkout, avec les droits permettant
l’installation Winget et Visual Studio Build Tools, puis lancer :

```powershell
Set-ExecutionPolicy -Scope Process Bypass
./scripts/bootstrap.ps1
```

Le script installe Git, Rustup, Bun, uv, CMake, Ninja, LLVM et les outils C++
MSVC avec le Windows SDK. Redémarrer le terminal après l’installation des
Build Tools pour charger l’environnement MSVC. Le clone du dépôt et son dossier
`source` doivent être frères si les dépendances Cargo relatives standard sont
utilisées.

## Ubuntu ou WSL

Depuis la racine du checkout :

```bash
bash scripts/bootstrap.sh
```

Le script installe les paquets de base listés dans
`config/system-packages.json`, Rustup et ses cibles, Bun, uv, Nu et les outils
Cargo déclarés, puis synchronise les sources Bun/Cargo et le workspace Python
frère avec `uv`. APT nécessite `sudo`.

Options `--skip-sources`, `--skip-python` et `--canary` pour omettre les
sources, Python ou ajouter Rust nightly et ses cibles. PowerShell utilise
`-Canary`. Le script peut être relancé; les synchroniseurs et gestionnaires de
paquets évitent les installations redondantes.

Sous Linux avec systemd utilisateur, installe le rafraîchissement hebdomadaire
des toolchains `stable`/`nightly` et sous-commandes Cargo avec
`scripts/build/rust/install-update-timer.sh`. Il ne met pas à niveau Bun/uv ou
les fichiers lock des workspaces. Voir le [guide toolchains et compilation
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
