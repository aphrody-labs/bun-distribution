<!-- SPDX-License-Identifier: Apache-2.0 -->
# Public Bun WebOS static release

Source: `aphrody-labs/bun`, `packages/bun-webos/public-site`. The public page runs
its example locally in the visitor's browser. The real WebOS server and assistant
remain separately configured local/private integrations.

The VPS Nginx apex adds `snippets/public-webos.inc`. Its exact allowlist serves
three page files and three checksummed public package archives under
`https://aphrody.com/labs/webos/`. Every other path in that prefix returns 404.
Only GET/HEAD is accepted. The existing apex origin remains
`http://10.200.77.3:18803`; no DBFR application or private Omar route changes.

`omar.aphrody.com` remains private at `10.200.77.10`. The VPS vhost refuses
public requests with 403 and retains its dedicated certificate. HTTP allows the ACME webroot challenge for that
dedicated certificate. `public-webos.routes.json` is the Infra `NginxConfig`
source for the dedicated rendered vhost.

Releases live under `/var/www/aphrody-public-webos/releases/<source-and-id>`.
Record the immutable Bun source commit, exact file SHA256 and archive provenance
in `PROVENANCE.json`, then verify remote bytes before switching `current`.
Keep the previous pointer and the hash-verified original apex config in a
checkpoint. Apply only if original hashes and expected target absence still
match, test with `nginx -t`, then reload. A failed syntax test restores the
checkpoint before any reload. Rollback restores that apex file and previous
pointer, disables the additive Omar vhost, tests and reloads Nginx. Preserve all
release files and the dedicated certificate.

DNS owner: OVH. The exact `omar` A record was restored to `10.200.77.10` with
its identifier and TTL300 preserved, then the zone refreshed. Preserve all other
records, the local Windows hosts pin and the existing apex certificate.
Qualification checks page/asset bytes, archive SHA256, certificate hostname,
redirects and rejected API/model/terminal/unknown paths, plus existing apex,
documentation and Aphrody OS behavior. Six final HTTP/HTTPS private-alias probes
returned 403 without a redirect; the generic apex page returned200. The existing
apex config retains the DBFR origin at `10.200.77.3:18803`.

The first immutable release is `614b3dde802e-20261011`. Its original apex checkpoint
is `/var/backups/aphrody-public-webos/614b3dde802e-20261011/apex.conf` with SHA256
`3751eed7eb38f53643e5204fd33c7f1f83e15a8b929b40f18830f2a59cf2a842`.
Public browser qualification used a new isolated tab: page/CSS/JS200, no host
API requests or console errors, and working local example buttons. Private
API/model/terminal paths and unknown downloads were refused. Nginx syntax passed
before every reload. The full Infra catalog validator still reports the unrelated
existing `omar-redis: unknown topology host local` entry; this release adds no
catalog validation error.

The final active release is `105ac20a30d6-20261011`, from Bun commit
`105ac20a30d635e398e3e7131c75260176e68ff9`. Its WebOS archive is 6190879 bytes,
SHA256 `e6f8387163cde259a1dc2e44be3cf779bfd86cd774437a869ad5e8ec4d374aba`.
The supervisor archive uses commit `e3f9ae9d416a2a82dd435b0c63c267cb2c4dd485`,
19763 bytes, SHA256 `7570448dcd2a18dbc7e97d89a2e2bd507b8cf69c4a189bec45953810621aa5c1`.
The tools archive remains 25779 bytes, SHA256
`af2836de41caae5c165ce1575fdad3e7401147711f996461fff15cab3c35f6ec`.
All three are served under `/labs/webos/downloads/`; this is archive distribution,
not registry publication. Fresh consumer install preserved the bundled owner
Tailwind1.4.4 source. Extraction followed by production install and build passed
with the compatible public Tailwind0.1.0 package. The compiled server served its
page/CSS/JS from an unrelated working directory and refused system metadata403.

The final activation hash-checks seven staged files and the live apex/private
alias configs, records the previous release in `PREVIOUS`, and replaces only the
`current` symlink atomically. It needs no Nginx config modification or reload.
To roll back, first check that `current` still points to this final release and
that `PREVIOUS` matches the first release, then atomically replace the symlink.
Preserve both releases and all certificates. Local reviewed scripts are
`C:/bun/.coord/omar-public-final-activate.sh` and
`C:/bun/.coord/omar-public-final-rollback.sh`; they contain the exact hash guards.
