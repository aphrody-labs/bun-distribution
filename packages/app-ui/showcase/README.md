<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody M3 showcase

An adaptive package showcase served with its Bun API. The same pages support mobile,
desktop and TV layouts. Every destination loads a dedicated demo; datasets and streamed
examples are local demonstrations.

From this directory, run `bun run dev` for development, `bun run build` then
`bun run serve` for the production file server, or `bun run compile` for a
Bun executable containing the UI, fonts and API. The port defaults to 3300.

Use `?layout=mobile`, `?layout=desktop` or `?layout=tv` to set an initial
layout. The Adaptive page changes the live preference. On TV, arrow keys move
between controls; Enter activates and Back/Escape closes a modal or navigates back.
Text fields keep their caret keys.

`bun run test` checks adaptive routing, inventory and capture contracts.
`bun run typecheck` checks all app sources and scripts.
`bun scripts/shots.ts --out /tmp/m3-showcase-shots` captures every destination
in all three layouts and both colour schemes. It fails for console errors or
external assets and writes its receipt outside the repository.

The frontend and Bun API stay in this application. There is no separate native shell: the
desktop is `aphrody-app` ([`crates/ui/app`](../../../../crates/ui/app/Cargo.toml)), which opens a
showcase window with `aphrody-app --showcase` or its Help > "M3 Showcase" menu entry. That window
starts the compiled Bun sidecar `m3-showcase` on loopback and loads it, so UI and API share one
origin; the page gets no Tauri IPC. A static frontend directory alone does not host the API panels.

`bun run tauri -- sidecar` compiles the sidecar and stages it beside the desktop executable (found
there first, then on `PATH`); `bun run tauri -- info` reports the desktop owner and prerequisites
without compiling. Compilation executes through Aphrody's configured Workspace build factory and
`scripts/build/rust/cargo-serial.sh`; local flags cannot bypass those owners. A production desktop
delivery still needs a successful build/package of `aphrody-app` and a launch of the result.

The responsive mobile layout is available in the web UI. No native mobile host exists: the desktop
Bun sidecar does not establish a mobile API host, and native mobile activation requires a
canonical API host adapter, a serialized platform builder and separate device evidence.

Deployment commands generate reviewable target files from the declared configuration.
The example domain is a template input; it is not a live deployed service.
