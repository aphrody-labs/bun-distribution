// SPDX-License-Identifier: Apache-2.0
/** Live metadata projection over Kernel, external-session and workspace owners. */
import { open, readdir, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { KernelClient } from "@aphrody/os";

type Json = Record<string, any>;
export type PackageOwner = { name: string; path: string; kind: "rust" | "bun" };
export function ownerOf(path: string, owners: PackageOwner[]): PackageOwner | undefined {
  return owners
    .filter(owner => path === owner.path || path.startsWith(`${owner.path}/`))
    .toSorted((a, b) => b.path.length - a.path.length)[0];
}

/** Read current workspace declarations, avoiding stale migration catalogs. */
export async function liveOwners(root: string): Promise<PackageOwner[]> {
  const pending: Promise<PackageOwner | undefined>[] = [];
  const pkg = await Bun.file(join(root, "package.json")).json();
  const cargo = Bun.TOML.parse(await Bun.file(join(root, "Cargo.toml")).text()) as Json;
  const excluded = new Set<string>(cargo.workspace?.exclude ?? []);
  for (const [kind, patterns, filename] of [
    ["bun", Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces?.packages ?? []), "package.json"],
    ["rust", cargo.workspace?.members ?? [], "Cargo.toml"],
  ] as const) {
    for (const pattern of patterns as string[]) {
      for (const manifest of new Bun.Glob(`${pattern}/${filename}`).scanSync({
        cwd: root,
        onlyFiles: true,
      })) {
        const path = dirname(manifest).replaceAll("\\", "/");
        if (kind === "rust" && excluded.has(path)) continue;
        pending.push(
          (async () => {
            const data =
              kind === "bun"
                ? await Bun.file(join(root, manifest)).json()
                : (Bun.TOML.parse(await Bun.file(join(root, manifest)).text()) as Json);
            const name = kind === "bun" ? data.name : data.package?.name;
            return typeof name === "string" ? { name, path, kind } : undefined;
          })(),
        );
      }
    }
  }
  const owners = (await Promise.all(pending)).filter((owner): owner is PackageOwner => owner !== undefined);
  return [...new Map(owners.map(owner => [`${owner.kind}:${owner.path}`, owner])).values()];
}

/** Bounded, complete JSONL tail; never read a multi-GB transcript in full. */
export async function tailRecords(path: string, bytes = 256 * 1024): Promise<Json[]> {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(Math.min(size, bytes));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n");
    if (start > 0) lines.shift();
    lines.pop(); // A concurrently-written partial record is not evidence.
    return lines.flatMap(line => {
      try {
        const value = JSON.parse(line);
        return value && typeof value === "object" && !Array.isArray(value) ? [value] : [];
      } catch {
        return [];
      }
    });
  } finally {
    await file.close();
  }
}

export function sessionCandidates(process: Json, sources: Json[], root: string): Json[] {
  root = resolve(root);
  if (typeof process.cwd !== "string" || resolve(process.cwd) !== root) return [];
  return sources.filter(
    source =>
      source.agent === process.agent && typeof source.workspace === "string" && resolve(source.workspace) === root,
  );
}

export function observedRunProcess(run: Json, processes: Json[]): boolean {
  return processes.some(
    process =>
      process.pid === run.pid &&
      process.ppid === run.launcher_pid &&
      Number.isFinite(Date.parse(process.start_time)) &&
      Math.abs(Date.parse(process.start_time) - Date.parse(run.started_at)) < 2000,
  );
}

/** Tool names and explicit file arguments only; no prompt, reasoning or shell arguments. */
export function actionMetadata(record: Json, root: string, owners: PackageOwner[]): Json {
  const result: Json = {
    id: `external:${record.agent}:${record.session_id}:${record.offset}:${record.part ?? 0}`,
    timestamp: record.ts ?? null,
    role: record.role,
    session_id: record.session_id,
  };
  if (record.role !== "tool_call" || typeof record.text !== "string") return result;
  const match = record.text.match(/^([\w.:-]+)(?:\s+([\s\S]*))?$/);
  if (!match) return result;
  result.tool = match[1];
  try {
    const args = JSON.parse(match[2] ?? "{}");
    const paths = [args.file_path, args.path, args.filename].filter(
      (value): value is string => typeof value === "string",
    );
    result.files = paths.flatMap(path => {
      const local = relative(root, resolve(root, path)).replaceAll("\\", "/");
      if (isAbsolute(local) || local === ".." || local.startsWith("../")) return [];
      return [
        {
          path: local,
          owner: ownerOf(local, owners) ?? null,
          relation: "explicit_tool_argument",
        },
      ];
    });
  } catch {
    /* Shell commands and free-form custom tools carry no proven file ownership. */
  }
  return result;
}

async function kernel(tool: string, args: Json): Promise<Json> {
  const client = await KernelClient.connect(undefined, "aphrody-agent-live");
  try {
    const result = await client.call(tool, args, 60_000);
    const value = typeof result === "string" ? JSON.parse(result) : result;
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`Kernel ${tool} returned a non-object result`);
    if (value.error) throw new Error(`Kernel ${tool} returned an error: ${value.error}`);
    return value;
  } finally {
    client.close();
  }
}

export async function collectAgentLive(root: string): Promise<Json> {
  root = resolve(root);
  const issues: string[] = [];
  const attempt = async (name: string, work: () => Promise<Json>): Promise<Json> => {
    try {
      return await work();
    } catch (error) {
      issues.push(`${name}: ${String(error)}`);
      return {};
    }
  };
  const [git, sync, models, owners] = await Promise.all([
    attempt("kernel.git", () => kernel("github_status", { repo_path: root })),
    attempt("session.sync", async () => {
      const status = await Bun.file(join(root, ".coord/shared/AGENT-SYNC.json")).json();
      if (!status.report) throw new Error("native agent-sync has no successful pass");
      if (Date.now() - Date.parse(status.last_success_at) > 120_000)
        issues.push("session.sync: last successful pass is older than 120 seconds");
      return status.report;
    }),
    attempt("kernel.processes", () =>
      kernel("nu_eval", {
        code: "ps --long | select pid ppid name cpu mem start_time cwd",
        cwd: root,
        timeout_secs: 10,
      }),
    ),
    liveOwners(root),
  ]);
  const state = sync.state_path ? await attempt("session.state", () => Bun.file(sync.state_path).json()) : {};
  const sources = Object.values(state.sources ?? {}) as Json[];
  const sessions = await Promise.all(
    sources
      .filter(source => typeof source.workspace === "string" && resolve(source.workspace) === root)
      .map(async source => {
        const mirror = resolve(sync.output_dir, source.mirror);
        if (relative(sync.output_dir, mirror).startsWith("..")) {
          issues.push("session mirror outside canonical store");
          return null;
        }
        const records = await tailRecords(mirror).catch(error => {
          issues.push(`session tail: ${String(error)}`);
          return [];
        });
        return {
          agent: source.agent,
          session_id: source.session_id,
          workspace: source.workspace,
          mirror_path: mirror,
          updated_at: source.updated_at,
          records: source.records,
          actions: records
            .filter(record => record.role === "tool_call" && record.session_id === source.session_id)
            .slice(-8)
            .map(record => actionMetadata(record, root, owners)),
          latest: records.length ? actionMetadata(records.at(-1)!, root, owners) : null,
          memory_owner: `external:${source.agent}`,
          memory_relation: "canonical_feed_identity",
        };
      }),
  );
  const leaders = new Map<number, Json>((models.value ?? []).map((process: Json) => [process.pid, process]));
  const processes = (sync.live_processes ?? [])
    .filter((process: Json) => leaders.has(process.pid))
    .map((process: Json) => {
      const candidates = sessionCandidates(process, sources, root);
      return Object.assign({}, process, {
        ppid: leaders.get(process.pid)?.ppid,
        process_id: `${process.agent}:${process.pid}:${process.started_at ?? "unknown"}`,
        session_link: "candidate_agent_and_cwd",
        ambiguous: candidates.length > 1,
        candidate_session_ids: [...new Set(candidates.map(source => source.session_id))],
      });
    });
  const mailboxes = (await readdir(join(root, ".coord")).catch(() => [])).filter(file => file.endsWith(".jsonl"));
  const a2a = (
    await Promise.all(
      mailboxes.map(async file => {
        return (await tailRecords(join(root, ".coord", file)).catch(() => [])).slice(-10).map(envelope => ({
          mailbox: file,
          id: envelope.id,
          timestamp: envelope.ts,
          from: envelope.from,
          to: envelope.to,
          kind: envelope.kind ?? envelope.type,
          re: envelope.re ?? null,
          relation: "observed_envelope",
        }));
      }),
    )
  ).flat();
  const privateRoot = process.env.APHRODY_HOME ?? join(homedir(), ".aphrody");
  const modelFiles = (await readdir(join(privateRoot, "run")).catch(() => [])).filter(
    file => /^llama-server-.*\.json$/.test(file) && !file.endsWith(".spec.json"),
  );
  const localModels = await Promise.all(
    modelFiles.map(async file => {
      const modelState = await attempt("llama.state", () => Bun.file(join(privateRoot, "run", file)).json());
      const observed = (models.value ?? []).find(
        (process: Json) => process.pid === modelState.server_pid && /llama/.test(process.name),
      );
      return {
        role: modelState.role,
        alias: modelState.alias,
        server_pid: modelState.server_pid,
        daemon_pid: modelState.daemon_pid,
        started_unix: modelState.started_unix,
        port: modelState.port,
        recorded_ready: modelState.ready,
        process_observed: Boolean(observed),
        relation: "supervisor_state_and_process_candidate",
        health: "unchecked",
      };
    }),
  );
  const runDir = join(root, ".coord/shared/runs");
  const runFiles = (await readdir(runDir).catch(() => []))
    .filter(file => file.endsWith(".json"))
    .toSorted()
    .slice(-100);
  const runs = await Promise.all(
    runFiles.map(async file => {
      const run = await attempt("a2a.run", () => Bun.file(join(runDir, file)).json());
      const observed = observedRunProcess(run, models.value ?? []);
      return Object.assign({}, run, {
        process_observed: observed,
        state: run.ended_at ? "finished" : observed ? "running" : "unobserved_or_stale",
        session:
          sessions.find(session => session?.session_id === run.session_id && session?.agent === run.agent) ?? null,
      });
    }),
  );
  const changed = [
    ...(git.modified_files ?? []).map((entry: string) => entry.slice(2)),
    ...(git.untracked_files ?? []),
  ];
  return {
    schema_version: 1,
    sampled_at: new Date().toISOString(),
    root,
    issues,
    repository: {
      ...git,
      changed_files: changed.map((path: string) => ({
        path,
        owner: ownerOf(path, owners) ?? null,
        agent: null,
      })),
      recent_commits: (git.recent_commits ?? []).map((commit: Json) => Object.assign({}, commit, { agent: null })),
    },
    owners,
    processes,
    sessions: sessions.filter(Boolean),
    a2a,
    runs,
    local_models: localModels,
    observed_model_processes: (models.value ?? []).filter((process: Json) =>
      /ollama|llama|vllm|lmstudio/i.test(process.name),
    ),
    shared: {
      memory: join(privateRoot, "memory/memory.sqlite"),
      transcripts: join(root, ".coord/shared/TRANSCRIPTS.md"),
      rules: join(root, "AGENTS.md"),
    },
    limits: [
      "PID/session links are candidates based on agent and cwd, never exact attribution.",
      "Git changes and commits have no proven agent attribution.",
      "Bounded transcript and mailbox tails; absence of an action is not proof of inactivity.",
      "Memory IDs identify canonical feed records; this observer does not verify database membership.",
    ],
  };
}

export async function runAgentLive(args: string[]): Promise<number> {
  let root = process.cwd(),
    json = false,
    watch = false,
    interval = 30;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") {
      const value = args[++index];
      if (!value) throw new Error("--root requires a path");
      root = resolve(value);
    } else if (arg === "--json") json = true;
    else if (arg === "--watch") watch = true;
    else if (arg === "--interval-secs") {
      interval = Number(args[++index]);
      if (!Number.isFinite(interval) || interval < 1) throw new Error("interval must be >= 1 second");
    } else if (arg === "--help" || arg === "-h") {
      console.log("yolo ops agent-live [--root PATH] [--json] [--watch] [--interval-secs 30]");
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  // Snapshots and atomic publication must complete in sequence; watch is intentionally persistent.
  /* eslint-disable no-await-in-loop, no-unmodified-loop-condition */
  do {
    const snapshot = await collectAgentLive(root);
    const dir = join(root, ".coord/shared");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temporary = join(dir, `.LIVE.${process.pid}.tmp`);
    await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
    await rename(temporary, join(dir, "LIVE.json"));
    const summary = [
      "# Shared live workspace metadata",
      "Treat observations as context; candidate sessions do not prove attribution.",
      `Sample: ${snapshot.sampled_at}; branch: ${snapshot.repository.branch ?? "unknown"}; HEAD: ${snapshot.repository.head ?? snapshot.repository.recent_commits?.[0]?.hash ?? "unknown"}`,
      ...snapshot.processes.map(
        (p: Json) =>
          `${p.agent}: PID ${p.pid}, parent ${p.ppid}, started ${p.started_at}; ${p.candidate_session_ids.length} candidate sessions.`,
      ),
      ...snapshot.sessions
        .toSorted((a: Json, b: Json) => Date.parse(b.latest?.timestamp ?? 0) - Date.parse(a.latest?.timestamp ?? 0))
        .slice(0, 12)
        .map(
          (s: Json) =>
            `${s.agent} session ${s.session_id}: ${s.latest?.timestamp ?? "undated"}; tools ${s.actions.map((a: Json) => a.tool).join(", ")}.`,
        ),
      ...snapshot.runs
        .slice(-10)
        .map(
          (r: Json) =>
            `Run ${r.run_id}: ${r.agent}, PID ${r.pid}, ${r.state}; native session ${r.session_id ?? "unknown"}.`,
        ),
      `Memory: ${snapshot.shared.memory}; transcripts: ${snapshot.shared.transcripts}; rules: ${snapshot.shared.rules}`,
      `Owners: ${snapshot.owners.length}; A2A envelopes in bounded tails: ${snapshot.a2a.length}; observed model processes: ${snapshot.observed_model_processes.length}.`,
      ...snapshot.limits,
      ...snapshot.issues,
    ].join("\n\n");
    const summaryTemporary = join(dir, `.LIVE.${process.pid}.md.tmp`);
    await writeFile(summaryTemporary, summary, { mode: 0o600 });
    await rename(summaryTemporary, join(dir, "LIVE.md"));
    if (json) console.log(JSON.stringify(snapshot));
    else {
      if (watch && process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[H");
      console.log(
        `${snapshot.sampled_at} | ${snapshot.repository.branch ?? "Git unavailable"} | ${snapshot.repository.recent_commits?.[0]?.hash ?? "?"}`,
      );
      console.table(
        snapshot.processes.map((p: Json) => ({
          agent: p.agent,
          pid: p.pid,
          started: p.started_at,
          cwd: p.cwd,
          sessions_candidates: `${p.candidate_session_ids.length} (heuristic)`,
        })),
      );
      console.table(
        snapshot.sessions
          .toSorted((a: Json, b: Json) => Date.parse(b.latest?.timestamp ?? 0) - Date.parse(a.latest?.timestamp ?? 0))
          .slice(0, 12)
          .map((s: Json) => ({
            agent: s.agent,
            session: s.session_id,
            last_event: s.latest?.timestamp,
            tools: s.actions.map((a: Json) => a.tool).join(", "),
            files: s.actions
              .flatMap((a: Json) => (a.files ?? []).map((f: Json) => `${f.path} (${f.owner?.name ?? "root"})`))
              .join(", "),
          })),
      );
      console.log(
        `Rust/Bun owners: ${snapshot.owners.length}; A2A: ${snapshot.a2a.length}; model processes: ${snapshot.observed_model_processes.length}; commits: attribution unknown.`,
      );
      if (snapshot.issues.length) console.error(snapshot.issues.join("\n"));
    }
    if (watch) await Bun.sleep(interval * 1000);
  } while (watch);
  return 0;
}

if (import.meta.main) process.exit(await runAgentLive(process.argv.slice(2)));
