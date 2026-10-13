// SPDX-License-Identifier: MIT
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { identity } from "../src/distribution.ts";
import { publishContentObject } from "@aphrody/bun-workspace/assets";
import { runtimeCheckout } from "../src/distribution.ts";
import { pathToFileURL } from "node:url";

export interface AssetStorage {
  bucket: string;
  origin: string;
  prefix: string;
}
export interface AssetApp {
  id: string;
  workspace: string;
  assetRoots: string[];
}
export interface AssetInventory {
  schemaVersion: 1;
  workspaces: Record<string, string>;
  storage: { assets: AssetStorage; artifacts: AssetStorage };
  apps: AssetApp[];
  checkouts?: Record<string, string>;
  build?: {
    outputRoot?: string;
    timeoutSeconds?: number;
    sharedHeavyLock?: string;
    lockKind?: "flock" | "exclusive-file";
  };
}
export interface AssetReference {
  path: string;
  sha256: string;
  bytes: number;
  objectKey: string;
  type: string;
}
export interface AssetObject {
  sha256: string;
  bytes: number;
  objectKey: string;
  sources: string[];
}
export interface AssetPlan {
  schemaVersion: 1;
  kind: "app-asset-plan";
  configSHA256: string;
  storage: AssetStorage;
  objects: AssetObject[];
  apps: { id: string; assets: AssetReference[] }[];
  qualification: { uploaded: false; publicDelivery: false };
}
const MAX_FILES = 20_000;
export const MAX_OBJECT_BYTES = 256 * 1024 * 1024;

export function protectedInput(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  return (
    /(?:^|\/)(?:\.codex|\.claude|\.git|cookies|provider-sessions|datasets|weights|game-data)(?:\/|$)/.test(
      normalized,
    ) ||
    /(?:^|\/)\.aphrody\/(?:config|cookies|sessions|memory|providers)(?:\/|$)/.test(normalized) ||
    /(?:^|\/)(?:\.env(?:\.[^/]*)?|credentials(?:\.[^/]*)?|cookies?(?:\.[^/]*)?)(?:\/|$)/.test(normalized) ||
    /\.(?:pem|key|p12|pfx|gguf|safetensors|ckpt|jsonl)$/i.test(normalized)
  );
}
export function inside(root: string, path: string, allowRoot = false): string {
  const resolved = resolve(path),
    suffix = relative(root, resolved);
  if (
    (!suffix && !allowRoot) ||
    suffix === ".." ||
    suffix.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) ||
    isAbsolute(suffix)
  )
    throw new Error("Input is outside its explicitly configured root");
  return resolved;
}
export async function readInventory(path: string): Promise<AssetInventory> {
  const config = (await Bun.file(path).json()) as AssetInventory;
  if (config.schemaVersion !== 1 || !config.workspaces || !Array.isArray(config.apps))
    throw new Error("Invalid app inventory");
  const ids = new Set<string>();
  for (const app of config.apps) {
    if (
      !/^[a-z0-9][a-z0-9-]*$/.test(app.id) ||
      ids.has(app.id) ||
      !config.workspaces[app.workspace] ||
      !Array.isArray(app.assetRoots)
    )
      throw new Error("Invalid or duplicate app inventory entry");
    ids.add(app.id);
    for (const path of app.assetRoots)
      if (!path || isAbsolute(path) || path.split(/[\\/]/).includes("..") || protectedInput(path))
        throw new Error("Asset roots must be explicit public directories inside their workspace");
  }
  for (const storage of [config.storage.assets, config.storage.artifacts]) {
    const origin = new URL(storage.origin);
    if (
      !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(storage.bucket) ||
      storage.prefix !== "objects/sha256/" ||
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash
    )
      throw new Error("Invalid shared object storage configuration");
  }
  return config;
}
export async function workspace(configPath: string, config: AssetInventory, id: string) {
  const value = config.workspaces[id];
  if (!value) throw new Error("Unknown configured workspace");
  return realpath(resolve(dirname(configPath), value));
}
async function* scopedFiles(root: string, deadline: number): AsyncGenerator<string> {
  const pending = [{ path: root, depth: 0 }];
  let count = 0;
  while (pending.length) {
    if (Date.now() > deadline) throw new Error("Asset inventory deadline reached");
    const current = pending.pop()!;
    if (current.depth > 24) throw new Error("Asset directory depth limit exceeded");
    for (const item of await readdir(current.path, { withFileTypes: true })) {
      if (item.isSymbolicLink() || ["node_modules", ".cache", ".temp", ".git"].includes(item.name)) continue;
      const path = join(current.path, item.name);
      if (protectedInput(path)) continue;
      if (++count > MAX_FILES) throw new Error("Scoped asset entry limit exceeded");
      if (item.isDirectory()) pending.push({ path, depth: current.depth + 1 });
      else if (item.isFile()) yield path;
    }
  }
}
export async function collectAssets(configPath: string, appIds?: string[]): Promise<AssetPlan> {
  const config = await readInventory(configPath),
    objects = new Map<string, AssetObject>();
  const apps: AssetPlan["apps"] = [],
    deadline = Date.now() + 30_000;
  for (const app of config.apps) {
    if (appIds && !appIds.includes(app.id)) continue;
    const root = await workspace(configPath, config, app.workspace),
      refs: AssetReference[] = [];
    const logical = new Set<string>();
    for (const assetRoot of app.assetRoots) {
      const selected = inside(root, await realpath(resolve(root, assetRoot)));
      if (protectedInput(selected) || !(await lstat(selected)).isDirectory())
        throw new Error("Configured asset root is not a directory");
      for await (const file of scopedFiles(selected, deadline)) {
        const actual = inside(selected, await realpath(file));
        const metadata = await lstat(actual);
        if (metadata.size > MAX_OBJECT_BYTES) throw new Error("Asset object exceeds the explicit size limit");
        const digest = await identity(actual),
          path = relative(root, actual).replaceAll("\\", "/");
        if (logical.has(path)) continue;
        logical.add(path);
        const objectKey = config.storage.assets.prefix + digest.sha256;
        const existing = objects.get(digest.sha256);
        if (existing) {
          if (existing.bytes !== digest.bytes) throw new Error("Conflicting content identity");
          if (!existing.sources.includes(actual)) existing.sources.push(actual);
        } else objects.set(digest.sha256, { ...digest, objectKey, sources: [actual] });
        refs.push({ path, ...digest, objectKey, type: Bun.file(actual).type || "application/octet-stream" });
      }
    }
    apps.push({ id: app.id, assets: refs.sort((a, b) => a.path.localeCompare(b.path)) });
  }
  if (appIds && appIds.some(id => !apps.some(app => app.id === id))) throw new Error("Unknown selected app");
  return {
    schemaVersion: 1,
    kind: "app-asset-plan",
    configSHA256: (await identity(configPath)).sha256,
    storage: config.storage.assets,
    objects: [...objects.values()]
      .map(object => ({ ...object, sources: object.sources.sort() }))
      .sort((a, b) => a.sha256.localeCompare(b.sha256)),
    apps,
    qualification: { uploaded: false, publicDelivery: false },
  };
}
interface CloudflareDataOwner {
  loadCloudflareEnvironment(file?: string): Promise<Record<string, string | undefined>>;
  createR2Client(options: { bucket: string; env: Record<string, string | undefined> }): Bun.S3Client;
}
export async function r2Owner(config: AssetInventory, bucket: string): Promise<Bun.S3Client> {
  const ownerPath = join(runtimeCheckout(config), "packages/bun-cloudflare/src/api.ts");
  const owner = (await import(pathToFileURL(ownerPath).href)) as CloudflareDataOwner;
  return owner.createR2Client({ bucket, env: await owner.loadCloudflareEnvironment() });
}
export async function putContentObject(
  client: Bun.S3Client,
  storage: AssetStorage,
  path: string,
  expected: { sha256: string; bytes: number },
  signal: AbortSignal,
) {
  if (protectedInput(path) || !/^[a-f0-9]{64}$/.test(expected.sha256) || expected.bytes > MAX_OBJECT_BYTES)
    throw new Error("Invalid scoped content object input");
  if (storage.prefix !== "objects/sha256/" || !storage.origin.startsWith("https://"))
    throw new Error("Invalid content-addressed asset storage.");
  const object = await publishContentObject(client, storage, path, expected, signal);
  return {
    ...expected,
    objectKey: object.objectKey,
    created: object.created,
    checksumVerified: object.checksumVerified,
    url: object.url,
  };
}
export async function uploadAssets(configPath: string, planPath: string) {
  const config = await readInventory(configPath),
    plan = (await Bun.file(planPath).json()) as AssetPlan;
  if (
    plan.schemaVersion !== 1 ||
    plan.kind !== "app-asset-plan" ||
    plan.configSHA256 !== (await identity(configPath)).sha256 ||
    JSON.stringify(plan.storage) !== JSON.stringify(config.storage.assets)
  )
    throw new Error("Asset plan does not match current owner configuration");
  const current = await collectAssets(
    configPath,
    plan.apps.map(app => app.id),
  );
  if (
    JSON.stringify(current.apps) !== JSON.stringify(plan.apps) ||
    JSON.stringify(current.objects) !== JSON.stringify(plan.objects)
  )
    throw new Error("Scoped assets changed after planning");
  const client = await r2Owner(config, config.storage.assets.bucket),
    signal = AbortSignal.timeout(600_000),
    objects = [];
  for (const object of plan.objects)
    objects.push(await putContentObject(client, plan.storage, object.sources[0]!, object, signal));
  return {
    schemaVersion: 1,
    kind: "app-assets-upload",
    objects,
    appReferences: plan.apps.map(app => ({ ...app, origin: plan.storage.origin })),
    qualification: { objectChecksums: true, publicDelivery: false },
    catalogPublication: "owned by the edge/catalog capability",
  };
}
async function main() {
  const [action = "--help", ...args] = Bun.argv.slice(2);
  if (action === "--help") {
    console.log("bun infra/assets.ts plan|upload --config FILE --out FILE [--plan FILE]");
    return;
  }
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (!key || !["--config", "--out", "--plan"].includes(key) || !value || flags[key])
      throw new Error("Invalid asset option");
    flags[key] = value;
  }
  if (!flags["--config"] || !flags["--out"]) throw new Error("Explicit configuration and output receipt required");
  const configPath = resolve(flags["--config"]),
    output = resolve(flags["--out"]);
  const result =
    action === "plan"
      ? await collectAssets(configPath)
      : action === "upload" && flags["--plan"]
        ? await uploadAssets(configPath, resolve(flags["--plan"]))
        : null;
  if (!result) throw new Error("Unknown asset action or missing plan");
  await mkdir(dirname(output), { recursive: true });
  await Bun.write(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ output, kind: result.kind }));
}
if (import.meta.main)
  main().catch(() => {
    console.error("Scoped asset operation failed; no credentials or signed URLs are logged");
    process.exitCode = 1;
  });
