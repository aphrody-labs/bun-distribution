// SPDX-License-Identifier: Apache-2.0
/**
 * Orchestrateur Discord dans @aphrody/workspace (packages/infra/workspace).
 *
 * Centralise les opérations d'infrastructure des bots Discord :
 * - Compilation native autonome via `aphrody discord compile`
 * - Vérification d'intégrité monorepo via `aphrody discord verify`
 * - Inspection des dépendances, décorateurs et syntaxe Oxc via `aphrody discord inspect`
 * - Suivi d'état et volumétrie des binaires ELF de production
 */
import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { infraRoot, runInfra } from "./runtime.ts";
import {
  applyPlan,
  hostPlan,
  renderPlan,
  type Plan,
  type Runner,
} from "../../../engine/core/src/host/plan.ts";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export interface DiscordDeployment {
  target: string;
  unit: string;
  entrypoint: string;
  bundle: string;
  policy: { source: string; target: string };
  stateDirectory: string;
  stateOwner: string;
  runtime: string;
  runtimeSha256: string;
  plan: Plan;
}

/** Product releases are declared here; host units and their target remain owned by Infra's catalog. */
export function discordDeployment(
  service: string,
  target: string,
  root = infraRoot(),
): DiscordDeployment {
  if (service !== "omar-monitor") throw new Error(`Unknown Discord deployment: ${service}`);
  const unit = "aphrody-discord-omar-monitor.service";
  return {
    target,
    unit,
    entrypoint: join(root, "packages/discord/kit/src/omar-monitor/main.ts"),
    bundle: "/srv/aphrody-lab/omar-monitor.mjs",
    policy: {
      source: join(root, "tools/config/host/discord-omar-monitor.json"),
      target: "/srv/aphrody-lab/omar-monitor-policy.json",
    },
    stateDirectory: "/srv/aphrody-lab/state/omar-monitor",
    stateOwner: "ubuntu",
    runtime: "/home/ubuntu/.yolo/bin/pins/discord-c886d124e138/yolo",
    runtimeSha256: "c886d124e1389167b0f1424b91bfc2902cc750c481d61fef6e97cd605493bf0b",
    plan: hostPlan([unit], { target, root: join(root, "tools/config/host") }),
  };
}

function discordRuntime(deployment: DiscordDeployment): string {
  return `env BUN_BE_BUN=1 ${quote(deployment.runtime)}`;
}

export interface DiscordDeploymentTransport {
  run: Runner;
  upload(host: string, source: string, target: string): Promise<void>;
  build(entrypoint: string, outdir: string): Promise<void>;
  wait?(milliseconds: number): Promise<void>;
}

/** A live monitor must acknowledge drainage from its current systemd PID before an upgrade proceeds. */
export async function quiesceDiscord(
  deployment: DiscordDeployment,
  transport: DiscordDeploymentTransport,
  attempts = 30,
): Promise<string | null> {
  const runtime = await transport.run(
    deployment.target,
    `printf '%s  %s\\n' ${quote(deployment.runtimeSha256)} ${quote(deployment.runtime)} | sha256sum -c --quiet -`,
  );
  if (runtime.code !== 0)
    throw new Error("Declared Yolo fork is absent or its SHA-256 differs; deployment deferred");
  const worker = `${discordRuntime(deployment)} ${quote(deployment.bundle)}`;
  const installed = await transport.run(deployment.target, `test -f ${quote(deployment.bundle)}`);
  if (installed.code === 1) {
    const active = await transport.run(
      deployment.target,
      `systemctl is-active --quiet ${quote(deployment.unit)}`,
    );
    if (active.code === 0)
      throw new Error("A live monitor has no installed artifact; deployment deferred");
    if (active.code !== 3 && active.code !== 4)
      throw new Error("Cannot qualify monitor absence for installation");
    return null;
  }
  if (installed.code !== 0) throw new Error("Cannot qualify installed Discord artifact");
  const capability = await transport.run(deployment.target, `${worker} --capabilities`);
  if (capability.code !== 0) {
    throw new Error(`Cannot qualify installed monitor upgrade protocol: ${capability.stderr}`);
  }
  const protocols = JSON.parse(capability.stdout) as { upgradeProtocol?: number };
  if (protocols.upgradeProtocol !== 2)
    throw new Error("Unsupported Discord monitor upgrade protocol");
  const pidResult = await transport.run(
    deployment.target,
    `systemctl show ${quote(deployment.unit)} -p MainPID --value`,
  );
  const pid = pidResult.stdout.trim();
  if (pidResult.code === 0 && pid === "0") {
    const active = await transport.run(
      deployment.target,
      `systemctl is-active --quiet ${quote(deployment.unit)}`,
    );
    if (active.code !== 3 && active.code !== 4)
      throw new Error("Cannot qualify stopped monitor: service may still be activating");
    const idle = await transport.run(
      deployment.target,
      `${worker} --policy ${quote(deployment.policy.target)} --upgrade-check`,
    );
    if (idle.code !== 0)
      throw new Error("Stopped monitor still owns active goals; recovery must be qualified first");
    return null;
  }
  if (pidResult.code !== 0 || !/^[1-9][0-9]*$/.test(pid))
    throw new Error("No live systemd monitor PID; activation must be qualified separately");
  let ready = false;
  /* oxlint-disable no-await-in-loop -- signal handlers must be installed in this live PID before drainage is requested. */
  for (let index = 0; index < attempts && !ready; index++) {
    const receipt = await transport.run(
      deployment.target,
      `${worker} --policy ${quote(deployment.policy.target)} --ready-check --expect-pid ${pid}`,
    );
    if (receipt.code === 0) {
      ready = true;
      break;
    }
    const live = await transport.run(
      deployment.target,
      `systemctl show ${quote(deployment.unit)} -p MainPID --value`,
    );
    if (live.code !== 0 || live.stdout.trim() !== pid)
      throw new Error("Monitor PID changed during startup; upgrade deferred");
    await (transport.wait?.(1000) ?? new Promise((resolve) => setTimeout(resolve, 1000)));
  }
  if (!ready)
    throw new Error(
      "Upgrade deferred: the live monitor has not published a readiness receipt; no signal was sent",
    );
  const signal = await transport.run(
    deployment.target,
    `sudo -n systemctl kill --kill-whom=main --signal=SIGUSR1 ${quote(deployment.unit)}`,
  );
  if (signal.code !== 0) throw new Error(`Monitor drainage signal failed: ${signal.stderr}`);
  try {
    /* oxlint-disable no-await-in-loop -- drainage is polled against the same live systemd PID. */
    for (let index = 0; index < attempts; index++) {
      const check = await transport.run(
        deployment.target,
        `${worker} --policy ${quote(deployment.policy.target)} --upgrade-check --expect-pid ${pid}`,
      );
      if (check.code === 0) return pid;
      const live = await transport.run(
        deployment.target,
        `systemctl show ${quote(deployment.unit)} -p MainPID --value`,
      );
      if (live.code !== 0 || live.stdout.trim() !== pid)
        throw new Error("Monitor PID changed while draining; upgrade deferred");
      await (transport.wait?.(1000) ?? new Promise((resolve) => setTimeout(resolve, 1000)));
    }
    throw new Error(
      "Upgrade deferred: the live monitor has not acknowledged idle drainage; its service and goals were left running",
    );
  } catch (error) {
    await resumeDiscord(deployment, transport, pid);
    throw error;
  }
}

async function resumeDiscord(
  deployment: DiscordDeployment,
  transport: DiscordDeploymentTransport,
  pid: string,
) {
  const live = await transport.run(
    deployment.target,
    `systemctl show ${quote(deployment.unit)} -p MainPID --value`,
  );
  if (live.code === 0 && live.stdout.trim() === pid) {
    const resumed = await transport.run(
      deployment.target,
      `sudo -n systemctl kill --kill-whom=main --signal=SIGUSR2 ${quote(deployment.unit)}`,
    );
    if (resumed.code !== 0)
      throw new Error(`Monitor resume failed (${resumed.code}); service remains live`);
  }
}

const deploymentTransport: DiscordDeploymentTransport = {
  async run(host, command) {
    const result = await runInfra({ args: ["ssh", "exec", "--host", host, "--cmd", command] });
    return { code: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  },
  async upload(host, source, target) {
    const result = await runInfra({
      args: ["ssh", "sftp", "--host", host, "--put", source, "--path", target, "--json"],
    });
    if (result.exitCode !== 0)
      throw new Error(`Infra upload failed (${result.exitCode}): ${result.stderr}`);
  },
  async build(entrypoint, outdir) {
    const result = await Bun.build({
      entrypoints: [entrypoint],
      outdir,
      naming: "omar-monitor.mjs",
      target: "bun",
    });
    if (!result.success) throw new AggregateError(result.logs, "Discord monitor bundle failed");
  },
};

/** Build, checksum, probe and activate via the existing Infra host plan; private state is never copied. */
export async function deployDiscord(
  deployment: DiscordDeployment,
  transport = deploymentTransport,
  log: (line: string) => void = console.log,
): Promise<void> {
  const exec = async (command: string) => {
    const result = await transport.run(deployment.target, command);
    if (result.code !== 0)
      throw new Error(
        `Discord deployment refused (${result.code}): ${result.stderr || result.stdout}`,
      );
    if (result.stdout.trim()) log(result.stdout.trim());
  };
  const draining = await quiesceDiscord(deployment, transport);
  const stage = await mkdtemp(join(tmpdir(), "aphrody-discord-release-"));
  const remoteStage = `/tmp/${stage.split("/").at(-1)}`;
  let remoteCreated = false;
  let installedChanged = false;
  try {
    await transport.build(deployment.entrypoint, stage);
    const files = [
      {
        source: join(stage, "omar-monitor.mjs"),
        target: deployment.bundle,
        name: "omar-monitor.mjs",
      },
      {
        source: deployment.policy.source,
        target: deployment.policy.target,
        name: "omar-monitor-policy.json",
      },
    ];
    const hashes: Record<string, string> = {};
    await exec(`mkdir -m 700 ${quote(remoteStage)}`);
    remoteCreated = true;
    /* oxlint-disable no-await-in-loop -- upload, install and verify are an ordered release transaction. */
    for (const file of files) {
      hashes[file.name] = new Bun.CryptoHasher("sha256")
        .update(await Bun.file(file.source).arrayBuffer())
        .digest("hex");
      await transport.upload(deployment.target, file.source, `${remoteStage}/${file.name}`);
      await exec(
        `printf '%s  %s\\n' ${quote(hashes[file.name]!)} ${quote(`${remoteStage}/${file.name}`)} | sha256sum -c --quiet -`,
      );
    }
    const worker = `${discordRuntime(deployment)} ${quote(`${remoteStage}/omar-monitor.mjs`)} --policy ${quote(`${remoteStage}/omar-monitor-policy.json`)}`;
    await exec(`${worker} --probe`);
    // Recheck after the build/upload/probe, before any installed code changes.
    if (draining) {
      await exec(
        `${discordRuntime(deployment)} ${quote(deployment.bundle)} --policy ${quote(deployment.policy.target)} --upgrade-check --expect-pid ${draining}`,
      );
    } else {
      await exec(`${worker} --upgrade-check`);
    }
    await exec(
      `sudo -n install -d -o ${quote(deployment.stateOwner)} -g ${quote(deployment.stateOwner)} -m 700 ${quote(deployment.stateDirectory)}`,
    );
    const releasePaths = [
      ...files.map((file) => file.target),
      `/etc/systemd/system/${deployment.unit}`,
    ];
    for (const [index, target] of releasePaths.entries()) {
      await exec(
        `if sudo -n test -f ${quote(target)}; then sudo -n cp -p ${quote(target)} ${quote(`${remoteStage}/previous-${index}`)}; fi`,
      );
    }
    await exec(
      `if systemctl is-active --quiet ${quote(deployment.unit)}; then touch ${quote(`${remoteStage}/previous-active`)}; fi`,
    );
    installedChanged = true;
    for (const file of files) {
      const target = quote(file.target);
      await exec(
        `sudo -n install -o root -g root -m 644 ${quote(`${remoteStage}/${file.name}`)} ${quote(`${file.target}.new`)} && sudo -n mv -f ${quote(`${file.target}.new`)} ${target} && printf '%s  %s\\n' ${quote(hashes[file.name]!)} ${target} | sha256sum -c --quiet -`,
      );
    }
    const failed = await applyPlan(deployment.plan, transport.run, log);
    if (failed.length) throw new Error(`Infra host apply failed: ${failed.join(", ")}`);
    await exec(
      `sudo -n systemctl restart ${quote(deployment.unit)} && systemctl is-active --quiet ${quote(deployment.unit)}`,
    );
    await exec(
      `systemctl show ${quote(deployment.unit)} -p ActiveState -p MainPID -p ExecMainStatus -p NRestarts`,
    );
    log(
      JSON.stringify({ installed: true, target: deployment.target, unit: deployment.unit, hashes }),
    );
  } catch (error) {
    if (installedChanged) {
      const paths = [
        deployment.bundle,
        deployment.policy.target,
        `/etc/systemd/system/${deployment.unit}`,
      ];
      for (const [index, target] of paths.entries()) {
        const previous = quote(`${remoteStage}/previous-${index}`);
        const restored = await transport.run(
          deployment.target,
          `if sudo -n test -f ${previous}; then sudo -n install -o root -g root -m 644 ${previous} ${quote(target)}; else sudo -n rm -f -- ${quote(target)}; fi`,
        );
        if (restored.code !== 0) log(`Release rollback failed for ${target} (${restored.code})`);
      }
      const rollback = await transport.run(
        deployment.target,
        `sudo -n systemctl daemon-reload && if test -f ${quote(`${remoteStage}/previous-active`)}; then sudo -n systemctl enable ${quote(deployment.unit)} && sudo -n systemctl restart ${quote(deployment.unit)}; fi`,
      );
      if (rollback.code !== 0) log(`Service rollback failed (${rollback.code})`);
    }
    throw error;
  } finally {
    if (draining) await resumeDiscord(deployment, transport, draining);
    if (remoteCreated) {
      const cleanup = await transport.run(deployment.target, `rm -rf -- ${quote(remoteStage)}`);
      if (cleanup.code !== 0) log(`Release staging cleanup failed (${cleanup.code})`);
    }
    await rm(stage, { recursive: true, force: true });
  }
}

export interface DiscordBotStatus {
  id: string;
  name: string;
  path: string;
  binaryPath: string;
  binaryExists: boolean;
  binarySizeBytes: number;
  lastModified?: string;
}

/** Checkout of aphrody-labs/shenron, which owns the Shenron bot: SHENRON_ROOT, else the sibling of this repository. */
export function shenronCheckout(root = infraRoot()): string {
  return process.env.SHENRON_ROOT?.trim() || join(root, "..", "shenron");
}

export function getDiscordBotsStatus(root = infraRoot()): DiscordBotStatus[] {
  const shenron = shenronCheckout(root);
  const bots = [
    {
      id: "shenron",
      name: "Shenron Discord Bot + Public API",
      path: join(shenron, "apps/bot"),
      binaryPath: join(shenron, "apps/bot/dist/shenron"),
    },
  ];

  return bots.map((bot) => {
    const exists = existsSync(bot.binaryPath);
    let size = 0;
    let modified: string | undefined;
    if (exists) {
      const stat = statSync(bot.binaryPath);
      size = stat.size;
      modified = stat.mtime.toISOString();
    }
    return Object.assign(bot, {
      binaryExists: exists,
      binarySizeBytes: size,
      lastModified: modified,
    });
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

export async function runDiscord(args: string[] = [], root = infraRoot()): Promise<number> {
  const [subcommand, ...rest] = args;

  if (subcommand === "--help" || subcommand === "-h") {
    console.log(
      "Usage: yolo ops discord <command>\n\nCommands:\n  status    Inspect standalone Discord artifacts\n  compile   Compile a standalone bot through native Aphrody\n  verify    Run Discord product gates\n  inspect   Inspect bot dependencies\n  deploy    Build and deploy a declared Discord service through Infra",
    );
    return 0;
  }

  if (subcommand === "deploy") {
    if (rest.includes("--help") || rest.includes("-h")) {
      console.log(
        "Usage: yolo ops discord deploy omar-monitor --target vps [--apply]\n\nPlan by default. Apply builds product source, checksums uploads, probes Codex/Discord, drains the live monitor and activates the declared Infra unit. Private queue and authentication remain in place.",
      );
      return 0;
    }
    const targetAt = rest.indexOf("--target");
    const target = targetAt >= 0 ? rest[targetAt + 1] : undefined;
    const service = rest[0];
    const allowed = new Set([0, targetAt, targetAt + 1, rest.indexOf("--apply")]);
    if (
      !service ||
      !target ||
      target.startsWith("--") ||
      rest.some((_, index) => !allowed.has(index))
    )
      throw new Error("usage: yolo ops discord deploy omar-monitor --target <host> [--apply]");
    const deployment = discordDeployment(service, target, root);
    console.log(renderPlan(deployment.plan));
    console.log(
      JSON.stringify({
        entrypoint: deployment.entrypoint,
        bundle: deployment.bundle,
        policy: deployment.policy,
        stateDirectory: deployment.stateDirectory,
        upgrade:
          "Refused while a goal is planning or executing; private queue and authentication preserved",
      }),
    );
    if (rest.includes("--apply")) await deployDiscord(deployment);
    return 0;
  }

  if (!subcommand || subcommand === "status") {
    console.log("\n📦 Discord Bots Standalone Binaries Status:");
    const status = getDiscordBotsStatus(root);
    for (const s of status) {
      console.log(`\n• ${s.name} (${s.id})`);
      console.log(`  Directory: ${s.path}`);
      console.log(`  Binary:    ${s.binaryPath}`);
      if (s.binaryExists) {
        console.log(`  State:     ✓ Ready (${formatBytes(s.binarySizeBytes)})`);
        console.log(`  Modified:  ${s.lastModified}`);
      } else {
        console.log(`  State:     ✗ Not compiled (run \`aphrody discord compile ${s.id}\`)`);
      }
    }
    console.log();
    return 0;
  }

  if (subcommand === "compile") {
    const target = rest[0] || "all";
    const smoke = rest.includes("--smoke") || !rest.includes("--no-smoke");
    console.log(
      `\n🚀 Delegating Discord compilation to native aphrody CLI (target: ${target})...\n`,
    );
    const cliPath = join(root, "target/debug/aphrody");
    const cmd = existsSync(cliPath) ? cliPath : "aphrody";

    const proc = Bun.spawn(
      [cmd, "discord", "compile", target, smoke ? "--smoke" : "--smoke=false"],
      {
        cwd: root,
        stdio: ["inherit", "inherit", "inherit"],
      },
    );
    const exitCode = await proc.exited;
    return exitCode;
  }

  if (subcommand === "verify") {
    console.log("\n🔍 Running Discord monorepo gates via native aphrody CLI...\n");
    const cliPath = join(root, "target/debug/aphrody");
    const cmd = existsSync(cliPath) ? cliPath : "aphrody";

    const proc = Bun.spawn([cmd, "discord", "verify"], {
      cwd: root,
      stdio: ["inherit", "inherit", "inherit"],
    });
    const exitCode = await proc.exited;
    return exitCode;
  }

  if (subcommand === "inspect") {
    const target = rest[0] || "shenron";
    const cliPath = join(root, "target/debug/aphrody");
    const cmd = existsSync(cliPath) ? cliPath : "aphrody";

    const proc = Bun.spawn([cmd, "discord", "inspect", target], {
      cwd: root,
      stdio: ["inherit", "inherit", "inherit"],
    });
    const exitCode = await proc.exited;
    return exitCode;
  }

  console.error(
    `Unknown discord operation: ${subcommand}. Usage: ops discord [status|compile|verify|inspect|deploy]`,
  );
  return 1;
}
