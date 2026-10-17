// SPDX-License-Identifier: Apache-2.0
// Durable fsync fixtures permit bounded concurrent host I/O.
/* oxlint-disable no-await-in-loop -- Fixture setup and mutation checks intentionally preserve operation order. */
import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  apply,
  modelDocument,
  NAMES,
  parsePlan,
  preflight,
  refreshRevisions,
  renderedModel,
  sha,
  simulate,
  verifyAfter,
  verifyPlainProposal,
  type Owner,
  type Paths,
} from "../src/drive-reconcile-review.ts";

// The private store relies on POSIX uid, mode bits and a "/" root.
const posixTest = test.skipIf(process.platform === "win32");

type Obj = Record<string, unknown>;
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 20_000);

async function freeze(f: Awaited<ReturnType<typeof fixture>>) {
  const inputDirectory = join(f.root, "inputs");
  await mkdir(inputDirectory, { mode: 0o700 });
  const files = [];
  for (const entry of f.files) {
    const name = String(entry.name),
      native = JSON.stringify(f.docs.get(String(entry.id))),
      local = await readFile(join(f.paths.home, name));
    for (const [suffix, bytes] of [
      ["local.md", local],
      ["native.json", native],
      ["baseline.md", local],
      ["baseline.native.json", native],
    ] as const)
      await writeFile(join(inputDirectory, name + "." + suffix), bytes, { mode: 0o600 });
    files.push({
      name,
      id: entry.id,
      localBeforeSha256: entry.localBeforeSha256,
      remoteRevisionId: entry.remoteRevisionId,
      remoteBeforeSha256: entry.remoteBeforeSha256,
      remoteMarkdownSha256: sha(owner.nativeMarkdown(f.docs.get(String(entry.id)))),
      baselineLocalSha256: sha(local),
      baselineRemoteSha256: sha(owner.nativeMarkdown(f.docs.get(String(entry.id)))),
      baselineNativeSha256: sha(native),
    });
  }
  const manifest = {
    version: 1,
    folderId: f.paths.folder,
    profile: "dbfr",
    ownerSha256: sha("synthetic-owner"),
    validatorSha256: sha("synthetic-validator"),
    files,
  };
  const inputManifestPath = join(f.root, "inputs.json"),
    originalPlanPath = join(f.root, "reviewed-plan.original.json"),
    originalPlan = await readFile(f.paths.plan);
  await writeFile(inputManifestPath, JSON.stringify(manifest), { mode: 0o600 });
  await writeFile(originalPlanPath, originalPlan, { mode: 0o600 });
  return {
    inputManifestPath,
    expectedInputHash: sha(JSON.stringify(manifest)),
    originalPlanPath,
    originalPlanSha: sha(originalPlan),
  };
}

test("contract names come from the owner's seven-document sync contract", () => {
  expect(NAMES).toEqual(["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md", "HEARTBEAT.md", "BOOT.md"]);
}, 20_000);

posixTest(
  "refreshes only opaque revisions with all-seven frozen bindings, backups and no Google writes",
  async () => {
    const f = await fixture(),
      binding = await freeze(f);
    const oldPlan = await readFile(f.paths.plan);
    for (const doc of f.docs.values()) doc.revisionId = "revision-fresh";
    const result = await refreshRevisions(f.api, owner, f.paths, binding);
    expect(result.refreshed).toBe(7);
    expect(f.writes).toHaveLength(0);
    expect(sha(await readFile(binding.originalPlanPath))).toBe(binding.originalPlanSha);
    expect(
      sha(await readFile(join(f.root, "revision-refresh", sha(oldPlan) + "-" + result.planSha, "before-plan.json"))),
    ).toBe(sha(oldPlan));
    expect((await preflight(f.api, owner, f.paths)).metadata.documents).toBe(7);
    expect(await refreshRevisions(f.api, owner, f.paths, binding)).toEqual({
      planSha: result.planSha,
      refreshed: 0,
    });
  },
  20_000,
);

posixTest(
  "revision refresh refuses any native body or envelope change without publishing a plan",
  async () => {
    const f = await fixture(),
      binding = await freeze(f);
    const before = sha(await readFile(f.paths.plan));
    f.docs.get("owned-document-6")!.title = "foreign-title";
    await expect(refreshRevisions(f.api, owner, f.paths, binding)).rejects.toThrow("REAL_NATIVE_CHANGE");
    expect(sha(await readFile(f.paths.plan))).toBe(before);
    expect(f.writes).toHaveLength(0);
  },
  20_000,
);

posixTest(
  "revision refresh canonicalizes object-key order while retaining exact new snapshot SHA",
  async () => {
    const f = await fixture(),
      binding = await freeze(f);
    const d = f.docs.get("owned-document-0")!;
    f.docs.set("owned-document-0", Object.fromEntries(Object.entries(d).toReversed()));
    const result = await refreshRevisions(f.api, owner, f.paths, binding);
    expect(result.refreshed).toBe(1);
    expect(f.writes).toHaveLength(0);
    expect((await preflight(f.api, owner, f.paths)).metadata.documents).toBe(7);
  },
  20_000,
);

posixTest(
  "refresh refuses changed reviewed requests, original snapshots and manifest hash",
  async () => {
    const f = await fixture(),
      binding = await freeze(f);
    const request = (f.files[0]!.requests as { insertText: { text: string } }[])[0]!;
    request.insertText.text = "foreign-intent";
    await f.savePlan();
    await expect(refreshRevisions(f.api, owner, f.paths, binding)).rejects.toThrow("REVIEWED_PLAN_CHANGED");
    const g = await fixture(),
      other = await freeze(g);
    await writeFile(join(g.root, "inputs", "BOOT.md.native.json"), "foreign", { mode: 0o600 });
    await expect(refreshRevisions(g.api, owner, g.paths, other)).rejects.toThrow("FROZEN_SNAPSHOT_CHANGED");
    await expect(
      refreshRevisions(g.api, owner, g.paths, { ...other, expectedInputHash: sha("forged") }),
    ).rejects.toThrow("FROZEN_MANIFEST_CHANGED");
    expect(g.writes).toHaveLength(0);
  },
  20_000,
);

posixTest(
  "all-seven local and folder checks reject revision refresh before any private plan update",
  async () => {
    const f = await fixture(),
      binding = await freeze(f);
    const before = sha(await readFile(f.paths.plan));
    await writeFile(join(f.paths.home, "BOOT.md"), "concurrent", { mode: 0o600 });
    await expect(refreshRevisions(f.api, owner, f.paths, binding)).rejects.toThrow("FROZEN_OR_LOCAL_CHANGED");
    expect(sha(await readFile(f.paths.plan))).toBe(before);
    const g = await fixture(),
      other = await freeze(g);
    g.hooks.metadata = id => ({
      id,
      name: "AGENTS.md",
      mimeType: "application/vnd.google-apps.document",
      parents: ["foreign-folder"],
    });
    await expect(refreshRevisions(g.api, owner, g.paths, other)).rejects.toThrow("REMOTE_SCOPE_CHANGED");
    expect(g.writes).toHaveLength(0);
  },
  20_000,
);

posixTest(
  "only a pre-journal failure with no writer call exposes explicit safe retry flags",
  async () => {
    const f = await fixture();
    await writeFile(join(f.paths.home, "BOOT.md"), "concurrent", { mode: 0o600 });
    try {
      await apply(f.api, owner, f.paths);
      throw Error("expected failure");
    } catch (error) {
      expect((error as { noWrites?: boolean }).noWrites).toBe(true);
      expect((error as { journalCreated?: boolean }).journalCreated).toBe(false);
    }
    const g = await fixture();
    g.hooks.beforeWrite = () => {
      throw Error("transport-result-unknown");
    };
    try {
      await apply(g.api, owner, g.paths);
      throw Error("expected failure");
    } catch (error) {
      expect((error as { noWrites?: boolean }).noWrites).toBeUndefined();
      expect((error as { journalCreated?: boolean }).journalCreated).toBeUndefined();
    }
    g.hooks.beforeWrite = undefined;
    try {
      await apply(g.api, owner, g.paths);
      throw Error("expected existing journal failure");
    } catch (error) {
      expect((error as { noWrites?: boolean }).noWrites).toBeUndefined();
    }
  },
  20_000,
);
function document(id: string, lines = ["original", ""]): Obj {
  let index = 1;
  return {
    documentId: id,
    revisionId: "revision-1",
    title: "owned",
    tabs: [
      {
        tabProperties: { tabId: "owned-tab", title: "Owned", index: 0 },
        documentTab: {
          body: {
            content: [
              { endIndex: 1, sectionBreak: { sectionStyle: { columnSeparatorStyle: "NONE" } } },
              ...lines.map(line => {
                const text = line + "\n",
                  startIndex = index;
                index += text.length;
                return {
                  startIndex,
                  endIndex: index,
                  paragraph: {
                    paragraphStyle: { namedStyleType: "NORMAL_TEXT", direction: "LEFT_TO_RIGHT" },
                    elements: [{ startIndex, endIndex: index, textRun: { content: text, textStyle: {} } }],
                  },
                };
              }),
            ],
          },
        },
      },
    ],
  };
}
function plain(d: unknown): string {
  return modelDocument(d)
    .paragraphs.flatMap(p => p.cells.map(c => c.unit))
    .join("");
}
const owner: Owner = {
  googleApi: async () => {
    throw Error("unused");
  },
  nativeMarkdown: d => plain(d),
  projectionMarkdown: d => plain(d),
  normalizeMarkdown: s => s.replace(/\n+$/, "\n"),
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aphrody-drive-review-"));
  roots.push(root);
  await chmod(root, 0o700);
  const paths: Paths = {
    home: join(root, "home"),
    stage: join(root, "stage"),
    state: join(root, "state.json"),
    plan: join(root, "plan.json"),
    journalRoot: join(root, "applied"),
    lock: join(root, "lock"),
    folder: "approved-folder",
  };
  await mkdir(paths.home, { mode: 0o700 });
  await mkdir(paths.stage, { mode: 0o700 });
  const docs = new Map<string, Obj>(),
    stateFiles: Obj = {},
    files: Obj[] = [],
    writes: Obj[] = [],
    gets = new Map<string, number>();
  for (const [i, name] of NAMES.entries()) {
    const id = "owned-document-" + i;
    const d = document(id);
    docs.set(id, d);
    const local = plain(d);
    await writeFile(join(paths.home, name), local, { mode: 0o600 });
    const requests =
      i === 0
        ? [{ insertText: { location: { tabId: "owned-tab", index: 1 }, text: "reviewed " } }]
        : i === 1
          ? [
              {
                insertText: {
                  location: { tabId: "owned-tab", index: 10 },
                  text: "new\nparagraph\n",
                },
              },
            ]
          : [];
    const proposed = plain(renderedModel(simulate(modelDocument(d), requests)));
    const proposedLocalFile = join(paths.stage, name + ".proposed"),
      explanationFile = join(paths.stage, name + ".reason");
    await writeFile(proposedLocalFile, proposed, { mode: 0o600 });
    await writeFile(explanationFile, "review metadata", { mode: 0o600 });
    files.push({
      name,
      id,
      localBeforeSha256: sha(local),
      remoteRevisionId: d.revisionId,
      remoteBeforeSha256: sha(JSON.stringify(d)),
      proposedLocalFile,
      explanationFile,
      requests,
      writeControl: { requiredRevisionId: d.revisionId },
    });
    stateFiles[name] = { id, localHash: sha(local), remoteHash: sha(owner.nativeMarkdown(d)) };
  }
  const plan: Obj = {
    version: 1,
    folderId: paths.folder,
    files,
    counts: { reviewed: 7 },
    reviewedAt: "fixture",
  };
  await writeFile(paths.plan, JSON.stringify(plan), { mode: 0o600 });
  await writeFile(paths.state, JSON.stringify({ version: 1, files: stateFiles }), { mode: 0o600 });
  const hooks: {
    beforeGet?: (id: string, count: number) => void | Promise<void>;
    beforeWrite?: (id: string) => void | Promise<void>;
    afterWrite?: (id: string) => void;
    metadata?: (id: string) => Obj;
  } = {};
  const api = {
    drive: {
      files: {
        get: async (p: Obj) => ({
          data: hooks.metadata?.(String(p.fileId)) ?? {
            id: p.fileId,
            name: NAMES[Number(String(p.fileId).split("-").at(-1))],
            mimeType: "application/vnd.google-apps.document",
            parents: [paths.folder],
            trashed: false,
          },
        }),
      },
    },
    docs: {
      documents: {
        get: async (p: Obj) => {
          const id = String(p.documentId),
            count = (gets.get(id) ?? 0) + 1;
          gets.set(id, count);
          await hooks.beforeGet?.(id, count);
          return { data: structuredClone(docs.get(id)) };
        },
        batchUpdate: async (p: Obj) => {
          const id = String(p.documentId);
          await hooks.beforeWrite?.(id);
          const payload = p.requestBody as Obj;
          const control = payload.writeControl as Obj;
          expect(Object.keys(control)).toEqual(["requiredRevisionId"]);
          if (control.requiredRevisionId !== docs.get(id)!.revisionId)
            throw Error("private SDK payload must not escape");
          writes.push(structuredClone(p));
          const d = renderedModel(
            simulate(modelDocument(docs.get(id)), payload.requests as Parameters<typeof simulate>[1]),
          );
          d.revisionId = "revision-2";
          docs.set(id, d);
          hooks.afterWrite?.(id);
          return { data: {} };
        },
      },
    },
  };
  return {
    root,
    paths,
    plan,
    files,
    docs,
    stateFiles,
    writes,
    gets,
    hooks,
    api,
    savePlan: () => writeFile(paths.plan, JSON.stringify(plan), { mode: 0o600 }),
    saveState: () => writeFile(paths.state, JSON.stringify({ files: stateFiles }), { mode: 0o600 }),
  };
}

test("simulates minimal edits and final paragraph appends while preserving styles and metadata", () => {
  const d = document("owned-document");
  const model = modelDocument(d);
  const requests = [
    { insertText: { location: { index: 10, tabId: "owned-tab" }, text: "tail\n" } },
    { deleteContentRange: { range: { startIndex: 2, endIndex: 4, tabId: "owned-tab" } } },
    { insertText: { location: { index: 2, tabId: "owned-tab" }, text: "XX" } },
  ];
  const expected = simulate(model, requests);
  const rendered = renderedModel(expected);
  expect(plain(rendered)).toBe("oXXginal\ntail\n\n");
  verifyAfter(expected, rendered);
  verifyPlainProposal(expected, "oXXginal\ntail\n");
  const changed = structuredClone(rendered);
  changed.title = "foreign";
  expect(() => verifyAfter(expected, changed)).toThrow("TOPOLOGY_CHANGED");
  const styled = renderedModel(expected);
  const ps = (((styled.tabs as Obj[])[0]!.documentTab as Obj).body as Obj).content as Obj[];
  (((ps[1]!.paragraph as Obj).elements as Obj[])[0]!.textRun as Obj).textStyle = { bold: true };
  expect(() => verifyAfter(expected, styled)).toThrow("UNTOUCHED_TEXT_CHANGED");
}, 20_000);

test("rejects foreign operations, body replacement, newline merges, alternate tabs and invalid UTF-16 boundaries", () => {
  const model = modelDocument(document("owned-document", ["one😀", ""]));
  const bad = [
    { replaceAllText: {} },
    { deleteContentRange: { range: { startIndex: 1, endIndex: 8, tabId: "owned-tab" } } },
    { insertText: { location: { index: 1, tabId: "foreign" }, text: "x" } },
    { insertText: { location: { index: 1, tabId: "owned-tab", segmentId: "header" }, text: "x" } },
    { insertText: { location: { index: 1, tabId: "owned-tab" }, text: "new\nparagraph" } },
    { insertText: { location: { index: 5, tabId: "owned-tab" }, text: "split" } },
    { insertText: { location: { index: 1, tabId: "owned-tab" }, text: "bad\ue000" } },
  ];
  for (const request of bad) expect(() => simulate(model, [request] as Parameters<typeof simulate>[1])).toThrow();
  expect(() => verifyPlainProposal(model, "one😀  \n\n")).toThrow("PROPOSAL_REQUEST_MISMATCH");
}, 20_000);

posixTest(
  "preflight validates every owned file, performs zero writes, and leaves unchanged baseline bytes intact",
  async () => {
    const f = await fixture();
    const review = await preflight(f.api, owner, f.paths);
    expect(review.metadata.documents).toBe(7);
    expect(review.metadata.changedDocuments).toBe(2);
    expect(f.writes).toHaveLength(0);
    f.stateFiles["BOOT.md"] = { ...(f.stateFiles["BOOT.md"] as Obj), remoteHash: sha("stale") };
    await f.saveState();
    await expect(preflight(f.api, owner, f.paths)).rejects.toThrow("UNCHANGED_BASELINE_MISMATCH");
    expect(f.writes).toHaveLength(0);
  },
  20_000,
);

posixTest(
  "strict scope rejects targetRevisionId, missing files, duplicate ids and paths escaping private proposals",
  async () => {
    const f = await fixture();
    const mutations = [
      (p: Obj) => {
        (p.files as Obj[])[0]!.writeControl = { targetRevisionId: "revision-1" };
      },
      (p: Obj) => {
        (p.files as Obj[]).pop();
      },
      (p: Obj) => {
        (p.files as Obj[])[1]!.id = (p.files as Obj[])[0]!.id;
      },
      (p: Obj) => {
        (p.files as Obj[])[0]!.proposedLocalFile = join(f.paths.stage, "..", "plan.json");
      },
      (p: Obj) => {
        p.folderId = "foreign";
      },
    ];
    for (const mutation of mutations) {
      const p = structuredClone(f.plan);
      mutation(p);
      expect(() => parsePlan(p, f.paths)).toThrow();
    }
  },
  20_000,
);

posixTest(
  "rejects symlink proposals and non-private local files without API writes",
  async () => {
    const f = await fixture();
    const proposed = String(f.files[0]!.proposedLocalFile);
    await rm(proposed);
    await symlink(join(f.paths.home, "AGENTS.md"), proposed);
    await expect(preflight(f.api, owner, f.paths)).rejects.toThrow("UNSAFE_PATH");
    expect(f.writes).toHaveLength(0);
    await rm(proposed);
    await writeFile(proposed, "restored", { mode: 0o600 });
    await chmod(join(f.paths.home, "AGENTS.md"), 0o644);
    await expect(preflight(f.api, owner, f.paths)).rejects.toThrow("NON_PRIVATE_FILE");
    expect(f.writes).toHaveLength(0);
  },
  20_000,
);

posixTest(
  "all-seven guards reject final-file local drift and foreign folder before any write",
  async () => {
    const f = await fixture();
    await writeFile(join(f.paths.home, "BOOT.md"), "concurrent", { mode: 0o600 });
    await expect(apply(f.api, owner, f.paths)).rejects.toThrow("LOCAL_CHANGED");
    expect(f.writes).toHaveLength(0);
    const g = await fixture();
    g.hooks.metadata = id => ({
      id,
      name: "AGENTS.md",
      mimeType: "application/vnd.google-apps.document",
      parents: ["foreign"],
    });
    await expect(apply(g.api, owner, g.paths)).rejects.toThrow("REMOTE_SCOPE_CHANGED");
    expect(g.writes).toHaveLength(0);
  },
  20_000,
);

posixTest(
  "successful application writes changed Docs only, backs up seven natives and locals privately, and prepares fresh reviewed seed snapshots",
  async () => {
    const f = await fixture();
    const before = await readFile(join(f.paths.home, "BOOT.md"));
    const result = await apply(f.api, owner, f.paths);
    expect(result.phase).toBe("complete");
    expect(f.writes).toHaveLength(2);
    expect(await readFile(join(f.paths.home, "BOOT.md"))).toEqual(before);
    expect(await Bun.file(join(f.paths.home, "AGENTS.md")).text()).toBe("reviewed original\n\n");
    const seed = String(result.seedReviewed);
    for (const name of NAMES)
      expect((await Bun.file(join(seed, name + ".json")).json()).documentId).toBe(
        f.files.find(x => x.name === name)!.id,
      );
    const receipt = await Bun.file(String(result.receipt)).json();
    expect(receipt.remoteVerified).toHaveLength(7);
    expect(receipt.localPromoted).toHaveLength(7);
    const stat = await import("node:fs/promises");
    expect((await stat.stat(String(result.receipt))).mode & 0o777).toBe(0o600);
    expect((await stat.stat(seed)).mode & 0o777).toBe(0o700);
    await expect(apply(f.api, owner, f.paths)).rejects.toThrow();
    expect(f.writes).toHaveLength(2);
  },
  20_000,
);

posixTest(
  "race on the last revision during the final all-seven check prevents the first write",
  async () => {
    const f = await fixture();
    f.hooks.beforeGet = (id, count) => {
      if (id === "owned-document-6" && count === 2) f.docs.get(id)!.revisionId = "concurrent";
    };
    await expect(apply(f.api, owner, f.paths)).rejects.toThrow("REMOTE_CHANGED");
    expect(f.writes).toHaveLength(0);
    expect(await Bun.file(join(f.paths.home, "AGENTS.md")).text()).toBe("original\n\n");
  },
  20_000,
);

posixTest(
  "strict requiredRevisionId rejects a race at batchUpdate and records safe failure without local promotion",
  async () => {
    const f = await fixture();
    f.hooks.beforeWrite = id => {
      f.docs.get(id)!.revisionId = "concurrent";
    };
    await expect(apply(f.api, owner, f.paths)).rejects.toThrow("OWNER_OPERATION_FAILED");
    expect(f.writes).toHaveLength(0);
    const receipt = await Bun.file(join(f.paths.journalRoot, sha(await readFile(f.paths.plan)), "receipt.json")).json();
    expect(receipt.phase).toBe("failed");
    expect(receipt.failedClass).toBe("OWNER_OPERATION_FAILED");
    expect(JSON.stringify(receipt)).not.toContain("private SDK payload");
  },
  20_000,
);

posixTest(
  "changed paragraph style after a write is rejected with a durable partial receipt and untouched locals",
  async () => {
    const f = await fixture();
    f.hooks.afterWrite = id => {
      const d = f.docs.get(id)!;
      const p = (((d.tabs as Obj[])[0]!.documentTab as Obj).body as Obj).content as Obj[];
      (p[1]!.paragraph as Obj).paragraphStyle = {
        namedStyleType: "HEADING_1",
        direction: "LEFT_TO_RIGHT",
      };
    };
    await expect(apply(f.api, owner, f.paths)).rejects.toThrow("PARAGRAPH_CHANGED");
    expect(f.writes).toHaveLength(1);
    expect(await Bun.file(join(f.paths.home, "AGENTS.md")).text()).toBe("original\n\n");
  },
  20_000,
);

test("existing owner lock is respected and preserved", async () => {
  const f = await fixture();
  await mkdir(f.paths.lock, { mode: 0o700 });
  await writeFile(join(f.paths.lock, "pid"), "owner", { mode: 0o600 });
  await expect(apply(f.api, owner, f.paths)).rejects.toThrow("OWNER_LOCK_BUSY");
  expect(await Bun.file(join(f.paths.lock, "pid")).text()).toBe("owner");
  expect(f.writes).toHaveLength(0);
}, 20_000);

posixTest(
  "unchanged Docs retain independently reviewed local bytes even when native rendering differs",
  async () => {
    const f = await fixture();
    const entry = f.files.find(x => x.name === "USER.md")!;
    const reviewedLocal = "---\nowner: local-profile\n---\noriginal\n";
    await writeFile(join(f.paths.home, "USER.md"), reviewedLocal, { mode: 0o600 });
    await writeFile(String(entry.proposedLocalFile), reviewedLocal, { mode: 0o600 });
    entry.localBeforeSha256 = sha(reviewedLocal);
    (f.stateFiles["USER.md"] as Obj).localHash = sha(reviewedLocal);
    await f.savePlan();
    await f.saveState();
    expect((await preflight(f.api, owner, f.paths)).metadata.documents).toBe(7);
    expect(f.writes).toHaveLength(0);
  },
  20_000,
);

test("raw proposal guard preserves interior trailing spaces and existing terminal vertical-tab", () => {
  const model = modelDocument(document("owned-document", ["line ", "fenced  ", "end\u000b", ""]));
  verifyPlainProposal(model, "line \nfenced  \nend\u000b\n");
  expect(() => verifyPlainProposal(model, "line\nfenced\nend\n")).toThrow("PROPOSAL_REQUEST_MISMATCH");
}, 20_000);
