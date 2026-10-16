// SPDX-License-Identifier: Apache-2.0
// Generate Bun catalog metadata and verify the Rust/Bun typed binding surface.
import { join } from "node:path";

const root = join(import.meta.dir, "../../../../../docs/aphrody");
const catalogPath = join(
  root,
  "crates/os/kernel/comps/winclean/src/tools.json",
);
const rustPath = join(root, "crates/os/kernel/comps/winclean/src/generated.rs");
const bindingsPath = join(root, "packages/os/winclean/src/generated.ts");
const outputPath = join(root, "packages/os/winclean/src/catalog.ts");

type Tool = {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** First capture group of `pattern` in `source`; fails the check when it is absent. */
function capture(source: string, pattern: RegExp, message: string): string {
  const body = source.match(pattern)?.[1];
  assert(body !== undefined, message);
  return body;
}

const tools = ((await Bun.file(catalogPath).json()) as { tools: Tool[] }).tools;
assert(Array.isArray(tools) && tools.length > 0, "empty WinClean catalog");
const names = tools.map((tool) => tool.name);
assert(new Set(names).size === names.length, "duplicate WinClean catalog name");
for (const tool of tools) {
  assert(
    tool.inputSchema?.type === "object",
    `invalid inputSchema for ${tool.name}`,
  );
}

const rust = await Bun.file(rustPath).text();
const rustArray = capture(
  rust,
  /pub const TOOL_NAMES: \[&str; \d+\] = \[([\s\S]*?)\];/,
  "Rust generated TOOL_NAMES missing",
);
const rustNames = [...rustArray.matchAll(/"([^"]+)"/g)].map(
  (match) => match[1],
);
assert(
  JSON.stringify(rustNames) === JSON.stringify(names),
  "Rust generated tool names diverge from tools.json",
);

const bindings = await Bun.file(bindingsPath).text();
const bunArray = capture(
  bindings,
  /export const TOOL_NAMES = \[([\s\S]*?)\] as const;/,
  "Bun TOOL_NAMES missing",
);
const bunNames = [...bunArray.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
assert(
  JSON.stringify(bunNames) === JSON.stringify(names),
  "Bun generated tool names diverge from tools.json",
);
const argsMap = capture(
  bindings,
  /export type ToolArgsMap = \{([\s\S]*?)^\};/m,
  "Bun ToolArgsMap missing",
);
const mapping = new Map(
  [...argsMap.matchAll(/^  "?(\w+)"?: (\w+);/gm)].flatMap(([, name, type]) =>
    name && type ? [[name, type] as const] : [],
  ),
);
const interfaces = new Map(
  [
    ...bindings
      .replace(/^export interface (\w+) \{\}$/gm, "export interface $1 {\n}")
      .matchAll(/^export interface (\w+) \{([\s\S]*?)^\}/gm),
  ].flatMap(([, name, body]) =>
    name && body !== undefined ? [[name, body] as const] : [],
  ),
);
assert(
  mapping.size === tools.length,
  "Bun ToolArgsMap count diverges from tools.json",
);
for (const tool of tools) {
  const reference = mapping.get(tool.name);
  assert(reference, `Bun args mapping missing for ${tool.name}`);
  const definition = interfaces.get(reference);
  assert(
    definition !== undefined,
    `Bun args interface missing for ${tool.name}`,
  );
  const fields = new Map(
    [...definition.matchAll(/^  (\w+)(\?)?:/gm)].flatMap(
      ([, name, optional]) =>
        name ? [[name, optional !== undefined] as const] : [],
    ),
  );
  const properties = tool.inputSchema.properties ?? {};
  assert(
    JSON.stringify([...fields.keys()].toSorted()) ===
      JSON.stringify(Object.keys(properties).toSorted()),
    `Bun args fields diverge for ${tool.name}`,
  );
  const required = new Set(tool.inputSchema.required ?? []);
  for (const [name, optional] of fields) {
    assert(
      optional !== required.has(name),
      `Bun args optionality diverges for ${tool.name}.${name}`,
    );
  }
}

const output = `// SPDX-License-Identifier: Apache-2.0\n// Generated from crates/os/kernel/comps/winclean/src/tools.json by scripts/tools/os/scripts/generate-winclean-catalog.ts.\n// Do not edit by hand.\nexport const TOOL_CATALOG: ReadonlyArray<{ name: string; description: string; inputSchema: Record<string, unknown>; execution?: unknown }> = ${JSON.stringify(tools, null, 2)};\n`;
if (process.argv.includes("--check")) {
  const current = await Bun.file(outputPath)
    .text()
    .catch(() => "");
  assert(
    current === output,
    "Bun catalog metadata diverges; run bun scripts/tools/os/scripts/generate-winclean-catalog.ts",
  );
} else {
  await Bun.write(outputPath, output);
}
console.log(
  `WinClean catalog parity: ${tools.length} names, schemas and argument fields`,
);
