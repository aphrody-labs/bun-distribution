// SPDX-License-Identifier: Apache-2.0
/** Infra prepares fresh native-origin pins; the product's canonical publisher retains all writes. */
import { lstat, mkdir, rmdir, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { assertConsumerFile } from "./shenron-cdn-origin-consumer";

const CONFIG = "/etc/aphrody/cloudflare/origin-cdn.json";
const CODE = "/etc/aphrody/cloudflare/cli/cdn-origin.mjs";
const UNIT = "/etc/systemd/system/shenron-cdn-origin.service";
const hash = (bytes: Uint8Array | string) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const SHA = /^[a-f0-9]{64}$/;
type Json = Record<string, unknown>;
export interface OriginPreparationInput {
  job: string;
  stateDirectory: string;
  inventoryRoot: string;
  activationModulePath: string;
  activationModuleSha256: string;
  expectedConsumerCodeSha256: string;
  expectedUnitSha256: string;
}
export interface OriginPreparationPorts {
  lock<T>(operation: () => Promise<T>): Promise<T>;
  stored(): Promise<Json | null>;
  snapshot(): Promise<{ config: Json; configSha256: string; state: Json; stateSha256: string }>;
  qualify(input: OriginPreparationInput): Promise<void>;
  attest(snapshot: {
    config: Json;
    configSha256: string;
    state: Json;
    stateSha256: string;
  }): Promise<void>;
  backup(
    bytesSha256: string,
  ): Promise<{ backupPath: string; snapshotSha256: string; verified: boolean }>;
  receipt(value: Json): Promise<{ path: string; sha256: string }>;
  store(value: Json): Promise<void>;
}
export interface PreparedOriginPublication extends Json {
  configuration: Record<string, string>;
  configurationSha256: string;
  stateSha256: string;
  previousInventory: string;
  previousInventorySha256: string;
  expectedPrefix: string;
  expectedDeployment: string;
  expectedCodeSha256: string;
  modulePath: string;
  moduleSha256: string;
  preparationPath: string;
  replay: boolean;
}
export async function prepareOriginPublication(
  input: OriginPreparationInput,
  ports: OriginPreparationPorts,
): Promise<PreparedOriginPublication> {
  const names = [
    "job",
    "stateDirectory",
    "inventoryRoot",
    "activationModulePath",
    "activationModuleSha256",
    "expectedConsumerCodeSha256",
    "expectedUnitSha256",
  ];
  if (
    Object.keys(input).length !== names.length ||
    Object.keys(input).some((name) => !names.includes(name))
  )
    throw Error("Exact typed preparation input required");
  for (const name of ["job", "stateDirectory", "inventoryRoot", "activationModulePath"] as const)
    if (!isAbsolute(input[name])) throw Error("Absolute owner paths required");
  for (const name of [
    "activationModuleSha256",
    "expectedConsumerCodeSha256",
    "expectedUnitSha256",
  ] as const)
    if (!SHA.test(input[name])) throw Error("Complete preparation SHA pins required");
  const inputSha256 = hash(JSON.stringify(input));
  return ports.lock(async () => {
    const stored = await ports.stored();
    if (stored) {
      if (
        stored.inputSha256 !== inputSha256 ||
        stored.schema !== "aphrody-origin-publication-preparation/v1"
      )
        throw Error("Immutable preparation input changed");
      if (
        !stored.configuration ||
        hash(JSON.stringify(stored.configuration)) !== stored.configurationSha256 ||
        !SHA.test(String(stored.stateSha256))
      )
        throw Error("Stored preparation integrity differs");
      for (const name of [
        "previousInventory",
        "expectedPrefix",
        "expectedDeployment",
        "preparationPath",
      ])
        if (typeof stored[name] !== "string") throw Error("Stored preparation shape differs");
      for (const name of ["previousInventorySha256", "expectedCodeSha256", "moduleSha256"])
        if (!SHA.test(String(stored[name]))) throw Error("Stored preparation SHA differs");
      if (
        stored.modulePath !== input.activationModulePath ||
        stored.moduleSha256 !== input.activationModuleSha256
      )
        throw Error("Stored preparation module differs");
      return { ...stored, replay: true } as PreparedOriginPublication;
    }
    await ports.qualify(input);
    const before = await ports.snapshot();
    const { state, config } = before;
    if (
      !SHA.test(before.configSha256) ||
      !SHA.test(before.stateSha256) ||
      config.inventoryPath !== state.inventoryPath ||
      config.inventorySha256 !== state.inventorySha256 ||
      config.manifestPrefix !== state.prefix ||
      !SHA.test(String(state.inventorySha256)) ||
      !SHA.test(String(state.codeSha256)) ||
      typeof state.deploymentId !== "string"
    )
      throw Error("Current origin and canonical publication state differ");
    await ports.attest(before);
    const backup = await ports.backup(before.configSha256);
    if (
      backup.verified !== true ||
      backup.snapshotSha256 !== before.configSha256 ||
      !isAbsolute(backup.backupPath)
    )
      throw Error("Fresh off-host backup is unqualified");
    const after = await ports.snapshot();
    if (after.configSha256 !== before.configSha256 || after.stateSha256 !== before.stateSha256)
      throw Error("Origin or publication state changed during backup");
    const receipt = await ports.receipt({
      schema: "aphrody-off-host-snapshot/v1",
      sourceHost: "dbfr",
      backupHost: "vps",
      snapshotSha256: before.configSha256,
      verified: true,
      backupPath: backup.backupPath,
    });
    const configuration = {
      configSha256: before.configSha256,
      consumerCodeSha256: input.expectedConsumerCodeSha256,
      unitSha256: input.expectedUnitSha256,
      inventoryRoot: input.inventoryRoot,
      backupReceipt: receipt.path,
      backupReceiptSha256: receipt.sha256,
    };
    const result: PreparedOriginPublication = {
      schema: "aphrody-origin-publication-preparation/v1",
      inputSha256,
      configuration,
      configurationSha256: hash(JSON.stringify(configuration)),
      stateSha256: before.stateSha256,
      previousInventory: String(state.inventoryPath),
      previousInventorySha256: String(state.inventorySha256),
      expectedPrefix: String(state.prefix),
      expectedDeployment: String(state.deploymentId),
      expectedCodeSha256: String(state.codeSha256),
      modulePath: input.activationModulePath,
      moduleSha256: input.activationModuleSha256,
      preparationPath: join(input.job, "origin-preparation.json"),
      replay: false,
    };
    await ports.store(result);
    return result;
  });
}

async function guarded(path: string, max = 16384) {
  const info = await lstat(path);
  assertConsumerFile(info, true);
  if (info.size > max) throw Error("Preparation file exceeds bound");
  return Bun.file(path).bytes();
}
async function privateWrite(path: string, value: Json) {
  const bytes = JSON.stringify(value);
  try {
    const stored = await guarded(path);
    if (hash(stored) !== hash(bytes)) throw Error("Immutable preparation receipt changed");
    return { path, sha256: hash(stored) };
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  return { path, sha256: hash(bytes) };
}
async function scoped(root: string, path: string) {
  const inside = relative(await realpath(root), await realpath(path));
  if (!inside || inside.startsWith("..") || isAbsolute(inside))
    throw Error("Preparation path escaped private owner root");
}
async function ssh(command: string, stdin?: Uint8Array) {
  const child = Bun.spawn(
    [
      "sudo",
      "-n",
      "-u",
      "ubuntu",
      "ssh",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "vps",
      command,
    ],
    {
      stdin: stdin ? new Blob([new Uint8Array(stdin)]) : "ignore",
      stdout: "pipe",
      stderr: "ignore",
      timeout: 25000,
    },
  );
  const [output, exit] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (exit !== 0) throw Error("Existing off-host backup transport failed");
  return output.trim();
}
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export function assertPreparationDirectory(
  info: { uid: number; mode: number; isDirectory(): boolean; isSymbolicLink(): boolean },
  rootOwned: boolean,
) {
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (rootOwned && info.uid !== 0) ||
    info.mode & 0o077
  )
    throw Error(
      "Private preparation directory required; writable job and state must be root-owned",
    );
}
/** This capability executes on DBFR root only; credentials remain in their existing stores. */
export async function prepareNativeOriginPublication(input: OriginPreparationInput) {
  if (process.platform !== "linux" || process.getuid?.() !== 0)
    throw Error("DBFR root preparation context required");
  await scoped(input.inventoryRoot, input.job);
  await scoped(input.inventoryRoot, input.stateDirectory);
  await Promise.all(
    [input.inventoryRoot, input.job, input.stateDirectory].map(async (path) =>
      assertPreparationDirectory(await lstat(path), path !== input.inventoryRoot),
    ),
  );
  const statePath = join(input.stateDirectory, "current-inventory.json");
  const lockPath = join(input.stateDirectory, "publish.lock");
  let configBytes!: Uint8Array;
  return prepareOriginPublication(input, {
    async lock(operation) {
      await mkdir(lockPath, { mode: 0o700 });
      try {
        return await operation();
      } finally {
        await rmdir(lockPath);
      }
    },
    async stored() {
      const path = join(input.job, "origin-preparation.json");
      try {
        return JSON.parse(new TextDecoder().decode(await guarded(path)));
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return null;
        throw error;
      }
    },
    async qualify(value) {
      if (
        hash(await guarded(value.activationModulePath, 1024 * 1024)) !==
          value.activationModuleSha256 ||
        hash(await guarded(CODE, 1024 * 1024)) !== value.expectedConsumerCodeSha256
      )
        throw Error("Installed native module changed");
      assertConsumerFile(await lstat(UNIT), false);
      if (hash(await Bun.file(UNIT).bytes()) !== value.expectedUnitSha256)
        throw Error("Origin unit changed");
    },
    async snapshot() {
      configBytes = await guarded(CONFIG);
      const stateBytes = await guarded(statePath);
      const config = JSON.parse(new TextDecoder().decode(configBytes));
      const allowed = new Set([
        "manifest",
        "profile",
        "sdkModule",
        "hostname",
        "port",
        "inventoryPath",
        "inventorySha256",
        "manifestPrefix",
      ]);
      if (
        Object.keys(config).some((key) => !allowed.has(key)) ||
        ["manifest", "profile", "sdkModule", "inventoryPath"].some(
          (key) => typeof config[key] !== "string" || !isAbsolute(config[key]),
        )
      )
        throw Error("Origin backup may contain only declared references and public metadata");
      return {
        config,
        configSha256: hash(configBytes),
        state: JSON.parse(new TextDecoder().decode(stateBytes)),
        stateSha256: hash(stateBytes),
      };
    },
    async attest(before) {
      const activation = await import(Bun.pathToFileURL(input.activationModulePath).href);
      const replay = await activation
        .createOriginInventoryActivation({
          configSha256: before.configSha256,
          consumerCodeSha256: input.expectedConsumerCodeSha256,
          unitSha256: input.expectedUnitSha256,
          inventoryRoot: input.inventoryRoot,
          backupReceipt: join(input.job, "origin-backup-receipt.json"),
          backupReceiptSha256: hash(""),
        })
        .activate({
          inventoryPath: before.state.inventoryPath,
          inventorySha256: before.state.inventorySha256,
          manifestPrefix: before.state.prefix,
          publisherLock: lockPath,
        });
      if (replay.applied !== false || replay.replay !== true || replay.writes !== 0)
        throw Error("Preparation requires current native-origin replay with zero writes");
    },
    async backup(expected) {
      const path =
        "/home/ubuntu/.aphrody/protected-backups/shenron-origin-pointer-current/origin-cdn.json";
      const script = `import{mkdir,open,rename,lstat,realpath}from"node:fs/promises";const p=${JSON.stringify(path)},dir=p.slice(0,p.lastIndexOf("/"));await mkdir(dir,{recursive:true,mode:448});const s=await lstat(dir);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&63)||s.uid!==process.getuid()||await realpath(dir)!==dir)throw Error("guard");const bytes=new Uint8Array(await Bun.stdin.arrayBuffer());if(bytes.length>16384)throw Error("bound");const h=new Bun.CryptoHasher("sha256").update(bytes).digest("hex");if(h!==${JSON.stringify(expected)})throw Error("sha");const f=await open(p+".next","wx",384);try{await f.writeFile(bytes);await f.sync()}finally{await f.close()}await rename(p+".next",p);console.log(h);`;
      if (
        (await ssh("/home/ubuntu/.bun/bin/bun-1.4.4 -e " + quote(script), configBytes!)) !==
        expected
      )
        throw Error("Off-host backup write differs");
      const verify = `import{lstat}from"node:fs/promises";const p=${JSON.stringify(path)};const s=await lstat(p);if(!s.isFile()||s.isSymbolicLink()||(s.mode&63))throw Error("guard");console.log(new Bun.CryptoHasher("sha256").update(await Bun.file(p).bytes()).digest("hex"));`;
      if ((await ssh("/home/ubuntu/.bun/bin/bun-1.4.4 -e " + quote(verify))) !== expected)
        throw Error("Independent off-host readback differs");
      return { backupPath: path, snapshotSha256: expected, verified: true };
    },
    receipt: (value) => privateWrite(join(input.job, "origin-backup-receipt.json"), value),
    async store(value) {
      await privateWrite(join(input.job, "origin-preparation.json"), value);
    },
  });
}
