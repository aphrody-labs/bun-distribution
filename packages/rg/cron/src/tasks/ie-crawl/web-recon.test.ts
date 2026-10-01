// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crawlWebRecon } from "./web-recon";

test("recon delegates bounded discovery and probes to the native owner without inventing status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aphrody-web-recon-"));
  const binary = join(dir, "aphrody-web");
  const calls = join(dir, "calls.jsonl");
  const before = process.env.APHRODY_WEB_BIN;
  await writeFile(
    binary,
    `#!/usr/bin/env bun
const args = process.argv.slice(2);
await Bun.write(Bun.file(${JSON.stringify(calls)}), (await Bun.file(${JSON.stringify(calls)}).exists() ? await Bun.file(${JSON.stringify(calls)}).text() : "") + JSON.stringify(args) + "\\n");
const probes = args.includes("--max-depth") && args[args.indexOf("--max-depth") + 1] === "0";
console.log(JSON.stringify({schema:"aphrody-web.crawl/1",pages: probes ? [{url:"https://example.test/data.json",status:200,contentType:"application/json",html:'{"value":42}'}] : [{url:"https://example.test/target/",status:206,contentType:"text/html",html:'<html><a href="/data.json">Data</a></html>'}],errors:[],stats:{}}));
`,
    { mode: 0o700 },
  );
  process.env.APHRODY_WEB_BIN = binary;
  try {
    const result = await crawlWebRecon({
      rootUrl: "https://example.test/target/",
      outDir: join(dir, "out"),
    });
    const argv = (await Bun.file(calls).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(argv).toHaveLength(2);
    expect(argv.every((args) => args[0] === "crawl")).toBe(true);
    expect(argv[0]).toContain("--render");
    expect(argv[1]).not.toContain("--render");
    expect(argv[0]).toContain("--include-url-regex");
    expect(argv[0]).toContain("--exclude-url-regex");
    expect(argv[1]?.[argv[1].indexOf("--max-depth") + 1]).toBe("0");
    expect(result.endpoints.find((entry) => entry.kind === "page")?.status).toBe(206);
    expect(result.endpoints.find((entry) => entry.url.endsWith("data.json"))?.kind).toBe("json");
    expect(
      JSON.parse(await Bun.file(join(dir, "out/json/example.test_data.json.json")).text()),
    ).toEqual({ value: 42 });
  } finally {
    if (before === undefined) delete process.env.APHRODY_WEB_BIN;
    else process.env.APHRODY_WEB_BIN = before;
    await rm(dir, { recursive: true, force: true });
  }
});
