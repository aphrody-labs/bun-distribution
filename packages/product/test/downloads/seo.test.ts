// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandler, documentSeo } from "@aphrody/product/downloads";

test("document summaries use article prose and escape markup while preserving existing metadata", async () => {
  const source =
    "<html><head><title>Streams - Aphrody</title></head><body><nav><p>Navigation</p></nav><article><p>Read <code>streams</code> safely &amp; quickly.</p></article></body></html>";
  const html = await documentSeo(source, "/docs/guides/streams/to-json");
  expect(html).toContain('name="description"');
  expect(html).toContain("Read streams safely");
  expect(html).toContain("safely &#38; quickly.");
  expect(html).not.toContain("&#38;amp;");
  expect(html).not.toContain('content="Navigation');
  expect(html).toContain("Streams - Aphrody · guides / streams / to json");
  const existing = source.replace(
    "</head>",
    '<meta name="description" content="Maintained summary"></head>',
  );
  const retained = await documentSeo(existing, "/docs/runtime/streams");
  expect(retained).toContain('content="Maintained summary"');
  expect(retained.match(/name="description"/g)).toHaveLength(1);
  expect(await documentSeo(source, "/runtime")).toBe(source);
});

test("distinct docs get distinct titles and blank descriptions are replaced with bounded prose", async () => {
  const source =
    '<html><head><title>Plugins - Aphrody</title><meta name="description" content=""></head><body><article><p>' +
    "Useful documentation content. ".repeat(20) +
    "</p></article></body></html>";
  const runtime = await documentSeo(source, "/docs/runtime/plugins");
  const bundler = await documentSeo(source, "/docs/bundler/plugins");
  expect(runtime).toContain("runtime / plugins</title>");
  expect(bundler).toContain("bundler / plugins</title>");
  expect(runtime.match(/name="description"/g)).toHaveLength(1);
  const description = /name="description" content="([^"]+)"/.exec(runtime)?.[1];
  expect(description).toBeDefined();
  expect(description!.length).toBeLessThanOrEqual(160);
});

test("real handler corrects HTML even with stale compressed assets and keeps HEAD bodyless", async () => {
  const root = mkdtempSync(join(tmpdir(), "aphrody-site-seo-"));
  try {
    mkdirSync(join(root, "docs"));
    writeFileSync(
      join(root, "docs", "streams.html"),
      "<html><head><title>Streams</title></head><body><article><p>Read stream values.</p></article></body></html>",
    );
    writeFileSync(
      join(root, "docs", "streams.html.gz"),
      "stale compressed payload",
    );
    const handler = createHandler(root, {
      root,
      hosts: new Set(["aphrody.test"]),
    });
    const response = await handler(
      new Request("https://aphrody.test/docs/streams", {
        headers: { "accept-encoding": "gzip" },
      }),
    );
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.text()).toContain('content="Read stream values."');
    const head = await handler(
      new Request("https://aphrody.test/docs/streams", { method: "HEAD" }),
    );
    expect(await head.text()).toBe("");
    expect(head.headers.get("content-type")).toContain("text/html");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
