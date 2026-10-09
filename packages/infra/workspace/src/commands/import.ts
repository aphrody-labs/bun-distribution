/**
 * `yolo import`: Thin CLI dispatcher delegating to @aphrody/workspace/native/vendor.
 */
export * from "@aphrody/workspace/src/native/vendor/import.ts";
import { runImportCommand } from "@aphrody/workspace/src/native/vendor/import.ts";

if (import.meta.main) {
  void runImportCommand(process.argv.slice(2), process.cwd()).then((code) => {
    process.exitCode = code;
  });
}
