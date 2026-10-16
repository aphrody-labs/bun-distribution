/** `azalee sync` — synchronisation des données locales vers PostgreSQL. */

import type { Command } from "commander";

import { colors } from "../context";
import { exitUnlessRepl } from "../repl-state";
import type { SyncOptions } from "../types";

export function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description("Synchronise les fichiers locaux de données avec la base PostgreSQL locale")
    .option("-p, --push", "Pousse les données Inagle locales vers PostgreSQL (inagle push)")
    .action(async (options: SyncOptions) => {
      if (options.push) {
        console.log(
          `${colors.cyan}Exécution de inagle push pour synchroniser les configs de données...${colors.reset}`,
        );
        const proc = Bun.spawn(["bun", "packages/inagle/src/cli-push.ts"], {
          stdout: "inherit",
          stderr: "inherit",
        });
        const code = await proc.exited;
        exitUnlessRepl(code);
      } else {
        console.log(`${colors.yellow}Veuillez spécifier l'option: --push.${colors.reset}`);
      }
    });
}
