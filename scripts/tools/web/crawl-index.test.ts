// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { remoteScript, shellQuote, validateJob, type CrawlJob } from "./crawl-index.ts";

const job: CrawlJob = {
  host: "vps",
  label: "native-smoke",
  seeds: ["https://aphrody.com"],
  maxRequests: 1,
  maxDepth: 0,
};

test("rejects traversal labels and unsupported hosts", () => {
  expect(() => validateJob({ ...job, label: "../../private" })).toThrow();
  expect(() => validateJob({ ...job, host: "local" as CrawlJob["host"] })).toThrow();
});
test("bounds requests and depth", () => {
  expect(() => validateJob({ ...job, maxRequests: 0 })).toThrow();
  expect(() => validateJob({ ...job, maxRequests: 5001 })).toThrow();
  expect(() => validateJob({ ...job, maxDepth: 11 })).toThrow();
});
test("rejects file navigation and credential URLs", () => {
  expect(() => validateJob({ ...job, seeds: ["file:///etc/passwd"] })).toThrow();
  expect(() => validateJob({ ...job, seeds: ["https://user:secret@example.com"] })).toThrow();
});
test("shell quoting leaves substitutions and apostrophes literal", () => {
  const value = "a'$(echo leaked)`echo leaked`";
  const result = Bun.spawnSync(["sh", "-c", "printf %s " + shellQuote(value)]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toBe(value);
});
test("remote program parses before use and preserves embedded seed characters", () => {
  const source = remoteScript({ ...job, seeds: ["https://example.com/?q='$(echo%20leaked)"] });
  const transpiler = new Bun.Transpiler({ loader: "js" });
  expect(() => transpiler.scan(source)).not.toThrow();
  expect(source).toContain('"--obey-robots"');
});
