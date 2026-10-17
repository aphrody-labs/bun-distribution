/**
 * `yolo aphrody`: Thin CLI dispatcher delegating to @aphrody/yolo-core/coord.
 */
export * from "@aphrody/yolo-core/src/coord/aphrody.ts";
import { runAphrodyCommand } from "@aphrody/yolo-core/src/coord/aphrody.ts";

if (import.meta.main) {
  const [command = "", ...args] = process.argv.slice(2);
  void runAphrodyCommand(command, args, process.cwd()).then(code => {
    process.exitCode = code;
    return;
  });
}
