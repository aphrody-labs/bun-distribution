/**
 * Autonomous Bun upstream capability crawler and code generator.
 */
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { yoloHome } from "../vfs/home";
import { readGitHead } from "./status";
import { checkoutRoot } from "@aphrody/paths";

export interface BunApiDomain {
  readonly id: "web_api" | "server" | "react" | "css" | "img" | "json" | "markdown";
  readonly title: string;
  readonly description: string;
  readonly docMatches: readonly string[];
  readonly typeMatches: readonly string[];
  readonly keyApis: readonly string[];
}

export interface AutonomousGenerationReport {
  readonly generatedAt: string;
  readonly bunVersion: string;
  readonly bunRevision: string;
  readonly sourceRevision: string;
  readonly targetCatalogPath: string;
  readonly domains: readonly BunApiDomain[];
  readonly totalDocFilesIndexed: number;
  readonly totalTypeFilesIndexed: number;
  readonly elapsedMs: number;
}

const withoutTimestamps = (text: string): string =>
  text.replace(/^ \* Timestamp: .*$/m, "").replace(/generatedAt: "[^"]*"/, "");

/**
 * The catalog is tracked and checked with Bun's native `fmt` command.
 */
async function writeTrackedCatalog(targetPath: string, content: string, rootDir: string): Promise<void> {
  const draft = targetPath.replace(/\.ts$/, `.${crypto.randomUUID()}.draft.ts`);
  mkdirSync(dirname(targetPath), { recursive: true });
  try {
    await Bun.write(draft, content);
    const formatted = Bun.spawnSync([process.execPath, "fmt", "--write", draft], {
      windowsHide: true,
      cwd: rootDir,
      stdout: "ignore",
      stderr: "pipe",
      timeout: 30000,
    });
    if (formatted.exitCode !== 0)
      throw new Error(
        `Bun fmt failed to format the Bun catalog (exit ${formatted.exitCode}): ${formatted.stderr.toString().slice(0, 2048)}`,
      );
    const next = await Bun.file(draft).text();
    const previous = existsSync(targetPath) ? await Bun.file(targetPath).text() : "";
    if (withoutTimestamps(previous) === withoutTimestamps(next)) {
      rmSync(draft);
    } else {
      renameSync(draft, targetPath);
    }
  } finally {
    rmSync(draft, { force: true });
  }
}

/** Configured Bun checkout or the current workspace's sibling; undefined when absent. */
export function bunCheckout(env: Record<string, string | undefined> = process.env): string | undefined {
  const dir = checkoutRoot("bun", env);
  return dir && existsSync(resolve(dir, "docs")) ? resolve(dir) : undefined;
}

export async function generateBunCatalog(rootDirArg?: string): Promise<AutonomousGenerationReport> {
  const t0 = Bun.nanoseconds();
  const rootDir = rootDirArg ?? yoloHome();
  const bunRepoDir = rootDirArg === undefined ? bunCheckout() : resolve(rootDir, "vendor/bun");
  if (!bunRepoDir) throw new Error("Bun catalog generation requires the Bun fork checkout (set APHRODY_BUN_CHECKOUT)");
  const bunDocsDir = resolve(bunRepoDir, "docs");
  const bunTypesDir = resolve(bunRepoDir, "packages/bun-types");
  if (!existsSync(bunDocsDir) || !existsSync(bunTypesDir))
    throw new Error("Bun catalog generation requires vendor/bun docs and bun-types source data");
  const sourceRevision = await readGitHead(bunRepoDir);
  if (!sourceRevision) throw new Error("Cannot resolve the vendor/bun source revision");

  const globDocs = new Bun.Glob("**/*.md*");
  const globTypes = new Bun.Glob("*.d.ts");

  const allDocs = existsSync(bunDocsDir)
    ? Array.from(globDocs.scanSync({ cwd: bunDocsDir, onlyFiles: true })).toSorted()
    : [];
  const allTypes = existsSync(bunTypesDir)
    ? Array.from(globTypes.scanSync({ cwd: bunTypesDir, onlyFiles: true })).toSorted()
    : [];

  const domains: BunApiDomain[] = [
    {
      id: "web_api",
      title: "Web Standards & Browser Parity",
      description:
        "Standards-compliant Fetch, Request/Response, Streams, Web Crypto, WebSockets, Worker, and EventTarget",
      docMatches: allDocs.filter(d => /web-apis|fetch|stream|websocket|worker|crypto|event/i.test(d)),
      typeMatches: allTypes.filter(t => /fetch|globals|bun\.d\.ts/i.test(t)),
      keyApis: [
        "fetch",
        "Response",
        "Request",
        "ReadableStream",
        "WebSocket",
        "crypto.subtle",
        "Worker",
        "EventTarget",
      ],
    },
    {
      id: "server",
      title: "Native HTTP Server & WebSockets",
      description: "High-performance Bun.serve with zero-copy routing, SSE streams, backpressure WebSocket, and TLS",
      docMatches: allDocs.filter(d => /server|http|websocket|route|listen/i.test(d)),
      typeMatches: allTypes.filter(t => /serve|devserver/i.test(t)),
      keyApis: ["Bun.serve", "Bun.listen", "ServerWebSocket", "Response.json", "Response.redirect"],
    },
    {
      id: "react",
      title: "React & JSX Engine",
      description: "Direct JSX/TSX transpilation, React 19 / Server Components compatibility, and Bun.markdown.react()",
      docMatches: allDocs.filter(d => /react|jsx|fullstack/i.test(d)),
      typeMatches: allTypes.filter(t => /jsx/i.test(t)),
      keyApis: ["Bun.Transpiler", "Bun.markdown.react", "jsx: 'react-jsx'", "React Server Components"],
    },
    {
      id: "css",
      title: "LightningCSS & Modern Styling Engine",
      description:
        "Built-in LightningCSS transpilation: CSS nesting, color-mix(), relative colors, OKLCH, and CSS Modules",
      docMatches: allDocs.filter(d => /css|tailwind|style/i.test(d)),
      typeMatches: allTypes.filter(t => /bundle/i.test(t)),
      keyApis: ["Bun.build({ loaders: { '.css': 'css' } })", "Bun.color", "CSS Nesting", "color-mix()", "oklch()"],
    },
    {
      id: "img",
      title: "Native Image Pipeline (Bun.Image)",
      description:
        "SIMD-accelerated image decoding, resize (mitchell/lanczos3), rotate, modulate, WebP/AVIF, and ThumbHash placeholders",
      docMatches: allDocs.filter(d => /image|png|jpeg|svg/i.test(d)),
      typeMatches: allTypes.filter(t => /bun\.d\.ts/i.test(t)),
      keyApis: ["new Bun.Image()", "Blob.image()", "img.resize()", "img.webp()", "img.placeholder()", "img.bytes()"],
    },
    {
      id: "json",
      title: "High-Performance Structured Data",
      description: "Fast SIMD JSON, zero-copy streaming Bun.JSONL, JSON5, native Bun.TOML, and Bun.XML",
      docMatches: allDocs.filter(d => /json|toml|xml|read-file/i.test(d)),
      typeMatches: allTypes.filter(t => /bun\.d\.ts/i.test(t)),
      keyApis: ["Bun.JSONL.parse", "Bun.JSONL.parseChunk", "Bun.TOML.parse", "Bun.TOML.stringify", "Bun.XML.parse"],
    },
    {
      id: "markdown",
      title: "Rust-Powered Markdown Engine (Bun.markdown)",
      description:
        "Ultra-fast GFM parser written in Rust with native HTML, ANSI terminal, custom AST render, and React JSX output",
      docMatches: allDocs.filter(d => /markdown/i.test(d)),
      typeMatches: allTypes.filter(t => /bun\.d\.ts/i.test(t)),
      keyApis: ["Bun.markdown.html", "Bun.markdown.ansi", "Bun.markdown.render", "Bun.markdown.react"],
    },
  ];

  // Self-generate TypeScript capability registry in packages/app-ui/src/generated/bun-catalog.ts (Studio > Moteur)
  const generatedFileHeader = `/**
 * AUTONOMOUSLY GENERATED FILE - DO NOT EDIT MANUALLY
 * Generated by YOLO Autonomous Engine (yolo generate)
 * Upstream Source: vendor/bun (commit: ${sourceRevision})
 * Timestamp: ${new Date().toISOString()}
 * Baseline: Bun ${Bun.version}
 */

export interface BunCapabilityItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly keyApis: readonly string[];
  readonly docCount: number;
  readonly sampleDocs: readonly string[];
}

export interface MonorepoBunCatalog {
  readonly generatedAt: string;
  readonly bunVersion: string;
  readonly bunRevision: string;
  readonly sourceRevision: string;
  readonly capabilities: readonly BunCapabilityItem[];
}

export const MONOREPO_BUN_CATALOG: MonorepoBunCatalog = {
  generatedAt: ${JSON.stringify(new Date().toISOString())},
  bunVersion: ${JSON.stringify(Bun.version)},
  bunRevision: ${JSON.stringify(Bun.revision)},
  sourceRevision: ${JSON.stringify(sourceRevision)},
  capabilities: [
${domains
  .map(
    d => `    {
      id: ${JSON.stringify(d.id)},
      title: ${JSON.stringify(d.title)},
      description: ${JSON.stringify(d.description)},
      keyApis: ${JSON.stringify(d.keyApis)},
      docCount: ${d.docMatches.length},
      sampleDocs: ${JSON.stringify(d.docMatches.slice(0, 5))},
    },`,
  )
  .join("\n")}
  ],
};
`;

  const targetPath = resolve(rootDir, "packages/app-ui/src/generated/bun-catalog.ts");
  await writeTrackedCatalog(targetPath, generatedFileHeader, rootDir);

  const elapsedMs = Math.round((Bun.nanoseconds() - t0) / 1_000_000);

  return {
    generatedAt: new Date().toISOString(),
    bunVersion: Bun.version,
    bunRevision: Bun.revision,
    sourceRevision,
    targetCatalogPath: targetPath,
    domains,
    totalDocFilesIndexed: allDocs.length,
    totalTypeFilesIndexed: allTypes.length,
    elapsedMs,
  };
}
