import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createWorkspaceServer } from "../src/workspace";

const obscuraModuleName = "bun:obscura";
const obscura = (await import(obscuraModuleName)) as {
  findExecutable(): string | null;
  launch(options: { headless: boolean; timeout: number; workers: number }): Promise<{
    connection: {
      send<T>(method: string, params?: unknown, sessionId?: string): Promise<T>;
      on(method: string, callback: (params: unknown, sessionId?: string) => void): () => void;
    };
    close(): Promise<void>;
  }>;
};

let server: ReturnType<typeof createWorkspaceServer>;

beforeAll(() => {
  server = createWorkspaceServer({ port: 0 });
});

afterAll(() => {
  server.stop(true);
});

describe("Bun Engine web", () => {
  test("serves the app and workspace API concurrently", async () => {
    const [app, workspace] = await Promise.all([
      fetch(new URL("/", server.url)),
      fetch(new URL("/api/workspace", server.url)),
    ]);

    expect(app.status).toBe(200);
    expect(app.headers.get("content-type")).toContain("text/html");
    expect(await app.text()).toContain("Bun Engine");
    expect(workspace.status).toBe(200);
    expect(workspace.headers.get("content-type")).toContain("application/json");
    expect(await workspace.json()).toMatchObject({
      schema: 1,
      distribution: "unified",
    });
  });

  test("rejects an invalid configured port before starting a listener", () => {
    expect(() => createWorkspaceServer({ port: Number.NaN })).toThrow(/invalid Bun Engine web port/);
    expect(() => createWorkspaceServer({ port: 65_536 })).toThrow(/invalid Bun Engine web port/);
  });

  test.skipIf(!obscura.findExecutable())(
    "loads the workspace API through real Chrome targets concurrently",
    async () => {
      const browser = await obscura.launch({
        headless: true,
        timeout: 10_000,
        workers: 1,
      });
      try {
        const readSchema = async () => {
          const { targetId } = await browser.connection.send<{
            targetId: string;
          }>("Target.createTarget", { url: "about:blank" });
          const { sessionId } = await browser.connection.send<{
            sessionId: string;
          }>("Target.attachToTarget", { targetId, flatten: true });
          await browser.connection.send("Page.enable", {}, sessionId);
          const loaded = new Promise<void>(resolve => {
            const unsubscribe = browser.connection.on("Page.loadEventFired", (_params, eventSessionId) => {
              if (eventSessionId !== sessionId) return;
              unsubscribe();
              resolve();
            });
          });
          await browser.connection.send("Page.navigate", { url: server.url.href }, sessionId);
          await loaded;
          const response = await browser.connection.send<{
            result: { value: number };
            exceptionDetails?: unknown;
          }>(
            "Runtime.evaluate",
            {
              expression: "fetch('/api/workspace').then(response => response.json()).then(value => value.schema)",
              awaitPromise: true,
              returnByValue: true,
            },
            sessionId,
          );
          expect(response.exceptionDetails).toBeUndefined();
          return response.result.value;
        };

        expect(await Promise.all([readSchema(), readSchema()])).toEqual([1, 1]);
      } finally {
        await browser.close();
      }
    },
    15_000,
  );
});
