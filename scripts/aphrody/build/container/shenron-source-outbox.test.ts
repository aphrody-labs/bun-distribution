// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop -- Each private fixture mutation must complete before its request is drained. */
import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drainSourceOutbox } from "./shenron-source-outbox";
import type { SourceJobConfig, SourceJobPlan } from "./shenron-source-job";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const sha = (value: string) =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");
async function fixture(batchMode = false) {
  const root = await mkdtemp(join(tmpdir(), "shenron-outbox-"));
  roots.push(root);
  const dataRoot = join(root, "data");
  await mkdir(dataRoot, { mode: 0o700 });
  const control = join(dataRoot, "control");
  await mkdir(control, { mode: 0o700 });
  await mkdir(join(control, "requests"), { mode: 0o700 });
  const pin = sha("fixture");
  const config: SourceJobConfig = {
    version: 1,
    type: "shenron-source-vpn",
    host: "dbfr",
    dataRoot,
    imageId: "sha256:" + pin,
    runtime: { path: join(root, "runtime"), sha256: pin },
    bundle: { path: join(root, "pipeline.mjs"), sha256: pin },
    resources: { path: join(root, "resources"), relaysSha256: pin },
    vpnStateRoot: join(root, "vpn"),
    pipelineConfig: join(dataRoot, "config.json"),
    googleJar: join(root, "cookies.json"),
  };
  const configPath = join(root, "owner.json"),
    configBytes = JSON.stringify(config);
  await Bun.write(configPath, configBytes);
  await chmod(configPath, 0o600);
  const requestId = crypto.randomUUID(),
    configSha256 = sha("fixed pipeline config");
  const request = {
    schema: "shenron-source-request/v1",
    requestId,
    configPath: "/app/data/source-pipeline/config.json",
    configSha256,
  };
  const requestPath = join(control, "requests", requestId + ".json");
  await Bun.write(requestPath, JSON.stringify(request));
  await chmod(requestPath, 0o600);
  const plan: SourceJobPlan = {
    schema: "shenron-source-vpn-job/v1",
    config,
    pipelineConfigSha256: configSha256,
    configSha256: sha(configBytes),
    hostNetns: "fixture-net",
    hostMountns: "fixture-mount",
    hostDnsSha256: pin,
    hostRouteSha256: pin,
    hostIdentitySha256: pin,
    googleJarSha256: pin,
    collectionSchema: batchMode
      ? "shenron-source-collection/v2"
      : "shenron-source-collection/v1",
  };
  let applies = 0;
  const collection = {
    schema: batchMode
      ? "shenron-source-collection/v2"
      : "shenron-source-collection/v1",
    configSha256,
    pinnedConfigPath: "/app/data/source-pipeline/pinned.json",
    pinnedConfigSha256: sha("pinned"),
    collectionSha256: sha("collection"),
    artifactsSha256: sha("artifacts"),
    revisionIdentity: sha("revision"),
    ...(batchMode
      ? {
          collectionPath:
            "/app/data/source-pipeline/revision/batch-collections/0-1.json",
          artifactOnly: true,
          complete: false,
          deliveryAuthorized: false,
          batch: {
            sourceSha256: sha("source"),
            manifestPath: "/app/data/source-pipeline/revision/membership.json",
            manifestSha256: sha("membership"),
            batchReceiptPath: "/app/data/source-pipeline/revision/batch.json",
            batchReceiptSha256: sha("batch"),
            exportPath: "/app/data/source-pipeline/revision/export.jsonl",
            exportSha256: sha("export"),
            validationPath:
              "/app/data/source-pipeline/revision/validation.json",
            validationSha256: sha("validation"),
            cursor: 0,
            nextCursor: 1,
            totalDocuments: 2,
            exportComplete: false,
            validationComplete: true,
          },
        }
      : {}),
  };
  const ports = {
    plan: async () => plan,
    apply: async () => {
      applies++;
      return {
        collected: true,
        stage: "collection-only" as const,
        pipelineComplete: false,
        receiptPath: "private",
        receiptSha256: sha("receipt"),
        collection,
      };
    },
  };
  return {
    root,
    control,
    configPath,
    ownerSha: sha(configBytes),
    request,
    requestId,
    requestPath,
    ports,
    collection,
    plan,
    applies: () => applies,
  };
}
test("fixed profile drains one bounded request with saved plan and canonical collection response", async () => {
  const f = await fixture();
  expect(await drainSourceOutbox(f.configPath, f.ownerSha, f.ports)).toEqual({
    status: "complete",
    handled: 1,
    requestId: f.requestId,
  });
  const responsePath = join(f.control, "responses", f.requestId + ".json"),
    response = await Bun.file(responsePath).json();
  expect(response.schema).toBe("shenron-source-response/v1");
  expect(response.collection.configSha256).toBe(f.request.configSha256);
  expect((await stat(responsePath)).mode & 0o777).toBe(0o600);
  expect(
    await Bun.file(join(f.control, "jobs", f.requestId, "plan.json")).exists(),
  ).toBe(true);
  expect(
    (await drainSourceOutbox(f.configPath, f.ownerSha, f.ports)).status,
  ).toBe("idle");
  expect(f.applies()).toBe(1);
});
test("v2 outbox keeps the strict v1 request and replays the saved artifact-only handoff", async () => {
  const f = await fixture(true);
  expect(Object.keys(f.request).toSorted()).toEqual([
    "configPath",
    "configSha256",
    "requestId",
    "schema",
  ]);
  expect(
    (await drainSourceOutbox(f.configPath, f.ownerSha, f.ports)).status,
  ).toBe("complete");
  const responsePath = join(f.control, "responses", f.requestId + ".json");
  const response = await Bun.file(responsePath).json();
  expect(response.schema).toBe("shenron-source-response/v1");
  expect(response.collection).toEqual(f.collection);
  expect(response.collection).toMatchObject({
    artifactOnly: true,
    complete: false,
    deliveryAuthorized: false,
  });
  await rm(responsePath);
  expect(
    (await drainSourceOutbox(f.configPath, f.ownerSha, f.ports)).status,
  ).toBe("complete");
  expect((await Bun.file(responsePath).json()).collection).toEqual(
    response.collection,
  );
  expect(f.applies()).toBe(1);
  const fence = await Bun.file(
    join(f.control, "jobs", f.requestId, "started.json"),
  ).json();
  expect(fence.collectionSchema).toBe("shenron-source-collection/v2");
});
test("v2 outbox refuses schema drift and malformed references without a successful response", async () => {
  for (const mutate of [
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.collection.schema = "shenron-source-collection/v1";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.collection.batch!.manifestSha256 = "invalid";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.collection.batch!.exportPath = "/app/data/escape.jsonl";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.collection.deliveryAuthorized = true;
    },
  ]) {
    const f = await fixture(true);
    mutate(f);
    expect(
      (await drainSourceOutbox(f.configPath, f.ownerSha, f.ports)).status,
    ).toBe("failed");
    const responsePath = join(f.control, "responses", f.requestId + ".json");
    expect((await Bun.file(responsePath).json()).status).toBe("failed");
    await rm(responsePath);
    expect(
      (await drainSourceOutbox(f.configPath, f.ownerSha, f.ports)).status,
    ).toBe("failed");
    expect(f.applies()).toBe(1);
  }
  const f = await fixture(true);
  await drainSourceOutbox(f.configPath, f.ownerSha, f.ports);
  await rm(join(f.control, "responses", f.requestId + ".json"));
  const resultPath = join(f.control, "jobs", f.requestId, "result.json");
  const saved = await Bun.file(resultPath).json();
  saved.collection.batch.validationSha256 = "invalid";
  await Bun.write(resultPath, JSON.stringify(saved));
  await expect(
    drainSourceOutbox(f.configPath, f.ownerSha, f.ports),
  ).rejects.toThrow("replay binding differs");
  expect(f.applies()).toBe(1);
});
test("arbitrary execution fields and stale config pins fail before collection", async () => {
  const f = await fixture();
  await Bun.write(
    f.requestPath,
    JSON.stringify({ ...f.request, command: "docker arbitrary" }),
  );
  expect(
    (await drainSourceOutbox(f.configPath, f.ownerSha, f.ports)).status,
  ).toBe("failed");
  expect(f.applies()).toBe(0);
  await expect(
    drainSourceOutbox(f.configPath, "0".repeat(64), f.ports),
  ).rejects.toThrow("digest differs");
});
test("malformed orphan is privately quarantined and the next valid request runs", async () => {
  const f = await fixture();
  const orphan = join(
    f.control,
    "requests",
    "00000000-0000-0000-0000-000000000000.json",
  );
  await Bun.write(orphan, "{invalid private request");
  await chmod(orphan, 0o600);
  expect(
    (await drainSourceOutbox(f.configPath, f.ownerSha, f.ports)).status,
  ).toBe("failed");
  expect(f.applies()).toBe(0);
  expect(await Bun.file(orphan).exists()).toBe(false);
  const journals = await readdir(join(f.control, "jobs"));
  expect(journals.length).toBe(1);
  expect(
    await Bun.file(
      join(f.control, "jobs", journals[0]!, "request.json"),
    ).text(),
  ).toBe("{invalid private request");
  expect(
    (await drainSourceOutbox(f.configPath, f.ownerSha, f.ports)).status,
  ).toBe("complete");
  expect(f.applies()).toBe(1);
});
test("a persisted start fence never silently repeats an uncertain collection", async () => {
  const f = await fixture(),
    job = join(f.control, "jobs", f.requestId);
  await mkdir(job, { recursive: true, mode: 0o700 });
  await Bun.write(join(job, "started.json"), "{}");
  await chmod(join(job, "started.json"), 0o600);
  expect(
    (await drainSourceOutbox(f.configPath, f.ownerSha, f.ports)).status,
  ).toBe("failed");
  expect(
    (await Bun.file(join(f.control, "responses", f.requestId + ".json")).json())
      .errorCode,
  ).toBe("ERR_SOURCE_JOB_STATE_UNCERTAIN");
  expect(f.applies()).toBe(0);
});
test("native SQLite control mutex prevents concurrent workers and releases after completion", async () => {
  const f = await fixture();
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve;
    });
  const first = drainSourceOutbox(f.configPath, f.ownerSha, {
    ...f.ports,
    apply: async () => {
      entered();
      await waiting;
      return f.ports.apply();
    },
  });
  await started;
  try {
    expect(
      (await drainSourceOutbox(f.configPath, f.ownerSha, f.ports)).status,
    ).toBe("busy");
  } finally {
    release();
  }
  expect((await first).status).toBe("complete");
  expect(
    (await drainSourceOutbox(f.configPath, f.ownerSha, f.ports)).status,
  ).toBe("idle");
});
test("a saved successful result replays after a response publication interruption", async () => {
  const f = await fixture();
  await drainSourceOutbox(f.configPath, f.ownerSha, f.ports);
  await rm(join(f.control, "responses", f.requestId + ".json"));
  expect(
    (await drainSourceOutbox(f.configPath, f.ownerSha, f.ports)).status,
  ).toBe("complete");
  expect(f.applies()).toBe(1);
});
test("removing the private request aborts its active finite collection", async () => {
  const f = await fixture();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let aborted = false;
  const result = drainSourceOutbox(f.configPath, f.ownerSha, {
    ...f.ports,
    apply: async (_plan, _hash, ports) => {
      entered();
      await new Promise<never>((_, reject) => {
        ports!.signal!.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(Error("cancelled"));
          },
          { once: true },
        );
      });
      throw Error("unreachable");
    },
  });
  await started;
  await rm(f.requestPath);
  expect((await result).status).toBe("failed");
  expect(aborted).toBe(true);
});
