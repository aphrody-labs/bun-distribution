<!-- SPDX-License-Identifier: Apache-2.0 -->
# CLI du poste Aphrody

Inventaire WSL/Linux vérifié le 2026-10-01 : 53 exécutables trouvés sur PATH,
10 plugins Nushell chargés. Les versions décrivent ce poste ; un chemin trouvé
ne prouve ni l’authentification d’un fournisseur ni une compilation produit.

## Démarrage des agents et contextes

Démarrer depuis `/home/aphro/aphrody`. Les règles communes sont dans
[AGENTS.md](../../../AGENTS.md) ; Claude et agy y accèdent par les liens
`CLAUDE.md` et `GEMINI.md`. Les trois agents travaillent sur la branche courante
et réclament des familles de fichiers distinctes avant leurs modifications.

```bash
cd /home/aphro/aphrody
aphrody a2a invoke --peer codex --claim crates/ai/example "tâche"
aphrody a2a invoke --peer claude --claim docs/operations/example "tâche"
aphrody a2a invoke --peer agy --claim packages/infra/example "tâche"
```

Adapter les chemins de claim à la tâche réelle. `--dry-run` vérifie la commande
résolue sans lancer de tâche. Les claims sont des verrous coopératifs ; les
commits observés ne constituent pas une attribution certaine à un agent.

Aphrody, DBFR/Shenron et IE ont des contextes de domaine séparés. Le contexte
partagé entre CLI reste rattaché au workspace concerné. Les bases natives de
conversation restent dans leurs stores ; leurs projections ne deviennent pas
des règles. Les poids entraînés et les données privées conservent leur store.
Voir [TOOLS.md](../../../TOOLS.md) pour les profils effectivement configurés.

## Commandes de coordination vérifiées

| Besoin | Commande |
| --- | --- |
| Agents et familles de fichiers | `aphrody a2a invoke --help` |
| Routage des pairs | `aphrody a2a peers` |
| Import incrémental des sessions | `aphrody ai sync-sessions --json --shared-workspace /home/aphro/aphrody` |
| Projection sans import mémoire | `aphrody ai sync-sessions --json --no-memory --shared-workspace /home/aphro/aphrody` |
| État live PID/session/workspace/Git | `bun packages/infra/workspace/src/ops.ts agent-live --json` |
| Actualisation continue | `bun packages/infra/workspace/src/ops.ts agent-live --watch --interval-secs 30` |
| Génération Agent Home | `bun packages/infra/workspace/src/ops.ts agent-home --help` |
| Catalogue réel du kernel | `aphrody-kernel tools` |
| Appel kernel | `aphrody-kernel call <outil> '<objet JSON>'` |
| Modèles locaux installés | `aphrody model list --json` |
| Contrôle du store modèles | `aphrody model doctor --json` |
| Environnement IA résolu | `aphrody ai env --help` |
| Inspection mémoire disponible | `aphrody memory --help` |

`agent-live` publie `.coord/shared/LIVE.json` et `LIVE.md`. Le service local
actualise ces projections ; la synchronisation des sessions a son propre
service. Voir [preuve et limites live](../../../docs/operations/ai/agent-live.md).
L’aide installée de `aphrody memory` propose `migrate` ; ne supposer aucune
sous-commande `audit` ou `backends` sans la vérifier sur le binaire courant.

## Toolchains et validation

Bun `1.4.2`, uv `0.12.17`, Rust/Cargo `1.98.1`, Oxc `oxlint 1.85.0` /
`oxfmt 0.70.0`, TypeScript `7.0.2`. Le wrapper Cargo global est `sccache`.
Les cibles Rust installées incluent Linux, Windows MSVC/GNU, macOS Intel/ARM,
WASM navigateur, WASI et Emscripten ; cela ne prouve pas leurs SDK externes.
La qualification des outils MSVC est enregistrée séparément dans le rapport
[setup toolchain](../../../docs/migration/toolchain-setup-2026-10-01.json).

```bash
cargo check -p <crate> --all-targets
cargo clippy -p <crate> --all-targets -- -D warnings
cargo test -p <crate>
oxlint <fichiers>
oxfmt --check <fichiers>
tsc --noEmit --project <tsconfig>
bun test <tests>
```

Respecter les manifests des propriétaires pour les scripts et les périmètres.
Les exécutables globaux n’alignent pas automatiquement les dépendances locales.

## Inventaire des exécutables

Sources : [manifest développeur](../../../config/developer-cli-tools.json),
[catalogue canonique](../../../config/cli-catalog.json), résolution du PATH et
`--version` exécuté avec délai borné. Les plugins sont vérifiés via `plugin list`.
`bottom` est le nom du package, son exécutable est `btm` ; `yazi-cli` fournit
`ya` ; `tealdeer` fournit `tldr`. Ces noms de packages ne sont pas des absences.

| Commande | Version observée | Chemin réel | Rôle |
| --- | --- | --- | --- |
| `nu` | 0.115.1 | `/home/aphro/.cargo/bin/nu` | interactive shell |
| `coreutils` | coreutils 0.12.0 (multi-call binary) | `/home/aphro/.cargo/bin/coreutils` | portable core utilities |
| `eza` | eza - A modern, maintained replacement for ls | `/usr/bin/eza` | directory listing |
| `bat` | bat 0.26.1 (979ba22) | `/home/aphro/.cargo/bin/bat` | file display |
| `rg` | ripgrep 15.2.0 (rev e89fff89ac) | `/home/aphro/.codex/packages/app-server-daemon/releases/0.159.3-x86_64-unknown-linux-musl/codex-path/rg` | text search |
| `fd` | fd 10.5.0 | `/home/aphro/.cargo/bin/fd` | file search |
| `sd` | sd 1.0.0 | `/home/aphro/.cargo/bin/sd` | text replacement |
| `choose` | choose 1.3.7 | `/home/aphro/.cargo/bin/choose` | column selection |
| `dust` | Dust 1.2.6 | `/home/aphro/.cargo/bin/dust` | directory size |
| `dysk` | dysk 3.7.1 | `/home/aphro/.cargo/bin/dysk` | filesystem usage |
| `erd` | erdtree 3.1.2 | `/home/aphro/.cargo/bin/erd` | directory tree |
| `procs` | procs 0.14.12 | `/home/aphro/.cargo/bin/procs` | process listing |
| `btm` | bottom 0.14.9 | `/home/aphro/.cargo/bin/btm` | system monitor |
| `zoxide` | zoxide 0.10.0 | `/home/aphro/.cargo/bin/zoxide` | directory navigation |
| `delta` | delta 0.19.2 | `/home/aphro/.cargo/bin/delta` | git diff pager |
| `xh` | xh 0.26.2 | `/home/aphro/.cargo/bin/xh` | HTTP client |
| `tldr` | tealdeer 1.9.0 | `/home/aphro/.cargo/bin/tldr` | command help pages |
| `yazi` | Yazi 26.5.6 (aa52643 2026-05-05) | `/home/aphro/.cargo/bin/yazi` | terminal file manager |
| `ya` | Ya 26.5.6 (aa52643 2026-05-05) | `/home/aphro/.cargo/bin/ya` | Yazi command-line helper |
| `gitui` | gitui 0.28.1-nightly 2026-03-25 () | `/home/aphro/.cargo/bin/gitui` | git terminal UI |
| `just` | just 1.58.0 | `/home/aphro/.cargo/bin/just` | task runner |
| `atuin` | atuin 18.23.0 (78366dca8c4941731e06a2f81c0980cc2ccc3836) | `/home/aphro/.cargo/bin/atuin` | shell history |
| `starship` | starship 1.26.0 | `/home/aphro/.cargo/bin/starship` | shell prompt |
| `zellij` | zellij 0.45.1 | `/home/aphro/.cargo/bin/zellij` | terminal multiplexer |
| `hx` | helix 25.07.1 (079a789e) | `/home/aphro/.cargo/bin/hx` | modal editor |
| `nu_plugin_bigquery` | chargé, version non interrogée | `/home/aphro/.cargo/bin/nu_plugin_bigquery` | BigQuery queries |
| `nu_plugin_formats` | chargé, version non interrogée | `/home/aphro/.cargo/bin/nu_plugin_formats` | additional data formats |
| `nu_plugin_gstat` | chargé, version non interrogée | `/home/aphro/.cargo/bin/nu_plugin_gstat` | Git status values |
| `nu_plugin_highlight` | chargé, version non interrogée | `/home/aphro/.cargo/bin/nu_plugin_highlight` | syntax highlighting |
| `nu_plugin_inc` | chargé, version non interrogée | `/home/aphro/.cargo/bin/nu_plugin_inc` | structured value increments |
| `nu_plugin_json_path` | chargé, version non interrogée | `/home/aphro/.cargo/bin/nu_plugin_json_path` | JSONPath queries |
| `nu_plugin_polars` | chargé, version non interrogée | `/home/aphro/.cargo/bin/nu_plugin_polars` | dataframe operations |
| `nu_plugin_query` | chargé, version non interrogée | `/home/aphro/.cargo/bin/nu_plugin_query` | HTML/XML/SQL queries |
| `nu_plugin_skim` | chargé, version non interrogée | `/home/aphro/.cargo/bin/nu_plugin_skim` | fuzzy selection |
| `nu_plugin_zstdsep` | chargé, version non interrogée | `/home/aphro/.cargo/bin/nu_plugin_zstdsep` | zstd compression |
| `cargo` | cargo 1.98.1 (797e8a9bc 2026-08-05) | `/home/aphro/.cargo/bin/cargo` | outillage runtime / coordination |
| `rustc` | rustc 1.98.1 (48a229cea 2026-09-01) | `/home/aphro/.cargo/bin/rustc` | outillage runtime / coordination |
| `sccache` | sccache 0.18.0 | `/home/aphro/.cargo/bin/sccache` | outillage runtime / coordination |
| `bun` | 1.4.2 | `/home/aphro/.bun/bin/bun` | outillage runtime / coordination |
| `uv` | uv 0.12.17 (x86_64-unknown-linux-gnu) | `/home/aphro/.local/bin/uv` | outillage runtime / coordination |
| `oxlint` | Version: 1.85.0 | `/home/aphro/.bun/bin/oxlint` | outillage runtime / coordination |
| `oxfmt` | Version: 0.70.0 | `/home/aphro/.bun/bin/oxfmt` | outillage runtime / coordination |
| `tsc` | Version 7.0.2 | `/home/aphro/.bun/bin/tsc` | outillage runtime / coordination |
| `codex` | codex-cli 0.158.0 | `/home/aphro/.local/bin/codex` | outillage runtime / coordination |
| `claude` | 2.1.286 (Claude Code) | `/home/aphro/.nvm/versions/node/v24.20.0/bin/claude` | outillage runtime / coordination |
| `agy` | 1.2.14 | `/home/aphro/.local/bin/agy` | outillage runtime / coordination |
| `aphrody` | aphrody 1.0.0-canary | `/home/aphro/.local/bin/aphrody` | outillage runtime / coordination |
| `aphrody-kernel` | aphrody-kernel 1.0.0-canary | `/home/aphro/.local/bin/aphrody-kernel` | outillage runtime / coordination |
| `carapace` | carapace-bin 1.8.0 | `/usr/bin/carapace` | outillage runtime / coordination |
| `git` | git version 2.43.0 | `/usr/bin/git` | outillage runtime / coordination |
| `gh` | gh version 2.45.0 (2025-07-18 Ubuntu 2.45.0-1ubuntu0.3) | `/usr/bin/gh` | outillage runtime / coordination |
| `curl` | curl 8.5.0 (x86_64-pc-linux-gnu) libcurl/8.5.0 OpenSSL/3.0.13 zlib/1.3 brotli/1.1.0 zstd/1.5.5 libidn2/2.3.7 libpsl/0.21.2 (+libidn2/2.3.7) libssh/0.10.6/openss | `/usr/bin/curl` | outillage runtime / coordination |
| `pwsh` | PowerShell 7.6.6 | `/usr/bin/pwsh` | outillage runtime / coordination |

## Rafraîchissement et propriétaires

Agent Home collecte les exécutables présents et le catalogue kernel depuis le
poste. Relancer son générateur après une installation et consulter les profils
produits. Le catalogue historique
[CLI de l’ancien écosystème](../infra/ecosystem/CLI.md) est une preuve importée,
avec des chemins antérieurs à la migration ; utiliser les manifests actuels et
`<commande> --help` pour les commandes effectivement installées.

La configuration Nushell et ses intégrations sont décrites dans le
[guide workstation](nu.md). Les dix plugins sont chargés à cette vérification.
Le catalogue `config/cli-catalog.json` choisit un seul outil par capacité ;
`systemctl` reste le superviseur hôte et `ssh` le transport.

Les jetons, conversations brutes et valeurs de configuration privées ne sont
pas inclus dans cet inventaire. La synchronisation DBFR/Drive et les modèles
Shenron sont documentés par leurs propriétaires Agent Home et Infra.
