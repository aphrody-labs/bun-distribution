// Private, encrypted copies of owned dumps in an object store. Every dump is split into parts,
// each part compressed with zstd and sealed with AES-256-GCM (Web Crypto) before it leaves the
// machine; object names are HMACs of the SHA-256, so the bucket learns neither titles nor hashes.
// The master key lives in the OS credential store (Bun.secrets aphrody.bun-engine/owned-dumps-key),
// is created on first use and is never printed.
//
// Transport: the platform transfer service (objectTarget "r2:private/owned", the private R2 bucket
// with its protected credentials and bandwidth caps); file: targets serve local tests only.
//
// Layout under the target prefix:  <objectId>/part-00000 ...  <objectId>/manifest
// Resume: parts already recorded in owned_sync (and present remotely) are skipped; part IVs are
// derived from (sha256, index), so a re-sealed part is byte-identical. Integrity: each part is
// checked after upload (size, ETag = MD5 when the store reports one) and on restore (SHA-256 of
// every sealed part from the manifest, GCM tags, SHA-256 of the whole dump).
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ObjectTarget } from "../../../bun-os-platform/src/transfer";
import { type OwnedDump, ownedBySha, ownedDb, storePath } from "./store";

export type { ObjectTarget };

const secretService = "aphrody.bun-engine";
const keySecret = "owned-dumps-key";
const defaultPartBytes = 32 * 1024 * 1024;
/** The private R2 bucket of the platform transfer service, under the owned/ prefix. */
export const defaultTarget = "r2:private/owned";

const encoder = new TextEncoder();
/** Web Crypto wants ArrayBuffer-backed views; Bun's byte APIs never return shared buffers. */
const view = (bytes: Uint8Array) => bytes as Uint8Array<ArrayBuffer>;
const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("hex");

interface Keys {
  seal: CryptoKey;
  names: CryptoKey;
  ivs: CryptoKey;
}

let cachedKeys: Promise<Keys> | undefined;
/** The vault keys, derived (HKDF-SHA-256) from the master secret; the secret is created once. */
function vaultKeys(): Promise<Keys> {
  cachedKeys ??= (async () => {
    let secret = await Bun.secrets.get({ service: secretService, name: keySecret });
    if (!secret) {
      secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
      await Bun.secrets.set({ service: secretService, name: keySecret, value: secret });
    }
    const master = await crypto.subtle.importKey("raw", Buffer.from(secret, "base64"), "HKDF", false, ["deriveKey"]);
    const derive = (info: string, algorithm: AesKeyGenParams | HmacKeyGenParams, usages: KeyUsage[]) =>
      crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: encoder.encode(info) },
        master,
        algorithm,
        false,
        usages,
      );
    return {
      seal: await derive("bep owned v1 seal", { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]),
      names: await derive("bep owned v1 names", { name: "HMAC", hash: "SHA-256", length: 256 }, ["sign"]),
      ivs: await derive("bep owned v1 ivs", { name: "HMAC", hash: "SHA-256", length: 256 }, ["sign"]),
    };
  })();
  return cachedKeys;
}

async function hmac(key: CryptoKey, value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

/** Opaque object id of a dump: HMAC-SHA-256 of its SHA-256 under the vault key. */
export async function objectId(sha256: string): Promise<string> {
  return hex(await hmac((await vaultKeys()).names, sha256));
}

async function sealPart(bytes: Uint8Array, sha256: string, index: number, aad: string): Promise<Uint8Array> {
  const keys = await vaultKeys();
  const iv = view((await hmac(keys.ivs, `${sha256}:${index}`)).subarray(0, 12));
  const packed = await Bun.zstdCompress(bytes, { level: 3 });
  return new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(aad) }, keys.seal, view(packed)),
  );
}

async function openPart(sealed: Uint8Array, sha256: string, index: number, aad: string): Promise<Uint8Array> {
  const keys = await vaultKeys();
  const iv = view((await hmac(keys.ivs, `${sha256}:${index}`)).subarray(0, 12));
  const packed = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    keys.seal,
    view(sealed),
  );
  return Bun.zstdDecompress(new Uint8Array(packed));
}

/** Manifests carry their own random IV (they may be rewritten), prefixed to the ciphertext. */
async function sealManifest(value: unknown, aad: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
      (await vaultKeys()).seal,
      encoder.encode(JSON.stringify(value)),
    ),
  );
  const out = new Uint8Array(12 + body.length);
  out.set(iv);
  out.set(body, 12);
  return out;
}

async function openManifest<T>(sealed: Uint8Array, aad: string): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: view(sealed.subarray(0, 12)), additionalData: encoder.encode(aad) },
    (await vaultKeys()).seal,
    view(sealed.subarray(12)),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

// ---- targets ----------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

/** Local directory target for tests, throttled like the bucket. */
function fileTarget(root: string, bandwidth = 0): ObjectTarget {
  const at = (key: string) => join(root, ...key.split("/"));
  let moved = 0;
  const started = performance.now();
  const throttle = async (bytes: number) => {
    moved += bytes;
    const due = bandwidth ? (moved / bandwidth) * 1000 - (performance.now() - started) : 0;
    if (due > 0) await sleep(due);
  };
  return {
    id: `file:${root}`,
    async put(key, bytes) {
      await throttle(bytes.length);
      await mkdir(dirname(at(key)), { recursive: true });
      await Bun.write(`${at(key)}.tmp`, bytes);
      await rename(`${at(key)}.tmp`, at(key));
    },
    async stat(key) {
      const file = Bun.file(at(key));
      if (!(await file.exists())) return null;
      return { size: file.size, etag: new Bun.CryptoHasher("md5").update(await file.bytes()).digest("hex") };
    },
    async get(key) {
      const bytes = await Bun.file(at(key)).bytes();
      await throttle(bytes.length);
      return bytes;
    },
    async delete(key) {
      await rm(at(key), { force: true });
    },
  };
}

/**
 * `file:///dir` or `file:C:/dir` for local copies (tests); anything else goes through the platform
 * transfer service (`r2:private[/<prefix>]`, `r2:<bucket>/<prefix>`, `r2://`, `s3://`), which
 * holds the R2 credentials and refuses any bucket but the configured private one.
 * `bandwidth` caps the transfer in bytes per second (0 = the platform's global cap only).
 */
export async function openTarget(spec = defaultTarget, bandwidth = 0): Promise<ObjectTarget> {
  if (spec.startsWith("file:")) {
    const path = spec.startsWith("file://") ? fileURLToPath(spec) : spec.slice(5);
    return fileTarget(resolve(path), bandwidth);
  }
  const { objectTarget } = await import("../../../bun-os-platform/src/transfer");
  return objectTarget(spec === "private" ? defaultTarget : spec, { private: true, bandwidth });
}

/** A part already stored remotely: same size, and the same MD5 when the store reports a plain ETag. */
function sameObject(remote: { size: number; etag?: string } | null, size: number, md5: string): boolean {
  if (!remote || remote.size !== size) return false;
  const etag = remote.etag?.replaceAll('"', "").toLowerCase();
  return !etag || !/^[0-9a-f]{32}$/.test(etag) || etag === md5;
}

// ---- push / pull ------------------------------------------------------------------------------

interface SealedManifest {
  v: 1;
  sha256: string;
  size: number;
  partBytes: number;
  kind: string;
  console: string;
  system: string | null;
  file: string;
  parts: Array<{ bytes: number; sha256: string }>;
}

export interface PushOptions {
  partBytes?: number;
  /** Stop after this many uploaded parts (exercises resume). */
  stopAfterParts?: number;
}

export interface PushResult {
  sha256: string;
  target: string;
  object: string;
  parts: number;
  uploaded: number;
  skipped: number;
  bytes: number;
  complete: boolean;
}

/** Seals and uploads one dump; an interrupted push resumes at the first missing part. */
export async function pushDump(dump: OwnedDump, target: ObjectTarget, options: PushOptions = {}): Promise<PushResult> {
  const file = Bun.file(storePath(dump));
  if (!(await file.exists())) throw new Error(`${dump.sha256.slice(0, 12)} is missing from the store`);
  const object = await objectId(dump.sha256);
  const state = ownedDb()
    .query<{ partBytes: number; done: number; state: string }, [string, string]>(
      "SELECT parts AS partBytes, done, state FROM owned_sync WHERE sha256 = ? AND target = ?",
    )
    .get(dump.sha256, target.id);
  const partBytes = state?.partBytes || options.partBytes || defaultPartBytes;
  const count = Math.max(1, Math.ceil(dump.size / partBytes));
  const record = ownedDb().query(
    "INSERT OR REPLACE INTO owned_sync VALUES ($sha256, $target, $state, $parts, $done, $bytes, $updatedAt)",
  );
  const parts: SealedManifest["parts"] = [];
  let uploaded = 0;
  let skipped = 0;
  let bytes = 0;
  for (let index = 0; index < count; index++) {
    const key = `${object}/part-${String(index).padStart(5, "0")}`;
    const aad = `bep-owned-v1:${object}:${index}:${count}`;
    const plain = await file.slice(index * partBytes, Math.min(dump.size, (index + 1) * partBytes)).bytes();
    const sealed = await sealPart(plain, dump.sha256, index, aad);
    const digest = new Bun.CryptoHasher("sha256").update(sealed).digest("hex");
    const md5 = new Bun.CryptoHasher("md5").update(sealed).digest("hex");
    parts.push({ bytes: sealed.length, sha256: digest });
    const remote = index < (state?.done ?? 0) || state?.state === "done" ? await target.stat(key) : null;
    if (sameObject(remote, sealed.length, md5)) {
      skipped++;
      continue;
    }
    if (options.stopAfterParts !== undefined && uploaded >= options.stopAfterParts) {
      return {
        sha256: dump.sha256,
        target: target.id,
        object,
        parts: count,
        uploaded,
        skipped,
        bytes,
        complete: false,
      };
    }
    await target.put(key, sealed);
    if (!sameObject(await target.stat(key), sealed.length, md5))
      throw new Error(`part ${index} of ${dump.sha256.slice(0, 12)} failed its integrity check after upload`);
    uploaded++;
    bytes += sealed.length;
    record.run({
      sha256: dump.sha256,
      target: target.id,
      state: "partial",
      parts: partBytes,
      done: index + 1,
      bytes,
      updatedAt: new Date().toISOString(),
    });
  }
  const manifest: SealedManifest = {
    v: 1,
    sha256: dump.sha256,
    size: dump.size,
    partBytes,
    kind: dump.kind,
    console: dump.console,
    system: dump.system,
    file: dump.file.split("/").pop()!,
    parts,
  };
  await target.put(`${object}/manifest`, await sealManifest(manifest, `bep-owned-v1:${object}:manifest`));
  record.run({
    sha256: dump.sha256,
    target: target.id,
    state: "done",
    parts: partBytes,
    done: count,
    bytes,
    updatedAt: new Date().toISOString(),
  });
  return { sha256: dump.sha256, target: target.id, object, parts: count, uploaded, skipped, bytes, complete: true };
}

/** Downloads, verifies and decrypts one dump into `destination` (a file path). */
export async function pullDump(
  sha256: string,
  target: ObjectTarget,
  destination: string,
): Promise<{ sha256: string; bytes: number; file: string }> {
  const object = await objectId(sha256);
  const manifest = await openManifest<SealedManifest>(
    await target.get(`${object}/manifest`),
    `bep-owned-v1:${object}:manifest`,
  );
  if (manifest.sha256 !== sha256) throw new Error("manifest does not belong to this dump");
  await mkdir(dirname(resolve(destination)), { recursive: true });
  const partial = `${destination}.part`;
  const sink = Bun.file(partial).writer();
  const whole = new Bun.CryptoHasher("sha256");
  let bytes = 0;
  try {
    for (const [index, part] of manifest.parts.entries()) {
      const sealed = await target.get(`${object}/part-${String(index).padStart(5, "0")}`);
      if (sealed.length !== part.bytes || new Bun.CryptoHasher("sha256").update(sealed).digest("hex") !== part.sha256)
        throw new Error(`part ${index} is corrupt or was replaced`);
      const plain = await openPart(sealed, sha256, index, `bep-owned-v1:${object}:${index}:${manifest.parts.length}`);
      whole.update(plain);
      sink.write(plain);
      bytes += plain.length;
    }
  } catch (error) {
    await sink.end();
    await rm(partial, { force: true });
    throw error;
  }
  await sink.end();
  if (whole.digest("hex") !== sha256 || bytes !== manifest.size) {
    await rm(partial, { force: true });
    throw new Error("restored dump does not match its SHA-256");
  }
  await rename(partial, destination);
  return { sha256, bytes, file: destination };
}

/** Deletes a dump's sealed parts and manifest from a target. */
export async function deleteRemote(sha256: string, target: ObjectTarget): Promise<number> {
  const object = await objectId(sha256);
  const state = ownedDb()
    .query<{ partBytes: number }, [string, string]>(
      "SELECT parts AS partBytes FROM owned_sync WHERE sha256 = ? AND target = ?",
    )
    .get(sha256, target.id);
  const dump = ownedBySha(sha256);
  const count = dump && state ? Math.max(1, Math.ceil(dump.size / state.partBytes)) : 0;
  let removed = 0;
  for (let index = 0; index < count; index++) {
    await target.delete(`${object}/part-${String(index).padStart(5, "0")}`);
    removed++;
  }
  await target.delete(`${object}/manifest`);
  ownedDb().query("DELETE FROM owned_sync WHERE sha256 = ? AND target = ?").run(sha256, target.id);
  return removed + 1;
}
