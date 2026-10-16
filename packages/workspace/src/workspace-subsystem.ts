// SPDX-License-Identifier: Apache-2.0
/** Read-only Workspace commands published to agents as the `workspace` kernel subsystem. */
import { registerSubsystem, type ToolSpec } from "@aphrody/os";
import { resolve } from "node:path";
import { collectAutomationInventory } from "./automation-inventory.ts";
import { discoverAphrodyBinaries } from "./binaries.ts";
import { loadAphrodyBridgeCatalog } from "./bridges.ts";
import { loadFleet } from "./fleet.ts";
import { heavyBuildStatus, readFactoryConfig } from "./build-factory.ts";
import { collectInlineInterpreters, renderInlineMarkdown } from "./inline-interpreters.ts";
import { infraRoot } from "./runtime.ts";

type Args = Parameters<ToolSpec["handler"]>[0];
const ROOT_SCHEMA = {
  type: "string",
  description: "Repository root; defaults to the Aphrody checkout serving this subsystem.",
};
const root = (args: Args) => resolve(typeof args.root === "string" ? args.root : infraRoot());

/** One catalog for the CLI (`--list`, `--call`) and the kernel registration (`--serve`). */
export const WORKSPACE_TOOLS: ToolSpec[] = [
  {
    name: "workspace_inline_inventory",
    description:
      "Inline Python/Bun/Node invocations with scope, reason and the ratchet against tools/config/inline-interpreters.baseline.json (CLI: automation-inventory --inline).",
    inputSchema: {
      type: "object",
      properties: {
        root: ROOT_SCHEMA,
        markdown: { type: "boolean", description: "Return the Markdown table instead of JSON." },
      },
      additionalProperties: false,
    },
    readOnly: true,
    handler: async (args) => {
      const report = await collectInlineInterpreters(root(args));
      return args.markdown === true ? { markdown: renderInlineMarkdown(report) } : report;
    },
  },
  {
    name: "workspace_build_factory_status",
    description:
      "Where heavy Cargo/Bun work runs (factory or local) and why, from tools/config/build-factory.json and this host's environment (CLI: build-factory status).",
    inputSchema: { type: "object", properties: { root: ROOT_SCHEMA }, additionalProperties: false },
    readOnly: true,
    handler: async (args) => heavyBuildStatus(await readFactoryConfig(root(args)), process.env),
  },
  {
    name: "workspace_automation_inventory",
    description:
      "Scripts under scripts/ directories of a repository or of every repository below a source root, classified check/release/sync/deploy/product (CLI: automation-inventory --json).",
    inputSchema: { type: "object", properties: { root: ROOT_SCHEMA }, additionalProperties: false },
    readOnly: true,
    handler: (args) => collectAutomationInventory(root(args)),
  },
  {
    name: "workspace_binaries",
    description:
      "Installed and workspace-built Aphrody binaries with their source and catalogue status; never arbitrary PATH files (CLI: yolo ops binaries).",
    inputSchema: { type: "object", properties: { root: ROOT_SCHEMA }, additionalProperties: false },
    readOnly: true,
    handler: (args) => discoverAphrodyBinaries(root(args)),
  },
  {
    name: "workspace_fleet",
    description:
      "Repositories, pipeline stages and binaries declared for the Aphrody fleet (CLI: yolo ops fleet).",
    inputSchema: { type: "object", properties: { root: ROOT_SCHEMA }, additionalProperties: false },
    readOnly: true,
    handler: (args) => loadFleet(root(args)),
  },
  {
    name: "workspace_bridges",
    description:
      "Rust, Bun, package and API bridge catalogue used by yolo ops bridge (CLI: yolo ops bridge status).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    handler: () => loadAphrodyBridgeCatalog(),
  },
];

export async function callWorkspaceTool(name: string, args: Args = {}): Promise<unknown> {
  const tool = WORKSPACE_TOOLS.find((item) => item.name === name);
  if (!tool) throw new Error(`Unknown workspace tool: ${name}`);
  return tool.handler(args);
}

export async function runWorkspaceSubsystem(args: string[]): Promise<number> {
  const [mode = "--help", ...rest] = args;
  if (mode === "--list" && !rest.length) {
    const catalog = WORKSPACE_TOOLS.map(({ handler: _handler, ...tool }) => tool);
    console.log(JSON.stringify({ subsystem: "workspace", tools: catalog }, null, 2));
    return 0;
  }
  if (
    mode === "--call" &&
    rest[0] &&
    (rest.length === 1 || (rest.length === 3 && rest[1] === "--args"))
  ) {
    const input = rest.length === 3 ? (JSON.parse(rest[2]!) as Args) : {};
    console.log(JSON.stringify(await callWorkspaceTool(rest[0], input), null, 2));
    return 0;
  }
  if (mode === "--serve" && !rest.length) {
    const client = await registerSubsystem({
      name: "workspace",
      description: "Aphrody Workspace: read-only inventories and owner decisions as JSON.",
      tools: WORKSPACE_TOOLS,
    });
    let stopping = false;
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.on(signal, () => {
        stopping = true;
        client.close();
      });
    console.error(`workspace subsystem registered ${WORKSPACE_TOOLS.length} tools`);
    await client.closed;
    // A kernel-side close is a failure so the service manager reconnects.
    return stopping ? 0 : 1;
  }
  console.log(
    "Usage: yolo ops workspace-subsystem <--list | --call <tool> [--args <json>] | --serve>",
  );
  return mode === "--help" || mode === "-h" ? 0 : 64;
}

if (import.meta.main) process.exit(await runWorkspaceSubsystem(process.argv.slice(2)));
