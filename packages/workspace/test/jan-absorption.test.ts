// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { declarationCandidates, sourcePath } from "../src/jan-absorption.ts";

test("inventory restricts evidence to selected source and manifest paths", () => {
  expect(sourcePath("crates/ai/config/src/lib.rs", ["crates"])).toBe(true);
  expect(sourcePath("packages/ai/client/package.json", ["packages"])).toBe(
    true,
  );
  for (const path of [
    ".env",
    "datasets/private.jsonl",
    "vendor/engine/src/lib.rs",
    "crates/../secrets/token.py",
    "/secret.py",
    "crates/.git/config",
  ]) {
    expect(sourcePath(path, ["crates", "packages"])).toBe(false);
  }
});

test("declaration evidence retains names and source line without copying bodies", () => {
  expect(
    declarationCandidates("pub async fn run() {}\nstruct State {}", "rust"),
  ).toEqual([
    { kind: "fn", name: "run", line: 1 },
    { kind: "struct", name: "State", line: 2 },
  ]);
  expect(
    declarationCandidates(
      "export const Route = createFileRoute('/');\nexport interface Event {}",
      "tsx",
    ),
  ).toEqual([
    { kind: "const", name: "Route", line: 1 },
    { kind: "interface", name: "Event", line: 2 },
  ]);
  expect(
    declarationCandidates(
      "class Session:\n    async def turn(self): pass",
      "python",
    ),
  ).toEqual([
    { kind: "class", name: "Session", line: 1 },
    { kind: "def", name: "turn", line: 2 },
  ]);
});
