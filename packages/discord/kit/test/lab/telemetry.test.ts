// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { renderTelemetry } from "../../src/lab/telemetry.ts";
import { networkSnapshot } from "../../src/lab/network.ts";

test("WireGuard reports identities and freshness without disclosing keys or endpoints", () => {
  const result = networkSnapshot(
    {
      interface: "wg1",
      peers: [
        { id: "wsl", address: "10.200.77.2" },
        { id: "omar", address: "10.200.77.10" },
        { id: "missing", address: "10.200.77.4" },
      ],
    },
    "public-a\t10.200.77.2/32\npublic-b\t10.200.77.10/32",
    "public-a\t950\npublic-b\t0",
    1000,
  );
  expect(result.peers.map((peer) => peer.state)).toEqual(["recent", "never", "unavailable"]);
  expect(JSON.stringify(result)).not.toContain("public-a");
  expect(
    networkSnapshot(
      { interface: "wg1", peers: [{ id: "wsl", address: "10.200.77.2" }] },
      "public-a\t10.200.77.2/32",
      "public-a\t100",
      1000,
    ).peers[0]?.state,
  ).toBe("stale");
});

test("laboratory telemetry distinguishes verified service states and unreachable hosts", () => {
  expect(
    renderTelemetry([
      { host: "vps", services: { "aphrody-llama-gemma4.service": "active" } },
      { host: "dbfr", services: { "shenron-compute.service": "unreachable" } },
    ]),
  ).toContain("shenron-compute.service: unreachable");
});
