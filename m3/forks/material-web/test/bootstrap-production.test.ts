// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapTypes } from "../scripts/bootstrap-types";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "material-web-declarations-"));
  roots.push(root);
  return root;
}

test("fresh declarations preserve the published tree, source maps and notices without compiler dependencies", async () => {
  const root = fixture();
  const notice = "/** Copyright Google LLC; SPDX-License-Identifier: Apache-2.0 */\n";
  await Bun.write(
    join(root, "package.json"),
    JSON.stringify({
      name: "@aphrody/material-web",
      files: ["button/button.d.ts", "button/internal/button.d.ts", "types/css-imports.d.ts"],
    }),
  );
  await Promise.all([
    Bun.write(
      join(root, "button/button.d.ts"),
      notice + 'export {Button} from "./internal/button.js";\n',
    ),
    Bun.write(
      join(root, "button/internal/button.d.ts"),
      notice + "export declare class Button {}\n",
    ),
    Bun.write(
      join(root, "button/button.d.ts.map"),
      '{"version":3,"sources":["button.ts"],"mappings":""}',
    ),
    Bun.write(join(root, "types/css-imports.d.ts"), 'declare module "*.css";\n'),
    Bun.write(join(root, "private.d.ts"), "export declare const privateOnly: true;\n"),
  ]);
  expect(await bootstrapTypes(root)).toBe(2);
  expect(await Bun.file(join(root, "types/button/button.d.ts")).text()).toBe(
    await Bun.file(join(root, "button/button.d.ts")).text(),
  );
  expect(await Bun.file(join(root, "types/button/button.d.ts.map")).text()).toBe(
    await Bun.file(join(root, "button/button.d.ts.map")).text(),
  );
  expect(await Bun.file(join(root, "types/css-imports.d.ts")).text()).toBe(
    'declare module "*.css";\n',
  );
  expect(await Bun.file(join(root, "types/types/css-imports.d.ts")).exists()).toBe(false);
  expect(await Bun.file(join(root, "types/private.d.ts")).exists()).toBe(false);
  expect(await bootstrapTypes(root)).toBe(2);
});

test("rejects a missing public declaration and package paths escaping its owner", async () => {
  const root = fixture();
  await Bun.write(
    join(root, "package.json"),
    JSON.stringify({
      name: "@aphrody/material-web",
      files: ["missing.d.ts"],
    }),
  );
  await expect(bootstrapTypes(root)).rejects.toThrow("Missing published declaration");
  await Bun.write(
    join(root, "package.json"),
    JSON.stringify({
      name: "@aphrody/material-web",
      files: ["../outside.d.ts"],
    }),
  );
  await expect(bootstrapTypes(root)).rejects.toThrow("Declaration escapes");
});

test("rejects a different package rather than writing into its type tree", async () => {
  const root = fixture();
  await Bun.write(
    join(root, "package.json"),
    JSON.stringify({
      name: "other-package",
      files: ["public.d.ts"],
    }),
  );
  await expect(bootstrapTypes(root)).rejects.toThrow("@aphrody/material-web");
});
