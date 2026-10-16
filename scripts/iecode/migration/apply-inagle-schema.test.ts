import { afterEach, beforeEach, expect, test } from "bun:test";
import { resolveInaglePostgresUrl } from "./apply-inagle-schema.js";

const variables = ["INAGLE_DATABASE_URL", "NIE_PG_URL", "DATABASE_URL", "POSTGRES_URL", "SUPABASE_DB_URL"] as const;
let original: Map<(typeof variables)[number], string | undefined>;

beforeEach(() => {
  original = new Map(variables.map(name => [name, process.env[name]]));
});

afterEach(() => {
  for (const name of variables) {
    const value = original.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("Inagle migrations resolve only their explicit Neon/local connection variables", () => {
  delete process.env.INAGLE_DATABASE_URL;
  delete process.env.NIE_PG_URL;
  process.env.DATABASE_URL = "postgresql://rg@db.project.supabase.co/rg";
  process.env.POSTGRES_URL = "postgresql://rg@pooler.supabase.com/rg";
  process.env.SUPABASE_DB_URL = "postgresql://rg@db.project.supabase.co/rg";
  expect(resolveInaglePostgresUrl()).toBeUndefined();

  process.env.NIE_PG_URL = "postgresql://local@127.0.0.1/inagle";
  expect(resolveInaglePostgresUrl()).toBe("postgresql://local@127.0.0.1/inagle");

  process.env.INAGLE_DATABASE_URL = "postgresql://game@ep-example.eu-central-1.aws.neon.tech/inagle";
  expect(resolveInaglePostgresUrl()).toBe(process.env.INAGLE_DATABASE_URL);
  expect(resolveInaglePostgresUrl("postgresql://local@127.0.0.1/inagle")).toBe("postgresql://local@127.0.0.1/inagle");
  expect(resolveInaglePostgresUrl("postgresql://local@[::1]/inagle")).toBe("postgresql://local@[::1]/inagle");
});

test("Inagle migrations reject Supabase targets and incorrectly named Neon databases", () => {
  expect(() => resolveInaglePostgresUrl("postgresql://rg@db.project.supabase.co/rg")).toThrow("cannot target Supabase");
  expect(() => resolveInaglePostgresUrl("postgresql://game@ep-example.eu-central-1.aws.neon.tech/rg")).toThrow(
    "require the inagle database",
  );
  expect(() =>
    resolveInaglePostgresUrl("postgresql://game@ep-example-pooler.eu-central-1.aws.neon.tech/inagle"),
  ).toThrow("direct, non-pooler endpoint");
  expect(() => resolveInaglePostgresUrl("postgresql://game@db.example.net/inagle")).toThrow(
    "require the dedicated Neon project",
  );
  expect(() => resolveInaglePostgresUrl("https://example.invalid/private-marker")).toThrow(
    "valid PostgreSQL connection URL",
  );
});
