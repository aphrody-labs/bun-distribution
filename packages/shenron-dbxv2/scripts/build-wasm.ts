// Build the DBXV2 WebAssembly module: the cdylib of crates/shenron-dbxv2 with the `wasm` feature
// (the wasm-bindgen exports of bun-re), then the JS glue with wasm-bindgen (`--target web`).
// Output: <workspace>/target/shenron-dbxv2-wasm/ (git-ignored). The wasm-bindgen CLI version
// must equal the `wasm-bindgen` crate version in Cargo.lock.
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const out = resolve(root, "target/shenron-dbxv2-wasm");

function run(cmd: string[]): void {
  const result = Bun.spawnSync(cmd, { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`${cmd.join(" ")} exited with ${result.exitCode}`);
}

run([
  "cargo", "build", "-p", "shenron-dbxv2", "--lib", "--features", "wasm",
  "--target", "wasm32-unknown-unknown", "--release",
]);
run([
  "wasm-bindgen", resolve(root, "target/wasm32-unknown-unknown/release/shenron_dbxv2.wasm"),
  "--target", "web", "--out-dir", out, "--out-name", "shenron_dbxv2",
]);
console.log(`wasm module written to ${out}`);
