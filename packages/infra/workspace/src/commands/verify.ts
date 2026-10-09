/**
 * `yolo verify`: Thin CLI dispatcher delegating to @aphrody/workspace/native/verify.
 */
export * from "@aphrody/workspace/src/native/verify/engine.ts";
import { runVerifyCommand } from "@aphrody/workspace/src/native/verify/engine.ts";

if (import.meta.main) {
  void runVerifyCommand(process.argv.slice(2), process.cwd()).then((code) => {
    process.exitCode = code;
  });
}
