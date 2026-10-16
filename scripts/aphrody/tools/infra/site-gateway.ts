#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Infra adapter of the existing PC port-80 gateway (an nginx container whose `nginx.conf` is a
 * host bind mount): it adds only a marked Aphrody upstream/server, rendered by
 * `aphrody infra nginx render`, in front of the native site recorded by native-startup.ts, and
 * preserves every other block, the container lifecycle and the authentication stores.
 *
 *   bun --no-env-file scripts/tools/infra/site-gateway.ts plan|apply [--config <path>] [--aphrody <exe>]
 *
 * The default configuration is `<APHRODY_HOME|~/.aphrody>/host/aphrody-gateway.json`. `plan` is
 * read-only. `apply` requires the reviewed source checksum, the declared bind mount, a validated
 * candidate (`nginx -t -c` in the container) and port-80 `/health` 204 after reload; any failure
 * restores the original bytes and reloads them. Runbook: docs/operations/workspace/aphrody-native-gateway80.md.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { processStartedAt, tcpListeners } from "./win32-net.ts";

export const BEGIN = "# BEGIN APHRODY NATIVE SITE v1";
export const END = "# END APHRODY NATIVE SITE v1";

export type Tls = {
  enabled: boolean;
  directory: string;
  containerDirectory: string;
  quic?: boolean;
  certificateSha256: string;
  privateKeySha256: string;
};

export type GatewayConfig = {
  home: string;
  sourceConfig: string;
  registry: string;
  container: string;
  serverNames: string[];
  expectedSourceSha256?: string;
  tls?: Tls;
};

export type SiteRecord = { pid: number; processStartedAt: string; address: string; port: number };

const SHA256 = /^[a-fA-F0-9]{64}$/;

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const sameHash = (a: string | undefined, b: string) =>
  a !== undefined && a.toLowerCase() === b.toLowerCase();

/** Validates the host configuration (absolute paths, safe names); throws on the first defect. */
export function validateConfig(raw: unknown): GatewayConfig {
  const c = raw as GatewayConfig;
  for (const key of ["home", "sourceConfig", "registry"] as const)
    if (typeof c?.[key] !== "string" || !isAbsolute(c[key]))
      throw new Error(`chemin ${key} : absolu requis`);
  if (typeof c.container !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(c.container))
    throw new Error("nom de conteneur invalide");
  if (!Array.isArray(c.serverNames) || c.serverNames.length === 0)
    throw new Error("déclarer les noms de serveur Aphrody");
  for (const name of c.serverNames)
    if (typeof name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(name))
      throw new Error(`nom de serveur invalide : ${String(name)}`);
  if (c.tls?.enabled) {
    if (!isAbsolute(c.tls.directory) || !/^\/[a-zA-Z0-9/_-]+$/.test(c.tls.containerDirectory))
      throw new Error("TLS : répertoire hôte absolu et répertoire conteneur sûr requis");
    if (!SHA256.test(c.tls.certificateSha256) || !SHA256.test(c.tls.privateKeySha256))
      throw new Error("TLS : empreintes SHA-256 du manifeste requises");
  }
  return c;
}

/** True when `record` is held by a live process (same start time) owning exactly one loopback listener. */
export function liveSite(record: SiteRecord): boolean {
  if (record.address !== "127.0.0.1" || !(record.port >= 1 && record.port <= 65535))
    throw new Error("le registre doit désigner le listener loopback du site natif");
  if (processStartedAt(record.pid) !== record.processStartedAt) return false;
  const owned = tcpListeners().filter(
    (l) => l.pid === record.pid && l.port === record.port && l.address === "127.0.0.1",
  );
  return owned.length === 1;
}

const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
const count = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].length;

/** Removes this adapter's marked block; throws when markers are ambiguous or incomplete. */
export function stripOwnedBlock(original: string): { base: string; marked: number } {
  const block = new RegExp(`^${escape(BEGIN)}\\r?\\n[\\s\\S]*?^${escape(END)}\\r?\\n?`, "gm");
  const marked = count(original, block);
  if (
    marked > 1 ||
    count(original, new RegExp(escape(BEGIN), "g")) !== marked ||
    count(original, new RegExp(escape(END), "g")) !== marked
  )
    throw new Error("marqueurs de la passerelle ambigus ou incomplets");
  return { base: original.replace(block, ""), marked };
}

/**
 * Index of the brace closing the single top-level `http` block, which must end the file. A small
 * lexical guard (quotes, escapes and comments skipped), not an nginx parser.
 */
export function httpClosing(base: string): number {
  const opening = /^http\s*\{/m.exec(base);
  if (!opening || count(base, /^http\s*\{/gm) !== 1)
    throw new Error("un seul bloc http de premier niveau attendu");
  const httpOpening = opening.index + opening[0].lastIndexOf("{");
  let depth = 0;
  let quote = "";
  let comment = false;
  let escaped = false;
  let lastClosing = -1;
  let closing = -1;
  for (let index = 0; index < base.length; index++) {
    const character = base[index]!;
    if (comment) {
      if (character === "\n") comment = false;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#") {
      comment = true;
      continue;
    }
    if (character === "{") {
      depth++;
      if (index === httpOpening && depth !== 1)
        throw new Error("le bloc http doit être de premier niveau");
    }
    if (character === "}") {
      depth--;
      lastClosing = index;
      if (depth === 0 && index > httpOpening && closing < 0) closing = index;
      if (depth < 0) throw new Error("accolades de la passerelle invalides");
    }
  }
  if (
    depth !== 0 ||
    quote ||
    lastClosing < 0 ||
    lastClosing !== closing ||
    base.slice(lastClosing + 1).trim().length !== 0
  )
    throw new Error("passerelle attendue équilibrée et terminée par son unique bloc http");
  return lastClosing;
}

/** Typed `NginxConfig` model of the owned block (see crates/infra/infra/src/nginx.rs). */
export function gatewayModel(config: GatewayConfig, port: number) {
  const locations = [
    {
      path: "/",
      proxy_pass: "http://aphrody_native_site",
      proxy_http_version: "1.1",
      headers: [
        ["Host", "$host"],
        ["X-Real-IP", "$remote_addr"],
        ["X-Forwarded-For", "$proxy_add_x_forwarded_for"],
        ["X-Forwarded-Proto", "$scheme"],
        ["Connection", '""'],
      ],
      custom_directives: ["proxy_read_timeout 30s"],
    },
  ];
  const servers: Record<string, unknown>[] = [
    { listen_ports: ["80", "[::]:80"], server_names: config.serverNames, locations },
  ];
  const tls = config.tls;
  if (tls?.enabled) {
    const listen = ["443 ssl", "[::]:443 ssl"];
    const directives = ["http2 on", "ssl_protocols TLSv1.2 TLSv1.3"];
    if (tls.quic) {
      listen.push("443 quic reuseport", "[::]:443 quic reuseport");
      directives.push(
        "http3 on",
        "quic_retry on",
        `add_header Alt-Svc 'h3=":443"; ma=86400' always`,
      );
    }
    servers.push({
      listen_ports: listen,
      server_names: ["localhost", "127.0.0.1", "aphrody.local"],
      ssl_certificate: `${tls.containerDirectory}/leaf-chain.pem`,
      ssl_certificate_key: `${tls.containerDirectory}/leaf-key.pem`,
      custom_directives: directives,
      locations,
    });
  }
  return {
    upstreams: [
      {
        name: "aphrody_native_site",
        targets: [{ type: "Tcp", target: `host.docker.internal:${port}` }],
        keepalive: 16,
      },
    ],
    servers,
  };
}

/** Renders the model through the single nginx writer, `aphrody infra nginx render -`. */
export function render(model: unknown, aphrody: string): string {
  const result = Bun.spawnSync([aphrody, "infra", "nginx", "render", "-"], {
    stdin: new TextEncoder().encode(JSON.stringify(model)),
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  if (result.exitCode !== 0)
    throw new Error(`aphrody infra nginx render : ${result.stderr.toString().trim()}`);
  return result.stdout.toString().trimEnd();
}

/**
 * Source with the owned block on its own lines just before the brace closing `http`; removing
 * the block gives back `base` (plus a line break before that brace when it had none), so
 * repeated applies do not drift.
 */
export function candidateText(base: string, closing: number, rendered: string): string {
  const head = base.slice(0, closing);
  const separator = head.endsWith("\n") ? "" : "\n";
  return `${head}${separator}${BEGIN}\n${rendered}\n${END}\n${base.slice(closing)}`;
}

/** Host path of a Docker Desktop bind source (`/run/desktop/mnt/host/c/x` -> `c:/x`). */
export function hostPath(source: string): string {
  const desktop = /^\/run\/desktop\/mnt\/host\/([a-zA-Z])\/(.+)$/.exec(source);
  return desktop ? `${desktop[1]}:/${desktop[2]}` : source;
}

const samePath = (a: string, b: string) =>
  process.platform === "win32"
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b);

function docker(args: string[]): string {
  const result = Bun.spawnSync(["docker", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  if (result.exitCode !== 0)
    throw new Error(`docker ${args[0]} : ${result.stderr.toString().trim() || result.exitCode}`);
  return result.stdout.toString();
}

const containerHash = (container: string, path: string) =>
  docker(["exec", container, "sha256sum", path]).split(/\s/)[0]!;

type Mount = { Type: string; Source: string; Destination: string; RW: boolean };

function mountOf(mounts: Mount[], destination: string): Mount {
  const found = mounts.filter((m) => m.Destination === destination);
  if (found.length !== 1 || found[0]!.Type !== "bind")
    throw new Error(`${destination} : un seul montage bind hôte déclaré attendu`);
  return found[0]!;
}

async function status(url: string, init: RequestInit = {}): Promise<number | null> {
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    await response.body?.cancel();
    return response.status;
  } catch {
    return null;
  }
}

export type Plan = {
  mode: "plan" | "apply";
  sourceSha256: string;
  container: string;
  sitePid: number;
  upstreamPort: number;
  names: string[];
  preservesExistingRoutes: true;
  markedBlockCount: number;
};

/** Reads everything and renders the candidate; touches nothing. */
export function prepare(config: GatewayConfig, aphrody: string) {
  const sourceBytes = readFileSync(config.sourceConfig);
  const sourceHash = sha256(sourceBytes);
  const original = new TextDecoder("utf-8", { fatal: true })
    .decode(sourceBytes)
    .replace(/^\uFEFF/, "");
  const record = JSON.parse(readFileSync(config.registry, "utf8")) as SiteRecord;
  if (!liveSite(record))
    throw new Error(
      "registre du site natif périmé ou listener non prouvé (native-startup.ts health)",
    );
  const { base, marked } = stripOwnedBlock(original);
  const closing = httpClosing(base);
  const candidate = candidateText(
    base,
    closing,
    render(gatewayModel(config, record.port), aphrody),
  );
  return { sourceBytes, sourceHash, record, marked, candidate };
}

export async function apply(config: GatewayConfig, prepared: ReturnType<typeof prepare>) {
  const { sourceBytes, sourceHash, record, candidate } = prepared;
  if (!sameHash(config.expectedSourceSha256, sourceHash))
    throw new Error("empreinte source attendue différente : refaire et relire le plan");
  const [inspection] = JSON.parse(docker(["inspect", config.container])) as {
    Mounts: Mount[];
    NetworkSettings: { Ports: Record<string, { HostPort: string }[] | null> };
  }[];
  if (!inspection) throw new Error(`conteneur ${config.container} introuvable`);
  if (
    !samePath(
      hostPath(mountOf(inspection.Mounts, "/etc/nginx/nginx.conf").Source),
      config.sourceConfig,
    )
  )
    throw new Error("le montage de la passerelle ne correspond pas à la source déclarée");
  const tls = config.tls?.enabled ? config.tls : undefined;
  const tlsFiles = tls
    ? ([
        ["leaf-chain.pem", tls.certificateSha256],
        ["leaf-key.pem", tls.privateKeySha256],
      ] as const)
    : [];
  if (tls) {
    const mount = mountOf(inspection.Mounts, tls.containerDirectory);
    if (mount.RW) throw new Error("le montage TLS doit être en lecture seule");
    if (!samePath(hostPath(mount.Source), tls.directory))
      throw new Error("le montage TLS diffère du répertoire protégé déclaré");
    for (const protocol of tls.quic ? ["tcp", "udp"] : ["tcp"])
      if (
        !(inspection.NetworkSettings.Ports[`443/${protocol}`] ?? []).some(
          (b) => b.HostPort === "443",
        )
      )
        throw new Error(`publier 443/${protocol} dans Compose d'abord`);
    for (const [file, expected] of tlsFiles) {
      if (!sameHash(expected, sha256(readFileSync(join(tls.directory, file)))))
        throw new Error(`${file} : empreinte différente du manifeste déclaré`);
      if (!sameHash(expected, containerHash(config.container, `${tls.containerDirectory}/${file}`)))
        throw new Error(`${file} : empreinte vue par le conteneur différente`);
    }
  }
  const operations = join(config.home, "host", "operations", "aphrody-gateway");
  mkdirSync(operations, { recursive: true });
  const id = randomUUID().replaceAll("-", "");
  const backup = join(operations, `${id}.backup.conf`);
  const candidatePath = join(operations, `${id}.candidate.conf`);
  const inContainer = `/tmp/aphrody-site-${id}.conf`;
  writeFileSync(backup, sourceBytes);
  if (sha256(readFileSync(backup)) !== sourceHash)
    throw new Error("empreinte de la sauvegarde différente");
  writeFileSync(candidatePath, candidate);
  let changed = false;
  try {
    docker(["cp", candidatePath, `${config.container}:${inContainer}`]);
    docker(["exec", config.container, "nginx", "-t", "-c", inContainer]);
    if (sha256(readFileSync(config.sourceConfig)) !== sourceHash)
      throw new Error("modification concurrente de la passerelle : original préservé");
    // Rewrite in place: the bind mount follows the inode, a rename would leave Docker on the old file.
    changed = true;
    writeFileSync(config.sourceConfig, candidate);
    const candidateHash = sha256(readFileSync(config.sourceConfig));
    if (containerHash(config.container, "/etc/nginx/nginx.conf") !== candidateHash)
      throw new Error("le conteneur ne voit pas les octets du candidat");
    docker(["exec", config.container, "nginx", "-t"]);
    docker(["exec", config.container, "nginx", "-s", "reload"]);
    const deadline = Date.now() + 10_000;
    let http: number | null = null;
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- bounded wait for the reloaded workers
      http = await status("http://127.0.0.1:80/health", { headers: { Host: "localhost" } });
      if (http === 204 || Date.now() >= deadline) break;
      // oxlint-disable-next-line no-await-in-loop -- same bounded wait
      await Bun.sleep(200);
    }
    if (http !== 204) throw new Error("port 80 Host localhost n'atteint pas /health du site natif");
    if (tls) {
      // Validation against the declared local CA (second certificate of the protected chain).
      const chain = readFileSync(join(tls.directory, "leaf-chain.pem"), "utf8");
      const ca = chain.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)?.[1];
      const https = await status("https://localhost:443/health", { tls: { ca } } as RequestInit);
      if (https !== 204) throw new Error("santé HTTPS localhost (CA locale) en échec");
    }
    const receipt = {
      originalSha256: sourceHash,
      candidateSha256: candidateHash,
      backup,
      upstreamPort: record.port,
      httpHealth: 204,
      observedAt: new Date().toISOString(),
    };
    writeFileSync(join(operations, `${id}.receipt.json`), JSON.stringify(receipt, null, 2));
    return { applied: true, httpHealth: 204, backup, sourceSha256: candidateHash };
  } catch (error) {
    if (changed) {
      writeFileSync(config.sourceConfig, sourceBytes);
      if (sha256(readFileSync(config.sourceConfig)) !== sourceHash)
        throw new Error("empreinte du retour arrière différente", { cause: error });
      docker(["exec", config.container, "nginx", "-t"]);
      docker(["exec", config.container, "nginx", "-s", "reload"]);
    }
    throw error;
  } finally {
    // Only this operation's candidate copy, never gateway or container data.
    Bun.spawnSync(["docker", "exec", config.container, "rm", "-f", "--", inContainer], {
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: true,
    });
  }
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  if (command !== "plan" && command !== "apply") {
    console.error("usage : site-gateway.ts plan|apply [--config <chemin>] [--aphrody <exe>]");
    return 2;
  }
  if (process.platform !== "win32") throw new Error("contexte passerelle Windows natif requis");
  const path =
    option(rest, "--config") ??
    join(process.env.APHRODY_HOME ?? join(homedir(), ".aphrody"), "host", "aphrody-gateway.json");
  if (!existsSync(path)) throw new Error(`configuration absente : ${path}`);
  const config = validateConfig(JSON.parse(readFileSync(path, "utf8")));
  const prepared = prepare(config, option(rest, "--aphrody") ?? "aphrody");
  const plan: Plan = {
    mode: command,
    sourceSha256: prepared.sourceHash.toUpperCase(),
    container: config.container,
    sitePid: prepared.record.pid,
    upstreamPort: prepared.record.port,
    names: config.serverNames,
    preservesExistingRoutes: true,
    markedBlockCount: prepared.marked,
  };
  console.log(JSON.stringify(plan, null, 2));
  if (command === "apply") console.log(JSON.stringify(await apply(config, prepared), null, 2));
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    console.error(`site-gateway : ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
