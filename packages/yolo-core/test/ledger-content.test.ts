// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  enforceLedgerPermissions,
  indexCodebaseFingerprints,
  initLedgerDatabase,
} from "../src/ledger";

const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "yolo-ledger-content-"));
  roots.push(root);
  return root;
}
test("memory ledger leaves cwd permissions and filesystem untouched", () => {
  const before = statSync(process.cwd()).mode;
  const db = initLedgerDatabase(":memory:");
  try {
    enforceLedgerPermissions(":memory:");
    expect(statSync(process.cwd()).mode).toBe(before);
    expect(existsSync(join(process.cwd(), ":memory:"))).toBe(false);
    expect(db.query("SELECT count(*) AS total FROM sessions").get()).toEqual({
      total: 0,
    });
  } finally {
    db.close();
  }
});
test.skipIf(process.platform === "win32")(
  "file ledger preserves an existing shared parent mode",
  () => {
    const root = fixture();
    chmodSync(root, 0o755);
    const path = join(root, "audit.sqlite");
    const db = initLedgerDatabase(path);
    try {
      expect(statSync(root).mode & 0o777).toBe(0o755);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      enforceLedgerPermissions(path);
      expect(statSync(root).mode & 0o777).toBe(0o755);
    } finally {
      db.close();
    }
  },
);
test("ledger records content hashes and normalized relative paths, including equal-sized binary changes", () => {
  const root = fixture();
  mkdirSync(join(root, "nested"));
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "source.bin"), new Uint8Array([255, 1]));
  writeFileSync(join(root, "nested/source.bin"), new Uint8Array([253, 1]));
  writeFileSync(join(root, "node_modules/ignored.txt"), "ignored fixture");
  const db = initLedgerDatabase(":memory:");
  try {
    expect(indexCodebaseFingerprints(db, relative(process.cwd(), root))).toBe(
      2,
    );
    const first = db
      .query(
        "SELECT path, size_bytes, wyhash64 FROM codebase_fingerprints ORDER BY path",
      )
      .all() as { path: string; size_bytes: number; wyhash64: string }[];
    expect(first.map((entry) => entry.path)).toEqual([
      "nested/source.bin",
      "source.bin",
    ]);
    expect(first[0]?.wyhash64).not.toBe(first[1]?.wyhash64);
    expect(first[1]?.wyhash64).toBe(
      Bun.hash.wyhash(new Uint8Array([255, 1])).toString(16),
    );
    writeFileSync(join(root, "source.bin"), new Uint8Array([254, 1]));
    expect(indexCodebaseFingerprints(db, root)).toBe(2);
    const changed = db
      .query(
        "SELECT size_bytes, wyhash64 FROM codebase_fingerprints WHERE path='source.bin'",
      )
      .get() as { size_bytes: number; wyhash64: string };
    expect(changed.size_bytes).toBe(first[1]?.size_bytes ?? -1);
    expect(changed.wyhash64).not.toBe(first[1]?.wyhash64);
  } finally {
    db.close();
  }
});
