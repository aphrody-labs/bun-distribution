// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { type AbsorbConfig, evaluate, importedPackages } from "./bun-absorb.ts";

const config: AbsorbConfig = {
  schemaVersion: 1,
  scan: { include: "**/*.ts", exclude: [] },
  packages: [
    { name: "ws", status: "builtin", bun: "WebSocket" },
    { name: "dotenv", status: "fork", bun: "thirdparty/dotenv" },
    { name: "postgres", status: "native", bun: "Bun.SQL" },
    { name: "lru-cache", status: "gap", bun: "candidate" },
  ],
};

describe("bun-absorb", () => {
  test("extracts bare package names from every import form", () => {
    const source = [
      `import postgres from "postgres";`,
      `import { x } from '@scope/pkg/deep/file';`,
      `const a = require("lru-cache");`,
      `await import("node:fs");`,
      `import "./local";`,
      `export * from "ws";`,
    ].join("\n");
    expect([...importedPackages(source)].toSorted()).toEqual([
      "@scope/pkg",
      "lru-cache",
      "node:fs",
      "postgres",
      "ws",
    ]);
  });

  test("refuses builtin declarations and native regressions, warns on fork declarations", () => {
    const report = evaluate(
      config,
      [
        {
          path: "a/package.json",
          json: {
            dependencies: {
              ws: "^8",
              dotenv: "catalog:",
              postgres: "catalog:",
            },
          },
        },
      ],
      { dotenv: "^18", postgres: "^3" },
      { postgres: 3, "lru-cache": 9 },
      { postgres: 2 },
      false,
    );
    expect(report.ok).toBe(false);
    expect(
      report.findings.map((f) => `${f.level}:${f.kind}:${f.package}`),
    ).toEqual([
      "error:declared-builtin:ws",
      "warn:declared-fork:dotenv",
      "error:native-regression:postgres",
    ]);
  });

  test("fork activation turns fork declarations into errors and dead catalog entries fail", () => {
    const report = evaluate(
      config,
      [
        {
          path: "a/package.json",
          json: { devDependencies: { dotenv: "catalog:" } },
        },
      ],
      { dotenv: "^18", unused: "^1" },
      {},
      {},
      true,
    );
    expect(
      report.findings.map((f) => `${f.level}:${f.kind}:${f.package}`),
    ).toEqual(["error:declared-fork:dotenv", "error:dead-catalog:unused"]);
  });

  test("a shrinking native baseline passes", () => {
    const report = evaluate(
      config,
      [],
      {},
      { postgres: 1 },
      { postgres: 2 },
      false,
    );
    expect(report).toMatchObject({ ok: true, findings: [] });
  });
});
