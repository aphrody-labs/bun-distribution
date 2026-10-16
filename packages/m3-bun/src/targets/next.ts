// SPDX-License-Identifier: Apache-2.0
// Next.js on Bun for the app's M3 front end: next.config.ts composes `withM3` (@aphrody/m3-next: transpiled M3
// packages, barrel imports, standalone-friendly externals) inside `withBun` (@aphrody/next-bun: Next and its
// Turbopack workers on Bun, one copy of deduplicated packages). build-next.sh runs `next-bun build`, flattens the
// standalone tree with `next-bun standalone` (Bun's isolated linker leaves symlinks in it) and copies the static
// assets in; the result starts with `bun server.js`.
import { GENERATED_NOTE } from "../util.ts";
import type { Target, TargetContext, TargetFile } from "./types.ts";

export const nextConfig = (c: TargetContext): string => `// ${GENERATED_NOTE}
// ${c.name} on Next.js and Bun. Copy next to package.json; needs next, @aphrody/m3-next and @aphrody/next-bun.
import { withM3 } from "@aphrody/m3-next";
import { withBun } from "@aphrody/next-bun";

export default withBun(
  withM3({
    output: "standalone",
    poweredByHeader: false,
    env: { M3_APP_VERSION: ${JSON.stringify(c.version)} },
  }),
  { bundler: "turbopack", projectDir: import.meta.dirname, dedupe: ["react", "react-dom"] },
);
`;

export const buildScript = (c: TargetContext): string => `#!/bin/sh
# ${GENERATED_NOTE}
# Build ${c.name} with Next.js on Bun into .next/standalone (self-contained), from the app directory.
set -eu
bunx --bun next-bun build --turbopack
bunx --bun next-bun standalone .next/standalone
mkdir -p .next/standalone/.next
cp -R .next/static .next/standalone/.next/static
[ -d public ] && cp -R public .next/standalone/public
echo "start: PORT=${c.port} bun .next/standalone/server.js"
`;

export const next: Target = {
  id: "next",
  title: "Next.js on Bun",
  description:
    "next.config.ts (withBun(withM3(...)) from @aphrody/next-bun and @aphrody/m3-next, standalone output) and build-next.sh",
  generate(c): TargetFile[] {
    return [
      { path: "next.config.ts", content: nextConfig(c) },
      { path: "build-next.sh", content: buildScript(c), mode: 0o755 },
    ];
  },
};
