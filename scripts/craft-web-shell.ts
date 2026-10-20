// SPDX-License-Identifier: Apache-2.0
// Trunk's pre-build hook prepares one app's shell through the canonical M3 plugin.
import { resolve } from "node:path";
import { m3Plugin } from "../packages/m3/src/plugin.ts";
import { PET_COLORS } from "../packages/identity/src/pet.ts";

const app = Bun.argv[2];
if (!app || !/^[a-z]+craft-web$/.test(app))
  throw new Error("Expected a Craft web application name");
const root = resolve(import.meta.dir, "..");
if (!(await Bun.file(resolve(root, "apps", app, "Cargo.toml")).exists())) {
  throw new Error(`Missing application owner for ${app}`);
}
const outdir = Bun.argv[3]
  ? resolve(Bun.argv[3])
  : resolve(root, "build/craft-web", app);
const result = await Bun.build({
  entrypoints: [resolve(root, "packages/m3/src/craft-shell.css")],
  outdir,
  naming: "theme.[ext]",
  target: "browser",
  plugins: [
    m3Plugin({
      theme: { seed: PET_COLORS.seed },
      tailwind: false,
      sass: false,
    }),
  ],
});
if (!result.success)
  throw new AggregateError(
    result.logs,
    `Cannot prepare the M3 shell for ${app}`,
  );
await Bun.write(
  resolve(outdir, "aphrody-icon.png"),
  Bun.file(resolve(root, "packages/identity/assets/icon-64.png")),
);
