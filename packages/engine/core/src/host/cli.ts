#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// bun packages/core/src/host/cli.ts compose-unit <unit> | compose-nginx <file> | check | list
import { readFileSync } from "node:fs";
import { checkCatalog, composeNginx, composeUnit, hostRoot, loadCatalog } from "./index.ts";

const [cmd, arg] = process.argv.slice(2);
if (cmd === "compose-unit" && arg) process.stdout.write(composeUnit(arg));
else if (cmd === "compose-nginx" && arg)
  process.stdout.write(composeNginx(readFileSync(arg, "utf8")));
else if (cmd === "list") for (const u of loadCatalog().units) console.log(u.unit, u.targetHost);
else if (cmd === "check") {
  const problems = checkCatalog();
  for (const p of problems) console.error(p);
  console.log(problems.length ? `FAIL ${problems.length}` : `ok ${hostRoot()}`);
  process.exit(problems.length ? 1 : 0);
} else {
  console.error("usage: cli.ts compose-unit <unit> | compose-nginx <file> | list | check");
  process.exit(2);
}
