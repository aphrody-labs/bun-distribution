// SPDX-License-Identifier: Apache-2.0
/** Importable task contracts; runtime startup is explicit. */
export { CATALOGUE_TACHES, PLANIFICATIONS, TACHES_CRON } from "@rosegriffon/types/cron";

export async function startCronDaemon(): Promise<void> {
  await import("./daemon.ts");
}

if (import.meta.main) {
  if (process.argv.slice(2).some(arg => arg === "--help" || arg === "-h"))
    console.log("Usage: rg-cron [--run <task>]. No --run starts the scheduled daemon.");
  else await startCronDaemon();
}
