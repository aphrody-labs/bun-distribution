// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { stripAttributionTrailers } from "../src/git-attribution.ts";

describe("stripAttributionTrailers", () => {
  test("removes AI co-authors and generated-with lines", () => {
    const message = [
      "feat(codex): keep the subject",
      "",
      "Body mentioning codex stays.",
      "",
      "Co-Authored-By: Claude Opus <noreply@anthropic.com>",
      "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
    ].join("\n");
    expect(stripAttributionTrailers(message)).toBe(
      "feat(codex): keep the subject\n\nBody mentioning codex stays.\n",
    );
  });

  test("keeps human co-authors", () => {
    const message = "fix: x\n\nCo-Authored-By: Jane Doe <jane@example.com>\n";
    expect(stripAttributionTrailers(message)).toBe(message);
  });
});
