// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- Fixture promotion models the owner's sequential seven-file checkpoints. */
import { afterEach, expect, spyOn, test } from "bun:test";
import { A2AClient, type Task, type Transport } from "@aphrody/a2a";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  reconcileDriveReview,
  publishReviewedProjection,
  verifyReviewedProjection,
  type DriveReviewScope,
  type ReviewPorts,
} from "../src/agent-home-drive-reconcile.ts";
import { hasMode, POSIX_MODES } from "../src/portable-fs.ts";

const names = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "BOOT.md",
];
const roots: string[] = [];
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const markdown = (document: Record<string, unknown>) => String(document.text);
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(changed = true) {
  const root = await mkdtemp(join(tmpdir(), "drive-review-test-"));
  roots.push(root);
  const home = join(root, "home");
  const baselineDirectory = join(root, "baseline");
  const receiptRoot = join(root, "receipts");
  await mkdir(home, { mode: 0o700 });
  await mkdir(baselineDirectory, { mode: 0o700 });
  const files: Record<
    string,
    {
      id: string;
      localHash: string;
      remoteHash: string;
      sourceSnapshotHash: string;
    }
  > = {};
  const documents = new Map<string, Record<string, unknown>>();
  const writes: Promise<unknown>[] = [];
  for (const name of names) {
    const baseline = `baseline ${name}\n`;
    const local = changed ? `edited ${name}\n` : baseline;
    const native = {
      documentId: `id-${name}`,
      revisionId: "revision-1",
      text: baseline,
    };
    const nativeJson = JSON.stringify(native);
    files[name] = {
      id: native.documentId,
      localHash: digest(baseline),
      remoteHash: digest(markdown(native)),
      sourceSnapshotHash: digest(nativeJson),
    };
    documents.set(native.documentId, native);
    writes.push(writeFile(join(home, name), local, { mode: 0o600 }));
    writes.push(
      writeFile(join(baselineDirectory, name), baseline, { mode: 0o600 }),
    );
    writes.push(
      writeFile(join(baselineDirectory, `${name}.native.json`), nativeJson, {
        mode: 0o600,
      }),
    );
  }
  await Promise.all(writes);
  const stateFile = join(root, "state.json");
  await writeFile(
    stateFile,
    JSON.stringify({
      version: 1,
      kind: "native-markdown-download-only",
      rootFolderId: "folder",
      files,
    }),
    { mode: 0o600 },
  );
  await chmod(stateFile, 0o600);
  const config: DriveReviewScope = {
    intervalSeconds: 300,
    receiptRoot,
    stateFile,
    baselineDirectory,
    a2aUrl: "https://a2a.example.test",
    tokenFile: join(root, "token"),
    peer: "review-peer",
    ownerModule: { path: join(root, "owner.ts"), sha256: "a".repeat(64) },
    validatorModule: {
      path: join(root, "validator.ts"),
      sha256: "b".repeat(64),
    },
    home,
    folderId: "folder",
    yolo: "yolo",
  };
  const owner = {
    nativeMarkdown: (document: Record<string, unknown>) =>
      String(document.text),
  };
  const api = {
    drive: {
      files: {
        get: async ({ fileId }: { fileId: string }) => {
          const name = names.find(
            (candidate) => files[candidate]!.id === fileId,
          )!;
          return {
            data: {
              id: fileId,
              name,
              mimeType: "application/vnd.google-apps.document",
              parents: ["folder"],
              trashed: false,
            },
          };
        },
      },
    },
    docs: {
      documents: {
        get: async ({ documentId }: { documentId: string }) => ({
          data: documents.get(documentId)!,
        }),
      },
    },
  };
  return {
    config,
    documents,
    ports: {
      owner,
      api,
      validator: {},
      client: {},
      seedReviewed: async () => {},
    } as unknown as ReviewPorts,
  };
}

test("Drive review persists the private intent and ACK before polling a single task", async () => {
  const { config, ports } = await fixture();
  let submissions = 0;
  ports.client.sendMessage = async () => {
    submissions++;
    const active = JSON.parse(
      await readFile(join(config.receiptRoot, "active.json"), "utf8"),
    ) as {
      hash: string;
    };
    const reviewPath = join(config.receiptRoot, active.hash, "review.json");
    const review = JSON.parse(await readFile(reviewPath, "utf8")) as {
      phase: string;
      contextId: string;
    };
    expect(review.phase).toBe("reserved");
    expect(hasMode((await stat(reviewPath)).mode, 0o600)).toBe(true);
    return {
      task: {
        id: "task-1",
        contextId: review.contextId,
        status: { state: "TASK_STATE_SUBMITTED" },
      },
    } as never;
  };
  ports.client.getTask = async ({ id }: { id: string }) => {
    expect(id).toBe("task-1");
    return {
      id,
      contextId: `drive-review-${JSON.parse(await readFile(join(config.receiptRoot, "active.json"), "utf8")).hash}`,
      status: { state: "TASK_STATE_WORKING" },
    } as never;
  };

  expect(await reconcileDriveReview(config, async () => "", ports)).toEqual({
    review_submitted: 1,
    review_pending: 1,
  });
  expect(await reconcileDriveReview(config, async () => "", ports)).toEqual({
    review_pending: 1,
  });
  expect(submissions).toBe(1);
  expect(
    (await readdir(config.receiptRoot)).filter((entry) =>
      /^[a-f0-9]{64}$/.test(entry),
    ),
  ).toHaveLength(1);
});

async function lifecycle(project = false) {
  const value = await fixture();
  const { config, ports, documents } = value;
  if (project)
    config.reviewedDirectory = join(config.home, "..", "reviewed-current");
  const calls = {
    send: 0,
    poll: 0,
    list: 0,
    refresh: 0,
    preflight: 0,
    apply: 0,
    seed: 0,
  };
  let task: Task | undefined;
  let taskState: Task["status"]["state"] = "TASK_STATE_COMPLETED";
  let lostAck = false;
  let missingAck = false;
  let failApply: "none" | "complete" | "partial" | "safe" = "none";
  const active = async () => {
    const { hash } = JSON.parse(
      await readFile(join(config.receiptRoot, "active.json"), "utf8"),
    );
    return join(config.receiptRoot, hash);
  };
  const record = async () =>
    JSON.parse(await readFile(join(await active(), "review.json"), "utf8"));
  const transport: Transport = {
    binding: "JSONRPC",
    url: config.a2aUrl,
    call: async (method, request) => {
      if (method === "SendMessage") {
        calls.send++;
        const intent = await record();
        expect(intent.phase).toBe("reserved");
        const input = request as {
          message: { contextId: string };
          configuration: { returnImmediately: boolean; historyLength: number };
        };
        expect(input.configuration.returnImmediately).toBe(true);
        expect(input.configuration.historyLength).toBe(0);
        task = {
          id: "review-task",
          contextId: input.message.contextId,
          status: { state: taskState },
        };
        if (lostAck) throw new Error("LOST_ACK");
        return { task } as never;
      }
      if (method === "GetTask") {
        calls.poll++;
        expect((request as { historyLength: number }).historyLength).toBe(0);
        return { ...task!, status: { state: taskState } } as never;
      }
      if (method === "ListTasks") {
        calls.list++;
        return {
          tasks: missingAck ? [] : [task!],
          pageSize: 100,
          totalSize: missingAck ? 0 : 1,
        } as never;
      }
      throw new Error("UNEXPECTED_METHOD");
    },
    stream: async function* () {
      yield {} as never;
      throw new Error("NO_STREAM");
    },
  };
  ports.client = new A2AClient({ transport });
  const writePlan = async () => {
    const directory = await active();
    const inputs = JSON.parse(
      await readFile(join(directory, "inputs.json"), "utf8"),
    );
    const plan = {
      version: 1,
      folderId: "folder",
      files: inputs.files.map((input: Record<string, unknown>) => ({
        name: input.name,
        id: input.id,
        localBeforeSha256: input.localBeforeSha256,
        remoteRevisionId: input.remoteRevisionId,
        remoteBeforeSha256: input.remoteBeforeSha256,
        proposedLocalFile: join(
          directory,
          "reconciliation",
          input.name as string,
        ),
        explanationFile: join(directory, "reconciliation", `${input.name}.txt`),
        requests: [],
      })),
    };
    await writeFile(
      join(directory, "reconciliation-plan.json"),
      JSON.stringify(plan),
      {
        mode: 0o600,
      },
    );
  };
  ports.validator.refreshRevisions = async (_api, _owner, paths, binding) => {
    calls.refresh++;
    expect(digest(await readFile(binding.originalPlanPath, "utf8"))).toBe(
      binding.originalPlanSha,
    );
    expect(
      digest(
        JSON.stringify(
          JSON.parse(await readFile(binding.inputManifestPath, "utf8")),
        ),
      ),
    ).toBe(binding.expectedInputHash);
    const plan = JSON.parse(await readFile(paths.plan, "utf8"));
    for (const entry of plan.files) {
      const document = documents.get(entry.id)!;
      entry.remoteRevisionId = document.revisionId;
      entry.remoteBeforeSha256 = digest(JSON.stringify(document));
    }
    await writeFile(paths.plan, JSON.stringify(plan));
    return {
      planSha: digest(await readFile(paths.plan, "utf8")),
      refreshed: 0,
    };
  };
  ports.validator.preflight = async (_api, _owner, paths) => {
    calls.preflight++;
    const bytes = await readFile(paths.plan, "utf8");
    const plan = JSON.parse(bytes);
    for (const entry of plan.files)
      expect(entry.remoteRevisionId).toBe(documents.get(entry.id)!.revisionId);
    return { planSha: digest(bytes) };
  };
  ports.validator.apply = async (_api, _owner, paths) => {
    calls.apply++;
    expect((await record()).phase).toBe("applying");
    if (failApply === "safe")
      throw Object.assign(new Error("PRE_JOURNAL"), {
        noWrites: true,
        journalCreated: false,
      });
    const planSha = digest(await readFile(paths.plan, "utf8"));
    const journal = join(paths.journalRoot, planSha);
    const seedReviewed = join(journal, "fresh-native");
    await mkdir(seedReviewed, { recursive: true, mode: 0o700 });
    const result = {
      ok: true,
      phase: failApply === "partial" ? "remote-writing" : "complete",
      planSha,
      seedReviewed,
    };
    await writeFile(join(journal, "receipt.json"), JSON.stringify(result), {
      mode: 0o600,
    });
    if (failApply !== "none") throw new Error("LOST_APPLY_ACK");
    return result;
  };
  ports.seedReviewed = async () => {
    calls.seed++;
    const state = JSON.parse(await readFile(config.stateFile, "utf8"));
    for (const name of names) {
      const bytes = await readFile(join(config.home, name), "utf8");
      const document = documents.get(state.files[name].id)!;
      document.text = bytes;
      state.files[name].localHash = digest(bytes);
      state.files[name].remoteHash = digest(bytes);
      state.files[name].sourceSnapshotHash = digest(JSON.stringify(document));
      await writeFile(join(config.baselineDirectory, name), bytes);
      await writeFile(
        join(config.baselineDirectory, `${name}.native.json`),
        JSON.stringify(document),
      );
    }
    await writeFile(config.stateFile, JSON.stringify(state));
  };
  const tick = () => reconcileDriveReview(config, async () => "", ports);
  return {
    ...value,
    calls,
    active,
    record,
    tick,
    writePlan,
    taskState: (state: Task["status"]["state"]) => {
      taskState = state;
    },
    loseAck: (missing = false) => {
      lostAck = true;
      missingAck = missing;
    },
    failApply: (kind: typeof failApply) => {
      failApply = kind;
    },
  };
}

test("one task survives a lost ACK by typed SDK context lookup without resend", async () => {
  const value = await lifecycle();
  value.loseAck();
  expect(await value.tick()).toEqual({ review_pending: 1 });
  expect((await value.record()).phase).toBe("reserved");
  expect(await value.tick()).toEqual({ review_pending: 1 });
  expect((await value.record()).taskId).toBe("review-task");
  expect(value.calls).toMatchObject({ send: 1, list: 1, poll: 0 });
});
test("unrecoverable submission stays blocked after bounded metadata lookups", async () => {
  const value = await lifecycle();
  value.loseAck(true);
  await value.tick();
  await value.tick();
  await value.tick();
  expect(await value.tick()).toEqual({ review_blocked: 1 });
  expect(await value.tick()).toEqual({ review_blocked: 1 });
  expect(value.calls).toMatchObject({ send: 1, list: 3, apply: 0 });
});
test("concurrent passes reserve one durable task", async () => {
  const value = await lifecycle();
  const results = await Promise.all([value.tick(), value.tick()]);
  expect(results.some((result) => result.review_submitted === 1)).toBe(true);
  expect(value.calls.send).toBe(1);
}, 20_000);
test("failed task is a permanent tombstone for its input hash", async () => {
  const value = await lifecycle();
  value.taskState("TASK_STATE_FAILED");
  await value.tick();
  expect(await value.tick()).toEqual({ review_blocked: 1 });
  expect(await value.tick()).toEqual({ review_blocked: 1 });
  expect(value.calls.send).toBe(1);
  expect(value.calls.apply).toBe(0);
});
test("frozen input tampering blocks before native validator", async () => {
  const value = await lifecycle();
  await value.tick();
  await value.writePlan();
  await writeFile(
    join(await value.active(), "inputs", "AGENTS.md.native.json"),
    "changed",
  );
  expect(await value.tick()).toEqual({ review_blocked: 1 });
  expect(value.calls.preflight).toBe(0);
});
test("wrong captured plan revision refuses native preflight", async () => {
  const value = await lifecycle();
  await value.tick();
  await value.writePlan();
  const path = join(await value.active(), "reconciliation-plan.json");
  const plan = JSON.parse(await readFile(path, "utf8"));
  plan.files[0].remoteRevisionId = "foreign";
  await writeFile(path, JSON.stringify(plan));
  await expect(value.tick()).rejects.toThrow("PLAN_INPUT_MISMATCH");
  expect(value.calls.refresh).toBe(0);
  expect(value.calls.apply).toBe(0);
});
test("revision-only refresh is repeated just before apply while original plan remains frozen", async () => {
  const value = await lifecycle();
  await value.tick();
  await value.writePlan();
  expect(await value.tick()).toEqual({ reviewed: 7, review_pending: 1 });
  const originalSha = (await value.record()).originalPlanSha;
  for (const document of value.documents.values())
    document.revisionId = "rotated-2";
  await value.tick();
  expect(value.calls).toMatchObject({ refresh: 2, preflight: 2, apply: 1 });
  expect((await value.record()).originalPlanSha).toBe(originalSha);
  expect((await value.record()).phase).toBe("seeding");
  await value.tick();
  expect((await value.record()).phase).toBe("publishing");
  expect(await value.tick()).toEqual({ review_applied: 1, verified: 7 });
  expect(await value.tick()).toEqual({ unchanged: 7, verified: 7 });
  expect(value.calls.send).toBe(1);
});
test("reviewed plan edits never reach apply", async () => {
  const value = await lifecycle();
  await value.tick();
  await value.writePlan();
  await value.tick();
  await writeFile(
    join(await value.active(), "reconciliation-plan.json"),
    "changed",
  );
  expect(await value.tick()).toEqual({ review_blocked: 1 });
  expect(value.calls.apply).toBe(0);
});
test("complete native journal recovers lost apply ACK without replay", async () => {
  const value = await lifecycle();
  value.failApply("complete");
  await value.tick();
  await value.writePlan();
  await value.tick();
  await value.tick();
  expect((await value.record()).phase).toBe("applying");
  await value.tick();
  expect((await value.record()).phase).toBe("seeding");
  await value.tick();
  await value.tick();
  expect(value.calls.apply).toBe(1);
});
test("partial native journal permanently blocks replay", async () => {
  const value = await lifecycle();
  value.failApply("partial");
  await value.tick();
  await value.writePlan();
  await value.tick();
  await value.tick();
  expect(await value.tick()).toEqual({ review_blocked: 1 });
  expect(await value.tick()).toEqual({ review_blocked: 1 });
  expect(value.calls.apply).toBe(1);
});
test("explicit pre-journal no-write failure retries reviewed state with another revision refresh", async () => {
  const value = await lifecycle();
  value.failApply("safe");
  await value.tick();
  await value.writePlan();
  await value.tick();
  await value.tick();
  expect((await value.record()).phase).toBe("reviewed");
  value.failApply("none");
  await value.tick();
  expect(value.calls.apply).toBe(2);
  expect(value.calls.refresh).toBe(3);
});
test("seed retry never repeats an already journaled apply", async () => {
  const value = await lifecycle();
  const seed = value.ports.seedReviewed;
  value.ports.seedReviewed = async () => {
    throw new Error("REMOTE_CHANGED_BEFORE_SEED");
  };
  await value.tick();
  await value.writePlan();
  await value.tick();
  await value.tick();
  await expect(value.tick()).rejects.toThrow("REMOTE_CHANGED_BEFORE_SEED");
  expect((await value.record()).phase).toBe("seeding");
  value.ports.seedReviewed = seed;
  await value.tick();
  await value.tick();
  expect(value.calls.apply).toBe(1);
});
test("all seven verified files publish as one immutable generation and managed pointer", async () => {
  const value = await fixture(false);
  value.config.reviewedDirectory = join(
    value.config.home,
    "..",
    "reviewed-current",
  );
  expect(
    await reconcileDriveReview(value.config, async () => "", value.ports),
  ).toEqual({
    unchanged: 7,
    verified: 7,
  });
  const target = await readlink(value.config.reviewedDirectory);
  expect((await readdir(target)).toSorted()).toEqual(names.toSorted());
  expect(hasMode((await stat(join(target, "AGENTS.md"))).mode, 0o600)).toBe(
    true,
  );
  await verifyReviewedProjection(value.config.reviewedDirectory);
  await reconcileDriveReview(value.config, async () => "", value.ports);
  expect(await readlink(value.config.reviewedDirectory)).toBe(target);
  await writeFile(join(target, "AGENTS.md"), "modified generation");
  await expect(
    verifyReviewedProjection(value.config.reviewedDirectory),
  ).rejects.toThrow("REVIEWED_GENERATION_CHANGED");
});
test("publication never switches the previous generation when local bytes are unreviewed", async () => {
  const value = await fixture(false);
  value.config.reviewedDirectory = join(
    value.config.home,
    "..",
    "reviewed-current",
  );
  await publishReviewedProjection(value.config, value.ports.owner);
  const prior = await readlink(value.config.reviewedDirectory);
  await writeFile(join(value.config.home, "AGENTS.md"), "new local edit");
  await expect(
    publishReviewedProjection(value.config, value.ports.owner),
  ).rejects.toThrow("REVIEWED_BASELINE_CHANGED");
  expect(await readlink(value.config.reviewedDirectory)).toBe(prior);
});
test("unmanaged publication roots and private hardlinks fail closed", async () => {
  const value = await fixture(false);
  value.config.reviewedDirectory = join(
    value.config.home,
    "..",
    "reviewed-current",
  );
  await symlink(value.config.home, value.config.reviewedDirectory);
  await expect(
    publishReviewedProjection(value.config, value.ports.owner),
  ).rejects.toThrow("UNSAFE_REVIEWED_TARGET");
  await link(
    join(value.config.home, "AGENTS.md"),
    join(value.config.home, "linked.md"),
  );
  await expect(
    reconcileDriveReview(value.config, async () => "", value.ports),
  ).rejects.toThrow("UNSAFE_PRIVATE_FILE");
});

test("a resumed preflight uses the immutable original after revision refresh changed the working plan", async () => {
  const value = await lifecycle();
  await value.tick();
  await value.writePlan();
  for (const document of value.documents.values())
    document.revisionId = "rotated-before-preflight";
  const originalPreflight = value.ports.validator.preflight;
  value.ports.validator.preflight = async () => {
    throw new Error("TRANSIENT_PREFLIGHT");
  };
  await expect(value.tick()).rejects.toThrow("TRANSIENT_PREFLIGHT");
  const originalSha = (await value.record()).originalPlanSha;
  expect((await value.record()).phase).toBe("submitted");
  value.ports.validator.preflight = originalPreflight;
  expect(await value.tick()).toEqual({ reviewed: 7, review_pending: 1 });
  expect((await value.record()).originalPlanSha).toBe(originalSha);
  expect(value.calls.send).toBe(1);
});
test("publishing is durable and completes only after the complete reviewed generation exists", async () => {
  const value = await lifecycle(true);
  await value.tick();
  await value.writePlan();
  await value.tick();
  await value.tick();
  await value.tick();
  expect((await value.record()).phase).toBe("publishing");
  expect(await value.tick()).toEqual({ review_applied: 1, verified: 7 });
  await verifyReviewedProjection(value.config.reviewedDirectory!);
  const target = await readlink(value.config.reviewedDirectory!);
  expect((await readdir(target)).length).toBe(7);
  expect(value.calls.apply).toBe(1);
});

test("unchanged and out-of-scope documents never submit a review task", async () => {
  const unchanged = await fixture(false);
  let submissions = 0;
  unchanged.ports.client.sendMessage = async () => {
    submissions++;
    return {} as never;
  };
  expect(
    await reconcileDriveReview(
      unchanged.config,
      async () => "",
      unchanged.ports,
    ),
  ).toEqual({
    unchanged: names.length,
    verified: names.length,
  });
  expect(submissions).toBe(0);

  const scoped = await fixture();
  scoped.ports.api.drive.files.get = async () =>
    ({
      data: {
        id: "id-AGENTS.md",
        name: "AGENTS.md",
        mimeType: "application/vnd.google-apps.document",
        parents: ["other-folder"],
        trashed: false,
      },
    }) as never;
  await expect(
    reconcileDriveReview(scoped.config, async () => "", scoped.ports),
  ).rejects.toThrow("REMOTE_SCOPE_MISMATCH");
  expect(submissions).toBe(0);
});

test("a Docs document without a revision blocks the review without submitting or failing", async () => {
  const value = await fixture();
  let submissions = 0;
  value.ports.client.sendMessage = async () => {
    submissions++;
    return {} as never;
  };
  const documents = value.ports.api.docs.documents;
  const get = documents.get;
  documents.get = async (params) => ({
    data: {
      ...((await get(params)).data as Record<string, unknown>),
      revisionId: undefined,
    },
  });
  expect(
    await reconcileDriveReview(value.config, async () => "", value.ports),
  ).toEqual({
    review_blocked: 1,
  });
  expect(submissions).toBe(0);
});

async function productionFixture() {
  const value = await fixture(false);
  const { config, documents } = value;
  const source =
    `const documents=${JSON.stringify(Object.fromEntries(documents))};
export const nativeMarkdown=document=>document.text;
export async function googleApi(identity){if(identity!=="service-account")throw Error("IDENTITY_MISMATCH");
return {drive:{files:{get:async({fileId})=>({data:{id:fileId,name:fileId.slice(3),mimeType:"application/vnd.google-apps.document",parents:["folder"],trashed:false}})}},
docs:{documents:{get:async({documentId})=>({data:documents[documentId]})}}};}` +
    "\n/*" +
    "x".repeat(5 * 1024 * 1024) +
    "*/\n";
  const validator =
    "export const preflight=()=>{throw Error('UNEXPECTED_PREFLIGHT')}; export const apply=()=>{throw Error('UNEXPECTED_APPLY')}; export const refreshRevisions=()=>{throw Error('UNEXPECTED_REFRESH')};";
  await Promise.all([
    writeFile(config.ownerModule.path, source, { mode: 0o600 }),
    writeFile(config.validatorModule.path, validator, { mode: 0o600 }),
  ]);
  config.ownerModule.sha256 = digest(source);
  config.validatorModule.sha256 = digest(validator);
  return value;
}

test("production loading accepts SHA-pinned private owner modules above the document limit without network or tasks", async () => {
  const { config } = await productionFixture();
  expect((await stat(config.ownerModule.path)).size).toBeGreaterThan(
    4 * 1024 * 1024,
  );
  const network = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      () => {
        throw Error("UNEXPECTED_NETWORK");
      },
      {
        preconnect: () => {
          throw Error("UNEXPECTED_PRECONNECT");
        },
      },
    ),
  );
  try {
    expect(
      await reconcileDriveReview(config, async () => {
        throw Error("UNEXPECTED_CLI");
      }),
    ).toEqual({ unchanged: 7, verified: 7 });
    expect(network).not.toHaveBeenCalled();
    expect(await readdir(config.receiptRoot)).toEqual([]);
    expect(await Bun.file(config.tokenFile).exists()).toBe(false);
  } finally {
    network.mockRestore();
  }
});

test.each([
  "sha",
  ...(POSIX_MODES ? ["permissions"] : []),
  "hardlink",
  "oversize",
])(
  "production module loading preserves the %s guard before imports",
  async (kind) => {
    const { config } = await productionFixture();
    if (kind === "sha") config.ownerModule.sha256 = "f".repeat(64);
    if (kind === "permissions") await chmod(config.ownerModule.path, 0o644);
    if (kind === "hardlink")
      await link(config.ownerModule.path, config.ownerModule.path + ".linked");
    if (kind === "oversize") {
      const file = await open(config.ownerModule.path, "r+");
      try {
        await file.truncate(64 * 1024 * 1024 + 1);
      } finally {
        await file.close();
      }
    }
    await expect(
      reconcileDriveReview(config, async () => {
        throw Error("UNEXPECTED_CLI");
      }),
    ).rejects.toThrow(
      kind === "sha" ? "OWNER_MODULE_CHANGED" : "UNSAFE_PRIVATE_FILE",
    );
    expect(await readdir(config.receiptRoot)).toEqual([]);
  },
);

test("production module allowance leaves the four-MiB document bound intact", async () => {
  const { config } = await productionFixture();
  const file = await open(join(config.home, "AGENTS.md"), "r+");
  try {
    await file.truncate(4 * 1024 * 1024 + 1);
  } finally {
    await file.close();
  }
  await expect(
    reconcileDriveReview(config, async () => {
      throw Error("UNEXPECTED_CLI");
    }),
  ).rejects.toThrow("UNSAFE_PRIVATE_FILE");
  expect(await readdir(config.receiptRoot)).toEqual([]);
});
