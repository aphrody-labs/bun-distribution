#!/usr/bin/env bun
/**
 * Installs, lists, verifies and rolls back precompiled runtime artifacts (implementation in
 * packages/runtime/src/release.ts).
 *
 *   bun run scripts/release/runtime_release.ts install [dist/runtime/<target>]
 *   bun run scripts/release/runtime_release.ts list | verify | rollback
 */
import { join, resolve } from "node:path";
import {
  hostTarget,
  runtimeHome,
  verifyArtifact,
} from "@aphrody/runtime-sdk/artifact";
import { install, list, rollback } from "@aphrody/runtime-sdk/release";

export { install, list, rollback };

const root = resolve(import.meta.dir, "../../../docs/aphrody");

if (import.meta.main) {
  const [command = "list", argument] = Bun.argv.slice(2);
  switch (command) {
    case "install": {
      const source = resolve(
        root,
        argument ?? join("dist/runtime", hostTarget()),
      );
      console.log(
        `Installed ${install(source)} in ${join(runtimeHome(), hostTarget())}`,
      );
      break;
    }
    case "rollback": {
      const result = rollback();
      console.log(
        `Rolled back: current=${result.current} previous=${result.previous ?? "-"}`,
      );
      break;
    }
    case "verify": {
      const current = list().find((e) => e.current);
      if (current === undefined) throw new Error("No installed artifact");
      const manifest = verifyArtifact(
        join(runtimeHome(), hostTarget(), current.name),
      );
      console.log(
        `OK ${manifest.name} ${manifest.version} ABI ${manifest.abi} (${current.name})`,
      );
      break;
    }
    case "list": {
      for (const e of list())
        console.log(`${e.current ? "*" : e.previous ? "-" : " "} ${e.name}`);
      break;
    }
    default:
      console.error(
        "Usage: runtime_release.ts install [dir] | list | verify | rollback",
      );
      process.exit(1);
  }
}
