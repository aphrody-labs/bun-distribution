#!/usr/bin/env bun
import { registry, summaries } from "./commands/index.ts";
import { UsageError } from "./lib/args.ts";
import { autoUpdateInBackground, VERSION } from "./lib/update.ts";

function help(): string {
  const width = Math.max(...Object.keys(summaries).map((name) => name.length));
  const lines = Object.entries(summaries).map(([name, text]) => `  ${name.padEnd(width)}  ${text}`);
  return `creator-kit <commande> [options]\n\nCommandes :\n${lines.join("\n")}\n\n"creator-kit <commande> --help" détaille les options.`;
}

export async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (name === "--version" || name === "-v") {
    console.log(VERSION);
    return 0;
  }
  if (!name || name === "--help" || name === "-h" || name === "help") {
    console.log(help());
    return 0;
  }
  const load = registry[name];
  if (!load) {
    console.error(`Commande inconnue : ${name}\n\n${help()}`);
    return 2;
  }
  if (name !== "self-update") {
    const notice = await autoUpdateInBackground().catch(() => undefined);
    if (notice) console.error(notice);
  }
  const { default: command } = await load();
  try {
    return await command.run(rest);
  } catch (error) {
    if (
      error instanceof UsageError ||
      (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")
    ) {
      console.error(`${(error as Error).message}\n(creator-kit ${name} --help)`);
      return 2;
    }
    throw error;
  }
}

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2)));
}
