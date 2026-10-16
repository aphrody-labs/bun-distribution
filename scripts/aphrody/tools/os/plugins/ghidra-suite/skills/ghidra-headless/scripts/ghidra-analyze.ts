#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Ghidra headless analysis wrapper (Windows, Linux, macOS): imports one binary into a throwaway
 * project, runs the post-scripts, tees the launcher output into `<output>/ghidra_output.log` and
 * deletes the project unless `--keep-project`. No console window opens on Windows.
 *
 * Usage: bun ghidra-analyze.ts [options] <binary> [-- <extra analyzeHeadless arguments>]
 */
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { findAnalyzeHeadless, LAUNCHER } from "./find-ghidra.ts";

export const HELP = `Usage: bun ghidra-analyze.ts [options] <binary> [-- <analyzeHeadless arguments>]

Options:
  -o, --output <dir>              Output directory (default: current directory)
  -s, --script <name>             Post-analysis script (repeatable)
  -a, --script-args <args>        Arguments of the last --script (word-split)
  --script-path <path>            Additional script search path
  -p, --processor <id>            Processor (e.g. x86:LE:32:default, ARM:LE:32:v7)
  -c, --cspec <id>                Compiler spec (e.g. gcc, windows)
  --no-analysis                   Skip auto-analysis
  --timeout <seconds>             Analysis timeout per file
  --keep-project                  Keep the Ghidra project
  --project-dir <dir>             Project directory (default: the temporary directory)
  --project-name <name>           Project name (default: ghidra_<binary>_<pid>)
  --loader <name>                 Ghidra loader
  --library-search-path <path>    Library search path (repeatable)
  --max-cpu <n>                   Analysis CPU limit
  --max-memory <size>             JVM heap (MAXMEM, e.g. 4G)
  -v, --verbose                   Print the launcher command
  -h, --help                      Show this help

Built-in scripts (ghidra_scripts/ next to this file): ExportAll.java, ExportDecompiled.java,
ExportFunctions.java, ExportStrings.java, ExportCalls.java, ExportSymbols.java.`;

export interface AnalyzeOptions {
  binary: string;
  output: string;
  scripts: Array<{ name: string; args: string[] }>;
  scriptPath?: string;
  processor?: string;
  cspec?: string;
  noAnalysis: boolean;
  timeout?: number;
  keepProject: boolean;
  projectDir: string;
  projectName?: string;
  loader?: string;
  librarySearchPaths: string[];
  maxCpu?: number;
  maxMemory?: string;
  verbose: boolean;
  extra: string[];
  help: boolean;
}

const VALUE_FLAGS: Record<string, string> = {
  "-o": "output",
  "--output": "output",
  "-s": "script",
  "--script": "script",
  "-a": "script-args",
  "--script-args": "script-args",
  "--script-path": "script-path",
  "-p": "processor",
  "--processor": "processor",
  "-c": "cspec",
  "--cspec": "cspec",
  "--timeout": "timeout",
  "--project-dir": "project-dir",
  "--project-name": "project-name",
  "--loader": "loader",
  "--library-search-path": "library-search-path",
  "--max-cpu": "max-cpu",
  "--max-memory": "max-memory",
};

function positiveInteger(flag: string, value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0)
    throw new Error(`${flag} expects a positive integer`);
  return number;
}

export function parseArgs(argv: string[], cwd = process.cwd()): AnalyzeOptions {
  const options: AnalyzeOptions = {
    binary: "",
    output: cwd,
    scripts: [],
    noAnalysis: false,
    keepProject: false,
    projectDir: tmpdir(),
    librarySearchPaths: [],
    verbose: false,
    extra: [],
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === "--") {
      options.extra = argv.slice(index + 1);
      break;
    }
    const key = VALUE_FLAGS[arg];
    if (key) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} expects a value`);
      index += 1;
      switch (key) {
        case "output":
          options.output = value;
          break;
        case "script":
          options.scripts.push({ name: value, args: [] });
          break;
        case "script-args": {
          const last = options.scripts.at(-1);
          if (!last) throw new Error(`${arg} must follow --script`);
          last.args.push(...value.split(/\s+/).filter(Boolean));
          break;
        }
        case "script-path":
          options.scriptPath = value;
          break;
        case "processor":
          options.processor = value;
          break;
        case "cspec":
          options.cspec = value;
          break;
        case "timeout":
          options.timeout = positiveInteger(arg, value);
          break;
        case "project-dir":
          options.projectDir = value;
          break;
        case "project-name":
          options.projectName = value;
          break;
        case "loader":
          options.loader = value;
          break;
        case "library-search-path":
          options.librarySearchPaths.push(value);
          break;
        case "max-cpu":
          options.maxCpu = positiveInteger(arg, value);
          break;
        case "max-memory":
          options.maxMemory = value;
          break;
      }
      continue;
    }
    if (arg === "--no-analysis") options.noAnalysis = true;
    else if (arg === "--keep-project") options.keepProject = true;
    else if (arg === "-v" || arg === "--verbose") options.verbose = true;
    else if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (options.binary) throw new Error(`Only one binary is accepted (got ${arg})`);
    else options.binary = arg;
  }
  return options;
}

/** `ghidra_<stem with non-word characters as _>_<pid>`. */
export function defaultProjectName(binary: string, pid = process.pid): string {
  const stem = basename(binary, extname(binary)).replace(/[^A-Za-z0-9_]/g, "_");
  return `ghidra_${stem}_${pid}`;
}

/** The analyzeHeadless argument vector (after the launcher itself). */
export function launcherArgs(
  options: AnalyzeOptions,
  builtinScripts: string,
  logFile: string,
): string[] {
  const scriptPath = options.scriptPath
    ? `${builtinScripts};${options.scriptPath}`
    : builtinScripts;
  const args = [
    options.projectDir,
    options.projectName ?? defaultProjectName(options.binary),
    "-import",
    options.binary,
    "-scriptPath",
    scriptPath,
  ];
  for (const script of options.scripts) args.push("-postScript", script.name, ...script.args);
  if (options.processor) args.push("-processor", options.processor);
  if (options.cspec) args.push("-cspec", options.cspec);
  if (options.noAnalysis) args.push("-noanalysis");
  if (options.timeout) args.push("-analysisTimeoutPerFile", String(options.timeout));
  if (!options.keepProject) args.push("-deleteProject");
  if (options.loader) args.push("-loader", options.loader);
  if (options.librarySearchPaths.length > 0)
    args.push("-librarySearchPaths", options.librarySearchPaths.join(";"));
  if (options.maxCpu) args.push("-max-cpu", String(options.maxCpu));
  args.push("-log", logFile, ...options.extra);
  return args;
}

/** Quote one argument for `cmd.exe /s /c "..."` (a .bat launcher needs cmd on Windows). */
export function cmdQuote(arg: string): string {
  if (arg !== "" && !/[\s"&|<>^%!(),;=]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

async function pump(
  stream: ReadableStream<Uint8Array>,
  sink: NodeJS.WriteStream,
  log: Bun.FileSink,
) {
  for await (const chunk of stream) {
    sink.write(chunk);
    log.write(chunk);
  }
}

export async function analyze(options: AnalyzeOptions): Promise<number> {
  const launcher = findAnalyzeHeadless();
  if (!launcher)
    throw new Error(
      `Could not find Ghidra's ${LAUNCHER}; set GHIDRA_INSTALL_DIR to the Ghidra install root.`,
    );
  const ghidraHome = dirname(dirname(launcher));
  if (!existsSync(options.binary) || !statSync(options.binary).isFile())
    throw new Error(`Binary file not found: ${options.binary}`);
  const binary = resolve(options.binary);
  const output = resolve(options.output);
  mkdirSync(output, { recursive: true });
  const logFile = join(output, "ghidra_analysis.log");
  const args = launcherArgs(
    { ...options, binary },
    join(import.meta.dir, "ghidra_scripts"),
    logFile,
  );
  const env: Record<string, string | undefined> = {
    ...process.env,
    GHIDRA_HOME: ghidraHome,
    GHIDRA_OUTPUT_DIR: output,
  };
  if (options.maxMemory) env.MAXMEM = options.maxMemory;
  const argv = launcher.toLowerCase().endsWith(".bat")
    ? ["cmd.exe", "/d", "/s", "/c", `"${[launcher, ...args].map(cmdQuote).join(" ")}"`]
    : [launcher, ...args];
  if (options.verbose) console.error(`Running: ${[launcher, ...args].join(" ")}`);
  const child = Bun.spawn(argv, {
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
    windowsVerbatimArguments: argv[0] === "cmd.exe",
  });
  const log = Bun.file(join(output, "ghidra_output.log")).writer();
  await Promise.all([
    pump(child.stdout, process.stdout, log),
    pump(child.stderr, process.stderr, log),
  ]);
  await log.end();
  const code = await child.exited;
  if (code === 0) {
    console.log(`\nAnalysis complete. Output files in: ${output}`);
    for (const name of readdirSync(output).toSorted()) console.log(`  ${name}`);
  } else {
    console.error(`Analysis failed with exit code ${code}. See ${logFile}`);
  }
  return code;
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(HELP);
    } else if (!options.binary) {
      console.error(`Error: No binary file specified\n\n${HELP}`);
      process.exitCode = 1;
    } else {
      process.exitCode = await analyze(options);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
