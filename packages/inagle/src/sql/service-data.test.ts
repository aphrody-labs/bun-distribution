import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSqliteServiceData } from "./service-data.js";

test("existing SQLite projections use the shared service mapping without modifying the mirror", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inagle-sqlite-test-"));
  const path = join(directory, "mirror.sqlite");
  try {
    const db = new Database(path);
    db.transaction(() => {
      for (const name of [
        "basara",
        "characters",
        "skills",
        "passives",
        "teams",
        "formations",
        "items",
        "quests",
        "capsules",
        "gallery",
        "uniforms",
        "drops_tables",
        "drops_battles",
        "drops_treasures",
      ]) {
        db.exec(`CREATE TABLE inagle_${name}(id TEXT, character_id TEXT, name_id TEXT, name_en TEXT, data TEXT)`);
      }
      for (const name of ["characters", "skills", "teams"])
        db.query(`INSERT INTO inagle_${name}(id, name_en, data) VALUES (?, ?, ?)`).run(
          `test-${name}`,
          "Technical fixture",
          '{"marker":"test","uniforms":["test-kit"]}',
        );
    })();
    db.close();
    const before = await Bun.file(path).arrayBuffer();
    const data = await loadSqliteServiceData(path);
    expect(data.characters[0].id).toBe("test-characters");
    expect(data.characters[0].data.marker).toBe("test");
    expect(data.teams[0].uniforms).toEqual(["test-kit"]);
    expect(data.auras).toEqual([]);
    expect(await Bun.file(path).arrayBuffer()).toEqual(before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("SQLite selection never creates a missing projection database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inagle-sqlite-missing-"));
  const path = join(directory, "absent.sqlite");
  try {
    await expect(loadSqliteServiceData(path)).rejects.toThrow();
    expect(await Bun.file(path).exists()).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
