# Steam community sources

Pinned external owners under `vendor/steam/<name>` (shallow Git submodules, upstream URLs, upstream
licenses intact). They are reference and porting sources for `crates/re/src/steam` (Rust) and
`packages/re/src/steam` (Bun). They are not built by the workspace and not linked into any binary,
so copyleft licenses stay confined to the checkout of the submodule itself.

| Path | Upstream | License | Role in Bun OS |
| --- | --- | --- | --- |
| `vendor/steam/steamkit` | SteamRE/SteamKit | LGPL-2.1 | Reference Steam network protocol (CM, auth, CDN, depot) behind `steamroom` |
| `vendor/steam/depotdownloader` | SteamRE/DepotDownloader | GPL-2.0 | Reference depot downloader; behavior parity for `bunre-steam` |
| `vendor/steam/protobufs` | SteamTracking/Protobufs | Unlicense | Canonical Steam protobuf definitions, field numbers for `manifest.ts` and appinfo |
| `vendor/steam/valvekeyvalue` | ValveResourceFormat/ValveKeyValue | MIT | Reference text/binary KeyValues semantics for `kv.ts` |
| `vendor/steam/steamappinfo` | xPaw/SteamAppInfo | MIT | Reference `appinfo.vdf` / `packageinfo.vdf` parser for `appinfo.ts` |
| `vendor/steam/steamwebapidocumentation` | xPaw/SteamWebAPIDocumentation | MIT | Generated Web API interface list, cross-check for `webapi.ts` |
| `vendor/steam/internalsteamwebapi` | Revadike/InternalSteamWebAPI | MIT | Unofficial and internal Web API endpoints for `api_endpoint` |
| `vendor/steam/python-steam` | ValvePython/steam | MIT | Reference client, CM, WebAuth and VDF |
| `vendor/steam/steamctl` | ValvePython/steamctl | MIT | Reference CLI: depot, workshop, cloud, authenticator |
| `vendor/steam/node-steam-user` | DoctorMcKay/node-steam-user | MIT | Reference Steam client protocol for JavaScript |
| `vendor/steam/steamworks-js` | ceifa/steamworks.js | MIT | Reference Steamworks bindings from JavaScript |
| `vendor/steam/facepunch-steamworks` | Facepunch/Facepunch.Steamworks | MIT | Reference Steamworks API surface (C#) |
| `vendor/steam/steamworks-net` | rlabrecque/Steamworks.NET | MIT | Reference Steamworks API surface (C#) |
| `vendor/steam/steamlocate-rs` | CosmicHorrorDev/steamlocate-rs | MIT | Reference Steam install and library discovery in Rust |
| `vendor/steam/archisteamfarm` | JustArchiNET/ArchiSteamFarm | Apache-2.0 | Reference account, inventory, trading and plugin model |
| `vendor/steam/steamachievementmanager` | gibbed/SteamAchievementManager | Zlib | Reference achievements and stats schema handling |
| `vendor/steam/steamtools` | BeyondDimension/SteamTools | GPL-3.0 | Reference toolbox features; read for behavior only |

## Rules

- Revisions are pinned by the submodule gitlinks and mirrored in `sources.lock.json`.
- Adopt behavior by reimplementing it in `crates/re` or `packages/re` with first-party attribution.
  Never copy GPL or LGPL code into Apache-2.0 first-party sources; keep notices in `NOTICE`.
- Update a pin with `git submodule update --remote --depth 1 vendor/steam/<name>` and commit the gitlink.
