import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  networkPeers,
  publicSyncReport,
  publicAutomation,
  readAutomation,
  renderAutomation,
  renderRag,
} from "../../src/lab/control-plane";

const receiptDir = mkdtempSync(join(tmpdir(), "discord-cloud-receipts-"));
afterAll(() => rmSync(receiptDir, { recursive: true, force: true }));

async function automationReceipt(name: string, jobs: Record<string, unknown>, ageMs = 0) {
  const path = join(receiptDir, `${name}.json`);
  await Bun.write(
    path,
    JSON.stringify({ observedAt: new Date(Date.now() - ageMs).toISOString(), jobs }),
  );
  return path;
}

const declaration = {
  interface: "wg1",
  reportPath: "/private/network.json",
  peers: ["a", "b", "c", "d"].map((id) => ({ id })),
};
const snapshot = {
  interface: "wg1",
  peers: [
    { id: "a", address: "a", state: "recent" as const },
    { id: "b", address: "b", state: "stale" as const },
    { id: "c", address: "c", state: "never" as const },
  ],
};
test("network evidence distinguishes connected, stale, never and missing peers", () => {
  expect(networkPeers(snapshot, declaration, 60)).toEqual([
    { id: "a", status: "connected" },
    { id: "b", status: "stale" },
    { id: "c", status: "never" },
    { id: "d", status: "unknown" },
  ]);
});
test("stale network receipts never claim connected devices", () => {
  expect(networkPeers(snapshot, declaration, 301).every((peer) => peer.status === "unknown")).toBe(
    true,
  );
  expect(
    networkPeers({ ...snapshot, interface: "wg0" }, declaration, 60).every(
      (peer) => peer.status === "unknown",
    ),
  ).toBe(true);
});
test("reports expose only counters, never conversation or credentials", () => {
  expect(
    publicSyncReport({
      records_ingested: 42,
      sources_scanned: 3,
      content: "private conversation",
      token: "private token",
      uploaded: -1,
      staged: "2",
    }),
  ).toEqual({ records_ingested: 42, sources_scanned: 3 });
});
test("automation reports reveal job states without private output", () => {
  expect(
    publicAutomation({
      drive: { ok: false, token: "secret" },
      agents: { ok: true, sessions: "private" },
      token: { ok: true },
      "home-dbfr": { ok: "yes" },
    }),
  ).toEqual({ drive: "retrying", agents: "ok" });
});

test("VPS and WSL automation receipts retain separate whitelisted job states", async () => {
  const [wslPath, cloudPath] = await Promise.all([
    automationReceipt("wsl", { drive: { ok: false }, agents: { ok: true } }),
    automationReceipt("cloud", {
      drive: { ok: true, token: "private-token", path: "/private/drive" },
      "private-job": { ok: true },
    }),
  ]);
  const [wsl, cloud] = await Promise.all([readAutomation(wslPath), readAutomation(cloudPath)]);
  expect(wsl).toEqual({ available: true, fresh: true, jobs: { drive: "retrying", agents: "ok" } });
  expect(cloud).toEqual({ available: true, fresh: true, jobs: { drive: "ok" } });
  expect(renderAutomation(cloud)).toBe("drive : ok");
  expect(JSON.stringify(cloud)).not.toContain("private");
});

test("missing and malformed optional VPS receipts do not claim success or prevent WSL reads", async () => {
  const malformed = join(receiptDir, "malformed.json");
  await Bun.write(malformed, "{incomplete");
  const receipts = await Promise.all(
    [undefined, join(receiptDir, "missing.json"), malformed].map((path) => readAutomation(path)),
  );
  for (const receipt of receipts) {
    expect(receipt).toEqual({ available: false });
    expect(renderAutomation(receipt)).toBe("état indisponible");
  }
  const wsl = await readAutomation(
    await automationReceipt("wsl-after-malformed", { agents: { ok: true } }),
  );
  expect(wsl.fresh).toBe(true);
  expect(wsl.jobs).toEqual({ agents: "ok" });
});

test("stale and future VPS receipts never display their old successful state", async () => {
  const receipts = await Promise.all(
    (
      [
        ["stale", 180_001],
        ["future", -60_000],
      ] as const
    ).map(async ([name, age]) =>
      readAutomation(await automationReceipt(name, { drive: { ok: true } }, age)),
    ),
  );
  for (const receipt of receipts) {
    expect(receipt.fresh).toBe(false);
    expect(renderAutomation(receipt)).toBe("suivi périmé");
    expect(renderAutomation(receipt)).not.toContain("ok");
  }
});

test("recent VPS reports display failed jobs without private failure details", async () => {
  const receipt = await readAutomation(
    await automationReceipt("failed-cloud", {
      drive: { ok: false, error: "private conversation", token: "private-token" },
    }),
  );
  expect(renderAutomation(receipt)).toBe("drive : échec ; nouvelle tentative attendue");
  expect(JSON.stringify(receipt)).not.toContain("private");
  const empty = await readAutomation(
    await automationReceipt("unverified", { drive: { ok: "yes" } }),
  );
  expect(renderAutomation(empty)).toBe("rapport récent sans état vérifié");
});

test("RAG display distinguishes active-source progress from completed synchronization", () => {
  expect(
    renderRag({
      available: true,
      fresh: true,
      running: 1,
      indexed: 0,
      progress_current: 10,
      progress_total: 100,
      token: "secret",
    }),
  ).toBe("en cours : 10 / 100 éléments sur la source active ; rapport final attendu");
  expect(renderRag({ available: true, fresh: false, completed: 1 })).toBe("suivi périmé");
  expect(renderRag({ available: true, fresh: true, completed: 0 })).toBe(
    "rapport final actuel non vérifié",
  );
});
