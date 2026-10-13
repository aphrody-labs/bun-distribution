#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { basename } from "node:path";
import pkg from "../package.json";
import { UsageError } from "./shared/args.ts";
import { logCrash } from "./shared/crash.ts";

export const VERSION: string = pkg.version;

/** Historical executable names dispatch to modules of the same product. */
export function productArgs(
  argv: string[],
  executable = Bun.argv[1] ?? process.execPath,
): string[] {
  const name = basename(executable)
    .replace(/\.exe$/i, "")
    .toLowerCase();
  if (/^(aphrody-omar|aphrody-omar-admin)$/.test(name)) return ["admin", ...argv];
  if (name === "creator-kit") return ["creator", ...argv];
  return argv;
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "--version" || command === "-v") {
    console.log(VERSION);
    return 0;
  }
  if (command === "--help" || command === "-h" || command === "help") {
    console.log(
      `Aphrody ${VERSION}\n\naphrody-product setup [--oui] [--roles admin,createur] [--simuler]\naphrody-product admin <commande>\naphrody-product creator <commande>\naphrody-product web start|os [--help]\naphrody-product mise-a-jour [--check]\n\nSans argument : installation et réparation d’Aphrody.`,
    );
    return 0;
  }
  // Every role updates the whole product from the same verified release.
  if (
    (command === "admin" && rest[0] === "mise-a-jour") ||
    (command === "creator" && rest[0] === "self-update")
  ) {
    return (await import("./setup/cli.ts")).main(["mise-a-jour", ...rest.slice(1)]);
  }
  if (command === "interne") return (await import("./admin/cli.ts")).guarded(argv);
  if (command === "web") return (await import("./web.ts")).main(rest);
  if (command === "admin") return (await import("./admin/cli.ts")).guarded(rest);
  if (command === "creator") return (await import("./creator/cli.ts")).guarded(rest);
  return (await import("./setup/cli.ts")).main(command === "setup" ? rest : argv);
}

if (import.meta.main) {
  const args = productArgs(Bun.argv.slice(2));
  // The root installer owns the background update, including both embedded roles.
  process.env.APHRODY_OMAR_NO_UPDATE = "1";
  process.env.CREATOR_KIT_NO_UPDATE = "1";
  try {
    if (!args.includes("--version") && !args.includes("--help") && args[0] !== "mise-a-jour") {
      const { autoUpdateInBackground } = await import("./admin/lib/update.ts");
      const { setupApp } = await import("./setup/cli.ts");
      const notice = await autoUpdateInBackground(process.env, setupApp(VERSION)).catch(
        () => undefined,
      );
      if (notice) console.error(notice);
    }
    process.exitCode = await main(args);
  } catch (error) {
    if (
      error instanceof UsageError ||
      (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")
    ) {
      console.error((error as Error).message);
      process.exitCode = 2;
    } else {
      logCrash(error, args, process.env, {
        name: "Aphrody/Setup",
        version: VERSION,
        disableEnv: "APHRODY_SETUP_NO_UPDATE",
        updateCommand: "mise-a-jour",
      });
      console.error(
        `Erreur inattendue : ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
  }
}
