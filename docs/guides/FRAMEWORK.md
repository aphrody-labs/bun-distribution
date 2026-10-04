# Aphrody M3 framework

`aphrody-m3` is the complete Material 3 stack for Bun: tokens, theme sheets, web components, React, Base UI,
Tailwind v4, build tooling and OS theme installers. Yolo orchestrates build, serve and compile.

## Package map

| Layer | Package | Role |
| --- | --- | --- |
| Tokens | `@aphrody/m3-tokens` | `--md-sys-*` tokens, Material You roles from a seed, window classes (width and height), emphasized type, Expressive springs, directional shapes |
| Theme | `@aphrody/m3-theme` | Fusion sheets: M3 + shadcn + Tailwind aliases, SpaceUI schemes, React/Tauri providers |
| Front | `@aphrody/m3-front` | Framework-agnostic: `<m3-theme>`, lazy `material-web` registration, window-class observer |
| React | `@aphrody/m3-react` | `@lit/react` wrappers for every `md-*` element, adaptive hooks, transitions, form state |
| Base UI | `@aphrody/m3-baseui` | Base UI parts (fork in `forks/base-ui`) styled with M3 tokens |
| Tailwind | `@aphrody/m3-tailwind` | Tailwind v4 CSS-first `@theme` generated from the tokens (`preset.css`) |
| Framework | `@aphrody/m3` | `m3` CLI, Bun plugin, `serveM3`, `buildM3`, `M3App`, `m3.config.ts` |
| Shared | `m3-config`, `m3-fonts`, `m3-icons`, `m3-motion`, `m3-primitives`, `m3-forms`, `m3-ai`, `m3-explorer`, `m3-design`, `m3-next`, `m3-mcp`, `material-design-icons`, `scaffold` | Build presets, assets, behaviour, MCP |
| OS | `@aphrody/m3-os-themes` | Windows 11, GNOME, COSMIC and Chromium theme generators and installers |
| App | `apps/web` (`@aphrody/m3-web`) | Showcase app the yolo CLI builds, serves and compiles |

Forks (`forks/`): `tailwindcss`, `base-ui`, `material-web`, `material-color-utilities`, `material-design-icons`.
Dependencies are pinned once in the root `workspaces.catalog`; packages reference `catalog:` or `workspace:*`.

## Yolo orchestration

Root scripts run `scripts/yolo.ts`, which runs the yolo CLI from source (`bun $YOLO_ROOT/apps/cli/src/index.ts`,
`YOLO_ROOT` defaults to `$HOME/yolo`; commands are listed in `~/yolo/docs/cli/HELP.md`).

| Script | Runs |
| --- | --- |
| `bun run build` | `yolo web build` (apps/web `build` = `m3 build`), then the `@aphrody/m3*` package builds (tsup + declarations) |
| `bun run serve` | `yolo web dev` (apps/web `dev` = `m3 dev`, HMR) |
| `bun run compile` | `yolo tauri build`, then apps/web `compile` (`m3 compile`, one executable). `yolo desktop` is the same command |
| `bun run test` | yolo preflight (`yolo version --json`), the task-plan test, `bun test` in every `@aphrody/m3*` package |
| `bun run lint` | yolo preflight, then `oxlint` over the m3 packages, apps and scripts |
| `bun run typecheck` | yolo preflight, then each package's `typecheck` |
| `bun run install:theme -- <args>` | the `m3-os-themes` CLI (dry-run unless `--apply`) |

yolo's `web|desktop|tauri` commands act on `$YOLO_HOME/apps/web`; the wrapper sets `YOLO_HOME` to this repository,
so they run the scripts of `apps/web`. The host-bound packages (`app-ui`, `rg-ui`, `shenron-ui`, `web-to-tauri`)
are outside the workspace; `app-ui` builds Rust and belongs to the integrator
(`scripts/build/rust/cargo-serial.sh`).

## Theme install per OS

```sh
bun packages/m3-os-themes/src/cli.ts generate --target all --seed '#6750a4' --out out   # files only
bun packages/m3-os-themes/src/cli.ts install  --target gnome --seed '#6750a4' --mode dark           # plan only
bun packages/m3-os-themes/src/cli.ts install  --target gnome --seed '#6750a4' --mode dark --apply   # applies
bun packages/m3-os-themes/src/cli.ts uninstall --target gnome --apply                                # restores
```

- **Windows 11**: `install-windows.ps1` writes `Themes\Personalize` (`AppsUseLightTheme`, `SystemUsesLightTheme`,
  `ColorPrevalence`), DWM (`AccentColor`, `ColorizationColor`) and `Explorer\Accent`, generates a wallpaper and loads
  the `.theme`. The first run snapshots the previous values (`%LOCALAPPDATA%\m3-os-themes`); `-Uninstall` restores them.
- **GNOME Shell**: `~/.local/share/themes/M3-<name>/{gnome-shell,gtk-3.0,gtk-4.0}`, `~/.config/gtk-4.0/gtk.css` for
  libadwaita, gsettings (`gtk-theme`, `color-scheme`, `accent-color`, User Themes `name`). Snapshot and `--uninstall`.
- **COSMIC**: cosmic-theme ThemeBuilder RON keys under `~/.config/cosmic/com.system76.CosmicTheme.{Dark,Light}.Builder/v1/`
  and an importable `M3-<name>-<mode>.ron`. Snapshot and `--uninstall`.
- **Chromium browsers**: a Manifest V3 theme per mode (load unpacked) and the `BrowserThemeColor` managed policy for Chrome,
  Chromium, Brave and Edge (Linux `/etc/*/policies/managed`, Windows `.reg`). `install-chromium.md` has the steps.

`--mode auto` leaves the OS light/dark preference alone and ships both variants. Tests generate in memory or in a
temporary directory; nothing in the repository applies a theme to the machine that runs it.
