// SPDX-License-Identifier: Apache-2.0
// `host-plan` / `host-apply`: from a unit's catalog entry and its composed text, derive the ordered steps that install it
// on the target host (preflight, provision, install, verify, rollback). Plan by default; `--observe` only runs the
// read-only preflight commands; mutation needs `--apply` and an explicit `--target`. Same convention as
// scripts/release/publish-downloads.ts `host-plan | host-apply [--apply]`.
//   bun packages/engine/core/src/host/cli.ts host-plan aphrody-mcp-http aphrody-a2a [--observe] [--json]
//   bun packages/engine/core/src/host/cli.ts host-apply aphrody-a2a --target vps --apply
// oxlint-disable no-await-in-loop -- sequential by design: host commands run one after the other and stop on failure.
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { composeUnit, type HostUnit, hostRoot, loadCatalog } from "./index.ts";

export interface UnitFacts {
  unit: string;
  service: string;
  targetHost: string;
  user: string;
  workingDirectory?: string;
  execStart: string;
  binary: string;
  bind?: { host: string; port: number };
  envFiles: { path: string; optional: boolean }[];
  writePaths: string[];
}

export type StepPhase = "preflight" | "provision" | "install" | "verify" | "rollback";
/** `check` fails the plan, `info` only reports, `mutate` changes the host. */
export type StepKind = "check" | "info" | "mutate";
export interface PlanStep {
  id: string;
  unit: string;
  phase: StepPhase;
  kind: StepKind;
  note: string;
  /** Shell command run on the target host (through `aphrody infra ssh exec`). */
  run: string;
}
export interface Plan {
  target: string;
  units: string[];
  steps: PlanStep[];
}
export interface PlanOptions {
  root?: string;
  target?: string;
  expectTools?: number;
  /** A build already on the target host (for example in the factory target directory) to install as the unit's binary. */
  binary?: { from: string; sha256: string };
}
export type Runner = (
  host: string,
  command: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|localhost|\[?::1\]?)$/;
const STAGE_DIR = "/tmp/aphrody-host-plan";
const BUN = "/home/ubuntu/.bun/bin/bun";
/** Bearer token variable of `aphrody-mcp http`, generated on the host and read from the unit's EnvironmentFile. */
const MCP_TOKEN_ENV = "APHRODY_MCP_HTTP_TOKEN";
const b64 = (text: string) => Buffer.from(text).toString("base64");
const sq = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

/** Directives of the `[Service]` section of a composed unit (`key` -> every value, in order). */
function serviceDirectives(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let inService = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) inService = line === "[Service]";
    if (!inService || !line || line.startsWith("#") || line.startsWith("[")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    out.set(key, [...(out.get(key) ?? []), line.slice(eq + 1).trim()]);
  }
  return out;
}

export function unitFacts(entry: HostUnit, text: string): UnitFacts {
  const d = serviceDirectives(text);
  const execStart = d.get("ExecStart")?.[0];
  if (!execStart) throw new Error(`${entry.unit}: no ExecStart`);
  const address = /--bind\s+(\S+)/.exec(execStart)?.[1];
  let bind: UnitFacts["bind"];
  if (address) {
    const at = address.lastIndexOf(":");
    bind = { host: address.slice(0, at), port: Number(address.slice(at + 1)) };
    // Never a public listener: the plan refuses a unit that would bind anything but loopback.
    if (!LOOPBACK.test(bind.host) || !Number.isInteger(bind.port)) {
      throw new Error(`${entry.unit}: --bind ${address} is not a loopback address`);
    }
  }
  const paths = [...(d.get("ReadWritePaths") ?? []), ...(d.get("BindPaths") ?? [])]
    .flatMap((v) => v.split(/\s+/))
    .map((p) => p.replace(/^-/, "").split(":")[0] ?? "")
    .filter(Boolean);
  return {
    unit: entry.unit,
    service: entry.service,
    targetHost: entry.targetHost,
    user: d.get("User")?.[0] ?? "root",
    workingDirectory: d.get("WorkingDirectory")?.[0],
    execStart,
    binary: execStart.split(/\s+/)[0] ?? execStart,
    bind,
    envFiles: (d.get("EnvironmentFile") ?? []).map((v) => ({
      path: v.replace(/^-/, ""),
      optional: v.startsWith("-"),
    })),
    writePaths: [...new Set(paths)],
  };
}

interface ServiceEntry {
  id: string;
  port?: number;
  health?: string;
}
function serviceEntry(repoRoot: string, id: string): ServiceEntry | undefined {
  const file = join(repoRoot, "config/service-catalog.json");
  if (!existsSync(file)) return undefined;
  const catalog = JSON.parse(readFileSync(file, "utf8")) as { services: ServiceEntry[] };
  return catalog.services.find((s) => s.id === id);
}

/** Steps for one unit. `repoRoot` holds `ai.json`, `config/service-catalog.json` and `scripts/tools/infra`. */
function unitSteps(
  entry: HostUnit,
  text: string,
  repoRoot: string,
  expectTools?: number,
  binary?: PlanOptions["binary"],
): PlanStep[] {
  const f = unitFacts(entry, text);
  const svc = serviceEntry(repoRoot, entry.service);
  if (f.bind && svc?.port !== undefined && svc.port !== f.bind.port) {
    throw new Error(
      `${entry.unit}: binds :${f.bind.port} but config/service-catalog.json declares :${svc.port}`,
    );
  }
  const step = (
    phase: StepPhase,
    kind: StepKind,
    id: string,
    note: string,
    run: string,
  ): PlanStep => ({ id: `${f.service}/${id}`, unit: f.unit, phase, kind, note, run });
  const port = f.bind?.port;
  const stage = `${STAGE_DIR}/${f.unit}`;
  const steps: PlanStep[] = [];

  const mcp = f.service === "aphrody-mcp-http";
  const install = mcp ? binary : undefined;
  if (install && !/^[0-9a-f]{64}$/.test(install.sha256)) {
    throw new Error(`${f.unit}: --binary-sha256 must be a 64 hex digit SHA-256`);
  }
  const tokenFile = f.envFiles.find((e) => !e.optional)?.path;
  steps.push(
    install
      ? step(
          "preflight",
          "check",
          "binary-artifact",
          `${install.from} is the expected build (sha256 ${install.sha256.slice(0, 12)}...) and is installed as ${f.binary}`,
          `test -x ${sq(install.from)} && echo ${install.sha256}'  '${sq(install.from)} | sha256sum -c --quiet -`,
        )
      : step(
          "preflight",
          "check",
          "binary",
          `${f.binary} is installed and runs`,
          `test -x ${f.binary} && ${f.binary} --version`,
        ),
    step(
      "preflight",
      "info",
      "binary-sha256",
      "identity of the binary the unit will run",
      `sha256sum ${f.binary}`,
    ),
  );
  if (port !== undefined) {
    steps.push(
      step(
        "preflight",
        "check",
        "port-free",
        `nothing listens on :${port} yet (a reverse tunnel or another unit holding it would make the unit fail to bind)`,
        `! ss -H -ltn "sport = :${port}" | grep -q .`,
      ),
    );
  }
  for (const p of f.writePaths) {
    steps.push(
      step(
        "preflight",
        "info",
        `path:${p}`,
        "state path the sandbox lets the unit write",
        `stat -c '%U:%G %a %n' ${p} || echo "absent ${p}"`,
      ),
    );
  }
  for (const e of f.envFiles) {
    steps.push(
      step(
        "preflight",
        "info",
        `env:${basename(e.path)}`,
        `${e.optional ? "optional " : ""}EnvironmentFile (read by systemd as root; key names only, never values)`,
        `sudo -n stat -c '%U:%G %a %n' ${e.path} 2>/dev/null || echo "absent ${e.path}"`,
      ),
    );
  }
  steps.push(
    step(
      "preflight",
      "info",
      "installed",
      "current state of the unit on the host",
      `systemctl is-enabled ${f.unit} 2>&1; systemctl is-active ${f.unit} 2>&1; true`,
    ),
  );

  if (f.service === "aphrody-a2a") {
    const aiJson = join(repoRoot, "ai.json");
    if (!existsSync(aiJson))
      throw new Error(
        `${f.unit}: ${aiJson} is missing (the A2A server needs ai.json in its working directory)`,
      );
    const content = readFileSync(aiJson, "utf8");
    const dir = f.workingDirectory ?? "/srv/aphrody/shared/a2a";
    steps.push(
      step(
        "provision",
        "mutate",
        "ai-json",
        `ai.json of the repository revision into ${dir} (replaces the dangling link to the retired /srv/aphrody/current)`,
        `rm -f ${dir}/ai.json && printf %s ${sq(b64(content))} | base64 -d > ${dir}/ai.json && chmod 0644 ${dir}/ai.json`,
      ),
      step(
        "provision",
        "mutate",
        "coord-link",
        `${dir}/.coord points at the persistent coord directory (mailbox of /msg and JSON-RPC)`,
        `[ -e ${dir}/.coord ] || ln -s /srv/aphrody/shared/coord ${dir}/.coord`,
      ),
    );
  }
  if (mcp && tokenFile) {
    // The token is made on the host and never leaves it: nothing here prints it, and the plan carries no value.
    const script = [
      "set -e",
      "umask 077",
      `f=${tokenFile}`,
      'touch "$f"',
      `grep -q "^${MCP_TOKEN_ENV}=.\\{32,\\}" "$f" || printf "${MCP_TOKEN_ENV}=%s\\n" "$(openssl rand -hex 32)" >> "$f"`,
      'chown root:root "$f"',
      'chmod 0600 "$f"',
    ].join("; ");
    steps.push(
      step(
        "provision",
        "mutate",
        "generate-token",
        `${tokenFile} (root:root 0600) holds ${MCP_TOKEN_ENV}, generated here with openssl and kept when already set`,
        `sudo -n sh -c ${sq(script)}`,
      ),
    );
  }
  if (install) {
    const dir = f.binary.slice(0, f.binary.lastIndexOf("/"));
    steps.push(
      step(
        "provision",
        "mutate",
        "install-binary",
        `install the build as ${f.binary}, the previous one is kept as ${f.binary}.prev (rollback: mv it back)`,
        `install -d -m 0755 ${dir} && install -m 0755 ${sq(install.from)} ${f.binary}.new && { [ ! -e ${f.binary} ] || cp -p ${f.binary} ${f.binary}.prev; } && mv -f ${f.binary}.new ${f.binary}`,
      ),
    );
  }
  if (mcp) {
    steps.push(
      step(
        "provision",
        "mutate",
        "xdg-dirs",
        "XDG cache/config/data directories inside the writable state directory",
        "install -d -m 0700 /home/ubuntu/.aphrody/xdg/cache /home/ubuntu/.aphrody/xdg/config /home/ubuntu/.aphrody/xdg/data",
      ),
    );
  }

  steps.push(
    step(
      "install",
      "mutate",
      "stage",
      `write the composed unit (drop-ins applied) to ${stage}`,
      `mkdir -p ${STAGE_DIR} && printf %s ${sq(b64(text))} | base64 -d > ${stage}`,
    ),
    step(
      "install",
      "check",
      "systemd-verify",
      "systemd accepts the unit",
      `systemd-analyze verify ${stage}`,
    ),
    step(
      "install",
      "mutate",
      "install",
      `install /etc/systemd/system/${f.unit} (root:root 0644)`,
      `sudo install -o root -g root -m 0644 ${stage} /etc/systemd/system/${f.unit}`,
    ),
    step("install", "mutate", "daemon-reload", "reload systemd", "sudo systemctl daemon-reload"),
    step(
      "install",
      "mutate",
      "enable-now",
      "enable at boot and start",
      `sudo systemctl enable --now ${f.unit}`,
    ),
  );

  steps.push(
    step(
      "verify",
      "check",
      "active",
      "the unit is active",
      `systemctl is-active --quiet ${f.unit}`,
    ),
  );
  if (port !== undefined) {
    steps.push(
      step(
        "verify",
        "check",
        "listen-loopback",
        `every listener on :${port} is loopback (never 0.0.0.0, [::] or a public address)`,
        `l=$(ss -H -ltn "sport = :${port}" | awk '{print $4}'); [ -n "$l" ] && ! echo "$l" | grep -qvE '^(127\\.0\\.0\\.1|\\[::1\\]):'`,
      ),
    );
  }
  if (svc?.health) {
    steps.push(
      step("verify", "check", "health", `GET ${svc.health}`, `curl -fsS -m 5 ${svc.health}`),
    );
  }
  if (mcp && port !== undefined) {
    const post = `curl -s -o /dev/null -m 5 -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'`;
    steps.push(
      step(
        "verify",
        "check",
        "auth-required",
        "/mcp refuses a request without a token (401)",
        `[ "$(${post} http://127.0.0.1:${port}/mcp)" = 401 ]`,
      ),
      step(
        "verify",
        "check",
        "auth-wrong-token",
        "/mcp refuses a wrong token (401)",
        `[ "$(${post} -H 'Authorization: Bearer 0000000000000000000000000000000000000000000000000000000000000000' http://127.0.0.1:${port}/mcp)" = 401 ]`,
      ),
    );
    const script = readFileSync(join(repoRoot, "scripts/tools/infra/mcp-tools-count.ts"), "utf8");
    const expect = expectTools !== undefined ? ` --expect ${expectTools}` : "";
    const token = tokenFile
      ? `${MCP_TOKEN_ENV}="$(sudo -n sed -n 's/^${MCP_TOKEN_ENV}=//p' ${tokenFile} | tail -n 1)" `
      : "";
    steps.push(
      step(
        "verify",
        expectTools !== undefined ? "check" : "info",
        "tools-count",
        expectTools !== undefined
          ? `tools/list over HTTP, with the token, returns exactly ${expectTools} tools (the build serving is the expected one)`
          : "tools/list over HTTP, with the token: exact count of the build serving (pass --expect-tools N to gate on it)",
        `printf %s ${sq(b64(script))} | base64 -d > ${STAGE_DIR}/mcp-tools-count.ts && ${token}${BUN} ${STAGE_DIR}/mcp-tools-count.ts http://127.0.0.1:${port}/mcp --token-env ${MCP_TOKEN_ENV}${expect}`,
      ),
    );
  }
  steps.push(
    step(
      "verify",
      "info",
      "journal",
      "last log lines",
      `journalctl -u ${f.unit} -n 15 --no-pager 2>&1; true`,
    ),
    step(
      "rollback",
      "mutate",
      "remove",
      "stop and remove this unit (state directories and env files are kept)",
      `sudo systemctl disable --now ${f.unit}; sudo rm -f /etc/systemd/system/${f.unit}; sudo systemctl daemon-reload; sudo systemctl reset-failed ${f.unit} 2>/dev/null; true`,
    ),
  );
  return steps;
}

export function hostPlan(units: string[], options: PlanOptions = {}): Plan {
  const root = options.root ?? hostRoot();
  const repoRoot = join(root, "..", "..");
  const catalog = loadCatalog(root);
  const entries = units.map((name) => {
    const entry = catalog.units.find((u) => u.unit === name || u.service === name);
    if (!entry) throw new Error(`unknown unit: ${name}`);
    if (!entry.unit.endsWith(".service"))
      throw new Error(`${entry.unit}: only .service units are planned`);
    return entry;
  });
  const targets = new Set(entries.map((e) => e.targetHost));
  const target = options.target ?? [...targets][0];
  if (!target || targets.size > 1 || !targets.has(target)) {
    throw new Error(`units target ${[...targets].join(", ")}, not ${target}`);
  }
  const steps = entries.flatMap((entry) =>
    unitSteps(
      entry,
      composeUnit(entry.unit, root),
      repoRoot,
      entry.service === "aphrody-mcp-http" ? options.expectTools : undefined,
      options.binary,
    ),
  );
  return { target, units: entries.map((e) => e.unit), steps };
}

export function renderPlan(
  plan: Plan,
  observed?: Map<string, { ok: boolean; out: string }>,
): string {
  const lines = [
    `host-plan target=${plan.target} units=${plan.units.join(",")} steps=${plan.steps.length}`,
  ];
  let phase = "";
  for (const s of plan.steps) {
    const head = `${s.unit} ${s.phase}`;
    if (head !== phase) lines.push("", `## ${head}`);
    phase = head;
    const seen = observed?.get(s.id);
    const mark = seen
      ? s.kind === "info"
        ? "info "
        : seen.ok
          ? "ok   "
          : "FAIL "
      : s.kind === "mutate"
        ? "MUTATE"
        : s.kind === "check"
          ? "check "
          : "info  ";
    lines.push(`- [${mark}] ${s.id}: ${s.note}`);
    if (!seen || s.kind !== "mutate")
      lines.push(
        `    $ ${s.run.length > 200 ? `${s.run.slice(0, 160)}... (${s.run.length} chars)` : s.run}`,
      );
    if (seen?.out.trim())
      lines.push(
        ...seen.out
          .trim()
          .split("\n")
          .slice(0, 6)
          .map((l) => `    > ${l}`),
      );
  }
  return lines.join("\n");
}

/** Default runner: `aphrody infra ssh exec` (the Rust SSH operator), one finite deadline per command. */
export const sshRunner: Runner = async (host, command) => {
  const proc = Bun.spawn(["aphrody", "infra", "ssh", "exec", "--host", host, "--", command], {
    env: { ...process.env, APHRODY_SSH_COMMAND_TIMEOUT_SECS: "180" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
};

/** Run only the read-only preflight steps and report what the host says. Mutates nothing. */
export async function observePlan(plan: Plan, run: Runner = sshRunner) {
  const seen = new Map<string, { ok: boolean; out: string }>();
  for (const s of plan.steps.filter((x) => x.phase === "preflight")) {
    const r = await run(plan.target, s.run);
    seen.set(s.id, { ok: r.code === 0, out: `${r.stdout}${r.stderr}` });
  }
  return seen;
}

/**
 * Execute the plan unit by unit: preflight checks must all pass before the first mutation; a failed install or verify
 * check rolls that unit back and stops. Returns the failed step ids (empty when everything passed).
 */
export async function applyPlan(
  plan: Plan,
  run: Runner = sshRunner,
  log: (line: string) => void = console.log,
): Promise<string[]> {
  for (const unit of plan.units) {
    const mine = plan.steps.filter((s) => s.unit === unit);
    const exec = async (s: PlanStep) => {
      const r = await run(plan.target, s.run);
      log(
        `${r.code === 0 ? "ok  " : s.kind === "info" ? "info" : "FAIL"} ${s.id}${r.stdout.trim() ? `\n    ${r.stdout.trim().split("\n").slice(0, 4).join("\n    ")}` : ""}`,
      );
      return r.code === 0 || s.kind === "info";
    };
    for (const s of mine.filter((x) => x.phase === "preflight")) {
      if (!(await exec(s))) return [s.id];
    }
    const rollback = mine.find((x) => x.phase === "rollback");
    let installed = false;
    for (const s of mine.filter(
      (x) => x.phase === "provision" || x.phase === "install" || x.phase === "verify",
    )) {
      if (s.id.endsWith("/install")) installed = true;
      if (!(await exec(s))) {
        if (installed && rollback) await exec(rollback);
        return [s.id];
      }
    }
  }
  return [];
}
