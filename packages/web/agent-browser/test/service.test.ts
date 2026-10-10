// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DEFAULT_WEB_CONFIG,
  engineBinaryCandidates,
  expandHome,
  loadWebConfig,
  mergeConfig,
  repositoryRoot,
  validateWebConfig,
} from "../src/config.ts";
import { WebService, crawlArgs, fetchArgs } from "../src/service.ts";

const root = repositoryRoot();

describe("tools/config/web.json", () => {
  test("is readable and merges onto the defaults", () => {
    const config = loadWebConfig({ root, env: {} });
    expect(config.source).toBe(join(root, "tools/config/web.json"));
    expect(config.engine.host).toBe("127.0.0.1");
    expect(config.engine.allowPrivateNetwork).toBe(false);
    expect(config.crawl.obeyRobots).toBe(true);
    expect(config.network.allowedSchemes).toEqual(["http", "https"]);
    expect(config.fetch.timeoutSecs).toBeGreaterThan(0);
  });

  test("falls back to defaults when the file is absent and rejects an unknown schema", () => {
    const missing = loadWebConfig({
      root,
      file: join(root, "config/does-not-exist.json"),
      env: {},
    });
    expect(missing.source).toBeNull();
    expect(missing.engine.port).toBe(DEFAULT_WEB_CONFIG.engine.port);
    expect(() =>
      loadWebConfig({ root, file: join(import.meta.dir, "../package.json"), env: {} }),
    ).toThrow(/schemaVersion 1/);
  });

  test("environment and explicit overrides win, in that order", () => {
    const env = { APHRODY_WEB_PORT: "4321", OBSCURA_ALLOW_PRIVATE_NETWORK: "true" };
    const config = loadWebConfig({ root, env, overrides: { crawl: { maxPages: 3 } } });
    expect(config.engine.port).toBe(4321);
    expect(config.engine.allowPrivateNetwork).toBe(true);
    expect(config.crawl.maxPages).toBe(3);
    expect(config.crawl.maxDepth).toBe(2);
    expect(loadWebConfig({ root, env: { APHRODY_WEB_PORT: "-1" } }).engine.port).toBe(9222);
  });

  test("mergeConfig replaces arrays and merges objects without mutating the base", () => {
    const base = { a: { b: 1, c: [1, 2] }, d: 1 };
    const merged = mergeConfig(base, { a: { c: [9] }, d: undefined });
    expect(merged).toEqual({ a: { b: 1, c: [9] }, d: 1 });
    expect(base.a.c).toEqual([1, 2]);
  });

  test("binary candidates put the explicit override first and expand ~ and relative paths", () => {
    const config = loadWebConfig({ root, env: {} });
    const candidates = engineBinaryCandidates(config, { APHRODY_WEB_BIN: "/opt/aphrody-web" });
    expect(candidates[0]).toBe(resolve("/opt/aphrody-web"));
    expect(candidates).toContain(join(root, "target/debug/aphrody-web"));
    expect(
      candidates.some((path) => path === join(expandHome("~"), ".local/bin/aphrody-web")),
    ).toBe(true);
  });
});

describe("service argument builders", () => {
  const config = loadWebConfig({ root, env: {} });

  test("fetch uses configured defaults and forwards options", () => {
    const args = fetchArgs("https://example.test/", {}, config);
    expect(args.slice(0, 4)).toEqual(["fetch", "https://example.test/", "--quiet", "--dump"]);
    expect(args).toContain("markdown");
    const custom = fetchArgs(
      "https://example.test/",
      { dump: "artifact", selector: "main", stealth: true, proxy: "http://p:1" },
      config,
    );
    expect(custom.slice(0, 2)).toEqual(["--proxy", "http://p:1"]);
    expect(custom).toContain("--stealth");
    expect(custom[custom.indexOf("--selector") + 1]).toBe("main");
  });

  test("crawl is bounded and obeys robots by default", () => {
    const args = crawlArgs(
      ["https://example.test/"],
      {
        maxPages: 5,
        allowedDomains: ["example.test"],
        includeLinks: true,
        includeUrlRegex: ["/target/"],
        excludeUrlRegex: ["/private/"],
      },
      config,
    );
    expect(args[0]).toBe("crawl");
    expect(args).toContain("--obey-robots");
    expect(args[args.indexOf("--max-pages") + 1]).toBe("5");
    expect(args[args.indexOf("--allowed-domain") + 1]).toBe("example.test");
    expect(args).toContain("--include-links");
    expect(args[args.indexOf("--include-url-regex") + 1]).toBe("/target/");
    expect(args[args.indexOf("--exclude-url-regex") + 1]).toBe("/private/");
    expect(args).not.toContain("--allow-private-network");
    expect(crawlArgs(["https://example.test/"], { obeyRobots: false }, config)).not.toContain(
      "--obey-robots",
    );
    expect(() => crawlArgs([], {}, config)).toThrow(/at least one seed/);
  });
});

describe("validateWebConfig", () => {
  const good = JSON.parse(readFileSync(join(root, "tools/config/web.json"), "utf8"));

  test("the committed config honours the contract", () => {
    expect(validateWebConfig(good)).toEqual([]);
  });

  test("rejects non-loopback hosts, unbounded crawls, other schemes and secret-looking values", () => {
    const bad = structuredClone(good);
    bad.engine.host = "0.0.0.0";
    bad.engine.allowPrivateNetwork = true;
    bad.crawl.maxPages = 0;
    bad.network.allowedSchemes = ["http", "file"];
    bad.storage.token = "abc123";
    const problems = validateWebConfig(bad);
    expect(problems.some((p) => p.includes("loopback"))).toBe(true);
    expect(problems.some((p) => p.includes("allowPrivateNetwork"))).toBe(true);
    expect(problems.some((p) => p.includes("crawl.maxPages"))).toBe(true);
    expect(problems.some((p) => p.includes("allowedSchemes"))).toBe(true);
    expect(problems.some((p) => p.includes("storage.token"))).toBe(true);
    expect(validateWebConfig(null)).toEqual(["config must be a JSON object"]);
  });
});

test("bounded response delegates its cap to the native owner and preserves metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aphrody-web-response-"));
  const binary = join(dir, "aphrody-web");
  await writeFile(
    binary,
    `#!/usr/bin/env bun
const args = process.argv.slice(2);
if (args[0] !== "response" || args[args.indexOf("--max-bytes") + 1] !== "6" || args.includes("--allow-private-network")) process.exit(9);
console.log(JSON.stringify({ url: "https://example.test/final", status: 206, headers: { "content-type": "text/plain" }, bytes: 6, truncated: true, body: "abcdef" }));
`,
    { mode: 0o700 },
  );
  try {
    const service = new WebService({ binary });
    const response = await service.response("https://example.test/", { maxBytes: 6 });
    expect(response).toEqual({
      url: "https://example.test/final",
      status: 206,
      headers: { "content-type": "text/plain" },
      bytes: 6,
      truncated: true,
      body: "abcdef",
    });
    await expect(service.response("https://example.test/", { maxBytes: 0 })).rejects.toThrow(
      RangeError,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("crawl cancellation stops the owning process and retains AbortError", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aphrody-web-cancel-"));
  const binary = join(dir, "aphrody-web");
  const ready = join(dir, "ready");
  await writeFile(
    binary,
    `#!/usr/bin/env bun
await Bun.write(${JSON.stringify(ready)}, "ready");
setInterval(() => {}, 1000);
`,
    { mode: 0o700 },
  );
  const abort = new AbortController();
  const service = new WebService({ binary });
  const completed = service
    .crawl(["https://example.test/"], { signal: abort.signal, timeoutSecs: 10 })
    .then(
      () => ({ error: null }),
      (error: unknown) => ({ error }),
    );
  try {
    const started = Date.now();
    // oxlint-disable-next-line no-await-in-loop -- attente active bornée (2 s) du fichier de readiness créé par le processus fils
    while (!(await Bun.file(ready).exists()) && Date.now() - started < 2000) await Bun.sleep(5);
    expect(await Bun.file(ready).exists()).toBe(true);
    abort.abort();
    expect((await completed).error).toMatchObject({ name: "AbortError" });
  } finally {
    abort.abort();
    await completed;
    await rm(dir, { recursive: true, force: true });
  }
});

test("cookie files remain path-only native crawl arguments", () => {
  const args = crawlArgs(["https://example.test/"], {
    cookieFiles: ["/private/cookie file.json", "/private/second.json"],
    render: true,
  });
  const files = args.flatMap((value, index) =>
    value === "--cookie-file" ? [args[index + 1]] : [],
  );
  expect(files).toEqual(["/private/cookie file.json", "/private/second.json"]);
  expect(args).toContain("--render");
});

test("original native response bytes survive invalid UTF-8 and forward identifying UA", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aphrody-web-bytes-"));
  const binary = join(dir, "aphrody-web");
  await writeFile(
    binary,
    `#!/usr/bin/env bun
const args = process.argv.slice(2);
if (args[0] !== "fetch" || !args.includes("--fail-on-http-error") || args[args.indexOf("--dump") + 1] !== "original" || args[args.indexOf("--user-agent") + 1] !== "Fixture/1") process.exit(9);
await Bun.write(Bun.stdout, new Uint8Array([0, 137, 255, 254, 10]));
`,
    { mode: 0o700 },
  );
  try {
    const service = new WebService({ binary });
    expect(
      await service.bytes("https://example.test/image.png", { userAgent: "Fixture/1" }),
    ).toEqual(new Uint8Array([0, 137, 255, 254, 10]));
    await expect(service.bytes("https://example.test/image.png")).rejects.toThrow(/exited with 9/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
