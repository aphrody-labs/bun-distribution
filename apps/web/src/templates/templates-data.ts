// SPDX-License-Identifier: Apache-2.0

export interface TemplateFile {
  name: string;
  path: string;
  language: string;
  content: string;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  tagline: string;
  description: string;
  tags: string[];
  cliCommand: string;
  dependencies: Record<string, string>;
  files: TemplateFile[];
}

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: 'base',
    name: 'Bun Microservice Core',
    tagline: 'Production-ready Bun server with SQLite, SSE, supervised reload & standalone binary compilation',
    description: 'The foundation layer of the Aphrody stack. Features zero-copy I/O with Bun.serve, embedded SQLite, Server-Sent Events, supervised watch mode, and one-command standalone binary compilation via bun build --compile.',
    tags: ['Bun.serve', 'SQLite', 'SSE', 'TypeScript 7', 'Production'],
    cliCommand: 'bun create aphrody/base my-microservice',
    dependencies: {
      '@aphrody/runtime-sdk': 'workspace:*',
      '@types/bun': 'npm:@aphrody/bun-types@1.4.3-aphrody.1',
      'typescript': '7.0.2',
    },
    files: [
      {
        name: 'package.json',
        path: 'package.json',
        language: 'json',
        content: `{
  "name": "my-microservice",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run scripts/supervise.ts",
    "start": "bun run src/server.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "build:bin": "bun run scripts/build-bin.ts",
    "pack:deploy": "bun run scripts/pack-deploy.ts"
  },
  "dependencies": {
    "@aphrody/runtime-sdk": "^1.4.3"
  },
  "devDependencies": {
    "@types/bun": "npm:@aphrody/bun-types@1.4.3-aphrody.1",
    "typescript": "7.0.2"
  }
}`
      },
      {
        name: 'src/server.ts',
        path: 'src/server.ts',
        language: 'typescript',
        content: `// High-performance Bun native server
import { serve } from "bun";

const PORT = Number(Bun.env.PORT ?? 3000);

const server = serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, timestamp: Date.now() });
    }
    if (url.pathname === "/api/events") {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue("data: {\\\"status\\\":\\\"connected\\\"}\\n\\n");
        }
      }), {
        headers: { "Content-Type": "text/event-stream" }
      });
    }
    return new Response("Aphrody Base Microservice running on Bun!", { status: 200 });
  }
});

console.log(\`Server listening at \${server.url}\`);`
      },
      {
        name: 'scripts/build-bin.ts',
        path: 'scripts/build-bin.ts',
        language: 'typescript',
        content: `// Standalone binary compilation via Bun.build
const result = await Bun.build({
  entrypoints: ["./src/server.ts"],
  outdir: "./dist",
  target: "bun",
  naming: "app-[name]",
  minify: true,
  sourcemap: "external"
});

if (!result.success) {
  console.error("Build failed:", result.logs);
  process.exit(1);
}
console.log("Compiled standalone distribution in ./dist");`
      }
    ]
  },
  {
    id: 'desktop',
    name: 'Tauri 3 Desktop Shell',
    tagline: 'Lowest-level native Tauri desktop application embedding Bun and Aphrody crates',
    description: 'High-performance desktop architecture uniting Rust native capabilities with our ultra-fast web UI. Features custom zero-copy IPC, window state management, and optimized native linking via rust-lld.',
    tags: ['Tauri 3', 'Rust', 'Native IPC', 'Cross-Platform', 'Desktop'],
    cliCommand: 'bun create aphrody/desktop my-desktop-app',
    dependencies: {
      'tauri': '3.0.0-alpha',
      'serde': '1.0',
      'serde_json': '1.0',
    },
    files: [
      {
        name: 'Cargo.toml',
        path: 'src-tauri/Cargo.toml',
        language: 'toml',
        content: `[package]
name = "my-desktop-app"
version = "0.1.0"
edition = "2024"
rust-version = "1.95"

[lib]
name = "my_desktop_app_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[dependencies]
tauri = { package = "aphrody-tauri", version = "3.0.0-alpha" }
tauri-plugin-opener = { package = "aphrody-tauri-plugin-opener", version = "3.0.0-alpha" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[profile.release]
codegen-units = 1
lto = "thin"
opt-level = "s"
strip = true`
      },
      {
        name: 'src/main.rs',
        path: 'src-tauri/src/main.rs',
        language: 'rust',
        content: `// Lowest-level Tauri desktop runner
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![ping_host, get_system_stats])
        .run(tauri::generate_context!())
        .expect("error while running aphrody desktop application");
}

#[tauri::command]
fn ping_host() -> &'static str {
    "aphrody-desktop-pong"
}

#[tauri::command]
fn get_system_stats() -> serde_json::Value {
    serde_json::json!({
        "engine": "aphrody-tauri",
        "abi_version": 1.4,
        "mode": "lowest-level-ipc"
    })
}`
      },
      {
        name: 'tauri.conf.json',
        path: 'src-tauri/tauri.conf.json',
        language: 'json',
        content: `{
  "$schema": "https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-config-schema/schema.json",
  "productName": "Aphrody Desktop",
  "version": "0.1.0",
  "identifier": "com.aphrody.desktop",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:3000"
  },
  "app": {
    "windows": [
      {
        "title": "Aphrody Desktop",
        "width": 1280,
        "height": 800,
        "resizable": true,
        "fullscreen": false
      }
    ]
  }
}`
      }
    ]
  },
  {
    id: 'elysia',
    name: 'Elysia API Framework',
    tagline: 'Type-safe, ergonomics-focused web framework designed exclusively for Bun',
    description: 'Ultra-fast REST & WebSocket API server powered by Elysia on Bun. Offers end-to-end type safety with TypeBox/Sinclair, lightning-fast regex routing, and zero overhead.',
    tags: ['Elysia', 'TypeBox', 'Bun Native', 'REST', 'WebSocket'],
    cliCommand: 'bun create aphrody/elysia my-elysia-api',
    dependencies: {
      'elysia': '^1.4.30',
      '@types/bun': 'npm:@aphrody/bun-types@1.4.3-aphrody.1',
    },
    files: [
      {
        name: 'src/index.ts',
        path: 'src/index.ts',
        language: 'typescript',
        content: `import { Elysia, t } from "elysia";

export const app = new Elysia()
  .get("/health", () => ({ status: "healthy", timestamp: Date.now() }))
  .get("/api/v1/users/:id", ({ params: { id } }) => ({
    id,
    name: "Aphrody User",
    runtime: "Bun " + Bun.version
  }), {
    params: t.Object({
      id: t.String()
    })
  })
  .post("/api/v1/hash", async ({ body }) => {
    const hash = await Bun.password.hash(body.password, { algorithm: "argon2id" });
    return { hash };
  }, {
    body: t.Object({
      password: t.String()
    })
  })
  .listen(Number(Bun.env.PORT ?? 3002));

console.log(\`Elysia server running on \${app.server?.url}\`);`
      }
    ]
  },
  {
    id: 'hono',
    name: 'Hono Micro-Framework',
    tagline: 'Lightweight, ultra-fast web framework with standard Web Standards Request/Response',
    description: 'Hono configured for Bun. Uses Bun.serve under the hood with direct support for Web Standard Request and Response objects, zero polyfill overhead, and middleware support.',
    tags: ['Hono', 'Web Standards', 'Micro-Framework', 'Zero-Copy'],
    cliCommand: 'bun create aphrody/hono my-hono-app',
    dependencies: {
      'hono': '^4.13.12',
      '@types/bun': 'npm:@aphrody/bun-types@1.4.3-aphrody.1',
    },
    files: [
      {
        name: 'src/index.ts',
        path: 'src/index.ts',
        language: 'typescript',
        content: `import { Hono } from "hono";

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, runtime: "Bun " + Bun.version }));
app.get("/api/stats", (c) => {
  return c.json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    nanoseconds: Bun.nanoseconds()
  });
});

const server = Bun.serve({
  port: Number(Bun.env.PORT ?? 3001),
  fetch: app.fetch
});

console.log(\`Hono server listening on \${server.url}\`);`
      }
    ]
  },
  {
    id: 'react',
    name: 'React 19 + Material 3 Client',
    tagline: 'Modern React 19 SPA with full Material Design 3 tokens, dynamic theming & Bun fast bundling',
    description: 'Complete frontend application template using React 19, Material 3 dynamic color generation, and Tailwind v4. Bundles with Bun.build in less than 100ms.',
    tags: ['React 19', 'Material 3', 'Tailwind v4', 'Dynamic Color', 'SPA'],
    cliCommand: 'bun create aphrody/react my-m3-app',
    dependencies: {
      'react': '^19.3.0',
      'react-dom': '^19.3.0',
      '@aphrody/material-web': '3.3.3',
      '@base-ui/react': '^1.8.0',
      'tailwindcss': '^4.3.3',
    },
    files: [
      {
        name: 'src/App.tsx',
        path: 'src/App.tsx',
        language: 'typescript',
        content: `import React, { useState } from "react";

export function App() {
  const [count, setCount] = useState(0);

  return (
    <main className="min-h-screen bg-[var(--md-sys-color-background)] text-[var(--md-sys-color-on-background)] p-8">
      <header className="max-w-xl mx-auto text-center space-y-4">
        <h1 className="text-4xl font-black text-[var(--md-sys-color-primary)]">Material 3 on Bun</h1>
        <p className="text-[var(--md-sys-color-on-surface-variant)]">
          Fast-built in 92ms with native Bun.build and Tailwind v4 Oxide engine.
        </p>
        <button
          onClick={() => setCount(c => c + 1)}
          className="px-6 py-3 rounded-full bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] font-bold shadow-md hover:shadow-lg transition-transform active:scale-95"
        >
          Count: {count}
        </button>
      </header>
    </main>
  );
}`
      }
    ]
  },
  {
    id: 'stack',
    name: 'Unified Aphrody Stack',
    tagline: 'Unified architectural manifest specifying every layer from host to tooling',
    description: 'The master architecture specification file (stack.toml) describing all layers: host, native C ABI runtime, TypeScript SDK, server, web, desktop Tauri, and oxlint/oxfmt tooling.',
    tags: ['stack.toml', 'Architecture', 'Monorepo', 'Standards'],
    cliCommand: 'aphrody stack status',
    dependencies: {},
    files: [
      {
        name: 'stack.toml',
        path: 'stack.toml',
        language: 'toml',
        content: `[meta]
name = "aphrody-stack"
bun = "1.4.3-aphrody.2"
typescript = "7.0.2"
oxlint = "1.86.0"
oxfmt = "0.71.0"
tauri = "3.0.0-alpha"
runtime_abi = "1.4"

[layer.host]
provider = "Bun fork (aphrody-labs/bun)"
status = "implemented"

[layer.runtime]
provider = "crates/engine/yolo-runtime (C ABI, precompiled)"
status = "implemented"

[layer.sdk]
provider = "packages/engine/runtime (@aphrody/runtime-sdk, bun:ffi)"
status = "implemented"

[layer.desktop]
provider = "Tauri 3 through crates/tauri/aphrody-tauri"
status = "implemented"`
      }
    ]
  }
];
