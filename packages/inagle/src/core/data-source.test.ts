import { expect, test } from "bun:test";
import { ownedPostgresUrl, selectDataSource } from "./data-source.js";

test("automatic selection uses an existing owned SQLite projection or native VFS", () => {
  expect(selectDataSource({})).toBe("vfs");
  expect(selectDataSource({ sqliteAvailable: true })).toBe("sqlite");
  expect(selectDataSource({ explicit: "auto", sqliteAvailable: true })).toBe("sqlite");
});

test("explicit adapters win over automatic availability", () => {
  for (const explicit of ["vfs", "sqlite", "postgres"] as const)
    expect(selectDataSource({ explicit, sqliteAvailable: true })).toBe(explicit);
});

test("invalid selection and disabled PostgreSQL fail before opening data", () => {
  expect(() => selectDataSource({ explicit: "foreign" })).toThrow("INAGLE_DATA_SOURCE");
  expect(() => selectDataSource({ explicit: "postgres", postgresDisabled: true })).toThrow(
    "disables it",
  );
});

test("PostgreSQL uses the Inagle profile and its historical alias without accepting an RG URL", () => {
  const keys = [
    "INAGLE_DATABASE_URL",
    "NIE_PG_URL",
    "DATABASE_URL",
    "ACHILLEA_DATABASE_URL",
  ] as const;
  const original = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    delete process.env.INAGLE_DATABASE_URL;
    delete process.env.NIE_PG_URL;
    process.env.DATABASE_URL = "postgresql://example.invalid/rg";
    process.env.ACHILLEA_DATABASE_URL = "postgresql://example.invalid/achillea";
    expect(ownedPostgresUrl).toThrow("INAGLE_DATABASE_URL is required");
    process.env.NIE_PG_URL = "postgresql://example.invalid/historical-iecode";
    expect(ownedPostgresUrl()).toBe("postgresql://example.invalid/historical-iecode");
    process.env.INAGLE_DATABASE_URL = " postgresql://example.invalid/inagle ";
    expect(ownedPostgresUrl()).toBe("postgresql://example.invalid/inagle");
    process.env.INAGLE_DATABASE_URL = "https://example.invalid/private-marker";
    expect(ownedPostgresUrl).toThrow("must identify an IECODE PostgreSQL");
    process.env.INAGLE_DATABASE_URL = "";
    expect(ownedPostgresUrl).toThrow("INAGLE_DATABASE_URL is required");
  } finally {
    for (const key of keys) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
