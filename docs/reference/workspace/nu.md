<!-- SPDX-License-Identifier: Apache-2.0 -->
# Nushell sur Aphrody

> Configuration historique du poste WSL ; ce guide ne prescrit plus le shell de développement. Le [workflow Windows natif](../../operations/workspace/windows-native.md) du 2026-10-09 fait autorité.

Ce document décrit la configuration Nushell du poste WSL Aphrody, les extensions
activées, les commandes utiles pour l’administrer et les limites constatées le
28 septembre 2026. Les fichiers de configuration personnels restent dans
`~/.config`; ce document ne contient aucun identifiant ni secret.

## Résumé de l’installation

| Élément | État constaté |
| --- | --- |
| Nushell | `0.115.1` |
| Plugins | `bigquery`, `formats`, `gstat`, `highlight`, `inc`, `json_path`, `polars`, `query`, `skim`, `zstdsep` — tous chargés |
| Complétions externes | Carapace `1.8.0` |
| Invite et navigation | Starship `1.26`, zoxide `0.10` |
| Scripts communautaires | [`nushell/nu_scripts`](https://github.com/nushell/nu_scripts), clone local `32be8aa` |
| Catalogue communautaire | [`nushell/awesome-nu`](https://github.com/nushell/awesome-nu), clone local `1f770cb` |

Les versions des logiciels et plugins ci-dessus décrivent l’état installé à la
date indiquée, pas les dernières versions disponibles.

## Fichiers et responsabilités

| Chemin | Rôle |
| --- | --- |
| `~/.config/shell/env.sh` | Variables partagées avec Bash et environnements POSIX ; nettoyage du `PATH` WSL |
| `~/.config/nushell/env.nu` | Variables d’environnement, chemins Cargo et valeurs par défaut Aphrody/GCP |
| `~/.config/nushell/config.nu` | Initialisation Nu, imports de complétions et alias interactifs |
| `($nu.cache-dir)/carapace.nu` | Initialiseur Carapace généré |
| `($nu.cache-dir)/starship.nu` | Initialiseur Starship généré |
| `($nu.cache-dir)/zoxide.nu` | Initialiseur zoxide généré |
| `~/.local/share/aphrody/nu_scripts` | Clone local des modules et complétions Nu communautaires |
| `~/.local/share/aphrody/awesome-nu` | Référence locale du catalogue communautaire |

`config.nu` charge `$nu.env-path`, puis les initialiseurs générés et les modules
Nu importés. Les fichiers de configuration personnels et les clones communautaires
ne sont pas versionnés avec le superprojet.

Le moteur Nu embarqué et les scripts `.nu` appartenant au dépôt
[`aphrody-shell`](../shell/NUSHELL.md) sont documentés séparément par
leur dépôt propriétaire. Les plugins du poste ne sont pas chargés par ce moteur.

## Variables Bash et Nu

Le fichier Bash `~/.config/shell/env.sh` fournit notamment les emplacements de
configuration GitHub CLI, Google Cloud et OVH, les répertoires Cargo/Rust, ainsi
que les paramètres de projet GCP Aphrody. `env.nu` reprend ces valeurs pour les
processus démarrés depuis Nu. Les valeurs par défaut importantes sont :

| Variable | Valeur par défaut |
| --- | --- |
| `GH_CONFIG_DIR` | `~/.config/gh` |
| `CLOUDSDK_CONFIG` | `~/.config/gcloud` |
| `GOOGLE_APPLICATION_CREDENTIALS` | `~/.config/gcloud/application_default_credentials.json` |
| `OVH_CONF` | `~/.ovh.conf` |
| `APHRODY_HOME` | `~/.aphrody` |
| `BXC_COOKIES_DIR` | `~/.aphrody/cookies` |
| `BUN_INSTALL` | `~/.bun` |
| `NVM_DIR` | `~/.nvm` |
| `GOOGLE_CLOUD_PROJECT` | `aphrody` |
| `GCLOUD_PROJECT` / `CLOUDSDK_CORE_PROJECT` | `GOOGLE_CLOUD_PROJECT` |
| `GOOGLE_CLOUD_LOCATION` | `us-central1` |
| `GOOGLE_CLOUD_REGION` | `GOOGLE_CLOUD_LOCATION` |
| `GOOGLE_GENAI_USE_VERTEXAI` | `true` |
| `APHRODY_GCP_AUTH` | `adc-or-secret-manager` |
| `CARGO_HOME` / `RUSTUP_HOME` | `~/.cargo` / `~/.rustup` |
| `RUSTC_WRAPPER` | `sccache` si disponible dans la configuration héritée |
| `SCCACHE_CACHE_SIZE` | `30G` |
| `EDITOR` / `VISUAL` | `hx` |
| `PAGER` | `bat --plain` |

Ces variables donnent des chemins et valeurs par défaut ; elles ne prouvent pas
que chaque service est authentifié. Les jetons GitHub, identifiants OVH, clés,
cookies et identifiants Google doivent rester dans leurs fichiers privés. Ne pas
les copier dans `env.nu`, ce document ou Git.

Le fichier Bash filtre les chemins Windows `/mnt/*`, déduplique `PATH`, puis
ajoute les emplacements utilisateur (`~/.local/bin`, Cargo, Bun, CUDA et
`~/bin`) s’ils existent. Il charge `nvm.sh` une seule fois par arbre de processus.
Sur WSL avec `/dev/dxg`, il sélectionne le pilote Mesa `d3d12` si
`/proc/version` signale Microsoft. `CUDA_HOME` et `GALLIUM_DRIVER` ne sont donc
définis que lorsque leurs conditions sont réunies. Nu déduplique son `PATH` et
ajoute `CARGO_HOME/bin` s’il n’est pas déjà présent.

Inspection sans afficher le contenu des identifiants :

```nu
[$env.GH_CONFIG_DIR $env.CLOUDSDK_CONFIG $env.OVH_CONF $env.GOOGLE_APPLICATION_CREDENTIALS]
| each {|p| {path: $p, exists: ($p | path exists)} }
```

## Plugins Nushell

Les plugins sont compilés dans `~/.cargo/bin` et enregistrés dans le registre
Nu avec `plugin add`. La version de la plupart correspond à Nushell `0.115.1`.

| Plugin | Version constatée | Usage |
| --- | --- | --- |
| [`bigquery`](https://github.com/galuszkak/nu_plugin_bigquery) | `0.4.0` | Requêtes Google BigQuery depuis Nu |
| [`formats`](https://github.com/nushell/nushell/tree/main/crates/nu_plugin_formats) | `0.115.1` | Lecture/écriture de formats de données supplémentaires |
| [`gstat`](https://github.com/nushell/nushell/tree/main/crates/nu_plugin_gstat) | `0.115.1` | Commandes d’état Git structurées |
| [`highlight`](https://github.com/cptpiepmatz/nu-plugin-highlight) | `1.4.17+0.115.1` | Coloration syntaxique de texte source |
| [`inc`](https://github.com/nushell/nushell/tree/main/crates/nu_plugin_inc) | `0.115.1` | Incrémentation de valeurs et versions |
| [`json_path`](https://github.com/fdncred/nu_plugin_json_path) | `0.25.0` | Sélection de valeurs JSON avec JSONPath |
| [`polars`](https://github.com/nushell/nushell/tree/main/crates/nu_plugin_polars) | `0.115.1` | Traitement de données tabulaires avec Polars |
| [`query`](https://github.com/nushell/nushell/tree/main/crates/nu_plugin_query) | `0.115.1` | Requêtes JSON, XML, HTML et données Web |
| [`skim`](https://github.com/idanarye/nu_plugin_skim) | `0.30.0` | Sélection fuzzy interactive compatible avec les valeurs Nu |
| [`zstdsep`](https://github.com/kazu/seekzstdsep) | `0.2.2` | Flux Zstandard indexables avec séparateurs JSONL, CSV ou logfmt |

Découvrir les commandes disponibles plutôt que supposer leurs signatures :

```nu
plugin list
help bigquery
help polars
help query
help skim
```

Pour mettre à jour un plugin, installer une version compatible de son paquet,
puis recharger le binaire enregistré si nécessaire. Exemple avec Cargo :

```sh
cargo install --locked --version 0.115.1 nu_plugin_formats
```

Puis dans Nu, si le registre pointe encore vers un binaire différent :

```nu
plugin remove formats
plugin add ~/.cargo/bin/nu_plugin_formats
plugin use formats
plugin list
```

Garder les versions des plugins natifs alignées avec Nushell, sauf indication
explicite de compatibilité par leur projet. Les options d’installation changent
selon le plugin ; consulter sa documentation avant de remplacer une version.

## Complétions et scripts

### Carapace

Carapace fournit des complétions pour les exécutables externes. Le fichier Nu
généré est chargé au démarrage depuis le cache de Nu. Les complétions personnalisées
Nu de Git et Cargo viennent de `nu_scripts` et sont importées dans `config.nu`.

### Modules `nu_scripts` importés

- `custom-completions/git/git-completions.nu` : complétions Git sensibles au
  contexte, telles que branches, remotes, commits, tags et fichiers.
- `custom-completions/cargo/cargo-completions.nu` : complétions Cargo pour les
  paquets, cibles, profils, fonctionnalités et sous-commandes.
- `modules/git/git_branch_age.nu` : commande `git age` pour afficher l’âge des
  branches.

Le dépôt contient aussi beaucoup d’autres complétions (par exemple Docker, AWS,
uv et Podman), mais elles ne sont pas toutes importées. N’ajouter un `use` que
pour un outil installé et utilisé, puis ouvrir une nouvelle session Nu.

### Ajouter une complétion `nu_scripts`

1. Lire le README du module dans `~/.local/share/aphrody/nu_scripts`.
2. Ajouter son import dans `~/.config/nushell/config.nu`.
3. Redémarrer Nu et vérifier avec `help <commande>` ou la complétion au clavier.

Éviter d’importer toutes les complétions sans discernement : certaines dépendent
d’outils externes et les complétions dynamiques peuvent lancer ces outils.

## Invite, navigation et ergonomie

- **Starship** fournit l’invite via son initialiseur Nu généré.
- **zoxide** fournit la navigation fréquente par `z`/`zi`.
- L’éditeur Nu par défaut est `hx` (`$env.config.buffer_editor`).
- La bannière Nu est masquée.
- `~/.config/nushell/config.nu` source également `~/.zoxide.nu`,
  `~/.starship.nu` et `~/.atuin.nu`, en plus des initialisateurs stockés dans le
  cache Nu. Ces fichiers utilisateur restent la source effective pour les hooks.
- Alias interactifs : `cat` → `bat --paging=never`, `grep` → `rg`, `find` → `fd`,
  `ps` → `procs`, `top` → `btm`, `du` → `dust`, `diff` → `delta`, `http` → `xh`
  et `lg` → `gitui`.
- Fonctions `l [path = "."]` → `eza -la --icons --git`, `ll [path = "."]` →
  `eza -l --icons --git`, et `tree [path = "."]` → `eza --tree --icons`.
- `cli-doc` ouvre le catalogue local `~/.codex/CLI.md` dans Helix.

Ces alias supposent que les exécutables correspondants existent dans le `PATH`.

## Synchronisation des références communautaires

Les clones sont des références locales, pas des sous-modules du superprojet.
Pour les actualiser sans écraser de modifications locales :

```sh
git -C "$HOME/.local/share/aphrody/awesome-nu" status --short
git -C "$HOME/.local/share/aphrody/nu_scripts" status --short
```

Si les deux dépôts sont propres, avancer leurs branches suivies :

```sh
git -C "$HOME/.local/share/aphrody/awesome-nu" pull --ff-only
git -C "$HOME/.local/share/aphrody/nu_scripts" pull --ff-only
```

Après mise à jour de `nu_scripts`, vérifier les imports de `config.nu` : les
chemins de modules peuvent évoluer en amont.

## Diagnostic rapide

```nu
version
plugin list
which carapace
which starship
which zoxide
help git age
help cargo build
$env.PATH | str join (char newline)
```

Vérifier le démarrage sans configuration utilisateur pour isoler un problème de
plugin ou de syntaxe :

```sh
nu --no-config-file -c 'version'
```

Si une source échoue, confirmer d’abord que le fichier existe :

```nu
[$nu.config-path $nu.env-path ($nu.cache-dir | path join "carapace.nu") ($nu.cache-dir | path join "starship.nu") ($nu.cache-dir | path join "zoxide.nu")]
| each {|p| {path: $p, exists: ($p | path exists)} }
```

## Limite connue : `git ingest`

La tentative d’ingestion du dépôt `nushell/awesome-nu` avec le CLI Aphrody n’a
pas abouti : Cargo s’est arrêté avant d’exécuter la commande, car la dépendance
locale `m3/templates/desktop/src-tauri/Cargo.toml` est absente.
Le dépôt a été cloné et consulté directement comme solution de repli. Cela ne
signifie pas que l’ingestion a été effectuée. Relancer `git ingest` une fois le
checkout/vendor corrigé, puis documenter ici son résultat réel.

## Références

- [Documentation Nushell](https://www.nushell.sh/book/)
- [Configuration Nushell](https://www.nushell.sh/book/configuration.html)
- [Plugins Nushell](https://www.nushell.sh/book/plugins.html)
- [Détails des plugins `awesome-nu`](https://github.com/nushell/awesome-nu/blob/main/plugin_details.md)
- [Catalogue `awesome-nu`](https://github.com/nushell/awesome-nu)
- [Modules `nu_scripts`](https://github.com/nushell/nu_scripts)
- [Carapace](https://carapace.sh/)
- [Starship avec Nushell](https://starship.rs/guide/#nushell)
- [zoxide avec Nushell](https://github.com/ajeetdsouza/zoxide#nushell)
- [Référence locale des outils CLI installés](../ai/_source/CLI.md)
