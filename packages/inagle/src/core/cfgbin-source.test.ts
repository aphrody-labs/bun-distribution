import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cfgbinDataSource, cfgbinDbAvailable } from "./cfgbin-db.js";
import { findConfigFile, loadConfigAsync } from "./data-loader.js";

test("owned SQLite cfg.bin cache serves configs without PostgreSQL or a native game mount", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inagle-cfgbin-test-"));
  const path = join(directory, "cfgbin.sqlite");
  const keys = ["NIE_DATA_SOURCE", "INAGLE_DATA_SOURCE", "IEVR_CFGBIN_DB"] as const;
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    const db = new Database(path);
    db.exec("CREATE TABLE cfgbin(path TEXT PRIMARY KEY, parsed INTEGER, json TEXT, error TEXT)");
    db.query("INSERT INTO cfgbin VALUES (?, 1, ?, NULL)").run(
      "data/common/gamedata/technical/test_config.cfg.bin",
      '{"entries":[{"name":"test-node","variables":[],"children":[]}]}',
    );
    db.close();
    process.env.NIE_DATA_SOURCE = "sqlite";
    process.env.INAGLE_DATA_SOURCE = "sqlite";
    process.env.IEVR_CFGBIN_DB = path;
    const before = await Bun.file(path).arrayBuffer();
    expect(cfgbinDataSource()).toBe("sqlite");
    expect(findConfigFile("technical", "test_config")).toBe("test_config.cfg.bin.json");
    const config = await loadConfigAsync("technical", "test_config.cfg.bin.json");
    expect(config.children[0]?.name).toBe("test-node");
    expect(await Bun.file(path).arrayBuffer()).toEqual(before);
    process.env.IEVR_CFGBIN_DB = join(directory, "absent.sqlite");
    expect(cfgbinDataSource()).toBe("vfs");
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    cfgbinDbAvailable(); // Close the fixture handle before removing it on Windows.
    await rm(directory, { recursive: true, force: true });
  }
});
