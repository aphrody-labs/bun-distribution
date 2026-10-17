// Browser-side open-source firmware loader.
//
// - Only components of firmware/firmware.json (generated from free-firmware.json) are fetched;
//   proprietary BIOS, keys or dumps are never requested from any server.
// - Sources are tried in order: same origin (firmware/<file>), the registry URL, then the mirror
//   order of mirrors.json. Every fetch carries Subresource Integrity (sha512) and the bytes are
//   verified again by the Rust FirmwareVerifier (sha256 + sha512 + size, streamed gzip/zstd).
// - Verified bytes are cached in the Origin Private File System, falling back to IndexedDB.
// - A user-supplied file (file picker or drag and drop) is read locally and never uploaded.

const CACHE_DIR = "bun-engine-firmware";

/** @typedef {{ new(component?: string, fileName?: string): { push(chunk: Uint8Array): void, finish(): Uint8Array } }} VerifierClass */

async function sha512Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", bytes));
  return Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
}

async function opfsDir() {
  if (!navigator.storage?.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(CACHE_DIR, { create: true });
  } catch {
    return null;
  }
}

function idb() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(CACHE_DIR, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("files");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function cacheGet(key) {
  const dir = await opfsDir();
  if (dir) {
    try {
      const handle = await dir.getFileHandle(key);
      return new Uint8Array(await (await handle.getFile()).arrayBuffer());
    } catch {
      /* not cached in OPFS */
    }
  }
  try {
    const db = await idb();
    return await new Promise(resolve => {
      const get = db.transaction("files").objectStore("files").get(key);
      get.onsuccess = () => resolve(get.result ? new Uint8Array(get.result) : null);
      get.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function cachePut(key, bytes) {
  const dir = await opfsDir();
  if (dir) {
    try {
      const writable = await (await dir.getFileHandle(key, { create: true })).createWritable();
      await writable.write(bytes);
      await writable.close();
      return "opfs";
    } catch {
      /* OPFS unavailable (private mode, Safari workers); use IndexedDB */
    }
  }
  try {
    const db = await idb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return "indexeddb";
  } catch {
    return null;
  }
}

async function verify(bytes, entry, id, Verifier) {
  if (Verifier) {
    const verifier = new Verifier(id);
    verifier.push(bytes);
    return verifier.finish();
  }
  const digest = await sha512Hex(bytes);
  if (digest !== entry.sha512) throw new Error(`firmware \`${id}\`: sha512 ${digest} does not match the registry`);
  return bytes;
}

/**
 * Load open-source firmware component `id` (for example "openbios").
 * @param {string} id
 * @param {{ base?: string, Verifier?: VerifierClass }} [options] base: URL of /emulation/;
 *   Verifier: the FirmwareVerifier class exported by a Rust core module.
 * @returns {Promise<{ bytes: Uint8Array, source: string, cache: string | null }>}
 */
export async function loadFreeFirmware(id, { base = new URL("../", import.meta.url).href, Verifier } = {}) {
  const registry = await (await fetch(new URL("firmware/firmware.json", base), { cache: "no-cache" })).json();
  const entry = registry.firmware?.[id];
  if (!entry) throw new Error(`firmware \`${id}\` is not an open-source registry component`);
  const key = entry.sha512;
  const cached = await cacheGet(key);
  if (cached) {
    try {
      return {
        bytes: await verify(cached, entry, id, Verifier),
        source: "cache",
        cache: null,
      };
    } catch {
      /* stale or corrupted cache entry: fetch again */
    }
  }
  const failures = [];
  for (const url of entry.urls) {
    const target = new URL(url, base);
    try {
      const response = await fetch(target, {
        integrity: entry.integrity,
        mode: "cors",
        credentials: "omit",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await verify(new Uint8Array(await response.arrayBuffer()), entry, id, Verifier);
      return { bytes, source: target.href, cache: await cachePut(key, bytes) };
    } catch (error) {
      failures.push(`${target.href}: ${error.message ?? error}`);
    }
  }
  throw new Error(
    `${entry.console} needs the open-source firmware \`${id}\` (${entry.file}); every source failed:\n${failures.join("\n")}`,
  );
}

/**
 * Read a user-supplied BIOS/firmware file locally. The bytes stay in this tab: they are not
 * uploaded or cached. Compressed (.gz/.zst) files are decoded by the Rust verifier.
 * @param {File|Blob} file
 * @param {{ Verifier?: VerifierClass }} [options]
 */
export async function readUserFirmware(file, { Verifier } = {}) {
  if (file.size > 128 * 1024 * 1024) throw new Error("firmware files are limited to 128 MiB");
  if (!Verifier) return new Uint8Array(await file.arrayBuffer());
  const verifier = new Verifier(undefined, file.name);
  const reader = file.stream().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    verifier.push(value);
  }
  return verifier.finish();
}

/** Accept a dropped or picked file on `element`; `onFile` receives the local bytes. */
export function acceptUserFirmware(element, onFile, options) {
  const input = Object.assign(document.createElement("input"), {
    type: "file",
    hidden: true,
  });
  element.after(input);
  const take = async file => file && onFile(await readUserFirmware(file, options), file.name);
  input.addEventListener("change", () => take(input.files?.[0]));
  element.addEventListener("click", () => input.click());
  element.addEventListener("dragover", event => event.preventDefault());
  element.addEventListener("drop", event => {
    event.preventDefault();
    take(event.dataTransfer?.files?.[0]);
  });
}
