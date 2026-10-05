/**
 * `yolo aphrody`: Thin CLI dispatcher delegating to @aphrody/yolo-core/coord.
 */
export * from "../../../packages/core/src/coord/aphrody";
import { runAphrodyCommand } from "../../../packages/core/src/coord/aphrody";

if (import.meta.main) {
  const [command = "", ...args] = process.argv.slice(2);
  void runAphrodyCommand(command, args, process.cwd()).then((code) => {
    process.exitCode = code;
  });
}
