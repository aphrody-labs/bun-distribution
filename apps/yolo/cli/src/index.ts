#!/usr/bin/env bun
/**
 * YOLO Industrial Engine CLI & Autonomous Monorepo Generator
 * Fully leveraging native Bun 1.4+ features:
 * - Bun.file & Bun.write for zero-copy I/O
 * - Bun.Glob for native multithreaded directory traversal across submodules
 * - Bun.hash (wyhash, crc32, cityHash, rapidhash) for instant checksumming
 * - Bun.TOML, Bun.JSONL, Bun.JSON5, Bun.XML for configuration & structured parsing
 * - Bun.markdown for native GFM rendering
 * - Bun.nanoseconds for sub-microsecond precision benchmarking
 * - Bun.stringWidth & Bun.sliceAnsi for terminal presentation
 * - ZERO external runtime npm dependencies
 */

import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { findCheckout, isCompiled, yoloHome } from "./home";
import type {
  AutonomousGenerationReport,
  BenchMetrics,
  BunApiDomain,
  StatusReport,
  SubmoduleStatus,
  TsParseResult,
  VendorSourceStatus,
  WorkspaceCargoSummary,
} from "../../../../packages/engine/core/src/index";

export type {
  SubmoduleStatus,
  TsParseResult,
  WorkspaceCargoSummary,
  BunApiDomain,
  AutonomousGenerationReport,
  VendorSourceStatus,
  StatusReport,
  BenchMetrics,
};

// Startup cost: `yolo version` is a preflight that wrappers run before every task, so this file loads nothing but the
// home resolver. Every command module is imported by its `case` below, and the programmatic API below forwards to the
// core module that defines it on first call (the core barrel alone costs ~11 ms to evaluate).
const vendorStatus = () => import("../../../../packages/engine/core/src/vendor/status");
const vendorCargo = () => import("../../../../packages/engine/core/src/vendor/cargo");
const vendorCatalog = () => import("../../../../packages/engine/core/src/vendor/catalog");
const vfsParse = () => import("../../../../packages/engine/core/src/vfs/parse");
const sysBench = () => import("../../../../packages/engine/core/src/sys/benchmark");
type Status = Awaited<ReturnType<typeof vendorStatus>>;
type Cargo = Awaited<ReturnType<typeof vendorCargo>>;
type Catalog = Awaited<ReturnType<typeof vendorCatalog>>;
type Parse = Awaited<ReturnType<typeof vfsParse>>;
type Bench = Awaited<ReturnType<typeof sysBench>>;

export const inspectPackages: Status["inspectPackages"] = async (...args) =>
  (await vendorStatus()).inspectPackages(...args);
export const readVendorStatus: Status["readVendorStatus"] = async (...args) =>
  (await vendorStatus()).readVendorStatus(...args);
export const collectStatusReport: Status["collectStatusReport"] = async (...args) =>
  (await vendorStatus()).collectStatusReport(...args);
export const resolveGitDir: Status["resolveGitDir"] = async (...args) =>
  (await vendorStatus()).resolveGitDir(...args);
export const readWorkspaceCargo: Cargo["readWorkspaceCargo"] = async (...args) =>
  (await vendorCargo()).readWorkspaceCargo(...args);
export const generateBunCatalog: Catalog["generateBunCatalog"] = async (...args) =>
  (await vendorCatalog()).generateBunCatalog(...args);
export const parseTsSource: Parse["parseTsSource"] = async (...args) =>
  (await vfsParse()).parseTsSource(...args);
// The pure renderers are synchronous in the core API, so they load their module with a lazy `require`.
export const renderStatusMarkdown: Status["renderStatusMarkdown"] = (...args) =>
  (require("../../../../packages/engine/core/src/vendor/status") as Status).renderStatusMarkdown(...args);
export const renderParseMarkdown: Parse["renderParseMarkdown"] = (...args) =>
  (require("../../../../packages/engine/core/src/vfs/parse") as Parse).renderParseMarkdown(...args);
export const runBenchMetrics: Bench["runBenchMetrics"] = (...args) =>
  (require("../../../../packages/engine/core/src/sys/benchmark") as Bench).runBenchMetrics(...args);
export const renderBenchMarkdown: Bench["renderBenchMarkdown"] = (...args) =>
  (require("../../../../packages/engine/core/src/sys/benchmark") as Bench).renderBenchMarkdown(...args);

let cachedRoot: string | undefined;
/** The yolo home, resolved on first use (it walks parent directories, which `version` and `help` do not need). */
const rootDir = (): string => (cachedRoot ??= yoloHome());

export function printHelp(): void {
  const header = "\x1b[1m\x1b[36mYOLO Industrial Engine CLI\x1b[0m (100% Native Bun Powered)";
  console.log(`
${header}

\x1b[1mUSAGE:\x1b[0m
  yolo <command> [options]

\x1b[1mCOMMANDS:\x1b[0m
  \x1b[32mstatus [--json|--md]\x1b[0m Inspect active package forks & Cargo workspace status
  \x1b[32mscan [dir] [--json|--md]\x1b[0m Fast parallel recursive scanner (lines, bytes, wyhash)
  \x1b[32mn2b [dir] [--jobs N] [--fix|--aggressive] [--dry-run] [--json]\x1b[0m Native recursive Node-to-Bun migration
  \x1b[32mai list|call <tool> <json>\x1b[0m Shared AI capabilities (same schemas and owner as MCP/API)
  \x1b[32mmcp\x1b[0m                 Model Context Protocol (MCP 2024-11-05) stdio server for AI agents
  \x1b[32mapi [--port N]\x1b[0m      Serve local HTTP / REST / OpenAPI micro-server (Bun.serve)
  \x1b[32mweb [build|dev]\x1b[0m     Manage and build the zero-overhead Web & Desktop frontend
  \x1b[32mgenerate [--json]\x1b[0m   Autonomously scan upstream Bun and generate code & capability catalogs
  \x1b[32mparse <file> [--json|--md]\x1b[0m Fast AST & token analysis via Bun file streaming + wyhash
  \x1b[32mdocs [query] [--json|--md]\x1b[0m Search or inspect version-matched Bun documentation in vendor/bun/docs
  \x1b[32mversion [--json] | doctor [--json|--md]\x1b[0m Installed version, target; check the installation
  \x1b[32mruntime install|list|verify|rollback|info\x1b[0m  Manage installed runtime artifacts
  \x1b[32mdesktop-runtime package|install|verify|rollback|info\x1b[0m  Manage native system-WebView artifacts
  \x1b[32mupgrade [--check|--release-dir DIR]\x1b[0m Install a verified release; \x1b[32muninstall [--yes]\x1b[0m removes ~/.yolo
  \x1b[32mcreate <dir> [--with web,desktop]\x1b[0m Scaffold an Aphrody stack project (Bun + runtime SDK + Tauri) from templates/
  \x1b[32mawesome [stats|list|search|github|check]\x1b[0m Browse oven-sh/awesome-bun (README cached, no clone)
  \x1b[32mimport [--apply|--check]\x1b[0m Vendor the fork crates into crates/aphrody-* (see vendor.toml)
  \x1b[32mrename [opts] [dir..]\x1b[0m Mass boundary-aware rename (--preset aphrody | --from X --to Y, --apply, --paths)
  \x1b[32minfra|ops|workspace|workflow|git|ssh ...\x1b[0m Aphrody control plane (aphrody-infra / aphrody-ops), same workflow
  \x1b[32mverify [--only a,b] [--changed] [--parallel N] [--json|--md] [--list|--last]\x1b[0m Run the repository gates as a parallel graph; JSON or Markdown evidence in var/verify
  \x1b[32mhost audit|reclaim|archive|services|tune|net|mount|journal --host vps|dbfr|local [--apply]\x1b[0m Manage a Linux server (plan by default, journaled, safety-checked)
  \x1b[32mship [--apply] [--prepare] [status|log|attach|stop]\x1b[0m Prepare or build on the factory; \x1b[32mhooks install\x1b[0m ships main/dev pushes
  \x1b[32mplugin <create|status>\x1b[0m Generate or inspect unified YOLO & Bun-TS7 plugin
  \x1b[32mpy [status|test|lint|fmt|build]\x1b[0m Python + uv + PyO3 polyglot runtime toolchain
  \x1b[32mbench [--json|--md]\x1b[0m Run native Bun nanoseconds and hashing micro-benchmark
  \x1b[32mhelp\x1b[0m                Display this help message

\x1b[1mAGENT-FIRST PROTOCOLS:\x1b[0m
  --json              Machine-readable structured JSON with strict schema (e.g. yolo.verify/1)
  --md                GitHub-flavored Markdown tables and summaries

\x1b[1mENGINE BASELINE:\x1b[0m
  Runtime: Bun ${Bun.version} (${Bun.revision.slice(0, 10)})
  OS:      ${process.platform} (${process.arch})
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || (isCompiled() ? "help" : "status");

  // These commands need repository data. Their implementation is bundled, so a checkout never requires
  // another Bun installation or a subprocess that loads potentially different CLI sources.
  const CHECKOUT_ONLY = new Set([
    "status",
    "generate",
    "web",
    "desktop",
    "tauri",
    "docs",
    "import",
    "plugin",
    "py",
    "python",
    "uv",
    "ship",
    "hooks",
  ]);
  if (isCompiled() && CHECKOUT_ONLY.has(command)) {
    const checkout = findCheckout();
    if (checkout === null) {
      console.error(
        `\`yolo ${command}\` requires yolo checkout data. Run it inside a checkout containing vendor.toml and apps/cli/src/index.ts.`,
      );
      process.exitCode = 1;
      return;
    }
    cachedRoot = checkout;
    process.env["YOLO_HOME"] = checkout;
  }

  const workspaceRoot = (): string => findCheckout() ?? process.cwd();

  switch (command) {
    case "n2b": {
      const { runN2bCommand } = await import("./n2b");
      process.exitCode = await runN2bCommand(args.slice(1), process.cwd());
      break;
    }
    case "status": {
      const report = await collectStatusReport();
      if (args.includes("--json")) {
        console.log(JSON.stringify(report, null, 2));
        break;
      }
      if (args.includes("--md")) {
        console.log(renderStatusMarkdown(report));
        break;
      }

      console.log(`\x1b[1m\x1b[36m=== YOLO Monorepo Status (Native Bun Engine) ===\x1b[0m`);
      for (const p of report.packages) {
        const status = p.exists ? `\x1b[32m[LOADED]\x1b[0m` : `\x1b[31m[MISSING]\x1b[0m`;
        const commit = p.headCommit ? `(${p.headCommit})` : "";
        const sampleCount = p.filesCount !== undefined ? `[~${p.filesCount}+ files]` : "";
        console.log(`  ${status} vendor/${p.name.padEnd(10)} ${commit.padEnd(14)} ${sampleCount}`);
      }

      if (report.vendor) {
        console.log(`\n\x1b[1m\x1b[36m=== Vendored crates (vendor.lock) ===\x1b[0m`);
        console.log(`  ${report.vendor.crates} crates imported into crates/aphrody-*`);
        for (const source of report.vendor.sources) {
          const state = source.inSync
            ? "\x1b[32min sync\x1b[0m"
            : `\x1b[33mdrift (submodule at ${source.headSha?.slice(0, 10) ?? "?"}), run \`just vendor-update\`\x1b[0m`;
          console.log(`  ${source.name.padEnd(18)} ${source.lockedSha.slice(0, 10)} ${state}`);
        }
      }

      if (report.cargo) {
        console.log(`\n\x1b[1m\x1b[36m=== Cargo Workspace Config (via Bun.TOML) ===\x1b[0m`);
        console.log(`  Resolver: v${report.cargo.resolver}`);
        console.log(`  Members:  ${report.cargo.members.join(", ")}`);
        console.log(
          `  Default:  ${report.cargo.defaultMembers?.join(", ") ?? "Cargo implicit selection"}`,
        );
        console.log(
          `  Release:  opt-level=${String(report.cargo.releaseProfile["opt-level"] ?? "z")}, strip=${String(report.cargo.releaseProfile["strip"] ?? true)}`,
        );
      }
      break;
    }

    case "generate": {
      if (args.includes("--json")) {
        const report = await generateBunCatalog();
        console.log(JSON.stringify(report, null, 2));
        break;
      }
      console.log(`\x1b[1m\x1b[36m=== Autonomous Bun Upstream Generator ===\x1b[0m`);
      console.log(
        `  Scanning upstream vendor/bun for Web APIs, Server, React, CSS, Image, JSON, Markdown...`,
      );
      const report = await generateBunCatalog();
      console.log(`  \x1b[32m[SUCCESS]\x1b[0m Generated code catalog in ${report.elapsedMs} ms`);
      console.log(`  Target:   ${relative(rootDir(), report.targetCatalogPath)}`);
      console.log(
        `  Indexed:  ${report.totalDocFilesIndexed} docs, ${report.totalTypeFilesIndexed} type declarations`,
      );
      console.log(`\n  \x1b[1mDomains Cataloged:\x1b[0m`);
      for (const d of report.domains) {
        console.log(
          `    - \x1b[33m${d.title.padEnd(35)}\x1b[0m: ${d.docMatches.length} docs, ${d.keyApis.length} APIs`,
        );
      }
      break;
    }

    case "parse": {
      const target = args.find((a) => !a.startsWith("-") && a !== "parse");
      if (!target) {
        console.error("\x1b[31mError:\x1b[0m Please provide a file to parse.");
        process.exit(1);
      }
      const absPath = resolve(process.cwd(), target);
      if (!existsSync(absPath)) {
        console.error(`\x1b[31mError:\x1b[0m File not found: ${absPath}`);
        process.exit(1);
      }
      const result = await parseTsSource(absPath);
      if (args.includes("--json")) {
        console.log(JSON.stringify({ schema: "yolo.parse/1", ...result }, null, 2));
        break;
      }
      if (args.includes("--md")) {
        console.log(renderParseMarkdown(result));
        break;
      }
      console.log(`\x1b[1m\x1b[36m=== Parsed Source: ${relative(rootDir(), absPath)} ===\x1b[0m`);
      console.log(`  Lines:    ${result.lines}`);
      console.log(`  Bytes:    ${result.bytes} B`);
      console.log(`  Checksum: wyhash:0x${result.checksum}`);
      console.log(`  Speed:    ${result.parseTimeMs} ms`);
      console.log(
        `  Exports:  ${result.exports.length} symbol(s) [${result.exports.slice(0, 10).join(", ")}${result.exports.length > 10 ? "..." : ""}]`,
      );
      console.log(
        `  Imports:  ${result.imports.length} module(s) [${result.imports.slice(0, 8).join(", ")}${result.imports.length > 8 ? "..." : ""}]`,
      );
      break;
    }

    case "bench": {
      if (args.includes("--supervisor")) {
        const { runSupervisorBenchCli } =
          await import("../../../../packages/engine/core/src/sys/supervisor-benchmark");
        process.exitCode = await runSupervisorBenchCli(args.slice(1));
        break;
      }
      const metrics = runBenchMetrics();
      if (args.includes("--json")) {
        console.log(JSON.stringify(metrics, null, 2));
        break;
      }
      if (args.includes("--md")) {
        console.log(renderBenchMarkdown(metrics));
        break;
      }
      console.log(`\x1b[1m\x1b[36m=== YOLO Bun Micro-Benchmark Suite ===\x1b[0m`);
      console.log(
        `  Bun.hash.wyhash:  ${metrics.iterations.toLocaleString()} iterations in ${metrics.wyhash.elapsedMs.toFixed(2)} ms (${metrics.wyhash.sample})`,
      );
      console.log(
        `  Bun.hash.crc32:   ${metrics.iterations.toLocaleString()} iterations in ${metrics.crc32.elapsedMs.toFixed(2)} ms (${metrics.crc32.sample})`,
      );
      console.log(
        `  Bun.stringWidth:  "${metrics.stringWidth.sample}" -> width = ${metrics.stringWidth.width}`,
      );
      console.log(`  Bun.stripANSI:    "${metrics.stringWidth.stripped}"`);
      break;
    }

    case "web":
    case "desktop":
    case "tauri": {
      const sub = args[1] || "build";
      const webDir = resolve(rootDir(), "apps/yolo/web");
      if (!existsSync(webDir)) {
        console.error(`\x1b[31mError:\x1b[0m web app not found at ${webDir}`);
        process.exit(1);
      }
      if (sub === "dev") {
        console.log(`\x1b[1m\x1b[36m=== Launching Web Dev Server ===\x1b[0m`);
        const proc = Bun.spawn(["bun", "run", "dev"], {
          cwd: webDir,
          stdout: "inherit",
          stderr: "inherit",
        });
        process.exitCode = await proc.exited;
      } else {
        console.log(`\x1b[1m\x1b[36m=== Building Web Frontend ===\x1b[0m`);
        const proc = Bun.spawn(["bun", "run", "build"], {
          cwd: webDir,
          stdout: "inherit",
          stderr: "inherit",
        });
        process.exitCode = await proc.exited;
      }
      break;
    }

    case "docs": {
      const docsDir = resolve(rootDir(), "vendor", "bun/docs");
      const query = args.find((a) => !a.startsWith("-") && a !== "docs")?.toLowerCase();
      let matches: string[] = [];
      if (existsSync(docsDir)) {
        if (!query) {
          const glob = new Bun.Glob("*.{md,mdx}");
          matches = Array.from(glob.scanSync({ cwd: docsDir, onlyFiles: true })).sort();
        } else {
          const glob = new Bun.Glob("**/*.{md,mdx}");
          for (const filePath of glob.scanSync({ cwd: docsDir, onlyFiles: true })) {
            if (filePath.toLowerCase().includes(query)) {
              matches.push(filePath);
            }
          }
          matches.sort();
        }
      }

      if (args.includes("--json")) {
        console.log(
          JSON.stringify(
            {
              schema: "yolo.docs/1",
              query: query ?? null,
              totalMatches: matches.length,
              matches,
            },
            null,
            2,
          ),
        );
        break;
      }

      if (args.includes("--md")) {
        const mdLines = [
          `# yolo docs: ${query ? `"${query}"` : "vendor/bun/docs"}`,
          "",
          `- **Matches:** ${matches.length}`,
          "",
          ...matches.map((m) => `- \`${m}\``),
        ];
        console.log(mdLines.join("\n"));
        break;
      }

      console.log(`\x1b[1m\x1b[36m=== Bun Docs Corpus (via Bun.Glob) ===\x1b[0m`);
      if (!existsSync(docsDir)) {
        console.log(`  \x1b[31mDocs not found at ${docsDir}\x1b[0m`);
        break;
      }
      if (!query) {
        console.log(`  Docs directory: vendor/bun/docs (${matches.length} root items)`);
      } else {
        console.log(`  Found ${matches.length} match(es):`);
        for (const r of matches.slice(0, 10)) {
          console.log(`    - ${r}`);
        }
      }
      break;
    }

    case "version":
    case "--version":
    case "-v": {
      const { runVersion } = await import("./version");
      process.exitCode = runVersion(args);
      break;
    }

    case "doctor": {
      const { runDoctor } = await import("./distribution");
      process.exitCode = runDoctor(args.slice(1));
      break;
    }

    case "scan": {
      const { runScanCommand } = await import("./scan");
      process.exitCode = await runScanCommand(
        args.slice(1),
        isCompiled() ? process.cwd() : rootDir(),
      );
      break;
    }

    case "ai": {
      const { runAiCommand } = await import("./ai");
      process.exitCode = await runAiCommand(args.slice(1), workspaceRoot());
      break;
    }

    case "mcp": {
      const { runMcpServer } = await import("./mcp");
      await runMcpServer(workspaceRoot());
      break;
    }

    case "api":
    case "serve": {
      const { runApiCommand } = await import("./api");
      process.exitCode = await runApiCommand(args.slice(1), workspaceRoot());
      break;
    }

    case "desktop-runtime": {
      const { runDesktopRelease } = await import("../../../../scripts/tools/desktop-release");
      process.exitCode = runDesktopRelease(args.slice(1));
      break;
    }

    case "runtime": {
      const { runRuntimeCommand } = await import("./distribution");
      process.exitCode = await runRuntimeCommand(args.slice(1));
      break;
    }

    case "upgrade": {
      const { runUpgrade } = await import("./distribution");
      process.exitCode = await runUpgrade(args.slice(1));
      break;
    }

    case "uninstall": {
      const { runUninstall } = await import("./distribution");
      process.exitCode = runUninstall(args.slice(1));
      break;
    }

    case "create": {
      const { runCreateCommand } = await import("./create");
      process.exitCode = await runCreateCommand(args.slice(1), rootDir());
      break;
    }

    case "awesome": {
      const { runAwesomeCommand } = await import("./awesome");
      process.exitCode = await runAwesomeCommand(args.slice(1), rootDir());
      break;
    }

    case "import": {
      const { runImportCommand } = await import("./import");
      process.exitCode = await runImportCommand(args.slice(1), rootDir());
      break;
    }

    case "rename": {
      const { runRenameCommand } = await import("./rename");
      process.exitCode = await runRenameCommand(
        args.slice(1),
        isCompiled() ? process.cwd() : rootDir(),
      );
      break;
    }

    case "plugin": {
      const { runPluginCommand } = await import("./plugin");
      process.exitCode = await runPluginCommand(args.slice(1), rootDir());
      break;
    }

    case "py":
    case "python":
    case "uv": {
      const { runPythonCommand } = await import("./python");
      process.exitCode = await runPythonCommand(args.slice(1), rootDir());
      break;
    }

    case "infra":
    case "ops":
    case "workspace":
    case "workflow":
    case "git":
    case "ssh":
    case "ship":
    case "hooks": {
      const { runAphrodyCommand } = await import("./aphrody");
      process.exitCode = await runAphrodyCommand(command, args.slice(1), rootDir());
      break;
    }

    case "host": {
      const { runHostCommand } = await import("./host");
      process.exitCode = await runHostCommand(args.slice(1), rootDir());
      break;
    }

    case "verify": {
      const { runVerifyCommand } = await import("./verify");
      process.exitCode = await runVerifyCommand(args.slice(1), rootDir());
      break;
    }

    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

if (import.meta.main) {
  // No top-level await: the entry then loads as CommonJS, which `bun build --compile --bytecode` needs. A rejection
  // still ends the process with the error printed and exit code 1, as before.
  void main();
}
