/**
 * Flags of the `bun build --compile` that produces the standalone `yolo` executable (`release.ts`, and the PERF-M3-YOLO
 * benchmark that measures it).
 *
 * - `--bytecode` ships the JavaScriptCore bytecode with the bundle, so start-up does not parse and compile 48 modules:
 *   `yolo version` 16 ms -> 4 ms.
 * - `--format=esm`: `--compile --bytecode` accepts ESM, so the CLI graph may use top-level `await` (CommonJS is no
 *   longer required).
 * - `--no-compile-autoload-dotenv/-bunfig` stop the installed binary from reading `.env` and `bunfig.toml` of whatever
 *   directory it is run in; yolo reads neither, and a project's `preload` must not run inside the CLI.
 */
export const COMPILE_FLAGS: string[] = [
  "--bytecode",
  "--format=esm",
  "--no-compile-autoload-dotenv",
  "--no-compile-autoload-bunfig",
];
