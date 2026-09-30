import { resolve } from "node:path";

const TRAILER =
  /^(co-authored-by:.*(?:claude|codex|gemini|copilot|openai|anthropic).*|claude-session:.*|.*generated with \[(?:claude code|codex)\].*)$/im;

export function stripAttributionTrailers(message: string): string {
  return `${message
    .split("\n")
    .filter((line) => !TRAILER.test(line))
    .join("\n")
    .replace(/\n+$/g, "")}\n`;
}

async function git(repo: string, args: string[], input?: string, env?: Record<string, string>) {
  const process = Bun.spawn(["git", "-C", repo, ...args], {
    stdin: input ? new Blob([input]) : undefined,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, ...env },
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(stderr.trim() || `git ${args.join(" ")} failed`);
  return stdout;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

export async function runGitAttribution(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: aphrody-ops git-attribution --repo <path> --branch <branch> [--since <ref>] [--apply]",
    );
    return 0;
  }
  const repoOption = option(args, "--repo");
  const branch = option(args, "--branch");
  const since = option(args, "--since");
  const apply = args.includes("--apply");
  const allowed = new Set(["--repo", "--branch", "--since", "--apply"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument || !allowed.has(argument))
      throw new Error(
        "Usage: aphrody-ops git-attribution --repo <path> --branch <branch> [--since <ref>] [--apply]",
      );
    if (argument !== "--apply") index += 1;
  }
  if (!repoOption || !branch)
    throw new Error(
      "Usage: aphrody-ops git-attribution --repo <path> --branch <branch> [--since <ref>] [--apply]",
    );
  const repo = resolve(repoOption);
  const oldTip = (await git(repo, ["rev-parse", branch])).trim();
  const range = since ? `${since}..${branch}` : branch;
  const commits = (await git(repo, ["rev-list", "--reverse", "--topo-order", range]))
    .trim()
    .split("\n")
    .filter(Boolean);
  const mapping = new Map<string, string>();
  let changed = 0;
  for (const commit of commits) {
    const metadata = (
      await git(repo, [
        "show",
        "-s",
        "--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%T%x00%P",
        commit,
      ])
    )
      .trimEnd()
      .split("\0");
    const message = await git(repo, ["show", "-s", "--format=%B", commit]);
    const clean = stripAttributionTrailers(message);
    if (clean.trimEnd() !== message.trimEnd()) changed += 1;
    const parents = (metadata[7] ?? "")
      .split(" ")
      .filter(Boolean)
      .map((parent) => mapping.get(parent) ?? parent);
    const parentArgs = parents.flatMap((parent) => ["-p", parent]);
    const replacement = (
      await git(repo, ["commit-tree", metadata[6] ?? "", ...parentArgs], clean, {
        GIT_AUTHOR_NAME: metadata[0] ?? "",
        GIT_AUTHOR_EMAIL: metadata[1] ?? "",
        GIT_AUTHOR_DATE: metadata[2] ?? "",
        GIT_COMMITTER_NAME: metadata[3] ?? "",
        GIT_COMMITTER_EMAIL: metadata[4] ?? "",
        GIT_COMMITTER_DATE: metadata[5] ?? "",
      })
    ).trim();
    mapping.set(commit, replacement);
  }
  const newTip = mapping.get(oldTip) ?? oldTip;
  console.log(`${commits.length} commit(s) in ${range}; ${changed} carried attribution trailers`);
  console.log(`${branch}: ${oldTip.slice(0, 10)} -> ${newTip.slice(0, 10)}`);
  if (newTip === oldTip) return 0;
  if (!apply) {
    console.log("dry run: pass --apply to move the branch");
    return 0;
  }
  await git(repo, [
    "update-ref",
    "-m",
    "strip attribution trailers",
    `refs/heads/${branch}`,
    newTip,
    oldTip,
  ]);
  console.log("branch moved");
  return 0;
}
