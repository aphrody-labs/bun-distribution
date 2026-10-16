// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  infraExecutable,
  infraRoot,
  localHostCommand,
} from "../src/runtime.ts";

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
    expect(await infraExecutable(root, { HOME: root, PATH: "" })).toEqual([
      bin,
    ]);
    await expect(infraExecutable(root, { PATH: "" })).rejects.toThrow(
      "not installed",
    );
    await expect(
      infraExecutable(root, {
        HOME: root,
        APHRODY_INFRA_BIN: join(root, "missing"),
      }),
    ).rejects.toThrow("Configured Infra binary is missing");
    expect(
      await infraExecutable(root, { APHRODY_INFRA_BUILD_FROM_SOURCE: "1" }),
    ).toEqual([
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
      await infraExecutable(root, {
        APHRODY_INFRA_BIN: bin,
        APHRODY_INFRA_BUILD_FROM_SOURCE: "1",
      }),
    ).toEqual([bin]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Infra bridge resolves the new monorepo Rust workspace", async () => {
  const root = infraRoot();
  expect(await Bun.file(join(root, "Cargo.toml")).exists()).toBe(true);
  expect(
    await Bun.file(join(root, "crates/infra/infra/Cargo.toml")).exists(),
  ).toBe(true);
});

test("Infra uses the canonical Aphrody command prefix and preserves explicit owner selection", async () => {
  const root = await mkdtemp(join(tmpdir(), "infra-canonical-"));
  try {
    const name = `aphrody${process.platform === "win32" ? ".exe" : ""}`;
    const bin = join(root, name);
    const alias = join(
      root,
      `aphrody-infra${process.platform === "win32" ? ".exe" : ""}`,
    );
    await writeFile(bin, "fixture", { mode: 0o755 });
    await writeFile(alias, "fixture", { mode: 0o755 });
    expect(await infraExecutable(root, { PATH: root })).toEqual([bin, "infra"]);
    expect(await infraExecutable(root, { PATH: "", APHRODY_BIN: bin })).toEqual(
      [bin, "infra"],
    );
    expect(
      await infraExecutable(root, {
        APHRODY_BIN: bin,
        APHRODY_INFRA_BIN: alias,
      }),
    ).toEqual([alias]);
    await expect(
      infraExecutable(root, { PATH: root, APHRODY_BIN: join(root, "missing") }),
    ).rejects.toThrow("Configured Aphrody binary is missing");
    expect(
      await infraExecutable(root, {
        APHRODY_BIN: bin,
        APHRODY_INFRA_BUILD_FROM_SOURCE: "1",
      }),
    ).toContain("run");

    const installed = join(root, ".aphrody", "bin", name);
    await mkdir(join(installed, ".."), { recursive: true });
    await writeFile(installed, "fixture", { mode: 0o755 });
    expect(await infraExecutable(root, { HOME: root, PATH: "" })).toEqual([
      installed,
      "infra",
    ]);
    if (process.platform === "win32") {
      const windows = join(root, "Aphrody", "bin", name);
      await mkdir(join(windows, ".."), { recursive: true });
      await writeFile(windows, "fixture");
      expect(
        await infraExecutable(root, { LOCALAPPDATA: root, PATH: "" }),
      ).toEqual([windows, "infra"]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ssh exec addressed to the current build host runs locally, any other host keeps SSH", () => {
  const args = ["ssh", "exec", "--host", "vps", "--cmd", "echo ok"];
  const local = localHostCommand(args, {
    APHRODY_BUILD_HOST: "vps",
    APHRODY_SSH_COMMAND_TIMEOUT_SECS: "900",
  });
  if (process.platform === "win32") expect(local).toBeUndefined();
  else expect(local).toEqual(["timeout", "900", "bash", "-c", "echo ok"]);
  expect(localHostCommand(args, {})).toBeUndefined();
  expect(
    localHostCommand(args, { APHRODY_BUILD_HOST: "dbfr" }),
  ).toBeUndefined();
  expect(
    localHostCommand(["ssh", "sftp", "--host", "vps"], {
      APHRODY_BUILD_HOST: "vps",
    }),
  ).toBeUndefined();
});
