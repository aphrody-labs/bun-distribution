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
import { composeUnit, type HostUnit, hostRepositoryRoot, hostRoot, loadCatalog } from "./index.ts";
import { inCidr, loadTunnel, selectedProxySteps, TUNNEL_FILE, type WgStep } from "./wireguard.ts";

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
const socketPattern = (sockets: string[]) =>
  "^(" + sockets.map((socket) => socket.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")$";

/** Retain immutable pins without duplicate bytes; never write through a live binary or rollback symlink. */
export function pinnedBinaryInstall(
  binary: string,
  artifact: { from: string; sha256: string },
  marker: string,
): string {
  const next = `${binary}.new`,
    previous = `${binary}.prev`,
    previousNext = `${previous}.new`;
  const linkOrCopy = (from: string, to: string) =>
    `(ln -- ${sq(from)} ${sq(to)} 2>/dev/null || cp -p -- ${sq(from)} ${sq(to)})`;
  return [
    "set -e",
    `test -f ${sq(artifact.from)} && test ! -L ${sq(artifact.from)} && test -x ${sq(artifact.from)} && test "$(stat -c %a -- ${sq(artifact.from)})" = 755 || exit 1`,
    `install -d -m 0755 ${sq(binary.slice(0, binary.lastIndexOf("/")))}`,
    `test ! -d ${sq(next)} && test ! -d ${sq(previousNext)} && test ! -d ${sq(previous)}`,
    `rm -f -- ${sq(next)} ${sq(previousNext)}`,
    `trap ${sq(`rm -f -- ${sq(next)} ${sq(previousNext)}`)} EXIT`,
    linkOrCopy(artifact.from, next),
    `echo ${artifact.sha256}'  '${sq(next)} | sha256sum -c --quiet -`,
    `if [ -L ${sq(binary)} ]; then cp -Pp -- ${sq(binary)} ${sq(previousNext)}; elif [ -e ${sq(binary)} ]; then ${linkOrCopy(binary, previousNext)}; fi`,
    `if [ -e ${sq(previousNext)} ] || [ -L ${sq(previousNext)} ]; then mv -fT -- ${sq(previousNext)} ${sq(previous)}; fi`,
    `mv -fT -- ${sq(next)} ${sq(binary)}`,
    `touch ${sq(marker)}`,
    "trap - EXIT",
  ].join("; ");
}

/** Only an explicitly declared private relay may share a native service's port. */
function socketRelays(repoRoot: string, facts: UnitFacts): string[] {
  const root = join(repoRoot, "tools/config/host");
  if (!facts.bind || !existsSync(join(root, TUNNEL_FILE))) return [];
  const tunnel = loadTunnel(root);
  const address =
    tunnel.hub.peer === facts.targetHost
      ? tunnel.hub.address
      : tunnel.peers.find((peer) => peer.host === facts.targetHost)?.address;
  return tunnel.services
    .filter(
      (service) =>
        service.host === facts.targetHost &&
        service.unit === facts.service &&
        service.port === facts.bind!.port &&
        service.expose === "socket-proxyd" &&
        service.upstream === `${facts.bind!.host}:${facts.bind!.port}`,
    )
    .map((service) => {
      if (
        service.address !== address ||
        !inCidr(service.address, tunnel.subnet) ||
        !["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].some((cidr) =>
          inCidr(service.address, cidr),
        )
      )
        throw new Error(`${facts.unit}: relay must use its declared private WireGuard address`);
      return `${service.address}:${service.port}`;
    });
}

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
  const address = /(?:--bind|--addr)\s+(\S+)/.exec(execStart)?.[1];
  let bind: UnitFacts["bind"];
  if (address) {
    const at = address.lastIndexOf(":");
    bind = { host: address.slice(0, at), port: Number(address.slice(at + 1)) };
    // Never a public listener: the plan refuses a unit that would bind anything but loopback.
    if (!LOOPBACK.test(bind.host) || !Number.isInteger(bind.port)) {
      throw new Error(`${entry.unit}: bind address ${address} is not a loopback address`);
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
  modelId?: string;
}
function serviceEntry(repoRoot: string, id: string): ServiceEntry | undefined {
  const file = join(repoRoot, "tools/config/service-catalog.json");
  if (!existsSync(file)) return undefined;
  const catalog = JSON.parse(readFileSync(file, "utf8")) as { services: ServiceEntry[] };
  return catalog.services.find((s) => s.id === id);
}

/** Track only resources introduced by this selected proxy apply; existing resources remain owned by their prior state. */
export function trackProxyMutations(projection: WgStep[], state: string, port: number) {
  const rules = projection.filter((proxy) => proxy.id.includes(".proxy-ufw."));
  const markers = [
    "ready",
    "new-template.socket",
    "new-template.service",
    "active.socket",
    "active.service",
    "enabled.socket",
    ...rules.map((_, index) => `new-rule.${index}`),
  ];
  const before = `set -e; install -d -m 0700 ${sq(state)}; rm -f ${markers.map((marker) => sq(`${state}/${marker}`)).join(" ")}; if systemctl is-active --quiet aphrody-wg-proxy@${port}.socket; then touch ${sq(`${state}/active.socket`)}; fi; if systemctl is-active --quiet aphrody-wg-proxy@${port}.service; then touch ${sq(`${state}/active.service`)}; fi; if systemctl is-enabled --quiet aphrody-wg-proxy@${port}.socket; then touch ${sq(`${state}/enabled.socket`)}; fi; touch ${sq(`${state}/ready`)}`;
  const tracked = projection.map((proxy) => {
    let prefix = "set -e; ";
    for (const extension of ["socket", "service"] as const) {
      if (proxy.id.endsWith(`proxy-unit.${extension}`))
        prefix += `if [ ! -e /etc/systemd/system/aphrody-wg-proxy@.${extension} ]; then touch ${sq(`${state}/new-template.${extension}`)}; fi; `;
    }
    const rule = rules.findIndex((candidate) => candidate.id === proxy.id);
    if (rule >= 0) {
      const tuple = /from (\S+) to (\S+) port (\d+) proto tcp/.exec(proxy.run!);
      if (!tuple) throw new Error("Unsupported selected proxy firewall command");
      prefix += `known=$(ufw show added) || exit 1; known=$(printf %s "$known" | tr -d "'"); desired=$(printf %s ${sq(proxy.run!)} | tr -d "'"); if ! printf '%s\\n' "$known" | grep -Fx -- "$desired" >/dev/null; then if printf '%s\\n' "$known" | grep -F -- ${sq(tuple[1]!)} | grep -F -- ${sq(tuple[2]!)} | grep -F -- ${sq(`port ${tuple[3]!}`)} >/dev/null; then exit 1; fi; touch ${sq(`${state}/new-rule.${rule}`)}; fi; `;
    }
    return { ...proxy, run: prefix + proxy.run };
  });
  const cleanup = rules
    .map(
      (rule, index) =>
        `if [ -e ${sq(`${state}/new-rule.${index}`)} ]; then ${rule.run!.replace(/^ufw /, "ufw --force delete ")}; fi`,
    )
    .join("; ");
  const rollback = `if [ -e ${sq(`${state}/ready`)} ]; then if [ ! -e ${sq(`${state}/active.socket`)} ]; then systemctl stop aphrody-wg-proxy@${port}.socket; fi; if [ ! -e ${sq(`${state}/enabled.socket`)} ]; then systemctl disable aphrody-wg-proxy@${port}.socket; fi; if [ ! -e ${sq(`${state}/active.service`)} ]; then systemctl stop aphrody-wg-proxy@${port}.service; fi; ${cleanup}${cleanup ? "; " : ""}if [ -e ${sq(`${state}/new-template.socket`)} ]; then rm -f /etc/systemd/system/aphrody-wg-proxy@.socket; fi; if [ -e ${sq(`${state}/new-template.service`)} ]; then rm -f /etc/systemd/system/aphrody-wg-proxy@.service; fi; systemctl daemon-reload; fi`;
  return { before, steps: tracked, rollback };
}

/** A pinned refresh may reuse only this unit's exact native listener. */
export function pinnedSocketCheck(
  facts: UnitFacts,
  relays: string[],
  requireListener = false,
): string {
  if (!facts.bind) throw new Error("Pinned socket qualification requires a bind address");
  const port = facts.bind.port;
  const endpoints = (
    facts.bind.host === "localhost" ? ["127.0.0.1", "[::1]"] : [facts.bind.host]
  ).map((host) => `${host === "::1" ? "[::1]" : host}:${port}`);
  const endpointFilter = endpoints
    .map((endpoint) => `$4 == ${JSON.stringify(endpoint)}`)
    .join(" || ");
  return [
    `rows=$(timeout 5 sudo -n ss -H -ltnp "sport = :${port}") || exit 1`,
    `addresses=$(printf '%s\\n' "$rows" | awk '{print $4}')`,
    `[ -z "$addresses" ] || ! printf '%s\\n' "$addresses" | grep -qvE ${sq(socketPattern([...endpoints, ...relays]))} || exit 1`,
    `native_rows=$(printf '%s\\n' "$rows" | awk ${sq(endpointFilter)})`,
    `if [ -z "$native_rows" ]; then exit ${requireListener ? 1 : 0}; fi`,
    `systemctl is-active --quiet ${sq(facts.unit)} || exit 1`,
    `main_pid=$(systemctl show ${sq(facts.unit)} -p MainPID --value) || exit 1`,
    `case "$main_pid" in ''|0|*[!0-9]*) exit 1 ;; esac`,
    `owners=$(printf '%s\\n' "$native_rows" | grep -oE 'pid=[0-9]+' | sort -u)`,
    `[ "$owners" = "pid=$main_pid" ]`,
  ].join("; ");
}

const isMcp = (service: string) =>
  service === "aphrody-mcp-http" || service === "aphrody-mcp-http-dbfr";

/** Steps for one unit. `repoRoot` holds `ai.json`, `tools/config/service-catalog.json` and `scripts/tools/infra`. */
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
      `${entry.unit}: binds :${f.bind.port} but tools/config/service-catalog.json declares :${svc.port}`,
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
  const relays = socketRelays(repoRoot, f);
  const expectedSockets = f.bind
    ? (f.bind.host === "localhost" ? ["127.0.0.1", "[::1]"] : [f.bind.host]).map(
        (host) => `${host === "::1" ? "[::1]" : host}:${port}`,
      )
    : [];
  const socketRows = `socket_rows=$(ss -H -ltn "sport = :${port}") || exit 1; sockets=$(printf '%s\\n' "$socket_rows" | awk '{print $4}')`;
  const stage = `${STAGE_DIR}/${f.unit}`;
  const steps: PlanStep[] = [];

  const mcp = isMcp(f.service);
  const a2a = f.service === "aphrody-a2a";
  const jobs = f.service === "aphrody-jobs-worker-dbfr";
  const gateway = f.service === "aphrody-ai-gateway-dbfr";
  const install = mcp || a2a || jobs || gateway ? binary : undefined;
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
  if (jobs) {
    const executable = sq(install?.from ?? f.binary);
    steps.push(
      step(
        "preflight",
        "check",
        "jobs-capability",
        "the selected native binary supports persistent workers with host placement and bounded concurrency",
        `job_worker_help="$(${executable} job run --help)" && printf %s "$job_worker_help" | grep -q -- '--host' && printf %s "$job_worker_help" | grep -q -- '--concurrency'`,
      ),
    );
  }
  if (port !== undefined) {
    steps.push(
      step(
        "preflight",
        "check",
        install ? "port-owner" : "port-free",
        install
          ? "an occupied native socket belongs exactly to this active unit's MainPID; only its declared private relay may share the port"
          : `the declared loopback socket is free; only its declared private WireGuard relay may already listen on :${port}`,
        install
          ? pinnedSocketCheck(f, relays)
          : `${socketRows}; ${relays.length ? `[ -z "$sockets" ] || ! printf '%s\\n' "$sockets" | grep -qvE ${sq(socketPattern(relays))}` : '[ -z "$sockets" ]'}`,
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

  if (install) {
    steps.push(
      step(
        "provision",
        "mutate",
        "upgrade-state",
        "retain the current unit, activation state and binary rollback marker before a pinned refresh",
        `set -e; install -d -m 0700 ${STAGE_DIR}; rm -f ${sq(`${stage}.previous`)} ${sq(`${stage}.was-active`)} ${sq(`${stage}.was-enabled`)} ${sq(`${stage}.binary-installed`)}; fragment=$(systemctl show ${sq(f.unit)} -p FragmentPath --value); if [ -n "$fragment" ] && [ -f "$fragment" ]; then sudo -n cp -p "$fragment" ${sq(`${stage}.previous`)}; fi; if systemctl is-active --quiet ${sq(f.unit)}; then touch ${sq(`${stage}.was-active`)}; fi; if systemctl is-enabled --quiet ${sq(f.unit)}; then touch ${sq(`${stage}.was-enabled`)}; fi`,
      ),
    );
  }

  if (f.service === "aphrody-a2a") {
    const aiJson = join(repoRoot, "ai.json");
    if (!existsSync(aiJson))
      throw new Error(
        `${f.unit}: ${aiJson} is missing (the A2A server needs ai.json in its working directory)`,
      );
    const content = readFileSync(aiJson, "utf8");
    const dir = f.workingDirectory ?? "/home/ubuntu/apps/aphrody/shared/a2a";
    const fleetPath = join(repoRoot, "tools/config/host/agent-fleet.json");
    const fleetConfigured = existsSync(fleetPath);
    if (fleetConfigured) {
      const { hub } = JSON.parse(readFileSync(fleetPath, "utf8")) as {
        hub: { workspace: string; seed: string; branch: string; remote: string; profile: string };
      };
      if (hub.workspace !== dir || hub.branch !== "main")
        throw new Error("A2A fleet workspace and unit must agree on the dedicated main checkout");
      const revision = Bun.spawnSync(["git", "-C", repoRoot, "rev-parse", "HEAD"], {
        windowsHide: true,
      });
      const sha = revision.stdout.toString().trim();
      if (revision.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(sha))
        throw new Error("Cannot qualify the A2A workspace source revision");
      steps.push(
        step(
          "preflight",
          "check",
          "agent-workspace-source",
          "the factory seed contains the declared source revision before creating the checkout",
          `git -C ${sq(hub.seed)} cat-file -e ${sq(`${sha}^{commit}`)}`,
        ),
      );
      steps.push(
        step(
          "provision",
          "mutate",
          "agent-workspace",
          `dedicated private checkout at ${sha}; existing work is never reset`,
          `set -e; if [ ! -e ${sq(dir)} ]; then sudo -n install -d -o ubuntu -g ubuntu -m 0700 ${sq(dir)}; fi; if [ ! -e ${sq(`${dir}/.git`)} ]; then git clone --no-hardlinks --no-checkout ${sq(hub.seed)} ${sq(dir)}; git -C ${sq(dir)} checkout -B main ${sha}; git -C ${sq(dir)} remote set-url origin ${sq(hub.remote)}; git -C ${sq(dir)} config user.name aphrody-dev; git -C ${sq(dir)} config user.email contact@aphrody.com; fi; test -d ${sq(`${dir}/.git`)}; test "$(git -C ${sq(dir)} branch --show-current)" = main; test "$(git -C ${sq(dir)} remote get-url origin)" = ${sq(hub.remote)}`,
        ),
        step(
          "provision",
          "mutate",
          "agent-profile",
          "seed the selected private profile rules only when absent; preserve authentication and existing home documents",
          `install -d -m 0700 ${sq(hub.profile)} && { [ -e ${sq(`${hub.profile}/AGENTS.md`)} ] || install -m 0600 ${sq(`${dir}/AGENTS.md`)} ${sq(`${hub.profile}/AGENTS.md`)}; }`,
        ),
      );
    }
    steps.push(
      step(
        "provision",
        fleetConfigured ? "check" : "mutate",
        "ai-json",
        `ai.json of the repository revision into ${dir} (replaces the dangling link to the retired /home/ubuntu/apps/aphrody/current)`,
        fleetConfigured
          ? `test -s ${sq(`${dir}/ai.json`)}`
          : `rm -f ${dir}/ai.json && printf %s ${sq(b64(content))} | base64 -d > ${dir}/ai.json && chmod 0644 ${dir}/ai.json`,
      ),
      step(
        "provision",
        "mutate",
        "coord-link",
        `${dir}/.coord points at the persistent coord directory (mailbox of /msg and JSON-RPC)`,
        `[ -e ${dir}/.coord ] || ln -s /home/ubuntu/apps/aphrody/shared/coord ${dir}/.coord`,
      ),
    );
  }
  const tokenEnv = mcp
    ? MCP_TOKEN_ENV
    : gateway
      ? "APHRODY_AI_HTTP_TOKEN"
      : "APHRODY_A2A_COORD_TOKEN";
  if ((mcp || a2a || gateway) && tokenFile) {
    // The token is made on the host and never leaves it: nothing here prints it, and the plan carries no value.
    const script = [
      "set -e",
      "umask 077",
      `install -d -o root -g root -m 0755 ${sq(tokenFile.slice(0, tokenFile.lastIndexOf("/")))}`,
      `f=${tokenFile}`,
      'touch "$f"',
      `grep -q "^${tokenEnv}=.\\{32,\\}" "$f" || printf "${tokenEnv}=%s\\n" "$(openssl rand -hex 32)" >> "$f"`,
      'chown root:root "$f"',
      'chmod 0600 "$f"',
    ].join("; ");
    steps.push(
      step(
        "provision",
        "mutate",
        "generate-token",
        `${tokenFile} (root:root 0600) holds ${tokenEnv}, generated here with openssl and kept when already set`,
        `sudo -n sh -c ${sq(script)}`,
      ),
    );
    const fleetPath = join(repoRoot, "tools/config/host/agent-fleet.json");
    if (f.service === "aphrody-a2a" && existsSync(fleetPath)) {
      const { hub } = JSON.parse(readFileSync(fleetPath, "utf8")) as {
        hub: { clientTokenFile: string };
      };
      const parent = hub.clientTokenFile.slice(0, hub.clientTokenFile.lastIndexOf("/"));
      const clientCredentialScript = [
        "set -e",
        "umask 077",
        `a2a_bearer_value="$(sed -n 's/^APHRODY_A2A_COORD_TOKEN=//p' ${sq(tokenFile)} | tail -n 1)"`,
        '[ "${#a2a_bearer_value}" -ge 32 ]',
        `printf %s "$a2a_bearer_value" > ${sq(`${hub.clientTokenFile}.new`)}`,
        `chown ubuntu:ubuntu ${sq(`${hub.clientTokenFile}.new`)}`,
        `chmod 0600 ${sq(`${hub.clientTokenFile}.new`)}`,
        `mv -f ${sq(`${hub.clientTokenFile}.new`)} ${sq(hub.clientTokenFile)}`,
      ].join("; ");
      steps.push(
        step(
          "provision",
          "mutate",
          "a2a-client-credential",
          "host-local protected credential for authenticated stdio MCP clients; no token leaves the host",
          `install -d -m 0700 ${sq(parent)} && sudo -n sh -c ${sq(clientCredentialScript)}`,
        ),
      );
    }
  }
  if (install) {
    steps.push(
      step(
        "provision",
        "mutate",
        "install-binary",
        `install the build as ${f.binary}, the previous one is kept as ${f.binary}.prev (rollback: mv it back)`,
        pinnedBinaryInstall(f.binary, install, `${stage}.binary-installed`),
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
      `sudo -n systemd-analyze verify ${stage}`,
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
      install
        ? "enable at boot and restart onto the pinned native artifact"
        : "enable at boot and start",
      install
        ? `sudo systemctl enable ${f.unit} && sudo systemctl restart ${f.unit}`
        : `sudo systemctl enable --now ${f.unit}`,
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
        `the native loopback socket is present; any additional listener must be its declared private WireGuard relay`,
        install
          ? `n=0; until (${pinnedSocketCheck(f, relays, true)}); do n=$((n+1)); [ "$n" -lt 20 ] || exit 1; sleep 0.25; done`
          : `n=0; until { ${socketRows}; printf '%s\\n' "$sockets" | grep -qE ${sq(socketPattern(expectedSockets))}; }; do n=$((n+1)); [ "$n" -lt 20 ] || exit 1; sleep 0.25; done; ! printf '%s\\n' "$sockets" | grep -qvE ${sq(socketPattern([...expectedSockets, ...relays]))}`,
      ),
    );
  }
  if (svc?.health) {
    steps.push(
      step(
        "verify",
        "check",
        "health",
        `GET ${svc.health}`,
        `curl -fsS -m 5 --retry 5 --retry-delay 1 --retry-connrefused ${svc.health}`,
      ),
    );
  }
  if ((mcp || (a2a && tokenFile) || (gateway && tokenFile)) && port !== undefined) {
    const endpoint = `http://127.0.0.1:${port}/${mcp ? "mcp" : ""}`;
    const post = `curl -s -o /dev/null -m 5 -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'`;
    const authEndpoint = gateway ? `http://127.0.0.1:${port}/v1/models` : endpoint;
    const unauthRequest = gateway
      ? `curl -s -o /dev/null -m 5 -w '%{http_code}' ${authEndpoint}`
      : `${post} ${endpoint}`;
    const wrongTokenRequest = gateway
      ? `curl -s -o /dev/null -m 5 -w '%{http_code}' -H 'Authorization: Bearer 0000000000000000000000000000000000000000000000000000000000000000' ${authEndpoint}`
      : `${post} -H 'Authorization: Bearer 0000000000000000000000000000000000000000000000000000000000000000' ${endpoint}`;
    steps.push(
      step(
        "verify",
        "check",
        "auth-required",
        "the private endpoint refuses a request without a token (401)",
        `[ "$(${unauthRequest})" = 401 ]`,
      ),
      step(
        "verify",
        "check",
        "auth-wrong-token",
        "the private endpoint refuses a wrong token (401)",
        `[ "$(${wrongTokenRequest})" = 401 ]`,
      ),
    );
    if (a2a) {
      steps.push(
        step(
          "verify",
          "check",
          "auth-valid-token",
          "the protected task API accepts the host-local credential; no task body is printed",
          `curl -fsS -o /dev/null -m 5 -H "Authorization: Bearer $(sudo -n sed -n 's/^${tokenEnv}=//p' ${sq(tokenFile!)} | tail -n 1)" http://127.0.0.1:${port}/coord/aphrody/tasks`,
        ),
      );
    }
    if (gateway && tokenFile && svc?.modelId) {
      const body = JSON.stringify({
        model: svc.modelId,
        messages: [{ role: "user", content: "Réponds uniquement: pass" }],
        max_tokens: 6,
        temperature: 0,
      });
      steps.push(
        step(
          "verify",
          "check",
          "authenticated-generation",
          `the gateway forwards one short generation to ${svc.modelId}; response content is never printed`,
          `curl -fsS -o /dev/null -m 60 -H "Authorization: Bearer $(sudo -n sed -n 's/^${tokenEnv}=//p' ${sq(tokenFile)} | tail -n 1)" -H 'Content-Type: application/json' --data ${sq(body)} http://127.0.0.1:${port}/v1/chat/completions`,
        ),
      );
    }
  }
  if (mcp && port !== undefined) {
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
      install ? "restore" : "remove",
      install
        ? "restore the previous unit, native binary and activation state; retain private state and credentials"
        : "stop and remove this unit (state directories and env files are kept)",
      install
        ? `set -e; if [ -e ${sq(`${stage}.binary-installed`)} ] && [ -e ${sq(`${f.binary}.prev`)} ]; then mv -f ${sq(`${f.binary}.prev`)} ${sq(f.binary)}; fi; if [ -f ${sq(`${stage}.previous`)} ]; then sudo -n cp -p ${sq(`${stage}.previous`)} /etc/systemd/system/${f.unit}; sudo systemctl daemon-reload; if [ -e ${sq(`${stage}.was-active`)} ]; then sudo systemctl restart ${f.unit}; else sudo systemctl stop ${f.unit}; fi; if [ -e ${sq(`${stage}.was-enabled`)} ]; then sudo systemctl enable ${f.unit}; else sudo systemctl disable ${f.unit}; fi; else sudo systemctl disable --now ${f.unit}; sudo rm -f /etc/systemd/system/${f.unit}; sudo systemctl daemon-reload; fi`
        : `sudo systemctl disable --now ${f.unit}; sudo rm -f /etc/systemd/system/${f.unit}; sudo systemctl daemon-reload; sudo systemctl reset-failed ${f.unit} 2>/dev/null; true`,
    ),
  );
  if (mcp && f.targetHost === "dbfr" && relays.length) {
    const root = join(repoRoot, "tools/config/host");
    const tunnel = loadTunnel(root);
    const service = tunnel.services.find((candidate) => candidate.unit === f.service);
    if (!service) throw new Error(`${f.unit}: declared private proxy missing`);
    steps.push(
      step(
        "preflight",
        "check",
        "wireguard-live",
        "the existing private interface has this host's declared address; no tunnel bootstrap is applied",
        `ip -o -4 address show dev ${sq(tunnel.interface)} | awk '{print $4}' | grep -Fx ${sq(`${service.address}/32`)}`,
      ),
    );
    for (const extension of ["socket", "service"] as const) {
      const unit = `aphrody-wg-proxy@.${extension}`;
      const desired = composeUnit(unit, root).replaceAll(tunnel.hub.address, service.address);
      const path = `/etc/systemd/system/${unit}`;
      steps.push(
        step(
          "preflight",
          "check",
          `wireguard-template:${extension}`,
          "an existing shared proxy template must already match this host's declared owner template",
          `[ ! -e ${sq(path)} ] || [ "$(sudo -n cat ${sq(path)})" = "$(printf %s ${sq(b64(desired))} | base64 -d)" ]`,
        ),
      );
    }
    const tracked = trackProxyMutations(
      selectedProxySteps(
        tunnel,
        { root, catalog: loadCatalog(root), compose: (unit) => composeUnit(unit, root) },
        service.id,
      ),
      `${stage}.proxy`,
      service.port!,
    );
    steps.push(
      step(
        "verify",
        "mutate",
        "wireguard-state",
        "retain only selected proxy resource ownership for rollback",
        `sudo -n sh -c ${sq(tracked.before)}`,
      ),
    );
    const rollback = steps.find((candidate) => candidate.phase === "rollback")!;
    rollback.run = `sudo -n sh -c ${sq(tracked.rollback)}; ${rollback.run}`;
    for (const proxy of tracked.steps) {
      if (!proxy.run || (proxy.kind !== "check" && proxy.kind !== "mutate"))
        throw new Error("Unsupported private proxy step");
      // Provision only after the native endpoint and its authentication checks passed.
      steps.push(
        step(
          "verify",
          proxy.kind,
          `wireguard:${proxy.id}`,
          proxy.note,
          `sudo -n sh -c ${sq(proxy.run)}`,
        ),
      );
    }
    steps.push(
      step(
        "verify",
        "check",
        "private-auth-required",
        "the declared WireGuard endpoint is present and refuses missing credentials",
        `[ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' http://${service.address}:${service.port}/mcp)" = 401 ]`,
      ),
    );
  }
  return steps;
}

export function hostPlan(units: string[], options: PlanOptions = {}): Plan {
  const root = options.root ?? hostRoot();
  const repoRoot = hostRepositoryRoot(root);
  const catalog = loadCatalog(root);
  const entries = units.map((name) => {
    const entry = catalog.units.find((u) => u.unit === name || u.service === name);
    if (!entry) throw new Error(`unknown unit: ${name}`);
    if (!entry.unit.endsWith(".service"))
      throw new Error(`${entry.unit}: only .service units are planned`);
    return entry;
  });
  // MCP consumes the A2A environment file; provision and activate its owner first.
  const mcpAt = entries.findIndex((entry) => isMcp(entry.service));
  const a2aAt = entries.findIndex((entry) => entry.service === "aphrody-a2a");
  if (mcpAt >= 0 && a2aAt > mcpAt) {
    const [a2aEntry] = entries.splice(a2aAt, 1);
    entries.splice(mcpAt, 0, a2aEntry!);
  }
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
      isMcp(entry.service) ? options.expectTools : undefined,
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
    windowsHide: true,
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
      if (s.id.endsWith("/install") || s.id.endsWith("/install-binary")) installed = true;
      if (!(await exec(s))) {
        if (installed && rollback) await exec(rollback);
        return [s.id];
      }
    }
  }
  return [];
}
