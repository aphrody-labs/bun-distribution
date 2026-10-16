// Source: packages/shenron/db/test/redis.test.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { RedisUnavailableError, createResilientRedis, type RedisLike, type ResilientRedisEvent } from "../src/redis";

/** Fake client that dies (connected = false, closed for good) after `failAfter` errors. */
class FakeRedis implements RedisLike {
  connected = true;
  closed = false;
  errors = 0;
  sent: string[] = [];
  constructor(
    readonly id: number,
    private readonly failAfter: number,
    private readonly failing: () => boolean,
  ) {}
  async send(command: string, args: string[]): Promise<unknown> {
    if (this.closed || !this.connected) throw new Error("ERR_REDIS_CONNECTION_CLOSED");
    if (this.failing()) {
      this.errors++;
      if (this.errors >= this.failAfter) this.connected = false;
      throw new Error("ECONNRESET");
    }
    this.sent.push([command, ...args].join(" "));
    return `ok-${this.id}`;
  }
  close() {
    this.closed = true;
    this.connected = false;
  }
}

function setup(failAfter = 2) {
  let failing = false;
  let clock = 1_000;
  const clients: FakeRedis[] = [];
  const events: ResilientRedisEvent[] = [];
  const redis = createResilientRedis({
    url: "redis://127.0.0.1:6379",
    name: "test",
    backoffMs: [100, 500],
    now: () => clock,
    createClient: () => {
      const c = new FakeRedis(clients.length, failAfter, () => failing);
      clients.push(c);
      return c;
    },
    onEvent: e => events.push(e),
  });
  return {
    redis,
    clients,
    events,
    fail: (v: boolean) => {
      failing = v;
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("createResilientRedis", () => {
  test("creates the client lazily and forwards commands", async () => {
    const { redis, clients, events } = setup();
    expect(clients).toHaveLength(0);
    expect(await redis.send("SET", ["k", "v"])).toBe("ok-0");
    expect(clients[0]!.sent).toEqual(["SET k v"]);
    expect(events).toEqual([{ kind: "connect", attempt: 0 }]);
    expect(redis.name).toBe("test");
    expect(redis.connected).toBe(true);
  });

  test("recreates the client after it dies, with explicit failures in the dead window", async () => {
    const { redis, clients, events, fail, advance } = setup(2);
    await redis.send("PING", []);
    fail(true);
    await expect(redis.send("GET", ["a"])).rejects.toThrow("ECONNRESET");
    expect(clients[0]!.connected).toBe(true);
    await expect(redis.send("GET", ["a"])).rejects.toThrow("ECONNRESET");
    // Client 0 is now dead: dropped and closed.
    expect(clients[0]!.closed).toBe(true);
    expect(redis.connected).toBe(false);
    fail(false);

    // Dead window (backoff 100 ms): explicit rejection, no silent success.
    const queued = redis.send("GET", ["b"]);
    await expect(queued).rejects.toBeInstanceOf(RedisUnavailableError);
    await expect(redis.send("GET", ["b"])).rejects.toThrow(/indisponible/);
    expect(clients).toHaveLength(1);

    advance(100);
    expect(await redis.send("GET", ["b"])).toBe("ok-1");
    expect(clients).toHaveLength(2);
    expect(events.filter(e => e.kind === "recreate")).toEqual([{ kind: "recreate", attempt: 1 }]);
    expect(events.filter(e => e.kind === "error")).toHaveLength(2);
  });

  test("backoff grows then repeats its last value, and resets after a healthy command", async () => {
    const { redis, clients, fail, advance } = setup(1);
    await redis.send("PING", []);
    fail(true);
    await expect(redis.send("X", [])).rejects.toThrow("ECONNRESET"); // death 1 → 100 ms
    advance(100);
    await expect(redis.send("X", [])).rejects.toThrow("ECONNRESET"); // client 1 dies → 500 ms
    advance(100);
    await expect(redis.send("X", [])).rejects.toBeInstanceOf(RedisUnavailableError);
    advance(400);
    fail(false);
    expect(await redis.send("X", [])).toBe("ok-2");
    fail(true);
    await expect(redis.send("X", [])).rejects.toThrow("ECONNRESET"); // back to 100 ms
    advance(100);
    fail(false);
    expect(await redis.send("X", [])).toBe("ok-3");
    expect(clients).toHaveLength(4);
  });

  test("a transient error on a live client does not recreate it", async () => {
    const { redis, clients, fail } = setup(5);
    await redis.send("PING", []);
    fail(true);
    await expect(redis.send("X", [])).rejects.toThrow("ECONNRESET");
    fail(false);
    expect(await redis.send("X", [])).toBe("ok-0");
    expect(clients).toHaveLength(1);
  });

  test("close() is final and explicit", async () => {
    const { redis, clients } = setup();
    await redis.send("PING", []);
    redis.close();
    expect(clients[0]!.closed).toBe(true);
    await expect(redis.send("PING", [])).rejects.toThrow(/fermé/);
  });
});
