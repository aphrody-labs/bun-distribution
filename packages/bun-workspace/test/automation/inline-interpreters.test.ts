// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectInlineInterpreters,
  nextInlineBaseline,
  renderInlineMarkdown,
  scanInlineInvocations,
} from "../../src/automation/inline-interpreters.ts";

// Interpreter names are composed so this file does not report itself.
const PY = "python3";
const BUN = "bun";
const NODE = "node";

test("scanner reports eval, heredoc and spawn forms with their body size", () => {
  const shell = [
    `value="$(${PY} -I -c 'import json,sys`,
    `print(json.load(sys.stdin)["a"])')"`,
    `out="$(${PY} - "$file" \\`,
    `  "$other" <<'PY'`,
    "import sys",
    "print(sys.argv[1])",
    "PY",
    `)"`,
    `${BUN} -e 'console.log(1)'`,
    `${NODE} --no-warnings --eval "process.exit(0)"`,
    `# ${PY} -c 'commented out'`,
    `${PY} --version`,
  ].join("\n");
  expect(scanInlineInvocations(shell)).toEqual([
    expect.objectContaining({
      line: 1,
      interpreter: "python",
      form: "eval",
      bodyLines: 2,
    }),
    expect.objectContaining({
      line: 3,
      interpreter: "python",
      form: "stdin",
      bodyLines: 2,
    }),
    expect.objectContaining({
      line: 9,
      interpreter: "bun",
      form: "eval",
      bodyLines: 1,
    }),
    expect.objectContaining({
      line: 10,
      interpreter: "node",
      form: "eval",
      bodyLines: 1,
    }),
  ]);
  const typescript = [
    "Bun.spawn([",
    `  "${PY}",`,
    `  "-I",`,
    `  "-c",`,
    "  `import sys",
    "print(1)`,",
    "]);",
    `Bun.spawn([process.execPath, "--${"eval"}", script]);`,
    `Bun.spawn([process.execPath, "script.ts"]);`,
  ].join("\n");
  expect(scanInlineInvocations(typescript)).toEqual([
    expect.objectContaining({
      line: 2,
      interpreter: "python",
      form: "spawn",
      bodyLines: 2,
    }),
    expect.objectContaining({
      line: 8,
      interpreter: "bun",
      form: "spawn",
      bodyLines: 1,
    }),
  ]);
});

test("inventory ratchets tracked automation against owner annotations", async () => {
  const root = await mkdtemp(join(tmpdir(), "inline-interpreters-"));
  const git = (...args: string[]) =>
    expect(Bun.spawnSync(["git", "-C", root, ...args], { windowsHide: true }).exitCode).toBe(0);
  try {
    await mkdir(join(root, "scripts"), { recursive: true });
    await mkdir(join(root, "docs"), { recursive: true });
    await mkdir(join(root, "tools", "config"), { recursive: true });
    await writeFile(join(root, "scripts/host.sh"), `${PY} -c 'print(1)'\n${PY} -c 'print(2)'\n`);
    await writeFile(join(root, "scripts/local.sh"), `${BUN} -e 'console.log(1)'\n`);
    await writeFile(join(root, "docs/guide.sh"), `${PY} -c 'documentation is out of scope'\n`);
    await writeFile(join(root, "README.md"), `${PY} -c 'prose is out of scope'\n`);
    const baseline = {
      schemaVersion: 1 as const,
      files: {
        "scripts/host.sh": {
          count: 1,
          scope: "host" as const,
          reason: "runtime-only host",
        },
        "scripts/gone.sh": {
          count: 3,
          scope: "local" as const,
          reason: "factored",
        },
      },
    };
    await writeFile(join(root, "tools/config/inline-interpreters.baseline.json"), JSON.stringify(baseline));
    git("init", "-q");
    git("add", ".");
    const identity = ["-c", "user.name=t", "-c", "user.email=t@example.invalid"];
    git(...identity, "-c", "commit.gpgsign=false", "commit", "--no-verify", "-qm", "fixture");

    const report = await collectInlineInterpreters(root);
    expect(report.files.map(file => file.path)).toEqual(["scripts/host.sh", "scripts/local.sh"]);
    expect(report.totals).toMatchObject({ invocations: 3, files: 2 });
    expect(report.totals.byScope).toMatchObject({ host: 2, unclassified: 1 });
    expect(report.ratchet).toMatchObject({
      status: "fail",
      new: ["scripts/local.sh"],
      increased: [{ path: "scripts/host.sh", baseline: 1, current: 2 }],
      reduced: [{ path: "scripts/gone.sh", baseline: 3, current: 0 }],
    });
    expect(renderInlineMarkdown(report)).toContain(
      "| host | `scripts/host.sh` | 2 | 2 | python/eval | runtime-only host |",
    );

    const next = nextInlineBaseline(report, baseline);
    expect(next.files).toEqual({
      "scripts/host.sh": {
        count: 2,
        scope: "host",
        reason: "runtime-only host",
      },
      "scripts/local.sh": { count: 1, scope: "unclassified", reason: "" },
    });
    await writeFile(join(root, "tools/config/inline-interpreters.baseline.json"), JSON.stringify(next));
    expect((await collectInlineInterpreters(root)).ratchet.status).toBe("pass");
    expect((await collectInlineInterpreters(root, null)).ratchet.baseline).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
