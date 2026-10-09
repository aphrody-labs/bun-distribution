/**
 * `yolo aphrody`: Thin CLI dispatcher delegating to @aphrody/workspace/native/coord.
 */
export * from "@aphrody/workspace/src/native/coord/aphrody.ts";
import { runAphrodyCommand } from "@aphrody/workspace/src/native/coord/aphrody.ts";

if (import.meta.main) {
  const [command = "", ...args] = process.argv.slice(2);
  void runAphrodyCommand(command, args, process.cwd()).then((code) => {
    process.exitCode = code;
  });
}
