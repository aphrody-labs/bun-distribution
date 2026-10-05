// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { infraExecutable, infraRoot } from "../src/runtime.ts";

test("Infra runtime never compiles implicitly or ignores an invalid explicit binary", async () => {
  const root = await mkdtemp(join(tmpdir(), "infra-runtime-"));
  try {
    const bin = join(
      root,
      ".local/bin",
      `aphrody-infra${process.platform === "win32" ? ".exe" : ""}`,
    );
    await mkdir(join(bin, ".."), { recursive: true });
    await writeFile(bin, "fixture");
    expect(await infraExecutable(root, { HOME: root, PATH: "" })).toEqual([bin]);
    await expect(infraExecutable(root, { PATH: "" })).rejects.toThrow("not installed");
    await expect(
      infraExecutable(root, { HOME: root, APHRODY_INFRA_BIN: join(root, "missing") }),
    ).rejects.toThrow("Configured Infra binary is missing");
    expect(await infraExecutable(root, { APHRODY_INFRA_BUILD_FROM_SOURCE: "1" })).toEqual([
      join(root, "scripts/build/rust/cargo-serial.sh"),
      "run",
      "--quiet",
      "--locked",
      "--bin",
      "aphrody",
      "--",
      "infra",
    ]);
    await expect(
      infraExecutable(root, {
        APHRODY_INFRA_BUILD_FROM_SOURCE: "1",
        APHRODY_NO_BUILD: "1",
      }),
    ).rejects.toThrow("Source compilation is disabled");
    expect(
      await infraExecutable(root, { APHRODY_INFRA_BIN: bin, APHRODY_INFRA_BUILD_FROM_SOURCE: "1" }),
    ).toEqual([bin]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Infra bridge resolves the new monorepo Rust workspace", async () => {
  const root = infraRoot();
  expect(await Bun.file(join(root, "Cargo.toml")).exists()).toBe(true);
  expect(await Bun.file(join(root, "crates/infra/infra/Cargo.toml")).exists()).toBe(true);
});
