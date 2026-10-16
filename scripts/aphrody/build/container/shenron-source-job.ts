// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop -- Artifact hashes and namespace lifecycle probes are deliberately serial and bounded. */
import {
  chmod,
  lstat,
  readlink,
  realpath,
  mkdir,
  rmdir,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export interface SourceJobConfig {
  version: 1;
  type: "shenron-source-vpn";
  host: "vps" | "dbfr";
  imageId: string;
  runtime: { path: string; sha256: string };
  bundle: { path: string; sha256: string };
  resources: { path: string; relaysSha256: string };
  dataRoot: string;
  vpnStateRoot: string;
  pipelineConfig: string;
  googleJar: string;
  timeoutMs?: number;
}
export interface SourceJobPlan {
  schema: "shenron-source-vpn-job/v1";
  config: SourceJobConfig;
  configSha256: string;
  pipelineConfigSha256: string;
  hostNetns: string;
  hostMountns: string;
  hostDnsSha256: string;
  hostRouteSha256: string;
  hostIdentitySha256: string;
  googleJarSha256: string;
  collectionSchema?:
    "shenron-source-collection/v1" | "shenron-source-collection/v2";
}
export interface SourceJobResult {
  code: number;
  stdout: string;
}
export interface SourceJobPorts {
  run?: (
    args: string[],
    options: { stdin?: Uint8Array; timeoutMs: number; signal?: AbortSignal },
  ) => Promise<SourceJobResult>;
  account?: () => Promise<string | null>;
  signal?: AbortSignal;
}
const sha = (bytes: string | Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const validSha = (value: string) => /^[a-f0-9]{64}$/.test(value);
const logicalRoot = "/app/data/source-pipeline";
function inside(root: string, path: string) {
  const child = relative(root, path);
  return (
    !!child && !isAbsolute(child) && child !== ".." && !child.startsWith("../")
  );
}
function sourceCollectionSchema(source: Record<string, unknown>) {
  if (source.batchCollection === undefined)
    return "shenron-source-collection/v1" as const;
  const batch = source.batchCollection as Record<string, unknown> | null;
  const crawl = source.crawl as { mode?: unknown } | undefined;
  if (
    !batch ||
    typeof batch !== "object" ||
    Array.isArray(batch) ||
    batch.version !== 1 ||
    batch.maxBatchesPerCycle !== 1 ||
    typeof batch.snapshotSha256 !== "string" ||
    !validSha(batch.snapshotSha256) ||
    !Number.isSafeInteger(batch.batchSize) ||
    Number(batch.batchSize) < 1 ||
    Number(batch.batchSize) > 100000 ||
    Number(batch.batchSize) > Number(source.maxDocuments ?? 10000) ||
    Object.keys(batch).some(
      (key) =>
        ![
          "version",
          "snapshotSha256",
          "batchSize",
          "maxBatchesPerCycle",
        ].includes(key),
    ) ||
    (crawl && crawl.mode !== "attach")
  )
    throw Error("Explicit immutable source batch collection required");
  return "shenron-source-collection/v2" as const;
}
/** Transport validation only; the pinned Shenron owner verifies document membership and projections. */
export function validSourceCollectionReceipt(
  receipt: Record<string, unknown>,
  expectedSchema: string,
  configSha256: string,
) {
  if (
    receipt.schema !== expectedSchema ||
    receipt.configSha256 !== configSha256 ||
    typeof receipt.pinnedConfigPath !== "string" ||
    !inside(logicalRoot, receipt.pinnedConfigPath) ||
    ![
      receipt.pinnedConfigSha256,
      receipt.collectionSha256,
      receipt.artifactsSha256,
      receipt.revisionIdentity,
    ].every((pin) => typeof pin === "string" && validSha(pin))
  )
    return false;
  if (expectedSchema === "shenron-source-collection/v1") return true;
  if (
    expectedSchema !== "shenron-source-collection/v2" ||
    receipt.artifactOnly !== true ||
    receipt.complete !== false ||
    receipt.deliveryAuthorized !== false
  )
    return false;
  const batch = receipt.batch as Record<string, unknown> | undefined;
  if (
    !batch ||
    typeof batch !== "object" ||
    Array.isArray(batch) ||
    ![
      batch.sourceSha256,
      batch.manifestSha256,
      batch.batchReceiptSha256,
      batch.exportSha256,
      batch.validationSha256,
    ].every((pin) => typeof pin === "string" && validSha(pin)) ||
    ![batch.cursor, batch.nextCursor, batch.totalDocuments].every(
      Number.isSafeInteger,
    ) ||
    Number(batch.cursor) < 0 ||
    Number(batch.nextCursor) < Number(batch.cursor) ||
    Number(batch.nextCursor) > Number(batch.totalDocuments) ||
    Number(batch.nextCursor) - Number(batch.cursor) > 100000 ||
    (Number(batch.totalDocuments) > 0 &&
      Number(batch.nextCursor) === Number(batch.cursor)) ||
    typeof batch.exportComplete !== "boolean" ||
    typeof batch.validationComplete !== "boolean"
  )
    return false;
  return [
    receipt.collectionPath,
    batch.manifestPath,
    batch.batchReceiptPath,
    batch.exportPath,
    batch.validationPath,
  ].every(
    (path) =>
      typeof path === "string" &&
      isAbsolute(path) &&
      resolve(path) === path &&
      inside(logicalRoot, path),
  );
}
async function protectedPath(
  path: string,
  directory: boolean,
  privateMode = true,
) {
  if (!isAbsolute(path) || resolve(path) !== path || /[:,\n\r\0]/.test(path))
    throw new Error("Invalid source job path");
  const info = await lstat(path);
  if (
    info.isSymbolicLink() ||
    (await realpath(path)) !== path ||
    (directory ? !info.isDirectory() : !info.isFile())
  )
    throw new Error("Source job path is not a regular owned path");
  if (
    ![0, process.getuid?.() ?? 1000].includes(info.uid) ||
    info.mode & (privateMode ? 0o077 : 0o022)
  )
    throw new Error("Source job path permissions are unsafe");
}
async function fileSha(path: string) {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}
export async function sourceJobRun(
  args: string[],
  options: { stdin?: Uint8Array; timeoutMs: number; signal?: AbortSignal },
): Promise<SourceJobResult> {
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const child = Bun.spawn(args, {
    stdin: options.stdin ? new Blob([new Uint8Array(options.stdin)]) : "ignore",
    stdout: "pipe",
    stderr: "ignore",
    signal,
  });
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  let exited = false;
  void child.exited.then((code) => {
    exited = true;
    return code;
  });
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const terminate = () => {
    if (exited) return;
    child.kill("SIGTERM");
    escalation ??= setTimeout(() => {
      if (!exited) child.kill("SIGKILL");
    }, 250);
  };
  signal.addEventListener("abort", terminate, { once: true });
  if (signal.aborted) terminate();
  let output = "";
  let outputBytes = 0;
  try {
    const decoder = new TextDecoder();
    for await (const chunk of child.stdout) {
      outputBytes += chunk.length;
      if (outputBytes > 1048576) {
        terminate();
        throw new Error("Source job output exceeds budget");
      }
      output += decoder.decode(chunk, { stream: true });
    }
    return { code: await child.exited, stdout: output };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", terminate);
    terminate();
    let reapTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        child.exited,
        new Promise<never>((_, reject) => {
          reapTimer = setTimeout(
            () => reject(new Error("Source job process teardown uncertain")),
            2500,
          );
        }),
      ]);
    } finally {
      if (escalation) clearTimeout(escalation);
      if (reapTimer) clearTimeout(reapTimer);
    }
  }
}
async function checked(
  run: NonNullable<SourceJobPorts["run"]>,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
  stdin?: Uint8Array,
) {
  const result = await run(args, {
    timeoutMs,
    signal,
    ...(stdin ? { stdin } : {}),
  });
  if (result.code !== 0)
    throw new Error("Source job native owner command failed");
  return result.stdout;
}
async function verifyInputs(config: SourceJobConfig) {
  if (
    config.version !== 1 ||
    config.type !== "shenron-source-vpn" ||
    !["vps", "dbfr"].includes(config.host) ||
    !/^sha256:[a-f0-9]{64}$/.test(config.imageId)
  )
    throw new Error("Expected a qualified immutable source job image");
  if (
    !Number.isSafeInteger(config.timeoutMs ?? 900000) ||
    (config.timeoutMs ?? 900000) < 1000 ||
    (config.timeoutMs ?? 900000) > 900000
  )
    throw new Error("Source job deadline exceeds budget");
  await protectedPath(config.dataRoot, true);
  await protectedPath(config.vpnStateRoot, true);
  await protectedPath(config.resources.path, true);
  await protectedPath(join(config.resources.path, "relays.json"), false);
  await protectedPath(config.googleJar, false);
  await protectedPath(config.pipelineConfig, false);
  if (
    !inside(config.dataRoot, config.pipelineConfig) ||
    config.pipelineConfig !== join(config.dataRoot, "config.json") ||
    config.dataRoot === config.vpnStateRoot ||
    inside(config.dataRoot, config.vpnStateRoot) ||
    inside(config.vpnStateRoot, config.dataRoot)
  )
    throw new Error("Source job mount boundaries overlap");
  for (const input of [config.runtime, config.bundle]) {
    await protectedPath(input.path, false, false);
    if (!validSha(input.sha256) || (await fileSha(input.path)) !== input.sha256)
      throw new Error("Source job artifact hash differs");
  }
  if (
    !validSha(config.resources.relaysSha256) ||
    (await fileSha(join(config.resources.path, "relays.json"))) !==
      config.resources.relaysSha256
  )
    throw new Error("Source job relay resource hash differs");
  const source = await Bun.file(config.pipelineConfig).json();
  if (source.collectionIsolation !== "required")
    throw new Error("Source pipeline must require isolated collection");
  if (
    [source.input, source.policy, source.job].some(
      (path) => typeof path !== "string",
    )
  )
    throw new Error("Source collection input paths are required");
  const logicalPaths: unknown[] = [
    source.input,
    source.policy,
    source.job,
    source.media,
    source.crawl?.config,
    source.crawl?.output,
    source.store?.manifest,
    source.store?.profile,
    source.store?.sdkModule,
  ];
  if (
    logicalPaths
      .filter((path) => path !== undefined)
      .some(
        (path) =>
          typeof path !== "string" ||
          !isAbsolute(path) ||
          resolve(path) !== path ||
          !inside(logicalRoot, path),
      )
  )
    throw new Error(
      "Source job config paths must stay in its private logical volume",
    );
  if (source.search && source.search.cookieJar !== "/job/google-cookies.json")
    throw new Error("Source job Search must use its protected read-only jar");
  if (sourceCollectionSchema(source) === "shenron-source-collection/v2") {
    const input = join(config.dataRoot, relative(logicalRoot, source.input));
    await protectedPath(input, false);
    if (
      (await lstat(input)).size > 1024 ** 3 ||
      (await fileSha(input)) !== source.batchCollection.snapshotSha256
    )
      throw Error("Source batch input must be an immutable pinned snapshot");
  }
  for (const input of [
    config.runtime.path,
    config.bundle.path,
    config.resources.path,
    config.googleJar,
  ]) {
    if (
      inside(config.dataRoot, input) ||
      inside(config.vpnStateRoot, input) ||
      input === config.dataRoot ||
      input === config.vpnStateRoot
    )
      throw new Error("Read-only source job artifact overlaps writable state");
  }
}
export async function planSourceJob(
  config: SourceJobConfig,
  ports: SourceJobPorts = {},
): Promise<SourceJobPlan> {
  await verifyInputs(config);
  const run = ports.run ?? sourceJobRun;
  const hostRoute = await checked(
    run,
    ["ip", "route", "show", "default"],
    10000,
    ports.signal,
  );
  return {
    schema: "shenron-source-vpn-job/v1",
    config,
    configSha256: sha(JSON.stringify(config)),
    pipelineConfigSha256: await fileSha(config.pipelineConfig),
    hostNetns: await readlink("/proc/self/ns/net"),
    hostMountns: await readlink("/proc/self/ns/mnt"),
    hostDnsSha256: await fileSha("/etc/resolv.conf"),
    hostRouteSha256: sha(hostRoute),
    hostIdentitySha256: await fileSha("/etc/machine-id"),
    googleJarSha256: await fileSha(config.googleJar),
    collectionSchema: sourceCollectionSchema(
      await Bun.file(config.pipelineConfig).json(),
    ),
  };
}
/** Only this typed job receives the capabilities required by its embedded VPN daemon. */
export function sourceJobArgs(plan: SourceJobPlan, name: string): string[] {
  const c = plan.config;
  if (!/^shenron-source-vpn-[a-f0-9]{16}$/.test(name))
    throw new Error("Invalid owned source container identity");
  const guard = `import{readlink,lstat}from"node:fs/promises";setTimeout(()=>process.exit(124),${(c.timeoutMs ?? 900000) + 60000});if(await readlink("/proc/self/ns/net")===${JSON.stringify(plan.hostNetns)}||await readlink("/proc/self/ns/mnt")===${JSON.stringify(plan.hostMountns)})throw Error("VPN namespace isolation missing");try{await lstat("/run/dbus/system_bus_socket");throw Error("Host DBus must not be mounted");}catch(e){if(e.code!=="ENOENT")throw e;}const pins=${JSON.stringify(
    [
      ["/job/runtime", c.runtime.sha256],
      ["/job/pipeline.mjs", c.bundle.sha256],
      ["/job/resources/relays.json", c.resources.relaysSha256],
      [logicalRoot + "/config.json", plan.pipelineConfigSha256],
      ["/job/google-cookies.json", plan.googleJarSha256],
    ],
  )};for(const[path,pin]of pins){const h=new Bun.CryptoHasher("sha256");for await(const chunk of Bun.file(path).stream())h.update(chunk);if(h.digest("hex")!==pin)throw Error("Pinned source job artifact changed");}const p=Bun.spawn(["/job/runtime","vpn","daemon"],{env:process.env,stdio:["ignore","ignore","ignore"]});process.exit(await p.exited);`;
  return [
    "docker",
    "run",
    "--detach",
    "--rm",
    "--init",
    "--pull=never",
    "--name",
    name,
    "--label",
    `aphrody.source.plan=${sha(JSON.stringify(plan))}`,
    "--label",
    `aphrody.source.instance=${name}`,
    "--network",
    "bridge",
    "--log-driver",
    "none",
    "--user",
    "0:0",
    "--cpus",
    "2",
    "--memory",
    "1024m",
    "--memory-swap",
    "1024m",
    "--pids-limit",
    "128",
    "--security-opt",
    "no-new-privileges:true",
    "--cap-drop",
    "ALL",
    ...[
      "NET_ADMIN",
      "SETUID",
      "SETGID",
      "CHOWN",
      "DAC_OVERRIDE",
      "KILL",
    ].flatMap((cap) => ["--cap-add", cap]),
    "--device",
    "/dev/net/tun:/dev/net/tun",
    "--tmpfs",
    "/run:rw,nosuid,nodev,mode=0755",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=128m",
    "--tmpfs",
    `${logicalRoot}/credentials:ro,nosuid,nodev,noexec,mode=000`,
    "--tmpfs",
    `${logicalRoot}/control:ro,nosuid,nodev,noexec,mode=000`,
    "--mount",
    `type=bind,src=${c.runtime.path},dst=/job/runtime,readonly`,
    "--mount",
    `type=bind,src=${c.bundle.path},dst=/job/pipeline.mjs,readonly`,
    "--mount",
    `type=bind,src=${join(c.resources.path, "relays.json")},dst=/job/resources/relays.json,readonly`,
    "--mount",
    `type=bind,src=${c.vpnStateRoot},dst=/job/vpn`,
    "--mount",
    `type=bind,src=${c.dataRoot},dst=${logicalRoot}`,
    "--mount",
    `type=bind,src=${c.googleJar},dst=/job/google-cookies.json,readonly`,
    ...[
      "BUN_BE_BUN=1",
      "TALPID_DNS_MODULE=static-file",
      "MULLVAD_SETTINGS_DIR=/job/vpn/settings",
      "MULLVAD_CACHE_DIR=/job/vpn/cache",
      "MULLVAD_RESOURCE_DIR=/job/resources",
      "MULLVAD_RPC_SOCKET_PATH=/run/bun-vpn/pipeline.sock",
      "APHRODY_GOOGLE_COOKIES_JSON=/job/google-cookies.json",
    ].flatMap((env) => ["--env", env]),
    "--entrypoint",
    "/job/runtime",
    c.imageId,
    "-e",
    guard,
  ];
}
async function finishSourceJob(
  plan: SourceJobPlan,
  name: string,
  expectedPlanSha256: string,
  run: NonNullable<SourceJobPorts["run"]>,
  created: boolean,
) {
  if (created) {
    const ownership = await run(
      [
        "docker",
        "inspect",
        "--format",
        '{{index .Config.Labels "aphrody.source.plan"}}|{{index .Config.Labels "aphrody.source.instance"}}',
        name,
      ],
      { timeoutMs: 10000 },
    );
    if (ownership.code === 0) {
      if (ownership.stdout.trim() !== `${expectedPlanSha256}|${name}`)
        throw new Error("Source job teardown refused foreign container");
      await run(["docker", "stop", "--time", "10", name], { timeoutMs: 15000 });
      const gone = await run(["docker", "inspect", name], { timeoutMs: 10000 });
      if (gone.code === 0) throw new Error("Source job teardown incomplete");
    }
  }
  if (
    (await fileSha("/etc/resolv.conf")) !== plan.hostDnsSha256 ||
    sha(await checked(run, ["ip", "route", "show", "default"], 10000)) !==
      plan.hostRouteSha256
  )
    throw new Error("Source job changed host networking");
}
export async function applySourceJob(
  plan: SourceJobPlan,
  expectedPlanSha256: string,
  ports: SourceJobPorts = {},
) {
  if (
    !validSha(expectedPlanSha256) ||
    sha(JSON.stringify(plan)) !== expectedPlanSha256 ||
    plan.schema !== "shenron-source-vpn-job/v1" ||
    plan.configSha256 !== sha(JSON.stringify(plan.config))
  )
    throw new Error("Source job saved plan differs");
  await verifyInputs(plan.config);
  if ((await fileSha(plan.config.pipelineConfig)) !== plan.pipelineConfigSha256)
    throw new Error("Source job config changed after plan");
  if (
    sourceCollectionSchema(
      await Bun.file(plan.config.pipelineConfig).json(),
    ) !== (plan.collectionSchema ?? "shenron-source-collection/v1")
  )
    throw Error("Source collection protocol changed since plan");
  const run = ports.run ?? sourceJobRun;
  if (
    (await readlink("/proc/self/ns/net")) !== plan.hostNetns ||
    (await readlink("/proc/self/ns/mnt")) !== plan.hostMountns ||
    (await fileSha("/etc/machine-id")) !== plan.hostIdentitySha256
  )
    throw new Error("Source job controller namespace changed");
  if ((await fileSha(plan.config.googleJar)) !== plan.googleJarSha256)
    throw new Error("Source job Google jar changed since plan");
  if (
    (await fileSha("/etc/resolv.conf")) !== plan.hostDnsSha256 ||
    sha(
      await checked(
        run,
        ["ip", "route", "show", "default"],
        10000,
        ports.signal,
      ),
    ) !== plan.hostRouteSha256
  )
    throw new Error("Host networking changed since source job plan");
  const name = `shenron-source-vpn-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const account = await (
    ports.account ??
    (() => Bun.secrets.get({ service: "bun-vpn", name: "mullvad-account" }))
  )();
  if (!account || !/^\d{16}$/.test(account.trim()))
    throw new Error("Source job protected VPN account unavailable");
  const deadline = Date.now() + (plan.config.timeoutMs ?? 900000);
  const remaining = () => {
    const value = deadline - Date.now();
    if (value <= 0) throw new Error("Source job deadline exceeded");
    return value;
  };
  let created = false;
  const exec = (args: string[], user = "0:0") => [
    "docker",
    "exec",
    "--user",
    user,
    "--env",
    "BUN_BE_BUN=1",
    name,
    "/job/runtime",
    ...args,
  ];
  const lock = join(
    plan.config.dataRoot,
    `.infra-vpn-${expectedPlanSha256}.lock`,
  );
  await mkdir(lock, { mode: 0o700 });
  try {
    if (
      (
        await run(["docker", "inspect", name], {
          timeoutMs: Math.min(10000, remaining()),
          signal: ports.signal,
        })
      ).code === 0
    )
      throw new Error("Source job is already owned by another execution");
    created = true;
    await checked(
      run,
      sourceJobArgs(plan, name),
      Math.min(30000, remaining()),
      ports.signal,
    );
    const startupDeadline = Date.now() + Math.min(30000, remaining());
    for (;;) {
      const state = await run(exec(["vpn", "status"]), {
        timeoutMs: Math.min(10000, remaining()),
        signal: ports.signal,
      });
      if (state.code === 0) break;
      if (Date.now() >= startupDeadline)
        throw new Error("Source job VPN IPC startup failed");
      const running = await checked(
        run,
        ["docker", "inspect", "--format", "{{.State.Running}}", name],
        Math.min(10000, remaining()),
        ports.signal,
      );
      if (running.trim() !== "true")
        throw new Error("Source job VPN daemon exited");
      await Bun.sleep(Math.min(100, remaining()));
    }
    await checked(
      run,
      [
        "docker",
        "exec",
        "-i",
        "--env",
        "BUN_BE_BUN=1",
        name,
        "/job/runtime",
        "vpn",
        "login",
        "--stdin",
      ],
      Math.min(30000, remaining()),
      ports.signal,
      new TextEncoder().encode(account.trim() + "\n"),
    );
    await checked(
      run,
      exec(["vpn", "connect"]),
      Math.min(30000, remaining()),
      ports.signal,
    );
    const connectDeadline = Date.now() + Math.min(60000, remaining());
    for (;;) {
      const state = await checked(
        run,
        exec(["vpn", "status"]),
        Math.min(10000, remaining()),
        ports.signal,
      );
      if (/^Connected\b/.test(state.trim())) break;
      if (Date.now() >= connectDeadline)
        throw new Error("Source job VPN connection deadline exceeded");
      await Bun.sleep(Math.min(100, remaining()));
    }
    const receiptName = `.infra-collection-${expectedPlanSha256}-${crypto.randomUUID()}.json`;
    const receiptDestination = logicalRoot + "/" + receiptName;
    const code = `import{chmod,rename}from"node:fs/promises";const exitResponse=await fetch("https://am.i.mullvad.net/json",{redirect:"error",signal:AbortSignal.timeout(15000)});if(!exitResponse.ok||(await exitResponse.json()).mullvad_exit_ip!==true)throw Error("Private Mullvad egress qualification failed");const google=await fetch("https://www.google.com/generate_204",{redirect:"error",signal:AbortSignal.timeout(15000)});if(google.status!==204)throw Error("Private Google TLS qualification failed");const m=await import("/job/pipeline.mjs");const r=await m.collectSourcePipeline(${JSON.stringify(logicalRoot + "/config.json")},{isolatedCollection:true,signal:AbortSignal.timeout(${remaining()})});const path=${JSON.stringify(receiptDestination)};await Bun.write(path+".new",JSON.stringify(r));await chmod(path+".new",0o600);await rename(path+".new",path);`;
    await checked(
      run,
      exec(["-e", code], "1000:1000"),
      remaining(),
      ports.signal,
    );
    const receiptPath = join(plan.config.dataRoot, receiptName);
    await protectedPath(receiptPath, false);
    if (Bun.file(receiptPath).size > 1048576)
      throw new Error("Source collection receipt exceeds budget");
    const receipt = (await Bun.file(receiptPath).json()) as Record<
      string,
      unknown
    >;
    if (
      !validSourceCollectionReceipt(
        receipt,
        plan.collectionSchema ?? "shenron-source-collection/v1",
        plan.pipelineConfigSha256,
      )
    )
      throw new Error("Source collection receipt is invalid");
    const pinnedConfig = join(
      plan.config.dataRoot,
      relative(logicalRoot, receipt.pinnedConfigPath as string),
    );
    await protectedPath(pinnedConfig, false);
    if ((await fileSha(pinnedConfig)) !== receipt.pinnedConfigSha256)
      throw new Error("Source collection config receipt differs");
    if (receipt.schema === "shenron-source-collection/v2") {
      const batch = receipt.batch as Record<string, string>;
      const source = await Bun.file(plan.config.pipelineConfig).json();
      if (
        batch.sourceSha256 !== source.batchCollection.snapshotSha256 ||
        Number(batch.nextCursor) - Number(batch.cursor) >
          source.batchCollection.batchSize
      )
        throw Error("Versioned collection snapshot or range differs");
      for (const [logical, expected] of [
        [receipt.collectionPath, receipt.collectionSha256],
        [batch.manifestPath, batch.manifestSha256],
        [batch.batchReceiptPath, batch.batchReceiptSha256],
        [batch.exportPath, batch.exportSha256],
        [batch.validationPath, batch.validationSha256],
      ]) {
        const path = join(
          plan.config.dataRoot,
          relative(logicalRoot, logical as string),
        );
        await protectedPath(path, false);
        if (
          (await lstat(path)).size > 1024 ** 3 ||
          (await fileSha(path)) !== expected
        )
          throw Error("Versioned collection artifact hash differs");
      }
    }
    return {
      collected: true,
      stage: "collection-only" as const,
      pipelineComplete: false,
      receiptPath,
      receiptSha256: await fileSha(receiptPath),
      collection: receipt,
    };
  } finally {
    try {
      await finishSourceJob(plan, name, expectedPlanSha256, run, created);
    } finally {
      await rmdir(lock);
    }
  }
}
export async function sourceJobCli(args: string[]) {
  if (args[0] === "drain") {
    if (
      args.length !== 5 ||
      args[1] !== "--config" ||
      args[3] !== "--config-sha256"
    )
      throw new Error("source-job drain --config PRIVATE --config-sha256 HASH");
    const { drainSourceOutbox } = await import("./shenron-source-outbox.ts");
    console.log(JSON.stringify(await drainSourceOutbox(args[2]!, args[4]!)));
    return;
  }
  const [action, flag, configPath, planFlag, planPath, hashFlag, planHash] =
    args;
  if (
    !["plan", "apply"].includes(action ?? "") ||
    flag !== "--config" ||
    !configPath ||
    planFlag !== "--plan" ||
    !planPath ||
    (action === "apply"
      ? hashFlag !== "--plan-sha256" || !planHash || args.length !== 7
      : args.length !== 5)
  )
    throw new Error(
      "source-job plan|apply --config PRIVATE --plan PRIVATE [--plan-sha256 HASH]",
    );
  await protectedPath(configPath, false);
  const config = (await Bun.file(configPath).json()) as SourceJobConfig;
  if (action === "plan") {
    const plan = await planSourceJob(config);
    if (!isAbsolute(planPath) || resolve(planPath) !== planPath)
      throw new Error("Source job plan must be an absolute private path");
    if (await Bun.file(planPath).exists())
      throw new Error("Source job plan must be new");
    await mkdir(resolve(planPath, ".."), { recursive: true, mode: 0o700 });
    await protectedPath(resolve(planPath, ".."), true);
    await Bun.write(planPath, JSON.stringify(plan));
    await chmod(planPath, 0o600);
    console.log(
      JSON.stringify({
        planPath,
        planSha256: sha(JSON.stringify(plan)),
        apply: false,
      }),
    );
  } else {
    await protectedPath(planPath, false);
    const plan = (await Bun.file(planPath).json()) as SourceJobPlan;
    if (JSON.stringify(plan.config) !== JSON.stringify(config))
      throw new Error("Source job config differs from saved plan");
    console.log(JSON.stringify(await applySourceJob(plan, planHash!)));
  }
}
