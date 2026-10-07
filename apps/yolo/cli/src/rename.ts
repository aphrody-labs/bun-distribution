/**
 * `yolo rename`: Thin CLI dispatcher delegating to @aphrody/yolo-core/curation.
 */
export * from "@aphrody/yolo-core/src/curation/rename.ts";
import { runRenameCommand } from "@aphrody/yolo-core/src/curation/rename.ts";

if (import.meta.main) {
  void runRenameCommand(process.argv.slice(2), process.cwd()).then((code) => {
    process.exitCode = code;
  });
}
