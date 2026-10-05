/**
 * `yolo api`: Thin CLI dispatcher delegating to @aphrody/yolo-core/server.
 */
export * from "../../../packages/core/src/server/http";
import { runApiCommand } from "../../../packages/core/src/server/http";

if (import.meta.main) {
  void runApiCommand(process.argv.slice(2), process.cwd()).then((code) => {
    process.exitCode = code;
  });
}
