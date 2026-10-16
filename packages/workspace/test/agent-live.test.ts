// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  actionMetadata,
  liveOwners,
  ownerOf,
  observedRunProcess,
  sessionCandidates,
  tailRecords,
} from "../src/agent-live.ts";

test("run joins support Node wrappers and reject reused PIDs or a different parent", () => {
  const run = {
    pid: 42,
    launcher_pid: 10,
    started_at: "2026-10-01T02:00:00.400Z",
  };
  const process = {
    pid: 42,
    ppid: 10,
    name: "MainThread",
    start_time: "2026-10-01T02:00:00Z",
  };
  expect(observedRunProcess(run, [process])).toBe(true);
  expect(
    observedRunProcess(run, [
      { ...process, start_time: "2026-10-01T02:01:00Z" },
    ]),
  ).toBe(false);
  expect(observedRunProcess(run, [{ ...process, ppid: 99 }])).toBe(false);
});

test("concurrent agents retain all candidate sessions without exact attribution", () => {
  const sources = [
    { agent: "codex", session_id: "one", workspace: "/repo" },
    { agent: "codex", session_id: "two", workspace: "/repo" },
    { agent: "claude", session_id: "three", workspace: "/repo" },
    { agent: "codex", session_id: "four", workspace: "/other" },
  ];
  expect(
    sessionCandidates({ agent: "codex", cwd: "/repo" }, sources, "/repo").map(
      (s) => s.session_id,
    ),
  ).toEqual(["one", "two"]);
  expect(sessionCandidates({ agent: "codex" }, sources, "/repo")).toEqual([]);
});

test("tool metadata links explicit files to the deepest owner and excludes external paths", () => {
  const owners = [
    { name: "parent", path: "packages/ai", kind: "bun" as const },
    { name: "child", path: "packages/ai/tools", kind: "bun" as const },
  ];
  expect(ownerOf("packages/aix/file", owners)).toBeUndefined();
  const action = actionMetadata(
    {
      agent: "claude",
      session_id: "s",
      offset: 42,
      role: "tool_call",
      text: 'Edit {"file_path":"packages/ai/tools/src/file.ts","secret":"never publish"}',
    },
    "/repo",
    owners,
  );
  expect(action.files[0].owner.name).toBe("child");
  expect(JSON.stringify(action)).not.toContain("never publish");
  expect(action.id).toBe("external:claude:s:42:0");
  expect(
    actionMetadata(
      { role: "tool_call", text: 'Edit {"path":"../private"}' },
      "/repo",
      owners,
    ).files,
  ).toEqual([]);
  expect(
    actionMetadata(
      { role: "tool_call", text: "shell git commit -am secret" },
      "/repo",
      owners,
    ).files,
  ).toBeUndefined();
});

test("bounded JSONL tail ignores partial first and last records", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-tail-"));
  try {
    const file = join(root, "events.jsonl");
    await writeFile(
      file,
      '{"id":"long","text":"' +
        "a".repeat(500) +
        '"}\n{"id":"complete"}\n{"id":"partial',
    );
    expect(await tailRecords(file, 70)).toEqual([{ id: "complete" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("owners come from current declarations and honor Cargo exclusions", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-owners-"));
  try {
    await Promise.all([
      mkdir(join(root, "crates/one"), { recursive: true }),
      mkdir(join(root, "crates/two"), { recursive: true }),
      mkdir(join(root, "packages/one"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(root, "Cargo.toml"),
        '[workspace]\nmembers=["crates/*"]\nexclude=["crates/two"]\n',
      ),
      writeFile(join(root, "package.json"), '{"workspaces":["packages/*"]}'),
      writeFile(
        join(root, "crates/one/Cargo.toml"),
        '[package]\nname="rust-one"\n',
      ),
      writeFile(
        join(root, "crates/two/Cargo.toml"),
        '[package]\nname="excluded"\n',
      ),
      writeFile(
        join(root, "packages/one/package.json"),
        '{"name":"@fixture/one"}',
      ),
    ]);
    expect(
      (await liveOwners(root)).map((owner) => owner.name).toSorted(),
    ).toEqual(["@fixture/one", "rust-one"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
