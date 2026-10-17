#!/usr/bin/env bun
import {
  plan,
  resolveTool,
  targets,
  type RunOptions,
  type TargetId,
} from "./index.ts";

const [cmd, ...rest] = Bun.argv.slice(2);

function parse(args: string[]): { id?: string; o: RunOptions; dry: boolean } {
  const o: RunOptions = { extra: [] };
  let id: string | undefined;
  let dry = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--") {
      o.extra.push(...args.slice(i + 1));
      break;
    } else if (a === "--dry-run") dry = true;
    else if (a === "--arch") o.arch = args[++i] as RunOptions["arch"];
    else if (a === "--memory") o.memory = args[++i];
    else if (a === "--avd") o.avd = args[++i];
    else if (!id) id = a;
    else o.image = a;
  }
  return { id, o, dry };
}

switch (cmd) {
  case "list":
  case "doctor": {
    for (const t of Object.values(targets)) {
      const tool = resolveTool(t);
      console.log(
        `${t.id.padEnd(9)} ${tool ? "ok     " : "missing"} ${t.title}${tool ? ` (${tool})` : ` — needs ${t.tools.join("|")}`}; input: ${t.needs}`,
      );
    }
    break;
  }
  case "run": {
    const { id, o, dry } = parse(rest);
    if (!id || !(id in targets)) {
      console.error(
        `usage: bun-emu run <${Object.keys(targets).join("|")}> [image] [--arch x86_64|arm64] [--memory 4G] [--dry-run] [-- extra]`,
      );
      process.exit(2);
    }
    const argv = plan(id as TargetId, o);
    if (dry) {
      console.log(argv.join(" "));
      break;
    }
    const p = Bun.spawn(argv, { stdio: ["inherit", "inherit", "inherit"] });
    process.exit(await p.exited);
  }
  default:
    console.error("usage: bun-emu <list|doctor|run> …");
    process.exit(cmd ? 2 : 0);
}
