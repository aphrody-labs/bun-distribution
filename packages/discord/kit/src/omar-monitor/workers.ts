// SPDX-License-Identifier: Apache-2.0
import { Codex } from "./codex.ts";
import type { Job, Policy, WorkerHost } from "./store.ts";

export class WorkerUnavailable extends Error {
  constructor(
    readonly hostId: string,
    reason: string,
  ) {
    super(`Codex ${hostId}: ${reason}`);
    this.name = "WorkerUnavailable";
  }
}

const normalized = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export interface WorkerSelection {
  hostId: string;
  policy: Policy;
  codex: Codex;
  routeFailure?: { hostId: string; reason: string };
}

/** A persisted thread belongs to its original host, including legacy VPS threads. */
export function workerHostId(policy: Policy, job: Job): string {
  if (job.worker_host) return job.worker_host;
  if (job.worker_thread) return "local";
  const text = normalized(job.text);
  return (
    policy.workerHosts?.find((host) =>
      host.match.some((term) => {
        const escaped = normalized(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, "u").test(text);
      }),
    )?.id ??
    policy.defaultWorkerHost ??
    "local"
  );
}

function remotePolicy(policy: Policy, host: WorkerHost): Policy {
  if (host.unavailableReason) throw new WorkerUnavailable(host.id, host.unavailableReason);
  if (!host.codex || !host.cwd || !host.nativeMcp || !host.transport)
    throw new WorkerUnavailable(host.id, "endpoint, workspace or native binaries not qualified");
  return {
    ...policy,
    codex: host.codex,
    cwd: host.cwd,
    nativeMcp: host.nativeMcp,
    profile: host.profile ?? policy.profile,
    codexTransport: host.transport,
    // Optional launchers are host-local paths. Inherit none from the hub.
    shenronMcp: undefined,
    fleetMcp: undefined,
  };
}

/** One dedicated complete app-server per declared host; authentication remains there. */
export class WorkerPool {
  private readonly clients = new Map<string, { policy: Policy; codex: Codex }>();
  constructor(
    private readonly policy: Policy,
    private readonly local: Codex,
  ) {}

  private localFallback(job: Job, error: WorkerUnavailable): WorkerSelection {
    if (job.worker_thread) throw error;
    return {
      hostId: "local",
      policy: this.policy,
      codex: this.local,
      routeFailure: { hostId: error.hostId, reason: error.message },
    };
  }

  async select(job: Job): Promise<WorkerSelection> {
    const hostId = workerHostId(this.policy, job);
    if (hostId === "local") return { hostId, policy: this.policy, codex: this.local };
    const existing = this.clients.get(hostId);
    if (existing) return { hostId, ...existing };
    const host = this.policy.workerHosts?.find((candidate) => candidate.id === hostId);
    if (!host)
      return this.localFallback(
        job,
        new WorkerUnavailable(hostId, "host removed from declared policy"),
      );
    let policy: Policy;
    try {
      policy = remotePolicy(this.policy, host);
    } catch (error) {
      if (error instanceof WorkerUnavailable) return this.localFallback(job, error);
      throw error;
    }
    const codex = new Codex(policy);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        codex.initialize(),
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => reject(new Error("Codex initialization timeout")), 15000);
        }),
      ]);
    } catch {
      codex.close();
      return this.localFallback(
        job,
        new WorkerUnavailable(hostId, "authenticated SSH/Codex transport unavailable"),
      );
    } finally {
      clearTimeout(deadline);
    }
    this.clients.set(hostId, { policy, codex });
    return { hostId, policy, codex };
  }

  close() {
    for (const { codex } of this.clients.values()) codex.close();
    this.clients.clear();
  }
}
