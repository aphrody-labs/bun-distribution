// SPDX-License-Identifier: Apache-2.0
/**
 * OVHcloud VPS Management & Inspection Engine.
 *
 * Provides typed operations for virtual private servers:
 * inventory, specs inspection, datacenter/cluster topology, IP routing,
 * automated backups, performance monitoring, and guarded lifecycle actions.
 */

import { OvhApiError, OvhClient } from "./client.js";

export interface VpsDetails {
  name: string;
  displayName?: string;
  state: "running" | "stopped" | "maintenance" | string;
  cluster: string;
  zone: string;
  model: string;
  memory: number; // MB
  vcore: number;
  disk: number; // GB
  sla: string;
}

export interface VpsIp {
  ip: string;
  version: "v4" | "v6";
  gateway?: string;
  reverse?: string;
  type: string;
}

export interface VpsStatus {
  state: string;
  ping: boolean;
  up: boolean;
}

export interface VpsBackupInfo {
  automatedBackup: {
    state?: string;
    schedule?: string;
    restorePoints?: string[];
  };
  snapshot?: {
    creationDate?: string;
    description?: string;
  };
}

export class OvhVps {
  constructor(private readonly client: OvhClient) {}

  /**
   * List all VPS service names available in the account.
   */
  public async listVps(): Promise<string[]> {
    return this.client.get<string[]>("/vps");
  }

  /**
   * Get detailed specification and operational parameters of a VPS.
   */
  public async getVps(serviceName: string): Promise<VpsDetails> {
    const raw = await this.client.get<Record<string, unknown>>(
      `/vps/${serviceName}`,
    );
    const model = (raw.model as Record<string, unknown>) || {};

    return {
      name: (raw.name as string) || serviceName,
      displayName: (raw.displayName as string) || undefined,
      state: (raw.state as string) || "unknown",
      cluster: (raw.cluster as string) || "",
      zone: (raw.zone as string) || "",
      model: (model.name as string) || (raw.offerType as string) || "vps",
      memory: Number(model.memory || raw.memory || 0),
      vcore: Number(model.vcore || raw.vcore || 0),
      disk: Number(model.disk || raw.disk || 0),
      sla: raw.slaMonitoring ? "active" : "standard",
    };
  }

  /**
   * List all IPs associated with a VPS.
   */
  public async getIps(serviceName: string): Promise<VpsIp[]> {
    const ipStrings = await this.client.get<string[]>(
      `/vps/${serviceName}/ips`,
    );
    if (!ipStrings || ipStrings.length === 0) return [];

    // Independent per-IP lookups; Promise.all keeps the API order and each failure falls back locally.
    return Promise.all(
      ipStrings.map(async (ip): Promise<VpsIp> => {
        try {
          const detail = await this.client.get<Record<string, unknown>>(
            `/vps/${serviceName}/ips/${ip}`,
          );
          return {
            ip,
            version: ip.includes(":") ? "v6" : "v4",
            gateway: (detail.gateway as string) || undefined,
            reverse: (detail.reverse as string) || undefined,
            type: (detail.type as string) || "primary",
          };
        } catch {
          return {
            ip,
            version: ip.includes(":") ? "v6" : "v4",
            type: "primary",
          };
        }
      }),
    );
  }

  /**
   * Get current operational status (ping, up).
   */
  public async getStatus(serviceName: string): Promise<VpsStatus> {
    const status = await this.client.get<Record<string, unknown>>(
      `/vps/${serviceName}/status`,
    );
    return {
      state: (status.state as string) || "unknown",
      ping: Boolean(status.ping),
      up: Boolean(status.up),
    };
  }

  /**
   * Inspect automated backup schedule and snapshot status.
   */
  public async getBackups(serviceName: string): Promise<VpsBackupInfo> {
    const basePath = `/vps/${serviceName}`;
    let automatedBackup: VpsBackupInfo["automatedBackup"] = {
      restorePoints: [],
    };
    let snapshot: VpsBackupInfo["snapshot"] = undefined;

    try {
      const auto = await this.client.get<Record<string, unknown>>(
        `${basePath}/automatedBackup`,
      );
      automatedBackup = {
        state: auto.state as string,
        schedule: auto.schedule as string,
        restorePoints: [],
      };
    } catch (error) {
      if (!(error instanceof OvhApiError) || error.statusCode !== 404)
        throw error;
      // Distinguish an absent backup option from a VPS outside this account.
      await this.client.get(basePath);
    }

    if (automatedBackup.state) {
      try {
        automatedBackup.restorePoints = await this.client.get<string[]>(
          `${basePath}/automatedBackup/restorePoints`,
          {
            state: "available",
          },
        );
      } catch (error) {
        if (!(error instanceof OvhApiError) || error.statusCode !== 404)
          throw error;
      }
    }

    try {
      const snap = await this.client.get<Record<string, unknown>>(
        `${basePath}/snapshot`,
      );
      if (snap && snap.creationDate) {
        snapshot = {
          creationDate: snap.creationDate as string,
          description: snap.description as string,
        };
      }
    } catch (error) {
      if (!(error instanceof OvhApiError) || error.statusCode !== 404)
        throw error;
      // OVH returns 404 when no manual snapshot exists.
    }

    return { automatedBackup, snapshot };
  }

  /**
   * Reboot a VPS. Refuses execution without explicit apply flag.
   */
  public async reboot(
    serviceName: string,
    options: { apply?: boolean } = {},
  ): Promise<{ planned: boolean; taskId?: number; message: string }> {
    if (!options.apply) {
      return {
        planned: true,
        message: `Reboot for '${serviceName}' planned. Re-run with --apply to execute reboot.`,
      };
    }

    const task = await this.client.post<Record<string, unknown>>(
      `/vps/${serviceName}/reboot`,
    );
    return {
      planned: false,
      taskId: (task?.id as number) || undefined,
      message: `Reboot initiated for '${serviceName}'. Task ID: ${task?.id ?? "unknown"}`,
    };
  }
}
