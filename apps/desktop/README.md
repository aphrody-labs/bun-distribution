# Aphrody desktop

Aphrody displays the native library capabilities in `aphrody.config.json`.
Bun builds the frontend and backend. The pinned Bun submodule supplies the
Tauri v3 runtime, CEF, JavaScript SDK and native plugins.

From the repository root:

```powershell
bun install --frozen-lockfile
bun run build
bun run dev
bun run desktop:dev
bun run desktop:build
```

`dev` serves the local Web interface. `desktop:dev` supervises the native
desktop without retaining the Cargo build mutex. `desktop:build` serializes
the native build, passes `--locked`, and compiles the Bun sidecar.

The only public action is **Inspect CLI**. Its request accepts one catalog
identifier and executes the configured headless CLI with fixed `--help`
arguments and a 30-second deadline. No editor GUI is launched. Libraries
without a headless CLI remain unavailable for inspection. The interface
shows completion and exit status; raw CLI output is not rendered.

The backend checks the request origin and an ephemeral session. Tauri grants
only `core:default` and `aphrody:default` to the main window. Workspace
configuration owns executable selection and native orchestration.

Installed desktops find the repository from their working directory or
`APHRODY_ROOT`. External Bun selection uses the workspace resolver and
`APHRODY_BUN_BINARY`. No workstation path is embedded in the bundle.

JavaScript and Rust dependencies refer to the existing pinned SDK source.
The public npm package `@aphrody/tauri@1.4.4` was unavailable when this
workspace was created. The pinned fork contains Tauri v3 alpha.4, versioned
as 1.4.4, with CEF 152.3.0 and a Rust 1.97 plugin baseline.

JavaScript bundling does not qualify Cargo builds, native windows, headless
library execution or installers. Native dependencies are recorded in
`src-tauri/Cargo.lock`. CEF Windows currently lacks the Chromium
sandbox; CEF Linux requires glibc and X11/XWayland.
