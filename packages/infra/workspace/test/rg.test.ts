import { expect, test } from "bun:test";
import { isRootWorkspaceMember, rgRoots } from "../src/rg.ts";

test("RG paths are anchored to the Aphrody workspace layout", () => {
  expect(rgRoots("/workspace/aphrody")).toEqual([
    "/workspace/aphrody/apps/rg",
    "/workspace/aphrody/packages/rg",
  ]);
});

test("RG command scope follows root workspace patterns", () => {
  const root = "/workspace/aphrody";
  const patterns = ["apps/rg/*", "packages/rg/*", "packages/rg/patreon-bun/examples/*"];

  expect(isRootWorkspaceMember(root, `${root}/packages/rg/search`, patterns)).toBe(true);
  expect(
    isRootWorkspaceMember(root, `${root}/packages/rg/patreon-bun/examples/bun-esm`, patterns),
  ).toBe(true);
  expect(
    isRootWorkspaceMember(
      root,
      `${root}/packages/rg/patreon-bun/examples/bun-esm/fixture`,
      patterns,
    ),
  ).toBe(false);
  expect(isRootWorkspaceMember(root, `${root}/packages/discord/source/repository`, patterns)).toBe(
    false,
  );
});

test("RG command scope honors root workspace exclusions", () => {
  expect(
    isRootWorkspaceMember("/workspace/aphrody", "/workspace/aphrody/apps/rg/demo", [
      "apps/rg/*",
      "!apps/rg/demo",
    ]),
  ).toBe(false);
});
