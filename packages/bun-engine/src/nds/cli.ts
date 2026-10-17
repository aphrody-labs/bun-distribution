import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..", "..");
const cargoSerial = join(root, "toolchains", "bun", "scripts", "build", "rust", "cargo-serial.ts");

/** An installed native engine: BUN_ENGINE_NATIVE, the Arch package path, or a workspace build. */
function installedNative(): string | undefined {
  const exe = process.platform === "win32" ? "bun-engine.exe" : "bun-engine";
  const candidates = [
    Bun.env.BUN_ENGINE_NATIVE,
    "/usr/lib/bun-engine/bun-engine",
    join(root, "target", "release", exe),
    join(root, "target", "debug", exe),
  ];
  return candidates.find(path => path && Bun.file(path).size > 0);
}

/** Runs the native `bun-engine` CLI (cartridge inspection, machines); builds it through Bun's
 * serialized MSVC owner when no installed binary exists. */
export async function runNative(args: string[]): Promise<number> {
  const native = installedNative();
  if (native) return Bun.spawn([native, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exited;
  const child = Bun.spawn(
    [
      process.execPath,
      cargoSerial,
      "--msvc",
      "run",
      "-q",
      "-p",
      "bun-engine",
      "--bin",
      "bun-engine",
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
