/**
 * `yolo create`: Thin CLI dispatcher delegating to @aphrody/yolo-core/scaffold.
 */
export * from "@aphrody/yolo-core/src/scaffold/create.ts";
import { runCreateCommand } from "@aphrody/yolo-core/src/scaffold/create.ts";

if (import.meta.main) {
  void runCreateCommand(process.argv.slice(2), process.cwd()).then((code) => {
    process.exitCode = code;
    return code;
  });
}
