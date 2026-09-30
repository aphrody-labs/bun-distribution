# @aphrody/ovh

Native in-process OVHcloud SDK and CLI engine for Aphrody Infra, built exclusively for **Bun** (`n2b` compliant, zero Node.js/CJS runtime dependencies).

## Capabilities

- **Pure Bun Cryptographic Signature**: Uses `Bun.CryptoHasher("sha1")` conforming strictly to OVH `$1$` specification.
- **Automated Clock Drift Correction**: Automatically computes `/auth/time` server delta and retries on time drift.
- **DNS Management**:
  - Zones & records CRUD with typing (`A`, `AAAA`, `CNAME`, `MX`, `TXT`, `SRV`, `NS`, `SPF`, `DKIM`).
  - Automated batch `setA` for apex and `www` records.
  - Standard BIND zone export (`exportZone`).
  - DNSSEC audit and production subdomain verification (`auditZone`).
- **VPS Operations**:
  - Hardware specifications inspection (`vcore`, `memory`, `disk`, cluster, model).
  - Network IP routes and reverse DNS mappings.
  - Ping and live status check.
  - Guarded hardware reboot (`--apply`).
- **Email Deliverability**:
  - Domain email service plan and mailbox accounts.
  - Aliases and redirections management.
  - Deliverability Scorecard (`auditEmailDns`): checks MX (`mail.ovh.net`), SPF (`include:mx.ovh.com`), DMARC (`_dmarc`), and DKIM selectors (`ovhmo-selector-{1,2}`).
- **Profile Resolution**:
  - Native multi-account segregation: `aphrody.com`, `rosegriffon.fr`, `dragonballfr.com`.
  - Multi-format parser: Bash exports (`.bash_secrets`), INI format (`.ovh.conf`), and Certbot (`dns_ovh_*`).

## Usage

```bash
# Inspection and profiles
bun run ovh:profiles
bun run ovh:status

# DNS management
bun run ovh:dns records aphrody.com
bun run ovh:dns audit aphrody.com

# VPS management
bun run ovh:vps list
bun run ovh:vps info vps-xxxx

# Email deliverability audit
bun run ovh:email audit aphrody.com
```

## TypeScript API

```typescript
import { OvhClient, OvhDns, OvhVps, OvhEmail, resolveCredentials } from "@aphrody/ovh";

const creds = await resolveCredentials("aphrody.com");
const client = new OvhClient(creds);

const dns = new OvhDns(client);
const audit = await dns.auditZone("aphrody.com");

const email = new OvhEmail(client);
const emailScorecard = await email.auditEmailDns("aphrody.com");
```
