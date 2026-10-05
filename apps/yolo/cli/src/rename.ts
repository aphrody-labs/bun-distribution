/**
 * `yolo rename`: Thin CLI dispatcher delegating to @aphrody/yolo-core/curation.
 */
export * from "../../../packages/core/src/curation/rename";
import { runRenameCommand } from "../../../packages/core/src/curation/rename";

if (import.meta.main) {
  void runRenameCommand(process.argv.slice(2), process.cwd()).then((code) => {
    process.exitCode = code;
  });
}
