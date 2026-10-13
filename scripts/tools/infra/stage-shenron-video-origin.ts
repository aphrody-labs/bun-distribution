// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop -- Directory validation and publication must stay ordered. */
import { chmod, lstat, mkdir, realpath, rename, rm } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

const PRIVATE_ROOT = "/home/ubuntu/.aphrody/profiles/dbfr/video-handoff/beerus-01";
const PUBLIC_ROOT = "/srv/shenron/shared/site/public-extra";
const PUBLIC_DIR = "media/episodes/beerus-01";
const MAX_CACHEABLE_BYTES = 512 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

export type VideoAsset = {
  source: string;
  sha256: string;
  name: "optimized-720p.mp4" | "poster.webp";
};

function inside(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return (
    suffix !== "" && suffix !== ".." && !suffix.startsWith(`..${sep}`) && !suffix.startsWith(sep)
  );
}

async function digest(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

async function requireDirectoryChain(root: string, destination: string): Promise<void> {
  const rootPath = await realpath(root);
  if (rootPath !== root || !inside(root, destination)) throw Error("Public path differs");
  let current = root;
  for (const part of relative(root, dirname(destination)).split(sep)) {
    current = join(current, part);
    let created = false;
    try {
      await mkdir(current, { mode: 0o755 });
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw Error("Public directory is not regular");
    if (created) await chmod(current, 0o755);
  }
}

async function validateAsset(asset: VideoAsset, privateRoot: string): Promise<{ size: number }> {
  if (!SHA256.test(asset.sha256)) throw Error("Expected SHA-256 is invalid");
  const source = await realpath(asset.source);
  const root = await realpath(privateRoot);
  if (!inside(root, source)) throw Error("Source is outside private handoff");
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink()) throw Error("Source is not a regular file");
  if (info.size < 12 || (asset.name.endsWith(".mp4") && info.size > MAX_CACHEABLE_BYTES))
    throw Error("Media size is invalid for Cloudflare Free cache");
  const header = new Uint8Array(await Bun.file(source).slice(0, 12).arrayBuffer());
  const ascii = (start: number, end: number) => String.fromCharCode(...header.slice(start, end));
  if (
    asset.name.endsWith(".mp4")
      ? ascii(4, 8) !== "ftyp"
      : ascii(0, 4) !== "RIFF" || ascii(8, 12) !== "WEBP"
  )
    throw Error("Media signature differs from extension");
  if ((await digest(source)) !== asset.sha256) throw Error("Source SHA-256 differs");
  return { size: info.size };
}

/** Publish only qualified, optimized files to the DBFR public disk mount. */
export async function stageShenronVideo(
  assets: [VideoAsset, VideoAsset],
  privateRoot = PRIVATE_ROOT,
  publicRoot = PUBLIC_ROOT,
): Promise<Array<{ path: string; sha256: string; size: number; changed: boolean }>> {
  if (assets[0].name !== "poster.webp" || assets[1].name !== "optimized-720p.mp4")
    throw Error("Expected poster then optimized video");
  const validated = await Promise.all(assets.map((asset) => validateAsset(asset, privateRoot)));
  const results = [];
  for (const [index, asset] of assets.entries()) {
    const destination = join(publicRoot, PUBLIC_DIR, asset.name);
    await requireDirectoryChain(publicRoot, destination);
    const existing = Bun.file(destination);
    if (await existing.exists()) {
      const info = await lstat(destination);
      if (!info.isFile() || info.isSymbolicLink())
        throw Error("Public destination is not a regular file");
      if ((await digest(destination)) === asset.sha256) {
        results.push({
          path: destination,
          sha256: asset.sha256,
          size: validated[index]!.size,
          changed: false,
        });
        continue;
      }
    }
    const temporary = join(dirname(destination), `.staging-${crypto.randomUUID()}`);
    try {
      await Bun.write(temporary, Bun.file(asset.source));
      await chmod(temporary, 0o644);
      if ((await digest(temporary)) !== asset.sha256) throw Error("Staged SHA-256 differs");
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
    results.push({
      path: destination,
      sha256: asset.sha256,
      size: validated[index]!.size,
      changed: true,
    });
  }
  return results;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && args.length !== 4)
    throw Error("Usage: bun stage-shenron-video-origin.ts [POSTER WEBP_SHA256 VIDEO MP4_SHA256]");
  const stage = join(PRIVATE_ROOT, "stage");
  const expected = async (name: string) => {
    const match = /^([a-f0-9]{64})(?:\s|$)/.exec(
      await Bun.file(join(stage, `${name}.sha256`)).text(),
    );
    if (!match) throw Error("Pipeline SHA-256 is invalid");
    return match[1]!;
  };
  const [poster, posterSha256, video, videoSha256] = args.length
    ? [args[0]!, args[1]!, args[2]!, args[3]!]
    : [
        join(stage, "poster.webp"),
        await expected("poster"),
        join(stage, "optimized-720p.mp4"),
        await expected("optimized-720p"),
      ];
  console.log(
    JSON.stringify(
      await stageShenronVideo([
        { source: poster, sha256: posterSha256, name: "poster.webp" },
        { source: video, sha256: videoSha256, name: "optimized-720p.mp4" },
      ]),
    ),
  );
}
