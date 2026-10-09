/**
 * `yolo create`: Thin CLI dispatcher delegating to @aphrody/workspace/native/scaffold.
 */
export * from "@aphrody/workspace/src/native/scaffold/create.ts";
import { runCreateCommand } from "@aphrody/workspace/src/native/scaffold/create.ts";

if (import.meta.main) {
  void runCreateCommand(process.argv.slice(2), process.cwd()).then((code) => {
    process.exitCode = code;
  });
}
