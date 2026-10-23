#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Restore the pinned Shenron chat backend through Infra, without exposing a public listener. */
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { availableParallelism } from "node:os";

export const CHAT_DIGESTS = {
  base: "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597",
  adapter: "aab485357c68fdcbb6d4ba55911632b8228964106047db035e0223e2aecc6107",
  server: "ae465fee6acc9e401b3e6dc1e9edd958b6578fcbdab58f2499d788da30b58893",
} as const;

export interface ChatRecoveryOptions {
  image: string;
  root: string;
  runtime: string;
  base: string;
  adapter: string;
}

export function chatRecoveryCompose(options: ChatRecoveryOptions) {
  if (!/^aphrody:toolbox-[a-f0-9]{12}$/.test(options.image)) throw new Error("An immutable toolbox image is required");
  for (const path of [options.root, options.runtime, options.base, options.adapter]) {
    if (!path.startsWith("/") || /[\n\r:]/.test(path))
      throw new Error("Absolute Linux paths without mount separators are required");
  }
  return {
    name: "aphrody",
    services: {
      "shenron-chat": {
        image: options.image,
        pull_policy: "never",
        init: true,
        user: "1000:1000",
        network_mode: "host",
        read_only: true,
        tmpfs: ["/tmp:uid=1000,gid=1000,mode=0700"],
        cap_drop: ["ALL"],
        security_opt: ["no-new-privileges:true"],
        restart: "unless-stopped",
        mem_limit: "4500m",
        cpus: 5,
        environment: { HOME: "/tmp", LD_LIBRARY_PATH: "/llama" },
        volumes: [
          `${options.runtime}:/llama:ro`,
          `${options.base}:/models/base.gguf:ro`,
          `${options.adapter}:/models/adapter.gguf:ro`,
        ],
        command: [
          "/llama/llama-server",
          "--model",
          "/models/base.gguf",
          "--lora",
          "/models/adapter.gguf",
          "--alias",
          "shenron-chat-v2",
          "--host",
          "127.0.0.1",
          "--port",
          "8799",
          "--ctx-size",
          "8192",
          "--parallel",
          "1",
          "--threads",
          "4",
          "--threads-batch",
          "5",
          "--n-gpu-layers",
          "0",
        ],
        healthcheck: {
          test: ["CMD", "curl", "-fsS", "http://127.0.0.1:8799/health"],
          interval: "30s",
          timeout: "5s",
          retries: 3,
          start_period: "90s",
        },
      },
    },
  };
}

async function digest(path: string) {
  const hash = new Bun.CryptoHasher("sha256");
  for await (const part of Bun.file(path).stream()) hash.update(part);
  return hash.digest("hex");
}

async function run(args: string[]) {
  const child = Bun.spawn(args, { stdout: "inherit", stderr: "inherit" });
  if (await child.exited) throw new Error(`Chat recovery command failed: ${args[0]}`);
}

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const index = args.indexOf(name);
    if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`);
    return args[index + 1]!;
  };
  const options = {
    image: value("--image"),
    root: value("--root"),
    runtime: value("--runtime"),
    base: value("--base"),
    adapter: value("--adapter"),
  };
  const compose = chatRecoveryCompose(options);
  const manifest = join(options.root, "chat-compose.json");
  console.log(
    JSON.stringify(
      {
        owner: "aphrody-infra",
        mode: args.includes("--apply") ? "apply" : "plan",
        manifest,
        model: "shenron-chat-v2",
        digests: CHAT_DIGESTS,
        listener: "127.0.0.1:8799",
        rollback: `docker compose -f ${manifest} stop shenron-chat`,
      },
      null,
      2,
    ),
  );
  if (!args.includes("--apply")) return;
  if (process.getuid?.() !== 0) throw new Error("Apply requires the Infra root execution path");
  if (availableParallelism() < 6) throw new Error("Chat requires six host CPUs to reserve one for product services");
  for (const [kind, path] of [
    ["base", options.base],
    ["adapter", options.adapter],
    ["server", join(options.runtime, "llama-server")],
  ] as const) {
    if ((await digest(path)) !== CHAT_DIGESTS[kind]) throw new Error(`Pinned ${kind} digest mismatch`);
  }
  await run(["docker", "image", "inspect", "--format", "{{.Id}}", options.image]);
  mkdirSync(options.root, { recursive: true, mode: 0o700 });
  await Bun.write(manifest, JSON.stringify(compose, null, 2) + "\n");
  chmodSync(manifest, 0o600);
  await run(["docker", "compose", "-f", manifest, "config", "--quiet"]);
  await run(["docker", "compose", "-f", manifest, "up", "-d", "--wait", "--wait-timeout", "180", "shenron-chat"]);
}

if (import.meta.main) await main();
