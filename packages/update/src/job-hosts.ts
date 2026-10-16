// SPDX-License-Identifier: Apache-2.0
// oxlint-disable no-await-in-loop -- credentials and bounded readiness probes are intentionally sequential.
/** Protected native MCP clients for the existing per-host durable queues. */
import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Ctx } from "./context.ts";
import { spawnSync, type SpawnSyncResult } from "./process.ts";
import {
  durablePrivateWrite,
  ownedPrivateFile,
  ownerPrivate,
} from "./systemd.ts";

export interface NativeJobHost {
  id: "vps" | "dbfr" | "wsl";
  config: string;
  server: "aphrody";
  slots: number;
  workerReady: boolean;
}
export type NativeJobTransport = (
  request: {
    config: string;
    server: string;
    tool: string;
    arguments: Record<string, unknown>;
  },
  options: { timeoutMs: number; signal?: AbortSignal },
) => Promise<unknown>;
const targets = {
  // WireGuard socket-proxyd is a TCP relay to this loopback authority. Preserve RMCP's Host protection.
  vps: {
    url: "http://10.200.77.1:8793/mcp",
    authority: "127.0.0.1:8793",
    slots: 4,
    unit: "aphrody-mcp-http.service",
  },
  dbfr: {
    url: "http://10.200.77.3:8793/mcp",
    authority: "127.0.0.1:8793",
    slots: 2,
    unit: "aphrody-mcp-http-dbfr.service",
  },
  wsl: {
    url: "http://127.0.0.1:8791/mcp",
    authority: "127.0.0.1:8791",
    slots: 2,
    unit: "aphrody-local-mcp.service",
  },
} as const;
type Run = (command: string, args: string[]) => SpawnSyncResult;

function runtimeIdentity(
  host: NativeJobHost,
  pin: string,
  home: string,
  run: Run,
): string {
  const native = join(home, ".local/bin/aphrody");
  if (host.id === "wsl") {
    const units = [
      "aphrody-local-mcp.service",
      "aphrody-jobs-worker-wsl.service",
    ];
    for (const unit of units)
      if (
        run("systemctl", ["--user", "is-active", "--quiet", unit]).status !== 0
      )
        throw new Error("Current WSL runtime is inactive");
    const hashes = run("sha256sum", [
      native,
      join(home, ".local/bin/aphrody-mcp"),
    ]);
    if (
      hashes.status !== 0 ||
      hashes.stdout.trim().split("\n").length !== 2 ||
      hashes.stdout
        .trim()
        .split("\n")
        .some((line) => line.split(/\s+/)[0] !== pin)
    )
      throw new Error("Current WSL binary differs from its qualified pin");
    const pids = units.map((unit) =>
      run("systemctl", [
        "--user",
        "show",
        unit,
        "--property=MainPID",
        "--value",
      ]),
    );
    if (
      pids.some(
        (result) =>
          result.status !== 0 || !/^[1-9]\d*$/.test(result.stdout.trim()),
      )
    )
      throw new Error("Current WSL runtime has no live PID");
    const running = run(
      "sha256sum",
      pids.map((result) => `/proc/${result.stdout.trim()}/exe`),
    );
    if (
      running.status !== 0 ||
      running.stdout.trim().split("\n").length !== 2 ||
      running.stdout
        .trim()
        .split("\n")
        .some((line) => line.split(/\s+/)[0] !== pin)
    )
      throw new Error(
        "Current WSL running executable differs from its qualified pin",
      );
    return pids.map((result) => result.stdout.trim()).join(" ");
  }
  const unit = targets[host.id].unit,
    worker = `aphrody-jobs-worker-${host.id}.service`;
  const command = `set -e; systemctl is-active --quiet ${unit} ${worker}; echo ${pin}'  /home/ubuntu/.local/bin/aphrody-mcp' | sha256sum -c --quiet -; echo ${pin}'  /home/ubuntu/.local/bin/aphrody' | sha256sum -c --quiet -; mcp_pid=$(systemctl show ${unit} --property=MainPID --value); worker_pid=$(systemctl show ${worker} --property=MainPID --value); echo ${pin}'  /proc/'$mcp_pid'/exe' | sudo -n sha256sum -c --quiet -; echo ${pin}'  /proc/'$worker_pid'/exe' | sudo -n sha256sum -c --quiet -; printf '%s %s\\n' "$mcp_pid" "$worker_pid"`;
  const result = run(native, [
    "infra",
    "ssh",
    "exec",
    "--host",
    host.id,
    "--cmd",
    command,
  ]);
  if (result.status !== 0 || !/^[1-9]\d* [1-9]\d*\n?$/.test(result.stdout))
    throw new Error(
      `Current ${host.id} runtime, pin or live PIDs are unavailable`,
    );
  return result.stdout.trim();
}
interface QualificationIntent {
  host: string;
  pin: string;
  pids: string;
  key: string;
  createdAt: number;
  completedAt?: number;
}

function privateDirectory(home: string): string {
  const directory = join(home, ".aphrody/private/jobs");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const state = lstatSync(directory);
  if (!state.isDirectory() || state.isSymbolicLink() || !ownerPrivate(state))
    throw new Error("Job clients require an owned private directory");
  return directory;
}

/** Capture only the selected host's bearer through the existing authenticated Infra owner. */
export function prepareNativeJobHostClients(
  context: Ctx,
  ids: readonly NativeJobHost["id"][],
  pin: string,
  options: { home?: string; run?: Run } = {},
): NativeJobHost[] {
  if (
    !/^[a-f0-9]{64}$/.test(pin) ||
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !Object.hasOwn(targets, id))
  )
    throw new Error(
      "Explicit qualified pin and unique supported host identities required",
    );
  const home = options.home ?? homedir();
  const directory = join(home, ".aphrody/private/jobs");
  const hosts = ids.map((id): NativeJobHost => ({
    id,
    config: join(directory, `${id}.toml`),
    server: "aphrody",
    slots: targets[id].slots,
    workerReady: false,
  }));
  if (!context.apply) return hosts;
  privateDirectory(home);
  durablePrivateWrite(
    join(directory, "hosts.json"),
    `${JSON.stringify(hosts, null, 2)}\n`,
  );
  const run =
    options.run ??
    ((command, args) =>
      spawnSync(command, args, {
        cwd: context.root,
        timeout: 120000,
        env: { ...process.env, APHRODY_SSH_COMMAND_TIMEOUT_SECS: "120" },
      }));
  for (const host of hosts) {
    let bearer: string;
    if (host.id === "wsl") {
      const result = /^APHRODY_MCP_HTTP_TOKEN=([a-f0-9]{64})\n?$/.exec(
        ownedPrivateFile(join(directory, "wsl-mcp.env")),
      );
      if (!result)
        throw new Error(
          "WSL bearer is unavailable; activate its declared user units first",
        );
      bearer = result[1]!;
      if (!existsSync(host.config))
        throw new Error(
          "WSL client must come from its qualified user-unit owner",
        );
    } else {
      const command = `set -e; systemctl is-active --quiet ${targets[host.id].unit} aphrody-jobs-worker-${host.id}.service; echo ${pin}'  /home/ubuntu/.local/bin/aphrody-mcp' | sha256sum -c --quiet -; echo ${pin}'  /home/ubuntu/.local/bin/aphrody' | sha256sum -c --quiet -; sudo -n sed -n 's/^APHRODY_MCP_HTTP_TOKEN=//p' /etc/aphrody/aphrody-mcp-http.env`;
      const result = run(join(home, ".local/bin/aphrody"), [
        "infra",
        "ssh",
        "exec",
        "--host",
        host.id,
        "--cmd",
        command,
      ]);
      if (result.status !== 0 || !/^[a-f0-9]{64}\n?$/.test(result.stdout))
        throw new Error(
          `Selected ${host.id} native pin, units or protected bearer unavailable`,
        );
      bearer = result.stdout.trim();
    }
    if (existsSync(host.config)) ownedPrivateFile(host.config);
    durablePrivateWrite(
      host.config,
      `[mcp_servers.aphrody]\nurl = "${targets[host.id].url}"\n[mcp_servers.aphrody.http_headers]\nHost = "${targets[host.id].authority}"\nAuthorization = "Bearer ${bearer}"\n`,
    );
  }
  durablePrivateWrite(
    join(directory, "hosts.json"),
    `${JSON.stringify(hosts, null, 2)}\n`,
  );
  return hosts;
}

function decode(envelope: unknown): Record<string, unknown> {
  const result = (
    envelope as {
      result?: {
        isError?: boolean;
        structuredContent?: unknown;
        content?: Array<{ type: string; text?: string }>;
      };
    }
  )?.result;
  const text =
    result?.content?.filter((item) => item.type === "text" && item.text) ?? [];
  if (
    !result ||
    result.isError === true ||
    (result.structuredContent === undefined && text.length !== 1)
  )
    throw new Error("Native MCP returned no unambiguous receipt");
  const value = result.structuredContent ?? JSON.parse(text[0]!.text!);
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    "error" in value
  )
    throw new Error("Native job owner rejected the request");
  return value as Record<string, unknown>;
}

/** No new task engine: exercise the native owner's existing queue and finite read-only Web handler. */
export async function qualifyNativeJobHostClients(
  hosts: readonly NativeJobHost[],
  transport: NativeJobTransport,
  options: {
    pin: string;
    home?: string;
    signal?: AbortSignal;
    attempts?: number;
    sleep?: (ms: number) => Promise<void>;
    run?: Run;
    now?: () => number;
  },
): Promise<NativeJobHost[]> {
  if (!/^[a-f0-9]{64}$/.test(options.pin))
    throw new Error("Explicit qualified runtime pin required");
  const attempts = options.attempts ?? 30;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 30)
    throw new Error("Qualification requires 1-30 bounded probes");
  const directory = privateDirectory(options.home ?? homedir());
  const home = options.home ?? homedir();
  const run =
    options.run ??
    ((command, args) =>
      spawnSync(command, args, {
        timeout: 120000,
        env: { ...process.env, APHRODY_SSH_COMMAND_TIMEOUT_SECS: "120" },
      }));
  const now = options.now ?? Date.now;
  const deadline = now() + 15 * 60 * 1000;
  const checkDeadline = () => {
    options.signal?.throwIfAborted();
    if (now() >= deadline)
      throw new Error(
        "Native qualification global deadline expired; hosts remain unqualified",
      );
  };
  if (
    !hosts.length ||
    new Set(hosts.map((host) => host.id)).size !== hosts.length
  )
    throw new Error("Unique prepared host identities required");
  for (const host of hosts) {
    if (
      !Object.hasOwn(targets, host.id) ||
      !isAbsolute(host.config) ||
      host.config !== join(directory, `${host.id}.toml`) ||
      host.server !== "aphrody" ||
      host.slots !== targets[host.id].slots
    )
      throw new Error("Job host does not match its declared placement");
  }
  durablePrivateWrite(
    join(directory, "hosts.json"),
    `${JSON.stringify(
      hosts.map((host) => ({ ...host, workerReady: false })),
      null,
      2,
    )}\n`,
  );
  const qualified: NativeJobHost[] = [];
  for (const host of hosts) {
    let config: {
      mcp_servers?: {
        aphrody?: {
          url?: unknown;
          http_headers?: { Host?: unknown; Authorization?: unknown };
        };
      };
    };
    try {
      config = Bun.TOML.parse(ownedPrivateFile(host.config));
    } catch {
      throw new Error(
        "Native job client configuration is unavailable or malformed",
      );
    }
    const server = config.mcp_servers?.aphrody;
    if (
      server?.url !== targets[host.id].url ||
      server.http_headers?.Host !== targets[host.id].authority ||
      typeof server.http_headers.Authorization !== "string" ||
      !/^Bearer [a-f0-9]{64}$/.test(server.http_headers.Authorization)
    )
      throw new Error(
        "Job client differs from its purpose-bound declared route and loopback authority",
      );
    if (
      !Object.hasOwn(targets, host.id) ||
      !isAbsolute(host.config) ||
      host.server !== "aphrody" ||
      host.slots !== targets[host.id].slots
    )
      throw new Error("Job host does not match its declared placement");
    const call = async (tool: string, args: Record<string, unknown>) => {
      checkDeadline();
      const response = await transport(
        { config: host.config, server: host.server, tool, arguments: args },
        {
          timeoutMs: Math.min(15000, deadline - now()),
          signal: options.signal,
        },
      );
      checkDeadline();
      return decode(response);
    };
    checkDeadline();
    const pids = runtimeIdentity(host, options.pin, home, run);
    checkDeadline();
    const proofPath = join(directory, `${host.id}.qualification.json`);
    const previous = existsSync(proofPath)
      ? (JSON.parse(ownedPrivateFile(proofPath)) as QualificationIntent)
      : undefined;
    const time = now();
    const proof: QualificationIntent =
      previous &&
      previous.host === host.id &&
      previous.pin === options.pin &&
      previous.pids === pids &&
      typeof previous.key === "string" &&
      previous.key.length <= 256 &&
      previous.completedAt === undefined &&
      Number.isSafeInteger(previous.createdAt) &&
      previous.createdAt <= time &&
      time - previous.createdAt < 300000
        ? previous
        : {
            host: host.id,
            pin: options.pin,
            pids,
            key: `infra-qualification:${host.id}:${options.pin.slice(0, 12)}:${crypto.randomUUID()}`,
            createdAt: time,
          };
    durablePrivateWrite(proofPath, `${JSON.stringify(proof)}\n`);
    const listing = await call("aphrody_job_status", {});
    const queue = listing.queue as
      { queued?: unknown; running?: unknown } | undefined;
    if (
      !Array.isArray(listing.jobs) ||
      listing.count !== listing.jobs.length ||
      ![queue?.queued, queue?.running].every(
        (value) =>
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 0,
      )
    )
      throw new Error("Native queue is unavailable");
    const receipt = await call("aphrody_job_submit", {
      kind: "web-pipeline",
      payload: { args: ["dragon-ball", "sources", "--json"] },
      host_affinity: { mode: "hosts", hosts: [host.id] },
      idempotency_key: proof.key,
      max_attempts: 1,
      priority: 0,
    });
    if (typeof receipt.id !== "string" || !receipt.id)
      throw new Error("Native qualification job has no durable identity");
    let finished = false;
    for (let attempt = 0; attempt < attempts && !finished; attempt++) {
      const status = await call("aphrody_job_status", {
        id: receipt.id,
        log_tail: 10,
      });
      const job = status.job as
        | {
            state?: string;
            attempts?: number;
            idempotency_key?: string;
            host_affinity?: { mode?: string; hosts?: string[] };
          }
        | undefined;
      if (job?.state === "failed" || job?.state === "cancelled")
        throw new Error("Native read-only qualification job did not succeed");
      if (job?.state === "succeeded") {
        const messages =
          (status.logs as Array<{ message: string }> | undefined)?.map(
            (line) => line.message,
          ) ?? [];
        if (
          job.attempts !== 1 ||
          job.idempotency_key !== proof.key ||
          job.host_affinity?.mode !== "hosts" ||
          job.host_affinity.hosts?.length !== 1 ||
          job.host_affinity.hosts[0] !== host.id ||
          !messages.includes("running native Web pipeline") ||
          !messages.includes("succeeded")
        )
          throw new Error(
            "Native job lacks its real placement, lease and finish proof",
          );
        finished = true;
      } else await (options.sleep ?? Bun.sleep)(1000);
    }
    if (!finished)
      throw new Error(
        "Native worker readiness probe expired; host remains unqualified",
      );
    if (
      runtimeIdentity(host, options.pin, home, run) !== pids ||
      now() - proof.createdAt >= 300000
    )
      throw new Error(
        "Native worker changed or readiness proof expired during qualification",
      );
    checkDeadline();
    durablePrivateWrite(
      proofPath,
      `${JSON.stringify({ ...proof, completedAt: now() })}\n`,
    );
    qualified.push({ ...host, workerReady: true });
  }
  durablePrivateWrite(
    join(directory, "hosts.json"),
    `${JSON.stringify(qualified, null, 2)}\n`,
  );
  return qualified;
}
