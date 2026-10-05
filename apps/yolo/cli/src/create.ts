/**
 * `yolo create`: Thin CLI dispatcher delegating to @aphrody/yolo-core/scaffold.
 */
export * from "../../../../packages/engine/core/src/scaffold/create";
import { runCreateCommand } from "../../../../packages/engine/core/src/scaffold/create";

if (import.meta.main) {
  void runCreateCommand(process.argv.slice(2), process.cwd()).then((code) => {
    process.exitCode = code;
  });
}
