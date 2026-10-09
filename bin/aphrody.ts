#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Unified Aphrody CLI — Combining Rust Native Engine and Bun Runtime
 *
 * Monorepo Unified Architecture:
 * - 1 App: apps/web (In-Browser OS, Web, Tauri Desktop, Mobile)
 * - 1 CLI: aphrody (Rust + Bun unified command orchestration)
 * - 1 FFI: aphrody_ffi (C ABI cdylib loaded via @aphrody/runtime-sdk)
 * - 1 Server: Bun.serve (HTTP, SSE, WebSockets, HTMLRewriter) + Rust Backend
 * - 1 MCP: Unified MCP Server across AI and OS layers
 */

import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const rootDir = resolve(import.meta.dir, '..');
const args = process.argv.slice(2);
const command = args[0]?.toLowerCase() || '';
const subArgs = args.slice(1);

/**
 * Checks whether a candidate binary path refers to this wrapper script
 * or any repository CLI launcher, preventing recursive invocation.
 */
function isSelfScript(candidate: string, root: string): boolean {
  if (!candidate) return true;
  const normCandidate = resolve(candidate).toLowerCase().replaceAll('\\', '/');
  const binDir = resolve(root, 'bin').toLowerCase().replaceAll('\\', '/');
  return normCandidate.startsWith(binDir) || normCandidate.endsWith('.ts');
}

/**
 * Resolves the native Rust aphrody executable without self-referential loops.
 */
function resolveRustAphrody(root: string): string | null {
  // 1. Explicit environment variable override
  const envBin = process.env.APHRODY_BIN;
  if (envBin && !isSelfScript(envBin, root) && existsSync(envBin)) {
    return envBin;
  }

  // 2. Cargo target directories in the repository
  const exeExt = process.platform === 'win32' ? '.exe' : '';
  const localRelease = join(root, `target/release/aphrody${exeExt}`);
  if (existsSync(localRelease)) return localRelease;

  const localDebug = join(root, `target/debug/aphrody${exeExt}`);
  if (existsSync(localDebug)) return localDebug;

  // 3. System PATH via Bun.which (filtering out this script and repository wrappers)
  const whichBin = Bun.which('aphrody');
  if (whichBin && !isSelfScript(whichBin, root) && existsSync(whichBin)) {
    return whichBin;
  }

  // 4. User local installation
  const homeBin = process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || '', 'Aphrody/bin/aphrody.exe')
    : join(process.env.HOME || '', '.aphrody/bin/aphrody');
  if (existsSync(homeBin)) return homeBin;

  return null;
}

/**
 * Commands natively implemented in the YOLO Bun engine (packages/engine/yolo).
 */
const YOLO_COMMANDS = new Set([
  'status',
  'n2b',
  'generate',
  'parse',
  'desktop',
  'tauri',
  'ai',
  'tool',
  'api',
  'desktop-runtime',
  'runtime',
  'upgrade',
  'uninstall',
  'create',
  'awesome',
  'import',
  'rename',
  'plugin',
  'vu',
  'py',
  'python',
  'uv',
  'ship',
  'hooks',
  'ops',
  'workspace',
  'optimize',
  'update',
  'google',
  'doc-ai',
  'browser',
  'forge',
  'm3',
  'host',
  'verify',
]);

async function main() {
  // 1. WebOS in-browser operating system (explicitly 'webos')
  if (command === 'webos') {
    const sub = subArgs[0]?.toLowerCase();
    if (sub === 'build') {
      console.log('🌸 Building Aphrody WebOS with Bun.build...');
      const proc = Bun.spawn(['bun', 'run', join(rootDir, 'apps/web/build.ts')], {
        cwd: rootDir,
        stdio: ['inherit', 'inherit', 'inherit'],
      });
      process.exitCode = await proc.exited;
      return;
    }

    const port = process.env.PORT || '3000';
    console.log(`🌸 Launching Aphrody WebOS on http://localhost:${port}...`);
    const proc = Bun.spawn(['bun', 'run', join(rootDir, 'apps/web/server.ts')], {
      cwd: rootDir,
      env: { ...process.env, PORT: port },
      stdio: ['inherit', 'inherit', 'inherit'],
    });
    process.exitCode = await proc.exited;
    return;
  }

  // 2. Fast MCP Server path
  if (command === 'mcp' && subArgs.length === 0) {
    const mcpFastPath = join(rootDir, 'packages/engine/yolo/src/mcp.ts');
    if (existsSync(mcpFastPath)) {
      const proc = Bun.spawn(['bun', 'run', mcpFastPath], {
        cwd: rootDir,
        stdio: ['inherit', 'inherit', 'inherit'],
      });
      process.exitCode = await proc.exited;
      return;
    }
  }

  // 3. Benchmarks (Bun microbenchmarks + engine bench)
  if (command === 'bench') {
    console.log('📊 Running Aphrody Benchmark Suite (Rust + Bun)...');
    try {
      const arcadeBench = Bun.spawn(['bun', 'test', join(rootDir, 'apps/web/src/arcade/engine.test.ts')], {
        cwd: rootDir,
        stdio: ['inherit', 'inherit', 'inherit'],
      });
      await arcadeBench.exited;
    } catch {}

    const yoloEntry = join(rootDir, 'packages/engine/yolo/src/index.ts');
    if (existsSync(yoloEntry)) {
      const proc = Bun.spawn(['bun', 'run', yoloEntry, 'bench', ...subArgs], {
        cwd: rootDir,
        stdio: ['inherit', 'inherit', 'inherit'],
      });
      process.exitCode = await proc.exited;
      return;
    }
  }

  // 4. YOLO Monorepo Engine commands
  if (YOLO_COMMANDS.has(command)) {
    const yoloEntry = join(rootDir, 'packages/engine/yolo/src/index.ts');
    if (existsSync(yoloEntry)) {
      const proc = Bun.spawn(['bun', 'run', yoloEntry, command, ...subArgs], {
        cwd: rootDir,
        stdio: ['inherit', 'inherit', 'inherit'],
      });
      process.exitCode = await proc.exited;
      return;
    }
  }

  // 5. Native Rust binary delegation (DEFAULT FALLBACK for all commands unknown to YOLO)
  const rustBin = resolveRustAphrody(rootDir);
  if (rustBin && command) {
    const proc = Bun.spawn([rustBin, ...args], {
      cwd: rootDir,
      stdio: ['inherit', 'inherit', 'inherit'],
    });
    process.exitCode = await proc.exited;
    return;
  }

  // If no native binary is found and a command was specified:
  if (command) {
    console.error(`Error: Native Rust binary 'aphrody' not found for command '${command}'.`);
    console.error(`Build with: cargo build --release -p aphrody`);
    process.exitCode = 1;
    return;
  }

  // 6. Help Banner
  console.log(`
🌸 APHRODY UNIFIED CLI — Rust Native Engine + Bun Runtime
Strict Monorepo Rule: 1 App • 1 CLI • 1 FFI • 1 Server • 1 MCP

Usage:
  aphrody <command> [options]

WebOS & Bun Services:
  webos [build]        Launch or build the Aphrody WebOS In-Browser Operating System
  mcp                  Start the Model Context Protocol (MCP) server
  bench                Execute performance benchmarks across Rust and Bun

Engine & Monorepo Commands (YOLO):
  status               Inspect active package forks & Cargo workspace status
  verify               Verify integrity of crates, packages, and ABI boundaries
  n2b                  Automated Node-to-Bun migration tool
  create <template>    Scaffold a new project from Aphrody templates
  m3 <cmd>             Material Design 3 framework toolchain
  import / rename      Vendor management and mass symbol refactoring

Native Rust Engine (Default Fallback):
  web <cmd>            Canonical Web engine: Obscura crawling, scraping, SERP
  scan                 Multi-threaded repository scanner
  git / ssh / infra    Infrastructure and repository control plane
  rag / infer          Vector retrieval, memory, and native neural inference
  gateway              OpenAI-compatible AI proxy gateway
  discord              Headless Discord interaction bot and compiler
  doctor               Diagnose environment, Rust toolchains, linkers, and Bun runtime
`);
}

main().catch(err => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
