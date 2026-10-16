#!/usr/bin/env bun
import { homedir } from "node:os";
import { statePath } from "@aphrody/paths";
import { createHash } from "node:crypto";
import { appendFile, chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dir, "../..");
const DEFAULT_SOURCE_PROJECT_REF = "yftdclwvehxxffwqvhmc";
const EXPECTED_TARGET_ORIGIN = "http://127.0.0.1:8823";
const EXPECTED_TARGET_ROOT = "/var/www/achillea-storage";
const DEFAULT_STATE_DIRECTORY = statePath("achillea-storage-migration");
const PAGE_SIZE = 1_000;
const MAGIC_PREFIX_BYTES = 512;
const CONFIRMATION = "ACHILLEA_STORAGE_MIGRATION";

export const bucketContract = {
  images: {
    public: true,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"],
  },
  "ranked-proofs": {
    public: false,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  },
} as const;

type BucketName = keyof typeof bucketContract;
type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface StorageMigrationConfig {
  sourceOrigin: string;
  sourceProjectRef: string;
  sourceKey: string;
  targetOrigin: string;
  targetKey: string;
  targetRoot: string;
  stateDirectory: string;
  concurrency: number;
}

export interface StorageObjectRecord {
  bucket: BucketName;
  name: string;
  size: number;
  sha256: string;
  mimeType: string;
  stagedFile: string;
}

export interface StorageManifest {
  formatVersion: 1;
  generatedAt: string;
  source: { origin: string; projectRef: string };
  target: { origin: string; root: string };
  buckets: Array<{ name: BucketName; public: boolean }>;
  objects: StorageObjectRecord[];
  totalBytes: number;
}

interface ListRow {
  id?: string | null;
  name?: string;
  metadata?: Record<string, unknown> | null;
}

interface ProgressRecord {
  bucket: BucketName;
  name: string;
  sha256: string;
  size: number;
  completedAt: string;
}

export interface CommandOptions {
  phase: "plan" | "inventory" | "migrate" | "verify";
  execute: boolean;
  confirmation?: string;
}

function normalizedOrigin(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} invalide`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} ne doit contenir ni identifiant, ni query string, ni fragment`);
  }
  if (url.pathname !== "/") throw new Error(`${label} doit etre une origine sans chemin`);
  return url;
}

function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

export function resolveStorageMigrationConfig(
  environment: Record<string, string | undefined> = process.env,
): StorageMigrationConfig {
  const sourceProjectRef = environment.ACHILLEA_STORAGE_SOURCE_PROJECT_REF?.trim() || DEFAULT_SOURCE_PROJECT_REF;
  if (!/^[a-z0-9]{20}$/.test(sourceProjectRef)) {
    throw new Error("Project ref Storage source invalide");
  }
  const source = normalizedOrigin(environment.ACHILLEA_STORAGE_SOURCE_URL?.trim() || "", "Origine Storage source");
  const sourceHost = source.hostname.toLowerCase();
  if (source.protocol !== "https:") throw new Error("La source Storage Cloud doit imposer HTTPS");
  if (
    sourceHost === "localhost" ||
    sourceHost.endsWith(".localhost") ||
    isIpLiteral(sourceHost) ||
    /^(?:10\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/.test(sourceHost)
  ) {
    throw new Error("La source Storage ne peut pas etre locale, privee ou adressee par IP");
  }
  if (/(?:^|[.-])(rg|azalee|rosegriffon)(?:[.-]|$)/i.test(sourceHost)) {
    throw new Error("La source Storage ne peut pas cibler RG ou Azalee");
  }
  if (sourceHost !== `${sourceProjectRef}.supabase.co`) {
    throw new Error("La source Storage doit etre le projet Supabase Achillea attendu");
  }

  const target = normalizedOrigin(
    environment.ACHILLEA_STORAGE_TARGET_URL?.trim() || EXPECTED_TARGET_ORIGIN,
    "Origine Storage cible",
  );
  if (target.origin !== EXPECTED_TARGET_ORIGIN) {
    throw new Error("La cible Storage doit rester la passerelle Achillea loopback 127.0.0.1:8823");
  }
  const targetRoot = environment.ACHILLEA_STORAGE_TARGET_ROOT?.trim() || EXPECTED_TARGET_ROOT;
  if (path.resolve(targetRoot) !== EXPECTED_TARGET_ROOT) {
    throw new Error("La racine cible doit rester /var/www/achillea-storage");
  }

  const stateDirectory = path.resolve(environment.ACHILLEA_STORAGE_MIGRATION_DIR?.trim() || DEFAULT_STATE_DIRECTORY);
  const forbiddenStatePaths = ["/", "/home", homedir(), "/var", "/var/www"];
  const forbiddenStateTrees = [repositoryRoot, "/var/www/rg-storage", "/var/www/azalee-storage", EXPECTED_TARGET_ROOT];
  if (
    forbiddenStatePaths.includes(stateDirectory) ||
    forbiddenStateTrees.some(root => stateDirectory === root || stateDirectory.startsWith(`${root}${path.sep}`)) ||
    /(?:^|\/)(?:rg|azalee)(?:\/|$)/i.test(stateDirectory)
  ) {
    throw new Error(
      "L'etat de migration doit rester dans un dossier Achillea prive hors repo et hors racines partagees",
    );
  }

  const sourceKey = environment.ACHILLEA_STORAGE_SOURCE_KEY?.trim() || "";
  const targetKey = environment.ACHILLEA_STORAGE_TARGET_KEY?.trim() || "";
  if (sourceKey.length < 20 || targetKey.length < 20) {
    throw new Error("Les deux credentials Storage explicites source et cible sont requis");
  }
  if (sourceKey === targetKey) {
    throw new Error("Les credentials Storage source et cible doivent etre distincts");
  }

  const concurrency = Number(environment.ACHILLEA_STORAGE_MIGRATION_CONCURRENCY ?? "4");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error("La concurrence Storage doit etre un entier entre 1 et 8");
  }

  return {
    sourceOrigin: source.origin,
    sourceProjectRef,
    sourceKey,
    targetOrigin: target.origin,
    targetKey,
    targetRoot,
    stateDirectory,
    concurrency,
  };
}

export function parseCommandOptions(arguments_: string[]): CommandOptions {
  const phases = (["inventory", "migrate", "verify"] as const).filter(phase => arguments_.includes(`--${phase}`));
  if (phases.length > 1) throw new Error("Choisissez une seule phase Storage");
  const execute = arguments_.includes("--execute");
  const confirmationIndex = arguments_.indexOf("--confirm");
  const confirmation = confirmationIndex < 0 ? undefined : arguments_[confirmationIndex + 1];
  if (execute && (!phases[0] || confirmation !== CONFIRMATION)) {
    throw new Error(`L'execution exige une phase, --execute et --confirm ${CONFIRMATION}`);
  }
  return { phase: phases[0] ?? "plan", execute, confirmation };
}

export function encodeObjectPath(bucket: string, name: string): string {
  validateObjectName(name);
  return `${encodeURIComponent(bucket)}/${name.split("/").map(encodeURIComponent).join("/")}`;
}

export function validateObjectName(name: string): void {
  if (!name || name.startsWith("/") || name.endsWith("/") || name.includes("\\")) {
    throw new Error("Nom d'objet Storage dangereux ou vide");
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error("Nom d'objet Storage avec caractere de controle");
  if (name.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("Nom d'objet Storage avec segment dangereux");
  }
}

export function detectImageMime(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])
  )
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP"
  )
    return "image/webp";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(new TextDecoder().decode(bytes.subarray(0, 6))))
    return "image/gif";
  const textPrefix = new TextDecoder().decode(bytes).trimStart().toLowerCase();
  if (textPrefix.startsWith("<svg") || (textPrefix.startsWith("<?xml") && textPrefix.includes("<svg")))
    return "image/svg+xml";
  return null;
}

export function validateObjectMagic(bucket: BucketName, bytes: Uint8Array): string {
  const mime = detectImageMime(bytes);
  if (!mime || !(bucketContract[bucket].allowedMimeTypes as readonly string[]).includes(mime)) {
    throw new Error(`Magic bytes non autorises dans le bucket ${bucket}`);
  }
  return mime;
}

function requestHeaders(key: string, extra: Record<string, string> = {}): Headers {
  return new Headers({ authorization: `Bearer ${key}`, apikey: key, ...extra });
}

async function expectResponse(response: Response, operation: string): Promise<Response> {
  if (!response.ok) throw new Error(`${operation} a echoue (HTTP ${response.status})`);
  return response;
}

async function safeFetch(fetcher: Fetch, input: string, init: RequestInit, operation: string): Promise<Response> {
  try {
    return await fetcher(input, init);
  } catch {
    throw new Error(`${operation} a echoue avant reponse`);
  }
}

export async function verifyBucketContract(
  origin: string,
  key: string,
  label: string,
  fetcher: Fetch,
  allowMissingPrivateBucket = false,
): Promise<Set<BucketName>> {
  const available = new Set<BucketName>();
  for (const [name, contract] of Object.entries(bucketContract) as Array<
    [BucketName, (typeof bucketContract)[BucketName]]
  >) {
    const response = await safeFetch(
      fetcher,
      `${origin}/storage/v1/bucket/${encodeURIComponent(name)}`,
      { headers: requestHeaders(key) },
      `Lecture bucket ${label}`,
    );
    if (!response.ok && allowMissingPrivateBucket && name === "ranked-proofs") {
      if (response.status === 400 || response.status === 404) continue;
    }
    await expectResponse(response, `Lecture bucket ${label}`);
    const bucket = (await response.json()) as { id?: string; public?: boolean };
    if (bucket.id !== name || bucket.public !== contract.public) {
      throw new Error(`Contrat du bucket ${name} invalide sur ${label}`);
    }
    available.add(name);
  }
  return available;
}

export async function listAllObjects(
  origin: string,
  key: string,
  bucket: BucketName,
  fetcher: Fetch = fetch,
): Promise<string[]> {
  const objects = new Set<string>();
  const pendingPrefixes = [""];
  const visitedPrefixes = new Set<string>();
  while (pendingPrefixes.length > 0) {
    const prefix = pendingPrefixes.shift()!;
    if (visitedPrefixes.has(prefix)) continue;
    visitedPrefixes.add(prefix);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const response = await expectResponse(
        await safeFetch(
          fetcher,
          `${origin}/storage/v1/object/list/${encodeURIComponent(bucket)}`,
          {
            method: "POST",
            headers: requestHeaders(key, { "content-type": "application/json" }),
            body: JSON.stringify({
              prefix,
              limit: PAGE_SIZE,
              offset,
              sortBy: { column: "name", order: "asc" },
            }),
          },
          "Inventaire Storage source",
        ),
        "Inventaire Storage source",
      );
      const rows = (await response.json()) as ListRow[];
      if (!Array.isArray(rows)) throw new Error("Reponse d'inventaire Storage invalide");
      for (const row of rows) {
        if (typeof row.name !== "string" || !row.name) throw new Error("Objet Storage sans nom");
        const fullName = row.name.startsWith(prefix) ? row.name : `${prefix}${row.name}`;
        if (row.id == null && row.metadata == null) {
          pendingPrefixes.push(fullName.endsWith("/") ? fullName : `${fullName}/`);
        } else {
          validateObjectName(fullName);
          objects.add(fullName);
        }
      }
      if (rows.length < PAGE_SIZE) break;
    }
  }
  return [...objects].sort();
}

function objectId(bucket: BucketName, name: string): string {
  return createHash("sha256").update(`${bucket}\0${name}`).digest("hex");
}

function stageRelativePath(bucket: BucketName, name: string): string {
  return path.join("objects", bucket, `${objectId(bucket, name)}.blob`);
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const info = await stat(directory);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0) throw new Error("Dossier d'etat Storage non prive");
}

async function atomicPrivateJson(file: string, value: unknown): Promise<void> {
  await ensurePrivateDirectory(path.dirname(file));
  const partial = `${file}.${crypto.randomUUID()}.partial`;
  try {
    await writeFile(partial, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(partial, 0o600);
    await rename(partial, file);
    await chmod(file, 0o600);
  } finally {
    await rm(partial, { force: true });
  }
}

async function streamToPrivateFile(
  response: Response,
  finalPath: string,
): Promise<{ size: number; sha256: string; head: Uint8Array }> {
  if (!response.body) throw new Error("Objet Storage source sans corps");
  await ensurePrivateDirectory(path.dirname(finalPath));
  const partial = `${finalPath}.${crypto.randomUUID()}.partial`;
  const handle = await open(partial, "wx", 0o600);
  const hasher = createHash("sha256");
  const head: number[] = [];
  let size = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      hasher.update(value);
      for (const byte of value) {
        if (head.length >= MAGIC_PREFIX_BYTES) break;
        head.push(byte);
      }
      await handle.write(value);
    }
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(partial, { force: true });
    throw error;
  }
  await handle.close();
  await chmod(partial, 0o600);
  await rename(partial, finalPath);
  await chmod(finalPath, 0o600);
  return { size, sha256: hasher.digest("hex"), head: Uint8Array.from(head) };
}

async function hashPrivateFile(
  file: string,
  bucket: BucketName,
): Promise<{ size: number; sha256: string; mimeType: string }> {
  const info = await stat(file);
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error("Fichier stage Storage absent ou non prive");
  const bytes = new Uint8Array(await readFile(file));
  const mimeType = validateObjectMagic(bucket, bytes.subarray(0, MAGIC_PREFIX_BYTES));
  return {
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mimeType,
  };
}

async function downloadObject(
  origin: string,
  key: string,
  bucket: BucketName,
  name: string,
  destination: string,
  fetcher: Fetch,
): Promise<StorageObjectRecord> {
  const response = await expectResponse(
    await safeFetch(
      fetcher,
      `${origin}/storage/v1/object/authenticated/${encodeObjectPath(bucket, name)}`,
      { headers: requestHeaders(key) },
      "Telechargement objet Storage",
    ),
    "Telechargement objet Storage",
  );
  const downloaded = await streamToPrivateFile(response, destination);
  const mimeType = validateObjectMagic(bucket, downloaded.head);
  return {
    bucket,
    name,
    size: downloaded.size,
    sha256: downloaded.sha256,
    mimeType,
    stagedFile: path.relative(path.dirname(path.dirname(destination)), destination),
  };
}

export async function runBounded<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= values.length) return;
        results[index] = await operation(values[index], index);
      }
    }),
  );
  return results;
}

async function readProgress(file: string): Promise<Map<string, ProgressRecord>> {
  const records = new Map<string, ProgressRecord>();
  const text = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  for (const line of text.split("\n")) {
    if (!line) continue;
    const record = JSON.parse(line) as ProgressRecord;
    validateObjectName(record.name);
    records.set(`${record.bucket}\0${record.name}`, record);
  }
  return records;
}

function progressWriter(file: string): (record: ProgressRecord) => Promise<void> {
  let chain = Promise.resolve();
  return async record => {
    chain = chain.then(async () => {
      await appendFile(file, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
      await chmod(file, 0o600);
    });
    await chain;
  };
}

async function inventory(config: StorageMigrationConfig, fetcher: Fetch): Promise<StorageManifest> {
  await ensurePrivateDirectory(config.stateDirectory);
  const sourceBuckets = await verifyBucketContract(
    config.sourceOrigin,
    config.sourceKey,
    "source-cloud",
    fetcher,
    true,
  );
  const inventoryProgressPath = path.join(config.stateDirectory, "inventory-progress.ndjson");
  const progress = await readProgress(inventoryProgressPath);
  const writeProgress = progressWriter(inventoryProgressPath);
  const descriptors: Array<{ bucket: BucketName; name: string }> = [];
  for (const bucket of sourceBuckets) {
    for (const name of await listAllObjects(config.sourceOrigin, config.sourceKey, bucket, fetcher)) {
      descriptors.push({ bucket, name });
    }
  }
  const unique = new Set(descriptors.map(({ bucket, name }) => `${bucket}\0${name}`));
  if (unique.size !== descriptors.length) throw new Error("Inventaire Storage source contient des doublons");

  const objects = await runBounded(descriptors, config.concurrency, async ({ bucket, name }) => {
    const relative = stageRelativePath(bucket, name);
    const destination = path.join(config.stateDirectory, relative);
    const previous = progress.get(`${bucket}\0${name}`);
    if (previous) {
      const current = await hashPrivateFile(destination, bucket).catch(() => null);
      if (current && current.size === previous.size && current.sha256 === previous.sha256) {
        return { bucket, name, ...current, stagedFile: relative };
      }
    }
    const downloaded = await downloadObject(config.sourceOrigin, config.sourceKey, bucket, name, destination, fetcher);
    downloaded.stagedFile = relative;
    await writeProgress({
      bucket,
      name,
      sha256: downloaded.sha256,
      size: downloaded.size,
      completedAt: new Date().toISOString(),
    });
    return downloaded;
  });
  objects.sort((a, b) => a.bucket.localeCompare(b.bucket) || a.name.localeCompare(b.name));
  const manifest: StorageManifest = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    source: { origin: config.sourceOrigin, projectRef: config.sourceProjectRef },
    target: { origin: config.targetOrigin, root: config.targetRoot },
    buckets: (Object.entries(bucketContract) as Array<[BucketName, (typeof bucketContract)[BucketName]]>).map(
      ([name, contract]) => ({ name, public: contract.public }),
    ),
    objects,
    totalBytes: objects.reduce((total, object) => total + object.size, 0),
  };
  await atomicPrivateJson(path.join(config.stateDirectory, "manifest.json"), manifest);
  return manifest;
}

export async function readAndValidateManifest(config: StorageMigrationConfig): Promise<StorageManifest> {
  const manifestPath = path.join(config.stateDirectory, "manifest.json");
  const info = await stat(manifestPath);
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error("Manifest Storage absent ou non prive");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as StorageManifest;
  if (
    manifest.formatVersion !== 1 ||
    manifest.source.origin !== config.sourceOrigin ||
    manifest.source.projectRef !== config.sourceProjectRef ||
    manifest.target.origin !== config.targetOrigin ||
    manifest.target.root !== config.targetRoot
  )
    throw new Error("Manifest Storage incompatible avec les cibles explicites");
  const bucketSettings = new Map(manifest.buckets.map(bucket => [bucket.name, bucket.public]));
  for (const [name, contract] of Object.entries(bucketContract) as Array<
    [BucketName, (typeof bucketContract)[BucketName]]
  >) {
    if (bucketSettings.get(name) !== contract.public) throw new Error(`Contrat manifeste bucket ${name} invalide`);
  }
  const seen = new Set<string>();
  for (const object of manifest.objects) {
    if (!(object.bucket in bucketContract)) throw new Error("Bucket inconnu dans le manifeste Storage");
    validateObjectName(object.name);
    if (!/^[a-f0-9]{64}$/.test(object.sha256) || !Number.isSafeInteger(object.size) || object.size < 1) {
      throw new Error("Empreinte ou taille invalide dans le manifeste Storage");
    }
    const expectedRelative = stageRelativePath(object.bucket, object.name);
    if (object.stagedFile !== expectedRelative) throw new Error("Chemin stage non canonique dans le manifeste Storage");
    const id = `${object.bucket}\0${object.name}`;
    if (seen.has(id)) throw new Error("Doublon dans le manifeste Storage");
    seen.add(id);
  }
  if (manifest.totalBytes !== manifest.objects.reduce((total, object) => total + object.size, 0)) {
    throw new Error("Total d'octets du manifeste Storage invalide");
  }
  return manifest;
}

async function targetHash(
  config: StorageMigrationConfig,
  object: StorageObjectRecord,
  fetcher: Fetch,
): Promise<{ size: number; sha256: string; mimeType: string } | null> {
  const response = await safeFetch(
    fetcher,
    `${config.targetOrigin}/storage/v1/object/authenticated/${encodeObjectPath(object.bucket, object.name)}`,
    { headers: requestHeaders(config.targetKey) },
    "Verification objet Storage cible",
  );
  if (response.status === 404) return null;
  await expectResponse(response, "Verification objet Storage cible");
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mimeType: validateObjectMagic(object.bucket, bytes.subarray(0, MAGIC_PREFIX_BYTES)),
  };
}

async function validateStagedObject(config: StorageMigrationConfig, object: StorageObjectRecord) {
  const current = await hashPrivateFile(path.join(config.stateDirectory, object.stagedFile), object.bucket);
  if (current.size !== object.size || current.sha256 !== object.sha256 || current.mimeType !== object.mimeType)
    throw new Error("Objet stage different du manifeste Storage");
}

async function targetObjectIds(config: StorageMigrationConfig, fetcher: Fetch): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const bucket of Object.keys(bucketContract) as BucketName[]) {
    for (const name of await listAllObjects(config.targetOrigin, config.targetKey, bucket, fetcher)) {
      ids.add(`${bucket}\0${name}`);
    }
  }
  return ids;
}

async function rejectUnexpectedTargetObjects(
  config: StorageMigrationConfig,
  manifest: StorageManifest,
  fetcher: Fetch,
): Promise<Set<string>> {
  const expected = new Set(manifest.objects.map(object => `${object.bucket}\0${object.name}`));
  const target = await targetObjectIds(config, fetcher);
  const unexpected = [...target].filter(id => !expected.has(id));
  if (unexpected.length > 0) {
    throw new Error(`La cible Storage contient ${unexpected.length} objet(s) hors manifeste; migration refusee`);
  }
  return target;
}

async function migrate(config: StorageMigrationConfig, fetcher: Fetch): Promise<{ migrated: number; skipped: number }> {
  const manifest = await readAndValidateManifest(config);
  await runBounded(manifest.objects, config.concurrency, async object => {
    await validateStagedObject(config, object);
  });
  await verifyBucketContract(config.targetOrigin, config.targetKey, "target-local", fetcher);
  await rejectUnexpectedTargetObjects(config, manifest, fetcher);
  const migrationProgressPath = path.join(config.stateDirectory, "migration-progress.ndjson");
  const progress = await readProgress(migrationProgressPath);
  const writeProgress = progressWriter(migrationProgressPath);
  let migrated = 0;
  let skipped = 0;
  await runBounded(manifest.objects, config.concurrency, async object => {
    const previous = progress.get(`${object.bucket}\0${object.name}`);
    const existing = await targetHash(config, object, fetcher);
    if (
      existing &&
      existing.size === object.size &&
      existing.sha256 === object.sha256 &&
      existing.mimeType === object.mimeType
    ) {
      skipped++;
      if (!previous || previous.sha256 !== object.sha256 || previous.size !== object.size) {
        await writeProgress({ ...object, completedAt: new Date().toISOString() });
      }
      return;
    }
    const staged = Bun.file(path.join(config.stateDirectory, object.stagedFile));
    await expectResponse(
      await safeFetch(
        fetcher,
        `${config.targetOrigin}/storage/v1/object/${encodeObjectPath(object.bucket, object.name)}`,
        {
          method: "POST",
          headers: requestHeaders(config.targetKey, {
            "content-type": object.mimeType,
            "x-upsert": "true",
          }),
          body: staged,
        },
        "Upload objet Storage cible",
      ),
      "Upload objet Storage cible",
    );
    const verified = await targetHash(config, object, fetcher);
    if (!verified || verified.size !== object.size || verified.sha256 !== object.sha256) {
      throw new Error("Verification post-upload Storage echouee");
    }
    migrated++;
    await writeProgress({ ...object, completedAt: new Date().toISOString() });
  });
  return { migrated, skipped };
}

async function verify(config: StorageMigrationConfig, fetcher: Fetch) {
  const manifest = await readAndValidateManifest(config);
  await verifyBucketContract(config.targetOrigin, config.targetKey, "target-local", fetcher);
  const targetIds = await rejectUnexpectedTargetObjects(config, manifest, fetcher);
  const expectedIds = new Set(manifest.objects.map(object => `${object.bucket}\0${object.name}`));
  const failures = new Set<string>();
  for (const id of expectedIds) {
    if (!targetIds.has(id)) failures.add(createHash("sha256").update(id).digest("hex"));
  }
  await runBounded(manifest.objects, config.concurrency, async object => {
    const current = await targetHash(config, object, fetcher);
    if (
      !current ||
      current.size !== object.size ||
      current.sha256 !== object.sha256 ||
      current.mimeType !== object.mimeType
    ) {
      failures.add(objectId(object.bucket, object.name));
    }
  });
  const report = {
    formatVersion: 1,
    verifiedAt: new Date().toISOString(),
    objectCount: manifest.objects.length,
    totalBytes: manifest.totalBytes,
    failureCount: failures.size,
    failedObjectIds: [...failures].sort(),
  };
  await atomicPrivateJson(path.join(config.stateDirectory, "verification.json"), report);
  if (failures.size > 0) throw new Error(`Verification Storage en echec: ${failures.size} objet(s)`);
  return report;
}

export function sanitizedPlan(config: StorageMigrationConfig, options: CommandOptions) {
  return {
    mode: options.execute ? "execute" : "dry-run",
    phase: options.phase,
    source: { projectRef: config.sourceProjectRef, credential: "configured-in-environment" },
    target: {
      binding: "loopback-8823",
      root: config.targetRoot,
      credential: "configured-in-environment",
    },
    stateDirectory: config.stateDirectory,
    concurrency: config.concurrency,
    buckets: Object.entries(bucketContract).map(([name, contract]) => ({
      name,
      public: contract.public,
    })),
  };
}

export async function runStorageMigration(
  config: StorageMigrationConfig,
  options: CommandOptions,
  fetcher: Fetch = fetch,
): Promise<unknown> {
  if (!options.execute) return sanitizedPlan(config, options);
  if (options.confirmation !== CONFIRMATION || options.phase === "plan") {
    throw new Error("Confirmation Storage absente");
  }
  if (options.phase === "inventory") {
    const manifest = await inventory(config, fetcher);
    return {
      phase: "inventory",
      objectCount: manifest.objects.length,
      totalBytes: manifest.totalBytes,
    };
  }
  if (options.phase === "migrate") return { phase: "migrate", ...(await migrate(config, fetcher)) };
  return { phase: "verify", ...(await verify(config, fetcher)) };
}

async function main(): Promise<void> {
  const options = parseCommandOptions(process.argv.slice(2));
  const config = resolveStorageMigrationConfig();
  const result = await runStorageMigration(config, options);
  console.log(JSON.stringify(result, null, 2));
  if (!options.execute) {
    console.log(`Dry-run uniquement. L'execution exige --execute --confirm ${CONFIRMATION}.`);
  }
}

if (import.meta.main) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Echec migration Storage Achillea");
    process.exit(1);
  });
}
