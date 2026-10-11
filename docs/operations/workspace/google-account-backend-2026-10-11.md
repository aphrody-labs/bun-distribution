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

Read-only VPS nginx inventory contains no `yohan.aphrody.com` server name. The
existing apex certificate's public SANs exclude this name. DNS success therefore
does not establish valid TLS or an authenticated account route; the deployment
owner must qualify those separately. The DNS zone-info CLI currently fails its
`isSigned` schema requirement against the provider's `dnssecActivated` response;
record listing/creation work independently. This did not justify changing DNSSEC.

## Existing provider and mail capability owners

| Boundary                | Observed source or metadata                                                                                                                                                                        | Qualification limit                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows Google provider | Delivery owner reports active user CLI credentials/project `aphrody` with explicit `aphrody-bot` service-account impersonation                                                                     | CLI authority is distinct from the MCP process environment; no token was printed                                                                  |
| VPS Google provider     | Native Infra SSH found `/usr/bin/gcloud`, selected project `aphrody`, an active service-account identity belonging to `rgfr-8927d`, and a standard credential database present                     | Selected project does not prove IAM access; service-account credentials do not grant the user's Gmail mailbox                                     |
| DBFR Google provider    | No `gcloud` executable in PATH or standard home credential files observed                                                                                                                          | No remote provider authentication established                                                                                                     |
| Native MCP `gcp_status` | `crates/os/kernel/core/src/cloud.rs` checks API-key environment variables and an existing `GOOGLE_APPLICATION_CREDENTIALS` file                                                                    | `configured=false` in this process does not mean a different host's gcloud CLI is unauthenticated                                                 |
| Connected Gmail app     | Delivery owner verified the selected account and bounded inbox/sent label counts through the existing connector                                                                                    | Connector authorization does not export reusable credentials to Bun or VPS; no message content was inspected                                      |
| Bun Google OAuth        | `packages/bun-google/src/oauth.ts` has PKCE/nonce/state/session owner contracts, `/auth/google/login`, callback, session/scopes/logout and protected `onTokens` injection                          | Default store is bounded process memory. Persistent owner store, configured client, successful callback and Gmail scope consent are not qualified |
| Bun Google services     | `packages/bun-google/src/services.ts` wraps actual Drive, Docs and Gemini APIs through `bun:google` credential providers                                                                           | No Gmail mirror wrapper or deployed mailbox service is established by these wrappers                                                              |
| Existing Gmail adapter  | `crates/os/kernel/comps/drive/adapters/gmail/adapter.toml` and `sync.py` define readonly/metadata OAuth scopes and JSONL upserts for threads/messages/labels/attachments, with history cursor sync | Declared Python3 adapter needs its actual runner and protected OAuth-token injection; presence is not execution proof                             |
| VPS/DBFR services       | Bounded native systemd inventory found existing Aphrody infrastructure units, but no matching Gmail/mail-mirror unit; both have an Aphrody home, neither the inspected `~/.aphrody/mail` directory | This bounded check does not exclude an unrelated container or a differently named protected store                                                 |

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

`yohan.aphrody.com` should serve the real authenticated account frontend through
its own verified TLS virtual host. Its backend can access that account's source
through the existing authorized Drive/source transport after login. Mail and
attachments must never be public catalog assets. Adding this web alias leaves
OVH's existing MX routing intact; it does not provision a custom-domain Gmail
mailbox. No speculative public mailbox endpoint was installed.

Required delivery proofs are valid SAN/TLS and intended host routing, configured
OAuth client and exact callback, account binding/scope grant, protected persistent
store, actual incremental adapter run and private authorized retrieval. None is
replaced by DNS or provider credential-file presence.
