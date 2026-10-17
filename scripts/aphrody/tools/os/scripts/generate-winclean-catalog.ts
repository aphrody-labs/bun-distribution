// SPDX-License-Identifier: Apache-2.0
// Generate the typed WinClean bindings from the canonical Rust tool catalog
// (packages/bun-windows-winclean/src/tools.json):
//   - packages/bun-windows-winclean/src/generated.rs  (TOOL_NAMES, argument structs, methods)
//   - packages/bun-windows-winclean/tool-migration.json (tool list, count and catalog digest)
//   - packages/winclean/src/generated.ts               (TOOL_NAMES, argument interfaces, methods)
//   - packages/winclean/src/catalog.ts                 (TOOL_CATALOG metadata)
// Usage: bun scripts/aphrody/tools/os/scripts/generate-winclean-catalog.ts [--check]
import { join } from "node:path";

const root = join(import.meta.dir, "../../../../..");
const sdk = join(root, "packages/bun-windows-winclean");
const client = join(root, "packages/winclean");
const catalogPath = join(sdk, "src/tools.json");
const ledgerPath = join(sdk, "tool-migration.json");
const rustPath = join(sdk, "src/generated.rs");
const bindingsPath = join(client, "src/generated.ts");
const metadataPath = join(client, "src/catalog.ts");
const check = process.argv.includes("--check");

type Property = {
  type?: string | string[];
  description?: string;
  default?: unknown;
  items?: { type?: string };
};
type Tool = {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, Property>;
    required?: string[];
  };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const catalogText = await Bun.file(catalogPath).text();
const tools = (JSON.parse(catalogText) as { tools: Tool[] }).tools;
assert(Array.isArray(tools) && tools.length > 0, "empty WinClean catalog");
const names = tools.map(tool => tool.name);
assert(new Set(names).size === names.length, "duplicate WinClean catalog name");
for (const tool of tools) {
  assert(tool.inputSchema?.type === "object", `invalid inputSchema for ${tool.name}`);
}

const RUST_KEYWORDS = new Set([
  "type",
  "move",
  "fn",
  "match",
  "ref",
  "self",
  "loop",
  "use",
  "mod",
  "impl",
  "where",
  "async",
  "await",
  "dyn",
]);
const pascal = (name: string) =>
  name
    .split("_")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
const camel = (name: string) => name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const snake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const rustIdent = (name: string) => (RUST_KEYWORDS.has(name) ? `${name}_` : name);

/** Greedy word wrap of `text` to `width` columns after `prefix`. */
function wrap(text: string, prefix: string, width = 100): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && prefix.length + line.length + 1 + word.length > width) {
      lines.push(prefix + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(prefix + line);
  return lines.length ? lines : [prefix.trimEnd()];
}

/** The non-null JSON type of a property (`["string", "null"]` is a nullable string). */
function baseType(property: Property): string | undefined {
  return Array.isArray(property.type) ? property.type.find(type => type !== "null") : property.type;
}

const nullable = (property: Property) => Array.isArray(property.type) && property.type.includes("null");

function rustType(property: Property): string {
  switch (baseType(property)) {
    case "integer":
      return "i64";
    case "number":
      return "f64";
    case "boolean":
      return "bool";
    case "array":
      return property.items?.type === "string" ? "Vec<String>" : "Vec<serde_json::Value>";
    case "string":
      return "String";
    default:
      return "serde_json::Value";
  }
}

function tsType(property: Property): string {
  const type = tsBaseType(property);
  return nullable(property) ? `${type} | null` : type;
}

function tsBaseType(property: Property): string {
  switch (baseType(property)) {
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return property.items?.type === "string" ? "string[]" : "Record<string, unknown>[]";
    case "string":
      return "string";
    default:
      return "unknown";
  }
}

// ─── Rust ────────────────────────────────────────────────────────────────────

function rustStruct(tool: Tool): string {
  const struct = `${pascal(tool.name)}Args`;
  const properties = Object.entries(tool.inputSchema.properties ?? {});
  const required = new Set(tool.inputSchema.required ?? []);
  const out = [
    `/// Arguments for [\`Winclean::${rustIdent(tool.name)}\`] (\`${tool.name}\`).`,
    "#[derive(Debug, Clone, Default, Serialize)]",
  ];
  if (properties.length === 0) {
    out.push(`pub struct ${struct} {}`, "");
    return out.join("\n");
  }
  out.push(`pub struct ${struct} {`);
  for (const [name, property] of properties) {
    const field = rustIdent(snake(name));
    const type = rustType(property);
    if (property.description) out.push(...wrap(property.description, "    /// "));
    if (property.default !== undefined) {
      if (property.description) out.push("    ///");
      out.push(`    /// Default: \`${JSON.stringify(property.default)}\`.`);
    }
    if (required.has(name)) {
      out.push(`    #[serde(rename = "${name}")]`, `    pub ${field}: ${type},`);
    } else {
      out.push(
        `    #[serde(rename = "${name}", skip_serializing_if = "Option::is_none")]`,
        `    pub ${field}: Option<${type}>,`,
      );
    }
  }
  out.push(
    "}",
    "",
    `impl ${struct} {`,
    "    /// Creates arguments with every field at its default.",
    "    #[must_use]",
    "    pub fn new() -> Self {",
    "        Self::default()",
    "    }",
  );
  for (const [name, property] of properties) {
    const field = rustIdent(snake(name));
    const type = rustType(property);
    const isString = type === "String";
    const parameter = isString ? "impl Into<String>" : type;
    const value = isString ? "value.into()" : "value";
    const assigned = required.has(name) ? value : `Some(${value})`;
    out.push(
      "",
      `    /// Sets \`${name}\`.`,
      "    #[must_use]",
      `    pub fn ${field}(mut self, value: ${parameter}) -> Self {`,
      `        self.${field} = ${assigned};`,
      "        self",
      "    }",
    );
  }
  out.push("}", "");
  return out.join("\n");
}

function rustMethods(tool: Tool): string {
  const method = rustIdent(tool.name);
  const struct = `${pascal(tool.name)}Args`;
  const errors = [
    "    /// # Errors",
    "    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.",
  ];
  return [
    ...wrap(tool.description, "    /// "),
    "    ///",
    ...errors,
    `    pub fn ${method}(&self, args: &${struct}) -> Result<ToolResult> {`,
    `        self.call("${tool.name}", args)`,
    "    }",
    "",
    `    /// Async variant of [\`Winclean::${method}\`]; runs on the library thread pool.`,
    "    ///",
    ...errors,
    `    pub async fn ${tool.name}_async(&self, args: &${struct}) -> Result<ToolResult> {`,
    `        self.call_async("${tool.name}", args).await`,
    "    }",
  ].join("\n");
}

const rust = [
  "// SPDX-License-Identifier: Apache-2.0",
  "// @generated from the canonical Rust tool catalog — do not edit by hand.",
  "#![allow(clippy::doc_markdown, clippy::too_many_lines, missing_docs)]",
  "",
  "use serde::Serialize;",
  "",
  "use crate::{Result, ToolResult, Winclean};",
  "",
  "/// Every tool name exposed by the Rust WinClean compatibility surface.",
  `pub const TOOL_NAMES: [&str; ${names.length}] = [`,
  ...names.map(name => `    "${name}",`),
  "];",
  "",
  ...tools.map(rustStruct),
  "impl Winclean {",
  tools.map(rustMethods).join("\n\n"),
  "}",
  "",
].join("\n");

// ─── TypeScript ──────────────────────────────────────────────────────────────

function tsInterface(tool: Tool): string {
  const name = `${pascal(tool.name)}Args`;
  const properties = Object.entries(tool.inputSchema.properties ?? {});
  const required = new Set(tool.inputSchema.required ?? []);
  if (properties.length === 0) return `/** Arguments for \`${tool.name}\`. */\nexport interface ${name} {}\n`;
  const out = [`/** Arguments for \`${tool.name}\`. */`, `export interface ${name} {`];
  for (const [field, property] of properties) {
    out.push("  /**");
    if (property.description) out.push(`   * ${property.description}`);
    if (property.default !== undefined) out.push(`   * @default ${JSON.stringify(property.default)}`);
    out.push("   */", `  ${field}${required.has(field) ? "" : "?"}: ${tsType(property)};`);
  }
  out.push("}", "");
  return out.join("\n");
}

function tsMethod(tool: Tool): string {
  const required = (tool.inputSchema.required ?? []).length > 0;
  const args = `args${required ? "" : "?"}: ${pascal(tool.name)}Args`;
  return [
    "  /**",
    `   * ${tool.description}`,
    "   */",
    `  ${camel(tool.name)}(${args}): Promise<ToolResult> {`,
    `    return this.call("${tool.name}", args);`,
    "  }",
  ].join("\n");
}

const bindings = [
  "// SPDX-License-Identifier: Apache-2.0",
  "// @generated from the canonical Rust tool catalog — do not edit by hand.",
  "/* eslint-disable */",
  'import type { ToolResult } from "./result";',
  "",
  "export const TOOL_NAMES = [",
  ...names.map(name => `  "${name}",`),
  "] as const;",
  "export type ToolName = (typeof TOOL_NAMES)[number];",
  "",
  ...tools.map(tsInterface),
  "export type ToolArgsMap = {",
  ...tools.map(tool => `  ${tool.name}: ${pascal(tool.name)}Args;`),
  "};",
  "",
  "/** One typed async method per WinClean tool. */",
  "export abstract class GeneratedTools {",
  "  abstract call<N extends ToolName>(",
  "    name: N,",
  "    args?: ToolArgsMap[N],",
  "  ): Promise<ToolResult>;",
  "",
  tools.map(tsMethod).join("\n\n"),
  "}",
  "",
].join("\n");

const metadata = `// SPDX-License-Identifier: Apache-2.0\n// Generated from packages/bun-windows-winclean/src/tools.json by scripts/aphrody/tools/os/scripts/generate-winclean-catalog.ts.\n// Do not edit by hand.\nexport const TOOL_CATALOG: ReadonlyArray<{\n  name: string;\n  description: string;\n  inputSchema: Record<string, unknown>;\n  execution?: unknown;\n}> = ${JSON.stringify(tools, null, 2)};\n`;

// ─── migration ledger ────────────────────────────────────────────────────────

const ledger = JSON.parse(await Bun.file(ledgerPath).text()) as Record<string, unknown>;
// Hash of the catalog as Git's LF blob, as verify-winclean-integration.ts checks it.
ledger.catalog_sha256 = new Bun.CryptoHasher("sha256").update(catalogText.replaceAll("\r\n", "\n")).digest("hex");
ledger.catalog_tool_count = names.length;
ledger.tools = names;
// Every catalog tool is implemented by the Rust dispatcher; keep the evidence map complete.
const overrides = (ledger.dispatch_overrides ?? {}) as Record<string, string>;
for (const name of names) overrides[name] ??= "rust";
ledger.dispatch_overrides = overrides;
if (typeof ledger.note === "string") ledger.note = ledger.note.replace(/all \d+ tools/, `all ${names.length} tools`);
const ledgerText = `${JSON.stringify(ledger, null, 2)}\n`;

// ─── write or check ──────────────────────────────────────────────────────────

const outputs: Array<[string, string]> = [
  [rustPath, await rustfmt(rust)],
  [bindingsPath, await bunfmt(bindings, bindingsPath)],
  [metadataPath, await bunfmt(metadata, metadataPath)],
  [ledgerPath, ledgerText],
];

/** Formats generated TypeScript with the native `bun fmt` as if it were `path`. */
async function bunfmt(source: string, path: string): Promise<string> {
  const child = Bun.spawn([process.execPath, "fmt", `--stdin-filepath=${path}`], {
    stdin: new Blob([source]),
    stdout: "pipe",
    stderr: "pipe",
    cwd: root,
  });
  const [code, text, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert(code === 0, `bun fmt failed: ${error}`);
  return text;
}

/** Formats generated Rust with the workspace rustfmt configuration (stdin to stdout). */
async function rustfmt(source: string): Promise<string> {
  const child = Bun.spawn(
    ["rustfmt", "--edition", "2024", "--emit", "stdout", "--config-path", join(root, "rustfmt.toml")],
    {
      stdin: new Blob([source]),
      stdout: "pipe",
      stderr: "pipe",
      cwd: root,
    },
  );
  const [code, text, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert(code === 0, `rustfmt failed: ${error}`);
  return text;
}

let stale = 0;
for (const [path, content] of outputs) {
  const current = await Bun.file(path)
    .text()
    .catch(() => "");
  if (current === content) continue;
  if (check) {
    console.error(`stale: ${path}`);
    stale++;
  } else {
    await Bun.write(path, content);
  }
}
if (check && stale > 0) {
  throw new Error("WinClean bindings diverge; run bun scripts/aphrody/tools/os/scripts/generate-winclean-catalog.ts");
}
console.log(
  `WinClean catalog: ${names.length} tools -> generated.rs, generated.ts, catalog.ts, tool-migration.json${check ? " (checked)" : ""}`,
);
