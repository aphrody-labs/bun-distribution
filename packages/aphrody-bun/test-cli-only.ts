// SPDX-License-Identifier: Apache-2.0

// Prove the CLI subpath has no dependency on the separate bun_rs UI library.
process.env.APHRODY_BUN_FFI_LIB = "/__missing_bun_rs_for_cli_only_test__";

const cli = await import("./src/cli.ts");
if (!cli.isAphrodyFfiAvailable()) throw new Error("aphrody-ffi must be discoverable for CLI-only import");
if (cli.getAphrodyAbiVersion() !== cli.EXPECTED_APHRODY_ABI_VERSION) {
  throw new Error("CLI-only Aphrody ABI mismatch");
}
const result = cli.runAphrodyCaptured(["version", "--json"]);
if (result.code !== 0 || typeof JSON.parse(result.stdout).version !== "string") {
  throw new Error("CLI-only Aphrody captured execution failed");
}
