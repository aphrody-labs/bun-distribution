#!/usr/bin/env bun
import { configureGameVfs } from "./core/vfs-data.js";
import { locateGameSource } from "./ffi/nie.js";
import { configuredDataSource, selectDataSource } from "./core/data-source.js";
import { cfgbinDbAvailable } from "./core/cfgbin-db.js";
import { Command } from "commander";
import {
  registerCharacterCommand,
  registerCompareCommand,
  registerDialogueCommand,
  registerItemsCommand,
  registerRandomTeamCommand,
  registerSearchCommand,
  registerSkillsCommand,
  registerStatsCommand,
  registerTeamBuilderCommand,
  registerTeamsCommand,
} from "./cli-commands.js";
import { registerMenuCommand } from "./cli-menu.js";

// Static require is bundled by Bun, including standalone CLI builds.
const packageMetadata: { version: string } = require("../package.json");
const program = new Command();

program
  .name("inagle")
  .description("Inazuma Eleven Victory Road Data CLI")
  .version(packageMetadata.version)
  .option(
    "--game-dir <source>",
    "Game root, data directory, nie.exe or HTTP/SSH source; defaults to shared discovery",
  )
  .option("--data-source <source>", "Data adapter: auto, vfs, sqlite or postgres")
  .hook("preAction", () => {
    const options = program.opts();
    process.env.INAGLE_DATA_SOURCE = selectDataSource({
      explicit: options.dataSource ?? configuredDataSource(),
      sqliteAvailable: cfgbinDbAvailable(),
      postgresDisabled: process.env.IEVR_CFGBIN_POSTGRES === "0",
    });
    process.env.NIE_DATA_SOURCE = process.env.INAGLE_DATA_SOURCE;
    configureGameVfs(options.gameDir);
  });

// Register all commands
registerStatsCommand(program);
registerSearchCommand(program);
registerCharacterCommand(program);
registerCompareCommand(program);
registerDialogueCommand(program);
registerRandomTeamCommand(program);
registerTeamBuilderCommand(program);
registerMenuCommand(program);
registerItemsCommand(program);
registerSkillsCommand(program);
registerTeamsCommand(program);
// The database publication adapter is loaded only when explicitly selected.
if (Bun.argv.slice(2).some((argument) => argument === "push")) {
  const { registerPushCommand } = await import("./cli-push.js");
  registerPushCommand(program);
} else {
  program.command("push").description("Optional PostgreSQL publication adapter");
}

program
  .command("locate")
  .description("Locate the shared game source without mounting its VFS")
  .option("--json", "Output source and Rust discovery latency")
  .action((options) => {
    const result = locateGameSource(program.opts().gameDir);
    console.log(options.json ? JSON.stringify(result) : result.source);
  });
program.parse();
