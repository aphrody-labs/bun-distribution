/**
 * `yolo import`: Thin CLI dispatcher delegating to @aphrody/yolo-core/vendor.
 */
export * from "@aphrody/yolo-core/src/vendor/import.ts";
import { runImportCommand } from "@aphrody/yolo-core/src/vendor/import.ts";

if (import.meta.main) {
  void runImportCommand(process.argv.slice(2), process.cwd()).then((code) => {
    process.exitCode = code;
  });
}
