// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import {
  activateOriginInventory,
  type OriginInventoryPins,
  type OriginInventoryPorts,
} from "./shenron-cdn-origin-inventory";
const hash = "a".repeat(64),
  candidate = "b".repeat(64);
const root = "C:/owner";
const path = root + "/delta/inventory.json";
const pins: OriginInventoryPins = {
  configSha256: hash,
  consumerCodeSha256: hash,
  unitSha256: hash,
  inventorySha256: candidate,
  manifestPrefix: `_migration/manifests/publication-${candidate.slice(0, 24)}/`,
  inventoryRoot: root,
  backupReceipt: root + "/backup-receipt.json",
  backupReceiptSha256: hash,
  publisherLock: root + "/state/publish.lock",
};
function fixture() {
  let current = {
    inventoryPath: root + "/before.json",
    inventorySha256: hash,
    manifestPrefix: `_migration/manifests/site-${hash.slice(0, 24)}/`,
    profile: "/protected/profile.json",
    sdkModule: "/owned/sdk.js",
  };
  let sha = hash;
  const calls: string[] = [];
  const ports: OriginInventoryPorts = {
    async readConfig() {
      return { config: current, sha256: sha };
    },
    async qualifyInventory() {
      calls.push("qualify");
    },
    async qualifyBackup() {
      calls.push("backup");
    },
    async replaceConfig(value, expected) {
      if (sha !== expected) throw Error("Concurrent configuration");
      current = value as typeof current;
      sha = candidate;
      calls.push("write");
    },
    async restart() {
      calls.push("restart");
    },
    async attest() {
      calls.push("attest");
    },
  };
  return {
    ports,
    calls,
    current: () => current,
    concurrent: () => {
      sha = candidate;
    },
  };
}
test("activation preserves credential references and replay performs no write or restart", async () => {
  const f = fixture();
  expect((await activateOriginInventory(path, pins, f.ports, true)).writes).toBe(1);
  expect(f.calls).toEqual(["qualify", "backup", "write", "restart", "attest"]);
  expect(f.current().profile).toBe("/protected/profile.json");
  expect(f.current().sdkModule).toBe("/owned/sdk.js");
  f.calls.length = 0;
  expect((await activateOriginInventory(path, pins, f.ports, true)).replay).toBe(true);
  expect(f.calls).toEqual(["qualify", "attest"]);
});
test("prepare never writes; concurrent update and unverified backup stop before service operations", async () => {
  const f = fixture();
  await activateOriginInventory(path, pins, f.ports);
  expect(f.calls).toEqual(["qualify", "backup"]);
  f.concurrent();
  await expect(activateOriginInventory(path, pins, f.ports, true)).rejects.toThrow("Concurrent");
  expect(f.calls).not.toContain("restart");
  const backup = fixture();
  backup.ports.qualifyBackup = async () => {
    throw Error("Backup unavailable");
  };
  await expect(activateOriginInventory(path, pins, backup.ports, true)).rejects.toThrow("Backup");
  expect(backup.calls).not.toContain("write");
});
test("candidate scope and prefix identity cannot be substituted", async () => {
  const f = fixture();
  await expect(
    activateOriginInventory("C:/foreign/inventory.json", pins, f.ports, true),
  ).rejects.toThrow("scope");
  await expect(
    activateOriginInventory(
      path,
      { ...pins, manifestPrefix: `_migration/manifests/publication-${hash.slice(0, 24)}/` },
      f.ports,
      true,
    ),
  ).rejects.toThrow("prefix");
  expect(f.calls).toEqual([]);
});
test("CAS is checked again immediately before replacement", async () => {
  const f = fixture();
  f.ports.qualifyBackup = async () => {
    f.concurrent();
  };
  await expect(activateOriginInventory(path, pins, f.ports, true)).rejects.toThrow("Concurrent");
  expect(f.calls).not.toContain("restart");
});
