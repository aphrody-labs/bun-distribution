// SPDX-License-Identifier: Apache-2.0
// Audit first; apply only exact, declared replacements with verified destination provenance.
import { createHash } from "node:crypto";
import { chmodSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type Rule = {
  id: string;
  config: string;
  format: "toml" | "json";
  key: string;
  from: string;
  to: string;
  kind: "executable" | "library" | "installation";
  sha256?: string;
  anchor?: string;
  provenance?: "aphrody-bun";
};
export type PathRule = {
  id: string;
  scope: "user" | "machine";
  from: string;
  to: string;
  kind: "installation";
  anchor: string;
  sha256: string;
};

type Result = {
  id: string;
  status: "current" | "ready" | "fixed" | "missing-config" | "unmatched" | "unverified" | "invalid";
};
export type PathAudit = { checked: number; missing: number; duplicate: number; skipped: number };
const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const asObject = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function getKey(document: unknown, key: string): unknown {
  let value = document;
  for (const part of key.split(".")) value = asObject(value)?.[part];
  return value;
}

function parseDocument(text: string, format: Rule["format"]): unknown {
  return format === "toml" ? Bun.TOML.parse(text) : JSON.parse(text);
}

function replaceToml(text: string, key: string, expected: string, target: string): string {
  const parts = key.split(".");
  const field = parts.pop();
  if (!field || parts.some((part) => !/^[\w-]+$/.test(part)) || !/^[\w-]+$/.test(field))
    throw new Error("unsupported key");
  const section = parts.join(".");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  let active = section === "";
  let changed = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const header = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(line);
    if (header) {
      active = header[1]!.trim() === section;
      continue;
    }
    if (!active) continue;
    const assignment = /^(\s*([\w-]+)\s*=\s*)(['"])(.*)\3(\s*(?:#.*)?)$/.exec(line);
    if (!assignment || assignment[2] !== field) continue;
    // The parsed TOML value has already been checked; do not interpret the source text ourselves.
    lines[index] = `${assignment[1]}'${target.replaceAll("'", "\\'")}'${assignment[5]}`;
    changed++;
  }
  if (changed !== 1 || getKey(Bun.TOML.parse(lines.join(newline)), key) !== target)
    throw new Error("ambiguous TOML replacement");
  if (getKey(Bun.TOML.parse(text), key) !== expected) throw new Error("source changed");
  return lines.join(newline);
}

function replacement(text: string, rule: Rule): string {
  if (rule.format === "toml") return replaceToml(text, rule.key, rule.from, rule.to);
  const key = rule.key.split(".").at(-1)!;
  const pattern = new RegExp(
    `(${escapeRegex(JSON.stringify(key))}\\s*:\\s*)${escapeRegex(JSON.stringify(rule.from))}`,
    "g",
  );
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) throw new Error("ambiguous JSON replacement");
  const match = matches[0]!;
  const result =
    text.slice(0, match.index) +
    match[1] +
    JSON.stringify(rule.to) +
    text.slice(match.index + match[0].length);
  if (getKey(JSON.parse(result), rule.key) !== rule.to) throw new Error("wrong JSON key");
  return result;
}

async function verifyTarget(
  rule: Pick<Rule, "to" | "kind" | "sha256" | "anchor" | "provenance">,
): Promise<boolean> {
  if (!isAbsolute(rule.to)) return false;
  let artifact = rule.to;
  try {
    const target = statSync(rule.to);
    if (rule.kind === "installation") {
      if (
        !target.isDirectory() ||
        !rule.anchor ||
        isAbsolute(rule.anchor) ||
        rule.anchor.includes("..")
      )
        return false;
      artifact = resolve(rule.to, rule.anchor);
      if (!artifact.toLowerCase().startsWith(`${resolve(rule.to).toLowerCase()}\\`)) return false;
    } else if (!target.isFile()) return false;
    const data = readFileSync(artifact);
    if (rule.kind !== "installation" && (data[0] !== 0x4d || data[1] !== 0x5a)) return false;
    if (rule.sha256 && digest(data) !== rule.sha256.toLowerCase()) return false;
    if (!rule.sha256 && rule.provenance !== "aphrody-bun") return false;
    if (rule.provenance === "aphrody-bun") {
      if (rule.kind !== "executable") return false;
      const process = Bun.spawn([rule.to, "agent-plugin", "doctor", "--json"], {
        stdout: "pipe",
        stderr: "ignore",
        signal: AbortSignal.timeout(15_000),
      });
      const output = await new Response(process.stdout).text();
      if ((await process.exited) !== 0) return false;
      const doctor = JSON.parse(output);
      if (doctor.aphrody !== true || doctor.current !== true) return false;
      if (
        resolve(doctor.installed?.executable ?? "").toLowerCase() !== resolve(rule.to).toLowerCase()
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function inspectRule(rule: Rule, apply = false): Promise<Result> {
  const out = (status: Result["status"]): Result => ({ id: rule.id, status });
  if (
    !rule.id ||
    !isAbsolute(rule.config) ||
    !rule.key ||
    !isAbsolute(rule.from) ||
    !isAbsolute(rule.to) ||
    !["toml", "json"].includes(rule.format) ||
    !["executable", "library", "installation"].includes(rule.kind) ||
    (rule.sha256 !== undefined && !/^[0-9a-fA-F]{64}$/.test(rule.sha256)) ||
    rule.from === rule.to
  )
    return out("invalid");
  let original: string;
  let metadata: ReturnType<typeof statSync>;
  try {
    metadata = statSync(rule.config);
    if (!metadata.isFile()) return out("invalid");
    original = readFileSync(rule.config, "utf8");
  } catch {
    return out("missing-config");
  }
  try {
    const actual = getKey(parseDocument(original, rule.format), rule.key);
    if (actual === rule.to) return out((await verifyTarget(rule)) ? "current" : "unverified");
    if (actual !== rule.from) return out("unmatched");
    if (!(await verifyTarget(rule))) return out("unverified");
    const next = replacement(original, rule);
    if (getKey(parseDocument(next, rule.format), rule.key) !== rule.to) return out("invalid");
    if (!apply) return out("ready");
    // Abort if another session edited the configuration after inspection.
    if (digest(readFileSync(rule.config)) !== digest(Buffer.from(original)))
      return out("unmatched");
    const temporary = join(dirname(rule.config), `.${crypto.randomUUID()}.path-repair.tmp`);
    try {
      await Bun.write(temporary, next, { mode: metadata.mode & 0o777 });
      chmodSync(temporary, metadata.mode & 0o777);
      renameSync(temporary, rule.config);
    } finally {
      try {
        unlinkSync(temporary);
      } catch {
        /* Atomic rename already consumed it. */
      }
    }
    return out("fixed");
  } catch {
    return out("invalid");
  }
}

export async function defaultRules(): Promise<Rule[]> {
  const config = join(homedir(), ".codex", "config.toml");
  const bun = process.execPath;
  return [
    {
      id: "codex-bun-mcp",
      config,
      format: "toml",
      key: "mcp_servers.bun.command",
      from: join(process.env.WINDIR || "C:\\Windows", "System32", "bun.exe"),
      to: bun,
      kind: "executable",
      provenance: "aphrody-bun",
    },
  ];
}

/** Read-only audit of literal absolute PATH entries. Variables and relative entries are skipped. */
export function auditPathEntries(value: string, isDirectory: (path: string) => boolean): PathAudit {
  const result: PathAudit = { checked: 0, missing: 0, duplicate: 0, skipped: 0 };
  const seen = new Set<string>();
  for (const entry of value.split(";")) {
    const path = entry.trim().replace(/^"|"$/g, "");
    if (!path || path.includes("%") || !isAbsolute(path)) {
      result.skipped++;
      continue;
    }
    const key = resolve(path).toLowerCase();
    if (seen.has(key)) {
      result.duplicate++;
      continue;
    }
    seen.add(key);
    result.checked++;
    if (!isDirectory(path)) result.missing++;
  }
  return result;
}

type RegistryValue = { value: string; type: "REG_SZ" | "REG_EXPAND_SZ" };
export type PathRegistry = {
  read(scope: PathRule["scope"]): Promise<RegistryValue | undefined>;
  write(scope: PathRule["scope"], expected: RegistryValue, next: string): Promise<boolean>;
};

const registryKey = (scope: PathRule["scope"]) =>
  scope === "user"
    ? "HKCU\\Environment"
    : "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment";

export const windowsPathRegistry: PathRegistry = {
  async read(scope) {
    if (process.platform !== "win32") return undefined;
    try {
      const child = Bun.spawn(["reg.exe", "query", registryKey(scope), "/v", "Path"], {
        stdout: "pipe",
        stderr: "ignore",
        signal: AbortSignal.timeout(5_000),
      });
      const output = await new Response(child.stdout).text();
      if ((await child.exited) !== 0) return undefined;
      const match = /^\s*Path\s+(REG_(?:EXPAND_)?SZ)\s+(.+)$/im.exec(output);
      return match ? { type: match[1] as RegistryValue["type"], value: match[2]! } : undefined;
    } catch {
      return undefined;
    }
  },
  async write(scope, expected, next) {
    const current = await this.read(scope);
    if (!current || current.type !== expected.type || current.value !== expected.value)
      return false;
    try {
      const child = Bun.spawn(
        ["reg.exe", "add", registryKey(scope), "/v", "Path", "/t", expected.type, "/d", next, "/f"],
        {
          stdout: "ignore",
          stderr: "ignore",
          signal: AbortSignal.timeout(5_000),
        },
      );
      if ((await child.exited) !== 0) return false;
      const after = await this.read(scope);
      return after?.type === expected.type && after.value === next;
    } catch {
      return false;
    }
  },
};

export async function inspectPathRule(
  rule: PathRule,
  apply = false,
  registry = windowsPathRegistry,
): Promise<Result> {
  const out = (status: Result["status"]): Result => ({ id: rule.id, status });
  if (
    !rule.id ||
    !["user", "machine"].includes(rule.scope) ||
    !isAbsolute(rule.from) ||
    !isAbsolute(rule.to) ||
    rule.from === rule.to ||
    rule.kind !== "installation" ||
    !rule.anchor ||
    !/^[0-9a-fA-F]{64}$/.test(rule.sha256)
  )
    return out("invalid");
  const current = await registry.read(rule.scope);
  if (!current) return out("unverified");
  const entries = current.value.split(";");
  if (entries.includes(rule.to) && !entries.includes(rule.from))
    return out((await verifyTarget(rule)) ? "current" : "unverified");
  const indices = entries.flatMap((value, index) => (value === rule.from ? [index] : []));
  if (indices.length !== 1) return out("unmatched");
  if (!(await verifyTarget(rule))) return out("unverified");
  entries[indices[0]!] = rule.to;
  if (!apply) return out("ready");
  return out(
    (await registry.write(rule.scope, current, entries.join(";"))) ? "fixed" : "unmatched",
  );
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: bun scripts/tools/infra/repair-global-paths.ts [--manifest rules.json] [--audit-path] [--apply]",
    );
    process.exit(0);
  }
  const manifestIndex = args.indexOf("--manifest");
  if (
    args.some(
      (arg, index) =>
        (arg.startsWith("--") && !["--manifest", "--audit-path", "--apply"].includes(arg)) ||
        (arg === "--manifest" && (!args[index + 1] || args[index + 1]!.startsWith("--"))) ||
        (!arg.startsWith("--") && (index === 0 || args[index - 1] !== "--manifest")),
    ) ||
    args.filter((arg) => arg === "--manifest").length > 1
  ) {
    console.error("Invalid arguments");
    process.exit(2);
  }
  let rules: (Rule | PathRule)[];
  try {
    rules =
      manifestIndex < 0
        ? await defaultRules()
        : ((await Bun.file(args[manifestIndex + 1]!).json()) as (Rule | PathRule)[]);
  } catch {
    console.error("Invalid manifest");
    process.exit(2);
  }
  if (!Array.isArray(rules) || rules.some((rule) => !asObject(rule))) {
    console.error("Invalid manifest");
    process.exit(2);
  }
  const results: Result[] = [];
  // oxlint-disable no-await-in-loop -- Rules may share one configuration file.
  for (const rule of rules) {
    results.push(
      "scope" in rule
        ? await inspectPathRule(rule, args.includes("--apply"))
        : await inspectRule(rule, args.includes("--apply")),
    );
  }
  // oxlint-enable no-await-in-loop
  for (const result of results) console.log(`${result.id}: ${result.status}`);
  if (args.includes("--audit-path")) {
    // oxlint-disable no-await-in-loop -- Registry scopes are read in order and never modified.
    for (const scope of ["process", "user", "machine"] as const) {
      const value =
        scope === "process"
          ? (process.env.Path ?? process.env.PATH)
          : (await windowsPathRegistry.read(scope))?.value;
      if (value === undefined) {
        console.log(`${scope}-path: unavailable`);
        continue;
      }
      const audit = auditPathEntries(value, (path) => {
        try {
          return statSync(path).isDirectory();
        } catch {
          return false;
        }
      });
      console.log(
        `${scope}-path: checked=${audit.checked} missing=${audit.missing} duplicate=${audit.duplicate} skipped=${audit.skipped}`,
      );
    }
    // oxlint-enable no-await-in-loop
  }
  if (
    results.some((result) =>
      ["invalid", "unverified", "unmatched", "missing-config"].includes(result.status),
    )
  )
    process.exitCode = 1;
}
