// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { backupScope, qualifyBackupInventory } from "./shenron-manga-editorial-backup";
test("editorial backup capability confines jobs to private owner inventory", () => {
  expect(() => backupScope("/tmp/public", "/home/ubuntu/.aphrody/private/shenron")).toThrow();
  expect(() =>
    backupScope("/home/ubuntu/.aphrody/private/shenron/../../public", "/home/ubuntu/.aphrody/private/shenron"),
  ).toThrow();
  expect(() =>
    backupScope("/home/ubuntu/.aphrody/private/shenron/jobs/one", "/home/ubuntu/.aphrody/private/shenron"),
  ).not.toThrow();
});
test("inventory requires real data for both catalogue tables and editorial revisions", () => {
  const rows = ["db_manga_volumes", "db_manga_chapters", "wiki_revisions"]
    .map(name => "99; 0 1 TABLE DATA bot " + name + " postgres")
    .join("\n");
  expect(() => qualifyBackupInventory(rows)).not.toThrow();
  expect(() =>
    qualifyBackupInventory(rows.replace("TABLE DATA bot wiki_revisions", "TABLE bot wiki_revisions")),
  ).toThrow();
});
