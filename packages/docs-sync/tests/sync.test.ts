import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { SyncEngine, inside, type Config, type Topic } from "../src/sync";

async function fixture(
  run: (context: {
    engine: () => SyncEngine;
    topic: Topic;
    directory: string;
    requests: Map<string, number>;
    fail: (value: boolean) => void;
  }) => Promise<void>,
) {
  const directory = await mkdtemp(resolve(tmpdir(), "docs-sync-"));
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + "docs-sync-"))
    throw new Error("Unsafe fixture cleanup path");
  const requests = new Map<string, number>();
  let failing = false;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request): Response {
      const path = new URL(request.url).pathname;
      requests.set(path, (requests.get(path) ?? 0) + 1);
      if (path === "/two.html" && failing) return new Response("Unavailable", { status: 503 });
      if (request.headers.get("if-none-match") === `"${path}"`) return new Response(null, { status: 304 });
      const text =
        path === "/sitemap.xml"
          ? `<urlset><url><loc>${server.url.origin}/one.html</loc></url><url><loc>${server.url.origin}/two.html</loc></url></urlset>`
          : `<html><title>${path}</title><p>Official fixture ${path}</p></html>`;
      return new Response(text, {
        headers: {
          etag: `"${path}"`,
          "content-type": path.endsWith(".xml") ? "application/xml" : "text/html",
        },
      });
    },
  });
  const topic: Topic = {
    id: "ui",
    title: "Complete fixture",
    sources: [
      {
        id: "official",
        kind: "sitemap",
        url: `${server.url.origin}/sitemap.xml`,
        include: `^${server.url.origin}/`,
      },
    ],
  };
  const config: Config = {
    schemaVersion: 1,
    concurrency: 2,
    requestTimeoutMs: 3000,
    retries: 0,
    maxFileBytes: 100000,
    maxCatalogEntries: 0,
    freshnessHours: 36,
    allowedHosts: [],
    topics: [topic],
  };
  try {
    await run({
      engine: () =>
        new SyncEngine(config, {
          output: directory,
          checkout: directory,
          testOrigins: [server.url.origin],
        }),
      topic,
      directory,
      requests,
      fail: value => {
        failing = value;
      },
    });
  } finally {
    server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}

async function expire(directory: string) {
  const path = resolve(directory, "ui/manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  for (const file of manifest.files) file.checkedAt = "1970-01-01T00:00:00.000Z";
  await writeFile(path, JSON.stringify(manifest));
}

test("complete sitemap sync uses HTTP 304 and verifies every stored hash", async () => {
  await fixture(async ({ engine, topic, directory, requests }) => {
    const first = await engine().syncTopic(topic);
    expect(first.status).toBe("complete");
    expect(first.expected).toBe(2);
    expect((await engine().check(topic)).ok).toBe(true);
    await expire(directory);
    const second = await engine().syncTopic(topic);
    expect(second.status).toBe("complete");
    expect(requests.get("/one.html")).toBe(2);
    expect(requests.get("/two.html")).toBe(2);
    await writeFile(resolve(directory, "ui/content/official/one.html"), "corrupted");
    const checked = await engine().check(topic);
    expect(checked.ok).toBe(false);
    expect(checked.errors.some(error => error.includes("corrupted"))).toBe(true);
  });
});

test("network failure preserves current valid content and resumes only missing success", async () => {
  await fixture(async ({ engine, topic, directory, requests, fail }) => {
    await engine().syncTopic(topic);
    const path = resolve(directory, "ui/content/official/two.html");
    const valid = await readFile(path, "utf8");
    await expire(directory);
    fail(true);
    const failed = await engine().syncTopic(topic);
    expect(failed.status).toBe("incomplete");
    expect(failed.failed).toBe(1);
    expect(await readFile(path, "utf8")).toBe(valid);
    expect((await engine().check(topic)).ok).toBe(false);
    const oneRequests = requests.get("/one.html");
    fail(false);
    const resumed = await engine().syncTopic(topic);
    expect(resumed.status).toBe("complete");
    expect(requests.get("/one.html")).toBe(oneRequests);
    expect((await engine().check(topic)).ok).toBe(true);
  });
});

test("source configuration change cannot reuse an obsolete green manifest", async () => {
  await fixture(async ({ engine, topic }) => {
    await engine().syncTopic(topic);
    const changed = { ...topic, sources: [{ ...topic.sources[0], include: "/one.html$" }] };
    const result = await engine().check(changed);
    expect(result.ok).toBe(false);
    expect(result.errors.some(error => error.includes("configuration"))).toBe(true);
  });
});

test("truncated GitHub tree expands all child subtrees before completeness", async () => {
  const topic: Topic = { id: "m3", title: "Source API", sources: [] };
  const config: Config = {
    schemaVersion: 1,
    concurrency: 1,
    requestTimeoutMs: 1000,
    retries: 0,
    maxFileBytes: 10000,
    maxCatalogEntries: 0,
    freshnessHours: 36,
    allowedHosts: ["api.github.com", "raw.githubusercontent.com"],
    topics: [topic],
  };
  const engine = new SyncEngine(config, { output: tmpdir(), checkout: tmpdir() });
  const encoder = new TextEncoder();
  engine.metadata = async url =>
    encoder.encode(
      JSON.stringify(
        url.includes("/commits/")
          ? { sha: "commit", commit: { tree: { sha: "root" }, committer: { date: "2026-10-12" } } }
          : url.endsWith("root?recursive=1")
            ? { truncated: true, tree: [{ type: "blob", path: "partial.md" }] }
            : url.endsWith("/root")
              ? {
                  truncated: false,
                  tree: [
                    { type: "blob", path: "one.md", sha: "one" },
                    { type: "tree", path: "nested", sha: "sub" },
                  ],
                }
              : { truncated: false, tree: [{ type: "blob", path: "two.md", sha: "two" }] },
      ),
    );
  const result = await engine.discover({
    id: "source",
    kind: "github-tree",
    repository: "official/docs",
    ref: "main",
    include: ".*",
    extensions: [".md"],
  });
  expect(result.items.map(item => item.path).sort()).toEqual(["source/nested/two.md", "source/one.md"]);
  expect(result.provenance.catalogueComplete).toBe(true);
});

test("official-origin and filesystem boundaries reject credential URLs and traversal", () => {
  const config: Config = {
    schemaVersion: 1,
    concurrency: 1,
    requestTimeoutMs: 1000,
    retries: 0,
    maxFileBytes: 10000,
    maxCatalogEntries: 0,
    freshnessHours: 36,
    allowedHosts: ["developer.android.com"],
    topics: [],
  };
  const engine = new SyncEngine(config, { output: tmpdir(), checkout: tmpdir() });
  expect(() => engine.guardUrl("https://example.com/docs")).toThrow();
  expect(() => engine.guardUrl("https://user:private@developer.android.com/docs")).toThrow();
  for (const path of ["../escape", "C:/outside", "safe/../../escape", "safe\\escape"])
    expect(() => inside(tmpdir(), path)).toThrow();
});
