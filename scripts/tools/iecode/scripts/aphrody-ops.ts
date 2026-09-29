#!/usr/bin/env bun
// Thin binding to the Aphrody monorepo's Infra workspace CLI.
import { dirname, join, resolve } from "node:path";

const iecodeRoot = resolve(import.meta.dir, "..");
const aphrodyRoot = resolve(process.env.APHRODY_ROOT ?? join(dirname(iecodeRoot), "aphrody"));
const cli = join(aphrodyRoot, "packages/infra/aphrody-workspace/src/ops.ts");

if (!(await Bun.file(cli).exists())) {
  console.error(`Aphrody workspace CLI is missing: ${cli}`);
  process.exit(2);
}

const child = Bun.spawn([process.execPath, cli, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await child.exited);
