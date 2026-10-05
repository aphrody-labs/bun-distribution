/**
 * `yolo awesome`: Thin CLI dispatcher delegating to @aphrody/yolo-core/curation.
 */
export * from "../../../../packages/engine/core/src/curation/awesome";
import { runAwesomeCommand } from "../../../../packages/engine/core/src/curation/awesome";

if (import.meta.main) {
  void runAwesomeCommand(process.argv.slice(2), process.cwd()).then((code) => {
    process.exitCode = code;
  });
}
