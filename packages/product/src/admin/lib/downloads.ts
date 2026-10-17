// SPDX-License-Identifier: Apache-2.0
/** What downloads.aphrody.com publishes (`latest.json`, `SHA256SUMS`) and the checks done before anything is installed. */
import type { Context } from "./context.ts";
import type { Release } from "../../shared/update.ts";

export interface ManifestArtifact {
  name: string;
  version: string;
  platform: string;
  target?: string;
  kind?: string;
  url: string;
  sha256: string;
  size: number;
  file?: string;
}

export interface Manifest {
  schemaVersion: number;
  release: { id: string; commit?: string };
  baseUrl: string;
  artifacts: ManifestArtifact[];
  /** Installer assets are listed here; SHA256SUMS covers artifact archives only. */
  assetChecksums?: Record<string, string>;
}

export const WINDOWS_PLATFORM = "windows-x86_64";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchManifest(base: string, fetchImpl: Fetch = fetch): Promise<Manifest> {
  const res = await fetchImpl(`${base}/latest.json`, {
    headers: { accept: "application/json", "cache-control": "no-cache" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`le site de téléchargement répond ${res.status}`);
  const manifest = (await res.json()) as Manifest;
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.artifacts))
    throw new Error("le catalogue de téléchargement n'a pas le format attendu");
  if (!manifest.release || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(manifest.release.id))
    throw new Error("identifiant de release invalide");
  return manifest;
}

/** One snapshot per installer context: selecting current never mixes releases mid-install. */
const snapshots = new WeakMap<Context, Map<string, Promise<DownloadSnapshot>>>();
export interface DownloadSnapshot {
  manifest: Manifest;
  base: string;
  sums: Map<string, string>;
}
export function downloadsFor(ctx: Context, base: string): Promise<DownloadSnapshot> {
  let selected = snapshots.get(ctx);
  if (!selected) {
    selected = new Map();
    snapshots.set(ctx, selected);
  }
  let snapshot = selected.get(base);
  if (!snapshot) {
    snapshot = (async () => {
      const manifest = await fetchManifest(base, ctx.fetchImpl);
      const pinned = `${base.replace(/\/$/, "")}/releases/${manifest.release.id}`;
      const artifacts = manifest.artifacts.map(artifact => {
        const file = artifact.file ?? new URL(artifact.url).pathname.split("/").pop()!;
        safeFile(file);
        const url = new URL(artifact.url);
        if (
          url.origin !== new URL(base).origin ||
          url.search ||
          url.hash ||
          ![`${base}/files/${file}`, `${pinned}/files/${file}`].includes(artifact.url)
        )
          throw new Error(`adresse hors du site de téléchargement : ${artifact.url}`);
        return { ...artifact, file, url: `${pinned}/files/${file}` };
      });
      return {
        manifest: { ...manifest, artifacts },
        base: pinned,
        sums: await fetchSums(pinned, ctx.fetchImpl),
      };
    })();
    selected.set(base, snapshot);
  }
  return snapshot;
}
function safeFile(file: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file) || file === "." || file === "..")
    throw new Error(`nom de fichier refusé : ${file}`);
}
export async function verifiedScript(snapshot: DownloadSnapshot, name: string, fetchImpl: Fetch): Promise<string> {
  safeFile(name);
  const hashes = snapshot.manifest.assetChecksums;
  const expected = hashes && Object.hasOwn(hashes, name) ? hashes[name] : undefined;
  if (typeof expected !== "string" || !/^[0-9a-f]{64}$/i.test(expected))
    throw new Error(`${name} : empreinte SHA-256 absente ou invalide dans assetChecksums`);
  const response = await fetchImpl(`${snapshot.base}/${name}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${name} : HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== expected.toLowerCase())
    throw new Error(`SHA-256 invalide pour ${name}`);
  return new TextDecoder().decode(bytes);
}

export async function fetchSums(base: string, fetchImpl: Fetch = fetch): Promise<Map<string, string>> {
  const res = await fetchImpl(`${base}/SHA256SUMS`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`SHA256SUMS : le site répond ${res.status}`);
  const sums = new Map<string, string>();
  for (const line of (await res.text()).split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match) sums.set(match[2]!.replace(/^files\//, ""), match[1]!.toLowerCase());
  }
  return sums;
}

export function pickArtifact(
  manifest: Manifest,
  name: string,
  platform: string = WINDOWS_PLATFORM,
  extension?: string,
): ManifestArtifact | undefined {
  return manifest.artifacts.find(
    artifact =>
      artifact.name === name &&
      artifact.platform === platform &&
      (extension === undefined || (artifact.file ?? artifact.url).endsWith(extension)),
  );
}

/** An artifact is trusted only when its URL stays on the site and its hash agrees with SHA256SUMS. */
export function checkArtifact(base: string, artifact: ManifestArtifact, sums: Map<string, string>): void {
  if (!artifact.url.startsWith(`${base}/files/`))
    throw new Error(`adresse hors du site de téléchargement : ${artifact.url}`);
  const file = artifact.file ?? decodeURIComponent(artifact.url.slice(`${base}/files/`.length));
  safeFile(file);
  if (artifact.url !== `${base}/files/${file}`) throw new Error("adresse et fichier différents");
  if (!/^[0-9a-f]{64}$/i.test(artifact.sha256) || !Number.isSafeInteger(artifact.size) || artifact.size < 0)
    throw new Error("métadonnées invalides");
  const listed = sums.get(file);
  if (!listed) throw new Error(`${file} n'est pas dans SHA256SUMS`);
  if (listed !== artifact.sha256.toLowerCase())
    throw new Error(`${file} : le catalogue et SHA256SUMS ne donnent pas la même empreinte`);
}

/** Adapter: the downloads catalogue seen as the `Release` that creator-kit's update engine installs. */
export function toRelease(manifest: Manifest, name: string, currentPlatform: string): Release | undefined {
  const matching = manifest.artifacts.filter(
    artifact =>
      artifact.name === name &&
      artifact.platform === WINDOWS_PLATFORM &&
      (artifact.file ?? artifact.url).endsWith(".tar.gz"),
  );
  const first = matching[0];
  if (!first) return undefined;
  return {
    schemaVersion: 1,
    name,
    version: first.version,
    releasedAt: manifest.release.id,
    artifacts: matching.map(artifact => ({
      id: artifact.file ?? artifact.url,
      kind: "update" as const,
      format: "tar.gz" as const,
      platform: currentPlatform,
      file: artifact.file ?? artifact.url,
      url: artifact.url,
      sha256: artifact.sha256,
      size: artifact.size,
    })),
  };
}
