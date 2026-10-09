/**
 * `yolo awesome`: Thin CLI dispatcher delegating to @aphrody/workspace/native/curation.
 */
export * from "@aphrody/workspace/src/native/curation/awesome.ts";
import { runAwesomeCommand } from "@aphrody/workspace/src/native/curation/awesome.ts";

if (import.meta.main) {
  void runAwesomeCommand(process.argv.slice(2), process.cwd()).then((code) => {
    process.exitCode = code;
  });
}
