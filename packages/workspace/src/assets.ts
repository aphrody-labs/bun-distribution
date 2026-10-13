import { realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  checkoutPath,
  findModule,
  hashContent,
  hashFile,
  hashStream,
  repositoryRoot,
  type Config,
} from "./index.ts";

export interface AssetEntry {
  name: string;
  key: string;
  sha256: string;
  size: number;
  type: string;
  license: string;
  licenseKey?: string;
  source: string;
}

export interface AssetManifest {
  schemaVersion: 1;
  owner: "aphrody-assets";
  bucket: string;
  baseUrl: string;
  sourceRevision: string;
  entries: AssetEntry[];
}

export interface AssetReference {
  sha256: string;
  url: string;
}
export interface ContentObjectReference {
  sha256: string;
  bytes: number;
  objectKey: string;
  created: boolean;
  checksumVerified: true;
  url: string;
}
export interface ContentObjectStorage {
  bucket: string;
  origin: string;
  prefix: string;
}
export interface AssetPlan {
  manifest: AssetManifest;
  reference: AssetReference;
  files: Map<string, string>;
}
const maxAssetBytes = 256 * 1024 * 1024;

export function validateAssetReference(
  value: unknown,
  baseUrl = "https://assets.aphrody.app",
): AssetReference {
  if (!value || typeof value !== "object")
    throw new Error("An immutable shared asset reference is required.");
  const record = value as { reference?: unknown };
  const reference = (record.reference ?? value) as Partial<AssetReference>;
  if (!reference || typeof reference !== "object")
    throw new Error("An immutable shared asset reference is required.");
  if (
    typeof reference.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(reference.sha256) ||
    reference.url !== `${baseUrl}/manifests/sha256/${reference.sha256}.json`
  ) {
    throw new Error(
      "Shared assets require the canonical custom domain and pinned manifest digest.",
    );
  }
  return { sha256: reference.sha256, url: reference.url };
}

/** Public inputs are explicitly selected by the licensed font owner, never scanned from stores. */
export async function planSharedAssets(config: Config, root = repositoryRoot): Promise<AssetPlan> {
  if (!config.deployment) throw new Error("Deployment asset settings are required.");
  const module = findModule(config, "craft-fonts");
  const directory = await realpath(checkoutPath(root, module.path));
  const manifestText = await Bun.file(join(directory, "fonts", "manifest.txt")).text();
  const rows = manifestText.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#"));
  if (rows.length > 128) throw new Error("Public font manifest exceeds its entry limit.");
  const entries: AssetEntry[] = [];
  const files = new Map<string, string>();
  let bytes = 0;
  const add = async (
    name: string,
    license: string,
    source: string,
    expected?: string,
  ): Promise<AssetEntry> => {
    const path = await realpath(checkoutPath(directory, name));
    const local = relative(directory, path);
    if (local.startsWith(`..${sep}`) || local === "..")
      throw new Error("Public asset path leaves its owner.");
    const file = Bun.file(path);
    if (!file.size || file.size > maxAssetBytes)
      throw new Error(`Public asset size invalid: ${name}`);
    const sha256 = await hashFile(path, { maxBytes: maxAssetBytes });
    if (expected && sha256 !== expected)
      throw new Error(`Font differs from its owner manifest: ${name}`);
    const key = `sha256/${sha256}`;
    if (!files.has(key)) {
      files.set(key, path);
      bytes += file.size;
    }
    if (bytes > 256 * 1024 * 1024) throw new Error("Public asset plan exceeds its size limit.");
    const type = name.endsWith(".ttf")
      ? "font/ttf"
      : name.endsWith(".otf")
        ? "font/otf"
        : "text/plain; charset=utf-8";
    const entry: AssetEntry = { name, key, sha256, size: file.size, type, license, source };
    entries.push(entry);
    return entry;
  };
  for (const row of rows) {
    const fields = row.split(" | ");
    if (fields.length !== 8 || fields[4] !== "OFL-1.1" || !/^[0-9a-f]{64}$/.test(fields[6]!)) {
      throw new Error("Public font metadata must retain its license and pinned SHA-256.");
    }
    const license = await add(fields[5]!, fields[4]!, fields[7]!);
    const font = await add(fields[2]!, fields[4]!, fields[7]!, fields[6]);
    font.licenseKey = license.key;
  }
  for (const name of ["ATTRIBUTION.md", "LICENSE-MIT", "LICENSE-APACHE"])
    await add(name, module.license, `https://github.com/${module.fork}/tree/${module.revision}`);
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const manifest: AssetManifest = {
    schemaVersion: 1,
    owner: "aphrody-assets",
    bucket: config.deployment.assets.bucket,
    baseUrl: config.deployment.assets.url,
    sourceRevision: module.revision,
    entries,
  };
  const sha256 = hashContent(JSON.stringify(manifest));
  return {
    manifest,
    files,
    reference: { sha256, url: `${manifest.baseUrl}/manifests/sha256/${sha256}.json` },
  };
}

/** Bun owns the S3 transport; all apps reference these immutable keys. */
export async function publishSharedAssets(
  plan: AssetPlan,
  client: Bun.S3Client,
): Promise<{ uploaded: number; retained: number }> {
  let uploaded = 0;
  let retained = 0;
  const objects = new Map(plan.manifest.entries.map((entry) => [entry.key, entry]));
  for (const [key, path] of plan.files) {
    const entry = objects.get(key)!;
    if ((await hashFile(path, { maxBytes: maxAssetBytes })) !== entry.sha256)
      throw new Error("Public asset changed after planning.");
    const remote = client.file(key);
    if (await remote.exists()) {
      if (
        (await remote.stat()).size !== entry.size ||
        (await hashStream(remote.stream(), { maxBytes: entry.size })) !== entry.sha256
      )
        throw new Error("Existing immutable R2 object differs from its content key.");
      retained++;
    } else {
      await remote.write(Bun.file(path), { type: entry.type, retry: 1 });
      if ((await hashStream(remote.stream(), { maxBytes: entry.size })) !== entry.sha256)
        throw new Error("Uploaded R2 object failed content verification.");
      uploaded++;
    }
  }
  const body = JSON.stringify(plan.manifest);
  if (hashContent(body) !== plan.reference.sha256)
    throw new Error("Shared asset manifest changed after planning.");
  const remote = client.file(`manifests/sha256/${plan.reference.sha256}.json`);
  if (await remote.exists()) {
    if (hashContent(await remote.text()) !== plan.reference.sha256)
      throw new Error("Immutable R2 manifest differs.");
    retained++;
  } else {
    await remote.write(body, { type: "application/json", retry: 1 });
    uploaded++;
  }
  return { uploaded, retained };
}

export function assetClient(config: Config): Bun.S3Client {
  const endpoint = Bun.env.R2_ENDPOINT ?? Bun.env.AWS_ENDPOINT_URL_S3;
  const url = endpoint ? new URL(endpoint) : undefined;
  if (
    !config.deployment ||
    !url ||
    url.protocol !== "https:" ||
    !/^[a-z0-9]+\.r2\.cloudflarestorage\.com$/.test(url.hostname) ||
    !Bun.env.AWS_ACCESS_KEY_ID ||
    !Bun.env.AWS_SECRET_ACCESS_KEY
  ) {
    throw new Error("R2 credentials must be injected from the protected store.");
  }
  return new Bun.S3Client({
    endpoint,
    bucket: config.deployment.assets.bucket,
    region: "auto",
    accessKeyId: Bun.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: Bun.env.AWS_SECRET_ACCESS_KEY,
  });
}

/** Publish one scoped file through the shared content-addressed asset owner. */
export async function publishContentObject(
  client: Bun.S3Client,
  storage: ContentObjectStorage,
  path: string,
  expected: { sha256: string; bytes: number },
  signal: AbortSignal = AbortSignal.timeout(600_000),
): Promise<ContentObjectReference> {
  if (
    !/^[0-9a-f]{64}$/.test(expected.sha256) ||
    !Number.isSafeInteger(expected.bytes) ||
    expected.bytes <= 0 ||
    expected.bytes > maxAssetBytes ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(storage.bucket) ||
    storage.prefix !== "objects/sha256/" ||
    new URL(storage.origin).protocol !== "https:"
  )
    throw new Error("Invalid content-addressed asset input.");
  const file = Bun.file(path);
  if (
    !file.size ||
    file.size !== expected.bytes ||
    (await hashFile(path, { maxBytes: maxAssetBytes })) !== expected.sha256
  )
    throw new Error("Content changed after asset planning.");
  const endpoint = Bun.env.R2_ENDPOINT ?? Bun.env.AWS_ENDPOINT_URL_S3;
  const endpointUrl = endpoint ? new URL(endpoint) : undefined;
  if (
    !endpointUrl ||
    endpointUrl.protocol !== "https:" ||
    !/^[a-z0-9]+\.r2\.cloudflarestorage\.com$/.test(endpointUrl.hostname)
  )
    throw new Error("R2 endpoint must be injected from the protected environment.");
  const objectKey = storage.prefix + expected.sha256;
  const object = client.file(objectKey);
  let created = false;
  const put = await fetch(
    object.presign({ method: "PUT", expiresIn: 60, type: file.type || "application/octet-stream" }),
    {
      method: "PUT",
      body: file,
      signal,
      redirect: "error",
      headers: {
        "If-None-Match": "*",
        "Content-Type": file.type || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    },
  );
  await put.body?.cancel();
  if (!put.ok && put.status !== 412) throw new Error("R2 conditional content write failed.");
  created = put.status !== 412;
  const verified = await fetch(object.presign({ method: "GET", expiresIn: 60 }), {
    signal,
    redirect: "error",
  });
  if (!verified.ok || !verified.body) throw new Error("R2 content verification failed.");
  const digest = await hashStream(verified.body, {
    maxBytes: expected.bytes,
    expectedBytes: expected.bytes,
  });
  if (digest !== expected.sha256)
    throw new Error("Published R2 asset does not match its content address.");
  return {
    ...expected,
    objectKey,
    created,
    checksumVerified: true,
    url: storage.origin.replace(/\/$/, "") + "/" + objectKey,
  };
}
