#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Unified Aphrody CLI — Combining Rust Native Engine and Bun Runtime
 *
 * Single Monorepo CLI Rule:
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

async function main() {
  // 1. Web & Server orchestration
  if (command === 'web' || command === 'serve') {
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

  // 2. Build command
  if (command === 'build') {
    console.log('⚡ Running Aphrody Fast Build Pipeline...');
    const proc = Bun.spawn(['bun', 'run', join(rootDir, 'apps/web/build.ts')], {
      cwd: rootDir,
      stdio: ['inherit', 'inherit', 'inherit'],
    });
    process.exitCode = await proc.exited;
    return;
  }

  // 3. MCP Server
  if (command === 'mcp') {
    console.log('🔌 Starting Aphrody Unified Model Context Protocol (MCP) Server...');
    const mcpTsPath = join(rootDir, 'm3/packages/m3-mcp/src/server.ts');
    if (existsSync(mcpTsPath)) {
      const proc = Bun.spawn(['bun', 'run', mcpTsPath, ...subArgs], {
        cwd: rootDir,
        stdio: ['inherit', 'inherit', 'inherit'],
      });
      process.exitCode = await proc.exited;
      return;
    }
  }

  // 4. Benchmarks
  if (command === 'bench') {
    console.log('📊 Running Aphrody Benchmark Suite (Rust + Bun)...');
    try {
      const proc = Bun.spawn(['bun', 'test', join(rootDir, 'apps/web/src/arcade/engine.test.ts')], {
        cwd: rootDir,
        stdio: ['inherit', 'inherit', 'inherit'],
      });
      await proc.exited;
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

  // 5. Native Rust commands delegation
  const rustCommands = new Set([
    'rag', 'index', 'infer', 'jobs', 'forensics', 'gateway', 'discord', 'doc', 'doctor'
  ]);

  if (rustCommands.has(command)) {
    const aphrodyBin = process.env.APHRODY_BIN || Bun.which('aphrody') || null;
    if (aphrodyBin) {
      const proc = Bun.spawn([aphrodyBin, command, ...subArgs], {
        cwd: rootDir,
        stdio: ['inherit', 'inherit', 'inherit'],
      });
      process.exitCode = await proc.exited;
      return;
    }
  }

  // 6. Monorepo Engine delegation (yolo/aphrody core commands: scan, verify, create, host, vu, etc.)
  const yoloEntry = join(rootDir, 'packages/engine/yolo/src/index.ts');
  if (existsSync(yoloEntry) && command) {
    const proc = Bun.spawn(['bun', 'run', yoloEntry, command, ...subArgs], {
      cwd: rootDir,
      stdio: ['inherit', 'inherit', 'inherit'],
    });
    process.exitCode = await proc.exited;
    return;
  }

  // 7. Help & Status Banner
  console.log(`
🌸 APHRODY UNIFIED CLI — Version 3.3.8
Strict Monorepo Rule: 1 App • 1 CLI • 1 FFI • 1 Server • 1 MCP

Usage:
  aphrody <command> [options]

Core Commands:
  web [build]          Launch or build the Aphrody WebOS In-Browser Operating System
  build                Compile the entire web application and UI bundle with Bun.build
  mcp                  Start the Model Context Protocol (MCP) server
  bench                Execute live performance benchmarks across Rust and Bun
  scan                 Scan monorepo packages, types, and dependencies
  verify               Verify integrity of all crates, packages, and ABI boundaries
  create <template>    Scaffold a new project from Aphrody templates (base, desktop, elysia, hono, react)
  doctor               Diagnose environment, Rust toolchains, linkers, and Bun runtime

Native Rust Subsystems:
  rag                  Vector retrieval and semantic memory
  infer                Native ONNX/CUDA inference execution
  gateway              Multi-model proxy and token routing
  discord              Headless Discord interaction bot and compiler

Examples:
  aphrody web          # Starts WebOS at http://localhost:3000
  aphrody web build    # Compiles client distribution with Tailwind v4 in ~90ms
  aphrody mcp          # Starts unified MCP stdio server
  aphrody bench        # Runs SIMD and compilation speedup audits
`);
}

main().catch(err => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
