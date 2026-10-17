// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop -- Requests are bounded and only one finite collection is claimed per tick. */
import { chmod, lstat, mkdir, realpath, readdir, rename } from "node:fs/promises";
import { Database } from "bun:sqlite";
import { watch } from "node:fs";
import { join } from "node:path";
import {
  applySourceJob,
  planSourceJob,
  validSourceCollectionReceipt,
  type SourceJobConfig,
  type SourceJobPlan,
  type SourceJobPorts,
} from "./shenron-source-job.ts";

const logicalConfig = "/app/data/source-pipeline/config.json";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest = (bytes: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
export interface SourceOutboxRequest {
  schema: "shenron-source-request/v1";
  requestId: string;
  configPath: string;
  configSha256: string;
}
interface OutboxPorts extends SourceJobPorts {
  plan?: (config: SourceJobConfig, ports: SourceJobPorts) => Promise<SourceJobPlan>;
  apply?: typeof applySourceJob;
}
async function privatePath(path: string, directory = false) {
  const info = await lstat(path);
  if (
    (await realpath(path)) !== path ||
    info.isSymbolicLink() ||
    (directory ? !info.isDirectory() : !info.isFile()) ||
    info.uid !== (process.getuid?.() ?? 1000) ||
    info.mode & 0o077
  )
    throw new Error("Unsafe private source control path");
}
async function privateDirectory(path: string) {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as { code?: string }).code !== "EEXIST") throw error;
  }
  await privatePath(path, true);
}
async function load(path: string, maxBytes: number) {
  await privatePath(path);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for await (const chunk of Bun.file(path).stream()) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error("Source control record exceeds budget");
    chunks.push(new Uint8Array(chunk));
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    value: JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    sha256: digest(bytes),
  };
}
async function save(path: string, value: unknown) {
  const temporary = path + "." + crypto.randomUUID() + ".new";
  await Bun.write(temporary, JSON.stringify(value));
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}
export async function drainSourceOutbox(configPath: string, expectedConfigSha256: string, ports: OutboxPorts = {}) {
  if (!/^[a-f0-9]{64}$/.test(expectedConfigSha256)) throw new Error("Source owner config digest is required");
  const owner = await load(configPath, 16384);
  if (owner.sha256 !== expectedConfigSha256) throw new Error("Source owner config digest differs");
  const config = owner.value as SourceJobConfig;
  if (config.version !== 1 || config.type !== "shenron-source-vpn")
    throw new Error("Source control requires the approved typed job");
  await privatePath(config.dataRoot, true);
  const control = join(config.dataRoot, "control");
  await privateDirectory(control);
  for (const child of ["requests", "responses", "jobs"]) await privateDirectory(join(control, child));
  const mutexPath = join(control, "controller.sqlite");
  if (await Bun.file(mutexPath).exists()) await privatePath(mutexPath);
  const mutex = new Database(mutexPath, { create: true });
  try {
    await chmod(mutexPath, 0o600);
    mutex.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
  } catch (error) {
    mutex.close();
    if ((error as { code?: string }).code === "SQLITE_BUSY") return { status: "busy" as const, handled: 0 };
    throw error;
  }
  try {
    const names = await readdir(join(control, "requests"));
    if (names.length > 128) throw new Error("Source request mailbox exceeds budget");
    for (const name of names.toSorted()) {
      const requestPath = join(control, "requests", name);
      // Unsafe filesystem objects require owner intervention; never follow or discard them.
      await privatePath(requestPath);
      const reject = async () => {
        const rejected = join(control, "jobs", "rejected-" + crypto.randomUUID());
        await privateDirectory(rejected);
        await save(join(rejected, "rejection.json"), {
          schema: "shenron-source-rejection/v1",
          errorCode: "ERR_SOURCE_JOB_COLLECTION_FAILED",
          at: new Date().toISOString(),
        });
        // Preserve the original bytes privately, without parsing or echoing untrusted payloads.
        await rename(requestPath, join(rejected, "request.json"));
        return { status: "failed" as const, handled: 1 };
      };
      if (!name.endsWith(".json") || !uuid.test(name.slice(0, -5))) return await reject();
      const requestId = name.slice(0, -5),
        responsePath = join(control, "responses", name);
      if (await Bun.file(responsePath).exists()) {
        await privatePath(responsePath);
        const answered = join(control, "jobs", requestId);
        await privateDirectory(answered);
        await rename(requestPath, join(answered, "answered-request.json"));
        continue;
      }
      let request: Awaited<ReturnType<typeof load>>;
      try {
        request = await load(requestPath, 4096);
      } catch {
        return await reject();
      }
      const value = request.value as SourceOutboxRequest;
      if (
        !value ||
        typeof value !== "object" ||
        value.schema !== "shenron-source-request/v1" ||
        value.requestId !== requestId ||
        value.configPath !== logicalConfig ||
        !/^[a-f0-9]{64}$/.test(value.configSha256) ||
        Object.keys(value).some(key => !["schema", "requestId", "configPath", "configSha256"].includes(key))
      )
        return await reject();
      const job = join(control, "jobs", requestId);
      await privateDirectory(job);
      const started = join(job, "started.json");
      if (await Bun.file(started).exists()) {
        const resultPath = join(job, "result.json");
        if (await Bun.file(resultPath).exists()) {
          const fence = (await load(started, 4096)).value as Record<string, unknown>;
          const replay = (await load(resultPath, 65536)).value as Awaited<ReturnType<typeof applySourceJob>>;
          if (
            fence.requestSha256 !== request.sha256 ||
            fence.ownerConfigSha256 !== expectedConfigSha256 ||
            replay.stage !== "collection-only" ||
            replay.pipelineComplete !== false ||
            !validSourceCollectionReceipt(
              replay.collection,
              String(fence.collectionSchema ?? "shenron-source-collection/v1"),
              value.configSha256,
            )
          )
            throw new Error("Source result replay binding differs");
          await save(responsePath, {
            schema: "shenron-source-response/v1",
            requestId,
            configSha256: value.configSha256,
            status: "complete",
            collection: replay.collection,
          });
          return { status: "complete" as const, handled: 1, requestId };
        }
        await save(responsePath, {
          schema: "shenron-source-response/v1",
          requestId,
          configSha256: value.configSha256,
          status: "failed",
          errorCode: "ERR_SOURCE_JOB_STATE_UNCERTAIN",
        });
        return { status: "failed" as const, handled: 1, requestId };
      }
      await save(join(job, "request.json"), value);
      let status: "complete" | "failed" = "failed";
      try {
        const plan = await (ports.plan ?? planSourceJob)(config, ports);
        if (plan.pipelineConfigSha256 !== value.configSha256) throw new Error("Source request config is stale");
        const planSha256 = digest(JSON.stringify(plan));
        await save(join(job, "plan.json"), plan);
        await save(started, {
          requestSha256: request.sha256,
          ownerConfigSha256: expectedConfigSha256,
          planSha256,
          collectionSchema: plan.collectionSchema ?? "shenron-source-collection/v1",
          at: new Date().toISOString(),
        });
        const cancelled = new AbortController();
        const checkCancellation = () => {
          void Bun.file(requestPath)
            .exists()
            .then(exists => {
              if (!exists) cancelled.abort(new Error("Source collection requester left"));
              return exists;
            })
            .catch(() => cancelled.abort(new Error("Source request ownership unavailable")));
        };
        const watcher = watch(join(control, "requests"), (_event, filename) => {
          if (!filename || filename.toString() === name) checkCancellation();
        });
        let result: Awaited<ReturnType<typeof applySourceJob>>;
        try {
          if (!(await Bun.file(requestPath).exists())) cancelled.abort(new Error("Source collection requester left"));
          const signal = ports.signal ? AbortSignal.any([ports.signal, cancelled.signal]) : cancelled.signal;
          signal.throwIfAborted();
          result = await (ports.apply ?? applySourceJob)(plan, planSha256, {
            ...ports,
            signal,
          });
        } finally {
          watcher.close();
        }
        if (
          result.stage !== "collection-only" ||
          result.pipelineComplete !== false ||
          !validSourceCollectionReceipt(
            result.collection,
            plan.collectionSchema ?? "shenron-source-collection/v1",
            value.configSha256,
          )
        )
          throw new Error("Source worker returned an invalid handoff");
        const response = {
          schema: "shenron-source-response/v1",
          requestId,
          configSha256: value.configSha256,
          status: "complete",
          collection: result.collection,
        };
        if (JSON.stringify(response).length > 65536) throw new Error("Source response exceeds budget");
        await save(join(job, "result.json"), result);
        await save(responsePath, response);
        status = "complete";
      } catch {
        await save(responsePath, {
          schema: "shenron-source-response/v1",
          requestId,
          configSha256: value.configSha256,
          status: "failed",
          errorCode: "ERR_SOURCE_JOB_COLLECTION_FAILED",
        });
      }
      return { status, handled: 1, requestId };
    }
    return { status: "idle" as const, handled: 0 };
  } finally {
    try {
      mutex.exec("ROLLBACK");
    } finally {
      mutex.close();
    }
  }
}
