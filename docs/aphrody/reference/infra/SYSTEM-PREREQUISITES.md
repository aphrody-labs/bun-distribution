# Prérequis système

Une seule implémentation provisionne les hôtes Linux natifs :
`aphrody-infra dev-env`. Elle lit `tools/config/system-packages.json` (paquets APT par
cible, versions Bun/uv) et `rust-toolchain.toml` (canal Rust), génère un script
idempotent et, sans `--apply`, se contente de comparer l'installé aux versions
épinglées.

```sh
# Depuis Windows (ssh / conteneur Docker aphrody/build-linux:26.04)
aphrody-infra dev-env --target vps
aphrody-infra dev-env --target dbfr --apply
aphrody-infra dev-env --target linux-container-26.04 --apply

# Sur l'hôte Linux lui-même (façade Nushell, même implémentation)
nu scripts/dev/setup.nu --target wsl
nu scripts/dev/setup.nu --target vps --apply
```

The optional interactive developer suite is separate from server provisioning.
Review missing Rust CLI commands and Nu plugin registrations with
`nu scripts/dev/setup.nu --developer-cli`, then install prebuilt crates.io releases
and register the plugins using `nu scripts/dev/setup.nu --developer-cli --apply`.
The tool and plugin package mappings live in `tools/config/developer-cli-tools.json`;
they are installed globally and never added to an Aphrody workspace build.

## Ce que `--apply` fait

1. Ajoute un bloc PATH géré (`# >>> aphrody-infra toolchain >>>`) en tête de
   `~/.bashrc` et `~/.profile`, valable aussi pour les sessions ssh non
   interactives : `~/.cargo/bin`, `~/.bun/bin`, `~/.local/bin`.
2. Installe les paquets APT `common` + cible manquants (sudo sans mot de passe
   requis ; sinon l'étape est signalée `apt-skipped`, cas de WSL : lancer avec
   `wsl -u root`).
3. Installe rustup si absent puis le canal épinglé (`rustfmt`, `clippy`).
4. Installe Bun et uv aux versions épinglées par les installateurs officiels.
5. Installe Nushell par `cargo binstall nu` (non empaqueté par APT).

Le rapport liste `rust`, `bun`, `uv`, `nu`, `node` (doit être `absent`) et le
nombre de paquets APT manquants. Le canal Rust vient de `rust-toolchain.toml`
(`1.98.1`, le même que les dépôts catégorie ; `iecode` garde son propre
`nightly-2026-05-17`, installé par rustup à la demande).

## Politique

- Jamais de Rust, Bun, uv, Node ni npm par APT (`excluded.runtime`). Node et npm
  sont absents des hôtes ; Bun est le seul runtime JavaScript.
- GTK, Qt, Chromium et paquets desktop hors périmètre des hôtes headless.
- `vps` ne touche pas aux données DBFR ; `dbfr` installe les services de
  données sans application web ni bot.

## Accès ssh natif depuis WSL

WSL utilise les mêmes alias que Windows (`vps`, `dbfr`) : blocs `Host`
correspondants et clés copiés dans `~/.ssh` (mode 600). Aucune clé ni adresse
n'est versionnée ici.
