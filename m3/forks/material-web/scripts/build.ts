// SPDX-License-Identifier: Apache-2.0
// Build the publishable module tree and declarations in dependency order.
// Bun owns orchestration and Sass/CSS generation; TypeScript emits the public
// per-module JavaScript and .d.ts files that Bun.build cannot emit together.
import { resolve } from "node:path";

const cwd = resolve(import.meta.dir, "..");
const target = Bun.argv[2] ?? "build";

const steps = [
  ["token metadata", "scripts/generate-sass-token-meta.ts"],
  ["Sass", "scripts/compile-sass.ts"],
  ["CSSResult modules", "scripts/css-to-ts.ts"],
  ["TypeScript", "tsc", "-p", "tsconfig.json"],
  ["Public declarations", "scripts/bootstrap-types.ts"],
  ["GB lab TypeScript", "tsc", "-p", "labs/gb/tsconfig.json"],
] as const;

const lastStep = new Map([
  ["sass", 1],
  ["css-to-ts", 2],
  ["ts", 5],
  ["build", 5],
]).get(target);

if (lastStep === undefined) {
  console.error(`Unknown build target: ${target}`);
  process.exit(2);
}

for (const [label, ...args] of steps.slice(0, lastStep + 1)) {
  console.log(`build: ${label}`);
  const child = Bun.spawn([process.execPath, "run", ...args], {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  // eslint-disable-next-line no-await-in-loop -- Sass, CSS modules, JS and declarations depend on earlier build steps.
  const code = await child.exited;
  if (code !== 0) process.exit(code);
}
