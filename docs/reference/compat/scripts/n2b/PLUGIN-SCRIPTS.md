<!-- SPDX-License-Identifier: Apache-2.0 -->
# n2b scripts

Audit + coverage automation pour le plugin `n2b`.

> Scope. Scripts live in `scripts/tools/compat/scripts/n2b/` (`autofix-toolchain.ps1`,
> `coverage-daemon.ts`, `generate-schema-types.ts`) and `scripts/audit/compat/scripts/n2b/`
> (`coverage-check.ts`). `generate-schema-types.ts` regenerates
> `crates/compat/n2b-types/src/schema.rs` and `packages/engine/n2b-types/src/index.ts` from
> `crates/contracts/schema/v2.json`. `coverage-check.ts` reads the canonical Bun docs
> (`docs/reference/upstream-bun/`, override `N2B_DOCS_BUN`), the n2b notes
> (`docs/reference/compat/n2b/plugin/n2b/`) and the plugin tree (`plugins/aphrody/`, override
> `CLAUDE_PLUGIN_ROOT`); it writes its report to `var/audit/n2b-coverage/` (not in repo) (override
> `N2B_COVERAGE_DIR`). Run the commands below from the repository root with the full script path
> (`bun scripts/audit/compat/scripts/n2b/coverage-check.ts`, `bun scripts/tools/compat/scripts/n2b/coverage-daemon.ts`).
>
> Removed on 2026-10-02: `update-bun-docs.{sh,ps1}` (thin wrappers of
> `yolo ops bun-upstream-docs`, whose root resolution pointed at `scripts/tools/compat`), and
> `n2b-env.{sh,ps1}`, `refactor-start.{sh,ps1}`, `refactor-state.{sh,ps1}` (tmux launchers of the
> former standalone n2b plugin; they required `plan/MISSION.md`, which does not exist here).

## `coverage-check.ts` — audit one-shot

Scanne `packages/infra/workspace/docs/bun/` pour extraire toutes les APIs Bun mentionnées, croise avec :
- les règles `n2b` (via `n2b rules --report json` si installé, sinon fallback sur `docs/plugin/n2b/` (not in repo))
- les fichiers du plugin (`agents/`, `commands/`, `skills/`, `hooks/`, `output-styles/`)

Génère un rapport Markdown dans `docs/plugin/coverage/report-YYYY-MM-DD.md` (not in repo) + symlink `latest.md`.

```bash
# One-shot, print summary
bun scripts/n2b/coverage-check.ts

# JSON structuré
bun scripts/n2b/coverage-check.ts --json

# Strict : exit 1 si coverage < threshold (default 80%)
bun scripts/n2b/coverage-check.ts --strict

# Threshold custom
COVERAGE_THRESHOLD=90 bun scripts/n2b/coverage-check.ts --strict
```

APIs ciblées :
- `Bun.<method>` (tous les appels namespace Bun)
- `bun:<module>` (bun:sqlite, bun:ffi, bun:test, …)
- `import ... from "bun"`

## `coverage-daemon.ts` — scheduler long-running (Bun.cron)

Lance l'audit sur un schedule cron via **`Bun.cron`** (in-process, no-overlap, `ref/unref`).

```bash
# Schedule par défaut : lundi 04:00 UTC
bun scripts/n2b/coverage-daemon.ts

# Schedule custom
N2B_COVERAGE_SCHEDULE='@daily' bun scripts/n2b/coverage-daemon.ts

# Run once puis exit (pour test)
bun scripts/n2b/coverage-daemon.ts --once
```

État persisté dans `docs/plugin/coverage/.daemon-state.json` (not in repo) (runs, last_run, last_summary).

## Déploiement comme systemd user timer

Pour faire tourner le daemon en continu (recommandé) :

```bash
# Copier l'unit
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/n2b-coverage.service <<'EOF'
[Unit]
Description=n2b coverage daemon (Bun.cron)
After=network.target

[Service]
Type=simple
Environment=CLAUDE_PLUGIN_ROOT=%h/.claude/custom-plugins/n2b
ExecStart=%h/.bun/bin/bun %h/.claude/custom-plugins/n2b/scripts/coverage-daemon.ts
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now n2b-coverage
systemctl --user status n2b-coverage
journalctl --user -u n2b-coverage -f
```

## Alternative — cron system classique

Si `Bun.cron` ne convient pas (préfère cron OS-level), utiliser `Bun.cron` en mode path :

```bash
# Enregistre le check dans le crontab via Bun.cron(path, schedule, title)
bun -e 'await Bun.cron("scripts/n2b/coverage-check.ts", "@weekly", "n2b-coverage")'

# Lister
crontab -l | grep bun-cron

# Retirer
bun -e 'await Bun.cron.remove("n2b-coverage")'
```

## Couverture mesurée — threshold

| % coverage | Interprétation |
|---|---|
| ≥ 90% | 🟢 Excellent — plugin en phase avec la doc Bun courante |
| 80–89% | 🟡 OK — quelques APIs émergentes non adressées |
| 70–79% | 🟠 Alerte — mise à jour nécessaire, examiner les critical gaps |
| < 70% | 🔴 Désync — bundled docs trop anciennes ou plugin incomplet |

Après une mise à jour Bun (`bun upgrade`), re-syncer les docs bundled :

```bash
# Détecte la version installée et re-copie
VER="$(bun -e 'const pj = await Bun.file(Bun.which("bun")?.replace(/bin\\/bun$/, "install/cache/bun-types@") + "/package.json").text().catch(()=>null); console.log("1.3.14")')"
cp -r ~/.bun/install/cache/bun-types@${VER}@@@1/docs/. \
      ~/.claude/custom-plugins/n2b/docs/bun/
bun scripts/n2b/coverage-check.ts --strict
```
