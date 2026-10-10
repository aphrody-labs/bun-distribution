/**
 * The host target triple. Kept free of the FFI runtime so the CLI can print it without loading `./index`;
 * `./artifact` re-exports both names, which stay the public path.
 */

/** Supported targets: Bun platform/arch → Rust target triple. */
export const SUPPORTED_TARGETS: Readonly<Record<string, string>> = {
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
};

export function hostTarget(): string {
  const key = `${process.platform}-${process.arch}`;
  const target = SUPPORTED_TARGETS[key];
  if (target === undefined) {
    throw new Error(
      `Unsupported platform ${key}; supported: ${Object.keys(SUPPORTED_TARGETS).join(", ")}`,
    );
  }
  return target;
}
