// SPDX-License-Identifier: Apache-2.0
/**
 * OVHcloud DNS Zone & Record Management Engine.
 *
 * Full lifecycle operations: zones inventory, record CRUD, batch IP switches,
 * BIND export, DNSSEC validation and production invariant verification.
 */

import { OvhClient } from "./client.js";

export type DnsRecordType =
  | "A"
  | "AAAA"
  | "CNAME"
  | "MX"
  | "TXT"
  | "SRV"
  | "SPF"
  | "CAA"
  | "NS"
  | "PTR"
  | "DKIM"
  | "DMARC"
  | "LOC"
  | "SSHFP";

export interface DnsZoneInfo {
  name: string;
  hasDnsAnycast: boolean;
  dnssecSupported: boolean;
  isSigned: boolean;
  nameServers: string[];
  lastUpdate: string;
}

export interface DnsRecord {
  id: number;
  zone: string;
  subDomain: string;
  fieldType: DnsRecordType | string;
  target: string;
  ttl: number;
}

export interface NewDnsRecord {
  fieldType: DnsRecordType | string;
  subDomain?: string;
  target: string;
  ttl?: number;
}

export interface UpdateDnsRecord {
  subDomain?: string;
  target?: string;
  ttl?: number;
}

export interface DnsAuditReport {
  zone: string;
  dnssecActivated: boolean;
  hasDnsAnycast: boolean;
  nameServers: string[];
  totalRecords: number;
  recordsByType: Record<string, number>;
  aphrodyInvariants?: {
    verified: boolean;
    expectedSubdomains: string[];
    missingSubdomains: string[];
    unexpectedApexRecords: string[];
  };
  warnings: string[];
}

export class OvhDns {
  constructor(private readonly client: OvhClient) {}

  /**
   * List all managed DNS zones in the account.
   */
  public async listZones(): Promise<string[]> {
    return this.client.get<string[]>("/domain/zone");
  }

  /**
   * Get zone metadata including DNSSEC, Anycast and nameservers.
   */
  public async getZone(zone: string): Promise<DnsZoneInfo> {
    return this.client.get<DnsZoneInfo>(`/domain/zone/${zone}`);
  }

  /**
   * Export the entire zone as a standard BIND zone file.
   */
  public async exportZone(zone: string): Promise<string> {
    return this.client.get<string>(`/domain/zone/${zone}/export`);
  }

  /**
   * List record IDs for a zone, optionally filtered by fieldType and subDomain.
   */
  public async listRecordIds(zone: string, filter?: { fieldType?: string; subDomain?: string }): Promise<number[]> {
    return this.client.get<number[]>(`/domain/zone/${zone}/record`, {
      fieldType: filter?.fieldType,
      subDomain: filter?.subDomain,
    });
  }

  /**
   * Fetch details of a single record by ID.
   */
  public async getRecord(zone: string, recordId: number): Promise<DnsRecord> {
    return this.client.get<DnsRecord>(`/domain/zone/${zone}/record/${recordId}`);
  }

  /**
   * List all records in a zone with concurrent batch fetching.
   */
  public async listRecords(zone: string, filter?: { fieldType?: string; subDomain?: string }): Promise<DnsRecord[]> {
    const ids = await this.listRecordIds(zone, filter);
    if (!ids || ids.length === 0) return [];

    // Concurrent batch retrieval with chunk size of 15
    const chunkSize = 15;
    const records: DnsRecord[] = [];

    for (let i = 0; i < ids.length; i += chunkSize) {
      const slice = ids.slice(i, i + chunkSize);
      // oxlint-disable-next-line no-await-in-loop -- chunks run one after another to cap concurrent OVH requests at 15
      const batch = await Promise.all(slice.map(id => this.getRecord(zone, id)));
      records.push(...batch);
    }

    // Sort by fieldType then subDomain
    records.sort((a, b) => {
      const typeCmp = a.fieldType.localeCompare(b.fieldType);
      if (typeCmp !== 0) return typeCmp;
      return (a.subDomain || "@").localeCompare(b.subDomain || "@");
    });

    return records;
  }

  /**
   * Create a new DNS record. If apply is false (default), dry-run plan only.
   */
  public async addRecord(
    zone: string,
    record: NewDnsRecord,
    options: { apply?: boolean; autoRefresh?: boolean } = {},
  ): Promise<{
    planned: boolean;
    record?: DnsRecord;
    refreshRequested: boolean;
  }> {
    if (!options.apply) {
      return { planned: true, refreshRequested: false };
    }

    const payload = {
      fieldType: record.fieldType,
      subDomain: record.subDomain || "",
      target: record.target,
      ttl: record.ttl ?? 300,
    };

    const created = await this.client.post<DnsRecord>(`/domain/zone/${zone}/record`, payload);

    if (options.autoRefresh !== false) {
      await this.refreshZone(zone);
    }

    return {
      planned: false,
      record: created,
      refreshRequested: options.autoRefresh !== false,
    };
  }

  /**
   * Update an existing DNS record by ID. If apply is false, dry-run plan only.
   */
  public async updateRecord(
    zone: string,
    recordId: number,
    patch: UpdateDnsRecord,
    options: { apply?: boolean; autoRefresh?: boolean } = {},
  ): Promise<{
    planned: boolean;
    recordId: number;
    refreshRequested: boolean;
  }> {
    if (!options.apply) {
      return { planned: true, recordId, refreshRequested: false };
    }

    await this.client.put(`/domain/zone/${zone}/record/${recordId}`, patch);

    if (options.autoRefresh !== false) {
      await this.refreshZone(zone);
    }

    return {
      planned: false,
      recordId,
      refreshRequested: options.autoRefresh !== false,
    };
  }

  /**
   * Delete an existing DNS record by ID.
   */
  public async deleteRecord(
    zone: string,
    recordId: number,
    options: { apply?: boolean; autoRefresh?: boolean } = {},
  ): Promise<{
    planned: boolean;
    deletedId: number;
    refreshRequested: boolean;
  }> {
    if (!options.apply) {
      return { planned: true, deletedId: recordId, refreshRequested: false };
    }

    await this.client.delete(`/domain/zone/${zone}/record/${recordId}`);

    if (options.autoRefresh !== false) {
      await this.refreshZone(zone);
    }

    return {
      planned: false,
      deletedId: recordId,
      refreshRequested: options.autoRefresh !== false,
    };
  }

  /**
   * Triggers zone refresh to propagate changes to nameservers.
   */
  public async refreshZone(zone: string): Promise<void> {
    await this.client.post(`/domain/zone/${zone}/refresh`);
  }

  /**
   * Batch switch of apex and subdomain A records to a new IP.
   */
  public async setA(
    zone: string,
    targetIp: string,
    options: { subdomains?: string[]; apply?: boolean } = {},
  ): Promise<{ updatedRecords: number[]; targetIp: string; applied: boolean }> {
    const targets = options.subdomains ?? ["", "www"];
    const records = await this.listRecords(zone, { fieldType: "A" });
    const toUpdate = records.filter(r => targets.includes(r.subDomain || ""));

    const updatedIds: number[] = [];

    if (options.apply) {
      for (const rec of toUpdate) {
        if (rec.target !== targetIp) {
          // oxlint-disable-next-line no-await-in-loop -- sequential writes: a failing PUT must stop before later records change
          await this.client.put(`/domain/zone/${zone}/record/${rec.id}`, {
            target: targetIp,
          });
          updatedIds.push(rec.id);
        }
      }
      if (updatedIds.length > 0) {
        await this.refreshZone(zone);
      }
    } else {
      updatedIds.push(...toUpdate.map(r => r.id));
    }

    return {
      updatedRecords: updatedIds,
      targetIp,
      applied: !!options.apply,
    };
  }

  /**
   * Audits DNS zone configuration against operational safety invariants.
   */
  public async auditZone(zone: string): Promise<DnsAuditReport> {
    const info = await this.getZone(zone);
    const records = await this.listRecords(zone);

    const typeCounts: Record<string, number> = {};
    for (const r of records) {
      typeCounts[r.fieldType] = (typeCounts[r.fieldType] ?? 0) + 1;
    }

    const warnings: string[] = [];

    if (!info.isSigned && info.dnssecSupported) {
      warnings.push("DNSSEC is supported for this zone but is not currently active");
    }

    let aphrodyInvariants: DnsAuditReport["aphrodyInvariants"];

    // Verified 11 production subdomains invariant for aphrody.com
    if (zone === "aphrody.com") {
      const expected = ["@", "n2b", "www", "nie", "api", "cdn", "mcp", "bxc", "downloads", "bot", "admin"];
      const foundSubdomains = new Set(
        records
          .filter(r => r.fieldType === "A" || r.fieldType === "CNAME")
          .map(r => (r.subDomain === "" ? "@" : r.subDomain)),
      );

      const missing = expected.filter(s => !foundSubdomains.has(s));
      if (missing.length > 0) {
        warnings.push(`Missing production expected subdomains: ${missing.join(", ")}`);
      }

      aphrodyInvariants = {
        verified: missing.length === 0,
        expectedSubdomains: expected,
        missingSubdomains: missing,
        unexpectedApexRecords: [],
      };
    }

    return {
      zone,
      dnssecActivated: info.isSigned,
      hasDnsAnycast: info.hasDnsAnycast,
      nameServers: info.nameServers ?? [],
      totalRecords: records.length,
      recordsByType: typeCounts,
      aphrodyInvariants,
      warnings,
    };
  }
}
