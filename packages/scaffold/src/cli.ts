#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { basename, resolve } from "node:path";
import { npmName } from "./names.ts";
import {
  EXAMPLE_NAME,
  scaffold,
  TEMPLATES,
  type ScaffoldRequest,
} from "./index.ts";

const HELP = `aphrody-scaffold: the single project scaffolder of the UI stack.

USAGE
  aphrody-scaffold list
  aphrody-scaffold example <dir>
  aphrody-scaffold new <web|app> <dir> [--name <text>] [--target tauri|vite] [--m3] [--m3-version <x.y.z>]

The directory must be a new or empty declared member of the Aphrody/M3 private owner workspace.
--target vite selects the native Bun web host. Tauri activation requires its registered Rust owner and Workspace factory.
No file is overwritten; no install or network access.`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (arg === "--m3") flags.set("m3", "1");
    else if (arg.startsWith("--"))
      flags.set(arg.slice(2), rest[(index += 1)] ?? "");
    else positional.push(arg);
  }
  if (command === "list") {
    for (const template of TEMPLATES)
      console.log(`${template.name.padEnd(8)} ${template.summary}`);
    return 0;
  }
  if (command === "example" || command === "new") {
    const template = command === "example" ? "example" : positional.shift();
    const dir = positional[0];
    if (!dir || !template)
      throw new Error(`${command} needs a template and a directory\n\n${HELP}`);
    const out = resolve(dir);
    const name = flags.get("name") ?? npmName(basename(out)) ?? EXAMPLE_NAME;
    let request: ScaffoldRequest;
    if (template === "example") request = { template, name };
    else if (template === "app")
      request = {
        template,
        name,
        target: flags.get("target") === "vite" ? "vite" : "tauri",
        modernizeM3: flags.has("m3"),
      };
    else if (template === "web")
      request = {
        template,
        name,
        m3Version: flags.get("m3-version") ?? "3.3.3",
      };
    else throw new Error(`unknown template ${template}`);
    const written = await scaffold(out, request);
    console.log(`${request.template}: ${written.length} files in ${out}`);
    return 0;
  }
  console.log(HELP);
  return command === undefined || command === "help" || command === "--help"
    ? 0
    : 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(
      `aphrody-scaffold: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  },
);
