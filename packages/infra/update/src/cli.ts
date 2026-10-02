#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * aphrody-update: one entry point for toolchain pins, dependencies, Cargo lock, user systemd units and dev-env checks.
 *
 *   aphrody-update check                     pins agree + systemd units linked + wsl.conf matches (gate, exit 1 on drift)
 *   aphrody-update pins [check|apply <tool> <version>]
 *   aphrody-update tools [<tool>] [--apply]  installed vs pinned vs latest; --apply installs and re-pins
 *   aphrody-update cargo [--apply]           Cargo.lock refresh within manifest ranges (dry run by default)
 *   aphrody-update deps <sub> [...]          dependency pipeline: plan|apply|facts|fix|changelog|memory|inventory|baseline|run
 *   aphrody-update systemd [check|install|restart]
 *   aphrody-update run [--apply]             tools, cargo, deps, systemd restart, then the gates (report only without --apply)
 * Global flags: --root <repo>, --json
 */
import { resolve } from "node:path";
import { Ctx } from "./context.ts";
import { runPins, check as checkPins } from "./pins.ts";
import { runTools } from "./tools.ts";
import { runCargo } from "./cargo.ts";
import { runSystemd, check as checkSystemd, restart } from "./systemd.ts";
import { runDepsSync } from "./deps/sync.ts";

export async function runUpdate(argv: string[]): Promise<number> {
  const ri = argv.indexOf("--root");
  const root = resolve(ri >= 0 ? argv[ri + 1]! : process.cwd());
  const args = argv.filter((a, i) => !(a === "--root" || (ri >= 0 && i === ri + 1)));
  const c = new Ctx(root, args.includes("--apply"), args.includes("--json"));
  const [mod = "check", ...rest] = args;
  switch (mod) {
    case "check": {
      const pins = checkPins(c);
      let bad = 0;
      for (const r of pins) { console.log(`pin    ${r.tool.padEnd(10)} ${r.pin ?? "?"} ${r.drift.length ? `DRIFT ${r.drift.length}` : "ok"}`); bad += r.drift.length; }
      return (bad ? 1 : 0) | checkSystemd(c);
    }
    case "pins": return runPins(c, rest);
    case "tools": return runTools(c, [mod, ...rest]);
    case "cargo": return runCargo(c, rest);
    case "deps": return runDepsSync(rest.length ? [...rest, "--root", root] : ["plan", "--root", root]);
    case "systemd": return runSystemd(c, rest);
    case "run": {
      await runTools(c, ["tools"]);
      const code = runCargo(c, []);
      await runDepsSync([...(c.apply ? ["run", "--apply"] : ["run"]), "--root", root]);
      if (c.apply) restart(c, [".bun/bin/bun", "aphrody"]);
      return code | (await runUpdate(["check", "--root", root]));
    }
    default: console.error(`unknown module ${mod}`); return 2;
  }
}

if (import.meta.main) process.exit(await runUpdate(process.argv.slice(2)));
