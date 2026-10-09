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

## Guarded web activation adapter

`scripts/tools/infra/cloudflare-web-activate.ps1` fills the installed Infra
CLI's Cloudflare coverage gap. Plan is the default. It verifies exact owner
account/zone identities and the apex A / www CNAME, reads current SSL/HSTS
settings and both qualified R2 buckets' custom domains, and probes the origin
directly using curl `--resolve` with normal certificate validation.
Snapshots and a checksum-verified second copy stay under the protected home.

The live plan at 22:30 UTC proved apex TLS/status `0 200` and www `0 301`.
Cloudflare still had SSL `full`, disabled HSTS, a pending zone and no custom
domains on either `aphrody-assets` or `aphrody-dist`. An explicit Apply attempt
was refused before any mutation because the zone was pending; a subsequent
Plan confirmed unchanged settings. PowerShell parser validation passed.
The active-zone mutation path is not yet live-qualified.

Once the zone is active, Apply sets SSL `strict`, proxies only the qualified
apex/www records, enables HSTS for 30 days without include-subdomains/preload,
and reads back the exact settings and changed records. It checks unrelated
records against the snapshot. These settings use the official
[zone settings API](https://developers.cloudflare.com/api/resources/zones/subresources/settings/methods/edit/).
HSTS does not extend to broken subdomain origins. This adapter does not attach
R2 domains or repair service ingress; those remain separate required tasks.

DBFR ingress was identified through Docker mount inspection as
`aphrody-gateway-1`, mounting the current immutable Shenron release nginx
directory. Its successful `nginx -T` contains only Dragonballfr vhosts,
including mcp.dragonballfr.com. Aphrody ingress must be delivered through the
existing release/catalog owner, preserving this gateway and its TLS store.

## Follow-up: VPS catalog and public WASM, 22:39 UTC

The concurrent owner delivered the VPS ingress catalog in `c1eb4deb5b`.
Live SHA-256 matches the complete repository bytes for both
`tools/config/host/nginx/aphrody/aphrody.com.conf` and
`tools/config/host/nginx/aphrody/os.aphrody.com.conf`, and for
`tools/config/host/nginx/snippets/aphrody-security.inc`.
VPS `nginx -t` passes; native `aphrody infra validate --json` reports zero
errors/warnings, 28 services and 12 routes. Native Aphrody Web snapshots of
apex and OS render the product interface. This supersedes the earlier
apex-documentation-only routing observation. The full Rust/WASM UI migration
still requires its own qualification.

The web activation plan now includes the exact OS A record alongside apex/www;
all three direct origin TLS probes pass. The zone remains pending, so no proxy,
strict-mode or Cloudflare HSTS activation is claimed.

The CLI-WASM parity test formerly invoked Unix `mktemp`/`mkdir` and did not await
fixture writes. It now creates isolated native temporary directories, awaits
all fixture writes, and cleans up each owned directory. With the installed
native `aphrody` explicitly selected, all 8 tests / 58 assertions pass, with
zero skip or failure. Scoped TypeScript, oxlint and oxfmt pass.

`scripts/audit/live-cli-wasm-browser.ts --out <new-directory>` stages the
existing typed facade and WASM plus a qualification page and hash manifest.
It never replaces an existing stage. `--url` verifies the three public payload
hashes, the WASM MIME and rendered command results through
`aphrody web browser snapshot`. The native browser's private-IP guard was
retained after its loopback refusal; no browser policy was bypassed.

The owner-authorized R2 subagent uploaded four new keys under an isolated
qualification prefix and verified S3/public byte parity. Independent root
execution of the verifier on the
[public qualification page](https://pub-2a25b78efa294362ad9d988bb2deffeb.r2.dev/qualification/cli-wasm/715b7713e6f6e62-2f97ff566b71/index.html)
returns `WASM_BROWSER_PASS`: module version 1.0.0, RAG ABI 1, actual JSON repair
and HTML-to-Markdown execution. Module: 2,994,287 bytes, SHA-256
`715b7713e6f6e6237bc17269a3e289dd49928ec4e0a118e88c99bb63c4683fe2`.
This proves public browser command execution, not complete OS frontend migration
or signed source provenance for the pre-existing module. The qualification
manifest states that provenance limit explicitly; it is not an official release.

The separately owned [R2 domain receipt](r2-domains-2026-10-10.md) records the
real provider rejection of pending-zone custom-domain attachment. No assets/dist
custom domain activation is claimed while that dependency remains unresolved.

The native registry owner `aphrody pkg remote-info --source npm --version`
was run for all 28 exact `ready` versions from the existing publication plan.
Twelve are now present (runtime-sdk, agent-browser, api, update, bun,
drive-client, eslint-plugin-m3, fuzzy, identity, m3-fonts, m3-react and
m3-codemods). Sixteen remain absent, including cli-wasm 0.1.4 and product
0.3.1; no registry query was unavailable. This qualifies registry presence,
not package installation or all-publication completion. Original publisher
PID 24788 is still live and its output file remains empty; it was not restarted.
