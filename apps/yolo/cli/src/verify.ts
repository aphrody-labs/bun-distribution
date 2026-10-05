/**
 * `yolo verify`: Thin CLI dispatcher delegating to @aphrody/yolo-core/verify.
 */
export * from "../../../packages/core/src/verify/engine";
import { runVerifyCommand } from "../../../packages/core/src/verify/engine";

if (import.meta.main) {
  void runVerifyCommand(process.argv.slice(2), process.cwd()).then((code) => {
    process.exitCode = code;
  });
}
