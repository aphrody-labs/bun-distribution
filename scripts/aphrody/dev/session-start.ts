// SPDX-License-Identifier: Apache-2.0
// SessionStart hook: local Git state and canonical guidance for the current request.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const guidancePath = join(root, "START-HERE.md");
const guidance = existsSync(guidancePath)
  ? readFileSync(guidancePath, "utf8")
  : "Read the selected repository's AGENTS.md, GOAL.md, PLAN.md and MEMORY.md before changes.";

async function git(...args: string[]): Promise<string | null> {
  const proc = Bun.spawn(["git", ...args], {
    windowsHide: true,
    cwd: root,
    stdout: "pipe",
    stderr: "ignore",
    timeout: 5_000,
  });
  const out = await new Response(proc.stdout).text();
  return (await proc.exited) === 0 ? out.trim() : null;
}

const [branch, head, dirty] = await Promise.all([
  git("rev-parse", "--abbrev-ref", "HEAD"),
  git("log", "--oneline", "-5"),
  git("status", "--short"),
]);
const kind =
  process.env.CLAUDE_CODE_REMOTE === "true" ||
  process.env.APHRODY_CLOUD === "1" ||
  process.env.CI === "true" ||
  process.env.GITHUB_ACTIONS === "true"
    ? "cloud"
    : "local";
const context = [
  `[aphrody] ${kind} session: full autonomy, no human in the loop.`,
  "Complete the current authorized request through implementation, gates, commit and push. Backlog entries are context, not new requests. Select hosts and permissions from the current execution context.",
  `Branch ${branch || "unavailable"}. Last commits:\n${head || "unavailable"}`,
  dirty === null
    ? "Git status unavailable; inspect the worktree before changes."
    : dirty
      ? `Dirty tree (other agents may own it, do not touch):\n${dirty.split("\n").slice(0, 12).join("\n")}`
      : "Clean tree.",
  "--- REPOSITORY GUIDANCE ---",
  guidance,
].join("\n");

console.log(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
  }),
);
