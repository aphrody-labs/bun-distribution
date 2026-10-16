<!-- SPDX-License-Identifier: Apache-2.0 -->

# Installer aphrody

La voie d'installation supportée est la compilation depuis ce dépôt. Aucun
paquet système, gestionnaire de paquets ou script de téléchargement externe ne
doit être présenté comme disponible tant qu'il n'est pas publié et vérifié.

## Prérequis

- Git ;
- le toolchain Rust indiqué par `rust-toolchain.toml` ;
- les dépendances natives propres à la plateforme lorsque Cargo les demande.

Le workspace contient aussi des composants Bun et Python, mais le CLI Rust ne
requiert pas de les installer pour être compilé. Consultez
[l'architecture](../../architecture/ai/ARCHITECTURE.md) avant de préparer une surface précise.

## Compiler le CLI

Le workspace Cargo d'`aphrody-ai` résout ses dépendances de sous-systèmes via
des chemins relatifs vers les dépôts frères (voir [`README.md`](../../products/ai/README.md#sibling-repositories)).
Clonez l'ensemble des couches côte à côte :

```bash
for r in ai os web contracts compat shell ui native infra; do
  git clone https://github.com/aphrody-code/aphrody-$r.git
done
cd aphrody-ai
export RUSTC_WRAPPER=
cargo build --release --locked -p aphrody
```

Le binaire est produit dans `target/<target>/release/` si la configuration
Cargo fixe une cible, sinon dans `target/release/` (not in repo) (generated or machine-local artifact; availability depends on the build host).

```bash
# Windows PowerShell
.\target\release\aphrody.exe version

# Linux ou macOS
./target/release/aphrody version
```

`aphrody --help` est la référence locale des commandes effectivement disponibles.

## Installer dans le PATH utilisateur

Les scripts du dépôt construisent les binaires puis les copient dans un
répertoire utilisateur ; ils n'exigent pas de privilèges administrateur.

```bash
# Linux : destination par défaut ~/.local/bin
./scripts/deploy.sh --prefixes aphrody
```

Après une installation de binaire release, la commande native peut enregistrer
ce chemin dans le PATH utilisateur :

```bash
aphrody self install-path
```

Rouvrez le terminal si le PATH n'est pas encore actualisé, puis vérifiez :

```bash
aphrody version
aphrody doctor
```

## Développer ou installer d'autres surfaces

- déploiement (`aphrody-mcp`, agent stack, site Python) : propriété de `aphrody-infra` ;
  le VPS n'exécute plus Aphrody ;
- application desktop : le commentaire de `scripts/release/deploy.sh` décrit le build séparé ;
- liens des anciens noms de binaires (`bxc`, `bxc-mcp`, `n2b`, `aphrody-infra`, ...) : un seul binaire, `aphrody package status` et `aphrody package install` (voir [PACKAGES](../../reference/ai/PACKAGES.md)).

## Désinstaller

Supprimez le ou les binaires copiés dans le répertoire choisi par le script,
puis retirez ce répertoire du PATH si vous l'aviez ajouté. Pour les liens créés
par le programme (`aphrody`, `bxc`, `n2b`, ...), utilisez `aphrody package uninstall --dry-run`
puis `--yes` : seuls les liens vers le binaire sont retirés, jamais le binaire.

## Diagnostic

Commencez par `aphrody doctor`. Les problèmes connus et leurs contournements
sont consignés dans [TROUBLESHOOTING.md](../../reference/ai/TROUBLESHOOTING.md). Pour contribuer,
suivez les commandes de validation définies dans [CLAUDE.md](../../reference/ai/CLAUDE.md).
