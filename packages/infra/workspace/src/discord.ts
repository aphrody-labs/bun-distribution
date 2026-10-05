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
import { join } from "node:path";
import { infraRoot } from "./runtime.ts";

export interface DiscordBotStatus {
  id: string;
  name: string;
  path: string;
  binaryPath: string;
  binaryExists: boolean;
  binarySizeBytes: number;
  lastModified?: string;
}

export function getDiscordBotsStatus(root = infraRoot()): DiscordBotStatus[] {
  const bots = [
    {
      id: "shenron",
      name: "Shenron Discord Bot + Public API",
      path: join(root, "apps/shenron/bot"),
      binaryPath: join(root, "apps/shenron/bot/dist/shenron"),
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
	lastModified: modified
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
    `Unknown discord operation: ${subcommand}. Usage: ops discord [status|compile|verify|inspect]`,
  );
  return 1;
}
