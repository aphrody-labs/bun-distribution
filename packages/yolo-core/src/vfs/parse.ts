/**
 * Static module analysis through the canonical native Oxc parser, with Bun
 * file reads and raw-byte wyhash fingerprinting.
 */

export interface TsParseResult {
  readonly path: string;
  readonly lines: number;
  readonly bytes: number;
  readonly checksum: string;
  readonly exports: readonly string[];
  readonly imports: readonly string[];
  readonly parseTimeMs: number;
}

export async function parseTsSource(filePath: string): Promise<TsParseResult> {
  const t0 = Bun.nanoseconds();
  const raw = new Uint8Array(await Bun.file(filePath).arrayBuffer());
  const content = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(raw);
  const bytes = raw.byteLength;
  const lines = content.length === 0 ? 0 : content.split("\n").length;

  // Bun native wyhash checksum
  const checksum = Bun.hash.wyhash(raw).toString(16);

  // Load the shared native provider only when parsing is requested. Its official
  // Oxc module metadata covers types without transferring the full AST into JS.
  const { NativeTooling } = await import("../compiler/native.ts");
  using tooling = new NativeTooling();
  const { exports, imports } = tooling.analyzeModule(content, filePath);

  const parseTimeMs = Number(((Bun.nanoseconds() - t0) / 1_000_000).toFixed(3));

  return {
    path: filePath,
    lines,
    bytes,
    checksum,
    exports,
    imports,
    parseTimeMs,
  };
}

export function renderParseMarkdown(result: TsParseResult): string {
  return [
    `# yolo parse: \`${result.path}\``,
    "",
    `- **Lines:** ${result.lines.toLocaleString()}`,
    `- **Bytes:** ${result.bytes.toLocaleString()} bytes`,
    `- **Wyhash Fingerprint:** \`0x${result.checksum}\``,
    `- **Parse Latency:** ${result.parseTimeMs} ms`,
    "",
    `## Exports (${result.exports.length})`,
    "",
    result.exports.length > 0
      ? result.exports.map((e) => `- \`${e}\``).join("\n")
      : "_No top-level exports detected_",
    "",
    `## Imports (${result.imports.length})`,
    "",
    result.imports.length > 0
      ? result.imports.map((i) => `- \`${i}\``).join("\n")
      : "_No imported modules detected_",
  ].join("\n");
}
