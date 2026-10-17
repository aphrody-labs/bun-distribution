// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop -- Resumable chunks and state transitions must execute sequentially. */
/** Resumable, upload-only backup of protected dbfr training artifacts. */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { gcloudUserClient, googleApi } from "./api.ts";

const CHUNK = 8 * 1024 * 1024;
const FOLDER = "application/vnd.google-apps.folder";
const EXTENSIONS = /\.(json|jsonl|safetensors|onnx|txt|md)$/;
type Artifact = { path: string; name: string; bytes: number; mtimeMs: number };
type Entry = {
  sha256: string;
  md5: string;
  bytes: number;
  mtimeMs: number;
  id?: string;
  session?: string;
};
type State = { version: 1; parentId: string; folderId?: string; files: Record<string, Entry> };

export function resumeOffset(range: string | null, size: number): number {
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/.exec(range);
  if (!match) throw new Error("Invalid resumable upload range");
  const offset = Number(match[1]) + 1;
  if (!Number.isSafeInteger(offset) || offset < 1 || offset > size)
    throw new Error("Resumable upload range exceeds artifact");
  return offset;
}
export function safeArtifactName(name: string): boolean {
  return (
    name.split("/").every(part => Boolean(part) && part !== "." && part !== "..") &&
    EXTENSIONS.test(name) &&
    !name
      .split("/")
      .some(part => /^(?:credentials?|secrets?|cookies?|(?:oauth-)?tokens?)(?:[._-]|$)|^\.env(?:\.|$)/i.test(part))
  );
}
async function artifacts(root: string, prefix: string): Promise<Artifact[]> {
  const found: Artifact[] = [];
  async function visit(path: string, name: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("Training artifact scope contains a symlink");
      const full = join(path, entry.name),
        relative = `${name}/${entry.name}`;
      if (entry.isDirectory()) await visit(full, relative);
      else if (entry.isFile()) {
        if (!safeArtifactName(relative)) throw new Error(`Out-of-scope training artifact: ${relative}`);
        const info = await stat(full);
        found.push({ path: full, name: relative, bytes: info.size, mtimeMs: info.mtimeMs });
      }
    }
  }
  await visit(root, prefix);
  return found;
}
async function digests(path: string): Promise<{ sha256: string; md5: string }> {
  const sha = createHash("sha256"),
    md5 = createHash("md5");
  for await (const chunk of createReadStream(path)) {
    sha.update(chunk);
    md5.update(chunk);
  }
  return { sha256: sha.digest("hex"), md5: md5.digest("hex") };
}
async function save(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  await Bun.write(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, path);
}

export async function syncTrainedArtifacts(): Promise<void> {
  const home = join(homedir(), ".aphrody");
  const parentId = process.env.APHRODY_GOOGLE_DRIVE_FOLDER_ID;
  if (!parentId) throw new Error("APHRODY_GOOGLE_DRIVE_FOLDER_ID is required");
  const statePath = join(home, "drive-sync/dbfr-trained-artifacts.json");
  const lock = `${statePath}.lock`;
  await mkdir(dirname(lock), { recursive: true, mode: 0o700 });
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(
      await Bun.file(join(lock, "pid"))
        .text()
        .catch(() => "0"),
    );
    if (pid > 1) {
      try {
        process.kill(pid, 0);
        throw new Error("Trained artifact sync is already running", { cause: error });
      } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe;
      }
    }
    await rm(lock, { recursive: true });
    await mkdir(lock, { mode: 0o700 });
  }
  await Bun.write(join(lock, "pid"), `${process.pid}\n`, { mode: 0o600 });
  try {
    const state: State = (await Bun.file(statePath).exists())
      ? await Bun.file(statePath).json()
      : { version: 1, parentId, files: {} };
    if (state.version !== 1 || state.parentId !== parentId)
      throw new Error("Training Drive state parent/version mismatch");
    const service = await googleApi();
    const folders = new Map<string, string>();
    let refreshedAt = Date.now();
    const headers = async () => {
      if (process.env.APHRODY_GOOGLE_DRIVE_AUTH === "gcloud-user" && Date.now() - refreshedAt > 20 * 60_000) {
        const fresh = await gcloudUserClient();
        if ("setCredentials" in service.auth) service.auth.setCredentials(fresh.credentials);
        refreshedAt = Date.now();
      }
      return new Headers(await service.auth.getRequestHeaders());
    };
    async function folder(parent: string, name: string): Promise<string> {
      const key = `${parent}/${name}`;
      if (folders.has(key)) return folders.get(key)!;
      const listed = await service.drive.files.list({
        q: `'${parent}' in parents and name = '${name}' and trashed = false`,
        fields: "files(id,mimeType)",
        pageSize: 1000,
      });
      const files = listed.data.files ?? [];
      if (files.length > 1 || files.some(file => file.mimeType !== FOLDER))
        throw new Error("Ambiguous training backup folder");
      let id = files[0]?.id;
      if (!id)
        id = (
          await service.drive.files.create({
            requestBody: { name, mimeType: FOLDER, parents: [parent] },
            fields: "id",
          })
        ).data.id;
      if (!id) throw new Error("Drive did not return training folder id");
      folders.set(key, id);
      return id;
    }
    state.folderId = await folder(parentId, "shenron-trained");
    await save(statePath, state);
    const files = [
      ...(await artifacts(join(home, "private/shenron/home/models"), "models")),
      ...(await artifacts(join(home, "private/training/shenron"), "training")),
      ...(await artifacts(join(home, "train/train-1790476607"), "checkpoints/train-1790476607")),
    ].toSorted((a, b) => a.bytes - b.bytes || a.name.localeCompare(b.name));
    let uploaded = 0,
      unchanged = 0;
    for (const file of files) {
      let entry = state.files[file.name];
      if (!entry || entry.bytes !== file.bytes || entry.mtimeMs !== file.mtimeMs) {
        const hashes = await digests(file.path);
        entry = { ...hashes, bytes: file.bytes, mtimeMs: file.mtimeMs };
        state.files[file.name] = entry;
        await save(statePath, state);
      }
      if (entry.id && !entry.session) {
        const remote = await service.drive.files.get({
          fileId: entry.id,
          fields: "id,size,md5Checksum,trashed",
        });
        if (!remote.data.trashed && Number(remote.data.size) === entry.bytes && remote.data.md5Checksum === entry.md5) {
          unchanged++;
          continue;
        }
        throw new Error(`Training backup changed remotely: ${file.name}`);
      }
      let parent = state.folderId;
      const parts = file.name.split("/");
      for (const part of parts.slice(0, -1)) parent = await folder(parent, part);
      if (!entry.session) {
        const h = await headers();
        h.set("Content-Type", "application/json; charset=UTF-8");
        h.set("X-Upload-Content-Type", "application/octet-stream");
        h.set("X-Upload-Content-Length", String(entry.bytes));
        const response = await fetch(
          "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size,md5Checksum",
          {
            method: "POST",
            headers: h,
            body: JSON.stringify({
              name: parts.at(-1),
              parents: [parent],
              appProperties: { aphrody_sha256: entry.sha256 },
            }),
          },
        );
        if (!response.ok || !response.headers.get("location"))
          throw new Error(`Training resumable initialization failed (${response.status})`);
        entry.session = response.headers.get("location")!;
        await save(statePath, state);
      }
      const sessionUrl = new URL(entry.session);
      if (sessionUrl.origin !== "https://www.googleapis.com") throw new Error("Invalid training upload session origin");
      const h = await headers();
      h.set("Content-Length", "0");
      h.set("Content-Range", `bytes */${entry.bytes}`);
      let response = await fetch(entry.session, {
        method: "PUT",
        headers: h,
        body: new Uint8Array(),
        redirect: "manual",
      });
      if (response.status === 404 || response.status === 410) {
        delete entry.session;
        await save(statePath, state);
        throw new Error("Training upload session expired; next sync recreates it");
      }
      let offset = response.status === 308 ? resumeOffset(response.headers.get("range"), entry.bytes) : entry.bytes;
      const handle = await open(file.path, "r");
      try {
        while (offset < entry.bytes) {
          const chunk = Buffer.alloc(Math.min(CHUNK, entry.bytes - offset));
          const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
          if (bytesRead !== chunk.length) throw new Error("Training artifact changed during upload");
          const headersChunk = await headers();
          headersChunk.set("Content-Type", "application/octet-stream");
          headersChunk.set("Content-Length", String(chunk.length));
          headersChunk.set("Content-Range", `bytes ${offset}-${offset + chunk.length - 1}/${entry.bytes}`);
          response = await fetch(entry.session, {
            method: "PUT",
            headers: headersChunk,
            body: chunk,
            redirect: "manual",
          });
          if (response.status === 308) {
            const next = resumeOffset(response.headers.get("range"), entry.bytes);
            if (next <= offset) throw new Error("Training upload made no progress");
            offset = next;
          } else if (response.ok) offset = entry.bytes;
          else throw new Error(`Training upload failed (${response.status}); private session retained for resume`);
        }
      } finally {
        await handle.close();
      }
      if (!response.ok) throw new Error(`Training upload completion failed (${response.status})`);
      const completed = (await response.json()) as { id?: string };
      if (!completed.id) throw new Error("Training upload has no completed file id");
      const remote = await service.drive.files.get({
        fileId: completed.id,
        fields: "id,size,md5Checksum",
      });
      if (Number(remote.data.size) !== entry.bytes || remote.data.md5Checksum !== entry.md5)
        throw new Error("Training backup checksum/size mismatch");
      const after = await stat(file.path);
      if (after.size !== file.bytes || after.mtimeMs !== file.mtimeMs)
        throw new Error("Training source changed during upload");
      entry.id = completed.id;
      delete entry.session;
      await save(statePath, state);
      uploaded++;
      console.log(
        JSON.stringify({
          artifact: file.name,
          bytes: entry.bytes,
          sha256: entry.sha256,
          verified: true,
        }),
      );
    }
    console.log(
      JSON.stringify({
        trainedArtifacts: files.length,
        uploaded,
        unchanged,
        bytes: files.reduce((sum, file) => sum + file.bytes, 0),
        verified: true,
      }),
    );
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
if (import.meta.main) {
  try {
    await syncTrainedArtifacts();
  } catch {
    console.error(
      "Training artifact sync failed; inspect private state and retry. No credentials or resumable URLs are logged.",
    );
    process.exitCode = 1;
  }
}
