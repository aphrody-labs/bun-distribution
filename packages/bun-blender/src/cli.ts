#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { findBlender } from "./discover.ts";
import { info, render, runScript, serveHeadless } from "./headless.ts";
import type { RunResult } from "./types.ts";

const USAGE = `Usage: bun-blender <command>
  where                         Show the discovered Blender install
  info [file.blend]             Print scenes and objects as JSON
  render <file.blend> [-o out] [-f frame] [--anim] [-e engine] [--format PNG]
  run <script.py> [--blend file] [-- args]
  serve [file.blend]            Headless Blender session serving the blender_mcp bridge`;

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    output: { type: "string", short: "o" },
    frame: { type: "string", short: "f" },
    anim: { type: "boolean" },
    engine: { type: "string", short: "e" },
    format: { type: "string" },
    blend: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

const [cmd, target, ...rest] = positionals;

async function pass(res: RunResult): Promise<never> {
  await Bun.write(Bun.stdout, res.stdout);
  await Bun.write(Bun.stderr, res.stderr);
  process.exit(res.exitCode);
}

function usage(code: number): never {
  (code ? console.error : console.log)(USAGE);
  process.exit(code);
}

switch (values.help ? undefined : cmd) {
  case "where":
    console.log(JSON.stringify(await findBlender(), null, 2));
    break;
  case "serve":
    process.exit(await (await serveHeadless(target, undefined, true)).exited);
  case "info":
    console.log(JSON.stringify(await info(target), null, 2));
    break;
  case "render":
    if (!target) usage(2);
    await pass(
      await render(target, {
        output: values.output,
        frame: values.frame ? Number(values.frame) : undefined,
        animation: values.anim,
        engine: values.engine,
        format: values.format,
      }),
    );
  case "run":
    if (!target) usage(2);
    await pass(await runScript(target, values.blend, rest));
  case undefined:
    usage(0);
  default:
    usage(2);
}
