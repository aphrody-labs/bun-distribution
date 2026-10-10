# Aphrody Web cluster — sharded frontier, workers and `aphrody web serve --agent`

How several processes (on one or many machines) crawl into one agent index
without fetching a URL twice, and how one process serves the API, MCP and a
crawler daemon. PLAN.md Phase 3.1–3.2.

Local and cluster tooling only: nothing here exposes the public Aphrody backend.
`aphrody-site` owns `/api/v1/web/*`, `/api/v1/bxc/rankings` and `/mcp`; `aphrody web serve --agent` binds
`127.0.0.1` by default.

```
                    aphrody web worker seed / submit()           links on foreign shards
                              │                                   ▲
                              ▼                                   │ route() → XADD
  ┌──────────────── Redis (one {frontier} hash tag) ──────────────┼─────────────┐
  │ seen-set: partitioned Bloom on bitmaps  ◄── atomic Lua: SETBIT… + XADD      │
  │ Aphrody Web:{f}:shard:0 … shard:N-1   (streams, consumer group "workers")           │
  │ Aphrody Web:{f}:lease:i  (SET NX PX)   Aphrody Web:{f}:workers (zset)   :workers:caps (hash)│
  └───────┬─────────────────────────────────────────────────────┬───────────────┘
          │ XREADGROUP owned shards → addRequests → XACK+XDEL    │
          ▼                                                      ▼
  worker A: RequestQueue (shard-local)                  worker B: …
            MassiveCrawler (routeLink = frontier.route)
            DomainMemory · PagePool · document pipeline
          │                                                      │
          └──────────────► BxcDB index (idempotent upsert on URL + content hash)
```

Code: `src/queue/sharded/` (`consistent-hash.ts`, `seen-set.ts`,
`RedisFrontier.ts`, `redis.ts`), `src/cluster/worker.ts`,
`src/cluster/serve.ts`, CLI `src/cli/worker.ts`. Tests: `test/cluster/`.

## Sharding

- **Shard key** = registrable domain (eTLD+1, `src/profiles/etld.ts`): every URL
  of a site maps to one shard, hence one worker, so politeness, per-host
  concurrency and domain memory stay local.
- **Shard** = Jump Consistent Hash (Lamping & Veach) of xxHash64(key) over `N`
  shards: no table, balanced, and growing `N → N+1` moves only `≈ 1/(N+1)` of
  the keys (all to the new shard).
- `N` is fixed when the frontier is created (stored in `Aphrody Web:{f}:meta`); opening
  it with a different explicit `--shards` is refused. Pick `N` well above the
  largest expected worker count (e.g. 64–256): shards are the unit of
  rebalancing, workers are not.

Measured (`test/cluster/consistent-hash.test.ts`): 10 000 domains over 16
shards → worst shard deviates 9.4 % from the mean; 16 → 17 shards moves 6.07 %
of the keys (theory 5.88 %), all to shard 16.

## Leases and membership

Every heartbeat (`leaseMs / 3`, default 5 s) runs one Lua script that
expires dead workers from `Aphrody Web:{f}:workers` (score = expiry, Redis `TIME`),
registers the worker and its `--max-shards` cap, and renews its leases
(compare-and-`PEXPIRE` on the per-process token).

- **Target** per worker: water-filling of the `N` shards over the live workers,
  smallest cap first — deterministic, sums to `N`, respects caps.
- Above target → release the extra leases (compare-and-delete). Below target →
  `SET lease token NX PX leaseMs` on free shards.
- A worker only treats a shard as owned while its local lease deadline
  (renewal send time + `leaseMs` − margin) is in the future.
- **Join**: a new worker converges within ~2 heartbeats (existing workers see
  one more live member, release, the newcomer acquires).
- **Crash**: the dead worker's registry entry and leases expire together
  (`leaseMs` after its last heartbeat); survivors' targets grow and they
  acquire the free leases at their next heartbeat. Takeover latency
  ≤ `leaseMs + heartbeatMs` (default ≤ 20 s). Measured with `leaseMs = 1000`,
  `heartbeatMs = 150`: 950–1030 ms from kill to all shards re-owned.

## Streams and delivery

- `submit()` / routed links: one Lua script per batch sets the URL's bits in the
  seen-set and `XADD`s it to its shard stream only when at least one bit was
  new (or `force`). A URL is therefore never marked seen without being queued.
- Owner: `XREADGROUP GROUP workers <workerId> … STREAMS <owned shards> >` on a
  dedicated connection, `addRequests` into the shard-local `RequestQueue`, then
  `XACK` + `XDEL` (stream length = work not yet accepted by a worker).
- Entries read for a shard that is no longer owned are re-appended to the stream
  and acknowledged atomically (`REQUEUE`), so the new owner reads them.
- Pending entries (delivered, never acknowledged — e.g. a crash between read and
  insert) are claimed with `XAUTOCLAIM` when a shard is acquired (min idle 0)
  and periodically for owned shards (min idle `claimIdleMs`).
- Backpressure: reading pauses while the local queue holds more than
  `maxLocalPending` (default 100 000) pending requests.
- `route(url)` (the `MassiveCrawler.routeLink` hook) returns `false` for owned
  shards — the crawler enqueues the link locally and the URL is added to the
  seen-set in the background — and `true` after buffering foreign links for a
  batched `submit()` (10 ms window).

## Seen-set

Partitioned Bloom filter on plain Redis bitmaps (no modules), one string per
partition (`Aphrody Web:{f}:seen:bits:i`), sized by the first opener and stored in
`Aphrody Web:{f}:seen:meta` so every worker computes identical offsets:

```
k      = ceil(log2(1/p))              hash functions = partitions
m      = ceil(-n · ln p / (ln 2)²)    total bits
m_part = ceil(m / k)                  bits per partition
FPR(n) = (1 − e^(−n / m_part))^k      ≈ p at n items
offset_i = (h1 + i·h2) mod m_part     h1, h2 = seeded xxHash32 (Kirsch–Mitzenmacher)
```

Default `n = 50 M`, `p = 1 %`: k = 7, ≈ 57 MiB total, 8.6 MiB per partition
(a partition can grow to the 512 MiB string limit, i.e. ~3 B URLs at 1 %).
`MemorySeenSet` is the same filter on `Uint8Array`s for single-node use.

Measured (`test/cluster/seen-set.test.ts`, 100 k inserted + 100 k probe keys,
filter sized for 100 k at 1 %): no false negatives, FPR 1.06 % (memory and
Redis give identical bits).

## Effectively-once indexing

1. Delivery is at-least-once (ack after the local insert; reclaim on crash).
2. Duplicated deliveries collapse on the shard-local `RequestQueue` unique key.
3. Cross-worker duplicates are suppressed by the shared seen-set; a domain's
   URLs are only ever dispatched by its shard owner.
4. `BxcDB.upsertDocument` is idempotent on URL + content hash, so a page that is
   fetched again after a failover rewrites nothing.

End-to-end (`test/cluster/cluster-crawl.test.ts`): 2 workers, 8 shards, a hub
site linking to 3 fixture blogs placed on different workers → 90/90 canonical
articles indexed exactly once in one shared SQLite index, no request URL
dispatched twice across the cluster, 0 variant URLs (`utm_*`, `/amp/`,
`?print=1`) stored.

## `aphrody web serve --agent`

One process: `createBxcApp()` (all `/api/v1/*` routes, including
`GET /api/v1/index/search?q=&mode=keyword|hybrid`), MCP over streamable HTTP at
`/mcp`, and a `MassiveCrawler` daemon — on a local frontier, or as a cluster
worker with `--redis` + `--frontier`. `--sqlite` sets `BXC_DB_PATH` for the
process so the crawler, the API routes and the MCP tools share one index.

| Route | Purpose |
|-------|---------|
| `GET /agent/stats` | crawler counters (+ frontier view in cluster mode) |
| `POST /agent/crawl` | `{"urls": [...]}` → enqueue seeds into the daemon |
| `/mcp` | MCP streamable HTTP (stateless); 404 with a pointer to `aphrody web mcp` when unavailable |

`--token` (or `BXC_API_TOKEN`) protects every route except `/health`. MCP over
HTTP requires `src/mcp/server.ts` to export its `createServer` factory; until it
does, stdio `aphrody web mcp` remains the MCP entry point and `/mcp` answers 404.

```bash
aphrody web serve --agent --port 8787 --sqlite ~/.bxc/agent.sqlite --crawl https://docs.example.org/
curl -s 'http://127.0.0.1:8787/api/v1/index/search?q=install&mode=keyword'
curl -s -XPOST http://127.0.0.1:8787/agent/crawl -d '{"urls":["https://example.com/"]}'
```

## Operations

```bash
# Start N workers (any hosts that reach Redis). Unique, stable ids + a queue
# file make a restarted worker resume its accepted backlog.
aphrody web worker --redis redis://10.0.0.5:6379 --frontier web --shards 64 \
  --worker-id crawler-1 --queue /var/lib/bxc/crawler-1.queue.db \
  --sqlite /var/lib/bxc/crawler-1.sqlite --ladder http,render,stealth --concurrency 64

# Seed (seen-set suppresses repeats; --force re-queues)
aphrody web worker seed --redis redis://10.0.0.5:6379 --frontier web https://example.com/ https://example.org/

# Cluster view: live workers, per-shard backlog / pending / owner, seen-set fill
aphrody web worker stats --redis redis://10.0.0.5:6379 --frontier web [--json]
```

- **Add a worker**: start it; shards rebalance within ~2 heartbeats.
- **Remove a worker**: `SIGTERM`/`SIGINT` — in-flight requests finish, routed
  links are flushed, leases released and the worker unregistered; its shards
  move immediately. A second signal forces exit.
- **Crash**: shards move after lease expiry; unacknowledged stream entries are
  reclaimed. Restart with the same `--worker-id` and `--queue` to finish the
  requests that worker had already accepted.
- **Small machines**: `--max-shards` caps a worker; the others absorb the rest.
- **Reset a frontier**: stop the workers, then
  `ShardedFrontier.drop({ redisUrl, name })` deletes every `Aphrody Web:{name}:*` key.
- Run Redis with AOF (`appendonly yes`) if the frontier must survive a Redis
  restart; all keys of a frontier share one Redis Cluster slot.

## Limits

- **Accepted backlog is per worker.** A stream entry is acknowledged once it is
  in the worker's local queue. With the default in-memory queue, a crash loses
  that backlog (the URLs stay in the seen-set, so they are not rediscovered);
  use `--queue <file>` + a stable `--worker-id` and restart the worker.
- **Rebalancing splits politeness temporarily**: a worker keeps crawling the
  backlog it accepted for a shard it released while the new owner receives new
  URLs of the same domains.
- **Bloom false positives drop ≈ p of never-seen cross-shard URLs** (local links
  bypass the filter). Size `expectedItems` for the crawl; the stored sizing
  cannot change without a new frontier.
- **Shard count is fixed** per frontier; resharding = new frontier + reseed.
- **OPIC cash does not cross shards** (a routed link starts with seed cash).
- A shared SQLite index serializes writers (WAL + busy timeout); for many
  workers prefer one index file per worker or a server database.
- `MassiveCrawler` enqueues cross-domain `rel=canonical` targets locally (not
  through `routeLink`), and canonicalises variant requests before fetching,
  which can re-fetch an already-crawled canonical URL on the same worker.
- No authentication/ACL on Redis keys beyond what the Redis deployment provides.
