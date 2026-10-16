import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..", "..");
const cargoSerial = join(root, "toolchains", "bun", "scripts", "build", "rust", "cargo-serial.ts");

/** Runs the canonical Rust NDS/Dust CLI through Bun's serialized MSVC owner. */
export async function runNdsCli(args: string[]): Promise<number> {
  const child = Bun.spawn(
    [
      process.execPath,
      cargoSerial,
      "--msvc",
      "run",
      "-q",
      "-p",
      "bun-engine-nds",
      "--bin",
      "bun-engine-nds",
      "--",
      ...args,
    ],
    {
      cwd: root,
      env: { ...process.env, RUSTC_BOOTSTRAP: "1" },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  return await child.exited;
}
