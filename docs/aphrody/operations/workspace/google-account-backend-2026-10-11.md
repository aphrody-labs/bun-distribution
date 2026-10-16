<!-- SPDX-License-Identifier: Apache-2.0 -->

# Google account backend and OVH delivery — 2026-10-11

This bounded inspection reads source contracts and live provider metadata. It
never reads mail messages, credentials, browser secrets or token values. The
owner authorized the exact OVH DNS creation separately from backend deployment.

## Delivered DNS record

The native `aphrody infra ovh dns` owner authenticated successfully. Full record
inventory showed no existing `yohan` record before the plan and single apply:

```text
aphrody infra ovh dns add aphrody.com CNAME yohan aphrody.com. --ttl 300
aphrody infra ovh dns add aphrody.com CNAME yohan aphrody.com. --ttl 300 --apply
```

Created record ID: **5441130906**, CNAME `yohan.aphrody.com` → `aphrody.com.`,
TTL **300**. Both authoritative servers `dns200.anycast.me` and
`ns200.anycast.me` answered the new CNAME after apply. `DnsManager::add_record`
refreshes the zone automatically; a second refresh was unnecessary.

The four existing apex MX records remained unchanged: `mx0.mail.ovh.net.`
(priority 1, ID 5432868577), `mx1.mail.ovh.net.` (5, 5432868579),
`mx2.mail.ovh.net.` (50, 5432868580), `mx3.mail.ovh.net.` (100, 5432868578).
No NS, TXT, DNSSEC or mail routing changes were applied.

Initial read-only VPS nginx inventory contained no `yohan.aphrody.com` server name. The
existing apex certificate's public SANs excluded this name. DNS success alone therefore
did not establish valid TLS or an authenticated account route. The independent
HTTPS delivery below qualifies transport; account authentication remains unavailable. The DNS zone-info CLI currently fails its
`isSigned` schema requirement against the provider's `dnssecActivated` response;
record listing/creation work independently. This did not justify changing DNSSEC.

## Delivered dedicated HTTPS frontend

The existing native Infra typed nginx renderer produced
`tools/config/host/apps/vps/yohan-account/nginx.json` and `nginx.conf`. Only the
new `yohan.aphrody.com` virtual host was installed. Its HTTP challenge uses the
existing `/var/www/letsencrypt` webroot; a public HTTP fixture round trip passed
before certificate issuance. Existing Certbot 4.0.0 issued an independent
`yohan.aphrody.com` certificate, SAN exactly that name, expiring 2027-01-09.
The existing Certbot renewal timer remains enabled. The actual private key,
after following its managed symlink, has mode 0600 and root ownership; no key
content was read.

The HTTPS vhost proxies the current public Aphrody frontend at
`10.200.77.3:18803`. Exact login/callback/session/scopes/logout paths return
503 JSON with `Cache-Control: no-store` until the real Google client/callback
is qualified. This avoids the upstream's observed static-page HTTP-200 fallback
being presented as a working login. RPC, events and mailbox API prefixes return
404; no anonymous mailbox or privileged backend was exposed.

The delivery owner retrieved the existing protected Google client and observed
Google's primary `redirect_uri_mismatch` response for the intended
`https://aphrody.com/auth/google/callback`. The client exists; the registered
redirect still needs its Google owner configuration. No client ID, secret or
provider token is recorded here. Removing the alias's explicit auth-unavailable
guards requires a qualified account flow, including its intended canonical
origin and callback/cookie binding.

Normal public DNS HTTPS checks returned frontend HTTP 200 with certificate
verification success; all five exact auth paths returned 503, and the four
RPC/events/mail guard checks returned 404. `nginx -t` passed before both
bootstrap and final reloads. The native typed rendering is reproducible.
Final deployed vhost SHA-256:
`588031b63e3f27d69fe6b611670622b616e3ac0963b91ffedcdea636c51b236a`.

The original apex nginx SHA-256 remained
`3751eed7eb38f53643e5204fd33c7f1f83e15a8b929b40f18830f2a59cf2a842`,
and its existing public certificate SHA-256 remained
`e9907fa4cca1ff78d0c3f1a69c514fb9a4fbbd96cacfc0f1d718860f4cc73ae2`.
Protected config backups under `/var/backups/aphrody/yohan-20261011T1312Z`
and hash-guarded rollback covered only the new vhost; other sites and certificate
lineages were preserved. Transport success does not qualify an account login
or mail synchronization.

## Existing provider and mail capability owners

| Boundary                | Observed source or metadata                                                                                                                                                                        | Qualification limit                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows Google provider | Delivery owner reports active user CLI credentials/project `aphrody` with explicit `aphrody-bot` service-account impersonation                                                                     | CLI authority is distinct from the MCP process environment; no token was printed                                                                                            |
| VPS Google provider     | Native Infra SSH found `/usr/bin/gcloud`, selected project `aphrody`, an active service-account identity belonging to `rgfr-8927d`, and a standard credential database present                     | Selected project does not prove IAM access; service-account credentials do not grant the user's Gmail mailbox                                                               |
| DBFR Google provider    | No `gcloud` executable in PATH or standard home credential files observed                                                                                                                          | No remote provider authentication established                                                                                                                               |
| Native MCP `gcp_status` | `crates/os/kernel/core/src/cloud.rs` checks API-key environment variables and an existing `GOOGLE_APPLICATION_CREDENTIALS` file                                                                    | `configured=false` in this process does not mean a different host's gcloud CLI is unauthenticated                                                                           |
| Connected Gmail app     | Delivery owner verified the selected account and bounded inbox/sent label counts through the existing connector                                                                                    | Connector authorization does not export reusable credentials to Bun or VPS; no message content was inspected                                                                |
| Bun Google OAuth        | `packages/bun-google/src/oauth.ts` has PKCE/nonce/state/session owner contracts, `/auth/google/login`, callback, session/scopes/logout and protected `onTokens` injection                          | Default store is bounded process memory. Persistent owner store, existing client has a redirect URI mismatch; successful callback and Gmail scope consent are not qualified |
| Bun Google services     | `packages/bun-google/src/services.ts` wraps actual Drive, Docs and Gemini APIs through `bun:google` credential providers                                                                           | No Gmail mirror wrapper or deployed mailbox service is established by these wrappers                                                                                        |
| Existing Gmail adapter  | `crates/os/kernel/comps/drive/adapters/gmail/adapter.toml` and `sync.py` define readonly/metadata OAuth scopes and JSONL upserts for threads/messages/labels/attachments, with history cursor sync | Declared Python3 adapter needs its actual runner and protected OAuth-token injection; presence is not execution proof                                                       |
| VPS/DBFR services       | Bounded native systemd inventory found existing Aphrody infrastructure units, but no matching Gmail/mail-mirror unit; both have an Aphrody home, neither the inspected `~/.aphrody/mail` directory | This bounded check does not exclude an unrelated container or a differently named protected store                                                                           |

## Concrete protected backend plan

Keep the existing native Gmail adapter/source capability as the data owner.
Bind its account explicitly to the authenticated Google subject; inject only
its authorized readonly token from the protected owner store. Persist cursor,
mail records and attachments in that account's private Drive/source store,
outside repositories and public static roots. Do not infer mailbox access from
GCP project selection, a copied Chrome profile or the public search service.

Use the existing OAuth `onTokens` contract for protected token ownership and
inject a persistent transaction/session owner store before running multiple
workers. The actual runner should emit the adapter's existing JSONL source
operations, preserving incremental history cursors and explicit unavailable
states. Keep the declared adapter runtime qualification separate from a future
Bun-native migration; no Python job was launched by this inspection.

`yohan.aphrody.com` now serves the public frontend through its verified TLS
virtual host; the authenticated account flow remains unavailable. Its backend can access that account's source
through the existing authorized Drive/source transport after login. Mail and
attachments must never be public catalog assets. Adding this web alias leaves
OVH's existing MX routing intact; it does not provision a custom-domain Gmail
mailbox. No speculative public mailbox endpoint was installed.

Remaining account/backend proofs are a configured
OAuth client with the exact callback, account binding/scope grant, protected persistent
store, actual incremental adapter run and private authorized retrieval. None is
replaced by DNS or provider credential-file presence.
