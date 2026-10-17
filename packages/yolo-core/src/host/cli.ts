#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// bun packages/core/src/host/cli.ts compose-unit <unit> | compose-nginx <file> | check | list
//   host-plan <unit>... [--target H] [--expect-tools N] [--binary-from PATH --binary-sha256 HEX] [--observe] [--json]   steps to install the units (dry run)
//   host-apply <unit>... --target H [--expect-tools N] [--binary-from PATH --binary-sha256 HEX] [--apply]               same plan; executes it only with --apply
//   relink <root>... [--apply]                                                 symlinks into a [layout.retired] location -> their replacement
//   wg-plan [--observe] [--json]                                               private tunnel and omar account plan (no apply)
//   net-env [--member M] [--probe] [--facts] [--write] [--ssh-config] [--push HOST] [--file F]          network map block of <aphrody home>/private/network.env
//   wg-client <peer> [--hub-public-key K] [--format sections|paste|conf] [--private-key-file F|--private-key-stdin] [--out F]
import { readFileSync } from "node:fs";
import { checkCatalog, composeNginx, composeUnit, hostRoot, loadCatalog } from "./index.ts";
import { applyPlan, hostPlan, observePlan, renderPlan } from "./plan.ts";
import { netEnvMain } from "./net-env.ts";
import { relink, retiredLinks } from "./layout.ts";
import { loadTunnel, wgMain } from "./wireguard.ts";

const [cmd, arg] = process.argv.slice(2);
const rest = process.argv.slice(3);
const flag = (name: string) => rest.includes(`--${name}`);
const value = (name: string) => {
  const at = rest.indexOf(`--${name}`);
  return at >= 0 ? rest[at + 1] : undefined;
};
const names = () =>
  rest.filter(
    (a, i) => !a.startsWith("--") && !rest[i - 1]?.match(/^--(target|expect-tools|binary-from|binary-sha256)$/),
  );
if (cmd === "compose-unit" && arg) process.stdout.write(composeUnit(arg));
else if (cmd === "compose-nginx" && arg) process.stdout.write(composeNginx(readFileSync(arg, "utf8")));
else if (cmd === "host-plan" || cmd === "host-apply") {
  const expect = value("expect-tools");
  try {
    if (names().length === 0) throw new Error("name at least one unit");
    if (cmd === "host-apply" && flag("apply") && !value("target"))
      throw new Error("--apply needs an explicit --target");
    const from = value("binary-from");
    const sha256 = value("binary-sha256");
    if (Boolean(from) !== Boolean(sha256)) throw new Error("--binary-from and --binary-sha256 go together");
    const plan = hostPlan(names(), {
      target: value("target"),
      expectTools: expect === undefined ? undefined : Number(expect),
      binary: from && sha256 ? { from, sha256 } : undefined,
    });
    if (cmd === "host-apply" && flag("apply")) {
      const failed = await applyPlan(plan);
      console.log(failed.length ? `FAIL ${failed.join(", ")}` : "applied");
      process.exit(failed.length ? 1 : 0);
    }
    const observed = flag("observe") ? await observePlan(plan) : undefined;
    console.log(
      flag("json")
        ? JSON.stringify({ ...plan, observed: observed && Object.fromEntries(observed) }, null, 2)
        : renderPlan(plan, observed),
    );
    if (!flag("json"))
      console.log(
        `\nplan only: ${cmd === "host-apply" ? "pass --apply" : "use host-apply --target H --apply"} to execute`,
      );
  } catch (error) {
    console.error(`host: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
} else if (cmd === "wg-plan" || cmd === "wg-client") {
  try {
    await wgMain(cmd, rest, {
      root: hostRoot(),
      catalog: loadCatalog(),
      compose: unit => composeUnit(unit),
    });
  } catch (error) {
    console.error(`host: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
} else if (cmd === "net-env") {
  try {
    await netEnvMain(loadTunnel(hostRoot()), process.argv.slice(3));
  } catch (error) {
    console.error(`host: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
} else if (cmd === "relink" && arg) {
  const links = retiredLinks(process.argv.slice(3).filter(a => !a.startsWith("--")));
  for (const l of links) console.log(`${l.path}: ${l.target} -> ${l.replacement}`);
  if (flag("apply")) relink(links);
  console.log(`${links.length} link(s) ${flag("apply") ? "rewritten" : "to rewrite (pass --apply)"}`);
} else if (cmd === "list") for (const u of loadCatalog().units) console.log(u.unit, u.targetHost);
else if (cmd === "check") {
  const problems = checkCatalog();
  for (const p of problems) console.error(p);
  console.log(problems.length ? `FAIL ${problems.length}` : `ok ${hostRoot()}`);
  process.exit(problems.length ? 1 : 0);
} else {
  console.error(
    "usage: cli.ts compose-unit <unit> | compose-nginx <file> | list | check | host-plan <unit>... | host-apply <unit>... | relink <root>... [--apply] | wg-plan | wg-client <peer> | net-env",
  );
  process.exit(2);
}
