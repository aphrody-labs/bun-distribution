// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- Conditional revisions, filesystem confinement and durable checkpoints execute in dependency order. */
// Private, bounded application of the native Google owner's reviewed seven-document plan.
import { chmod, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import syncContract from "./sync-contract.json";

export const NAMES: readonly string[] = syncContract;
const MAX_BYTES = 4 * 1024 * 1024;
type Obj = Record<string, unknown>;
type Request =
  | { insertText: { location: { index: number; tabId: string }; text: string } }
  | { deleteContentRange: { range: { startIndex: number; endIndex: number; tabId: string } } };
type Entry = {
  name: string;
  id: string;
  localBeforeSha256: string;
  remoteRevisionId: string;
  remoteBeforeSha256: string;
  proposedLocalFile: string;
  explanationFile: string;
  requests: Request[];
};
type Plan = { version: number; folderId: string; files: Entry[] };
export type Paths = {
  home: string;
  state: string;
  stage: string;
  plan: string;
  journalRoot: string;
  lock: string;
  folder: string;
};
export type Api = {
  drive: { files: { get(p: Obj): Promise<{ data: unknown }> } };
  docs: {
    documents: { get(p: Obj): Promise<{ data: unknown }>; batchUpdate(p: Obj): Promise<unknown> };
  };
};
export type Owner = {
  googleApi(identity: "service-account"): Promise<Api>;
  nativeMarkdown(document: unknown): string;
  projectionMarkdown(document: unknown, local: string): string;
  normalizeMarkdown(markdown: string): string;
};
type Cell = { unit: string; style: string | null };
type Paragraph = { metadata: Obj; cells: Cell[] };
type Model = { document: Obj; envelope: string; tabId: string; paragraphs: Paragraph[] };
type Prepared = {
  entry: Entry;
  before: Obj;
  model: Model;
  expected: Model;
  local: Uint8Array;
  proposed: Uint8Array;
  localText: string;
  proposedSha: string;
};
type Review = { plan: Plan; planSha: string; prepared: Prepared[]; metadata: Obj };
const decoder = new TextDecoder("utf-8", { fatal: true });

export class ReviewError extends Error {
  constructor(
    readonly code: string,
    readonly noWrites?: boolean,
    readonly journalCreated?: boolean,
  ) {
    super(code);
  }
}
const fail = (code: string): never => {
  throw new ReviewError(code);
};
export const sha = (bytes: string | Uint8Array): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
function obj(value: unknown): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("INVALID_OBJECT");
  return value as Obj;
}
function keys(value: Obj, allowed: string[], required: string[] = []): void {
  if (Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !(k in value))) fail("UNSUPPORTED_KEYS");
}
function str(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > MAX_BYTES) return fail("INVALID_STRING");
  return value;
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 2147483647) return fail("INVALID_INDEX");
  return Number(value);
}
function sorted(v: unknown): unknown {
  return Array.isArray(v)
    ? v.map(sorted)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, sorted(x)]),
        )
      : v;
}
function canonical(value: unknown): string {
  return JSON.stringify(sorted(value));
}
function clone<T>(value: T): T {
  return structuredClone(value);
}
function utf8(bytes: Uint8Array): string {
  try {
    return decoder.decode(bytes);
  } catch {
    return fail("INVALID_UTF8");
  }
}
function inside(root: string, path: string): boolean {
  const r = relative(resolve(root), path);
  return isAbsolute(path) && !!r && r !== ".." && !r.startsWith("../") && !isAbsolute(r) && resolve(path) === path;
}
async function safeFile(path: string, privateRoot?: string): Promise<Uint8Array> {
  if (!isAbsolute(path) || resolve(path) !== path || (privateRoot && !inside(privateRoot, path))) fail("UNSAFE_PATH");
  const parts = path.split("/").filter(Boolean);
  let current = "/";
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]!);
    const s = await lstat(current);
    if (s.isSymbolicLink() || (i < parts.length - 1 && !s.isDirectory())) fail("UNSAFE_PATH");
    if (
      privateRoot &&
      (current === privateRoot || inside(privateRoot, current)) &&
      ((s.mode & 0o077) !== 0 || s.uid !== process.getuid?.())
    )
      fail("NON_PRIVATE_PATH");
    if (
      i === parts.length - 1 &&
      (!s.isFile() || s.nlink !== 1 || s.size > MAX_BYTES || (s.mode & 0o077) !== 0 || s.uid !== process.getuid?.())
    )
      fail("NON_PRIVATE_FILE");
  }
  const handle = await open(path, "r");
  try {
    const s = await handle.stat();
    const now = await lstat(path);
    if (s.ino !== now.ino || s.dev !== now.dev || !s.isFile() || s.nlink !== 1 || s.size > MAX_BYTES)
      fail("FILE_CHANGED");
    return new Uint8Array(await handle.readFile());
  } finally {
    await handle.close();
  }
}
async function privateDirectory(path: string): Promise<void> {
  if (!isAbsolute(path) || resolve(path) !== path) fail("UNSAFE_DIRECTORY");
  let cursor = "/";
  for (const segment of path.split("/").filter(Boolean)) {
    cursor = join(cursor, segment);
    try {
      await mkdir(cursor, { mode: 0o700 });
    } catch (error) {
      if (obj(error).code !== "EEXIST") throw error;
    }
    const part = await lstat(cursor);
    if (!part.isDirectory() || part.isSymbolicLink()) fail("UNSAFE_DIRECTORY");
  }
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid?.()) fail("UNSAFE_DIRECTORY");
  await chmod(path, 0o700);
}
async function atomic(path: string, bytes: string | Uint8Array, beforeHash?: string): Promise<void> {
  await privateDirectory(dirname(path));
  try {
    await lstat(path);
    await safeFile(path);
  } catch (error) {
    if (obj(error).code !== "ENOENT") throw error;
  }
  if (beforeHash && sha(await safeFile(path)) !== beforeHash) fail("LOCAL_CHANGED");
  const temp = path + "." + crypto.randomUUID() + ".tmp";
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (beforeHash && sha(await safeFile(path)) !== beforeHash) fail("LOCAL_CHANGED");
    await rename(temp, path);
    await chmod(path, 0o600);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await rm(temp, { force: true });
  }
}

export function parsePlan(value: unknown, paths: Paths): Plan {
  const p = obj(value);
  keys(
    p,
    ["version", "folderId", "files", "reviewedAt", "mode", "applicationGates", "counts"],
    ["version", "folderId", "files"],
  );
  if (p.version !== 1 || p.folderId !== paths.folder || !Array.isArray(p.files) || p.files.length !== NAMES.length)
    fail("PLAN_SCOPE");
  const names = new Set<string>();
  const ids = new Set<string>();
  const files = (p.files as unknown[]).map(fileValue => {
    const f = obj(fileValue);
    keys(
      f,
      [
        "name",
        "id",
        "localBeforeSha256",
        "remoteRevisionId",
        "remoteBeforeSha256",
        "proposedLocalFile",
        "requests",
        "explanationFile",
        "writeControl",
      ],
      [
        "name",
        "id",
        "localBeforeSha256",
        "remoteRevisionId",
        "remoteBeforeSha256",
        "proposedLocalFile",
        "requests",
        "explanationFile",
      ],
    );
    const name = str(f.name),
      id = str(f.id),
      revision = str(f.remoteRevisionId);
    if (
      !(NAMES as readonly string[]).includes(name) ||
      names.has(name) ||
      ids.has(id) ||
      !/^[\w-]{5,200}$/.test(id) ||
      revision.length > 2048 ||
      /[\r\n\0]/.test(revision)
    )
      fail("PLAN_SCOPE");
    names.add(name);
    ids.add(id);
    const localHash = str(f.localBeforeSha256),
      remoteHash = str(f.remoteBeforeSha256);
    if (![localHash, remoteHash].every(s => /^[a-f0-9]{64}$/.test(s))) fail("INVALID_HASH");
    const proposed = str(f.proposedLocalFile),
      explanation = str(f.explanationFile);
    if (!inside(paths.stage, proposed) || !inside(paths.stage, explanation) || proposed === explanation)
      fail("UNSAFE_PROPOSAL_PATH");
    if (f.writeControl !== undefined) {
      const control = obj(f.writeControl);
      keys(control, ["requiredRevisionId"], ["requiredRevisionId"]);
      if (control.requiredRevisionId !== revision) fail("REVISION_CONTROL");
    }
    if (!Array.isArray(f.requests) || f.requests.length > 1000) fail("REQUEST_COUNT");
    return {
      name,
      id,
      localBeforeSha256: localHash,
      remoteBeforeSha256: remoteHash,
      remoteRevisionId: revision,
      proposedLocalFile: proposed,
      explanationFile: explanation,
      requests: f.requests as Request[],
    };
  });
  return { version: 1, folderId: paths.folder, files };
}

function body(document: Obj): Obj {
  if (!Array.isArray(document.tabs) || document.tabs.length !== 1) return fail("UNSUPPORTED_TABS");
  const tab = obj(document.tabs[0]);
  if (tab.childTabs && (!Array.isArray(tab.childTabs) || tab.childTabs.length)) fail("UNSUPPORTED_TABS");
  const tabBody = obj(obj(tab.documentTab).body);
  if (document.body) fail("AMBIGUOUS_BODY");
  return tabBody;
}
export function modelDocument(value: unknown): Model {
  const document = clone(obj(value));
  const nativeBody = body(document);
  const tab = obj((document.tabs as unknown[])[0]);
  const tabId = str(obj(tab.tabProperties).tabId);
  if (!Array.isArray(nativeBody.content) || nativeBody.content.length < 2) fail("UNSUPPORTED_BODY");
  const content = nativeBody.content as unknown[];
  const first = obj(content[0]);
  keys(first, ["startIndex", "endIndex", "sectionBreak"], ["endIndex", "sectionBreak"]);
  if ((first.startIndex ?? 0) !== 0 || first.endIndex !== 1) fail("UNSUPPORTED_SECTION");
  let cursor = 1;
  const paragraphs = content.slice(1).map(paragraphValue => {
    const item = obj(paragraphValue);
    keys(item, ["startIndex", "endIndex", "paragraph"], ["startIndex", "endIndex", "paragraph"]);
    if (integer(item.startIndex) !== cursor) fail("NONCONTIGUOUS_BODY");
    const p = obj(item.paragraph);
    keys(p, ["elements", "paragraphStyle"], ["elements"]);
    if (!Array.isArray(p.elements) || !p.elements.length) fail("UNSUPPORTED_PARAGRAPH");
    const metadata = clone(p);
    delete metadata.elements;
    const cells: Cell[] = [];
    for (const raw of p.elements as unknown[]) {
      const e = obj(raw);
      keys(e, ["startIndex", "endIndex", "textRun"], ["startIndex", "endIndex", "textRun"]);
      const run = obj(e.textRun);
      keys(run, ["content", "textStyle"], ["content"]);
      const text = str(run.content);
      if (integer(e.startIndex) !== cursor || integer(e.endIndex) !== cursor + text.length) fail("NONCONTIGUOUS_RUN");
      const style = canonical(run.textStyle ?? {});
      for (let i = 0; i < text.length; i++) cells.push({ unit: text[i]!, style });
      cursor += text.length;
    }
    if (
      integer(item.endIndex) !== cursor ||
      cells.at(-1)?.unit !== "\n" ||
      cells.slice(0, -1).some(c => c.unit === "\n")
    )
      fail("UNSUPPORTED_PARAGRAPH");
    return { metadata, cells };
  });
  const envelope = clone(document);
  delete envelope.revisionId;
  obj(body(envelope)).content = "BODY_VALIDATED_SEPARATELY";
  return { document, envelope: canonical(envelope), tabId, paragraphs };
}
function boundary(cells: Cell[], index: number): void {
  const previous = cells[index - 1]?.unit.charCodeAt(0),
    next = cells[index]?.unit.charCodeAt(0);
  if (
    previous !== undefined &&
    next !== undefined &&
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    next >= 0xdc00 &&
    next <= 0xdfff
  )
    fail("SURROGATE_BOUNDARY");
}
function locate(model: Model, index: number): { paragraph: Paragraph; offset: number; position: number } {
  let cursor = 1;
  for (let i = 0; i < model.paragraphs.length; i++) {
    const paragraph = model.paragraphs[i]!;
    if (index >= cursor && index < cursor + paragraph.cells.length)
      return { paragraph, offset: index - cursor, position: i };
    cursor += paragraph.cells.length;
  }
  return fail("OUT_OF_BODY_INDEX");
}
export function simulate(before: Model, requests: Request[]): Model {
  const expected = clone(before);
  for (const request of requests) {
    const r = obj(request);
    keys(r, ["insertText", "deleteContentRange"]);
    if (Object.keys(r).length !== 1) fail("REQUEST_CLASS");
    if (r.insertText) {
      const insert = obj(r.insertText);
      keys(insert, ["text", "location"], ["text", "location"]);
      const location = obj(insert.location);
      keys(location, ["index", "tabId"], ["index", "tabId"]);
      if (location.tabId !== expected.tabId) fail("WRONG_TAB");
      const text = str(insert.text);
      if (
        [...text].some(c => {
          const n = c.charCodeAt(0);
          return n <= 8 || (n >= 12 && n <= 31) || n === 11 || (n >= 0xe000 && n <= 0xf8ff);
        }) ||
        !text.isWellFormed()
      )
        fail("UNSUPPORTED_INSERT_TEXT");
      const { paragraph, offset, position } = locate(expected, integer(location.index));
      boundary(paragraph.cells, offset);
      if (text.includes("\n")) {
        if (
          position !== expected.paragraphs.length - 1 ||
          paragraph.cells.map(c => c.unit).join("") !== "\n" ||
          offset !== 0
        )
          fail("NON_APPEND_PARAGRAPH_INSERT");
        const pieces = text.split("\n");
        const created = pieces.map((piece, i) => ({
          metadata: clone(paragraph.metadata),
          cells: [
            ...piece.split("").map(unit => ({ unit, style: null })),
            ...(i === pieces.length - 1 ? paragraph.cells : [{ unit: "\n", style: null }]),
          ],
        }));
        expected.paragraphs.splice(position, 1, ...created);
      } else paragraph.cells.splice(offset, 0, ...text.split("").map(unit => ({ unit, style: null })));
    } else if (r.deleteContentRange) {
      const deletion = obj(r.deleteContentRange);
      keys(deletion, ["range"], ["range"]);
      const range = obj(deletion.range);
      keys(range, ["startIndex", "endIndex", "tabId"], ["startIndex", "endIndex", "tabId"]);
      if (range.tabId !== expected.tabId) fail("WRONG_TAB");
      const start = integer(range.startIndex),
        end = integer(range.endIndex);
      if (end <= start) fail("EMPTY_DELETE");
      const { paragraph, offset } = locate(expected, start);
      boundary(paragraph.cells, offset);
      boundary(paragraph.cells, offset + end - start);
      if (
        offset + end - start >= paragraph.cells.length ||
        paragraph.cells.slice(offset, offset + end - start).some(c => c.unit === "\n")
      )
        fail("CROSS_PARAGRAPH_DELETE");
      paragraph.cells.splice(offset, end - start);
    } else fail("REQUEST_CLASS");
  }
  return expected;
}
export function renderedModel(model: Model): Obj {
  const d = clone(model.document);
  const b = body(d);
  let cursor = 1;
  const section = clone((b.content as unknown[])[0]);
  b.content = [
    section,
    ...model.paragraphs.map(p => {
      const startIndex = cursor;
      const elements: Obj[] = [];
      for (const c of p.cells) {
        const last = elements.at(-1);
        const style = c.style ?? "{}";
        if (last && canonical(obj(last.textRun).textStyle) === style) {
          obj(last.textRun).content = String(obj(last.textRun).content) + c.unit;
          last.endIndex = ++cursor;
        } else
          elements.push({
            startIndex: cursor,
            endIndex: ++cursor,
            textRun: { content: c.unit, textStyle: JSON.parse(style) },
          });
      }
      return { startIndex, endIndex: cursor, paragraph: { ...clone(p.metadata), elements } };
    }),
  ];
  return d;
}
export function verifyAfter(expected: Model, after: unknown): void {
  const actual = modelDocument(after);
  if (
    expected.envelope !== actual.envelope ||
    expected.tabId !== actual.tabId ||
    expected.paragraphs.length !== actual.paragraphs.length
  )
    fail("TOPOLOGY_CHANGED");
  for (let i = 0; i < expected.paragraphs.length; i++) {
    const e = expected.paragraphs[i]!,
      a = actual.paragraphs[i]!;
    if (canonical(e.metadata) !== canonical(a.metadata) || e.cells.length !== a.cells.length) fail("PARAGRAPH_CHANGED");
    for (let j = 0; j < e.cells.length; j++)
      if (
        e.cells[j]!.unit !== a.cells[j]!.unit ||
        (e.cells[j]!.style !== null && e.cells[j]!.style !== a.cells[j]!.style)
      )
        fail("UNTOUCHED_TEXT_CHANGED");
  }
}
export function verifyPlainProposal(model: Model, proposed: string): void {
  // These reviewed documents store literal Markdown in NORMAL_TEXT paragraphs.
  // Preserve every interior byte, including fenced code and hard line breaks.
  for (const p of model.paragraphs) {
    const style = obj(p.metadata.paragraphStyle ?? {});
    if (style.namedStyleType !== "NORMAL_TEXT" || p.cells.some(c => c.style !== null && c.style !== "{}"))
      fail("UNSUPPORTED_PATCH_DOCUMENT");
  }
  const plain = model.paragraphs.flatMap(p => p.cells.map(c => c.unit)).join("");
  if (plain.replace(/\n+$/, "") !== proposed.replace(/\n+$/, "")) fail("PROPOSAL_REQUEST_MISMATCH");
}
async function checkScope(api: Api, entry: Entry, paths: Paths): Promise<void> {
  const meta = obj(
    (
      await api.drive.files.get({
        fileId: entry.id,
        fields: "id,name,mimeType,parents,trashed",
        supportsAllDrives: true,
      })
    ).data,
  );
  if (
    meta.id !== entry.id ||
    meta.name !== entry.name ||
    meta.mimeType !== "application/vnd.google-apps.document" ||
    meta.trashed ||
    !Array.isArray(meta.parents) ||
    meta.parents.length !== 1 ||
    meta.parents[0] !== paths.folder
  )
    fail("REMOTE_SCOPE_CHANGED");
}
async function checkedCurrent(api: Api, entry: Entry, paths: Paths): Promise<Obj> {
  await checkScope(api, entry, paths);
  const d = obj((await api.docs.documents.get({ documentId: entry.id, includeTabsContent: true })).data);
  if (
    d.documentId !== entry.id ||
    d.revisionId !== entry.remoteRevisionId ||
    sha(JSON.stringify(d)) !== entry.remoteBeforeSha256
  )
    fail("REMOTE_CHANGED");
  return d;
}

export type RevisionBinding = {
  inputManifestPath: string;
  expectedInputHash: string;
  originalPlanPath: string;
  originalPlanSha: string;
};
function withoutPlanRevisions(value: Obj): Obj {
  const p = clone(value);
  for (const raw of p.files as unknown[]) {
    const f = obj(raw);
    delete f.remoteRevisionId;
    delete f.remoteBeforeSha256;
    if (f.writeControl !== undefined) delete obj(f.writeControl).requiredRevisionId;
  }
  return p;
}
function withoutNativeRevision(value: Obj): Obj {
  const d = clone(value);
  delete d.revisionId;
  return d;
}
export async function refreshRevisions(
  api: Api,
  owner: Owner,
  paths: Paths,
  binding: RevisionBinding,
): Promise<{ planSha: string; refreshed: number }> {
  if (
    ![binding.expectedInputHash, binding.originalPlanSha].every(h => /^[a-f0-9]{64}$/.test(h)) ||
    dirname(binding.inputManifestPath) !== dirname(paths.plan) ||
    dirname(binding.originalPlanPath) !== dirname(paths.plan) ||
    binding.originalPlanPath === paths.plan ||
    binding.inputManifestPath === paths.plan
  )
    fail("REVISION_BINDING_SCOPE");
  const manifestBytes = await safeFile(binding.inputManifestPath),
    manifest = obj(JSON.parse(utf8(manifestBytes)));
  keys(
    manifest,
    ["version", "folderId", "profile", "ownerSha256", "validatorSha256", "files"],
    ["version", "folderId", "profile", "ownerSha256", "validatorSha256", "files"],
  );
  if (
    manifest.version !== 1 ||
    manifest.profile !== "dbfr" ||
    manifest.folderId !== paths.folder ||
    sha(JSON.stringify(manifest)) !== binding.expectedInputHash ||
    ![manifest.ownerSha256, manifest.validatorSha256].every(h => typeof h === "string" && /^[a-f0-9]{64}$/.test(h)) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== NAMES.length
  )
    fail("FROZEN_MANIFEST_CHANGED");
  const originalBytes = await safeFile(binding.originalPlanPath);
  if (sha(originalBytes) !== binding.originalPlanSha) fail("ORIGINAL_PLAN_CHANGED");
  const originalValue = obj(JSON.parse(utf8(originalBytes))),
    original = parsePlan(originalValue, paths);
  const currentBytes = await safeFile(paths.plan),
    currentValue = obj(JSON.parse(utf8(currentBytes))),
    plan = parsePlan(currentValue, paths);
  if (canonical(withoutPlanRevisions(originalValue)) !== canonical(withoutPlanRevisions(currentValue)))
    fail("REVIEWED_PLAN_CHANGED");
  const inputDirectory = join(dirname(binding.inputManifestPath), "inputs");
  const seen = new Set<string>(),
    snapshots: { name: string; current: Obj; input: Obj }[] = [];
  let refreshed = 0;
  for (const raw of manifest.files as unknown[]) {
    const input = obj(raw);
    keys(
      input,
      [
        "name",
        "id",
        "localBeforeSha256",
        "remoteRevisionId",
        "remoteBeforeSha256",
        "remoteMarkdownSha256",
        "baselineLocalSha256",
        "baselineRemoteSha256",
        "baselineNativeSha256",
      ],
      [
        "name",
        "id",
        "localBeforeSha256",
        "remoteRevisionId",
        "remoteBeforeSha256",
        "remoteMarkdownSha256",
        "baselineLocalSha256",
        "baselineRemoteSha256",
        "baselineNativeSha256",
      ],
    );
    const name = str(input.name);
    if (
      !NAMES.includes(name) ||
      seen.has(name) ||
      !Object.entries(input)
        .filter(([k]) => k.endsWith("Sha256"))
        .every(([, h]) => typeof h === "string" && /^[a-f0-9]{64}$/.test(h))
    )
      fail("FROZEN_MANIFEST_SCOPE");
    seen.add(name);
    const originalEntry = original.files.find(f => f.name === name) ?? fail("ORIGINAL_INPUT_BINDING"),
      entry = plan.files.find(f => f.name === name) ?? fail("ORIGINAL_INPUT_BINDING");
    if (
      !originalEntry ||
      !entry ||
      originalEntry.id !== input.id ||
      originalEntry.localBeforeSha256 !== input.localBeforeSha256 ||
      originalEntry.remoteBeforeSha256 !== input.remoteBeforeSha256 ||
      originalEntry.remoteRevisionId !== input.remoteRevisionId
    )
      fail("ORIGINAL_INPUT_BINDING");
    for (const [suffix, expected] of [
      ["local.md", input.localBeforeSha256],
      ["native.json", input.remoteBeforeSha256],
      ["baseline.md", input.baselineLocalSha256],
      ["baseline.native.json", input.baselineNativeSha256],
    ] as const)
      if (sha(await safeFile(join(inputDirectory, name + "." + suffix), inputDirectory)) !== expected)
        fail("FROZEN_SNAPSHOT_CHANGED");
    const frozen = obj(JSON.parse(utf8(await safeFile(join(inputDirectory, name + ".native.json"), inputDirectory))));
    if (
      frozen.documentId !== input.id ||
      frozen.revisionId !== input.remoteRevisionId ||
      sha(JSON.stringify(frozen)) !== input.remoteBeforeSha256 ||
      sha(owner.nativeMarkdown(frozen)) !== input.remoteMarkdownSha256 ||
      sha(await safeFile(join(paths.home, name))) !== input.localBeforeSha256
    )
      fail("FROZEN_OR_LOCAL_CHANGED");
    await checkScope(api, entry, paths);
    const current = obj((await api.docs.documents.get({ documentId: entry.id, includeTabsContent: true })).data);
    if (
      current.documentId !== entry.id ||
      !current.revisionId ||
      canonical(withoutNativeRevision(current)) !== canonical(withoutNativeRevision(frozen))
    )
      fail("REAL_NATIVE_CHANGE");
    const revision = str(current.revisionId),
      hash = sha(JSON.stringify(current));
    if (entry.remoteRevisionId !== revision || entry.remoteBeforeSha256 !== hash) refreshed++;
    const updated = (currentValue.files as unknown[]).map(obj).find(f => f.name === name)!;
    updated.remoteRevisionId = revision;
    updated.remoteBeforeSha256 = hash;
    if (updated.writeControl !== undefined) obj(updated.writeControl).requiredRevisionId = revision;
    snapshots.push({ name, current, input });
  }
  if (seen.size !== NAMES.length) fail("FROZEN_MANIFEST_SCOPE");
  if (!refreshed) return { planSha: sha(currentBytes), refreshed: 0 };
  // Recheck all local/frozen bindings before publishing one atomic private plan update.
  if (
    sha(await safeFile(binding.inputManifestPath)) !== sha(manifestBytes) ||
    sha(await safeFile(binding.originalPlanPath)) !== binding.originalPlanSha ||
    sha(await safeFile(paths.plan)) !== sha(currentBytes)
  )
    fail("REVISION_BINDING_CHANGED");
  for (const s of snapshots)
    if (
      sha(await safeFile(join(paths.home, s.name))) !== s.input.localBeforeSha256 ||
      sha(await safeFile(join(inputDirectory, s.name + ".native.json"), inputDirectory)) !== s.input.remoteBeforeSha256
    )
      fail("FROZEN_OR_LOCAL_CHANGED");
  const next = JSON.stringify(currentValue, null, 2) + "\n",
    nextHash = sha(next);
  const backup = join(dirname(paths.plan), "revision-refresh", sha(currentBytes) + "-" + nextHash);
  await privateDirectory(backup);
  await atomic(join(backup, "before-plan.json"), currentBytes);
  if (sha(await safeFile(join(backup, "before-plan.json"))) !== sha(currentBytes)) fail("REVISION_BACKUP_CHANGED");
  for (const s of snapshots) {
    const snapshot = JSON.stringify(s.current),
      path = join(backup, s.name + ".fresh.native.json");
    await atomic(path, snapshot);
    if (sha(await safeFile(path)) !== sha(snapshot)) fail("REVISION_BACKUP_CHANGED");
  }
  await atomic(
    join(backup, "receipt.json"),
    JSON.stringify({
      version: 1,
      kind: "revision-only-refresh",
      inputHash: binding.expectedInputHash,
      originalPlanSha: binding.originalPlanSha,
      beforePlanSha: sha(currentBytes),
      planSha: nextHash,
      refreshed,
      documents: NAMES.length,
      googleWrites: 0,
      activeLocalWrites: 0,
    }),
  );
  await atomic(paths.plan, next, sha(currentBytes));
  return { planSha: nextHash, refreshed };
}
export async function preflight(api: Api, owner: Owner, paths: Paths): Promise<Review> {
  const planBytes = await safeFile(paths.plan);
  const plan = parsePlan(JSON.parse(utf8(planBytes)), paths);
  const state = obj(JSON.parse(utf8(await safeFile(paths.state))));
  const stateFiles = obj(state.files);
  const prepared: Prepared[] = [];
  for (const entry of plan.files) {
    if (obj(stateFiles[entry.name]).id !== entry.id) fail("STATE_SCOPE_CHANGED");
    const local = await safeFile(join(paths.home, entry.name));
    if (sha(local) !== entry.localBeforeSha256) fail("LOCAL_CHANGED");
    const proposed = await safeFile(entry.proposedLocalFile, paths.stage);
    await safeFile(entry.explanationFile, paths.stage);
    const before = await checkedCurrent(api, entry, paths);
    const model = modelDocument(before);
    const expected = simulate(model, entry.requests);
    const localText = utf8(local),
      proposedText = utf8(proposed);
    if (entry.requests.length === 0) {
      const previous = obj(stateFiles[entry.name]);
      if (
        sha(local) !== sha(proposed) ||
        previous.localHash !== sha(local) ||
        previous.remoteHash !== sha(owner.nativeMarkdown(before))
      )
        fail("UNCHANGED_BASELINE_MISMATCH");
    } else verifyPlainProposal(expected, proposedText);
    prepared.push({
      entry,
      before,
      model,
      expected,
      local,
      proposed,
      localText,
      proposedSha: sha(proposed),
    });
  }
  const classes = { insertText: 0, deleteContentRange: 0 };
  for (const p of prepared)
    for (const r of p.entry.requests) classes["insertText" in r ? "insertText" : "deleteContentRange"]++;
  return {
    plan,
    planSha: sha(planBytes),
    prepared,
    metadata: {
      names: prepared.map(p => p.entry.name),
      documents: prepared.length,
      changedDocuments: prepared.filter(p => p.entry.requests.length).length,
      localPromotions: prepared.filter(p => sha(p.local) !== p.proposedSha).length,
      requests: classes,
      revisionGuards: prepared.length,
      byteHashGuards: prepared.length * 2,
      proposalHashGuards: prepared.length,
    },
  };
}

export async function apply(api: Api, owner: Owner, paths: Paths): Promise<Obj> {
  try {
    await mkdir(paths.lock, { mode: 0o700 });
  } catch (error) {
    if (obj(error).code === "EEXIST") fail("OWNER_LOCK_BUSY");
    throw error;
  }
  const lockToken = crypto.randomUUID();
  let journal: Obj | undefined;
  let journalPath = "";
  let writerCalled = false;
  const promoted: Prepared[] = [];
  try {
    await atomic(join(paths.lock, "pid"), String(process.pid));
    await atomic(join(paths.lock, "review-owner"), lockToken);
    const inputPlanSha = sha(await safeFile(paths.plan));
    const run = join(paths.journalRoot, inputPlanSha);
    journalPath = join(run, "receipt.json");
    try {
      await lstat(journalPath);
      fail("PLAN_ALREADY_ATTEMPTED");
    } catch (error) {
      if (error instanceof ReviewError || obj(error).code !== "ENOENT") throw error;
    }
    const review = await preflight(api, owner, paths);
    if (review.planSha !== inputPlanSha) fail("PLAN_CHANGED");
    await privateDirectory(run);
    const livePlan = await safeFile(paths.plan);
    if (sha(livePlan) !== review.planSha) fail("PLAN_CHANGED");
    await atomic(join(run, "plan.json"), livePlan);
    if (sha(await safeFile(join(run, "plan.json"))) !== review.planSha) fail("BACKUP_HASH_CHANGED");
    for (const p of review.prepared) {
      await atomic(join(run, p.entry.name + ".before.native.json"), JSON.stringify(p.before));
      await atomic(join(run, p.entry.name + ".before.local.md"), p.local);
      await atomic(join(run, p.entry.name + ".proposal.md"), p.proposed);
      if (
        sha(await safeFile(join(run, p.entry.name + ".before.native.json"))) !== p.entry.remoteBeforeSha256 ||
        sha(await safeFile(join(run, p.entry.name + ".before.local.md"))) !== p.entry.localBeforeSha256 ||
        sha(await safeFile(join(run, p.entry.name + ".proposal.md"))) !== p.proposedSha
      )
        fail("BACKUP_HASH_CHANGED");
    }
    journal = {
      version: 1,
      planSha: review.planSha,
      phase: "prepared",
      metadata: review.metadata,
      remoteVerified: [],
      localPromoted: [],
      failedClass: null,
    };
    const record = async () => {
      await atomic(journalPath, JSON.stringify(journal));
    };
    await record();
    // All seven are checked again together immediately before the first conditional write.
    for (const p of review.prepared) {
      if (
        sha(await safeFile(join(paths.home, p.entry.name))) !== p.entry.localBeforeSha256 ||
        sha(await safeFile(p.entry.proposedLocalFile, paths.stage)) !== p.proposedSha
      )
        fail("LOCAL_OR_PROPOSAL_CHANGED");
      await checkedCurrent(api, p.entry, paths);
    }
    if (sha(await safeFile(paths.plan)) !== review.planSha) fail("PLAN_CHANGED");
    journal.phase = "remote-writing";
    await record();
    const snapshots = join(run, "fresh-native");
    await privateDirectory(snapshots);
    for (const p of review.prepared) {
      if (sha(await safeFile(join(paths.home, p.entry.name))) !== p.entry.localBeforeSha256) fail("LOCAL_CHANGED");
      await checkedCurrent(api, p.entry, paths);
      journal.remoteAttempt = {
        name: p.entry.name,
        requiredRevision: p.entry.remoteRevisionId,
        requests: p.entry.requests.length,
      };
      await record();
      if (p.entry.requests.length) {
        writerCalled = true;
        await api.docs.documents.batchUpdate({
          documentId: p.entry.id,
          requestBody: {
            requests: p.entry.requests,
            writeControl: { requiredRevisionId: p.entry.remoteRevisionId },
          },
        });
      }
      const after = obj((await api.docs.documents.get({ documentId: p.entry.id, includeTabsContent: true })).data);
      if (after.documentId !== p.entry.id) fail("REMOTE_SCOPE_CHANGED");
      await checkScope(api, p.entry, paths);
      verifyAfter(p.expected, after);
      if (p.entry.requests.length) verifyPlainProposal(modelDocument(after), utf8(p.proposed));
      await atomic(join(snapshots, p.entry.name + ".json"), JSON.stringify(after));
      (journal.remoteVerified as unknown[]).push({
        name: p.entry.name,
        sha: sha(JSON.stringify(after)),
        revision: after.revisionId,
        changed: p.entry.requests.length > 0,
      });
      journal.remoteAttempt = null;
      await record();
    }
    // Freeze all final revisions before promoting any local document.
    for (const p of review.prepared) {
      await checkScope(api, p.entry, paths);
      const d = obj((await api.docs.documents.get({ documentId: p.entry.id, includeTabsContent: true })).data);
      const saved = await safeFile(join(snapshots, p.entry.name + ".json"));
      if (sha(JSON.stringify(d)) !== sha(saved)) fail("AFTER_REMOTE_CHANGED");
      if (sha(await safeFile(join(paths.home, p.entry.name))) !== p.entry.localBeforeSha256) fail("LOCAL_CHANGED");
    }
    journal.phase = "local-promoting";
    await record();
    for (const p of review.prepared) {
      if (sha(p.local) !== p.proposedSha) {
        await atomic(join(paths.home, p.entry.name), p.proposed, p.entry.localBeforeSha256);
        promoted.push(p);
      }
      (journal.localPromoted as unknown[]).push({ name: p.entry.name, sha: p.proposedSha });
      await record();
    }
    journal.phase = "complete";
    journal.seedReviewed = snapshots;
    await record();
    return {
      ok: true,
      phase: "complete",
      ...review.metadata,
      planSha: review.planSha,
      seedReviewed: snapshots,
      receipt: journalPath,
    };
  } catch (error) {
    const code = error instanceof ReviewError ? error.code : "OWNER_OPERATION_FAILED";
    const rollback: Obj[] = [];
    for (const p of promoted.toReversed()) {
      try {
        await atomic(join(paths.home, p.entry.name), p.local, p.proposedSha);
        rollback.push({ name: p.entry.name, restored: true });
      } catch {
        rollback.push({ name: p.entry.name, restored: false });
      }
    }
    if (journal) {
      journal.phase = "failed";
      journal.failedClass = code;
      journal.localRollback = rollback;
      try {
        await atomic(journalPath, JSON.stringify(journal));
      } catch {
        /* Preserve the previous durable checkpoint. */
      }
    }
    let absent = false;
    if (journalPath) {
      try {
        await lstat(journalPath);
      } catch (probe) {
        absent = obj(probe).code === "ENOENT";
      }
    }
    throw new ReviewError(
      code,
      !writerCalled && absent ? true : undefined,
      !writerCalled && absent ? false : undefined,
    );
  } finally {
    try {
      if (utf8(await safeFile(join(paths.lock, "review-owner"))) === lockToken)
        await rm(paths.lock, { recursive: true });
    } catch {
      /* Never release another owner's lock. */
    }
  }
}
