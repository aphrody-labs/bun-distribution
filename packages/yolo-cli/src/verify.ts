/**
 * `yolo verify`: Thin CLI dispatcher delegating to @aphrody/yolo-core/verify.
 */
export * from "@aphrody/yolo-core/src/verify/engine.ts";
import { runVerifyCommand } from "@aphrody/yolo-core/src/verify/engine.ts";

if (import.meta.main) {
  void runVerifyCommand(process.argv.slice(2), process.cwd()).then(code => (process.exitCode = code));
}
