// SPDX-License-Identifier: Apache-2.0
/**
 * Server-side catalog of the monorepo: workspace packages read from the root
 * package.json globs, and exported TypeScript declarations counted in their
 * `src/` trees and package roots. Also carries a short reference list of the
 * Bun APIs the apps/web server calls.
 */
import { join, relative } from 'node:path';
import type { BunApiEntry, CodebaseAnalysis, MonorepoPackageInfo } from './types';

export const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');

const BUN_APIS: BunApiEntry[] = [
  {
    id: 'bun-serve',
    name: 'Bun.serve',
    category: 'runtime',
    signature: 'Bun.serve(options: ServeOptions): Server',
    description: 'HTTP and WebSocket server. apps/web/server.ts is built on it.',
    example: 'Bun.serve({ port: 0, fetch(req) { return new Response("Hello Bun!"); } });',
    isWebStandard: false,
  },
  {
    id: 'bun-build',
    name: 'Bun.build',
    category: 'bundler',
    signature: 'Bun.build(options: BuildConfig): Promise<BuildOutput>',
    description: 'JavaScript/TypeScript/CSS bundler with plugins. apps/web/build.ts bundles the UI with it.',
    example: 'await Bun.build({ entrypoints: ["./src/index.ts"], outdir: "./dist", minify: true });',
    isWebStandard: false,
  },
  {
    id: 'web-crypto-subtle',
    name: 'crypto.subtle',
    category: 'crypto',
    signature: 'crypto.subtle.digest(algorithm, data): Promise<ArrayBuffer>',
    description: 'Web Crypto API (digest, HMAC, AES, RSA, ECDSA).',
    example: 'const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("data"));',
    isWebStandard: true,
  },
  {
    id: 'web-html-rewriter',
    name: 'HTMLRewriter',
    category: 'web-standards',
    signature: 'new HTMLRewriter().on(selector, handlers).transform(response)',
    description: 'Streaming HTML rewriter (lol-html), compatible with the Cloudflare Workers API.',
    example: 'new HTMLRewriter().on("title", { text(t) { t.replace("New Title"); } }).transform(res);',
    isWebStandard: false,
  },
  {
    id: 'web-readable-stream',
    name: 'ReadableStream & TransformStream',
    category: 'streams',
    signature: 'new ReadableStream(underlyingSource, strategy)',
    description: 'WHATWG Streams API.',
    example: 'const stream = new ReadableStream({ start(c) { c.enqueue("chunk"); c.close(); } });',
    isWebStandard: true,
  },
  {
    id: 'bun-transpiler',
    name: 'Bun.Transpiler',
    category: 'runtime',
    signature: 'new Bun.Transpiler(options: TranspilerOptions): Transpiler',
    description: 'Transpiles TypeScript, TSX and JSX to JavaScript with the Bun parser.',
    example: 'const js = new Bun.Transpiler({ loader: "tsx" }).transformSync("<div>Hello</div>");',
    isWebStandard: false,
  },
  {
    id: 'bun-password',
    name: 'Bun.password',
    category: 'crypto',
    signature: 'Bun.password.hash(password, options): Promise<string>',
    description: 'Password hashing with argon2id, argon2i, argon2d or bcrypt.',
    example: 'const hash = await Bun.password.hash("secret", { algorithm: "argon2id" });',
    isWebStandard: false,
  },
  {
    id: 'bun-deflate',
    name: 'Bun.deflateSync & Bun.gzipSync',
    category: 'io',
    signature: 'Bun.deflateSync(data: BufferSource, options?): Uint8Array',
    description: 'Synchronous DEFLATE and gzip compression (zlib by default, libdeflate on request).',
    example: 'const compressed = Bun.deflateSync(new TextEncoder().encode("lots of data"));',
    isWebStandard: false,
  },
  {
    id: 'bun-ffi',
    name: 'bun:ffi',
    category: 'ffi',
    signature: 'dlopen(path: string, symbols: Record<string, FFIFunction>): Library',
    description: 'Calls C ABI functions of a shared library. @aphrody/runtime-sdk loads the yolo_* runtime through it.',
    example: 'import { dlopen, FFIType, suffix } from "bun:ffi"; const lib = dlopen(`libsqlite3.${suffix}`, { sqlite3_libversion: { args: [], returns: FFIType.cstring } });',
    isWebStandard: false,
  },
  {
    id: 'bun-file',
    name: 'Bun.file & Bun.write',
    category: 'io',
    signature: 'Bun.file(path: string): BunFile; Bun.write(dest, data): Promise<number>',
    description: 'Lazy file handles and file writes.',
    example: 'await Bun.write("output.txt", "data"); const text = await Bun.file("output.txt").text();',
    isWebStandard: false,
  },
  {
    id: 'bun-glob',
    name: 'Bun.Glob',
    category: 'io',
    signature: 'new Bun.Glob(pattern: string): Glob',
    description: 'Glob matching and directory scanning. This scanner lists the workspace with it.',
    example: 'for await (const file of new Bun.Glob("**/*.ts").scan()) { console.log(file); }',
    isWebStandard: false,
  },
  {
    id: 'bun-spawn',
    name: 'Bun.spawn',
    category: 'runtime',
    signature: 'Bun.spawn(command: string[], options?): Subprocess',
    description: 'Starts a subprocess without a shell.',
    example: 'const proc = Bun.spawn(["git", "status"], { stdout: "pipe" }); const out = await proc.stdout.text();',
    isWebStandard: false,
  },
];

const EXPORTED_TYPE = /^export\s+(?:declare\s+)?type\s+[A-Za-z_$]/gm;
const EXPORTED_INTERFACE = /^export\s+(?:declare\s+)?interface\s+[A-Za-z_$]/gm;
const EXPORTED_FUNCTION = /^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*[A-Za-z_$]/gm;
const SOURCE_PATTERNS = ['src/**/*.{ts,tsx}', '*.{ts,tsx}'];

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

async function workspaceGlobs(root: string): Promise<string[]> {
  const manifest = await Bun.file(join(root, 'package.json')).json();
  const workspaces = manifest.workspaces;
  const patterns: unknown = Array.isArray(workspaces) ? workspaces : workspaces?.packages;
  return Array.isArray(patterns) ? patterns.filter((p): p is string => typeof p === 'string') : [];
}

/** Scans the workspace rooted at `root` (the monorepo by default). */
export async function scanCodebase(root: string = REPO_ROOT): Promise<CodebaseAnalysis> {
  const packages: MonorepoPackageInfo[] = [];
  const seen = new Set<string>();
  let totalTypes = 0;
  let totalInterfaces = 0;
  let totalFunctions = 0;

  for (const pattern of await workspaceGlobs(root)) {
    const glob = new Bun.Glob(`${pattern.replace(/\/+$/, '')}/package.json`);
    for await (const manifestPath of glob.scan({ cwd: root, onlyFiles: true })) {
      if (manifestPath.includes('node_modules')) continue;
      const dir = join(root, manifestPath, '..');
      const rel = relative(root, dir).replaceAll('\\', '/');
      if (seen.has(rel)) continue;
      seen.add(rel);

      let manifest: { name?: string; version?: string; description?: string };
      try {
        manifest = await Bun.file(join(root, manifestPath)).json();
      } catch {
        continue;
      }

      let sourceFiles = 0;
      const files = new Set<string>();
      for (const sourcePattern of SOURCE_PATTERNS) {
        for await (const file of new Bun.Glob(sourcePattern).scan({ cwd: dir, onlyFiles: true })) {
          if (file.includes('node_modules') || file.endsWith('.d.ts')) continue;
          files.add(file);
        }
      }
      for (const file of files) {
        const text = await Bun.file(join(dir, file)).text();
        sourceFiles += 1;
        totalTypes += countMatches(text, EXPORTED_TYPE);
        totalInterfaces += countMatches(text, EXPORTED_INTERFACE);
        totalFunctions += countMatches(text, EXPORTED_FUNCTION);
      }

      packages.push({
        name: manifest.name ?? rel,
        version: manifest.version ?? '',
        description: manifest.description ?? '',
        dir: rel,
        sourceFiles,
      });
    }
  }

  packages.sort((a, b) => a.dir.localeCompare(b.dir));
  return {
    scannedAt: new Date().toISOString(),
    totalTypes,
    totalInterfaces,
    totalFunctions,
    totalPackages: packages.length,
    bunApis: BUN_APIS,
    packages,
  };
}

let cached: Promise<CodebaseAnalysis> | undefined;

/** Monorepo scan, computed once per server process. */
export function analyzeCodebase(): Promise<CodebaseAnalysis> {
  cached ??= scanCodebase().catch(error => {
    cached = undefined;
    throw error;
  });
  return cached;
}
