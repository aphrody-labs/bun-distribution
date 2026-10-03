// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the ecosystem catalog extractors, plus the staleness gate: the committed
 * `docs/ecosystem/` output must match a fresh generation from the active roots.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  bunSubsystemTools,
  ClapIndex,
  clapItems,
  collect,
  countCommands,
  jsonCatalogTools,
  kebab,
  kernelTools,
  readPyproject,
  reexportedParser,
  render,
  rmcpTools,
  staleFiles,
  subsystemName,
  tsTools,
} from "./ecosystem.ts";

describe("clap extraction", () => {
  test("a thin facade resolves its named parser from the reexported library", () => {
    const index = new ClapIndex();
    for (const item of clapItems(
      `#[derive(Parser)] #[command(name = "demo")] struct Cli {}`,
      "src/lib.rs",
      "shared-command",
      "test",
    ))
      index.add(item);
    expect(reexportedParser(index, "pub use shared_command::*;", "demo", "test")?.crate).toBe(
      "shared-command",
    );
    expect(reexportedParser(index, "pub use other_command::*;", "demo", "test")).toBeUndefined();
    expect(
      reexportedParser(index, "pub use shared_command::*;", "demo", "other-repo"),
    ).toBeUndefined();
  });
  const src = `
    /// Top-level CLI.
    #[derive(Parser)]
    #[command(name = "demo")]
    struct Cli {
        #[command(subcommand)]
        command: Option<Commands>,
    }

    #[derive(Subcommand)]
    enum Commands {
        /// Index things.
        ///
        /// Long description ignored.
        Index(IndexArgs),
        /// Serve over HTTP.
        #[command(name = "serve-http", visible_alias = "s")]
        Serve { #[arg(long)] port: u16 },
        #[command(hide = true)]
        Secret,
        /// Gated command.
        #[cfg(feature = "extra")]
        Extra {
            #[command(subcommand)]
            action: ExtraAction,
        },
    }

    #[derive(Debug, clap::Args)]
    pub struct IndexArgs {
        #[command(subcommand)]
        pub action: Box<index::IndexAction>,
    }

    #[derive(Subcommand)]
    pub(crate) enum IndexAction { /// Build it.
        Build, /// Show "stats".
        ShowStats }

    #[derive(Subcommand)]
    enum ExtraAction { /// One.
        One }
  `;

  test("builds the exact tree, honouring renames, hide, aliases and cfg", () => {
    const index = new ClapIndex();
    for (const item of clapItems(src, "src/lib.rs", "demo", "repo")) index.add(item);
    const cli = index.parsers()[0];
    expect(cli?.name).toBe("Cli");
    const tree = index.commandsOf(cli!);
    expect(tree.map((n) => n.name)).toEqual(["index", "serve-http", "extra"]);
    expect(tree[0]?.about).toBe("Index things.");
    expect(tree[0]?.children.map((n) => [n.name, n.about])).toEqual([
      ["build", "Build it."],
      ["show-stats", 'Show "stats".'],
    ]);
    expect(tree[1]?.aliases).toEqual(["s"]);
    expect(tree[2]?.cfg).toEqual(['feature = "extra"']);
    expect(tree[2]?.children.map((n) => n.name)).toEqual(["one"]);
    expect(countCommands(tree)).toBe(6);
  });

  test("kebab-cases like clap", () => {
    expect(kebab("AppServer")).toBe("app-server");
    expect(kebab("ACPServer")).toBe("acp-server");
    expect(kebab("Base64Decode")).toBe("base64-decode");
  });
});

describe("MCP extraction", () => {
  test("rmcp tool routers", () => {
    const tools = rmcpTools(`
      #[tool_router]
      impl GoogleServer {
          #[tool(description = "Fetch a page \\
                                as Markdown.")]
          async fn web_fetch(&self) -> String { String::new() }
          #[tool(name = "renamed", description = "Other.")]
          pub async fn inner(&self) {}
      }`);
    expect(tools).toEqual([
      { server: "GoogleServer", name: "web_fetch", description: "Fetch a page as Markdown." },
      { server: "GoogleServer", name: "renamed", description: "Other." },
    ]);
  });

  test("kernel subsystem definitions and subsystem name", () => {
    const src = `fn name(&self) -> &'static str { "cloud" }
      fn tools(&self) -> Vec<ToolDefinition> { vec![ToolDefinition::new("github_status", "Inspect \\
         a repo", json!({}))] }`;
    expect(kernelTools(src)).toEqual([{ name: "github_status", description: "Inspect a repo" }]);
    expect(subsystemName(src)).toBe("cloud");
  });

  test("JSON catalogs require an inputSchema", () => {
    const src = `[{"name": "a_tool", "description": "Does \\"a\\".", "inputSchema": {}}, {"name": "x", "description": "not a tool"}]`;
    expect(jsonCatalogTools(src)).toEqual([{ name: "a_tool", description: 'Does "a".' }]);
  });

  test("Bun kernel subsystem registrations", () => {
    const src = `export const TOOLS = [
      { name: "ws_one", description:
        "First " + "part.", inputSchema: {}, handler: run },
      { name: 'ws_two', description: "Second.", handler: run },
    ];
    await registerSubsystem({ name: "ws", description: "The subsystem.", tools: TOOLS });`;
    expect(bunSubsystemTools(src)).toEqual({
      subsystem: "ws",
      tools: [
        { name: "ws_one", description: "First part." },
        { name: "ws_two", description: "Second." },
      ],
    });
    expect(bunSubsystemTools("export async function registerSubsystem(spec) {}")).toBeUndefined();
  });

  test("Bun registerTool and .tool registrations", () => {
    const src = `server.registerTool("bxc_one", { title: "T", description: "First " + "part.", inputSchema: z.object({}) }, run);
      server.tool('two', "Second.", {}, run);`;
    expect(tsTools(src)).toEqual([
      { name: "bxc_one", description: "First part." },
      { name: "two", description: "Second." },
    ]);
  });
});

test("pyproject name, description and scripts", () => {
  const py = readPyproject(
    `[project]\nname = "aphrody-ocr"\ndescription = "OCR"\n\n[project.scripts]\nb = "m:b"\na = "m:a"\n`,
  );
  expect(py).toEqual({ name: "aphrody-ocr", description: "OCR", scripts: ["a", "b"] });
});

const root = resolve(import.meta.dir, "..", "..");
const activeRootsPresent = ["aphrody", "aphrody-py", "iecode"].every((repo) =>
  existsSync(join(root, repo)),
);

describe.skipIf(!activeRootsPresent)("ecosystem catalog", () => {
  test("committed docs/ecosystem output is up to date (run: bun scripts/ecosystem.ts)", () => {
    const eco = collect(root);
    expect(eco.repos.flatMap((r) => r.errors)).toEqual([]);
    expect(eco.cli.some((b) => b.binary === "aphrody" && b.commands.length > 0)).toBe(true);
    expect(eco.counts.mcpTools).toBeGreaterThan(0);
    expect(staleFiles(join(import.meta.dir, "..", "docs", "ecosystem"), render(eco))).toEqual([]);
  }, 180_000);
});
