// SPDX-License-Identifier: Apache-2.0

export interface DocArticle {
  id: string;
  category: "Architecture" | "Framework & Bun" | "Material 3" | "Desktop & Tauri" | "LLM & Memory";
  title: string;
  summary: string;
  readTime: string;
  tags: string[];
  content: string;
}

export const DOCS_ARTICLES: DocArticle[] = [
  {
    id: "runtime-architecture",
    category: "Architecture",
    title: "YOLO Runtime C ABI & Runtime SDK",
    summary: "The versioned C ABI of the native runtime and the TypeScript SDK that loads it through bun:ffi.",
    readTime: "4 min read",
    tags: ["YOLO Runtime", "C ABI", "bun:ffi"],
    content: `# YOLO Runtime C ABI

The native runtime has three layers:

## 1. Host
The Bun fork \`aphrody-labs/bun\` (JavaScriptCore engine, Web APIs, bundler, test runner).

## 2. Native C ABI
\`crates/engine/yolo-runtime\` implements the yolo_* functions declared in \`crates/interop/ffi/include/aphrody.h\`; the shared library that exports them is \`aphrody_ffi\` (\`crates/interop/ffi\`). Excerpt of the header:
\`\`\`c
typedef uint64_t YoloHandle;
typedef int32_t YoloStatus;

typedef struct YoloBuffer {
  uint8_t *data;
  size_t len;
  size_t cap;
} YoloBuffer;

/* (major << 16) | minor. Call first, refuse a different major. */
uint32_t yolo_abi_version(void);
YoloStatus yolo_runtime_create(const YoloCreateInfo *info, YoloHandle *out);
YoloStatus yolo_system_stats(YoloHandle runtime, YoloBuffer *out); /* JSON object */
void yolo_buffer_free(YoloBuffer *buffer);
\`\`\`
Handles are opaque and library-owned; every returned buffer is released with \`yolo_buffer_free\`. The full contract is \`docs/architecture/runtime-native/RUNTIME-ABI.md\`.

## 3. TypeScript SDK
\`packages/engine/runtime\` (\`@aphrody/runtime-sdk\`) binds the symbols with \`dlopen\` from \`bun:ffi\`. \`examples/runtime-rust-extension\` is a standalone Rust consumer of the same ABI.`,
  },
  {
    id: "bun-native-framework",
    category: "Framework & Bun",
    title: "Next.js, Tailwind v4 & Base UI forks on Bun",
    summary: "Where the Bun-oriented forks live and what this monorepo consumes from them.",
    readTime: "2 min read",
    tags: ["Next.js", "Tailwind v4", "Base UI"],
    content: `# Forks consumed by the monorepo

- **Tailwind CSS v4**: \`@aphrody/bun-plugin-tailwind\` (published from the Bun fork) compiles Tailwind roots inside \`Bun.build\`. \`apps/web/build.ts\` uses it with \`theme: "m3"\`, which adds the \`@aphrody/m3-tailwind\` preset and an M3 colour scheme.
- **Base UI**: the fork \`aphrody-labs/base-ui\` is published as \`@aphrody/base-ui\`; \`@base-ui/react\` is pinned in the root package.json catalog.
- **Next.js**: \`@aphrody/m3-next\` (m3/packages/m3-next) integrates Next.js with the M3 packages.

No build-time comparison between these forks and their upstream toolchains is recorded in this repository; the apps/web benchmark runner only measures single runtime calls on the current machine.`,
  },
  {
    id: "material-3-design-tokens",
    category: "Material 3",
    title: "Material Design 3 Dynamic Theming & Tokens",
    summary: "How the desktop derives every M3 colour role from one seed colour.",
    readTime: "3 min read",
    tags: ["Material 3", "Tokens", "HCT Color", "Theming"],
    content: `# Material 3 Dynamic Color

\`applyM3Theme\` (apps/web/src/core/theme.ts) calls \`applyDynamicColor\` from \`@aphrody/m3-tokens/dynamic-color\`, which is built on \`@material/material-color-utilities\`:

## HCT colour space
- **Hue (H)**: 0° to 360°.
- **Chroma (C)**: colourfulness.
- **Tone (T)**: 0 (black) to 100 (white); tone differences drive contrast.

## Scheme
The seed is converted to HCT and a \`SchemeTonalSpot\` (the default variant) resolves the primary, secondary, tertiary, neutral and neutral-variant palettes. Every \`--md-sys-color-*\` role (about 47) is written on \`<html>\` for the light or dark mode.

## Contrast
Material roles are chosen so that on-colour pairs meet the M3 contrast targets; the \`contrastLevel\` option of \`schemeFromSeed\` (−1 to 1) raises or lowers them.`,
  },
  {
    id: "tauri-desktop-bridge",
    category: "Desktop & Tauri",
    title: "Running apps/web inside Tauri",
    summary: "What the bridge in apps/web does today and what is not wired yet.",
    readTime: "2 min read",
    tags: ["Tauri 3", "Desktop", "IPC"],
    content: `# Tauri bridge status

- \`src/core/platform.ts\` detects a Tauri webview through \`window.__TAURI_INTERNALS__\` and then sends \`invoke(cmd, args)\` to it; in a browser the same call becomes \`POST /api/bridge/<cmd>\` on the Bun server (\`server.ts\` answers \`ping\`).
- No \`tauri.conf.json\` in the repository points \`frontendDist\` at \`apps/web/dist\` yet, and no Tauri command named \`ping\` is registered, so the desktop path is not exercised.
- The Aphrody desktop shell is \`crates/ui/app\` (its own \`ui-dist\` frontend); the Tauri project template is \`m3/templates/desktop\`.`,
  },
  {
    id: "llms-txt-standard",
    category: "LLM & Memory",
    title: "llms.txt & Agent Context",
    summary: "Where the repository keeps its context for coding agents.",
    readTime: "1 min read",
    tags: ["LLMs.txt", "Agents", "Conventions"],
    content: `# llms.txt & Agent Context

The repository index for agents is \`docs/reference/ai/llms.txt\`. Repository conventions (commands, commit rules, layout) live in the root \`AGENTS.md\`/\`CLAUDE.md\` files and in \`docs/guides\`. apps/web does not serve \`/llms.txt\`.`,
  },
];
