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
 *   aphrody-update sources [status|sync|verify|drift|forks|repo|bump]   upstream source checkouts, upstream pins, forks, git state
 *   aphrody-update rust|bun|uv <status|plan|apply|verify>   per-ecosystem structured bump (docs/operations/infra/update/{RUST,BUN,UV}.md)
 *   aphrody-update upstream [list|drift|refresh|fetch|prune|docs]   reference upstreams: catalogue, live drift, disposable fetch
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
import { runSources, repoState } from "./sources/drift.ts";
import { runUpstream } from "./sources/upstream.ts";
import { runRust } from "./ecosystems/rust.ts";
import { runBun } from "./ecosystems/bun.ts";
import { runUv } from "./ecosystems/uv.ts";

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
      for (const l of repoState(c.root)) console.log(`repo   ${l}`);
      const docs = await runUpstream(c, ["docs"]);
      return (bad ? 1 : 0) | docs | checkSystemd(c);
    }
    case "pins": return runPins(c, rest);
    case "tools": return runTools(c, [mod, ...rest]);
    case "cargo": return runCargo(c, rest);
    case "deps": return runDepsSync(rest.length ? [...rest, "--root", root] : ["plan", "--root", root]);
    case "systemd": return runSystemd(c, rest);
    case "sources": return runSources(c, rest);
    case "upstream": return runUpstream(c, rest);
    case "rust": return runRust([...rest, "--root", root]);
    case "bun": return runBun([...rest, "--root", root]);
    case "uv": return runUv([...rest, "--root", root]);
    case "run": {
      await runTools(c, ["tools"]);
      await runSources(c, c.apply ? ["sync"] : ["drift"]);
      if (!c.apply) {
        await runUpstream(c, ["drift"]);
        await runSources(c, ["forks"]);
      }
      const code = runCargo(c, []);
      await runDepsSync([...(c.apply ? ["run", "--apply"] : ["run"]), "--root", root]);
      if (c.apply) restart(c, [".bun/bin/bun", "aphrody"]);
      return code | (await runUpdate(["check", "--root", root]));
    }
    default: console.error(`unknown module ${mod}`); return 2;
  }
}

if (import.meta.main) process.exit(await runUpdate(process.argv.slice(2)));
