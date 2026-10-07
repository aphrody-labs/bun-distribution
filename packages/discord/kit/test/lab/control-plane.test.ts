import { expect, test } from "bun:test";
import {
  networkPeers,
  publicSyncReport,
  publicAutomation,
  renderRag,
} from "../../src/lab/control-plane";

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
