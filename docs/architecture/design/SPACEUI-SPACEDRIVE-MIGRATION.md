<!-- SPDX-License-Identifier: Apache-2.0 -->
# Drive in Aphrody: ownership and gates

How the Drive file engine and SpaceUI live inside Aphrody. Drive is the Files area of the same
consumer application, not a separate product or UI shell. Token and component
contract: [`SPACEUI-M3-FUSION.md`](./SPACEUI-M3-FUSION.md). Upstream delta:
[`../DRIVE-UPSTREAM-DIFF.md`](../../reference/DRIVE-UPSTREAM-DIFF.md). SpaceUI is MIT; `drive/` and code
adopted from Spacedrive stay FSL-1.1-ALv2 with their provenance files.

## Current integration and target ownership

- `crates/ui/app` is the only desktop host; the old `drive/apps/tauri` host is deleted.
  Drive appears as the Files surface of the app navigation, not as a second shell.
- `sd-daemon` stays a supervised local process. Its FSL Cargo workspace is now copied to
  `aphrody-os/drive`; the desktop build helper prefers that workspace and falls back to
  the retained UI copy when the OS checkout is absent. The former `drive/` source remains
  here for active client code and provenance. Installed-runtime
  and data parity have not yet been qualified. OS owns the VDFS, index, libraries,
  sidecars, jobs and file actions.
- `crates/ui/drive` is the only native bridge (daemon supervision, socket/RPC, event
  subscriptions, local HTTP server, file opening, keybinds, drag). Only the host adapter calls
  `plugin:aphrody-drive|*`; Drive components never do.
- `aphrody-kernel` keeps generic OS capabilities; the webview gets no filesystem or policy
  authority. `aphrody-contracts` owns any shared versioned wire types.
- Optional HTTP delivery uses `drive/apps/web` with the same `@aphrody/app-ui` and
  `drive/packages/ts-client`; it is a host adapter for Aphrody, not a separate Drive application.
  `sd-server` is also staged in `aphrody-web/drive-server`; the existing site in
  `aphrody-web/crates/aphrody-site` owns the public HTTP origin and has an optional
  authenticated loopback Drive gateway. The HTTP routes, auth and embedded UI asset
  contract must pass parity checks before the old crate is retired. `aphrody-infra`
  owns deployment.
- `aphrody-ai` owns agent/runtime/models, AI apps, file analysis and the app-server. File
  actions reach Drive through typed OS/Contracts APIs; generic M3 components stay AI-free.

| Layer | Holds | Does not hold |
| --- | --- | --- |
| `@aphrody/m3-*` | Generic components driven by props and callbacks (`TagPill`, `RenameInput`, `FileThumb`, `GridItem`) | `SdPath`, library context, Drive router, Tauri plugins |
| `packages/app-ui` (not in repo) | Global navigation, public Chat/Files/Models/Settings views, consolidated Drive views | Direct SQLite, arbitrary filesystem bypass, browser and infrastructure administration |
| `drive/packages/interface` | Non-buildable FSL source archive; no package manifest, exports, or active imports | Active desktop or web mounting |

The target migration does not change FSL terms or move the public Files UI into the
server. Preserve the upstream source revision, notices, library schema, file identity and
offline data across repository moves. The [upstream audit](../../reference/DRIVE-UPSTREAM-DIFF.md)
lists the currently observed differences.

The [Drive FSL license](https://github.com/aphrody-labs/aphrody/blob/main/crates/os/drive/LICENSE) permits internal use but explicitly restricts
providing this software as a managed cloud or hosted service to third parties, as well as
third-party cloud storage, synchronization, data management and managed AI services based on
it. "Cloud oriented" here means connecting a user's own cloud volumes and synchronizing
their devices. A public hosted Drive offering requires separate rights or an independent
implementation; moving source to `aphrody-site` does not alter the license.

`packages/app-ui` (not in repo) is the sole maintained implementation of Aphrody navigation and its Files
surface. Tauri is the current desktop host. Optional HTTP delivery serves the same UI and does
not create a second Drive product or embed browser navigation in Aphrody.

Windows auxiliary to the old host (detached inspector, voice overlay, native context menus) are
not supported: the UI offers these actions only when `Platform` provides them.

## Known gaps

- The archived Overview `ContentBreakdown` and `ProjectCards` use simulated data. They are not
  active UI; any restored overview needs real daemon queries.
- The archived interface stylesheet styled `html` / `body` globally and hid every scrollbar. It
  is not mounted; keep any active styles scoped to `packages/app-ui` (not in repo)'s Files view.
- The `aphrody-drive` HTTP server listens on a random loopback port with
  `Access-Control-Allow-Origin: *` and no token, and path checks are lexical. Restrict it to the
  app origin/session and canonicalize paths before serving previews.
- Data directory: the plugin picks `~/.aphrody/drive` if it exists, else `~/.spacedrive`. An
  empty Aphrody directory can hide an existing Spacedrive library; migrate explicitly with a
  backup, never at startup.
- Adding cloud volumes in the UI is limited to S3, R2 and MinIO; other upstream adapters
  remain in the daemon. Expose them through truthful UI capabilities before claiming full
  cloud parity, without breaking existing libraries.
- Spacebot memory/autonomy/schedule routes are absent from the active UI. Their equivalents
  must be owned by AI and exposed through real Chat/Settings workflows before declaring parity;
  placeholder routes are not an acceptable substitute.

## Gates

- Bun graph: `bun install --frozen-lockfile`, `bun run bun:check`, stable codegen.
- UI: interaction and keyboard/focus tests on real routes, compact and wide widths.
- Drive: daemon Rust tests for actions and migrations, RPC envelope tests, `aphrody-drive` tests,
  test libraries with checksums before and after.
- Delivery: the built bundle contains `sd-daemon` and starts it without a dev server or network
  ([`../DESKTOP-INTEGRATION.md`](../../reference/DESKTOP-INTEGRATION.md) for how to verify a launched app).
- Server migration: compare `/health`, `/rpc`, `/events`, sidecars, auth, SPA deep links,
  environment flags and Docker/NAS delivery with the old binary before changing deployment.
- Feature preservation: track every upstream user feature to a current route/command or a
  named OS/AI/server owner, with data and interaction evidence; unresolved items stay open.
