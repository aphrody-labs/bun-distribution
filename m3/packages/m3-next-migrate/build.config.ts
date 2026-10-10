import { m3Package } from "@aphrody/m3-config/bun-build";

export default m3Package({
  entry: [
    "src/index.ts",
    "src/cli.ts",
    "src/codemods/index.ts",
    "src/shims/navigation.tsx",
    "src/shims/link.tsx",
    "src/shims/image.tsx",
    "src/shims/font.ts",
    "src/shims/dynamic.tsx",
    "src/shims/headers.ts",
    "src/shims/form.tsx",
    "src/shims/tauri-ipc.ts",
    "src/shims/provider.tsx",
    "src/shims/metadata.tsx",
    "src/shims/server.ts",
    "src/layout.ts",
  ],
  splitting: false,
  useClient: [
    "shims/navigation.js",
    "shims/link.js",
    "shims/image.js",
    "shims/dynamic.js",
    "shims/form.js",
    "shims/provider.js",
    "shims/metadata.js",
  ],
  external: ["@tauri-apps/*"],
});
