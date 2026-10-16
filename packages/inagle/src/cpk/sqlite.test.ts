import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileMeta, listDir, listDirPaged, searchFiles, totalFiles, vfsCpkRows } from "./index.js";

test("CPK endpoints use an existing SQLite index without PostgreSQL or VFS", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inagle-cpk-sqlite-"));
  const path = join(directory, "mirror.sqlite");
  const keys = ["NIE_DATA_SOURCE", "INAGLE_DATA_SOURCE", "NIE_WIKI_DB"] as const;
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    const db = new Database(path);
    db.exec(
      "CREATE TABLE inagle_cpk_index(path TEXT, top TEXT, sub TEXT, dir TEXT, name TEXT, ext TEXT, cpk TEXT, depth INTEGER)",
    );
    const insert = db.query("INSERT INTO inagle_cpk_index VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const file of [
      "data/technical/a.bin",
      "data/technical/b.bin",
      "data/technical/sub/Épreuve100%_.g4tx",
    ]) {
      const segments = file.split("/");
      const name = segments.at(-1)!;
      insert.run(
        file,
        "technical",
        segments[2],
        segments.slice(0, -1).join("/"),
        name,
        name.split(".").at(-1)!,
        "technical.cpk",
        segments.length,
      );
    }
    insert.finalize();
    db.close();
    process.env.NIE_DATA_SOURCE = process.env.INAGLE_DATA_SOURCE = "sqlite";
    process.env.NIE_WIKI_DB = path;
    const before = await Bun.file(path).arrayBuffer();
    expect((await listDir("data")).dirs).toEqual([{ name: "technical", count: 3 }]);
    expect((await listDir("data/technical")).dirs).toEqual([{ name: "sub", count: 1 }]);
    const page = await listDirPaged("data/technical", 1, 1);
    expect(page.fileTotal).toBe(2);
    expect(page.files[0].name).toBe("b.bin");
    expect((await fileMeta("data/technical/sub/Épreuve100%_.g4tx"))?.depth).toBe(4);
    expect((await searchFiles("éPREUVE100%_"))[0].ext).toBe("g4tx");
    expect(await totalFiles()).toBe(3);
    expect(await Bun.file(path).arrayBuffer()).toEqual(before);
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("native CPK metadata comes from the existing VFS index and rejects incomplete pages", () => {
  const rows = vfsCpkRows({
    count: () => 1n,
    listRange: () => [{ path: "data/technical/test.bin", cpk: "technical.cpk" }],
  });
  expect(rows[0]).toMatchObject({
    path: "data/technical/test.bin",
    cpk: "technical.cpk",
    ext: "bin",
    dir: "data/technical",
    top: "technical",
    depth: 3,
  });
  expect(() => vfsCpkRows({ count: () => 2n, listRange: () => [] })).toThrow(
    "pagination ended early",
  );
});
