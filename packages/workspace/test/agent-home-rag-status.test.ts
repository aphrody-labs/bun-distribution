// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { ragCounters } from "../src/agent-home-rag-status.ts";

const started =
  "MainPID=42\nActiveState=activating\nResult=success\nExecMainStatus=0\nExecMainStartTimestamp=@1000";
test("a running RAG job never inherits completion from an old final report", () => {
  const result = ragCounters(
    started,
    {
      generatedAt: new Date(900_000).toISOString(),
      failed: false,
      sources: [{ indexed: 99, body: "private" }],
    },
    "private source: 10/100 indexed\nTOKEN=private",
  );
  expect(result).toEqual({
    running: 1,
    completed: 0,
    failed: 0,
    source_count: 0,
    indexed: 0,
    progress_current: 10,
    progress_total: 100,
  });
  expect(JSON.stringify(result)).not.toContain("private");
});
test("completion requires a successful terminal unit and a current final report", () => {
  const terminal = started
    .replace("MainPID=42", "MainPID=0")
    .replace("activating", "inactive");
  expect(
    ragCounters(terminal, {
      generatedAt: new Date(1_001_000).toISOString(),
      failed: false,
      sources: [{ indexed: 8 }],
    }),
  ).toMatchObject({ running: 0, completed: 1, indexed: 8, source_count: 1 });
  expect(
    ragCounters(terminal, {
      generatedAt: new Date(900_000).toISOString(),
      failed: false,
    }),
  ).toMatchObject({ completed: 0 });
  expect(ragCounters(terminal.replace("inactive", "failed"), {})).toMatchObject(
    {
      completed: 0,
      failed: 1,
    },
  );
});
