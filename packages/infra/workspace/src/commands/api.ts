/**
 * `yolo api`: Thin CLI dispatcher delegating to @aphrody/workspace/native/server.
 */
export * from "@aphrody/workspace/src/native/server/http.ts";
import { runApiCommand } from "@aphrody/workspace/src/native/server/http.ts";

if (import.meta.main) {
  void runApiCommand(process.argv.slice(2), process.cwd()).then((code) => {
    process.exitCode = code;
  });
}
