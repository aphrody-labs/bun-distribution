// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO, git, loadForks, main, parseGitmodules, planSparse, planSync, pinnedSha } from "./forks.ts";

const SAMPLE = `
[submodule "forks/a"]
\tpath = forks/a
\turl = git@example:org/a.git
\tupstream = https://example.com/up/a.git
\tupstream-branch = master
\tsparse = symbols/web docs
\tshallow = true
[submodule "forks/b"]
\tpath = forks/b
\turl = git@example:org/b.git
`;

describe("parseGitmodules", () => {
  test("reads git-native and tool keys, in file order", () => {
    const [a, b] = parseGitmodules(SAMPLE);
    expect(a).toEqual({
      name: "forks/a",
      path: "forks/a",
      url: "git@example:org/a.git",
      upstream: "https://example.com/up/a.git",
      upstreamBranch: "master",
      sparse: ["symbols/web", "docs"],
      shallow: true,
    });
    expect(b).toEqual({ name: "forks/b", path: "forks/b", url: "git@example:org/b.git", sparse: [], shallow: false });
  });
  test("rejects a submodule without path or url", () => {
    expect(() => parseGitmodules('[submodule "x"]\n\tpath = x\n')).toThrow(/needs path and url/);
  });
  test("the repository registry lists every submodule once and the forks carry an upstream", () => {
    const forks = loadForks(REPO);
    expect(new Set(forks.map((f) => f.path)).size).toBe(forks.length);
    for (const fork of forks.filter((f) => f.path.startsWith("forks/"))) expect(fork.upstream).toMatch(/^https:\/\/github\.com\//);
    expect(forks.find((f) => f.path === "forks/material-design-icons")?.sparse).toEqual(["symbols/web"]);
    for (const fork of forks) expect(pinnedSha(REPO, fork.path)).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("plans", () => {
  const fork = parseGitmodules(SAMPLE)[0]!;
  test("sync fetches the upstream branch shallowly and fast-forwards, then stages", () => {
    const steps = planSync(fork, { stage: true });
    expect(steps.map((s) => s.argv.join(" "))).toEqual([
      "remote add upstream https://example.com/up/a.git",
      "fetch --depth 1 upstream master",
      "merge --ff-only FETCH_HEAD",
      "add -- forks/a",
    ]);
  });
  test("sync without an upstream throws", () => {
    expect(() => planSync(parseGitmodules(SAMPLE)[1]!, {})).toThrow(/no `upstream`/);
  });
  test("sparse init is shallow and blobless, then sets the cone", () => {
    expect(planSparse(fork, [], false).map((s) => s.argv.join(" "))).toEqual([
      "submodule update --init --depth 1 --filter=blob:none -- forks/a",
      "sparse-checkout set --cone symbols/web docs",
    ]);
    expect(planSparse(fork, ["only"], true).map((s) => s.argv.join(" "))).toEqual(["sparse-checkout set --cone only"]);
  });
});

describe("against real temporary repositories", () => {
  let root = "";
  let upstream = "";
  let fork = "";
  let sup = "";
  const lines: string[] = [];
  const out = (line: string) => void lines.push(line);
  const env = {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "protocol.file.allow",
    GIT_CONFIG_VALUE_0: "always",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };
  const saved: Record<string, string | undefined> = {};

  const commit = (dir: string, file: string, text: string) => {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), text);
    git(dir, "add", "-A");
    expect(git(dir, "commit", "-m", `edit ${file}`).code).toBe(0);
    return git(dir, "rev-parse", "HEAD").out;
  };

  beforeAll(() => {
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    root = mkdtempSync(join(tmpdir(), "forks-test-"));
    upstream = join(root, "upstream");
    fork = join(root, "fork");
    sup = join(root, "super");
    for (const dir of [upstream, sup]) {
      mkdirSync(dir);
      git(dir, "init", "-q", "-b", "main");
    }
    commit(upstream, "symbols/web/a.txt", "one");
    commit(upstream, "other/b.txt", "two");
    expect(git(root, "clone", "-q", upstream, fork).code).toBe(0);
    git(fork, "config", "uploadpack.allowFilter", "true");
    git(fork, "config", "uploadpack.allowAnySHA1InWant", "true");
    commit(sup, "README.md", "super");
    expect(git(sup, "submodule", "add", "-q", fork, "forks/x").code).toBe(0);
    git(sup, "config", "-f", ".gitmodules", "submodule.forks/x.upstream", upstream);
    git(sup, "config", "-f", ".gitmodules", "submodule.forks/x.upstream-branch", "main");
    git(sup, "config", "-f", ".gitmodules", "submodule.forks/x.sparse", "symbols/web");
    git(sup, "add", "-A");
    expect(git(sup, "commit", "-m", "add fork").code).toBe(0);
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test("list and status see the fork as present and pinned", async () => {
    lines.length = 0;
    expect(await main(["status", "x", "--json"], sup, out)).toBe(0);
    const [row] = JSON.parse(lines.join("\n"));
    expect(row).toMatchObject({ name: "forks/x", present: true, moved: false, dirty: 0 });
    expect(row.pinned).toBe(git(upstream, "rev-parse", "HEAD").out);
  });

  test("status --remote compares fork and upstream tips with ls-remote", async () => {
    commit(upstream, "later.txt", "upstream moves");
    lines.length = 0;
    expect(await main(["status", "x", "--remote", "--json"], sup, out)).toBe(0);
    const [row] = JSON.parse(lines.join("\n"));
    expect(row.remote.upstream).toBe(git(upstream, "rev-parse", "HEAD").out);
    expect(row.remote.forkMirrorsUpstream).toBe(false);
    expect(row.remote.pinIsForkTip).toBe(true);
  });

  test("sync is a plan without --apply and leaves the fork alone", async () => {
    const before = git(join(sup, "forks/x"), "rev-parse", "HEAD").out;
    lines.length = 0;
    expect(await main(["sync", "x"], sup, out)).toBe(0);
    expect(lines.join("\n")).toContain("plan");
    expect(git(join(sup, "forks/x"), "rev-parse", "HEAD").out).toBe(before);
  });

  test("sync --apply --stage fast-forwards to upstream and stages the pointer without committing", async () => {
    const tip = git(upstream, "rev-parse", "HEAD").out;
    lines.length = 0;
    expect(await main(["sync", "x", "--apply", "--stage"], sup, out)).toBe(0);
    expect(git(join(sup, "forks/x"), "rev-parse", "HEAD").out).toBe(tip);
    expect(git(sup, "ls-files", "-s", "forks/x").out).toContain(tip);
    expect(pinnedSha(sup, "forks/x")).not.toBe(tip);
  });

  test("pin records a sha for an absent fork through update-index, no clone", async () => {
    git(sup, "commit", "-q", "-m", "bump fork");
    const older = git(upstream, "rev-parse", "HEAD~1").out;
    git(sup, "submodule", "deinit", "-q", "-f", "forks/x");
    expect(existsSync(join(sup, "forks/x/.git"))).toBe(false);
    lines.length = 0;
    expect(await main(["pin", "x", older, "--apply"], sup, out)).toBe(0);
    expect(git(sup, "ls-files", "-s", "forks/x").out).toContain(older);
  });

  test("sparse --apply initialises shallow and checks out only the cone", async () => {
    git(sup, "commit", "-q", "-m", "pin older");
    lines.length = 0;
    expect(await main(["sparse", "x", "--apply"], sup, out)).toBe(0);
    expect(existsSync(join(sup, "forks/x/symbols/web/a.txt"))).toBe(true);
    expect(existsSync(join(sup, "forks/x/other/b.txt"))).toBe(false);
  });

  test("an unknown submodule is an error", async () => {
    await expect(main(["status", "nope"], sup, out)).rejects.toThrow(/unknown submodule/);
  });
});
