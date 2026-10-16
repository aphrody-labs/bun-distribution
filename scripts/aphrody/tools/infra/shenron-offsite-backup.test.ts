// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";

import { parseVerified, remoteRoot, snapshotsToCopy, stampTime } from "./shenron-offsite-backup.ts";

const sum = "a".repeat(64);

test("the remote root follows shenron-container-backup.service", () => {
  expect(remoteRoot("/home/ubuntu/")).toBe("/home/ubuntu/apps/shenron/shared/backups/container");
});

test("snapshot names are parsed as UTC timestamps", () => {
  expect(stampTime("20261009T163140069807Z")).toBe(Date.UTC(2026, 9, 9, 16, 31, 40));
  expect(stampTime(".20261009T163140069807Z.partial")).toBeNull();
  expect(stampTime("pull-status.log")).toBeNull();
});

test("offsite history seed selects all published timestamps; regular runs select only newest", () => {
  const listing = [
    "20261001T030000000000Z",
    "not-a-snapshot",
    "20261011T030730863287Z",
    ".20261012T030000000000Z.partial",
  ].join("\n");
  expect(snapshotsToCopy(listing, true)).toEqual([
    "20261001T030000000000Z",
    "20261011T030730863287Z",
  ]);
  expect(snapshotsToCopy(listing, false)).toEqual(["20261011T030730863287Z"]);
});

test("VERIFIED.json is parsed strictly", () => {
  const ok = {
    kind: "shenron-container-backup",
    files: { "shenron_site.dump": sum, "bot/data/bot.db.gz": sum },
  };
  expect(parseVerified(JSON.stringify(ok)).files["bot/data/bot.db.gz"]).toBe(sum);
  const bad =
    (files: Record<string, unknown>, kind = "shenron-container-backup") =>
    () =>
      parseVerified(JSON.stringify({ kind, files: { "shenron_site.dump": sum, ...files } }));
  expect(bad({ "../../etc/passwd": sum })).toThrow("unexpected path");
  expect(bad({ "/etc/passwd": sum })).toThrow("unexpected path");
  expect(bad({ "a/../b": sum })).toThrow("unexpected path");
  expect(bad({ "redis.rdb": "nothex" })).toThrow("malformed digest");
  expect(bad({}, "other")).toThrow("not a shenron-container-backup");
  expect(() =>
    parseVerified(JSON.stringify({ kind: "shenron-container-backup", files: {} })),
  ).toThrow("no PostgreSQL dump");
});
