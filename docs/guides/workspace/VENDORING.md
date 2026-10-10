# Vendoring the Tauri stack

The Rust crates of the forks (`vendor/tauri` (not in repo) (historical or proposed upstream checkout; not a current source owner), `plugins-workspace`,
`create-tauri-app`, `next`; `wry` and `tao` left with decision 21: one desktop runtime, `tauri-runtime-cef`) live in one Cargo workspace under `crates/tauri/aphrody-*`.
The submodules stay pinned, read-only sources; `yolo import` regenerates the crates from them.

## Branches

| Branch | Content |
| :--- | :--- |
| `main` | Released state. |
| `dev` | Integration branch: imported crates **plus** our own changes (plugin-name handling, CLI templates, unified tooling). |
| `vendor` | Generated imports only, never edited by hand. It lives in the worktree `.cache/vendor` (not in repo) (generated or machine-local artifact; presence depends on the build host). |

Each fork keeps `main` as an upstream mirror and `yolo` as the branch the submodules track.

## What the import does

`vendor.toml` lists the sources and the crates to import. For every crate, `yolo import`:

- reads the **committed** HEAD of the submodule (never the working tree) and copies the crate directory;
- renames the package to `aphrody-<name>`; the library name, binary names, `links` keys and the
  dependency keys are unchanged, so `use tauri::…` and `tauri/custom-protocol` keep working;
- materializes `workspace = true` fields, dependencies and lints from the source workspace, so each
  crate is self-contained;
- rewrites dependencies on other imported crates to `package = "aphrody-x"` + `path`, and aligns the
  version requirement (keeping `~`/`=`) on the imported version;
- drops `[workspace]`, `[profile.*]` and `[patch.*]` tables and copies the upstream `rustfmt.toml`
  (or a marker file for the default style) into the crate;
- applies the `[[rewrite]]` rules of `vendor.toml` (paths that left the crate, formatting fixes) and
  the `[[copy]]` rules (shared plugin README assets);
- writes `vendor.lock` (source SHAs, crate map) and `docs/reference/workspace/CRATES.md`.

Not vendored on purpose: the migrate fixtures, `cef-rollback`, the benchmark crates and the example
apps (`yolo import --scan` lists every manifest and whether it is imported).

## Updating from upstream

```bash
just upgrade-latest     # fetch upstream into the forks, merge it into their yolo branch
just vendor-update      # re-import on `vendor`, then merge `vendor` into the current branch
just import-check       # crates/ on `vendor` equals a fresh import of the pinned submodules
```

Because `vendor` only contains generated output, our changes on `dev` survive the three-way merge:
a conflict means upstream touched a line we also changed.

## Renaming and plugin identity

Plugin names are derived from the package name. `tauri_utils::acl::plugin_name_from_package`
accepts both `aphrody-tauri-plugin-fs` and `tauri-plugin-fs` and returns `fs`; the command macro,
the plugin build script and the CLI all use it. Permission identifiers (`fs:default`) and the
SwiftPM/Gradle names come from `links` and do not change.

The CLI (`cargo tauri add`, `init`, `plugin new`) generates `aphrody-*` dependencies with the
upstream keys and looks up either package name in `Cargo.lock`.

The submodules use SSH URLs, so `import-check` runs locally; the GitHub workflow covers the Bun and Rust checks only.

## Existing clones (submodule names)

Submodule names are `vendor/<name>` (they were `packages/<name>` before the D25 layout). A clone made earlier
migrates once, per submodule `<name>`, without touching the working trees:

```bash
mkdir -p .git/modules/vendor && mv .git/modules/packages/<name> .git/modules/vendor/<name>
printf 'gitdir: ../../.git/modules/vendor/<name>\n' > vendor/<name>/.git
git config --rename-section submodule.packages/<name> submodule.vendor/<name>
git submodule absorbgitdirs vendor/<name>     # only for a submodule that still has a real .git directory
git submodule status                          # every line must start with a space
```

A fresh `git clone --recurse-submodules` needs none of this.
