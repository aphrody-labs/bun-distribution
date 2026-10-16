// SPDX-License-Identifier: Apache-2.0
/** DBFR-local consumer of the pinned product loader; it never implements a CDN writer. */
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { join, posix } from "node:path";
import { assertConsumerFile } from "./shenron-cdn-origin-consumer";

const hash = (bytes: Uint8Array | string) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
type Json = Record<string, unknown>;
export interface SourceConsumerConfiguration {
  productModulePath: string;
  productModuleSha256: string;
  publisherModulePath: string;
  configurationPath: string;
  configurationSha256: string;
  inventoryRoot: string;
}
export interface SourceConsumerRequest {
  publicRoot: string;
  target: string;
  job: string;
  indexSha256: string;
  apply: boolean;
}
export function validateSourceConsumer(
  configuration: SourceConsumerConfiguration,
  request: SourceConsumerRequest,
) {
  const configKeys = [
    "productModulePath",
    "productModuleSha256",
    "publisherModulePath",
    "configurationPath",
    "configurationSha256",
    "inventoryRoot",
  ];
  const requestKeys = ["publicRoot", "target", "job", "indexSha256", "apply"];
  if (
    Object.keys(configuration).length !== configKeys.length ||
    Object.keys(configuration).some((key) => !configKeys.includes(key)) ||
    Object.keys(request).length !== requestKeys.length ||
    Object.keys(request).some((key) => !requestKeys.includes(key))
  )
    throw Error("Exact consumer configuration and request required");
  for (const path of [
    configuration.productModulePath,
    configuration.publisherModulePath,
    configuration.configurationPath,
    configuration.inventoryRoot,
    request.publicRoot,
    request.job,
  ])
    if (!posix.isAbsolute(path) || posix.resolve(path) !== path)
      throw Error("Normalized absolute owner paths required");
  for (const sha of [
    configuration.productModuleSha256,
    configuration.configurationSha256,
    request.indexSha256,
  ])
    if (!/^[a-f0-9]{64}$/.test(sha))
      throw Error("Complete consumer SHA256 pins required");
  if (
    !configuration.publisherModulePath
      .replaceAll("\\", "/")
      .endsWith("/cloudflare/cli/publish-catalog.ts") ||
    typeof request.apply !== "boolean"
  )
    throw Error("Canonical publisher and explicit operation required");
  const target = new URL(request.target);
  if (
    target.origin !== "https://dragonballfr.com" ||
    !/^\/publications\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target.pathname) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  )
    throw Error("Unsupported public target");
  const inside = posix.relative(
    configuration.inventoryRoot,
    request.publicRoot,
  );
  const job = posix.relative(
    posix.join(configuration.inventoryRoot, "source-cdn-consumer-jobs"),
    request.job,
  );
  if (
    !inside ||
    inside.startsWith("..") ||
    posix.isAbsolute(inside) ||
    !job ||
    job.startsWith("..") ||
    posix.isAbsolute(job) ||
    job.includes("/") ||
    job.includes("\\")
  )
    throw Error("Consumer inputs/job escaped their declared private scopes");
}
export interface SourceConsumerPorts {
  qualify(): Promise<void>;
  execute(): Promise<unknown>;
  receipt(value: Json): Promise<void>;
}
export async function consumeSourcePublication(
  configuration: SourceConsumerConfiguration,
  request: SourceConsumerRequest,
  ports: SourceConsumerPorts,
) {
  validateSourceConsumer(configuration, request);
  await ports.qualify();
  const result = await ports.execute();
  if (!result || typeof result !== "object")
    throw Error("Product consumer returned no proof");
  const value = result as Json;
  if (value.noChange === true && value.writes !== 0)
    throw Error("No-change product proof reports writes");
  if (!request.apply && !/^[a-f0-9]{64}$/.test(String(value.planSha256)))
    throw Error("Readonly product plan identity missing");
  if (
    request.apply &&
    (value.complete !== true ||
      value.indexSha256 !== request.indexSha256 ||
      !/^[a-f0-9]{64}$/.test(String(value.inventorySha256)))
  )
    throw Error("Product publication proof differs");
  const receipt = {
    schema: "aphrody-source-cdn-consumer/v1",
    applied: request.apply,
    noChange: value.noChange === true,
    publisherWrites: value.noChange === true ? 0 : null,
    indexSha256: request.indexSha256,
    productModuleSha256: configuration.productModuleSha256,
    configurationSha256: configuration.configurationSha256,
    target: request.target,
    requestSha256: hash(JSON.stringify(request)),
    result,
  };
  await ports.receipt(receipt);
  return receipt;
}
async function guarded(path: string, bound: number) {
  const info = await lstat(path);
  assertConsumerFile(info, true);
  if (info.size > bound) throw Error("Consumer owner file exceeds bound");
  return Bun.file(path).bytes();
}
async function privateDirectory(path: string) {
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== 0 ||
    info.mode & 0o077 ||
    (await realpath(path)) !== path
  )
    throw Error("Root-owned private consumer directory required");
}
/** This operation must be invoked through Infra on DBFR with a bounded process timeout. */
export async function runNativeSourceConsumer(
  configuration: SourceConsumerConfiguration,
  request: SourceConsumerRequest,
) {
  if (process.platform !== "linux" || process.getuid?.() !== 0)
    throw Error("DBFR root consumer context required");
  validateSourceConsumer(configuration, request);
  const jobs = join(configuration.inventoryRoot, "source-cdn-consumer-jobs");
  const moduleBytes = await guarded(
    configuration.productModulePath,
    1024 * 1024,
  );
  const configBytes = await guarded(configuration.configurationPath, 32768);
  if (
    hash(moduleBytes) !== configuration.productModuleSha256 ||
    hash(configBytes) !== configuration.configurationSha256
  )
    throw Error("Pinned product/configuration changed");
  const publisherConfig = JSON.parse(new TextDecoder().decode(configBytes));
  if (
    publisherConfig.inventoryRoot !== configuration.inventoryRoot ||
    publisherConfig.nativeOriginPreparation?.input?.inventoryRoot !==
      configuration.inventoryRoot
  )
    throw Error("Consumer belongs to another private inventory scope");
  const publicInfo = await lstat(request.publicRoot);
  if (
    !publicInfo.isDirectory() ||
    publicInfo.isSymbolicLink() ||
    (await realpath(request.publicRoot)) !== request.publicRoot
  )
    throw Error("Consumer public inputs escaped their private root");
  const index = join(
    request.publicRoot,
    new URL(request.target).pathname.slice(1),
    "index.json",
  );
  const publicIndex = async () => {
    const info = await lstat(index);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > 2 * 1024 * 1024 ||
      (await realpath(index)) !== index
    )
      throw Error("Pinned public producer index is not a bounded regular file");
    return Bun.file(index).bytes();
  };
  const indexBytes = await publicIndex();
  const document = JSON.parse(new TextDecoder().decode(indexBytes));
  if (
    hash(indexBytes) !== request.indexSha256 ||
    !new Set(["shenron-manga-cdn/v1", "shenron-source-publication/v1"]).has(
      document.schema,
    )
  )
    throw Error("Only pinned public producer indexes are accepted");
  await mkdir(jobs, { mode: 0o700, recursive: true });
  await privateDirectory(jobs);
  await mkdir(request.job, { mode: 0o700, recursive: true });
  await privateDirectory(request.job);
  await mkdir(join(request.job, "cdn"), { mode: 0o700, recursive: true });
  await privateDirectory(join(request.job, "cdn"));
  const productUrl = Bun.pathToFileURL(configuration.productModulePath);
  productUrl.searchParams.set("sha256", configuration.productModuleSha256);
  const product = await import(productUrl.href);
  if (
    typeof product.installedPublisher !== "function" ||
    typeof product.publishQualified !== "function"
  )
    throw Error("Qualified product loader exports unavailable");
  const envModule = process.env.SHENRON_SOURCE_CDN_MODULE,
    envConfig = process.env.SHENRON_SOURCE_CDN_CONFIG;
  try {
    process.env.SHENRON_SOURCE_CDN_MODULE = configuration.publisherModulePath;
    process.env.SHENRON_SOURCE_CDN_CONFIG = configuration.configurationPath;
    return await consumeSourcePublication(configuration, request, {
      async qualify() {
        if (
          hash(await guarded(configuration.configurationPath, 32768)) !==
            configuration.configurationSha256 ||
          hash(await publicIndex()) !== request.indexSha256
        )
          throw Error("Consumer pins changed before invocation");
      },
      async execute() {
        const publisher = await product.installedPublisher(
          request.publicRoot,
          request.target,
          request.job,
        );
        if (!publisher) throw Error("Product publisher was not configured");
        return request.apply
          ? product.publishQualified(publisher)
          : publisher.plan();
      },
      async receipt(value) {
        const file = await open(
          join(request.job, "consumer-receipt.json"),
          "wx",
          0o600,
        );
        try {
          await file.writeFile(JSON.stringify(value));
          await file.sync();
        } finally {
          await file.close();
        }
      },
    });
  } finally {
    if (envModule === undefined) delete process.env.SHENRON_SOURCE_CDN_MODULE;
    else process.env.SHENRON_SOURCE_CDN_MODULE = envModule;
    if (envConfig === undefined) delete process.env.SHENRON_SOURCE_CDN_CONFIG;
    else process.env.SHENRON_SOURCE_CDN_CONFIG = envConfig;
  }
}
if (import.meta.main) {
  const stdin = Bun.argv.length === 6 && Bun.argv[3] === "--stdin";
  if (!stdin && Bun.argv.length !== 4)
    throw Error(
      "consumer requires pinned private configuration and request JSON files",
    );
  const configBytes = await guarded(Bun.argv[2]!, 32768);
  if (
    stdin &&
    (hash(await guarded(import.meta.path, 1024 * 1024)) !== Bun.argv[4] ||
      hash(configBytes) !== Bun.argv[5])
  )
    throw Error("Transport consumer/configuration SHA changed");
  const configuration = JSON.parse(new TextDecoder().decode(configBytes));
  let requestBytes: Uint8Array;
  if (stdin) {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of Bun.stdin.stream()) {
      size += chunk.byteLength;
      if (size > 32768) throw Error("Consumer request exceeds bound");
      chunks.push(chunk);
    }
    requestBytes = new Uint8Array(
      await new Blob(
        chunks.map((chunk) => new Uint8Array(chunk)),
      ).arrayBuffer(),
    );
  } else requestBytes = await guarded(Bun.argv[3]!, 32768);
  const request = JSON.parse(new TextDecoder().decode(requestBytes));
  const result = await runNativeSourceConsumer(configuration, request);
  console.log(
    JSON.stringify({
      qualified: true,
      applied: result.applied,
      noChange: result.noChange,
      publisherWrites: result.publisherWrites,
      indexSha256: result.indexSha256,
      receiptPath: join(request.job, "consumer-receipt.json"),
    }),
  );
}
export interface SourceConsumerTransport {
  host: "dbfr";
  consumerModulePath: string;
  consumerModuleSha256: string;
  configurationPath: string;
  configurationSha256: string;
}
/** Plain JSON handoff of approved DBFR-staged inputs; no capture bytes or owner credentials cross hosts. */
export function sourceConsumerCommand(
  transport: SourceConsumerTransport,
  request: SourceConsumerRequest,
) {
  const keys = [
    "host",
    "consumerModulePath",
    "consumerModuleSha256",
    "configurationPath",
    "configurationSha256",
  ];
  if (
    Object.keys(transport).length !== keys.length ||
    Object.keys(transport).some((key) => !keys.includes(key)) ||
    transport.host !== "dbfr"
  )
    throw Error("Exact DBFR consumer transport required");
  for (const path of [
    transport.consumerModulePath,
    transport.configurationPath,
  ])
    if (!/^\/[A-Za-z0-9/._-]+$/.test(path) || posix.resolve(path) !== path)
      throw Error("Safe absolute owner transport path required");
  for (const sha of [
    transport.consumerModuleSha256,
    transport.configurationSha256,
  ])
    if (!/^[a-f0-9]{64}$/.test(sha))
      throw Error("Complete transport SHA pins required");
  const bytes = JSON.stringify(request);
  if (new TextEncoder().encode(bytes).byteLength > 32768)
    throw Error("Transport request exceeds bound");
  return {
    command: `sudo -n timeout 900 /home/ubuntu/.local/share/aphrody/cloudflare-cli/runtime/bun ${transport.consumerModulePath} ${transport.configurationPath} --stdin ${transport.consumerModuleSha256} ${transport.configurationSha256}`,
    input: bytes,
    timeoutMs: 930000,
  };
}
export async function submitSourceConsumer(
  transport: SourceConsumerTransport,
  request: SourceConsumerRequest,
) {
  const invocation = sourceConsumerCommand(transport, request);
  const child = Bun.spawn(
    [
      "ssh",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=15",
      transport.host,
      invocation.command,
    ],
    {
      stdin: new Blob([invocation.input]),
      stdout: "pipe",
      stderr: "ignore",
      timeout: invocation.timeoutMs,
    },
  );
  const [output, exit] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  if (exit !== 0 || output.length > 32768)
    throw Error("DBFR owner consumer invocation failed");
  const result = JSON.parse(output);
  if (
    result.qualified !== true ||
    result.applied !== request.apply ||
    result.indexSha256 !== request.indexSha256
  )
    throw Error("DBFR owner consumer response differs");
  return result as {
    qualified: true;
    applied: boolean;
    noChange: boolean;
    publisherWrites: number | null;
    indexSha256: string;
    receiptPath: string;
  };
}
