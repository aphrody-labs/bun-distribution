// SPDX-License-Identifier: Apache-2.0
// MCP tools for the RE pipeline. Registration into the packages/re MCP server is one line:
//   registerPipelineTools((tool) => server.registerTool(tool.name, tool, tool.handler));
import type { Stage, TargetKind } from "./contract.ts";
import { listAdapters, runPipeline } from "./runner.ts";

export interface PipelineTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>;
}

const text = (v: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v) }],
  ...(isError ? { isError } : {}),
});

export const pipelineTools: PipelineTool[] = [
  {
    name: "re_pipeline_run",
    description:
      "Run the cross-OS/BIOS/firmware RE pipeline (acquire, identify, unpack, analyze, lift, decompile, rebuild, verify) on a local file. Returns the typed PipelineReport; unavailable stages list candidate adapters.",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string", description: "Path of the binary, ROM, firmware or image" },
        target: { type: "string", enum: ["os", "bios", "firmware"], default: "os" },
        outdir: { type: "string", description: "Output directory" },
        external: { type: "boolean", description: "Enable heavy external adapters (Ghidra headless)" },
        trace: { type: "boolean", description: "Execute the rebuilt binary for a bounded trace" },
      },
      required: ["input", "outdir"],
    },
    handler: async (a) => {
      try {
        return text(
          await runPipeline(String(a.input), {
            target: (a.target as TargetKind) ?? "os",
            outdir: String(a.outdir),
            external: Boolean(a.external),
            trace: Boolean(a.trace),
          }),
        );
      } catch (e) {
        return text(String(e), true);
      }
    },
  },
  {
    name: "re_pipeline_adapters",
    description: "List registered pipeline stage adapters with live availability (ready, registered, unavailable) and owners.",
    inputSchema: { type: "object", properties: { stage: { type: "string" } } },
    handler: async (a) => {
      try {
        return text(await listAdapters(a.stage as Stage | undefined));
      } catch (e) {
        return text(String(e), true);
      }
    },
  },
];

export function registerPipelineTools(register: (tool: PipelineTool) => void): void {
  for (const t of pipelineTools) register(t);
}
