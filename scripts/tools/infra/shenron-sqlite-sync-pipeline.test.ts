// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { qualifiedAcknowledgement, converged } from "./shenron-sqlite-sync-pipeline";
test("requires checksum, SQLite integrity and a fresh completed off-host receipt", () => {
  const now = Date.now(),
    hash = "a".repeat(64);
  const receipt = {
    sha256: hash,
    checkedAt: new Date(now - 1000).toISOString(),
    sqliteIntegrity: "ok",
  };
  expect(qualifiedAcknowledgement(receipt, hash, now)).toBeTrue();
  expect(qualifiedAcknowledgement({ ...receipt, sha256: "b".repeat(64) }, hash, now)).toBeFalse();
  expect(
    qualifiedAcknowledgement(
      { ...receipt, checkedAt: new Date(now - 3600000).toISOString() },
      hash,
      now,
    ),
  ).toBeFalse();
  expect(
    qualifiedAcknowledgement(
      { ...receipt, checkedAt: new Date(now + 1000).toISOString() },
      hash,
      now,
    ),
  ).toBeFalse();
  expect(
    qualifiedAcknowledgement({ ...receipt, sqliteIntegrity: "failed" }, hash, now),
  ).toBeFalse();
});
test("requires independent read-back without pending or failed tables", () => {
  const report = { ok: true, dryRun: true, totals: { failed: 0, planned: 0 } };
  expect(converged(report)).toBeTrue();
  expect(converged({ ...report, dryRun: false })).toBeFalse();
  expect(converged({ ...report, totals: { failed: 1, planned: 0 } })).toBeFalse();
  expect(converged({ ...report, totals: { failed: 0, planned: 1 } })).toBeFalse();
});
