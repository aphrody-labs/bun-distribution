/**
 * Fast, parallel, recursive repository and directory scanner.
 * Powered 100% by native Bun: Bun.Glob, Bun.file, Bun.nanoseconds, and Bun.hash.wyhash.
 *
 * Agent-First: Outputs structured JSON (schema `yolo.scan/1`) or Markdown tables with --json / --md.
 */

import { existsSync, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { limiter } from "../sys/limiter";

export interface ExtensionStat {
  readonly ext: string;
  readonly count: number;
  readonly bytes: number;
  readonly lines: number;
}

export interface FileEntry {
  readonly path: string;
  readonly bytes: number;
  readonly lines: number;
  readonly hash: string;
}

export interface ScanReport {
  readonly schema: "yolo.scan/1";
  readonly target: string;
  readonly scannedAt: string;
  readonly elapsedMs: number;
  readonly totalFiles: number;
  readonly totalBytes: number;
  readonly totalLines: number;
  readonly treeFingerprint: string;
  readonly byExtension: readonly ExtensionStat[];
  readonly largestFiles: readonly FileEntry[];
}

export interface ScanOptions {
  readonly target?: string | undefined;
  readonly exts?: readonly string[] | undefined;
  readonly exclude?: readonly string[] | undefined;
  readonly parallel?: number | undefined;
  readonly maxFiles?: number | undefined;
}

const DEFAULT_EXCLUDES = [".git", "node_modules", "target", "dist", ".cache", ".cargo", "var"];

/**
 * Recursively scans a directory in parallel, computing line counts, byte sizes,
 * per-extension metrics, and a composite tree wyhash fingerprint.
 */
export async function scanDirectory(targetDir: string, options: ScanOptions = {}): Promise<ScanReport> {
  const t0 = Bun.nanoseconds();
  const absTarget = resolve(targetDir);
  if (!existsSync(absTarget)) {
    throw new Error(`Target path does not exist: ${absTarget}`);
  }
  if (!statSync(absTarget).isDirectory()) throw new Error(`Target is not a directory: ${absTarget}`);
  const parallel = options.parallel ?? 16;
  if (!Number.isSafeInteger(parallel) || parallel < 1) throw new Error("parallel must be a positive integer");
  if (options.maxFiles !== undefined && (!Number.isSafeInteger(options.maxFiles) || options.maxFiles < 1))
    throw new Error("maxFiles must be a positive integer");

  const extsFilter = options.exts?.map(e => (e.startsWith(".") ? e : `.${e}`).toLowerCase());
  const excludes = new Set(options.exclude ?? DEFAULT_EXCLUDES);
  const limit = limiter(parallel);

  const glob = new Bun.Glob("**/*");
  const candidates: string[] = [];

  for (const relPath of glob.scanSync({
    cwd: absTarget,
    onlyFiles: true,
    dot: false,
  })) {
    const parts = relPath.split(/[/\\]/);
    if (parts.some(p => excludes.has(p))) continue;

    if (extsFilter && extsFilter.length > 0) {
      const ext = extname(relPath).toLowerCase();
      if (!extsFilter.includes(ext)) continue;
    }

    // Bun.Glob yields `\` on Windows; reports and the tree fingerprint use `/` on every platform.
    candidates.push(relPath.replaceAll("\\", "/"));
  }

  // Sort candidates for deterministic tree fingerprint
  candidates.sort();
  if (options.maxFiles !== undefined) candidates.length = Math.min(candidates.length, options.maxFiles);

  const entries: FileEntry[] = [];
  const extMap = new Map<string, { count: number; bytes: number; lines: number }>();

  const scanFile = async (relPath: string): Promise<FileEntry | null> => {
    try {
      const fullPath = resolve(absTarget, relPath);
      const file = Bun.file(fullPath);
      const content = new Uint8Array(await file.arrayBuffer());
      const text = new TextDecoder().decode(content);
      const bytes = content.byteLength;
      const lines = text.length === 0 ? 0 : text.split("\n").length;
      const hash = Bun.hash.wyhash(content).toString(16);

      return { path: relPath, bytes, lines, hash };
    } catch {
      return null;
    }
  };

  const tasks = candidates.map(relPath =>
    limit(async () => {
      const res = await scanFile(relPath);
      if (res) {
        entries.push(res);
        const ext = extname(relPath).toLowerCase() || "(no-ext)";
        const current = extMap.get(ext) || { count: 0, bytes: 0, lines: 0 };
        current.count += 1;
        current.bytes += res.bytes;
        current.lines += res.lines;
        extMap.set(ext, current);
      }
    }),
  );

  await Promise.all(tasks);
  const comparePaths = (a: FileEntry, b: FileEntry): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  entries.sort(comparePaths);

  // Compute composite tree fingerprint using wyhash over sorted file hashes
  const treeHasher = new Bun.CryptoHasher("sha256");
  for (const entry of entries) {
    treeHasher.update(`${entry.path}:${entry.hash}:${entry.bytes}\n`);
  }
  const treeSha = treeHasher.digest("hex");
  const treeFingerprint = Bun.hash.wyhash(treeSha).toString(16);

  const totalFiles = entries.length;
  const totalBytes = entries.reduce((acc, e) => acc + e.bytes, 0);
  const totalLines = entries.reduce((acc, e) => acc + e.lines, 0);

  const byExtension: ExtensionStat[] = Array.from(extMap.entries())
    .map(([ext, stat]) => ({
      ext,
      count: stat.count,
      bytes: stat.bytes,
      lines: stat.lines,
    }))
    .toSorted((a, b) => b.bytes - a.bytes || (a.ext < b.ext ? -1 : a.ext > b.ext ? 1 : 0));

  const largestFiles = [...entries].toSorted((a, b) => b.bytes - a.bytes || comparePaths(a, b)).slice(0, 10);
  const elapsedMs = Math.round((Bun.nanoseconds() - t0) / 1_000_000);

  return {
    schema: "yolo.scan/1",
    target: absTarget,
    scannedAt: new Date().toISOString(),
    elapsedMs,
    totalFiles,
    totalBytes,
    totalLines,
    treeFingerprint,
    byExtension,
    largestFiles,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function renderScanMarkdown(report: ScanReport): string {
  const lines: string[] = [
    `# yolo scan: \`${report.target}\``,
    "",
    `- **Scanned At:** ${report.scannedAt}`,
    `- **Elapsed Time:** ${report.elapsedMs} ms`,
    `- **Total Files:** ${report.totalFiles.toLocaleString()}`,
    `- **Total Size:** ${formatBytes(report.totalBytes)} (${report.totalBytes.toLocaleString()} bytes)`,
    `- **Total Lines:** ${report.totalLines.toLocaleString()}`,
    `- **Tree Fingerprint:** \`wyhash:0x${report.treeFingerprint}\``,
    "",
    `## Breakdown by File Extension`,
    "",
    `| Extension | Files | Lines | Total Size | % Size |`,
    `| :--- | :--- | :--- | :--- | :--- |`,
  ];

  for (const s of report.byExtension) {
    const pct = report.totalBytes > 0 ? ((s.bytes / report.totalBytes) * 100).toFixed(1) : "0.0";
    lines.push(
      `| \`${s.ext}\` | ${s.count.toLocaleString()} | ${s.lines.toLocaleString()} | ${formatBytes(s.bytes)} | ${pct}% |`,
    );
  }

  lines.push("", `## Top 10 Largest Files`, "", `| File Path | Size | Lines | Hash |`, `| :--- | :--- | :--- | :--- |`);

  for (const f of report.largestFiles) {
    const rel = relative(report.target, resolve(report.target, f.path)).replaceAll("\\", "/");
    lines.push(`| \`${rel}\` | ${formatBytes(f.bytes)} | ${f.lines.toLocaleString()} | \`${f.hash}\` |`);
  }

  return lines.join("\n");
}

const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(2) + " MB";
const kb = (bytes: number): string => (bytes / 1024).toFixed(1) + " KB";

export function renderScanTerminal(report: ScanReport): string {
  const out = [
    `\x1b[1m\x1b[36m=== YOLO Recursive Scan ===\x1b[0m`,
    `  Target:      ${report.target}`,
    `  Files:       ${report.totalFiles.toLocaleString()}`,
    `  Total Size:  ${mb(report.totalBytes)} (${report.totalBytes.toLocaleString()} bytes)`,
    `  Total Lines: ${report.totalLines.toLocaleString()}`,
    `  Fingerprint: wyhash:0x${report.treeFingerprint}`,
    `  Speed:       ${report.elapsedMs} ms`,
    `\n  \x1b[1mBy Extension:\x1b[0m`,
  ];

  for (const s of report.byExtension.slice(0, 8)) {
    out.push(
      `    \x1b[33m${s.ext.padEnd(12)}\x1b[0m ${String(s.count).padStart(5)} files  ${String(s.lines).padStart(7)} lines  ${kb(s.bytes).padStart(10)}`,
    );
  }

  out.push(`\n  \x1b[1mLargest Files:\x1b[0m`);
  for (const f of report.largestFiles.slice(0, 5)) {
    out.push(`    - ${f.path} (${kb(f.bytes)}, ${f.lines} lines)`);
  }

  return out.join("\n");
}
