<!-- SPDX-License-Identifier: Apache-2.0 -->
# Yazi terminal integration

Yazi is an optional external terminal file manager. Aphrody OS does not vendor
Yazi, link it into the Rust workspace, or make Drive depend on it. The boundary
is intentionally file-based and works with Yazi's documented `--cwd-file` and
`--chooser-file` integration points.

| Responsibility | Owner |
|---|---|
| interactive terminal navigation, preview, selection | Yazi / `ya` |
| persistent index, locations, metadata, background tasks | Aphrody Drive daemon |
| desktop window and IPC permissions | `aphrody-drive` / `aphrody-app` (sibling repo `aphrody-ui`) |
| SSH/SFTP VFS session credentials | user SSH configuration and agent |

## Windows launcher contract

The launcher creates per-invocation temporary `cwd` and `chooser` files, starts
`yazi --cwd-file <path> --chooser-file <path>`, then reads them after exit. The
desktop uses the returned directory and selected paths as explicit user input;
it never interprets a Yazi process as a Drive daemon.

```powershell
$cwd = New-TemporaryFile
$selection = New-TemporaryFile
try {
  yazi --cwd-file $cwd --chooser-file $selection
  $directory = Get-Content -Raw $cwd
  $selectedPaths = Get-Content $selection
} finally {
  Remove-Item -LiteralPath $cwd, $selection -ErrorAction SilentlyContinue
}
```

Production callers must use process-unique files, validate every returned path
against the caller's authorized scope, and delete the files in `finally`.

## Deliberate exclusions

- No Yazi Lua plugin is installed automatically.
- Yazi DDS is not a desktop IPC replacement; it remains intra-Yazi
  publish/subscribe only.
- Remote VFS paths are not automatically registered as Drive locations.
  Registering a location remains an explicit Drive action with its own
  credentials and indexing policy.
- Image previews and optional terminal graphics remain local terminal concerns;
  Drive thumbnails remain application assets.

References: [Yazi quick start](https://yazi-rs.github.io/docs/quick-start/),
[VFS](https://yazi-rs.github.io/docs/configuration/vfs/),
[plugins](https://yazi-rs.github.io/docs/plugins/overview/),
and [DDS](https://yazi-rs.github.io/docs/dds/).
