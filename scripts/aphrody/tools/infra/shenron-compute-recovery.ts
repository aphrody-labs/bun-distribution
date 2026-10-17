#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Scoped restoration of the declared DBFR compute and E5 containers. Plan unless --apply. */
import { existsSync, mkdirSync, chmodSync, chownSync, statSync } from "node:fs";
import { join } from "node:path";

export interface RecoveryOptions {
  image: string;
  root: string;
  home: string;
  envFile: string;
  apply: boolean;
}

export function recoveryCompose(options: RecoveryOptions) {
  if (!/^aphrody:toolbox-[a-f0-9]{12}$/.test(options.image))
    throw new Error("An immutable toolbox binary-digest tag is required");
  for (const path of [options.root, options.home, options.envFile]) {
    if (!path.startsWith("/") || path.includes("\n")) throw new Error("Absolute host paths required");
  }
  const common = {
    image: options.image,
    pull_policy: "never",
    init: true,
    user: "1000:1000",
    network_mode: "host",
    read_only: true,
    tmpfs: ["/tmp", "/home/ubuntu:uid=1000,gid=1000,mode=0700"],
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    restart: "unless-stopped",
  };
  return {
    name: "aphrody",
    services: {
      "shenron-compute": {
        ...common,
        command: ["aphrody-mcp", "http", "--bind", "127.0.0.1:8789"],
        working_dir: options.home,
        env_file: [options.envFile],
        environment: { HOME: "/home/ubuntu", APHRODY_HOME: options.home },
        volumes: [`${options.home}:${options.home}`],
        mem_limit: "3g",
        depends_on: { "shenron-embed": { condition: "service_healthy" } },
        healthcheck: {
          test: ["CMD", "curl", "-fsS", "http://127.0.0.1:8789/healthz"],
          interval: "30s",
          timeout: "5s",
          retries: 3,
        },
      },
      "shenron-embed": {
        ...common,
        command: [
          "aphrody-embed",
          "serve",
          "--host",
          "127.0.0.1",
          "--port",
          "8085",
          "--threads",
          "4",
          "--model-dir",
          "/models/e5",
        ],
        volumes: [`${join(options.root, "models/e5")}:/models/e5:ro`],
        mem_limit: "2500m",
        healthcheck: {
          test: ["CMD", "curl", "-fsS", "http://127.0.0.1:8085/health"],
          interval: "30s",
          timeout: "5s",
          retries: 3,
        },
      },
    },
  };
}

async function run(argv: string[], timeoutMs: number) {
  const child = Bun.spawn(argv, { stdout: "inherit", stderr: "inherit" });
  const timer = setTimeout(() => child.kill(), timeoutMs);
  try {
    const code = await child.exited;
    if (code !== 0) throw new Error(`Recovery phase failed: ${argv[0]} (${code})`);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string, fallback: string) => {
    const index = args.indexOf(name);
    return index < 0 ? fallback : (args[index + 1] ?? "");
  };
  const options: RecoveryOptions = {
    image: value("--image", ""),
    root: value("--root", "/home/ubuntu/apps/shenron-compute"),
    home: value("--home", "/home/ubuntu/.aphrody/workspaces/dbfr"),
    envFile: value("--env-file", "/etc/aphrody/shenron-compute.env"),
    apply: args.includes("--apply"),
  };
  const compose = recoveryCompose(options);
  const manifest = join(options.root, "compose.json");
  console.log(
    JSON.stringify(
      {
        owner: "aphrody-infra",
        mode: options.apply ? "apply" : "plan",
        image: options.image,
        manifest,
        services: Object.keys(compose.services),
        model: "intfloat/multilingual-e5-small (native pinned SHA256 verification)",
        preserved: ["existing containers", "editorial databases", "agent home", "chat model"],
        rollback: `docker compose -f ${manifest} stop shenron-compute shenron-embed`,
      },
      null,
      2,
    ),
  );
  if (!options.apply) return;
  if (process.getuid?.() !== 0) throw new Error("Apply requires root to read the existing protected environment");
  if (!existsSync(options.home) || !existsSync(options.envFile))
    throw new Error("Existing home and environment required");
  if ((statSync(options.envFile).mode & 0o077) !== 0) throw new Error("Compute environment must be private");
  await run(["docker", "image", "inspect", "--format", "{{.Id}}", options.image], 30_000);
  // Preserve the existing private stores. Only a new bounded model installation is writable here.
  const models = join(options.root, "models/e5");
  mkdirSync(models, { recursive: true, mode: 0o755 });
  await run(["/home/ubuntu/.local/bin/aphrody-embed", "install", "--model-dir", models], 20 * 60_000);
  chmodSync(models, 0o755);
  chownSync(models, 1000, 1000);
  for (const name of ["config.json", "tokenizer.json", "model.safetensors"]) {
    const path = join(models, name);
    chmodSync(path, 0o644);
    chownSync(path, 1000, 1000);
  }
  await Bun.write(manifest, `${JSON.stringify(compose, null, 2)}\n`);
  chmodSync(manifest, 0o600);
  await run(["docker", "compose", "-f", manifest, "config", "--quiet"], 30_000);
  await run(
    [
      "docker",
      "compose",
      "-f",
      manifest,
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "180",
      "shenron-embed",
      "shenron-compute",
    ],
    240_000,
  );
}

if (import.meta.main) await main();
