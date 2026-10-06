// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { homeRevision, manifestRevision, syncRevision } from "../src/agent-home-revision.ts";

/** Same golden vector as crates/ai/agent-home/src/revision.rs (`golden_vector_is_stable`). */
const GOLDEN = "sha256-v1:306433f35207da84b3a810e6caa22af2ef87a2432e5243f87090b4c926fcede5";

function write(root: string, rel: string, body: string | Uint8Array): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

test("sha256-v1 matches the Rust golden vector and its exclusions", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-home-revision-"));
  try {
    write(root, "AGENTS.md", "rules\n");
    write(root, "USER.md", "---\nname: Sam\n---\n");
    write(root, "memory/2026-10-06.md", "note\n");
    write(root, "skills/été.md", "été\n");
    write(root, ".aphrody/workspace-state.json", "{}");
    write(root, ".git/HEAD", "ref: refs/heads/main\n");
    write(root, "db/aphrody.sqlite", "SQLite format 3");
    write(root, "memory/cache/x.md", "derived");
    write(root, ".USER.md.123.tmp", "partial");
    write(root, "knowledge.db", "bin");
    if (process.platform !== "win32") symlinkSync(join(root, "AGENTS.md"), join(root, "link.md"));
    const rev = homeRevision(root);
    expect(rev.revision).toBe(GOLDEN);
    expect(rev.files.map((f) => f.path)).toEqual([
      "AGENTS.md",
      "USER.md",
      "memory/2026-10-06.md",
      "skills/été.md",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("empty manifest and sync revision follow the documented format", () => {
  expect(manifestRevision([])).toBe(
    "sha256-v1:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  const root = mkdtempSync(join(tmpdir(), "agent-home-sync-rev-"));
  try {
    write(root, "B.md", "b\n");
    write(root, "A.md", "a\n");
    // Contract order, not sorted: swapping the order changes the revision.
    expect(syncRevision(root, ["B.md", "A.md"])).not.toBe(syncRevision(root, ["A.md", "B.md"]));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
