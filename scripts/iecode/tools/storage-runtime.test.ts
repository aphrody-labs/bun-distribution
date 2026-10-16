import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MIRROR_TABLES,
  backupVolumes,
  ownedPostgres,
  selectStorage,
  sqliteEvidence,
  sqliteSnapshot,
  validateBackup,
} from "./storage-runtime";

const temporary: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ie-storage-test-"));
  temporary.push(root);
  return root;
}
afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});
function digest(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("qualification reads existing complete mirrors without changing their bytes", () => {
  const path = join(fixture(), "mirror.sqlite");
  const database = new Database(path);
  for (const name of MIRROR_TABLES) database.run(`CREATE TABLE ${name} (id INTEGER)`);
  for (const name of ["characters", "skills", "teams"]) database.run(`INSERT INTO inagle_${name} VALUES (1)`);
  database.close();
  const before = digest(path);
  expect(sqliteEvidence(path, "mirror")).toEqual({
    available: true,
    ready: true,
    integrity: true,
    requiredSchema: true,
    requiredData: true,
  });
  expect(digest(path)).toBe(before);
});

test("missing or empty game tables are not mistaken for a ready mirror", () => {
  const root = fixture();
  expect(sqliteEvidence(join(root, "absent.sqlite"), "mirror").available).toBe(false);
  const path = join(root, "empty.sqlite"),
    database = new Database(path);
  for (const name of MIRROR_TABLES) database.run(`CREATE TABLE ${name} (id INTEGER)`);
  database.close();
  expect(sqliteEvidence(path, "mirror").ready).toBe(false);
});

test("cfgbin cache readiness never qualifies a game mirror", () => {
  const path = join(fixture(), "cfgbin.sqlite"),
    database = new Database(path);
  database.run(
    "CREATE TABLE cfgbin(path TEXT, cpk TEXT, size INTEGER, parsed INTEGER, format TEXT, error TEXT, json TEXT)",
  );
  database.close();
  expect(sqliteEvidence(path, "cfgbin").ready).toBe(true);
  expect(sqliteEvidence(path, "mirror").ready).toBe(false);
  expect(selectStorage({ postgres: false, sqlite: false })).toBe("vfs");
});

test("the isolated metadata graph is never adopted as a game database", () => {
  const path = join(fixture(), "aphrody.sqlite"),
    database = new Database(path);
  database.run("CREATE TABLE files(id INTEGER)");
  database.close();
  expect(() => sqliteEvidence(path, "mirror", path)).toThrow("metadata database");
});

test("PostgreSQL selection requires IE ownership, health and the exact loopback binding", () => {
  const container = {
    Config: {
      Labels: {
        "com.docker.compose.project": "iecode",
        "com.docker.compose.service": "postgres",
        "io.aphrody.profile": "ie",
      },
    },
    State: { Running: true, Health: { Status: "healthy" } },
    NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "65432" }] } },
  };
  const url = "postgresql://iecode:fixture-secret@127.0.0.1:65432/iecode";
  expect(ownedPostgres(container, url)).toBe(true);
  expect(ownedPostgres(container, url.replace("65432", "55432"))).toBe(false);
  expect(ownedPostgres(container, url.replace("127.0.0.1", "foreign.invalid"))).toBe(false);
  expect(ownedPostgres(container, `${url.slice(0, url.lastIndexOf("/"))}/aphrody`)).toBe(false);
  expect(
    ownedPostgres(
      {
        ...container,
        Config: {
          Labels: { ...container.Config.Labels, "com.docker.compose.project": "aphrody-windex" },
        },
      },
      url,
    ),
  ).toBe(false);
  expect(ownedPostgres({ ...container, State: { Running: true, Health: { Status: "starting" } } }, url)).toBe(false);
});

test("auto respects qualified availability and PostgreSQL opt-out", () => {
  expect(selectStorage({ postgres: true, sqlite: true })).toBe("postgres");
  expect(selectStorage({ postgres: true, sqlite: true, postgresDisabled: true })).toBe("sqlite");
  expect(selectStorage({ postgres: false, sqlite: true })).toBe("sqlite");
  expect(() => selectStorage({ explicit: "postgres", postgres: false, sqlite: true })).toThrow("not qualified");
  expect(() => selectStorage({ explicit: "sqlite", postgres: false, sqlite: false })).toThrow("not qualified");
});

test("backup mounts require an explicit existing source and stay read-only", () => {
  const root = fixture(),
    path = join(root, "input.dump");
  writeFileSync(path, "fixture");
  expect(() => validateBackup(join(root, "missing"), "directory")).toThrow("does not exist");
  expect(() => validateBackup(path, "directory")).toThrow("wrong type");
  expect(backupVolumes()).toEqual([]);
  const directory = validateBackup(root, "directory"),
    file = validateBackup(path, "file");
  for (const mount of backupVolumes(directory, file)) {
    expect(mount.read_only).toBe(true);
    expect(mount.bind.create_host_path).toBe(false);
  }
});

test("SQLite snapshots retain committed WAL data without changing the source", async () => {
  const root = fixture(),
    source = join(root, "live.sqlite"),
    destination = join(root, "snapshot.sqlite");
  const writer = new Database(source);
  writer.exec("PRAGMA journal_mode=WAL");
  writer.exec("CREATE TABLE fixture_records(id INTEGER); INSERT INTO fixture_records VALUES(7)");
  const before = digest(source),
    walBefore = digest(`${source}-wal`);
  const receipt = await sqliteSnapshot(source, destination);
  expect(receipt.integrity).toBe(true);
  expect(receipt.schemaParity).toBe(true);
  expect(receipt.sourceUnchanged).toBe(true);
  const snapshot = new Database(destination, { readonly: true });
  expect(snapshot.query<{ id: number }, []>("SELECT id FROM fixture_records").get()?.id).toBe(7);
  snapshot.close();
  expect(digest(source)).toBe(before);
  expect(digest(`${source}-wal`)).toBe(walBefore);
  writer.close();
});
