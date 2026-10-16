/**
 * `yolo import`: Thin CLI dispatcher delegating to @aphrody/yolo-core/vendor.
 */
export * from "@aphrody/yolo-core/src/vendor/import.ts";
import { runImportCommand } from "@aphrody/yolo-core/src/vendor/import.ts";

const runMain = async (): Promise<void> => {
  process.exitCode = await runImportCommand(
    process.argv.slice(2),
    process.cwd(),
  );
};

if (import.meta.main) {
  void runMain();
}
