#!/usr/bin/env bun
// Strip AI-agent attribution (Co-authored-by trailers, Claude-Session lines,
// "Generated with Claude Code" footers) from the full history of every
// workspace repository, and fold every human or agent author/committer
// identity into the single project identity (Aphrody <contact@aphrody.com>).
// Plan by default; `--apply` rewrites and force-pushes.
//
// Safety: works on a fresh `--mirror` clone, writes a bundle of the untouched
// mirror before rewriting, and pushes with `--force-with-lease` against the
// SHAs it cloned, so a concurrent push aborts instead of being overwritten.
//
// Usage: bun scripts/ops/purge-attribution.ts [--apply] [--only repo,repo]
//        [--backup-dir DIR] [--work-dir DIR]
import { $ } from "bun";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = Bun.argv.slice(2);
const apply = args.includes("--apply");
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = opt("--only")?.split(",");
const stamp = new Date().toISOString().slice(0, 10);
const backupDir = resolve(opt("--backup-dir") ?? join(homedir(), ".aphrody", "archive", `git-purge-${stamp}`));
const workDir = resolve(opt("--work-dir") ?? join(tmpdir(), `git-purge-${stamp}`));
const workspace = resolve(import.meta.dir, "..", "..", "..");

const AGENT = "claude|codex|gemini|\\bagy\\b|anthropic|openai|copilot|cursor";
const LINE = new RegExp(
  `^\\s*((co-authored-by|signed-off-by|reviewed-by|helped-by):.*(${AGENT})|claude-session:|.*generated with \\[?claude).*$`,
  "i",
);
const OPERATOR = { name: "Aphrody", email: "contact@aphrody.com" };
// Every non-bot identity that ever authored or committed is folded into OPERATOR.
const FOLDED = [
  "noreply@anthropic.com",
  "yohanpierre15@gmail.com",
  "37252373+aphrody-code@users.noreply.github.com",
  "noreply@aphrody-code.dev",
  "yolo@aphrody.ai",
];
const AGENT_EMAIL = /noreply@anthropic\.com|@openai\.com|codex|claude|gemini/i;

function cleanMessage(msg: string): string {
  const kept = msg.split("\n").filter((l) => !LINE.test(l));
  return `${kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

// filter-repo callbacks are Python; keep them tiny and data-driven.
const callbacks = `
import re
LINE = re.compile(rb"""${LINE.source}""", re.I)
AGENT_EMAIL = re.compile(rb"""${AGENT_EMAIL.source}""", re.I)
def msg_cb(message):
    kept = [l for l in message.split(b"\\n") if not LINE.match(l)]
    out = re.sub(rb"\\n{3,}", b"\\n\\n", b"\\n".join(kept)).rstrip()
    return out + b"\\n"
`;

async function submodules(): Promise<string[]> {
  const out = await $`git -C ${workspace} submodule status`.text();
  return out
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[1])
    .filter(Boolean)
    .filter((r) => !only || only.includes(r));
}

async function countDirty(dir: string): Promise<number> {
  const log = await $`git -C ${dir} log --all --format=%B%x00%an%x00%ae%x00%cn%x00%ce%x1e`.text();
  let n = 0;
  for (const rec of log.split("\x1e")) {
    const [body = "", , ae = "", , ce = ""] = rec.split("\x00");
    if (cleanMessage(body) !== `${body.trimEnd()}\n` || AGENT_EMAIL.test(ae) || AGENT_EMAIL.test(ce) || FOLDED.includes(ae) || FOLDED.includes(ce)) n++;
  }
  return n;
}

mkdirSync(backupDir, { recursive: true });
mkdirSync(workDir, { recursive: true });
const report: Record<string, unknown>[] = [];

for (const repo of await submodules()) {
  const local = join(workspace, repo);
  const url = (await $`git -C ${local} remote get-url origin`.text()).trim();
  const mirror = join(workDir, `${repo}.git`);
  if (existsSync(mirror)) rmSync(mirror, { recursive: true, force: true });
  await $`git clone --quiet --mirror ${url} ${mirror}`;
  const dirty = await countDirty(mirror);
  const entry: Record<string, unknown> = { repo, url, commitsToRewrite: dirty };
  report.push(entry);
  console.log(`${repo.padEnd(18)} commits to rewrite: ${dirty}`);
  if (!apply || dirty === 0) continue;

  const heads = (await $`git -C ${mirror} for-each-ref ${"--format=%(refname)%00%(objectname)"} refs/heads refs/tags`.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\x00") as [string, string]);
  const bundle = join(backupDir, `${repo}.bundle`);
  await $`git -C ${mirror} bundle create ${bundle} --all`.quiet();
  entry.bundle = bundle;

  const cbFile = join(workDir, `${repo}.py`);
  writeFileSync(cbFile, callbacks);
  const mailmap = join(workDir, "agents.mailmap");
  writeFileSync(
    mailmap,
    FOLDED.map((e) => `${OPERATOR.name} <${OPERATOR.email}> <${e}>`).join("\n") + "\n",
  );
  await $`uvx --from git-filter-repo git-filter-repo --force --quiet --mailmap ${mailmap} --message-callback ${`exec(open(${JSON.stringify(cbFile.replaceAll("\\", "/"))}).read(), globals()); return msg_cb(message)`}`.cwd(
    mirror,
  );
  await $`git -C ${mirror} remote add origin ${url}`.nothrow().quiet();

  const leases = heads.map(([ref, sha]) => `--force-with-lease=${ref}:${sha}`);
  const refspecs = heads.map(([ref]) => `+${ref}:${ref}`);
  const push = await $`git -C ${mirror} push --porcelain ${leases} origin ${refspecs}`.nothrow();
  entry.pushed = push.exitCode === 0;
  entry.pushOutput = push.stderr.toString().trim().split("\n").slice(-3).join(" | ");
  entry.remaining = await countDirty(mirror);
  console.log(`${repo.padEnd(18)} pushed=${entry.pushed} remaining=${entry.remaining}`);
}

writeFileSync(join(backupDir, "report.json"), JSON.stringify(report, null, 2));
console.log(`${apply ? "applied" : "plan only (pass --apply)"}; report: ${join(backupDir, "report.json")}`);
