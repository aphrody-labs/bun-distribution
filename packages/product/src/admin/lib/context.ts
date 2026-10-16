// SPDX-License-Identifier: Apache-2.0
import { dirname } from "node:path";

import pkg from "../../../package.json";
import { createLogger, type Logger } from "./log.ts";
import { probeMcp, type McpProbe, type McpSpec } from "./mcp.ts";
import { kitPaths, type KitPaths } from "./paths.ts";
import { realSystem, type System } from "./system.ts";
import { consoleUi, type Ui } from "./ui.ts";

export const VERSION: string = pkg.version;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface Context {
  sys: System;
  ui: Ui;
  paths: KitPaths;
  log: Logger;
  version: string;
  /** The running executable (the compiled exe, or `bun` when run from sources). */
  exePath: string;
  /** Where the access pack may lie next to the exe. */
  exeDir: string;
  fetchImpl: Fetch;
  /** Starts the MCP server like a client does; replaced in tests. */
  mcpProbe: (spec: McpSpec) => Promise<McpProbe>;
}

export function defaultContext(): Context {
  const sys = realSystem();
  const paths = kitPaths(sys.env);
  return {
    sys,
    ui: consoleUi(),
    paths,
    log: createLogger(paths.logFile),
    version: VERSION,
    exePath: process.execPath,
    exeDir: dirname(process.execPath),
    fetchImpl: fetch,
    mcpProbe: probeMcp,
  };
}
