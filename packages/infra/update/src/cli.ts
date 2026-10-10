// SPDX-License-Identifier: Apache-2.0
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
import type { NativeJobTransport } from "./job-hosts.ts";

/** `yolo update`: toolchain pins, dependencies, Cargo lock, user systemd units and dev-env checks. */
export const updateHelp = `yolo update: one entry point for toolchain pins, dependencies, Cargo lock, user systemd units and dev-env checks.

  yolo update check                     pins agree + systemd units match the yolo catalog + wsl.conf matches (gate, exit 1 on drift)
  yolo update pins [check|apply <tool> <version>]
  yolo update tools [<tool>] [--apply]  installed vs pinned vs latest; --apply installs and re-pins
  yolo update cargo [--apply]           Cargo.lock refresh within manifest ranges (dry run by default)
  yolo update deps <sub> [...]          dependency pipeline: plan|apply|facts|fix|changelog|memory|inventory|baseline|run
  yolo update systemd [check|install|restart]
  yolo update systemd jobs --binary-sha256 HEX [--apply]   qualify and activate the declared local MCP and worker units
  yolo update systemd jobs-clients --host vps|dbfr|wsl --binary-sha256 HEX [--apply]   prepare protected native MCP clients; repeat --host for each selected host
  yolo update systemd jobs-clients --host vps --host dbfr --host wsl --binary-sha256 HEX --qualify --apply   prove each current worker with a durable read-only native Web job
  yolo update sources [status|sync|verify|drift|forks|repo|bump]   upstream source checkouts, upstream pins, forks, git state
  yolo update rust|bun|uv <status|plan|apply|verify>   per-ecosystem structured bump (docs/operations/infra/update/{RUST,BUN,UV}.md)
  yolo update upstream [list|drift|refresh|fetch|prune|docs]   reference upstreams: catalogue, live drift, disposable fetch
  yolo update run [--apply]             tools, cargo, deps, systemd restart, then the gates (report only without --apply)
Global flags: --root <repo>, --json`;

export async function runUpdate(
  argv: string[],
  ports: { nativeJobTransport?: NativeJobTransport } = {},
): Promise<number> {
  const ri = argv.indexOf("--root");
  const root = resolve(ri >= 0 ? argv[ri + 1]! : process.cwd());
  const args = argv.filter((a, i) => !(a === "--root" || (ri >= 0 && i === ri + 1)));
  const c = new Ctx(root, args.includes("--apply"), args.includes("--json"));
  const [mod = "check", ...rest] = args;
  switch (mod) {
    case "help":
    case "-h":
    case "--help":
      console.log(updateHelp);
      return 0;
    case "check": {
      const pins = checkPins(c);
      let bad = 0;
      for (const r of pins) {
        console.log(
          `pin    ${r.tool.padEnd(10)} ${r.pin ?? "?"} ${r.drift.length ? `DRIFT ${r.drift.length}` : "ok"}`,
        );
        bad += r.drift.length;
      }
      for (const l of repoState(c.root)) console.log(`repo   ${l}`);
      const docs = await runUpstream(c, ["docs"]);
      return (bad ? 1 : 0) | docs | checkSystemd(c);
    }
    case "pins":
      return runPins(c, rest);
    case "tools":
      return runTools(c, [mod, ...rest]);
    case "cargo":
      return runCargo(c, rest);
    case "deps":
      return runDepsSync(rest.length ? [...rest, "--root", root] : ["plan", "--root", root]);
    case "systemd":
      return runSystemd(c, rest, ports);
    case "sources":
      return runSources(c, rest);
    case "upstream":
      return runUpstream(c, rest);
    case "rust":
      return runRust([...rest, "--root", root]);
    case "bun":
      return runBun([...rest, "--root", root]);
    case "uv":
      return runUv([...rest, "--root", root]);
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
    default:
      console.error(`unknown module ${mod}`);
      return 2;
  }
}
