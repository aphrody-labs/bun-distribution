import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  categoryStats,
  getText,
  getTextLocale,
  getTexts,
  listCategory,
  searchText,
} from "./index.js";

test("all game-text endpoints read SQLite without PostgreSQL, native VFS or loose files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inagle-text-sqlite-"));
  const path = join(directory, "mirror.sqlite");
  const keys = ["NIE_DATA_SOURCE", "INAGLE_DATA_SOURCE", "NIE_WIKI_DB"] as const;
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    const db = new Database(path);
    db.exec("CREATE TABLE inagle_game_text(hash_id TEXT, locale TEXT, category TEXT, value TEXT)");
    const insert = db.query("INSERT INTO inagle_game_text VALUES (?, ?, ?, ?)");
    for (const row of [
      ["0x00000001", "fr", "technical", "Épreuve 100%_"],
      ["0x00000001", "en", "technical", "Test"],
      ["0x00000002", "fr", "technical", "Second"],
      ["0x00000003", "ja", "other", "Fixture"],
    ])
      insert.run(...row);
    insert.finalize();
    db.close();
    process.env.NIE_DATA_SOURCE = process.env.INAGLE_DATA_SOURCE = "sqlite";
    process.env.NIE_WIKI_DB = path;
    const before = await Bun.file(path).arrayBuffer();
    expect((await getText(1))?.fr).toBe("Épreuve 100%_");
    expect(await getTextLocale(1, "ja")).toBe("Épreuve 100%_");
    expect((await getTexts([1, 1, 2])).size).toBe(2);
    expect((await listCategory("technical", "fr", 1, 1))[0].hashId).toBe("0x00000002");
    expect((await searchText("éPREUVE", "fr"))[0].hashId).toBe("0x00000001");
    expect((await searchText("100%_", "fr")).length).toBe(1);
    expect(await categoryStats()).toEqual([{ category: "technical", count: 2 }]);
    expect(await Bun.file(path).arrayBuffer()).toEqual(before);
    const writer = new Database(path);
    writer.exec("DROP TABLE inagle_game_text");
    writer.close();
    await expect(getText(1)).rejects.toThrow("inagle_game_text");
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    await rm(directory, { recursive: true, force: true });
  }
});
