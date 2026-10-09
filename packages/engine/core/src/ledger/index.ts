// SPDX-License-Identifier: Apache-2.0
/**
 * YOLO Centralized Audit & Autonomous Training Ledger
 *
 * Implements a 100% native Bun SQLite database engine for storing, aggregating,
 * and recursively learning from multi-agent audits, quality gates, performance
 * benchmarks, and codebase fingerprints.
 */
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { findRepoRoot } from "../vfs/index";

/**
 * Strict secret redaction utility.
 * Sanitizes OpenAI keys, Google AIza keys, GitHub tokens, Slack tokens,
 * passwords, JWTs, and bearer tokens.
 */
export function redactSecrets(text: string | null | undefined): string {
  if (!text || typeof text !== "string") return "";

  return (
    text
      // 1. OpenAI API Keys (sk-..., sk-proj-..., sk-admin-..., ctx7sk-...)
      .replace(
        /(?:[a-zA-Z0-9_-]*?)sk-(?:proj-|admin-|org-)?[a-zA-Z0-9_-]{20,}/g,
        "[REDACTED_OPENAI_KEY]",
      )
      // 2. Google API Keys (AIza...)
      .replace(/\bAIza[0-9A-Za-z_-]{30,45}\b/g, "[REDACTED_GOOGLE_KEY]")
      // 3. GitHub Tokens (ghp_..., gho_..., github_pat_...)
      .replace(/\bgh[pousr]_[A-Za-z0-9_]{36,255}\b/g, "[REDACTED_GITHUB_TOKEN]")
      .replace(/\bgithub_pat_[a-zA-Z0-9_]{82}\b/g, "[REDACTED_GITHUB_TOKEN]")
      // 4. Slack tokens (xoxb-..., xoxp-...)
      .replace(/\bxox[baprs]-[0-9a-zA-Z]{10,48}\b/g, "[REDACTED_SLACK_TOKEN]")
      // 5. Bearer tokens in headers
      .replace(/\bBearer\s+[a-zA-Z0-9_.-]{20,}\b/gi, "Bearer [REDACTED_TOKEN]")
      // 6. Generic password / secret assignments in key-value format
      .replace(
        /([?&"'`\s]|^)(?:password|passwd|pwd|client_secret|api_key|apikey|secret_key|private_key)\s*[:=]\s*(['"]?)([^'"\s\\,;&]+)\2/gi,
        '$1password: "[REDACTED_PASSWORD]"',
      )
      // 7. JSON secret fields: "password": "...", "apiKey": "...", etc.
      .replace(
        /"(?:password|passwd|pwd|secret|apiKey|api_key|apiSecret|api_secret|auth_token|access_token|private_key)"\s*:\s*"[^"]*"/gi,
        (match) => {
          const key = match.split(":")[0];
          return `${key}: "[REDACTED_SECRET]"`;
        },
      )
      // 8. CLI flags --password=..., --token=...
      .replace(/--(?:password|passwd|token|secret)[=\s]+[^\s]+/gi, "--password=[REDACTED_SECRET]")
      // 9. JWT tokens (header.payload.signature)
      .replace(
        /\bey[A-Za-z0-9_-]{10,}\.ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9-_]{10,}\b/g,
        "[REDACTED_JWT]",
      )
  );
}

export interface SessionRecord {
  sessionId: string;
  recordedAt: string;
  host: string;
  os: string;
  kernel: string;
  platform: string;
  metadata?: Record<string, unknown>;
}

export interface AuditReportRecord {
  sessionId: string;
  domain: string;
  auditor: string;
  verdict: "HEALTHY" | "DEGRADED" | "CONFORME" | "NON_CONFORME" | "PARTIEL";
  summary: string;
  details: Record<string, unknown>;
  recordedAt: string;
}

export interface BenchmarkRecord {
  sessionId: string;
  benchmarkName: string;
  target: string;
  iterations: number;
  latencyUs: number;
  throughputOpsSec: number;
  metadata?: Record<string, unknown>;
  measuredAt: string;
}

export interface QualityGateRecord {
  sessionId: string;
  gateName: string;
  command: string;
  exitCode: number;
  passed: boolean;
  proofDetails: string;
  recordedAt: string;
}

export interface RemediationRecord {
  issueCode: string;
  component: string;
  description: string;
  status: "RESOLVED" | "OPEN" | "MITIGATED";
  patchCommit: string;
  resolvedAt: string;
}

export interface CodebaseFingerprintRecord {
  path: string;
  ext: string;
  sizeBytes: number;
  wyhash64: string;
  indexedAt: string;
}

/**
 * Initializes or opens the native Bun SQLite audit & training ledger database.
 */
export function initLedgerDatabase(customPath?: string): Database {
  const root = findRepoRoot();

  let dbPath: string;
  if (customPath) {
    dbPath = customPath;
  } else if (process.env.YOLO_LEDGER_DB) {
    dbPath = process.env.YOLO_LEDGER_DB;
  } else {
    // Canonical path priority:
    // 1. /var/log/yolo/yolo-train.sqlite if /var/log/yolo exists
    // 2. ~/.local/state/yolo/yolo-train.sqlite (user state dir)
    // 3. <root>/var/yolo-train.sqlite (repo state fallback)
    const userStateDir = process.env.XDG_STATE_HOME
      ? join(process.env.XDG_STATE_HOME, "yolo")
      : join(homedir(), ".local", "state", "yolo");

    if (existsSync("/var/log/yolo")) {
      dbPath = "/var/log/yolo/yolo-train.sqlite";
    } else {
      try {
        if (!existsSync(userStateDir)) {
          mkdirSync(userStateDir, { recursive: true, mode: 0o700 });
          chmodSync(userStateDir, 0o700);
        }
      } catch {}
      dbPath = existsSync(userStateDir)
        ? join(userStateDir, "yolo-train.sqlite")
        : join(root, "var", "yolo-train.sqlite");
    }
  }

  const dbDir = dirname(dbPath);
  const inMemory = dbPath === ":memory:";
  if (!inMemory && !existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  }

  const db = new Database(dbPath, { create: true });

  // Enforce 0600 permissions on the database file
  try {
    if (!inMemory) chmodSync(dbPath, 0o600);
  } catch {}

  // High performance WAL mode
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA synchronous = NORMAL;");

  // Ensure WAL and SHM journal files also have 0600 permissions
  for (const ext of ["-wal", "-shm"]) {
    if (inMemory) break;
    const journalPath = `${dbPath}${ext}`;
    if (existsSync(journalPath)) {
      try {
        chmodSync(journalPath, 0o600);
      } catch {}
    }
  }

  // Create tables if not existing
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      recorded_at TEXT NOT NULL,
      host TEXT NOT NULL,
      os TEXT NOT NULL,
      kernel TEXT NOT NULL,
      platform TEXT NOT NULL,
      metadata TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      auditor TEXT NOT NULL,
      verdict TEXT NOT NULL,
      summary TEXT NOT NULL,
      details TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS benchmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      benchmark_name TEXT NOT NULL,
      target TEXT NOT NULL,
      iterations INTEGER NOT NULL,
      latency_us INTEGER NOT NULL,
      throughput_ops_sec REAL NOT NULL,
      metadata TEXT,
      measured_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS quality_gates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      gate_name TEXT NOT NULL,
      command TEXT NOT NULL,
      exit_code INTEGER NOT NULL,
      passed INTEGER NOT NULL,
      proof_details TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS remediation_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_code TEXT NOT NULL,
      component TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      patch_commit TEXT NOT NULL,
      resolved_at TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS codebase_fingerprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      ext TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      wyhash64 TEXT NOT NULL,
      indexed_at TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agent_telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      target_path TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS training_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sample_id TEXT UNIQUE NOT NULL,
      profile TEXT NOT NULL DEFAULT 'yolo',
      domain TEXT NOT NULL,
      instruction TEXT NOT NULL,
      input_context TEXT NOT NULL,
      action TEXT NOT NULL,
      outcome TEXT NOT NULL,
      reward_score REAL NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Migrate existing table if 'profile' column is missing
  try {
    db.run("ALTER TABLE training_samples ADD COLUMN profile TEXT NOT NULL DEFAULT 'yolo';");
  } catch {
    // Column already exists
  }

  return db;
}

export interface AgentTelemetryRecord {
  agent: string;
  sessionId: string;
  eventType: string;
  targetPath: string;
  timestamp: string;
}

export interface TrainingSampleRecord {
  sampleId: string;
  profile?: string;
  domain: string;
  instruction: string;
  inputContext: string;
  action: string;
  outcome: string;
  rewardScore: number;
  createdAt: string;
}

export function recordAgentTelemetry(db: Database, event: AgentTelemetryRecord): void {
  const stmt = db.prepare(`
    INSERT INTO agent_telemetry (agent, session_id, event_type, target_path, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(
    event.agent,
    event.sessionId,
    event.eventType,
    redactSecrets(event.targetPath),
    event.timestamp,
  );
}

export function recordTrainingSample(db: Database, sample: TrainingSampleRecord): void {
  const profile = sample.profile ?? "yolo";
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO training_samples (sample_id, profile, domain, instruction, input_context, action, outcome, reward_score, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    sample.sampleId,
    profile,
    sample.domain,
    redactSecrets(sample.instruction),
    redactSecrets(sample.inputContext),
    redactSecrets(sample.action),
    redactSecrets(sample.outcome),
    sample.rewardScore,
    sample.createdAt,
  );
}

/**
 * Records a session entry.
 */
export function recordSession(db: Database, session: SessionRecord): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO sessions (session_id, recorded_at, host, os, kernel, platform, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    session.sessionId,
    session.recordedAt,
    session.host,
    session.os,
    session.kernel,
    session.platform,
    redactSecrets(JSON.stringify(session.metadata ?? {})),
  );
}

/**
 * Records an audit report.
 */
export function recordAuditReport(db: Database, audit: AuditReportRecord): void {
  const stmt = db.prepare(`
    INSERT INTO audit_reports (session_id, domain, auditor, verdict, summary, details, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    audit.sessionId,
    audit.domain,
    audit.auditor,
    audit.verdict,
    redactSecrets(audit.summary),
    redactSecrets(JSON.stringify(audit.details)),
    audit.recordedAt,
  );
}

/**
 * Records a benchmark metric.
 */
export function recordBenchmark(db: Database, bench: BenchmarkRecord): void {
  const stmt = db.prepare(`
    INSERT INTO benchmarks (session_id, benchmark_name, target, iterations, latency_us, throughput_ops_sec, metadata, measured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    bench.sessionId,
    bench.benchmarkName,
    bench.target,
    bench.iterations,
    bench.latencyUs,
    bench.throughputOpsSec,
    JSON.stringify(bench.metadata ?? {}),
    bench.measuredAt,
  );
}

/**
 * Records a quality gate check.
 */
export function recordQualityGate(db: Database, gate: QualityGateRecord): void {
  const stmt = db.prepare(`
    INSERT INTO quality_gates (session_id, gate_name, command, exit_code, passed, proof_details, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    gate.sessionId,
    gate.gateName,
    redactSecrets(gate.command),
    gate.exitCode,
    gate.passed ? 1 : 0,
    redactSecrets(gate.proofDetails),
    gate.recordedAt,
  );
}

/**
 * Records a remediation action.
 */
export function recordRemediation(db: Database, rem: RemediationRecord): void {
  const stmt = db.prepare(`
    INSERT INTO remediation_ledger (issue_code, component, description, status, patch_commit, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    rem.issueCode,
    rem.component,
    redactSecrets(rem.description),
    rem.status,
    rem.patchCommit,
    rem.resolvedAt,
  );
}

/**
 * Enforces strict permissions (0700 on directories, 0600 on SQLite/journal files).
 */
export function enforceLedgerPermissions(customPath?: string): void {
  if (customPath === ":memory:") return;
  const root = findRepoRoot();
  const userStateDir = process.env.XDG_STATE_HOME
    ? join(process.env.XDG_STATE_HOME, "yolo")
    : join(homedir(), ".local", "state", "yolo");

  const candidates = customPath
    ? [customPath]
    : [
        "/var/log/yolo/yolo-train.sqlite",
        join(userStateDir, "yolo-train.sqlite"),
        join(root, "var", "yolo-train.sqlite"),
      ];

  for (const dbPath of candidates) {
    if (!existsSync(dbPath)) continue;
    try {
      chmodSync(dbPath, 0o600);
    } catch {}
    for (const ext of ["-wal", "-shm"]) {
      const jPath = `${dbPath}${ext}`;
      if (existsSync(jPath)) {
        try {
          chmodSync(jPath, 0o600);
        } catch {}
      }
    }
  }
}

/**
 * Recursively scans and indexes all source files in the codebase using Wyhash64.
 * Skips target/, node_modules/, .git/, vendor/, .venv/, etc.
 */
export function indexCodebaseFingerprints(db: Database, rootDir: string): number {
  const root = resolve(rootDir);
  const IGNORE = new Set([
    ".git",
    "node_modules",
    "target",
    "vendor",
    ".venv",
    ".cache",
    "dist",
    ".tmp",
    "var",
  ]);

  let count = 0;
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO codebase_fingerprints (path, ext, size_bytes, wyhash64, indexed_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();

  function scan(dir: string) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.isFile()) {
        try {
          const ext = entry.name.includes(".") ? entry.name.split(".").pop() || "" : "";
          const content = readFileSync(fullPath);
          const hash = Bun.hash.wyhash(content).toString(16);
          const relPath = relative(root, fullPath).replaceAll("\\", "/");

          insertStmt.run(relPath, ext, content.byteLength, hash, now);
          count++;
        } catch {
          // Ignore unreadable or locked files
        }
      }
    }
  }

  db.transaction(() => {
    scan(root);
  })();

  return count;
}

/**
 * Produces a consolidated JSON and Markdown summary of the ledger.
 */
export function summarizeLedger(db: Database): {
  sessionCount: number;
  auditCount: number;
  benchmarkCount: number;
  gateCount: number;
  fingerprintCount: number;
  remediations: RemediationRecord[];
} {
  const sessionCount = (
    db.query("SELECT COUNT(*) as count FROM sessions").get() as { count: number }
  ).count;
  const auditCount = (
    db.query("SELECT COUNT(*) as count FROM audit_reports").get() as { count: number }
  ).count;
  const benchmarkCount = (
    db.query("SELECT COUNT(*) as count FROM benchmarks").get() as { count: number }
  ).count;
  const gateCount = (
    db.query("SELECT COUNT(*) as count FROM quality_gates").get() as { count: number }
  ).count;
  const fingerprintCount = (
    db.query("SELECT COUNT(*) as count FROM codebase_fingerprints").get() as { count: number }
  ).count;

  const remediations = db
    .query(
      "SELECT issue_code as issueCode, component, description, status, patch_commit as patchCommit, resolved_at as resolvedAt FROM remediation_ledger",
    )
    .all() as RemediationRecord[];

  return {
    sessionCount,
    auditCount,
    benchmarkCount,
    gateCount,
    fingerprintCount,
    remediations,
  };
}
