import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const configurationRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(configurationRoot, "../..");
const configuration = JSON.parse(readFileSync(resolve(configurationRoot, "tsconfig-base.json"), "utf8"));
const product = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));

test("shared source aliases resolve to admitted flat owners", () => {
  for (const owner of ["db", "types", "auth", "assets"]) {
    const entry = `../rg-${owner}/src/index.ts`;
    expect(configuration.compilerOptions.paths[`@rosegriffon/${owner}`]).toEqual([entry]);
    expect(configuration.compilerOptions.paths[`@rosegriffon/${owner}/*`]).toEqual([`../rg-${owner}/src/*`]);
    expect(existsSync(resolve(configurationRoot, entry))).toBe(true);
    expect(product.workspaces).toContain(`packages/rg-${owner}`);
  }
  expect(resolve(configurationRoot, configuration.compilerOptions.rootDir)).toBe(repositoryRoot);
});

test("unadmitted UI sources cannot shadow the declared installed dependency", () => {
  expect(configuration.compilerOptions.paths).not.toHaveProperty("@rosegriffon/ui");
  expect(configuration.compilerOptions.paths).not.toHaveProperty("@rosegriffon/ui/*");
});
