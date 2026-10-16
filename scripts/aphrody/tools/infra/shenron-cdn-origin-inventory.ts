// SPDX-License-Identifier: Apache-2.0
/** Infra owns the native CDN inventory pointer; the product owns the immutable candidate. */
import { lstat, open, rename, unlink, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { assertConsumerFile } from "./shenron-cdn-origin-consumer";

const CONFIG = "/etc/aphrody/cloudflare/origin-cdn.json";
const CODE = "/etc/aphrody/cloudflare/cli/cdn-origin.mjs";
const UNIT = "/etc/systemd/system/shenron-cdn-origin.service";
const SERVICE = "shenron-cdn-origin.service";
const digest = (bytes: Uint8Array | string) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
export class OriginNotReadyError extends Error {}
/** Scheduled retries absorb a cold service socket; integrity errors remain terminal. */
export async function originReadiness<T>(
  probe: (signal: AbortSignal) => Promise<T>,
  budgetMs = 15000,
  schedule: (callback: () => void, delay: number) => unknown = setTimeout,
  now: () => number = Date.now,
): Promise<T> {
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 100 || budgetMs > 15000)
    throw Error("Bounded origin readiness deadline required");
  const started = now(),
    signal = AbortSignal.timeout(budgetMs);
  let delay = 100;
  async function attempt(): Promise<T> {
    try {
      return await probe(signal);
    } catch (error) {
      if (
        !(error instanceof OriginNotReadyError) ||
        signal.aborted ||
        budgetMs - (now() - started) <= delay
      )
        throw error;
      await new Promise<void>((complete) => schedule(complete, delay));
      delay = Math.min(delay * 2, 1500);
      return attempt();
    }
  }
  return attempt();
}
type Configuration = Record<string, unknown> & {
  inventoryPath: string;
  inventorySha256: string;
  manifestPrefix: string;
};
export interface OriginInventoryPins {
  configSha256: string;
  consumerCodeSha256: string;
  unitSha256: string;
  inventorySha256: string;
  manifestPrefix: string;
  inventoryRoot: string;
  backupReceipt: string;
  backupReceiptSha256: string;
  publisherLock: string;
}
export interface OriginInventoryPorts {
  readConfig(): Promise<{ config: Configuration; sha256: string }>;
  qualifyInventory(path: string, pins: OriginInventoryPins): Promise<void>;
  qualifyBackup(pins: OriginInventoryPins): Promise<void>;
  replaceConfig(config: Configuration, expectedSha256: string): Promise<void>;
  restart(): Promise<void>;
  attest(config: Configuration): Promise<void>;
}
export async function activateOriginInventory(
  path: string,
  pins: OriginInventoryPins,
  ports: OriginInventoryPorts,
  apply = false,
) {
  for (const hash of [
    pins.configSha256,
    pins.consumerCodeSha256,
    pins.unitSha256,
    pins.inventorySha256,
    pins.backupReceiptSha256,
  ])
    if (!/^[a-f0-9]{64}$/.test(hash))
      throw Error("Complete origin activation pins required");
  if (
    !/^_migration\/manifests\/(?:publication|site)-[a-f0-9]{24}\/$/.test(
      pins.manifestPrefix,
    ) ||
    !pins.manifestPrefix.includes(pins.inventorySha256.slice(0, 24))
  )
    throw Error("Candidate manifest prefix differs from inventory SHA");
  const inside = relative(resolve(pins.inventoryRoot), resolve(path));
  if (!inside || inside.startsWith("..") || isAbsolute(inside))
    throw Error("Candidate inventory outside owner scope");
  const before = await ports.readConfig();
  const current = before.config;
  await ports.qualifyInventory(path, pins);
  if (
    current.inventoryPath === path &&
    current.inventorySha256 === pins.inventorySha256 &&
    current.manifestPrefix === pins.manifestPrefix
  ) {
    await ports.attest(current);
    return {
      applied: false,
      replay: true,
      writes: 0,
      inventorySha256: pins.inventorySha256,
    };
  }
  if (before.sha256 !== pins.configSha256)
    throw Error("Concurrent origin configuration changed");
  const candidate = {
    ...current,
    inventoryPath: path,
    inventorySha256: pins.inventorySha256,
    manifestPrefix: pins.manifestPrefix,
  };
  await ports.qualifyBackup(pins);
  if (!apply)
    return {
      applied: false,
      replay: false,
      writes: 0,
      inventorySha256: pins.inventorySha256,
    };
  await ports.replaceConfig(candidate, pins.configSha256);
  await ports.restart();
  await ports.attest(candidate);
  return {
    applied: true,
    replay: false,
    writes: 1,
    inventorySha256: pins.inventorySha256,
  };
}

async function guarded(path: string, expected?: string) {
  assertConsumerFile(await lstat(path), true);
  const bytes = await Bun.file(path).bytes();
  if (expected && digest(bytes) !== expected)
    throw Error("Concurrent protected input changed");
  return bytes;
}
async function service(args: string[]) {
  const p = Bun.spawn(["systemctl", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15000,
  });
  const [out, exit] = await Promise.all([
    new Response(p.stdout).text(),
    p.exited,
  ]);
  if (exit !== 0) throw Error("Catalogue service operation failed");
  return out.trim();
}
/** Host paths and service identity are fixed by the canonical Infra catalogue. */
export function nativeOriginInventoryPorts(): OriginInventoryPorts {
  if (process.platform !== "linux" || process.getuid?.() !== 0)
    throw Error("Native DBFR root execution required");
  return {
    async readConfig() {
      const bytes = await guarded(CONFIG);
      return {
        config: JSON.parse(new TextDecoder().decode(bytes)),
        sha256: digest(bytes),
      };
    },
    async qualifyInventory(path, pins) {
      const lock = await lstat(pins.publisherLock);
      if (
        !lock.isDirectory() ||
        lock.isSymbolicLink() ||
        lock.uid !== 0 ||
        lock.mode & 0o077 ||
        !pins.publisherLock.endsWith("/publish.lock")
      )
        throw Error("Canonical publisher lock required");
      const scoped = relative(
        await realpath(pins.inventoryRoot),
        await realpath(path),
      );
      if (!scoped || scoped.startsWith("..") || isAbsolute(scoped))
        throw Error("Inventory escaped owner root");
      await guarded(CODE, pins.consumerCodeSha256);
      assertConsumerFile(await lstat(UNIT), false);
      if (
        digest(await Bun.file(UNIT).bytes()) !== pins.unitSha256 ||
        (await service(["show", SERVICE, "--value", "-p", "FragmentPath"])) !==
          UNIT
      )
        throw Error("Catalogue consumer unit changed");
      await guarded(path, pins.inventorySha256);
      const config = await Bun.file(CONFIG).json();
      const manifest = await Bun.file(config.manifest).json();
      const authorization = new TextDecoder()
        .decode(await guarded("/etc/aphrody/cloudflare/api-token"))
        .trim();
      const r = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${manifest.accountId}/workers/scripts/${manifest.worker}/settings`,
        {
          headers: { authorization: `Bearer ${authorization}` },
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!r.ok) throw Error("Worker manifest unavailable");
      const settings = (await r.json()).result;
      if (
        settings.bindings.find(
          (b: { name: string; text?: string }) => b.name === "MANIFEST_PREFIX",
        )?.text !== pins.manifestPrefix
      )
        throw Error("Worker candidate pointer differs");
      const publisherModule = "/etc/aphrody/cloudflare/cli/publish-catalog.ts";
      const owner = await import(publisherModule);
      owner.inventoryMatchesBindings(
        (await Bun.file(path).json()).entries,
        settings.bindings,
      );
    },
    async qualifyBackup(pins) {
      const bytes = await guarded(pins.backupReceipt, pins.backupReceiptSha256);
      const receipt = JSON.parse(new TextDecoder().decode(bytes));
      if (
        receipt.schema !== "aphrody-off-host-snapshot/v1" ||
        receipt.sourceHost !== "dbfr" ||
        receipt.backupHost !== "vps" ||
        receipt.snapshotSha256 !== pins.configSha256 ||
        receipt.verified !== true ||
        typeof receipt.backupPath !== "string" ||
        !receipt.backupPath.startsWith("/")
      )
        throw Error("Verified off-host configuration backup required");
    },
    async replaceConfig(config, expected) {
      const temporary = CONFIG + ".next";
      const fd = await open(temporary, "wx", 0o400);
      try {
        await fd.writeFile(JSON.stringify(config));
        await fd.sync();
        await fd.close();
        await guarded(CONFIG, expected);
        await rename(temporary, CONFIG);
      } catch (error) {
        await fd.close().catch(() => undefined);
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
    },
    async restart() {
      await service(["restart", SERVICE]);
      if ((await service(["is-active", SERVICE])) !== "active")
        throw Error("Native CDN service inactive");
    },
    async attest(config) {
      const codeSha256 = digest(await guarded(CODE));
      await originReadiness(async (signal) =>
        Promise.all(
          [
            "https://cdn.dragonballfr.com",
            "https://origin-cdn.dragonballfr.com",
          ].map(async (origin) => {
            let r: Response;
            try {
              r = await fetch(origin + "/.well-known/shenron-cdn-origin.json", {
                credentials: "omit",
                redirect: "error",
                signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
                headers: { "Cache-Control": "no-cache" },
              });
            } catch {
              throw new OriginNotReadyError("Native CDN socket is warming");
            }
            if ([502, 503, 504].includes(r.status))
              throw new OriginNotReadyError("Native CDN service is warming");
            if (!r.ok) throw Error("Native CDN attestation unavailable");
            const actual = await r.json();
            if (
              actual.manifestPrefix !== config.manifestPrefix ||
              actual.inventorySha256 !== config.inventorySha256 ||
              actual.codeSha256 !== codeSha256
            )
              throw Error("Native CDN attestation differs");
          }),
        ),
      );
    },
  };
}
export type OriginInventoryActivationConfig = Omit<
  OriginInventoryPins,
  "inventorySha256" | "manifestPrefix" | "publisherLock"
>;
export interface OriginInventoryCandidate {
  inventoryPath: string;
  inventorySha256: string;
  manifestPrefix: string;
  publisherLock: string;
}
/** Publisher invokes this capability after its Worker CAS, while its canonical lock remains held. */
export function createOriginInventoryActivation(value: unknown) {
  const keys = [
    "configSha256",
    "consumerCodeSha256",
    "unitSha256",
    "inventoryRoot",
    "backupReceipt",
    "backupReceiptSha256",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every(
      (key) =>
        Object.hasOwn(value, key) &&
        typeof (value as Record<string, unknown>)[key] === "string",
    )
  )
    throw Error("Exact origin activation configuration required");
  const config = value as OriginInventoryActivationConfig;
  if (
    ![
      config.configSha256,
      config.consumerCodeSha256,
      config.unitSha256,
      config.backupReceiptSha256,
    ].every((hash) => /^[a-f0-9]{64}$/.test(hash)) ||
    !isAbsolute(config.inventoryRoot) ||
    !isAbsolute(config.backupReceipt)
  )
    throw Error("Qualified origin configuration pins required");
  return {
    async activate(candidate: OriginInventoryCandidate) {
      const candidateKeys = [
        "inventoryPath",
        "inventorySha256",
        "manifestPrefix",
        "publisherLock",
      ];
      if (
        !candidate ||
        Object.keys(candidate).length !== candidateKeys.length ||
        !candidateKeys.every(
          (key) =>
            Object.hasOwn(candidate, key) &&
            typeof candidate[key as keyof OriginInventoryCandidate] ===
              "string",
        )
      )
        throw Error("Exact publisher candidate required");
      return activateOriginInventory(
        candidate.inventoryPath,
        {
          ...config,
          inventorySha256: candidate.inventorySha256,
          manifestPrefix: candidate.manifestPrefix,
          publisherLock: candidate.publisherLock,
        },
        nativeOriginInventoryPorts(),
        true,
      );
    },
  };
}
if (import.meta.main) {
  const [path, pinsFile, mode] = Bun.argv.slice(2);
  if (!path || !pinsFile || !["--plan", "--apply"].includes(mode ?? ""))
    throw Error("Expected INVENTORY PINS --plan|--apply");
  console.log(
    JSON.stringify(
      await activateOriginInventory(
        path,
        await Bun.file(pinsFile).json(),
        nativeOriginInventoryPorts(),
        mode === "--apply",
      ),
    ),
  );
}
