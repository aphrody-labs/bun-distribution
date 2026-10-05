// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";

test("production declarations support strict modern consumers without loading legacy decorator sources", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      "tsc",
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--verbatimModuleSyntax",
      "--module",
      "preserve",
      "--moduleResolution",
      "bundler",
      "--target",
      "ES2022",
      "--lib",
      "ES2022,DOM,DOM.Iterable,ESNext.Disposable",
      "--skipLibCheck",
      "--types",
      "lit",
      "test/consumer-production.check.ts",
    ],
    { cwd: new URL("..", import.meta.url).pathname, stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({
    code,
    diagnostics: stdout.trim().split("\n").filter(Boolean).slice(0, 8),
    stderr: stderr.trim(),
  }).toEqual({ code: 0, diagnostics: [], stderr: "" });
});
