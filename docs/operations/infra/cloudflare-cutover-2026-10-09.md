<!-- SPDX-License-Identifier: Apache-2.0 -->
# Cloudflare R2 S3 and guarded domain transition, 2026-10-09

The owner authorized completing the existing provider setup, bucket S3 credentials and domain transition. Existing deployed Cloudflare API token `6e7abc281134af042474d78bdb7bc841` and the additional native token remain intact; no token rotation or revocation occurs.

## Qualified S3 access

`scripts/tools/infra/cloudflare-r2-s3.ps1` creates one object read/write token scoped to the verified `aphrody-assets` and `aphrody-dist` buckets only, using the live selectable Workers R2 Storage Bucket Item Write permission. The [official R2 API contract](https://developers.cloudflare.com/r2/api/tokens/) defines bucket resources as account/jurisdiction/bucket tuples, access key ID as the issued token ID, and secret key as SHA-256 of its value. Both verified buckets use the default jurisdiction.

Issued token ID: `7ed42ead9a973dac4ff8814ad7176f46`. Credential material is isolated in configured Aphrody home `auth/cloudflare/r2-s3.dpapi`, encrypted by CurrentUser DPAPI and protected by the existing owner/SYSTEM directory ACL. Duplicate issuance is refused. No credential is logged or placed in process arguments.

`scripts/audit/r2-s3-protected.ts` uses native Bun S3Client to list and HEAD an existing object, then PUT/HEAD/GET an unpredictable object under `_aphrody-qualification/`, verify its payload, and delete only that newly created object. Both buckets pass on the owner's Windows workstation, VPS and DBFR. Existing objects are preserved.

`scripts/tools/infra/r2-s3-distribute.ps1` fills the existing protected Cloudflare consumer files on PC/VPS/DBFR while preserving API credentials and other fields. Backups are checksum verified. Windows inherits the existing protected file ACL; remote files and backups use 0600 and their consumer directory uses 0700. Native Infra exec exposes no stdin transport; the installed qualified SSH client carries credential JSON on encrypted stdin, never command arguments or an unprotected transfer file. Remote qualification runs with process-only credentials. User/machine environment variables are not written.

## Concrete DNS plan and guards

`scripts/tools/infra/domain-cutover.ps1` reads the real OVH records, BIND export default TTL, Cloudflare records, assigned nameservers and DNSSEC state. Plan is the default action. Protected checksum-verified snapshots and the sanitized plan are saved under configured home `backup/dns/cutover-<timestamp>`. It preserves the concurrent owner's existing Cloudflare catalog.

Live parity is zero differences: OVH has 28 records, Cloudflare 25. Canonical comparison excludes provider NS/SOA, applies the verified `$TTL 3600` to OVH TTL=0, maps legacy SPF to its TXT representation and compares unique effective record sets, including MX priority and SRV priority/weight/port/target. All Cloudflare records remain DNS-only; mail data matches.

Assigned nameservers are `duke.ns.cloudflare.com` and `veda.ns.cloudflare.com`. OVH DNSSEC is enabled; authoritative `.com` servers `a.gtld-servers.net` and `b.gtld-servers.net` each return one DS. The script verifies transaction/question identity, successful authoritative untruncated responses and DS/SOA counts over bounded UDP. Absence requires actual authoritative negative SOA proof from both parents; a timeout or parser failure cannot authorize nameserver writes.

The live public HTTPS certificate initially fails hostname verification because the origin serves another site's certificate. Domain actions refuse all mutations until real HTTPS validates and record parity is zero. Root owns repair through the declared hosting catalog. No TLS-validation bypass or proxy workaround is used.

The explicit DisableOvhDnssec action uses the official OVH zone DNSSEC DELETE endpoint. SwitchNameServers requires OVH disabled status and both authoritative parent DS absence proofs before the official registrar nameServers/update POST. Actions remain bounded to `aphrody.com`. Cloudflare DNSSEC/registrar DS reactivation requires active delegation and a separately verified provider DS registration flow; it is not inferred from the pending zone.

Native CLI help establishes that installed OVH supports reads but has no nameserver/DNSSEC mutation command, so the guarded HTTPS adapter fills that demonstrated gap. The [live official OVH schema](https://eu.api.ovh.com/1.0/domain.json) defines the selected operations and payloads. Parser checks, scoped strict TypeScript and oxlint/oxfmt, checksum snapshots, live parent DS proofs and real S3 operations qualify the implemented paths. No domain mutation has been applied while HTTPS remains invalid.
