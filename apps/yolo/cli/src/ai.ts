// SPDX-License-Identifier: Apache-2.0
/** Thin CLI adapter: capability selection, JSON input/output and owned context lifetime. */
import {
  TOOLS,
  executeTool,
  isAiTool,
  ToolExecutionContext,
} from "@aphrody/yolo-core/src/tools/registry.ts";

export async function runAiCommand(args: string[], root: string): Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "help") {
    console.log(
      "Usage: yolo ai list | call <tool-name> '<json-object>'\nInference: configure YOLO_INFERENCE_ENDPOINT; optional YOLO_INFERENCE_MODEL and YOLO_INFERENCE_API_KEY.",
    );
    return 0;
  }
  if (args[0] === "list" && args.length === 1) {
    console.log(
      JSON.stringify(
        TOOLS.filter((tool) => isAiTool(tool.name)),
        null,
        2,
      ),
    );
    return 0;
  }
  if (args[0] !== "call" || args.length < 2 || args.length > 3 || !isAiTool(args[1]!)) {
    console.error("Expected yolo ai list or call <AI tool-name> '<json-object>'");
    return 2;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  const context = new ToolExecutionContext();
  try {
    const result = await executeTool(args[1]!, JSON.parse(args[2] ?? "{}"), root, context, {
      signal: controller.signal,
    });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    context.close();
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}
