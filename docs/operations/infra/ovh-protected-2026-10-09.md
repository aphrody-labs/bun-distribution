<!-- SPDX-License-Identifier: Apache-2.0 -->
# Protected native OVH audit, 2026-10-09

The owner's authorized OVH service account is stored only at the configured Aphrody home `auth/ovh/service-account.dpapi`, encrypted with Windows CurrentUser DPAPI. Its directory and files allow only the current owner and SYSTEM. The credential pair is never written to repository files, persistent environment variables or task arguments. Provider histories remain in their existing isolated stores.

`scripts/tools/infra/ovh-protected.ps1` decrypts in memory and supplies credentials only to native `aphrody ovh` child processes through their process environment. Each hidden child has a 45-second deadline. Raw command output stays in memory; the protected `auth/ovh/audit-status.json` contains only authentication/read qualification booleans and exit codes. Exit 1 means authentication failed; exit 2 means registrar/DNS read qualification failed; exit 0 requires authentication, registrar verification and actual DNS-record reads to succeed. No DNS, nameserver, DNSSEC, mail or IAM writes occur.

The latest live audit authenticates using OAuth client credentials, verifies registrar information for `aphrody.com` and successfully reads 28 typed DNS records. The installed records command has no JSON option; its fixed header/separator and numeric ID/TTL rows are validated in memory, and only a count and verification boolean are persisted. Optional zone metadata currently fails in the installed CLI with a missing-field schema mismatch, preserved separately as `dnsZoneMetadata`. Earlier reads returned HTTP 404, but that is not the latest result. The existing source correction accepting OVH `dnssecActivated` requires a qualified installed binary before zone metadata readiness can be claimed. Authentication does not establish permission for unrelated resources.

## Durable declared task

`tools/config/ovh-automation.json` declares one read-only task. Installed native Infra planning was inspected but produced a highest-privilege task with unresolved root and without the declared six-hour trigger. That plan was not applied. `scripts/tools/infra/ovh-automation.ps1` resolves and prints the concrete declared task, and its `-Apply` fallback uses native Windows Task Scheduler for this demonstrated adapter gap.

The registered task is `\Aphrody\Aphrody OVH protected audit`: current interactive owner, Limited privilege, hidden Windows PowerShell, at logon and every six hours, five-minute execution limit and IgnoreNew concurrency. Its wrapper and catalog are activated only under the configured home `automation/ovh`. Task XML verifies the principal, trigger, command and deadline. The live wrapper reports authenticated=true, registrar verified=true and verifiedRecords=true; it exits 0 for successful read scope while preserving the optional metadata schema diagnostic.

PowerShell parser checks, catalog parsing, native plan inspection, live DPAPI authentication, protected ACL inspection and Task Scheduler XML/read execution qualify this batch. No privileged account propagation, live DNS migration, Cloudflare zone activation or new IAM grants are included.
