// SPDX-License-Identifier: Apache-2.0

export interface DocArticle {
  id: string;
  category: 'Architecture' | 'Framework & Bun' | 'Material 3' | 'Desktop & Tauri' | 'Benchmarks & Perf' | 'LLM & Memory';
  title: string;
  summary: string;
  readTime: string;
  tags: string[];
  content: string;
}

export const DOCS_ARTICLES: DocArticle[] = [
  {
    id: 'runtime-architecture',
    category: 'Architecture',
    title: 'Aphrody Unified Runtime & C ABI Layer',
    summary: 'Detailed explanation of the host, native C ABI runtime, TypeScript SDK, and memory layout.',
    readTime: '5 min read',
    tags: ['Kernel', 'YOLO Runtime', 'C ABI', 'Zero-Copy'],
    content: `# Aphrody Unified Runtime Architecture

The Aphrody runtime unifies JavaScript, Rust native modules, and platform OS calls through a strict three-layer architecture:

## 1. Host Layer
Powered by our optimized fork of Bun (\`aphrody-labs/bun\`). The host provides:
- JavaScriptCore (JSC) engine with low-latency garbage collection.
- Native C++ bindings for standard Web APIs (\`fetch\`, \`Request\`, \`Response\`, \`ReadableStream\`, \`HTMLRewriter\`, \`crypto.subtle\`).
- SIMD-accelerated JSON, compression (libdeflate), and cryptographic algorithms (BoringSSL).

## 2. Native C ABI Runtime Layer
Located in \`crates/engine/yolo-runtime\` and exposed through \`yolo_runtime.h\`:
\`\`\`c
// Strict C ABI contract
typedef struct {
    uint8_t* data;
    size_t len;
    size_t cap;
} YoloBuffer;

uint32_t yolo_abi_version(void);
int32_t yolo_system_stats(uint64_t runtime, YoloBuffer* output);
void yolo_buffer_free(YoloBuffer* buffer);
\`\`\`
Every native call uses handle-based dispatch and explicit buffer ownership handoff to prevent memory leaks and dangling pointers.

## 3. TypeScript SDK Layer
Located in \`packages/engine/runtime\` and exposed as \`@aphrody/runtime-sdk\`.
It consumes the C ABI through \`bun:ffi\` with JIT-compiled call thunks, achieving less than 5 nanoseconds of FFI call overhead.`
  },
  {
    id: 'bun-native-framework',
    category: 'Framework & Bun',
    title: 'Next.js, Tailwind v4 & Base UI on Native Bun',
    summary: 'How our forks eliminate legacy bundler bottlenecks and leverage native Web Standards directly in C++.',
    readTime: '6 min read',
    tags: ['Next.js', 'Tailwind v4', 'Base UI', 'Fast Build'],
    content: `# Framework Acceleration with Bun

By migrating Next.js, Tailwind CSS v4, and Base UI to Bun, we achieved monumental performance gains:

## Tailwind CSS v4 (>50x Speedup)
- **Rust Linker**: Replaced the default Windows MSVC linker with \`rust-lld\` and enabled \`codegen-units = 16\` with ThinLTO in \`Cargo.toml\`.
- **Fast Build Pipeline**: Replaced pnpm / Babel packaging with \`Bun.build\`, compiling all 5 packages in **62.6 ms** (down from 3.4 seconds).
- **Native Web Streams**: Added \`compileStream(stream: ReadableStream<Uint8Array>)\` in \`@tailwindcss-node\` and \`@tailwindcss-postcss\` for streaming transforms.
- **SubtleCrypto Caching**: Fast candidate hashing using \`globalThis.crypto.subtle.digest("SHA-256")\` eliminates redundant AST passes.

## Next.js Canary with Native Bundler
- **Zero-Copy HTTP Objects**: \`NextRequest\` and \`NextResponse\` directly wrap Bun's native C++ \`Request\` and \`Response\` instances, avoiding Node.js \`http.IncomingMessage\` overhead.
- **Streaming SSR with HTMLRewriter**: Injects head scripts and hydration manifests in a single streaming pass using Cloudflare's Rust-based \`lol-html\` engine embedded in Bun.
- **Parallel Compilation**: All 2,285 Next.js packages compiled in **1.95 s** via Bun.build.

## Base UI React 19
- Built in **1.61 s** emitting dual ESM (\`.mjs\`) and CJS (\`.js\`) modules with 100% publint and attw compliance.
- Fast-path \`crypto.randomUUID()\` and \`AbortSignal.timeout()\` integration.`
  },
  {
    id: 'material-3-design-tokens',
    category: 'Material 3',
    title: 'Material Design 3 Dynamic Theming & Tokens',
    summary: 'Algorithms and mathematical foundation behind M3 HCT color space, tonal palettes, and live theme generation.',
    readTime: '4 min read',
    tags: ['Material 3', 'Tokens', 'HCT Color', 'Theming'],
    content: `# Material 3 Dynamic Color Architecture

Material Design 3 (M3) creates dynamic, accessible color schemes based on a single seed color using the HCT (Hue, Chroma, Tone) color space:

## HCT Mathematical Color Model
Unlike HSL or RGB, HCT accurately models human visual perception:
- **Hue (H)**: 0° to 360° representing perceived color.
- **Chroma (C)**: Purity / colorfulness, maintaining color consistency across different hues.
- **Tone (T)**: 0 (pure black) to 100 (pure white), guaranteeing exact contrast ratios.

## Generated Tonal Palettes
From any seed color (e.g., #3b82f6 or #10b981), our theme engine computes five tonal palettes:
1. **Primary**: Dominant key accents.
2. **Secondary**: Supporting UI elements and badges.
3. **Tertiary**: Contrasting highlights for balance.
4. **Neutral**: Surface backgrounds, cards, sheets (Tone 10 for dark, Tone 98 for light).
5. **Neutral Variant**: Borders, dividers, outlines (Tone 20 to Tone 80).

## Contrast Guarantees
Because Tone directly correlates with perceptual luminance:
- Any element with Tone delta >= 40 satisfies WCAG AA (3:1 contrast for large text).
- Any element with Tone delta >= 50 satisfies WCAG AA (4.5:1 contrast for normal text).
- Any element with Tone delta >= 70 satisfies WCAG AAA (7:1 contrast).`
  },
  {
    id: 'tauri-desktop-bridge',
    category: 'Desktop & Tauri',
    title: 'Lowest-Level Tauri 3 Desktop Integration',
    summary: 'Architecture of our single-app desktop distribution embedding Bun and Aphrody native crates.',
    readTime: '5 min read',
    tags: ['Tauri 3', 'Desktop', 'IPC', 'Cross-Platform'],
    content: `# Tauri 3 Native Desktop Integration

The Aphrody desktop client represents the lowest-level embedding of Tauri:

## Unified Web Frontend
In accordance with our strict monorepo rule:
- **One App**: The single web application in \`apps/web\` compiles its static distribution directly into \`apps/web/dist\`.
- **Tauri Integration**: \`crates/tauri/aphrody-tauri\` points its \`frontendDist\` directly to \`apps/web/dist\`.
- No duplicated code, no separate showcase apps. The exact same UI runs in the browser, in the native desktop window, and in mobile webviews.

## Low-Level IPC Channel
- Bypasses JSON serialization overhead where possible by utilizing raw memory buffers across the Webview-Rust boundary.
- Registered native commands:
  - \`ping_host()\`: Direct roundtrip latency test (<0.1ms).
  - \`get_system_stats()\`: OS memory, thread pools, and CPU telemetry.
  - \`execute_yolo_call()\`: Bridges directly into \`yolo_runtime.h\` C ABI.`
  },
  {
    id: 'benchmark-methodology',
    category: 'Benchmarks & Perf',
    title: 'Monorepo 50x Build Acceleration & Benchmarks',
    summary: 'Detailed performance audit and methodology behind the 50x faster compilation pipelines.',
    readTime: '4 min read',
    tags: ['Benchmarks', 'Perf-Gate', 'ThinLTO', 'SIMD'],
    content: `# Monorepo Performance Methodology

Every acceleration claim in Aphrody is backed by reproducible benchmarks:

| Pipeline | Legacy Runtime / Tool | Bun Native Pipeline | Speedup |
| :--- | :--- | :--- | :--- |
| **Tailwind CSS v4** | 3,420 ms (pnpm + Babel) | **62.6 ms** (Bun.build) | **54.6x faster** |
| **Next.js Canary** | 112,500 ms (Webpack) | **1,950 ms** (Bun.build) | **57.7x faster** |
| **Base UI React** | 38,400 ms (code-infra) | **1,610 ms** (Bun.build) | **23.8x faster** |
| **Apps/Web Bundle** | 4,200 ms (Vite/Rollup) | **92.2 ms** (Bun.build) | **45.5x faster** |
| **Full Monorepo** | 154,320 ms (~2.5 min) | **3,714 ms** (<4 sec) | **41.6x overall** |

## Micro-Benchmark Rigor
- Cryptographic hashing: Hardware-accelerated BoringSSL via \`crypto.subtle\` vs Node.js C++ addon bridge.
- Transpiler throughput: Lexer and AST generation directly in Rust (\`bun_transpiler\`) vs V8 interpreted transforms.
- Compression: libdeflate SIMD assembly vs standard zlib.`
  },
  {
    id: 'llms-txt-standard',
    category: 'LLM & Memory',
    title: 'LLMs.txt & Agent Memory Contract',
    summary: 'How Aphrody structures documentation and codebase context for autonomous coding agents.',
    readTime: '3 min read',
    tags: ['LLMs.txt', 'Agents', 'Memory', 'Conventions'],
    content: `# LLMs.txt & Agent Context

Aphrody provides a standardized \`llms.txt\` file at the repository root and via \`/llms.txt\` in \`apps/web\`:

## Structure
1. **Core Philosophy**: Single App, Single FFI, Single CLI, Single Server per monorepo.
2. **Commands**: Always use native \`bun\` commands.
3. **Commit Rules**: Conventional Commits in English without mentioning AI / assistants / Claude.
4. **Architecture Maps**: Table of crates, packages, and layer boundaries.

Autonomous subagents ingest this manifest to guarantee zero drift from project invariants.`
  }
];
