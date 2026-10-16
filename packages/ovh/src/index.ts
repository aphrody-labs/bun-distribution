// SPDX-License-Identifier: Apache-2.0
/**
 * @aphrody/ovh - Unified OVHcloud Infrastructure Engine for Aphrody.
 *
 * Full Bun native implementation of the OVH API:
 *  - DNS: Zones, Record CRUD, batch A-records, BIND export, DNSSEC, audits
 *  - VPS: Inventory, specs, datacenter topology, IPs, backups, power cycles
 *  - Email: Domains, mailboxes, redirections, deliverability scorecard (MX/SPF/DKIM/DMARC)
 *  - Profiles: Segregated multi-account credential management with automatic domain routing
 */

export * from "./client.js";
export * from "./profiles.js";
export * from "./dns.js";
export * from "./email.js";
export * from "./vps.js";

import { OvhClient } from "./client.js";
import { OvhDns } from "./dns.js";
import { OvhEmail } from "./email.js";
import { OvhVps } from "./vps.js";
import { loadCredentials } from "./profiles.js";

/**
 * Top-level Aphrody OVH unified controller.
 */
export class AphrodyOvh {
  private readonly credentialsSource: string;
  public readonly client: OvhClient;
  public readonly dns: OvhDns;
  public readonly email: OvhEmail;
  public readonly vps: OvhVps;

  constructor(profileOrDomain?: string) {
    const credentials = loadCredentials(profileOrDomain);
    this.credentialsSource = credentials.source;
    this.client = new OvhClient(credentials);
    this.dns = new OvhDns(this.client);
    this.email = new OvhEmail(this.client);
    this.vps = new OvhVps(this.client);
  }

  /**
   * Health and authentication diagnostic check across account services.
   */
  public async checkHealth(): Promise<{
    authenticated: boolean;
    credentialsSource: string;
    nic?: string;
    email?: string;
    zonesCount?: number;
    vpsCount?: number;
    error?: string;
  }> {
    try {
      const [zones, vpsList] = await Promise.all([
        this.dns.listZones(),
        this.vps.listVps(),
      ]);

      return {
        authenticated: true,
        credentialsSource: this.credentialsSource,
        zonesCount: zones.length,
        vpsCount: vpsList.length,
      };
    } catch (e) {
      return {
        authenticated: false,
        credentialsSource: this.credentialsSource,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
