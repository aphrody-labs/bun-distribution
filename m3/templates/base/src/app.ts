import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { system } from "runtime:system";

export function createDatabase(path = ":memory:"): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.run(
    "CREATE TABLE IF NOT EXISTS hits (id INTEGER PRIMARY KEY, path TEXT NOT NULL, at INTEGER NOT NULL)",
  );
  return db;
}

const MAX_BENCH_ITERATIONS = 2_000_000_000;

function clampIterations(raw: string | null): number {
  const value = Number(raw ?? 1_000_000);
  return Number.isFinite(value)
    ? Math.min(Math.max(Math.trunc(value), 1), MAX_BENCH_ITERATIONS)
    : 1_000_000;
}

type Handler = (request: Request) => Response | Promise<Response>;

export function createRoutes(db: Database): Record<string, Handler> {
  const record = db.prepare("INSERT INTO hits (path, at) VALUES (?, ?)");
  const count = db.prepare("SELECT COUNT(*) AS n FROM hits");
  const hits = (): number => (count.get() as { n: number }).n;

  return {
    "/health": () => Response.json({ ok: true }),

    "/api/stats": () => {
      record.run("/api/stats", Date.now());
      return Response.json({ runtime: system.info(), stats: system.stats(), hits: hits() });
    },

    // Native, cancellable work: a client disconnect aborts `request.signal` and stops the worker.
    "/api/bench": async (request) => {
      const iterations = clampIterations(new URL(request.url).searchParams.get("n"));
      try {
        return Response.json(await system.bench(iterations, { signal: request.signal }));
      } catch (error) {
        if (request.signal.aborted) return new Response(null, { status: 499 });
        throw error;
      }
    },

    // Server-sent events: one stats sample per second until the client goes away.
    "/api/events": (request) => {
      const encoder = new TextEncoder();
      let timer: ReturnType<typeof setInterval> | undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (): void =>
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(system.stats())}\n\n`));
          send();
          timer = setInterval(send, 1000);
          request.signal.addEventListener("abort", () => {
            clearInterval(timer);
            controller.close();
          });
        },
        cancel() {
          clearInterval(timer);
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
      });
    },
  };
}
