// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startM3Server } from "../src/server.ts";
import { m3Auth } from "../src/server-auth.ts";
import { m3Cache } from "../src/server-cache.ts";
import { m3Db } from "../src/server-db.ts";
import { ensureSecret, m3Secret } from "../src/server-secrets.ts";
import { cleanup, tmp } from "./helpers.ts";

afterAll(cleanup);

describe("m3Db (bun:sqlite)", () => {
  test("a file database: directory created, WAL, foreign keys, migrations applied once", () => {
    const path = join(tmp(), "data", "app.sqlite");
    const migrations = [
      "CREATE TABLE lists (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
      (db: import("bun:sqlite").Database) =>
        db.run(
          "CREATE TABLE items (id INTEGER PRIMARY KEY, list INTEGER NOT NULL REFERENCES lists(id))",
        ),
    ];
    const db = m3Db({ path, migrations });
    expect(existsSync(path)).toBe(true);
    expect(db.query("PRAGMA journal_mode").get()).toEqual({
      journal_mode: "wal",
    });
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    expect(() => db.run("INSERT INTO items (list) VALUES (42)")).toThrow(
      /FOREIGN KEY/,
    );
    db.query("INSERT INTO lists (name) VALUES ($name)").run({
      name: "strict params",
    });
    db.close();

    const again = m3Db({
      path,
      migrations: [...migrations, "ALTER TABLE lists ADD COLUMN color TEXT"],
    });
    expect(again.query("PRAGMA user_version").get()).toEqual({
      user_version: 3,
    });
    expect(again.query("SELECT name, color FROM lists").all()).toEqual([
      { name: "strict params", color: null },
    ]);
    again.close();
    expect(() => m3Db({ path, migrations })).toThrow(
      /schema version 3, newer than the 2 migrations/,
    );
  });

  test("a failing migration rolls back, closes the database and names the step", () => {
    const path = join(tmp(), "fail.sqlite");
    expect(() =>
      m3Db({
        path,
        migrations: [
          "CREATE TABLE a (x)",
          "CREATE TABLE b (y); SELECT nope FROM missing",
        ],
      }),
    ).toThrow("m3Db: migration 2 of");
    const db = m3Db({ path, migrations: ["CREATE TABLE a (x)"] });
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 1 });
    expect(
      db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all(),
    ).toEqual([{ name: "a" }]);
    db.close();
  });
});

describe("m3Auth (Bun.password, Bun.CookieMap, Bun.CSRF)", () => {
  test("register, login, me, CSRF-protected logout over real HTTP", async () => {
    const auth = m3Auth({ db: m3Db(), secret: "test-secret", secure: false });
    const server = startM3Server({
      port: 0,
      hostname: "127.0.0.1",
      api: {
        ...auth.routes,
        "/api/whoami": (request) =>
          Response.json({ email: auth.user(request)?.email ?? null }),
      },
    });
    const base = `http://127.0.0.1:${server.port}/api/m3/auth`;
    const post = (
      path: string,
      body: unknown,
      headers: Record<string, string> = {},
    ) =>
      fetch(`${base}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    try {
      const account = { email: "ada@example.com", password: "correct horse" };
      expect((await post("register", account)).status).toBe(201);
      expect(
        (await post("register", { ...account, email: "ADA@example.com" }))
          .status,
      ).toBe(409);
      expect(
        (await post("register", { email: "nope", password: "x" })).status,
      ).toBe(400);
      expect(
        (await post("login", { ...account, password: "wrong password" }))
          .status,
      ).toBe(401);
      expect(
        (
          await post("login", {
            email: "who@example.com",
            password: "whatever1",
          })
        ).status,
      ).toBe(401);

      const login = await post("login", account);
      expect(login.status).toBe(200);
      const setCookie = login.headers.getSetCookie()[0]!;
      expect(setCookie).toMatch(
        /^m3-session=[\w-]{43}; Path=\/; Max-Age=604800; .*HttpOnly; SameSite=Strict/,
      );
      const { csrf, user } = (await login.json()) as {
        csrf: string;
        user: { email: string };
      };
      expect(user.email).toBe("ada@example.com");
      const cookie = setCookie.split(";")[0]!;

      const me = await fetch(`${base}/me`, { headers: { cookie } });
      expect(
        ((await me.json()) as { user: { email: string } }).user.email,
      ).toBe("ada@example.com");
      expect(
        await (
          await fetch(`http://127.0.0.1:${server.port}/api/whoami`, {
            headers: { cookie },
          })
        ).json(),
      ).toEqual({
        email: "ada@example.com",
      });

      expect((await post("logout", {}, { cookie })).status).toBe(403);
      expect(
        (
          await post(
            "logout",
            {},
            { cookie, "x-csrf-token": auth.csrf.token("another-session") },
          )
        ).status,
      ).toBe(403);
      const logout = await post("logout", {}, { cookie, "x-csrf-token": csrf });
      expect(logout.status).toBe(204);
      expect(logout.headers.getSetCookie()[0]).toStartWith("m3-session=;");
      expect((await fetch(`${base}/me`, { headers: { cookie } })).status).toBe(
        401,
      );
    } finally {
      await server.stop(true);
    }
  });

  test("register: false leaves account creation to the app", () => {
    const auth = m3Auth({
      db: m3Db(),
      secret: "s",
      register: false,
      prefix: "/auth",
    });
    expect(Object.keys(auth.routes).toSorted()).toEqual([
      "/auth/login",
      "/auth/logout",
      "/auth/me",
    ]);
  });
});

describe("m3Secret (environment, Bun.secrets)", () => {
  test("the environment variable comes first", async () => {
    Bun.env.M3_BUN_TEST_SESSION_KEY = "from-env";
    try {
      expect(await m3Secret("m3-bun-test.session-key")).toBe("from-env");
      expect(await ensureSecret("m3-bun-test.session-key")).toBe("from-env");
    } finally {
      delete Bun.env.M3_BUN_TEST_SESSION_KEY;
    }
  });

  test("ensureSecret creates the key once in the OS credential store", async () => {
    const service = `m3-bun-test-${crypto.randomUUID()}`;
    const name = "session-key";
    let created: string;
    try {
      created = await ensureSecret(name, { service, env: false });
    } catch (error) {
      // No credential store on this machine (headless Linux without a Secret Service): the error must say so.
      expect(String(error)).toContain(
        "cannot store the secret session-key in the OS credential store",
      );
      return;
    }
    try {
      expect(created).toMatch(/^[\w-]{43}$/);
      expect(await ensureSecret(name, { service, env: false })).toBe(created);
      expect(await m3Secret(name, { service, env: false })).toBe(created);
    } finally {
      await Bun.secrets.delete({ service, name });
    }
    expect(await m3Secret(name, { service, env: false })).toBeUndefined();
  });
});

async function redisAvailable(): Promise<boolean> {
  const client = new Bun.RedisClient(Bun.env.REDIS_URL ?? Bun.env.VALKEY_URL, {
    connectionTimeout: 500,
    autoReconnect: false,
  });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    client.close();
  }
}

describe.skipIf(!(await redisAvailable()))("m3Cache (Bun.RedisClient)", () => {
  test("values, wrap and GET responses are cached with a lifetime", async () => {
    const prefix = `m3-bun-test:${crypto.randomUUID()}:`;
    const cache = m3Cache({ prefix, ttl: 30 });
    try {
      await cache.set("k", { a: 1 });
      expect(await cache.get<{ a: number }>("k")).toEqual({ a: 1 });
      const ttl = await cache.client.ttl(`${prefix}k`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30);
      await cache.delete("k");
      expect(await cache.get("k")).toBeUndefined();
      let computed = 0;
      const compute = () => ++computed;
      expect(await cache.wrap("w", compute)).toBe(1);
      expect(await cache.wrap("w", compute)).toBe(1);

      let calls = 0;
      const handler = cache.route(() => Response.json({ calls: ++calls }));
      const request = () =>
        handler(new Request("http://m3.test/api/feed?x=1") as never);
      const miss = await request();
      expect(miss.headers.get("x-cache")).toBe("MISS");
      const hit = await request();
      expect(hit.headers.get("x-cache")).toBe("HIT");
      expect(await hit.json()).toEqual({ calls: 1 });
      expect(
        (
          await handler(
            new Request("http://m3.test/api/feed", { method: "POST" }) as never,
          )
        ).headers.has("x-cache"),
      ).toBe(false);
    } finally {
      cache.close();
    }
  });
});
