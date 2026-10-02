---
name: n2b
description: "Migrate a Node.js codebase to Bun with n2b: API mappings, Bun Shell, shebangs, package config."
version: "1.2.0"
---

<!-- SPDX-License-Identifier: Apache-2.0 -->

# n2b — Node to Bun Migration & Scaffolding Tool

The `n2b` skill provides comprehensive rules, syntax mappings, and automation commands to migrate JavaScript/TypeScript codebases from Node.js to Bun. It also details the usage of the native `n2b` tool.

---

## 1. Mappings: Node.js to Bun Native APIs

The single source of the Node-to-Bun mappings is the Rust rule registry
`crates/compat/n2b-registry/registry/{apis,modules,packages,cli,globals}.toml`
(for example `api/fs-readFileSync` -> `Bun.file(path).text()`, `api/child-process-spawn`
-> `Bun.spawn`, `api/http-createServer` -> `Bun.serve`, `api/execSync` -> Bun Shell). Do not
copy the tables here; query them:

* `aphrody n2b rules --report json`: every rule with id, message, severity and docs citation.
* MCP tool `bun_node_equivalent` (crate `bun-docs`, reads the same registry): the Bun equivalent
  of one Node API, module or package.
* `bun_docs_search` / `bun_docs_read`: the canonical Bun docs (`docs/<category>/upstream-bun/`).

Bun loads `.env` files automatically (`process.env` / `Bun.env`), so `dotenv` is unnecessary.

---

## 2. Codebase Conventions & Quality Rules

To maintain the project's strict `feedback_bun_only` standard:
1. **Require vs Import:** Do not use CommonJS `require()` of node built-ins. Always use ES module `import` syntax.
2. **Built-in imports:** Use `node:` prefixes for Node compatibility imports (e.g., `import fs from "node:fs"` instead of `import fs from "fs"`).
3. **Shebangs:** Replace `#!/usr/bin/env node` with `#!/usr/bin/env bun` in executable scripts.
4. **Current Directory:** Replace `__dirname` and `__filename` with `import.meta.dir` / `import.meta.path` or use the shim helper:
   ```ts
   import { dirOf } from "@aphrody/n2b-core/shims/path";
   const __dirname = dirOf(import.meta);
   ```
5. **Engines declaration:** Set `"engines": { "bun": ">=1.4.2" }` in `package.json` (the Aphrody floor) to enforce Bun at install-time.

---

## 3. n2b CLI Usage Reference

The `n2b` tool can be invoked through `aphrody n2b [args...]` or directly using the local `n2b` binary.

### Scan and Audit
* **Scan for Node-specific patterns:**
  ```bash
  aphrody n2b .
  ```
* **List all active migration rules:**
  ```bash
  aphrody n2b rules
  ```
* **Scan GitHub issues/PRs for Node-to-Bun transition issues:**
  ```bash
  aphrody n2b audit
  ```

### Migration & Auto-Fixing
* **Apply safe automatic refactorings (no side-effects):**
  ```bash
  aphrody n2b . --fix
  ```
* **Apply aggressive corrections (more invasive code changes):**
  ```bash
  aphrody n2b . --aggressive
  ```
* **Full migration (autofix + locks deletion + workspace config + bun install):**
  ```bash
  aphrody n2b . --migrate
  ```

### Project Scaffolding
* **Scaffold a standard Bun app (CLI, TUI, GUI, standalone):**
  ```bash
  aphrody n2b app
  ```
* **Scaffold a Bun + Win32 integration project (with Rust FFI or inline C):**
  ```bash
  aphrody n2b win32
  ```
* **Scaffold a Bun + Linux systems project:**
  ```bash
  aphrody n2b linux
  ```
* **Scaffold a Rust -> WASM -> Bun pipeline:**
  ```bash
  aphrody n2b wasm
  ```

### Auxiliary Commands
* **Create/apply patches to node_modules:**
  ```bash
  aphrody n2b patch <package_name>
  ```
* **Generate `llms.txt` and `llms-full.txt` from a site/URL:**
  ```bash
  aphrody n2b llmstxt <url>
  ```
