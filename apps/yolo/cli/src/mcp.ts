/**
 * `yolo mcp`: Thin CLI dispatcher delegating to @aphrody/yolo-core/mcp.
 */
export * from "../../../../packages/engine/core/src/mcp/server";
import { runMcpServer } from "../../../../packages/engine/core/src/mcp/server";

if (import.meta.main) {
  void runMcpServer();
}
