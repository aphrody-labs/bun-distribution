import { expect, test } from "bun:test";
import { join, resolve } from "node:path";

test("the canonical wasm-pack producer writes its browser glue beside the package consumer", async () => {
  const root = resolve(import.meta.dir, "..");
  const manifest = await Bun.file(join(root, "package.json")).json();
  const args = manifest.scripts["build:wasm"].split(/\s+/);
  expect(args.slice(0, 2)).toEqual(["wasm-pack", "build"]);
  const crate = resolve(root, args[2]);
  expect(await Bun.file(join(crate, "Cargo.toml")).exists()).toBe(true);
  // wasm-pack resolves --out-dir against the Rust crate, not the invoking package.
  const output = resolve(crate, args[args.indexOf("--out-dir") + 1]);
  expect(output).toBe(join(root, "wasm"));
  expect(resolve(root, manifest.imports["#webos-wasm-glue"])).toBe(join(output, "aphrody_webos_wasm.js"));
  expect(args[args.indexOf("--target") + 1]).toBe("web");
  expect(args).toContain("--release");
  expect(args.slice(-2)).toEqual(["--", "--locked"]);
});
