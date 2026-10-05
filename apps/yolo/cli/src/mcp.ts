/**
 * `yolo mcp`: Thin CLI dispatcher delegating to @aphrody/yolo-core/mcp.
 */
export * from "../../../packages/core/src/mcp/server";
import { runMcpServer } from "../../../packages/core/src/mcp/server";

if (import.meta.main) {
  void runMcpServer();
}
