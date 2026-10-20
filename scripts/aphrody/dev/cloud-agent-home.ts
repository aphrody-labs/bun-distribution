// SPDX-License-Identifier: Apache-2.0
// Automated agent-home initialization for cloud sessions and containers.
// Follows docs/operations/cloud/AGENT-HOME-SETUP.md: secret-free, idempotent, non-interactive.

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface AgentHomeInitOptions {
  homeDir?: string;
  workspace?: string;
  apply?: boolean;
  verifyOnly?: boolean;
}

export interface AgentHomeReport {
  homeDir: string;
  workspaceDir: string;
  seededFiles: string[];
  existingFiles: string[];
  directoriesCreated: string[];
  securityAudit: {
    clean: boolean;
    violations: string[];
  };
  success: boolean;
}

const FORBIDDEN_SECRETS = [
  "credentials",
  "credentials.json",
  "cookies",
  "cookies.sqlite",
  "id_rsa",
  "id_ed25519",
  "private.key",
  ".env",
];

export function initCloudAgentHome(options: AgentHomeInitOptions = {}): AgentHomeReport {
  const root = resolve(import.meta.dir, "../../../");
  const homeDir =
    options.homeDir ?? process.env.APHRODY_HOME ?? join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".aphrody");
  const workspaceName = options.workspace ?? "aphrody";
  const workspaceDir = join(homeDir, "workspaces", workspaceName);
  const templatesDir = join(root, "crates/ai/agent-home/templates");

  const apply = options.apply === true && !options.verifyOnly;
  const seededFiles: string[] = [];
  const existingFiles: string[] = [];
  const directoriesCreated: string[] = [];
  const violations: string[] = [];

  const neededDirs = [
    homeDir,
    join(homeDir, "workspaces"),
    workspaceDir,
    join(workspaceDir, "memory"),
    join(workspaceDir, "sessions"),
    join(homeDir, "db"),
    join(homeDir, "bin"),
  ];

  for (const dir of neededDirs) {
    if (!existsSync(dir)) {
      directoriesCreated.push(dir);
      if (apply) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  // Seed persona and configuration templates
  if (existsSync(templatesDir)) {
    const templateFiles = readdirSync(templatesDir).filter(f => f.endsWith(".md"));
    for (const file of templateFiles) {
      const targetPath = join(workspaceDir, file);
      if (existsSync(targetPath)) {
        existingFiles.push(file);
      } else {
        seededFiles.push(file);
        if (apply) {
          copyFileSync(join(templatesDir, file), targetPath);
        }
      }
    }
  }

  // Check for context links / references
  const contextNotesPath = join(workspaceDir, "CONTEXT.md");
  if (!existsSync(contextNotesPath)) {
    seededFiles.push("CONTEXT.md");
    if (apply) {
      const contextContent = [
        "<!-- SPDX-License-Identifier: Apache-2.0 -->",
        "# Cloud Session Active Context",
        "",
        "This agent home was initialized in an ephemeral cloud container.",
        "Authority, architecture and queue: repository `PLAN.md` and `MEMORY.md`.",
        "Cloud handoff decisions: `docs/operations/cloud/CONTEXT-HANDOFF.md`.",
        "Cloud synchronization journal: `docs/operations/cloud/CLOUD-SYNC.md`.",
        "",
        `Initialized at: ${new Date().toISOString()}`,
        `Workspace: ${workspaceName}`,
        "",
      ].join("\n");
      writeFileSync(contextNotesPath, contextContent, "utf8");
    }
  } else {
    existingFiles.push("CONTEXT.md");
  }

  // Security audit: ensure no private keys, cookies or credentials leaked into home
  function auditDirectory(dir: string, depth = 0) {
    if (depth > 4 || !existsSync(dir)) return;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const lower = entry.toLowerCase();
        if (FORBIDDEN_SECRETS.includes(lower) || lower.endsWith(".pem") || lower.endsWith(".key")) {
          violations.push(join(dir, entry));
        }
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          auditDirectory(full, depth + 1);
        }
      }
    } catch {}
  }

  auditDirectory(homeDir);

  const clean = violations.length === 0;
  return {
    homeDir,
    workspaceDir,
    seededFiles,
    existingFiles,
    directoriesCreated,
    securityAudit: {
      clean,
      violations,
    },
    success: clean,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const verifyOnly = args.includes("--verify");
  const json = args.includes("--json");
  const homeIdx = args.indexOf("--home");
  const homeDir = homeIdx !== -1 && args[homeIdx + 1] ? resolve(args[homeIdx + 1]!) : undefined;

  const report = initCloudAgentHome({ apply, verifyOnly, homeDir });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[cloud-agent-home] Home root: ${report.homeDir}`);
    console.log(`[cloud-agent-home] Workspace: ${report.workspaceDir}`);
    console.log(`[cloud-agent-home] Directories created: ${report.directoriesCreated.length}`);
    console.log(
      `[cloud-agent-home] Files seeded: ${report.seededFiles.length} (${report.seededFiles.join(", ") || "none"})`,
    );
    console.log(`[cloud-agent-home] Existing files: ${report.existingFiles.length}`);
    console.log(
      `[cloud-agent-home] Security audit: ${report.securityAudit.clean ? "CLEAN (no credentials, cookies, or private keys)" : "VIOLATIONS FOUND"}`,
    );
    if (!report.securityAudit.clean) {
      for (const v of report.securityAudit.violations) {
        console.error(`  FAIL: forbidden secret found at ${v}`);
      }
    }
    if (!apply && !verifyOnly) {
      console.log("\nNote: Dry-run mode. Pass --apply to create directories and seed files.");
    }
  }

  process.exit(report.success ? 0 : 1);
}
