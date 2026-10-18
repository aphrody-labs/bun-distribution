import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The public readiness path (main entry plus the public bootstrap) must stay outside the React
// compatibility host. Chunks are checked through their emitted source maps, so the proof holds for
// the bundle that is actually served and not for the sources it was built from.

const ENTRY_SOURCE = "src/main.ts";
const BOOTSTRAP_SOURCE = "src/public-bootstrap.ts";
const HOST_SOURCES = ["src/host-mount.tsx", "src/BrowserHost.tsx"];
const REACT_SOURCE = /node_modules\/(?:\.bun\/[^/]+\/node_modules\/)?react(?:-dom)?\//;

// Static imports only: `import "./x.js"`, `import a from "./x.js"` and `export * from "./x.js"`,
// never the dynamic `import("./x.js")`.
const STATIC_IMPORT = /(?:^|[;}\s])(?:import|export)\s*(?:[^"'();]*?\bfrom\s*)?["'](\.\/[^"']+\.js)["']/g;

type Chunk = { code: string; sources: string[] };

function loadChunks(bundleDir: string): Map<string, Chunk> {
  const staticDir = join(bundleDir, "static");
  if (!existsSync(staticDir)) throw new Error(`public entry bundle has no static directory: ${staticDir}`);
  const chunks = new Map<string, Chunk>();
  for (const file of readdirSync(staticDir)) {
    if (!file.endsWith(".js")) continue;
    const mapPath = join(staticDir, `${file}.map`);
    if (!existsSync(mapPath)) continue;
    const map = JSON.parse(readFileSync(mapPath, "utf8")) as { sources?: string[] };
    chunks.set(file, {
      code: readFileSync(join(staticDir, file), "utf8"),
      sources: (map.sources ?? []).map(source => source.replaceAll("\\", "/")),
    });
  }
  return chunks;
}

function findChunk(chunks: Map<string, Chunk>, source: string): string {
  for (const [name, chunk] of chunks) {
    if (chunk.sources.some(candidate => candidate.endsWith(source))) return name;
  }
  throw new Error(`public entry bundle has no chunk built from ${source}`);
}

function staticClosure(chunks: Map<string, Chunk>, root: string): Set<string> {
  const seen = new Set<string>();
  const pending = [root];
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const chunk = chunks.get(name);
    if (!chunk) continue;
    for (const match of chunk.code.matchAll(STATIC_IMPORT)) pending.push(match[1]!.slice(2));
  }
  return seen;
}

function chunksFrom(chunks: Map<string, Chunk>, names: Set<string>, matches: (source: string) => boolean): string[] {
  return [...names].filter(name => chunks.get(name)?.sources.some(matches));
}

export function assertPublicEntryBundle(bundleDir: string): void {
  const chunks = loadChunks(bundleDir);
  const entry = findChunk(chunks, ENTRY_SOURCE);
  const bootstrap = findChunk(chunks, BOOTSTRAP_SOURCE);

  const readiness = new Set([...staticClosure(chunks, entry), ...staticClosure(chunks, bootstrap)]);
  const hosts = chunksFrom(chunks, readiness, source => HOST_SOURCES.some(host => source.endsWith(host)));
  if (hosts.length > 0) {
    throw new Error(`the React compatibility host is in the static readiness graph: ${hosts.join(", ")}`);
  }

  const react = chunksFrom(chunks, staticClosure(chunks, bootstrap), source => REACT_SOURCE.test(source));
  if (react.length > 0) {
    throw new Error(`React entered the public-bootstrap static closure: ${react.join(", ")}`);
  }
}
