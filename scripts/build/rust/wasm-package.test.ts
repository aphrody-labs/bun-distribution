// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWasmPackage, type ToolRunner } from "./wasm-package";

// Minimal valid module, plus a valid optional custom section for optimization-size checks.
const emptyModule = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const rawModule = new Uint8Array([...emptyModule, 0, 2, 1, 120]);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type Mode =
  | "success"
  | "bindgen-failure"
  | "optimizer-failure"
  | "invalid-wasm"
  | "missing-js"
  | "larger"
  | "wrong-pin"
  | "invalid-bindgen";
async function fixture(mode: Mode = "success") {
  const root = await mkdtemp(join(tmpdir(), "aphrody-wasm-test-"));
  directories.push(root);
  await Bun.write(
    join(root, "Cargo.lock"),
    '[[package]]\nname = "wasm-bindgen"\nversion = "0.2.129"\n',
  );
  const out = join(root, "pkg");
  await mkdir(out);
  await Bun.write(join(out, "working.js"), "previous usable package");
  const calls: string[][] = [];
  const run: ToolRunner = async (command) => {
    calls.push(command);
    const value = (flag: string) => command[command.indexOf(flag) + 1]!;
    if (command.includes("--version") && !command.includes("binstall"))
      return {
        exitCode: 0,
        stdout: `wasm-bindgen ${mode === "wrong-pin" ? "0.2.128" : "0.2.129"}`,
      };
    if (command.includes("--out-dir")) {
      const dir = value("--out-dir");
      const name = value("--out-name");
      await mkdir(dir);
      await Bun.write(
        join(dir, `${name}_bg.wasm`),
        mode === "invalid-bindgen" ? "broken" : rawModule,
      );
      if (mode === "bindgen-failure") return { exitCode: 1, stdout: "partial bindgen output" };
      if (mode !== "missing-js")
        await Bun.write(join(dir, `${name}.js`), "export const usable = true;");
      await Bun.write(join(dir, `${name}.d.ts`), "export declare const usable: boolean;");
      await Bun.write(
        join(dir, `${name}_bg.wasm.d.ts`),
        "export declare const memory: WebAssembly.Memory;",
      );
    }
    if (command[0] === "wasm-opt") {
      await Bun.write(
        value("-o"),
        mode === "invalid-wasm"
          ? "broken"
          : mode === "larger"
            ? new Uint8Array([...rawModule, 0, 2, 1, 121])
            : emptyModule,
      );
      if (mode === "optimizer-failure")
        return { exitCode: 1, stdout: "optimizer failed after write" };
    }
    if (command.includes("fetch")) {
      await Bun.write(join(value("--dest"), value("--bin")), rawModule);
      return { exitCode: 3, stdout: "checksum verified, module cannot execute here" };
    }
    return { exitCode: 0, stdout: "" };
  };
  return { root, out, calls, run };
}

describe("WASM release package", () => {
  test.each(["bindgen-failure", "optimizer-failure", "invalid-wasm", "missing-js"] as const)(
    "%s preserves the last usable package and cleans staging",
    async (mode) => {
      const f = await fixture(mode);
      await expect(
        buildWasmPackage(
          { crate: "command-wasm", out: f.out, skipCargo: true },
          { ...f, env: { APHRODY_CLOUD: "1" } },
        ),
      ).rejects.toThrow();
      expect(await Bun.file(join(f.out, "working.js")).text()).toBe("previous usable package");
      expect((await readdir(f.root)).filter((name) => name.includes("-stage-"))).toEqual([]);
    },
  );
  test("publishes complete optimized web package after locked cloud build", async () => {
    const f = await fixture();
    const result = await buildWasmPackage(
      { crate: "command-wasm", out: f.out },
      { ...f, env: { APHRODY_CLOUD: "1" } },
    );
    expect(f.calls.find((command) => command.includes("build"))).toContain("--locked");
    expect(result.bytes).toBe(8);
    expect(result.rawBytes).toBe(12);
    expect(result.optimization).toBe("optimized (-Oz)");
    expect(await Bun.file(join(f.out, "working.js")).exists()).toBe(false);
    expect(await Bun.file(join(f.out, "command_wasm.js")).exists()).toBe(true);
    const optimizer = f.calls.find((command) => command[0] === "wasm-opt")!;
    expect(optimizer).toContain("--enable-reference-types");
    expect(optimizer).not.toContain("--all-features");
    expect(optimizer[optimizer.indexOf("-o") + 1]).not.toBe(join(f.out, "command_wasm_bg.wasm"));
  });
  test("factory build is locked and checksum-verified fetch exit 3 is accepted", async () => {
    const f = await fixture();
    await buildWasmPackage({ crate: "command-wasm", out: f.out }, { ...f, env: {} });
    const cargo = f.calls.find((command) => command.includes("run"))!;
    expect(cargo).toContain("--locked");
    expect(cargo[0]).toBe("bun");
    expect(f.calls.some((command) => command.includes("fetch"))).toBe(true);
  });
  test("--no-opt explicitly skips optimizer and still validates package", async () => {
    const f = await fixture("optimizer-failure");
    const result = await buildWasmPackage(
      { crate: "command-wasm", out: f.out, noOpt: true, skipCargo: true },
      { ...f, env: { APHRODY_CLOUD: "1" } },
    );
    expect(result.bytes).toBe(12);
    expect(result.optimization).toBe("skipped (--no-opt)");
    expect(f.calls.some((command) => command[0] === "wasm-opt")).toBe(false);
    expect(f.calls.some((command) => command.includes("build"))).toBe(false);
  });
  test("--no-opt refuses malformed bindgen output and preserves existing package", async () => {
    const f = await fixture("invalid-bindgen");
    await expect(
      buildWasmPackage(
        { crate: "command-wasm", out: f.out, noOpt: true, skipCargo: true },
        { ...f, env: { APHRODY_CLOUD: "1" } },
      ),
    ).rejects.toThrow("wasm-bindgen produced an invalid module");
    expect(await Bun.file(join(f.out, "working.js")).text()).toBe("previous usable package");
  });
  test("keeps the valid original if optimizer grows the module", async () => {
    const f = await fixture("larger");
    const result = await buildWasmPackage(
      { crate: "command-wasm", out: f.out, skipCargo: true },
      { ...f, env: { APHRODY_CLOUD: "1" } },
    );
    expect(result.bytes).toBe(12);
    expect(result.optimization).toContain("original size retained");
  });
  test("requires exact lockfile bindgen version after pinned install", async () => {
    const f = await fixture("wrong-pin");
    await expect(
      buildWasmPackage({ crate: "command-wasm", out: f.out }, { ...f, home: f.root, env: {} }),
    ).rejects.toThrow("wasm-bindgen 0.2.129 (Cargo.lock) is not available");
    const install = f.calls.find((command) => command.includes("binstall"))!;
    expect(install).toContain("--locked");
    expect(install[install.indexOf("--version") + 1]).toBe("0.2.129");
    expect(await Bun.file(join(f.out, "working.js")).text()).toBe("previous usable package");
    expect(f.calls.some((command) => command.includes("build"))).toBe(false);
  });
});
