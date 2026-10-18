// SPDX-License-Identifier: Apache-2.0
// Package manager of the web distribution: a signed-by-hash registry, verified installs into Cache Storage
// (served offline by the service worker), updates by version, and clean removal.

export interface RegistryEntry {
  id: string;
  name: string;
  version: string;
  category: "games" | "create" | "tools";
  description: string;
  license: string;
  glyph: string;
  size: number;
  threads?: boolean;
  manifest: string;
}

interface Manifest extends RegistryEntry {
  entry: string;
  files: { path: string; sha256: string; bytes: number }[];
}

export interface InstallRecord {
  version: string;
  size: number;
  at: string;
}

const KEY = "aph.packages";
const cacheName = (id: string) => `pkg:${id}`;

let registryPromise: Promise<RegistryEntry[]> | undefined;
export function registry(): Promise<RegistryEntry[]> {
  registryPromise ??= fetch("/registry.json", { cache: "no-cache" })
    .then(r => r.json() as Promise<{ packages: RegistryEntry[] }>)
    .then(r => r.packages);
  return registryPromise;
}

export function installed(): Record<string, InstallRecord> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, InstallRecord>;
  } catch {
    return {};
  }
}
const save = (next: Record<string, InstallRecord>) => localStorage.setItem(KEY, JSON.stringify(next));

export function needsUpdate(entry: RegistryEntry): boolean {
  const have = installed()[entry.id];
  return !!have && have.version !== entry.version;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");

/** Download every file of a package, check its sha256, then publish the cache atomically (temp cache then rename by copy). */
export async function install(entry: RegistryEntry, onProgress: (done: number, total: number) => void): Promise<void> {
  const manifest = (await (await fetch(entry.manifest, { cache: "no-cache" })).json()) as Manifest;
  const total = manifest.files.reduce((n, f) => n + f.bytes, 0);
  const staging = `${cacheName(entry.id)}.staging`;
  await caches.delete(staging);
  const cache = await caches.open(staging);
  let done = 0;
  try {
    for (const file of manifest.files) {
      const url = `/apps/${entry.id}/${file.path}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok || !res.body) throw new Error(`${file.path}: HTTP ${res.status}`);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let got = 0;
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        chunks.push(value);
        got += value.byteLength;
        onProgress(done + got, total);
      }
      const bytes = new Uint8Array(got);
      let at = 0;
      for (const c of chunks) {
        bytes.set(c, at);
        at += c.byteLength;
      }
      if (bytes.byteLength !== file.bytes) throw new Error(`${file.path}: size mismatch`);
      if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== file.sha256)
        throw new Error(`${file.path}: checksum mismatch, install cancelled`);
      const headers = new Headers(res.headers);
      await cache.put(url, new Response(bytes, { headers }));
      if (file.path === manifest.entry) await cache.put(`/apps/${entry.id}/`, new Response(bytes, { headers }));
      done += file.bytes;
    }
    const final = await caches.open(cacheName(entry.id));
    for (const request of await cache.keys()) {
      const res = await cache.match(request);
      if (res) await final.put(request, res);
    }
    for (const request of await final.keys()) {
      if (!(await cache.match(request))) await final.delete(request);
    }
  } finally {
    await caches.delete(staging);
  }
  save({
    ...installed(),
    [entry.id]: {
      version: entry.version,
      size: manifest.files.reduce((n, f) => n + f.bytes, 0),
      at: new Date().toISOString(),
    },
  });
}

export async function uninstall(id: string): Promise<void> {
  await caches.delete(cacheName(id));
  const next = installed();
  delete next[id];
  save(next);
}

/** Drop records whose cache the browser evicted, so the UI never claims an app that is gone. */
export async function reconcile(): Promise<void> {
  const next = installed();
  let changed = false;
  for (const id of Object.keys(next)) {
    if (!(await caches.has(cacheName(id)))) {
      delete next[id];
      changed = true;
    }
  }
  if (changed) save(next);
}

export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (error) {
    console.warn("service worker unavailable", error);
  }
}
