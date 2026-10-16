import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCargoModule, type Module } from "../src/index.ts";

const fixtures: string[] = [];
const module: Module = {
  id: "shared",
  path: "libraries/shared",
  upstream: "example/shared",
  fork: "aphrody-labs/shared",
  branch: "os",
  revision: "1".repeat(40),
  upstreamRevision: "1".repeat(40),
  license: "MIT",
  kind: "library",
  role: "shared",
  description: "Shared native library",
};

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bun-os-cargo-"));
  fixtures.push(root);
  await mkdir(join(root, module.path), { recursive: true });
  return root;
}

afterEach(async () => {
  for (const root of fixtures.splice(0))
    await rm(root, { recursive: true, force: true });
});

test("migrated library selects its own packages from the root Cargo workspace", async () => {
  const root = await fixture();
  await Bun.write(
    join(root, "Cargo.toml"),
    '[workspace]\nmembers = ["libraries/shared/crates/core", "libraries/shared/crates/tests", "libraries/other"]\n',
  );
  for (const name of ["core", "tests"]) {
    await mkdir(join(root, module.path, "crates", name), { recursive: true });
    await Bun.write(
      join(root, module.path, "crates", name, "Cargo.toml"),
      `[package]\nname = "shared-${name}"\n`,
    );
  }
  const cargo = await resolveCargoModule(module, root);
  expect(cargo.manifest).toBe(join(root, "Cargo.toml"));
  expect(cargo.cargoPackage).toBeNull();
  expect(cargo.cargoPackages).toEqual(["shared-core", "shared-tests"]);
});

test("unmigrated package keeps its source manifest", async () => {
  const root = await fixture();
  await Bun.write(
    join(root, module.path, "Cargo.toml"),
    '[package]\nname = "shared-core"\n',
  );
  const cargo = await resolveCargoModule(module, root);
  expect(cargo.manifest).toBe(join(root, module.path, "Cargo.toml"));
  expect(cargo.cargoPackage).toBe("shared-core");
  expect(cargo.cargoPackages).toEqual([]);
});

test("product capabilities can select sibling crates from their declared package group", async () => {
  const root = await fixture();
  await Bun.write(
    join(root, "Cargo.toml"),
    '[workspace]\nmembers = ["crates/shared-core", "crates/shared-tests"]\n',
  );
  for (const name of ["core", "tests"]) {
    await mkdir(join(root, `crates/shared-${name}`), { recursive: true });
    await Bun.write(
      join(root, `crates/shared-${name}/Cargo.toml`),
      `[package]\nname = "shared-${name}"\n`,
    );
  }
  const cargo = await resolveCargoModule(
    {
      ...module,
      sourceKind: "workspace",
      cargoPackages: ["shared-core", "shared-tests"],
    },
    root,
  );
  expect(cargo.manifest).toBe(join(root, "Cargo.toml"));
  expect(cargo.cargoPackages).toEqual(["shared-core", "shared-tests"]);
});

test("a library cannot select a different owner's package in the root workspace", async () => {
  const root = await fixture();
  await Bun.write(
    join(root, "Cargo.toml"),
    '[workspace]\nmembers = ["libraries/shared/crates/core"]\n',
  );
  await mkdir(join(root, module.path, "crates/core"), { recursive: true });
  await Bun.write(
    join(root, module.path, "crates/core/Cargo.toml"),
    '[package]\nname = "shared-core"\n',
  );
  await expect(
    resolveCargoModule({ ...module, cargoPackage: "other" }, root),
  ).rejects.toThrow("Cargo package is outside its library");
});
