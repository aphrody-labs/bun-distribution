// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REPO,
  git,
  loadForks,
  main,
  parseGitmodules,
  pinnedSha,
  planSparse,
  planSync,
} from "./forks.ts";

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
[submodule "forks/c"]
\tpath = forks/c
\turl = git@example:org/c.git
\tsparse-script = scripts/own-sparse.ts
`;

describe("parseGitmodules", () => {
  test("reads git-native and tool keys, in file order", () => {
    const [a, b, c] = parseGitmodules(SAMPLE);
    expect(a).toEqual({
      name: "forks/a",
      path: "forks/a",
      url: "git@example:org/a.git",
      upstream: "https://example.com/up/a.git",
      upstreamBranch: "master",
      sparse: ["symbols/web", "docs"],
      shallow: true,
    });
    expect(b).toEqual({
      name: "forks/b",
      path: "forks/b",
      url: "git@example:org/b.git",
      sparse: [],
      shallow: false,
    });
    expect(c).toEqual({
      name: "forks/c",
      path: "forks/c",
      url: "git@example:org/c.git",
      sparseScript: "scripts/own-sparse.ts",
      sparse: [],
      shallow: false,
    });
  });
  test("rejects a submodule without path or url", () => {
    expect(() => parseGitmodules('[submodule "x"]\n\tpath = x\n')).toThrow(/needs path and url/);
  });
  test("the repository registry lists every submodule once and the forks carry an upstream", () => {
    const forks = loadForks(REPO);
    expect(new Set(forks.map((f) => f.path)).size).toBe(forks.length);
    for (const fork of forks.filter((f) => f.path.startsWith("forks/")))
      expect(fork.upstream).toMatch(/^https:\/\/github\.com\//);
    for (const fork of forks) expect(pinnedSha(REPO, fork.path)).toMatch(/^[0-9a-f]{40}$/);
  });

  test("the Material Symbols fork is delegated to its catalogue script, never to a cone", () => {
    const icons = loadForks(REPO).find((f) => f.path === "vendor/material-design-icons")!;
    expect(icons.sparseScript).toBe("packages/material-design-icons/scripts/sync-catalogue.ts");
    expect(icons.sparse).toEqual([]);
    expect(existsSync(join(REPO, icons.sparseScript!))).toBe(true);
    // Initialised: exactly the script. Absent: refused, since a submodule checkout of ~2.1M files downloads every blob.
    expect(planSparse(icons, [], true)).toEqual([
      { cwd: ".", bin: "bun", argv: [icons.sparseScript!] },
    ]);
    expect(() => planSparse(icons, [], false)).toThrow(/downloads every blob/);
    expect(() => planSparse(icons, ["symbols/web"], true)).toThrow(/takes no paths/);
    for (const present of [true, false]) {
      let steps: ReturnType<typeof planSparse> = [];
      try {
        steps = planSparse(icons, [], present);
      } catch {
        // refused: nothing to run
      }
      const lines = steps.map((step) => `${step.bin ?? "git"} ${step.argv.join(" ")}`);
      expect(lines.filter((l) => l.includes("sparse-checkout"))).toEqual([]);
      expect(lines.filter((l) => l.includes("--cone") || l.includes("symbols/web"))).toEqual([]);
    }
  });
});

describe("plans", () => {
  const fork = parseGitmodules(SAMPLE)[0]!;
  test("sync fetches the upstream branch shallowly and fast-forwards, then stages", () => {
    const steps = planSync(fork, { stage: true });
    expect(steps.map((s) => s.argv.join(" "))).toEqual([
      "remote add upstream https://example.com/up/a.git",
      "fetch --depth 1 --filter=blob:none upstream master",
      "merge --ff-only FETCH_HEAD",
      "add -- forks/a",
    ]);
  });
  test("a fork that is partial or sparse fetches blobless; a plain one does not", () => {
    const fetchOf = (f: typeof fork, blobless?: boolean) =>
      planSync(f, { hasUpstreamRemote: true, ...(blobless === undefined ? {} : { blobless }) })[0]!
        .argv;
    expect(fetchOf(fork)).toEqual([
      "fetch",
      "--depth",
      "1",
      "--filter=blob:none",
      "upstream",
      "master",
    ]);
    expect(fetchOf({ ...fork, sparse: [] })).toEqual([
      "fetch",
      "--depth",
      "1",
      "upstream",
      "master",
    ]);
    expect(fetchOf({ ...fork, sparse: [] }, true)).toContain("--filter=blob:none");
    expect(fetchOf({ ...fork, sparse: [], sparseScript: "x.ts" })).toContain("--filter=blob:none");
  });
  test("sparse on a plain present fork disables only a checkout that is sparse", () => {
    const plain = { ...fork, sparse: [] };
    expect(planSparse(plain, [], true, false)).toEqual([]);
    expect(planSparse(plain, [], true, true).map((s) => s.argv.join(" "))).toEqual([
      "sparse-checkout disable",
    ]);
  });
  test("sync without an upstream throws", () => {
    expect(() => planSync(parseGitmodules(SAMPLE)[1]!, {})).toThrow(/no `upstream`/);
  });
  test("a delegated fork syncs, then lets its script materialise what the new commit adds", () => {
    const delegated = { ...fork, sparse: [], sparseScript: "scripts/own-sparse.ts" };
    expect(
      planSync(delegated, { stage: true, hasUpstreamRemote: true }).map(
        (s) => `${s.bin ?? "git"} ${s.argv.join(" ")}`,
      ),
    ).toEqual([
      "git fetch --depth 1 --filter=blob:none upstream master",
      "git merge --ff-only FETCH_HEAD",
      "bun scripts/own-sparse.ts",
      "git add -- forks/a",
    ]);
  });
  test("sparse init is shallow and blobless, then sets the cone", () => {
    expect(planSparse(fork, [], false).map((s) => s.argv.join(" "))).toEqual([
      "submodule update --init --depth 1 --filter=blob:none -- forks/a",
      "sparse-checkout set --cone symbols/web docs",
    ]);
    expect(planSparse(fork, ["only"], true).map((s) => s.argv.join(" "))).toEqual([
      "sparse-checkout set --cone only",
    ]);
  });
});

const commitFixture = (dir: string, file: string, text: string) => {
  mkdirSync(join(dir, file, ".."), { recursive: true });
  writeFileSync(join(dir, file), text);
  git(dir, "add", "-A");
  expect(git(dir, "commit", "-m", `edit ${file}`).code).toBe(0);
  return git(dir, "rev-parse", "HEAD").out;
};

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
    commitFixture(upstream, "symbols/web/a.txt", "one");
    commitFixture(upstream, "other/b.txt", "two");
    const cloned = git(root, "clone", "-q", upstream, fork);
    expect(cloned).toMatchObject({ code: 0, err: "" });
    git(fork, "config", "uploadpack.allowFilter", "true");
    git(fork, "config", "uploadpack.allowAnySHA1InWant", "true");
    commitFixture(sup, "README.md", "super");
    expect(git(sup, "submodule", "add", "-q", fork, "forks/x").code).toBe(0);
    git(sup, "config", "-f", ".gitmodules", "submodule.forks/x.upstream", upstream);
    git(sup, "config", "-f", ".gitmodules", "submodule.forks/x.upstream-branch", "main");
    git(sup, "config", "-f", ".gitmodules", "submodule.forks/x.sparse", "symbols/web");
    git(sup, "add", "-A");
    expect(git(sup, "commit", "-m", "add fork").code).toBe(0);
  }, 30_000);

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
    commitFixture(upstream, "later.txt", "upstream moves");
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

describe("a fork whose sparse set is owned by a script", () => {
  let root = "";
  let sup = "";
  let fork = "";
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

  beforeAll(() => {
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    root = mkdtempSync(join(tmpdir(), "forks-script-test-"));
    fork = join(root, "fork");
    sup = join(root, "super");
    for (const dir of [fork, sup]) {
      mkdirSync(dir);
      git(dir, "init", "-q", "-b", "main");
    }
    mkdirSync(join(fork, "symbols/web/home"), { recursive: true });
    writeFileSync(join(fork, "symbols/web/home/home_24px.svg"), "<svg/>");
    git(fork, "add", "-A");
    git(fork, "commit", "-q", "-m", "catalogue");
    // The delegate: records how it was called; `--check` fails while `unhealthy` exists.
    mkdirSync(join(sup, "scripts"));
    writeFileSync(
      join(sup, "scripts/own-sparse.ts"),
      [
        'import { appendFileSync, existsSync } from "node:fs";',
        'import { join } from "node:path";',
        "const root = join(import.meta.dir, '..');",
        'appendFileSync(join(root, "delegate.log"), process.argv.slice(2).join(" ") + "\\n");',
        'if (process.argv.includes("--check") && existsSync(join(root, "unhealthy"))) process.exit(1);',
      ].join("\n"),
    );
    writeFileSync(join(sup, "README.md"), "super");
    git(sup, "add", "-A");
    git(sup, "commit", "-q", "-m", "init");
    const added = git(sup, "submodule", "add", "-q", fork, "forks/icons");
    expect(added).toMatchObject({ code: 0, err: "" });
    git(
      sup,
      "config",
      "-f",
      ".gitmodules",
      "submodule.forks/icons.sparse-script",
      "scripts/own-sparse.ts",
    );
    git(sup, "add", "-A");
    expect(git(sup, "commit", "-q", "-m", "add fork").code).toBe(0);
  }, 30_000);

  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  const log = () =>
    existsSync(join(sup, "delegate.log")) ? readFileSync(join(sup, "delegate.log"), "utf8") : "";

  test("sparse without --apply only prints the delegate", async () => {
    lines.length = 0;
    expect(await main(["sparse", "icons"], sup, out)).toBe(0);
    expect(lines.join("\n")).toContain("bun scripts/own-sparse.ts");
    expect(lines.join("\n")).not.toContain("sparse-checkout");
    expect(log()).toBe("");
  });

  test("sparse --apply runs the script and never configures a sparse set itself", async () => {
    lines.length = 0;
    expect(await main(["sparse", "icons", "--apply"], sup, out)).toBe(0);
    expect(log()).toBe("\n");
    const dir = join(sup, "forks/icons");
    expect(git(dir, "config", "--get", "core.sparseCheckout").out).toBe("");
    expect(git(dir, "sparse-checkout", "list").out).toBe("");
    expect(existsSync(join(dir, "symbols/web/home/home_24px.svg"))).toBe(true);
  });

  test("paths are refused for a delegated fork and nothing runs", async () => {
    lines.length = 0;
    expect(await main(["sparse", "icons", "symbols/web", "--apply"], sup, out)).toBe(1);
    expect(lines.join("\n")).toContain("takes no paths");
    expect(log()).toBe("\n");
  });

  test("sparse --check asks the script with --check, read-only, and reports its verdict", async () => {
    lines.length = 0;
    expect(await main(["sparse", "icons", "--check"], sup, out)).toBe(0);
    expect(lines).toEqual(["forks/icons: ok"]);
    expect(log()).toBe("\n--check\n");
    writeFileSync(join(sup, "unhealthy"), "");
    lines.length = 0;
    expect(await main(["sparse", "icons", "--check"], sup, out)).toBe(1);
    expect(lines.join("\n")).toContain("--check failed");
  });

  test("an absent delegated fork is refused instead of initialised", async () => {
    git(sup, "submodule", "deinit", "-q", "-f", "forks/icons");
    expect(existsSync(join(sup, "forks/icons/.git"))).toBe(false);
    lines.length = 0;
    expect(await main(["sparse", "all", "--apply"], sup, out)).toBe(1);
    expect(lines.join("\n")).toContain("downloads every blob");
    expect(existsSync(join(sup, "forks/icons/.git"))).toBe(false);
  });
});
