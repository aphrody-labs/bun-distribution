// SPDX-License-Identifier: Apache-2.0
/**
 * `yolo ovh` — Unified OVHcloud CLI in pure Bun (the OVH module of the yolo CLI).
 *
 * Supports DNS, VPS, Email, and multi-profile operations with structured JSON
 * and safe before/after change validation (--apply gate).
 */

import { AphrodyOvh } from "./index.js";
import { KNOWN_PROFILES } from "./profiles.js";

/** `yolo ovh <category> <command> [arguments...] [options]`; returns the exit status. */
export async function runOvh(argv: readonly string[]): Promise<number> {
  const args = [...argv];

  function hasFlag(flag: string): boolean {
    return args.includes(flag);
  }

  function getOption(opt: string): string | undefined {
    const idx = args.indexOf(opt);
    if (idx !== -1 && idx + 1 < args.length) {
      return args[idx + 1];
    }
    return undefined;
  }

  const asJson = hasFlag("--json");
  const apply = hasFlag("--apply");
  const profileArg = getOption("--profile");

  // Filter out options to get positional tokens
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (
        args[i] === "--profile" ||
        args[i] === "--type" ||
        args[i] === "--subdomain" ||
        args[i] === "--ttl"
      ) {
        i++; // skip value
      }
    } else {
      positionals.push(args[i]);
    }
  }

  const [category, command, ...rest] = positionals;

  function output(val: unknown, prettyPrint?: (v: unknown) => void) {
    if (asJson || !prettyPrint) {
      console.log(JSON.stringify(val, null, 2));
    } else {
      prettyPrint(val);
    }
  }

  async function run(): Promise<number> {
    if (!category || category === "help" || category === "--help" || category === "-h") {
      printHelp();
      return 0;
    }

    if (category === "profiles") {
      output(Object.values(KNOWN_PROFILES), (profs) => {
        console.log("Registered Aphrody OVH Profiles:");
        for (const p of profs as (typeof KNOWN_PROFILES)[string][]) {
          console.log(`  - ${p.id.padEnd(18)} : ${p.name}`);
          console.log(`    Domains: ${p.domains.join(", ")}`);
          console.log(`    Region:  ${p.region}`);
        }
      });
      return 0;
    }

    if (category === "status" || category === "check") {
      const ovh = new AphrodyOvh(profileArg);
      const health = await ovh.checkHealth();
      output(health, (h) => {
        const typedH = h as typeof health;
        console.log(`OVH Health Check:`);
        console.log(`  Authenticated: ${typedH.authenticated ? "YES" : "NO"}`);
        console.log(`  Credentials:   ${typedH.credentialsSource}`);
        if (typedH.zonesCount !== undefined) console.log(`  Zones:         ${typedH.zonesCount}`);
        if (typedH.vpsCount !== undefined) console.log(`  VPS Instances: ${typedH.vpsCount}`);
        if (typedH.error) console.log(`  Error:         ${typedH.error}`);
      });
      return health.authenticated ? 0 : 1;
    }

    // DNS category
    if (category === "dns") {
      const subCmd = command || "zones";
      const zoneName = rest[0];
      const ovh = new AphrodyOvh(profileArg || zoneName);

      if (subCmd === "zones") {
        const zones = await ovh.dns.listZones();
        output(zones, (zs) => {
          console.log("DNS Zones:");
          for (const z of zs as string[]) console.log(`  - ${z}`);
        });
        return 0;
      }

      if (!zoneName) {
        console.error("error: missing <zone> argument. Example: yolo ovh dns records aphrody.com");
        return 1;
      }

      if (subCmd === "info") {
        const info = await ovh.dns.getZone(zoneName);
        output(info);
        return 0;
      }

      if (subCmd === "export") {
        const exported = await ovh.dns.exportZone(zoneName);
        console.log(exported);
        return 0;
      }

      if (subCmd === "records") {
        const fieldType = getOption("--type");
        const subDomain = getOption("--subdomain");
        const records = await ovh.dns.listRecords(zoneName, { fieldType, subDomain });
        output(records, (recs) => {
          console.log(`DNS Records for ${zoneName} (${(recs as unknown[]).length} records):`);
          console.log(
            `${"ID".padEnd(12)} ${"TYPE".padEnd(8)} ${"SUBDOMAIN".padEnd(20)} ${"TTL".padEnd(8)} TARGET`,
          );
          console.log("-".repeat(70));
          for (const r of recs as any[]) {
            const sub = (r.subDomain || "@").padEnd(20);
            console.log(
              `${String(r.id).padEnd(12)} ${r.fieldType.padEnd(8)} ${sub} ${String(r.ttl).padEnd(8)} ${r.target}`,
            );
          }
        });
        return 0;
      }

      if (subCmd === "add") {
        const type = rest[1];
        const subdomain = rest[2] === "@" ? "" : rest[2];
        const target = rest[3];
        const ttl = Number(getOption("--ttl") ?? 300);

        if (!type || target === undefined) {
          console.error(
            "usage: yolo ovh dns add <zone> <type> <subdomain> <target> [--ttl 300] [--apply]",
          );
          return 1;
        }

        const res = await ovh.dns.addRecord(
          zoneName,
          { fieldType: type, subDomain: subdomain, target, ttl },
          { apply, autoRefresh: true },
        );
        output(res);
        return 0;
      }

      if (subCmd === "delete") {
        const recordId = Number(rest[1]);
        if (!recordId) {
          console.error("usage: yolo ovh dns delete <zone> <recordId> [--apply]");
          return 1;
        }

        const res = await ovh.dns.deleteRecord(zoneName, recordId, { apply, autoRefresh: true });
        output(res);
        return 0;
      }

      if (subCmd === "refresh") {
        if (!apply) {
          output({
            planned: true,
            message: "Zone refresh planned. Re-run with --apply to execute.",
          });
          return 0;
        }
        await ovh.dns.refreshZone(zoneName);
        output({ success: true, message: `Zone ${zoneName} refreshed.` });
        return 0;
      }

      if (subCmd === "setA") {
        const targetIp = rest[1];
        if (!targetIp) {
          console.error("usage: yolo ovh dns setA <zone> <ip> [--apply]");
          return 1;
        }
        const res = await ovh.dns.setA(zoneName, targetIp, { apply });
        output(res);
        return 0;
      }

      if (subCmd === "audit") {
        const audit = await ovh.dns.auditZone(zoneName);
        output(audit, (a: any) => {
          console.log(`DNS Audit for ${a.zone}:`);
          console.log(`  DNSSEC Signed:  ${a.dnssecActivated ? "YES" : "NO"}`);
          console.log(`  Anycast Active: ${a.hasDnsAnycast ? "YES" : "NO"}`);
          console.log(`  Total Records:  ${a.totalRecords}`);
          if (a.aphrodyInvariants) {
            console.log(
              `  Aphrody Production Invariants: ${a.aphrodyInvariants.verified ? "VERIFIED" : "FAIL"}`,
            );
            if (a.aphrodyInvariants.missingSubdomains.length > 0) {
              console.log(`    Missing: ${a.aphrodyInvariants.missingSubdomains.join(", ")}`);
            }
          }
          if (a.warnings.length > 0) {
            console.log(`  Warnings:`);
            for (const w of a.warnings) console.log(`    - ${w}`);
          }
        });
        return 0;
      }
    }

    // Email category
    if (category === "email") {
      const subCmd = command || "domain";
      const domain = rest[0];
      const ovh = new AphrodyOvh(profileArg || domain);

      if (!domain) {
        console.error(
          "error: missing <domain> argument. Example: yolo ovh email domain aphrody.com",
        );
        return 1;
      }

      if (subCmd === "domain") {
        const info = await ovh.email.getDomain(domain);
        output(info);
        return 0;
      }

      if (subCmd === "accounts") {
        const accounts = await ovh.email.listAccounts(domain);
        output(accounts);
        return 0;
      }

      if (subCmd === "redirections") {
        const redirections = await ovh.email.listRedirections(domain);
        output(redirections);
        return 0;
      }

      if (subCmd === "add-redirection") {
        const from = rest[1];
        const to = rest[2];
        const copy = hasFlag("--copy");
        if (!from || !to) {
          console.error(
            "usage: yolo ovh email add-redirection <domain> <from> <to> [--copy] [--apply]",
          );
          return 1;
        }
        const res = await ovh.email.createRedirection(domain, from, to, copy, { apply });
        output(res);
        return 0;
      }

      if (subCmd === "delete-redirection") {
        const redId = rest[1];
        if (!redId) {
          console.error("usage: yolo ovh email delete-redirection <domain> <id> [--apply]");
          return 1;
        }
        const res = await ovh.email.deleteRedirection(domain, redId, { apply });
        output(res);
        return 0;
      }

      if (subCmd === "audit") {
        const audit = await ovh.email.auditEmailDns(domain);
        output(audit, (a: any) => {
          console.log(`Email Deliverability Audit for ${a.domain}:`);
          console.log(`  Status Score:   ${a.score}`);
          console.log(
            `  MX Records:     ${a.mxValid ? "VALID" : "INVALID"} (${a.mxRecords.join(", ") || "none"})`,
          );
          console.log(
            `  SPF Record:     ${a.spfValid ? "VALID" : "INVALID"} (${a.spfRecord || "missing"})`,
          );
          console.log(
            `  DMARC Record:   ${a.dmarcValid ? "VALID" : "INVALID"} (${a.dmarcRecord || "missing"})`,
          );
          console.log(
            `  DKIM Selectors: ${a.dkimValid ? "VALID" : "INVALID"} (${a.dkimSelectors.length} selectors)`,
          );
          console.log(`  Autodiscover:   ${a.autodiscoverValid ? "VALID" : "NOT CONFIGURED"}`);
          if (a.recommendations.length > 0) {
            console.log(`  Recommendations:`);
            for (const r of a.recommendations) console.log(`    - ${r}`);
          }
        });
        return 0;
      }
    }

    // VPS category
    if (category === "vps") {
      const subCmd = command || "list";
      const serviceName = rest[0];
      const ovh = new AphrodyOvh(profileArg);

      if (subCmd === "list") {
        const vpsList = await ovh.vps.listVps();
        output(vpsList, (vps) => {
          console.log("VPS Services:");
          for (const v of vps as string[]) console.log(`  - ${v}`);
        });
        return 0;
      }

      if (!serviceName) {
        console.error(
          "error: missing <serviceName> argument. Example: yolo ovh vps info vps-203bea89.vps.ovh.net",
        );
        return 1;
      }

      if (subCmd === "info") {
        const details = await ovh.vps.getVps(serviceName);
        output(details, (d: any) => {
          console.log(`VPS Details: ${d.name} (${d.displayName || "unnamed"})`);
          console.log(`  State:      ${d.state}`);
          console.log(`  Model:      ${d.model}`);
          console.log(`  Zone:       ${d.zone} (Cluster: ${d.cluster})`);
          console.log(`  Specs:      ${d.vcore} vCPU, ${d.memory} MB RAM, ${d.disk} GB Storage`);
          console.log(`  SLA:        ${d.sla}`);
        });
        return 0;
      }

      if (subCmd === "ips") {
        const ips = await ovh.vps.getIps(serviceName);
        output(ips);
        return 0;
      }

      if (subCmd === "status") {
        const status = await ovh.vps.getStatus(serviceName);
        output(status);
        return 0;
      }

      if (subCmd === "backups") {
        const backups = await ovh.vps.getBackups(serviceName);
        output(backups);
        return 0;
      }

      if (subCmd === "reboot") {
        const res = await ovh.vps.reboot(serviceName, { apply });
        output(res);
        return 0;
      }
    }

    console.error(`Unknown command: ${category} ${command || ""}`);
    printHelp();
    return 1;
  }

  try {
    return await run();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

function printHelp() {
  console.log(`
yolo ovh — Unified OVHcloud Infrastructure CLI

USAGE:
  yolo ovh <category> <command> [arguments...] [options]

CATEGORIES:
  status                                 Health diagnostic & authentication verify
  profiles                               List known profile definitions & candidate paths

  dns zones                              List DNS zones
  dns info <zone>                        Get zone details (DNSSEC, Anycast, nameservers)
  dns records <zone> [--type T] [--json] List DNS records
  dns add <zone> <type> <sub> <target>   Add DNS record (--apply to execute)
  dns delete <zone> <recordId>           Delete DNS record (--apply to execute)
  dns setA <zone> <ip>                   Batch switch A records (--apply to execute)
  dns export <zone>                      Export BIND zone file
  dns refresh <zone>                     Propagate zone changes (--apply to execute)
  dns audit <zone>                       Audit DNSSEC & production invariant subdomains

  email domain <domain>                  Get email service details
  email accounts <domain>                List email mailbox accounts
  email redirections <domain>            List email redirections
  email add-redirection <d> <from> <to>  Create email redirection (--apply to execute)
  email delete-redirection <d> <id>      Delete email redirection (--apply to execute)
  email audit <domain>                   Deliverability audit (MX, SPF, DMARC, DKIM)

  vps list                               List VPS services
  vps info <serviceName>                 Get VPS hardware specs & datacenter topology
  vps ips <serviceName>                  Get VPS IP routing inventory
  vps status <serviceName>               Get VPS operational status
  vps backups <serviceName>              Inspect automated backups and snapshots
  vps reboot <serviceName>               Reboot VPS (--apply to execute)

OPTIONS:
  --profile <name>                       Target profile (aphrody.com, rosegriffon.fr, dragonballfr.com)
  --apply                                Authorize mutation actions (default: safe dry-run)
  --json                                 Output machine-readable JSON
`);
}
