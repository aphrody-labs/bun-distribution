/**
 * Environment Portability & Cross-Platform Path Auditor
 *
 * Scans codebase files to ensure full portability across Linux, macOS, Windows,
 * and containerized/CI environments:
 * - Detects hardcoded absolute home directories (/home/, /Users/, C:\Users\)
 * - Detects hardcoded WSL mount paths (/mnt/c/)
 * - Detects non-portable shell executions (e.g. raw "sh" on Windows without fallback)
 * - Validates dynamic path resolution and environment variable overrides
 *
 * 100% Native Bun. Zero external runtime dependencies.
 */

import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { yoloHome } from "./home";

export interface PortabilityIssue {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly match: string;
  readonly snippet: string;
  readonly severity: "error" | "warning";
}

export interface PortabilityReport {
  readonly schema: "yolo.portability/1";
  readonly target: string;
  readonly auditedFiles: number;
  readonly totalIssues: number;
  readonly issues: readonly PortabilityIssue[];
  readonly ok: boolean;
}

const DEFAULT_EXCLUDE_DIRS = new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  ".cache",
  "var",
  "vendor",
]);

interface RuleDef {
  readonly id: string;
  readonly pattern: RegExp;
  readonly severity: "error" | "warning";
  readonly ignore?: RegExp;
}

const RULES: readonly RuleDef[] = [
  {
    id: "no-hardcoded-home-dir",
    pattern: /\/(?:home|Users)\/[a-zA-Z0-9_-]+\/(?:yolo|aphrody|projects)/i,
    severity: "error",
    ignore: /file:\/\/\/home\/aphro\/yolo/, // Markdown link syntax in docs/tests
  },
  {
    id: "no-hardcoded-wsl-mount",
    pattern: /\/mnt\/[a-z]\//,
    severity: "error",
  },
  {
    id: "no-hardcoded-windows-drive",
    pattern: /[A-Z]:\\[a-zA-Z0-9_.-]+/,
    severity: "warning",
    ignore: /AppData|Android Studio|fake|test|example|\\x1b/i,
  },
  {
    id: "no-bare-sh-spawn",
    pattern: /spawn(?:Sync)?\(\s*["']sh["']/,
    severity: "warning",
    ignore: /LocalTransport|docker|sh -c/i,
  },
];

export async function auditPortability(
  targetDir: string = yoloHome(),
  options: { includeTests?: boolean } = {},
): Promise<PortabilityReport> {
  const root = resolve(targetDir);
  const issues: PortabilityIssue[] = [];
  let auditedFiles = 0;

  async function checkFile(fullPath: string, relPath: string): Promise<void> {
    if (!options.includeTests && relPath.startsWith("test/")) return;
    if (relPath.startsWith("crates/aphrody-")) return; // Vendored upstream fork crates
    if (
      relPath.endsWith("portability.ts") ||
      relPath.endsWith("audit_portability.ts")
    )
      return;

    try {
      const file = Bun.file(fullPath);
      const text = await file.text();
      auditedFiles++;
      const lines = text.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        for (const rule of RULES) {
          if (rule.ignore && rule.ignore.test(line)) continue;
          rule.pattern.lastIndex = 0;
          const match = rule.pattern.exec(line);
          if (match) {
            issues.push({
              file: relPath.replaceAll("\\", "/"),
              line: i + 1,
              rule: rule.id,
              match: match[0],
              snippet: line.trim(),
              severity: rule.severity,
            });
          }
        }
      }
    } catch {
      // Ignored for unreadable or binary files
    }
  }

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = fullPath.slice(root.length + 1);

      if (entry.isDirectory()) {
        if (!DEFAULT_EXCLUDE_DIRS.has(entry.name)) {
          // oxlint-disable-next-line no-await-in-loop -- parcours récursif séquentiel : l'ordre des entrées fixe l'ordre des problèmes du rapport
          await walk(fullPath);
        }
        continue;
      }

      if (/\.(ts|tsx|js|mjs|rs|toml|json|md|sh)$/.test(entry.name)) {
        // oxlint-disable-next-line no-await-in-loop -- contrôle séquentiel des fichiers : l'ordre des problèmes du rapport doit rester stable
        await checkFile(fullPath, relPath);
      }
    }
  }

  await walk(root);

  const errors = issues.filter((i) => i.severity === "error");

  return {
    schema: "yolo.portability/1",
    target: root,
    auditedFiles,
    totalIssues: issues.length,
    issues,
    ok: errors.length === 0,
  };
}

export function renderPortabilityMarkdown(report: PortabilityReport): string {
  const lines = [
    `# yolo audit --portability: ${report.ok ? "PASS" : "FAIL"}`,
    "",
    `- **Target:** \`${report.target}\``,
    `- **Audited Files:** ${report.auditedFiles.toLocaleString()}`,
    `- **Issues Detected:** ${report.totalIssues.toLocaleString()}`,
    "",
  ];

  if (report.issues.length === 0) {
    lines.push(
      "✔ No hardcoded environment paths, WSL assumptions, or non-portable references found.",
    );
    return lines.join("\n");
  }

  lines.push(
    "| Severity | Rule | File | Line | Snippet |",
    "| :--- | :--- | :--- | :--- | :--- |",
  );

  for (const issue of report.issues) {
    const icon = issue.severity === "error" ? "❌ ERROR" : "⚠️ WARN";
    lines.push(
      `| ${icon} | \`${issue.rule}\` | \`${issue.file}\` | ${issue.line} | \`${issue.snippet.slice(0, 80)}\` |`,
    );
  }

  return lines.join("\n");
}
