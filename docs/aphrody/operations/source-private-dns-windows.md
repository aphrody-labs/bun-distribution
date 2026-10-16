# Source private DNS on native Windows

Owner: Aphrody Infra boot. Helper: `tools/config/host/windows/source-private-dns.ps1`.
The only mapping is `source.aphrody.app` to `10.200.77.1`; it does not grant forge
permissions or configure server authentication.

`-Mode plan` reads state and reports hashes and prerequisite booleans. `-Mode apply`
requires a genuinely elevated Windows token, the selected `aphrody` WireGuardNT
route on `10.200.77.0/24`, and successful native Windows TLS verification to the
private IP with the Source hostname. It never starts a task/service, requests UAC,
changes keys, installs a CA, disables TLS verification or changes adapter DNS.

The helper appends one exact owned hosts block, preserves all existing bytes and
ACLs, and uses an exclusive file handle plus before/after SHA256 checks. Foreign
Source entries, altered/duplicate owned blocks and concurrent changes are refused.
No hosts backup, credential, cookie store or TLS response is written or displayed.

The reviewed helper was applied through WinClean and genuine Windows sudo/UAC.
Route and native TLS qualification passed. Source now resolves to `10.200.77.1`;
ordinary hostname HTTPS `/user/settings` returns HTTP 200. A private request
from `.4` identifies the `aphrody-dev` profile without credentials.
The declared `aphro-pc` alias belongs
to the local Windows mesh peer. A strict native SSH probe using its existing
pinned IP/key reaches SSH but public-key authentication is denied; no remote admin
token is qualified. Existing task declarations are not evidence of usable elevation.

## Cloudflare client prerequisite

Cloudflare One Client 2026.8.2110.0 is now installed. The signed `CloudflareWARP`
service is Running/Automatic; the separate cloudflared connector remains active.
This helper qualifies the direct WireGuard path. WARP enrollment is verified;
Cloudflare client routing remains unsuccessful.

Cloudflare documents a [managed Windows MSI deployment](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/mdm-deployment/)
and the [standard daemon/GUI installation paths](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/).
The Aphrody Infra adapter `tools/config/host/windows/cloudflare-one-client.ps1`
downloaded, verified and installed the official MSI once. See
[client qualification](cloudflare-one-client-windows.md). The Cloudflare organization, owner enrollment,
private `/24` route, precise split-tunnel exclusions and Source Gateway DNS rule
are now configured in
[`cloudflare-private-network.json`](../../../tools/aphrody/config/host/wireguard/cloudflare-private-network.json).
The Windows device is installed and enrolled in `aphrody-labs` (managed=true).
WARP reported Connected/unstable and broke Source private HTTPS; disconnecting
WARP restored hostname HTTP 200. It remains disconnected for WireGuard access.
