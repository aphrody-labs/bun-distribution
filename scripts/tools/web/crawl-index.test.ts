// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { $ } from "bun";
import { remoteScript, validateJob, type CrawlJob } from "./crawl-index.ts";

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
// $.escape replaced the POSIX '…'\''…' quoter: every value must reach sh as one literal word.
test.skipIf(!Bun.which("sh"))("$.escape quotes one literal sh word", () => {
  const values = [
    "a'$(echo leaked)`echo leaked`",
    "a b",
    "it's",
    'say "hi"',
    "$HOME",
    "${x:-y}",
    "a\\b",
    "a\\",
    "a\\\nb",
    "\\`",
    "x\ny",
    "",
    "été 悟空 🐉",
    "!x",
    "*?[a]",
    "~",
    "#x",
    "a;b|c&d",
    "{a,b}",
    "-n",
  ];
  const script = values.map((value) => `printf '%s\\0' ${$.escape(value)}`).join("\n") + "\n";
  const result = Bun.spawnSync(["sh", "-s"], { windowsHide: true, stdin: Buffer.from(script) });
  expect(result.stderr.toString()).toBe("");
  expect(result.stdout.toString().split("\0").slice(0, -1)).toEqual(values);
  expect(result.exitCode).toBe(0);
});
test("remote program parses before use and preserves embedded seed characters", () => {
  const source = remoteScript({ ...job, seeds: ["https://example.com/?q='$(echo%20leaked)"] });
  const transpiler = new Bun.Transpiler({ loader: "js" });
  expect(() => transpiler.scan(source)).not.toThrow();
  expect(source).toContain('"--obey-robots"');
});
