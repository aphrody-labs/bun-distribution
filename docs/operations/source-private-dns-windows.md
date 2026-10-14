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

The executable remains subject to root review before live application. Current
preflight: local token is not elevated; Source resolves to public Cloudflare;
private TLS now passes Windows Schannel trust with the issued Let's Encrypt
Source certificate. A direct private request from `.4` returns HTTP 200 and the
`aphrody-dev` profile without credentials; no hosts change is implied.
The declared `aphro-pc` alias belongs
to the local Windows mesh peer. A strict native SSH probe using its existing
pinned IP/key reaches SSH but public-key authentication is denied; no remote admin
token is qualified. Existing task declarations are not evidence of usable elevation.

## Cloudflare client prerequisite

Native Windows preflight found no `WarpSvc`, `warp-cli`, standard daemon/GUI paths,
or uninstall record for Cloudflare WARP/Cloudflare One Client. The existing
`cloudflared` connector and Windows `WarpJITSvc` do not establish device-client
installation or enrollment. This helper currently qualifies the direct WireGuard
path only; it does not claim Cloudflare client routing.

Cloudflare documents a [managed Windows MSI deployment](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/mdm-deployment/)
and the [standard daemon/GUI installation paths](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/).
A future installer adapter belongs to Aphrody Infra, for example
`tools/config/host/windows/cloudflare-one-client.ps1`; none is created or executed
by this batch. Preserve protected enrollment secrets outside repository/arguments,
and qualify legitimate Windows installation authority and actual private routing
before claiming client connectivity. The Cloudflare organization, owner enrollment,
private `/24` route, precise split-tunnel exclusions and Source Gateway DNS rule
are now configured in
[`cloudflare-private-network.json`](../../tools/config/host/wireguard/cloudflare-private-network.json).
The Windows device has not been installed or enrolled. Disk capacity is also
insufficient for a qualified MSI installation; no download or activation occurred.
