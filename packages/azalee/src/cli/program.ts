/**
 * Construction du programme `azalee`.
 *
 * `createAzaleeProgram()` renvoie un `Command` **entièrement configuré mais
 * non exécuté** : c'est ce qui rend le CLI testable (on peut inspecter les
 * commandes, leurs options et leur aide sans lancer de processus) et
 * réutilisable (le shell interactif reparse ses lignes sur cette même
 * instance, donc une commande se comporte à l'identique dans les deux modes).
 *
 * L'ordre d'enregistrement ci-dessous **est** l'ordre d'affichage de
 * `azalee --help` : le modifier change l'aide.
 */

import { Command } from "commander";

import { registerAuditCommand, registerTestVariantsCommand } from "./commands/audit";
import { registerCharaCommand } from "./commands/chara";
import { registerCompareCommand } from "./commands/compare";
import { registerDataCommand } from "./commands/data";
import { registerDbCommand } from "./commands/db";
import { registerDialogueCommand } from "./commands/dialogue";
import { registerItemCommand } from "./commands/item";
import { registerRandomTeamCommand } from "./commands/random-team";
import { registerRedisCommand } from "./commands/redis";
import { registerRepairCommand } from "./commands/repair";
import { registerSearchCommand } from "./commands/search";
import { registerServeCommand } from "./commands/serve";
import { registerShellCommand } from "./commands/shell";
import { registerSkillCommand } from "./commands/skill";
import { registerStatusCommand } from "./commands/status";
import { registerSyncCommand } from "./commands/sync";
import { registerTeamCommand } from "./commands/team";
import { registerTeamBuilderCommand } from "./commands/team-builder";
import { registerTestCommand } from "./commands/test";
import { registerTranslateCommand } from "./commands/translate";
import { registerWaveCommand } from "./commands/wave";

// Static require embeds package metadata in Bun standalone builds.
const packageMetadata: { version: string } = require("../../package.json");
export const CLI_VERSION = packageMetadata.version;

/** Nom du binaire, tel qu'affiché dans l'aide et les messages d'erreur. */
export const CLI_NAME = "azalee";

/** Assemble le programme complet sans l'exécuter. */
export function createAzaleeProgram(): Command {
  const program = new Command();

  program.name(CLI_NAME).description("CLI d'Azalée pour Inazuma Eleven: Victory Road").version(CLI_VERSION);

  // Données & traduction
  registerTranslateCommand(program);
  registerSearchCommand(program);
  registerDbCommand(program);
  registerRedisCommand(program);

  // Diagnostics
  registerAuditCommand(program);
  registerTestVariantsCommand(program);
  registerStatusCommand(program);

  // Opérations
  registerWaveCommand(program);
  registerRepairCommand(program);
  registerSyncCommand(program);

  // Encyclopédie
  registerCompareCommand(program);
  registerCharaCommand(program);
  registerDialogueCommand(program);
  registerSkillCommand(program);
  registerItemCommand(program);
  registerTeamCommand(program);
  registerRandomTeamCommand(program);
  registerTeamBuilderCommand(program);

  // Vérification, shell, pipeline, API
  registerTestCommand(program);
  registerShellCommand(program);
  registerDataCommand(program);
  registerServeCommand(program);

  return program;
}
