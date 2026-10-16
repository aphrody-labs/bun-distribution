// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import {
  prepareOriginPublication,
  assertPreparationDirectory,
  type OriginPreparationPorts,
  type OriginPreparationInput,
} from "./shenron-cdn-publication-preparation";
const sha = "a".repeat(64),
  other = "b".repeat(64);
test("read-only private scope may belong to ubuntu; writable jobs/state must remain root-owned", () => {
  const scope = {
    uid: 1000,
    mode: 0o700,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  };
  expect(() => assertPreparationDirectory(scope, false)).not.toThrow();
  expect(() => assertPreparationDirectory(scope, true)).toThrow("root-owned");
  expect(() =>
    assertPreparationDirectory({ ...scope, uid: 0 }, true),
  ).not.toThrow();
  expect(() =>
    assertPreparationDirectory({ ...scope, mode: 0o755 }, false),
  ).toThrow("Private");
  expect(() =>
    assertPreparationDirectory({ ...scope, isSymbolicLink: () => true }, false),
  ).toThrow("Private");
});
const input: OriginPreparationInput = {
  job: "/private/job",
  stateDirectory: "/private/shared",
  inventoryRoot: "/private",
  activationModulePath: "/private/module.mjs",
  activationModuleSha256: sha,
  expectedConsumerCodeSha256: sha,
  expectedUnitSha256: sha,
};
function fixture() {
  let stored: Record<string, unknown> | null = null,
    locked = false,
    snapshots = 0;
  const calls: string[] = [];
  const snapshot = {
    config: {
      inventoryPath: "/private/inventory.json",
      inventorySha256: sha,
      manifestPrefix:
        "_migration/manifests/publication-" + sha.slice(0, 24) + "/",
    },
    configSha256: sha,
    state: {
      inventoryPath: "/private/inventory.json",
      inventorySha256: sha,
      prefix: "_migration/manifests/publication-" + sha.slice(0, 24) + "/",
      codeSha256: sha,
      deploymentId: "deployment",
    },
    stateSha256: sha,
  };
  const ports: OriginPreparationPorts = {
    async lock(operation) {
      if (locked) throw Error("locked");
      locked = true;
      try {
        return await operation();
      } finally {
        locked = false;
      }
    },
    async stored() {
      return stored;
    },
    async snapshot() {
      snapshots++;
      return structuredClone(snapshot);
    },
    async qualify() {
      calls.push("qualify");
    },
    async attest() {
      calls.push("attest");
    },
    async backup(hash) {
      calls.push("backup");
      return {
        backupPath: "/offhost/current.json",
        snapshotSha256: hash,
        verified: true,
      };
    },
    async receipt() {
      calls.push("receipt");
      return { path: "/private/job/receipt.json", sha256: sha };
    },
    async store(value) {
      calls.push("store");
      stored = value;
    },
  };
  return {
    ports,
    calls,
    snapshot,
    get snapshots() {
      return snapshots;
    },
  };
}
test("fresh preparation performs locked origin replay, verified backup and exact six pins; same job replay writes nothing", async () => {
  const f = fixture();
  const prepared = await prepareOriginPublication(input, f.ports);
  expect(Object.keys(prepared.configuration)).toHaveLength(6);
  expect(prepared.previousInventorySha256).toBe(sha);
  expect(f.calls).toEqual(["qualify", "attest", "backup", "receipt", "store"]);
  const replay = await prepareOriginPublication(input, f.ports);
  expect(replay.replay).toBe(true);
  expect(replay.configurationSha256).toBe(prepared.configurationSha256);
  expect(f.snapshots).toBe(2);
  expect(f.calls).toEqual(["qualify", "attest", "backup", "receipt", "store"]);
  await expect(
    prepareOriginPublication(
      { ...input, activationModuleSha256: other },
      f.ports,
    ),
  ).rejects.toThrow("Immutable");
});
test("origin/state mismatch refuses backup and publication preparation", async () => {
  const f = fixture();
  f.snapshot.config.inventorySha256 = other;
  await expect(prepareOriginPublication(input, f.ports)).rejects.toThrow(
    "differ",
  );
  expect(f.calls).toEqual(["qualify"]);
});
test("concurrent state change during backup is rejected before receipts/options", async () => {
  const f = fixture();
  f.ports.backup = async (hash) => {
    f.snapshot.stateSha256 = other;
    return {
      backupPath: "/offhost/current.json",
      snapshotSha256: hash,
      verified: true,
    };
  };
  await expect(prepareOriginPublication(input, f.ports)).rejects.toThrow(
    "changed during backup",
  );
  expect(f.calls).toEqual(["qualify", "attest"]);
});
test("unverified off-host backup never yields options", async () => {
  const f = fixture();
  f.ports.backup = async () => ({
    backupPath: "/offhost/current.json",
    snapshotSha256: sha,
    verified: false,
  });
  await expect(prepareOriginPublication(input, f.ports)).rejects.toThrow(
    "unqualified",
  );
  expect(f.calls).toEqual(["qualify", "attest"]);
});
test("failed current manifest attestation prevents backup and all preparation writes", async () => {
  const f = fixture();
  f.ports.attest = async () => {
    throw Error("manifest changed");
  };
  await expect(prepareOriginPublication(input, f.ports)).rejects.toThrow(
    "manifest changed",
  );
  expect(f.calls).toEqual(["qualify"]);
});
test("corrupted stored preparation and unknown input fields are refused", async () => {
  const f = fixture();
  const prepared = await prepareOriginPublication(input, f.ports);
  prepared.configuration.configSha256 = other;
  await expect(prepareOriginPublication(input, f.ports)).rejects.toThrow(
    "integrity",
  );
  await expect(
    prepareOriginPublication(
      { ...input, extra: "unexpected" } as OriginPreparationInput,
      fixture().ports,
    ),
  ).rejects.toThrow("Exact typed");
});
test("concurrent preparations use the canonical lock and fail instead of stealing it", async () => {
  const f = fixture();
  let release!: () => void;
  f.ports.attest = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const first = prepareOriginPublication(input, f.ports);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await expect(prepareOriginPublication(input, f.ports)).rejects.toThrow(
    "locked",
  );
  release();
  await first;
});
