// SPDX-License-Identifier: Apache-2.0
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restoreMissingStores } from "./shenron-missing-store-restore";

test("validates both backed-up databases without writes and refuses existing live stores", async () => {
  const root = mkdtempSync(join(tmpdir(), "shenron-store-restore-"));
  try {
    const source = join(root, "snapshot"),
      target = join(root, "data");
    mkdirSync(join(source, "server/data"), { recursive: true });
    mkdirSync(target);
    const files: Record<string, string> = { "shenron_site.dump": "a".repeat(64) };
    await Promise.all(
      ["memory.sqlite", "conversations.sqlite"].map(async (name) => {
        const db = new Database(":memory:");
        db.exec("CREATE TABLE preserved (value TEXT); INSERT INTO preserved VALUES ('existing');");
        const snapshot = db.serialize();
        // Consistent on-disk snapshots can retain WAL header bytes.
        snapshot[18] = 2;
        snapshot[19] = 2;
        const bytes = Bun.gzipSync(new Uint8Array(snapshot));
        db.close();
        const key = `server/data/${name}.gz`;
        await Bun.write(join(source, key), bytes);
        files[key] = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
      }),
    );
    await Bun.write(
      join(source, "VERIFIED.json"),
      JSON.stringify({ kind: "shenron-container-backup", files }),
    );
    const report = await restoreMissingStores(source, target, { uid: 1000, gid: 1000 });
    expect(report.apply).toBeFalse();
    expect(report.stores).toHaveLength(2);
    expect(await Bun.file(join(target, "memory.sqlite")).exists()).toBeFalse();
    const invalid = Bun.gzipSync(new TextEncoder().encode("invalid database"));
    files["server/data/memory.sqlite.gz"] = new Bun.CryptoHasher("sha256")
      .update(invalid)
      .digest("hex");
    await Bun.write(join(source, "server/data/memory.sqlite.gz"), invalid);
    await Bun.write(
      join(source, "VERIFIED.json"),
      JSON.stringify({ kind: "shenron-container-backup", files }),
    );
    await expect(
      restoreMissingStores(source, target, { uid: 1000, gid: 1000 }, true),
    ).rejects.toThrow();
    expect(await Bun.file(join(target, "memory.sqlite")).exists()).toBeFalse();
    await Bun.write(join(target, "memory.sqlite"), "must remain");
    await expect(
      restoreMissingStores(source, target, { uid: 1000, gid: 1000 }, true),
    ).rejects.toThrow("Existing store preserved");
    expect(await Bun.file(join(target, "memory.sqlite")).text()).toBe("must remain");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
