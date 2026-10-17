/**
 * `yolo awesome`: Thin CLI dispatcher delegating to @aphrody/yolo-core/curation.
 */
export * from "@aphrody/yolo-core/src/curation/awesome.ts";
import { runAwesomeCommand } from "@aphrody/yolo-core/src/curation/awesome.ts";

if (import.meta.main) {
  void runAwesomeCommand(process.argv.slice(2), process.cwd()).then(code => {
    process.exitCode = code;
    return code;
  });
}
