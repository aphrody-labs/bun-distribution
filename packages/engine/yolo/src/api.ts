/**
 * `yolo api`: Thin CLI dispatcher delegating to @aphrody/yolo-core/server.
 */
export * from "@aphrody/yolo-core/src/server/http.ts";
import { runApiCommand } from "@aphrody/yolo-core/src/server/http.ts";

if (import.meta.main) {
  void runApiCommand(process.argv.slice(2), process.cwd()).then((code) => {
    process.exitCode = code;
    return code;
  });
}
