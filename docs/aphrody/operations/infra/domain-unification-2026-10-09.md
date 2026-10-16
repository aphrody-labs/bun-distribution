<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody domain qualification, 2026-10-09

Native Windows observations through the installed `aphrody` capability owner and public DNS/HTTPS. Initial qualification was read-only. The subsequent scoped site apply is recorded below.

## Verified public behavior

- `aphrody ovh status`: authenticated EU application-key profile; `aphrody.com` is configured. Authentication values were not read or copied.
- Authoritative nameservers: `dns200.anycast.me`, `ns200.anycast.me`; apex A `51.255.162.6`; `www` CNAME `aphrody.com` (TTL 300).
- `aphrody ovh email audit aphrody.com --profile aphrody.com`: SECURE; MX, SPF, DMARC and four DKIM selectors pass. Preserve these records.
- Apex GET returns HTTP 200, 10,662 bytes, title, description and apex canonical. `/runtime` returns 200 with its own title, description and canonical. HTTP redirects to HTTPS. `www` serves 200 with the apex canonical.
- Public robots.txt allows crawling and declares the canonical sitemap. The sitemap contains 362 unique routes. The first 12 routes pass the scoped audit below. The full paced 362-route audit at 19:49 UTC finds 196 missing descriptions and three duplicate-title warnings, with no HTTP failures. Duplicate pairs: `/docs/runtime/cookies` and `/docs/runtime/http/cookies`; `/docs/project/contributing` and `/contributing`; `/docs/bundler/plugins` and `/docs/runtime/plugins`. Search rankings and Core Web Vitals remain unmeasured.
- `aphrody infra ssh exec --host vps|dbfr --cmd hostname` succeeds. Host connectivity is independent from deployment authority.

## Native owner correction

Installed `aphrody ovh dns info|audit` fails because the current OVH response contains `dnssecActivated`, while the native model required `isSigned`. The response reports DNSSEC active and Anycast available. `crates/infra/ovh/src/dns.rs` now accepts both spellings, retains the serialized native `isSigned` contract and rejects absent or non-boolean state. Regression tests cover enabled and disabled states in both formats. Installed CLI activation requires a rebuilt artifact; source correction alone does not repair the installed binary.

## Reproducible SEO audit

The Aphrody downloads/site owner now enriches `/docs/*` HTML at response time without editing the Bun documentation mirror: an absent or blank description uses the first article paragraph, whitespace-normalized, entity-decoded, escaped and bounded to 160 characters. Maintained descriptions remain intact. Document titles retain the source title and append readable route context, distinguishing the observed duplicate pairs without inventing alias redirects. HTML transformations read the source file instead of stale precompressed variants; other resources retain existing compression behavior. HEAD stays bodyless. Sixteen focused SEO and existing server tests (86 assertions), scoped strict TypeScript, oxlint and oxfmt pass. Twelve live pages with missing descriptions were fetched and transformed locally: 12/12 gain a description. This is local consumer evidence; the deployed service has not yet received the change.

```powershell
bun scripts/audit/live-domain-seo.ts https://aphrody.com 12
```

The read-only audit checks public nameservers/A records, sitemap discovery, sampled route status, HTML content type, title uniqueness, description, self-referencing canonical, language, H1 and noindex declarations. The optional route limit is 1–500; requests are sequential, paced by 100 ms below the declared nginx rate limit and have a 15-second timeout. Errors set exit code 1; warnings remain visible. It does not use credentials or browser cookies. An initial unpaced full audit triggered HTTP 503 rate limiting; the paced rerun resolves those transport failures while retaining genuine metadata findings.

## Cloudflare and OVH unification plan

### Live status, 2026-10-11

The connected Cloudflare account is `contact@aphrody.com`; the `aphrody.com` zone is present but still `pending` on `duke.ns.cloudflare.com` and `veda.ns.cloudflare.com`. Its candidate DNS set contains 27 records, with all web/mail records DNS-only. Cloudflare has no Access organization/apps enabled, no tunnel and no Pages projects. OVH remains authoritative on `dns200.anycast.me` and `ns200.anycast.me`; its registrar reports DNSSEC disabled, and Google DoH returns no parent DS. The candidate manifest now matches the live OVH/Cloudflare answers: `bun` and `os` were added, and the apex A was corrected to `51.77.147.152`. The read-only DNS audit passes all 24 declared record sets on both providers' authoritative servers. OVH has one redundant duplicate TXT record that Cloudflare has deduplicated.

The installed OVH profile can read the registered domain and DNS zone. The Aphrody Infra CLI has no registrar nameserver mutation command; do not change the delegation through an unreviewed alternate path. The public Omar repository is private, the `aphrody-labs` organization is on GitHub Free, and the repository has no Pages site. GitHub documents private Pages as an Enterprise Cloud capability. Do not publish repository content publicly as a workaround.

`cloudflared` 2026.10.0 is installed on Omar's Windows PC, but it is not authenticated or connected to a tunnel. This is only a prepared client; no public hostname or Access policy is active.

1. Keep the Git source private. For a private GitHub Pages site, obtain an organization plan that supports private Pages; otherwise host a private read-only Omar landing page behind Cloudflare Access without publishing the repository.
2. Export the OVH zone to the protected infrastructure backup store and verify its checksum. Inventory all record types, mail records, delegated subdomains and DNSSEC DS records; reconcile the full OVH set with the Cloudflare candidate and API state before changing delegation.
3. Choose one authoritative DNS provider. Do not maintain competing writable zones. Keep mail records DNS-only and preserve SPF/DMARC/DKIM targets. Proxy web records only after origin TLS and route parity qualify.
4. Use the installed cloudflared client to create a managed tunnel to the existing private Omar WebOS only after Access, device enrollment and the active zone are ready. Keep the origin reachable only over localhost/WireGuard; do not expose MCP, A2A, host-control or model endpoints publicly.
5. Follow the providers' DNSSEC migration sequence before changing nameservers; [OVH's DNSSEC guide](https://docs.ovhcloud.com/en/guides/web-cloud/domains/dns-dnssec) documents the dependency between DNSSEC and nameserver changes. Keep a documented rollback and verify parent DS/delegation as well as authoritative answers.
6. Prepare the Omar hostname and Access policy as a cataloged, device-posture-gated application; restrict identity to Omar and require the enrolled Cloudflare One client. Do not route the hostname until posture and origin probes pass.
7. Run the full bounded sitemap audit, browser performance/accessibility measurements and origin/provider health checks after activation. SEO improvement requires subsequent measured crawl/indexing evidence.

Host apply remains governed by [Cloud-ready setup](../cloud/CLOUD-READY.md). Concurrent native DNS/TLS, certificate and site-hosting work retains its existing claims.

## Scoped SEO activation

Commit `f9caa023f3` was pushed normally to the existing private remote. The declared downloads/site service received only its server source through native Infra SFTP, then the existing Compose downloads service was recreated through `aphrody infra ssh exec --host dbfr`. Before replacement, the old source SHA-256 was checked and its preserved backup was checksum-verified. No DNS, certificates, ingress or databases changed. The service health reports nine published artifacts. The paced public audit after activation checks all 362 sitemap URLs and reports zero findings, including the previously missing descriptions and duplicate titles. This validates public metadata responses; rankings, Core Web Vitals and homepage reskin deployment remain separate.
