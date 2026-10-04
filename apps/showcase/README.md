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

The frontend and Bun API stay in this application. The native Tauri shell belongs to
[Aphrody's canonical Rust owner](../../../crates/ui/m3-showcase/Cargo.toml);
it inherits the workspace's pinned Tauri dependencies. Its desktop wrapper starts
the compiled Bun sidecar on loopback, serves UI and API from the same origin,
and owns the child's lifecycle. A static frontend directory alone does not host
the API panels.

Run `bun run icons` to prepare the canonical brand icons using the installed Tauri CLI.
`bun run tauri -- build --plan` reports the concrete owner, serialized Cargo runner
and prerequisite diagnostics without compiling. Native build, development and sidecar
commands execute through Aphrody's configured Workspace build factory and
`scripts/build/rust/cargo-serial.sh`; local flags cannot bypass those owners.
A production desktop delivery still needs a successful build/package and a launch
of the resulting application.

The responsive mobile layout is available in the web UI. Android/iOS source retains
the mobile entry point, but native mobile activation is refused until the canonical
API host adapter and serialized platform builder qualify. Android needs its SDK,
NDK and JDK; iOS needs the macOS/Xcode builder. The desktop Bun sidecar does not
establish a mobile API host. Native artifacts, device installation and device
execution require separate evidence.

Deployment commands generate reviewable target files from the declared configuration.
The example domain is a template input; it is not a live deployed service.
