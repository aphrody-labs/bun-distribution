// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { chmod, mkdir, readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { docs_v1, drive_v3 } from "googleapis";
import { googleApi } from "./api.ts";

export const AGENT_HOME_DEFAULT_DOCS = [
  "AGENTS.md", "BOOT.md", "HEARTBEAT.md", "IDENTITY.md", "SOUL.md", "TOOLS.md", "USER.md",
] as const;
const DEFAULT_DOCS = new Set<string>(AGENT_HOME_DEFAULT_DOCS);
const DOC_MIME = "application/vnd.google-apps.document";
type RemoteDoc = { id: string; name: string; modifiedTime: string };
type Entry = { id: string; mimeType: string; localHash: string; remoteModifiedTime: string };
type State = { version: 1; rootFolderId: string; files: Record<string, Entry>; indexHash?: string };
type Service = { drive: drive_v3.Drive; docs: docs_v1.Docs };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required in Aphrody .env`);
  return value;
}

function digest(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

async function hashFile(path: string): Promise<string> {
  return digest(new Uint8Array(await Bun.file(path).arrayBuffer()));
}

async function localDocs(root: string): Promise<Set<string>> {
  const names = new Set<string>();
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (!DEFAULT_DOCS.has(item.name)) continue;
    if (!item.isFile()) throw new Error(`Agent Home default must be a regular file: ${item.name}`);
    names.add(item.name);
  }
  return names;
}

async function driveDocs(drive: drive_v3.Drive, rootId: string): Promise<Map<string, RemoteDoc>> {
  const docs = new Map<string, RemoteDoc>();
  let pageToken: string | undefined;
  do {
    const page = await drive.files.list({
      q: `'${rootId}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime)",
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const file of page.data.files ?? []) {
      if (!file.name || !DEFAULT_DOCS.has(file.name)) continue;
      if (!file.id || file.mimeType !== DOC_MIME) throw new Error(`Expected a native Google Doc: ${file.name}`);
      if (docs.has(file.name)) throw new Error(`Duplicate Google Doc in Agent Home folder: ${file.name}`);
      docs.set(file.name, { id: file.id, name: file.name, modifiedTime: file.modifiedTime ?? "" });
    }
    pageToken = page.data.nextPageToken ?? undefined;
  } while (pageToken);
  return docs;
}

async function readDoc(drive: drive_v3.Drive, id: string): Promise<Uint8Array> {
  const result = await drive.files.export({ fileId: id, mimeType: "text/plain" }, { responseType: "arraybuffer" });
  return new Uint8Array(result.data as ArrayBuffer);
}

async function writeDoc(docs: docs_v1.Docs, id: string, text: string): Promise<void> {
  const current = await docs.documents.get({ documentId: id, includeTabsContent: false });
  const end = current.data.body?.content?.at(-1)?.endIndex ?? 1;
  const requests: docs_v1.Schema$Request[] = [];
  if (end > 2) requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: end - 1 } } });
  if (text) requests.push({ insertText: { location: { index: 1 }, text } });
  if (requests.length) await docs.documents.batchUpdate({ documentId: id, requestBody: { requests } });
}

async function refreshMetadata(drive: drive_v3.Drive, id: string): Promise<RemoteDoc> {
  const response = await drive.files.get({ fileId: id, fields: "id,name,modifiedTime", supportsAllDrives: true });
  return { id, name: response.data.name ?? "", modifiedTime: response.data.modifiedTime ?? "" };
}

async function createDoc(service: Service, parent: string, name: string, path: string): Promise<RemoteDoc> {
  const response = await service.drive.files.create({
    requestBody: { name, mimeType: DOC_MIME, parents: [parent] },
    fields: "id",
    supportsAllDrives: true,
  });
  const id = response.data.id;
  if (!id) throw new Error(`Google Drive did not return a document ID for ${name}`);
  await writeDoc(service.docs, id, await Bun.file(path).text());
  return refreshMetadata(service.drive, id);
}

async function saveLocal(path: string, data: Uint8Array): Promise<void> {
  const temp = `${path}.${process.pid}.aphrody-tmp`;
  await Bun.write(temp, data, { mode: 0o600 });
  await rename(temp, path);
}

async function saveState(path: string, state: State): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  await Bun.write(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, path);
}

async function runSync(dryRun: boolean): Promise<void> {
  const root = resolve(required("APHRODY_AGENT_HOME"));
  const rootFolderId = required("APHRODY_GOOGLE_DRIVE_FOLDER_ID");
  const statePath = join(homedir(), ".aphrody/drive-sync/dbfr-google-api.json");
  const state: State = await Bun.file(statePath).exists()
    ? await Bun.file(statePath).json() as State
    : { version: 1, rootFolderId, files: {} };
  if (state.version !== 1 || state.rootFolderId !== rootFolderId) throw new Error("Drive state does not match the configured folder/version");
  const stale = Object.keys(state.files).filter((name) => !DEFAULT_DOCS.has(name));
  if (stale.length) throw new Error(`Drive state still contains ${stale.length} out-of-scope files`);
  const service = await googleApi();
  const local = await localDocs(root);
  const remote = await driveDocs(service.drive, rootFolderId);
  const summary = { created: 0, uploaded: 0, downloaded: 0, unchanged: 0 };

  for (const name of AGENT_HOME_DEFAULT_DOCS) {
    const path = join(root, name);
    const hasLocal = local.has(name);
    let doc = remote.get(name);
    const previous = state.files[name];
    if (!hasLocal && !doc) throw new Error(`Required Agent Home document is missing on both sides: ${name}`);
    if (hasLocal && !doc) {
      if (!dryRun) {
        doc = await createDoc(service, rootFolderId, name, path);
        state.files[name] = { id: doc.id, mimeType: DOC_MIME, localHash: await hashFile(path), remoteModifiedTime: doc.modifiedTime };
        await saveState(statePath, state);
      }
      summary.created++;
      continue;
    }
    if (!hasLocal && doc) {
      if (!dryRun) {
        const bytes = await readDoc(service.drive, doc.id);
        await saveLocal(path, bytes);
        state.files[name] = { id: doc.id, mimeType: DOC_MIME, localHash: digest(bytes), remoteModifiedTime: doc.modifiedTime };
        await saveState(statePath, state);
      }
      summary.downloaded++;
      continue;
    }
    const hash = await hashFile(path);
    if (!previous) {
      const remoteBytes = await readDoc(service.drive, doc!.id);
      if (digest(remoteBytes) !== hash) throw new Error(`Initial Agent Home conflict for ${name}`);
      if (!dryRun) {
        state.files[name] = { id: doc!.id, mimeType: DOC_MIME, localHash: hash, remoteModifiedTime: doc!.modifiedTime };
        await saveState(statePath, state);
      }
      summary.unchanged++;
      continue;
    }
    const localChanged = hash !== previous.localHash;
    const remoteChanged = doc!.id !== previous.id || doc!.modifiedTime !== previous.remoteModifiedTime;
    if (localChanged && remoteChanged) throw new Error(`Concurrent Agent Home edits for ${name}; resolve both versions`);
    if (localChanged) {
      if (!dryRun) {
        await writeDoc(service.docs, doc!.id, await Bun.file(path).text());
        doc = await refreshMetadata(service.drive, doc!.id);
        state.files[name] = { id: doc.id, mimeType: DOC_MIME, localHash: hash, remoteModifiedTime: doc.modifiedTime };
        await saveState(statePath, state);
      }
      summary.uploaded++;
    } else if (remoteChanged) {
      if (!dryRun) {
        const bytes = await readDoc(service.drive, doc!.id);
        await saveLocal(path, bytes);
        state.files[name] = { id: doc!.id, mimeType: DOC_MIME, localHash: digest(bytes), remoteModifiedTime: doc!.modifiedTime };
        await saveState(statePath, state);
      }
      summary.downloaded++;
    } else summary.unchanged++;
  }

  if (!dryRun) {
    const index = `# Shenron Agent Home\n\n${AGENT_HOME_DEFAULT_DOCS.map((name) => `${name} — https://docs.google.com/document/d/${state.files[name]!.id}/edit`).join("\n")}\n`;
    const indexHash = digest(new TextEncoder().encode(index));
    if (state.indexHash !== indexHash) {
      await writeDoc(service.docs, required("APHRODY_GOOGLE_DOC_INDEX_ID"), index);
      state.indexHash = indexHash;
      await saveState(statePath, state);
    }
  }
  console.log(JSON.stringify({ root, driveFolderId: rootFolderId, scope: AGENT_HOME_DEFAULT_DOCS, ...summary }, null, 2));
}

export async function syncAgentHome(options: { dryRun?: boolean } = {}): Promise<void> {
  const lock = join(homedir(), ".aphrody/drive-sync/dbfr-google-api.lock");
  await mkdir(dirname(lock), { recursive: true, mode: 0o700 });
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pidFile = Bun.file(join(lock, "pid"));
    const pid = await pidFile.exists() ? Number(await pidFile.text()) : 0;
    if (pid > 1) {
      try {
        process.kill(pid, 0);
        throw new Error(`Google Drive sync is already running (pid ${pid})`);
      } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe;
      }
    }
    await rm(lock, { recursive: true, force: true });
    await mkdir(lock, { mode: 0o700 });
  }
  await Bun.write(join(lock, "pid"), `${process.pid}\n`, { mode: 0o600 });
  try {
    await runSync(Boolean(options.dryRun));
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
