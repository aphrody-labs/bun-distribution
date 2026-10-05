/**
 * `yolo import`: Thin CLI dispatcher delegating to @aphrody/yolo-core/vendor.
 */
export * from "../../../../packages/engine/core/src/vendor/import";
import { runImportCommand } from "../../../../packages/engine/core/src/vendor/import";

if (import.meta.main) {
  void runImportCommand(process.argv.slice(2), process.cwd()).then((code) => {
    process.exitCode = code;
  });
}
