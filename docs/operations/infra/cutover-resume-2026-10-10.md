<!-- SPDX-License-Identifier: Apache-2.0 -->
# Domain cutover resumption, 2026-10-10

Read-only observations on the native Windows owner workstation, around
00:27 Europe/Paris (2026-10-09 22:27 UTC). This receipt does not supersede
the concurrent Cloudflare catalog or claim provider activation.

## Registrar and delegation

Two fresh executions of `scripts/tools/infra/domain-cutover.ps1 -Action Plan`
returned zero effective DNS differences (28 OVH records, 25 Cloudflare records),
preserved mail, validated HTTPS and the assigned nameservers
`duke.ns.cloudflare.com` / `veda.ns.cloudflare.com`.
Both `a.gtld-servers.net` and `b.gtld-servers.net` returned authoritative
negative SOA proofs with zero DS records. OVH still returned
`disableInProgress`; Cloudflare was `pending`. The existing guard requires
OVH `disabled`, so no nameserver mutation was attempted. Recheck that status
before `SwitchNameServers`, then verify actual delegation and zone activation.
Checksum-backed plans remain in the protected Aphrody home, not in Git.

## SSH and public service routing

The installed capability owner `aphrody infra ssh exec --host vps|dbfr --cmd`
successfully executed fresh reads on both hosts. The previously reported
aws-lc crash was not reproduced by these commands; this does not qualify all
SSH code paths or establish that the underlying issue is fixed.

VPS has nginx listening on 80/443 and only `aphrody.com` in
`/etc/nginx/sites-enabled`; its site listens on `127.0.0.1:8083`.
DBFR has the actual downloads, fonts and bot listeners:

| Service | DBFR probe | Result |
| --- | --- | --- |
| downloads | `http://127.0.0.1:8797/health` | 200 |
| cdn/fonts | `http://127.0.0.1:8796/health` | 200 |
| bot | `http://127.0.0.1:4010/healthz` | 200 |

HTTPS probes to DBFR loopback with each public hostname through curl
`--resolve` failed hostname verification (exit 60, status 000). No TLS
validation bypass was used. `/etc/nginx/sites-enabled` does not exist there;
the live ingress owner still needs identification. The repository route
catalog declares these three upstream ports, but that declaration does not
prove correct host selection or a deployed public certificate.

Before proxying these names, prepare the existing Infra ingress/catalog
plan for the actual service host, qualify certificates, apply through the
owner and verify each public endpoint. Audit creator/admin/mcp/nie separately;
do not redirect them to unrelated services or reactivate retired workloads.

## Publication and remaining work

The existing npm batch had live Bun processes 24788, 39548 and 4124 during
this observation. `var/lint/npm-apply.txt` remained empty, last written at
00:12:30 local time. This is neither successful publication nor a terminal
failure. Do not restart while the original process remains live; inspect its
terminal result and registry versions before claiming completion.

Pending: registrar completion and NS switch; active Cloudflare delegation;
strict TLS, qualified web proxy records and HSTS; approved R2 custom domains;
public subdomain routing/TLS; final npm publication evidence. The Cloudflare
[custom-domain API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/subresources/custom/methods/create/)
is the provider contract for attaching R2 bucket domains; bucket credentials
alone do not establish public domain activation.

## Receipt validation

The repository `bun run docs:check --skip-ecosystem` failed on existing stale
generated documents: STATE.md, README.md, docs/README.md and documentation.json.
Concurrent owners already have edits in that documentation batch; this receipt
does not regenerate or take ownership of those files. The new receipt's local
script reference exists, and scoped whitespace/integrity checks pass. No engine
build is required for this documentation-only batch. Global docs closure remains
pending.
