// SPDX-License-Identifier: Apache-2.0
/**
 * Contrats importables des tâches cron ; aucune exécution à l'import.
 *
 * Les planifications vivent dans Supabase (`pg_cron` → `POST /v1/cron/<tâche>`) ;
 * ce module expose le registre, l'exécuteur et la route HTTP, plus une CLI
 * `--run <tâche> [argument]` pour les exécutions manuelles.
 */
import { lancerTache, REGISTRE_TACHES } from "./registry";

export { CATALOGUE_TACHES, PLANIFICATIONS, TACHES_CRON } from "@rosegriffon/types/cron";
export {
  executeTask,
  lancerTache,
  REGISTRE_TACHES,
  resoudreNomTache,
  type DefinitionTache,
  type ResultatTache,
} from "./registry";
export { handleCronHttp } from "./http";
export { handleAnnounceHttp } from "./announce";

/** Ordre de `--run all` : celui de l'ancien démon. */
const TOUTES = [
  "publish",
  "warm",
  "db",
  "patreon",
  "cdn",
  "crawl",
  "reminders",
  "discord",
  "discord:scan",
  "discord:messages",
  "discord:polls",
  "x:campagnes",
  "campagnes:discord",
  "campagnes:instagram",
  "campagnes:relais",
  "seo:llms-txt",
  "seo:indexnow",
  "stats:achillea",
  "achillea:seasons",
  "achillea:weekly-payout",
] as const;

const COMPOSITES: Record<string, readonly string[]> = {
  all: TOUTES,
  seo: ["seo:llms-txt", "seo:indexnow"],
};

async function cli(args: string[]): Promise<number> {
  const indiceRun = args.indexOf("--run");
  const tache = indiceRun >= 0 ? args[indiceRun + 1] : undefined;
  if (!tache || args.includes("--help") || args.includes("-h")) {
    const noms = [...Object.keys(REGISTRE_TACHES), ...Object.keys(COMPOSITES)];
    console.log(`Usage: rg-cron --run <tâche> [argument]\nTâches : ${noms.join(", ")}`);
    return tache ? 0 : 1;
  }
  const argument = args[indiceRun + 2];
  const suite = COMPOSITES[tache] ?? [tache];
  let succes = true;
  for (const nom of suite) {
    console.log(`🏃 Exécution manuelle de la tâche : ${nom}`);
    const resultat = await lancerTache(nom, { origine: "cli", argument: suite.length === 1 ? argument : undefined });
    if (!resultat.success) {
      succes = false;
      console.error(`❌ ${resultat.nom} : ${resultat.error ?? "échec"}`);
    }
  }
  return succes ? 0 : 1;
}

/** CLI `rg-cron --run <tâche> [argument]` : exécute puis termine le processus avec son code de sortie. */
export async function runCronCli(args: string[] = process.argv.slice(2)): Promise<never> {
  process.exit(await cli(args));
}

if (import.meta.main) await runCronCli();
