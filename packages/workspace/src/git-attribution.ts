import { resolve } from "node:path";

const TRAILER =
  /^(co-authored-by:.*(?:claude|codex|gemini|copilot|openai|anthropic|ai-agent|noreply@anthropic\.com).*|claude-session:.*|.*generated with \[(?:claude code|codex|gemini)\].*)$/im;

export function stripAttributionTrailers(message: string): string {
  return `${message
    .split("\n")
    .filter((line) => !TRAILER.test(line))
    .join("\n")
    .replace(/\n+$/g, "")}\n`;
}

async function git(
  repo: string,
  args: string[],
  input?: string,
  env?: Record<string, string>,
) {
  const process = Bun.spawn(["git", "-C", repo, ...args], {
    windowsHide: true,
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
  if (exitCode !== 0)
    throw new Error(stderr.trim() || `git ${args.join(" ")} failed`);
  return stdout;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

export async function runGitAttribution(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: yolo ops git-attribution --repo <path> --branch <branch> [--since <ref>] [--canonical-author] [--author-name <name>] [--author-email <email>] [--apply]",
    );
    return 0;
  }
  const repoOption = option(args, "--repo");
  const branch = option(args, "--branch");
  const since = option(args, "--since");
  const apply = args.includes("--apply");
  const canonicalAuthor = args.includes("--canonical-author");
  const targetAuthorName = option(args, "--author-name") ?? "aphrody-code";
  const targetAuthorEmail =
    option(args, "--author-email") ?? "contact@aphrody.com";

  const allowed = new Set([
    "--repo",
    "--branch",
    "--since",
    "--apply",
    "--canonical-author",
    "--author-name",
    "--author-email",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument || !allowed.has(argument))
      throw new Error(
        "Usage: yolo ops git-attribution --repo <path> --branch <branch> [--since <ref>] [--canonical-author] [--author-name <name>] [--author-email <email>] [--apply]",
      );
    if (argument !== "--apply" && argument !== "--canonical-author") index += 1;
  }
  if (!repoOption || !branch)
    throw new Error(
      "Usage: yolo ops git-attribution --repo <path> --branch <branch> [--since <ref>] [--canonical-author] [--author-name <name>] [--author-email <email>] [--apply]",
    );
  const repo = resolve(repoOption);
  const oldTip = (await git(repo, ["rev-parse", branch])).trim();
  const range = since ? `${since}..${branch}` : branch;
  const commits = (
    await git(repo, ["rev-list", "--reverse", "--topo-order", range])
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const mapping = new Map<string, string>();
  let changed = 0;
  for (const commit of commits) {
    // oxlint-disable-next-line no-await-in-loop -- commits are rewritten in order: each replacement feeds its descendants' parents
    const metadataOutput = await git(repo, [
      "show",
      "-s",
      "--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%T%x00%P",
      commit,
    ]);
    const metadata = metadataOutput.trimEnd().split("\0");
    // oxlint-disable-next-line no-await-in-loop -- commits are rewritten in order: each replacement feeds its descendants' parents
    const message = await git(repo, ["show", "-s", "--format=%B", commit]);
    const clean = stripAttributionTrailers(message);
    const authorNeedsRewrite =
      canonicalAuthor &&
      (metadata[0] !== targetAuthorName ||
        metadata[1] !== targetAuthorEmail ||
        metadata[3] !== targetAuthorName ||
        metadata[4] !== targetAuthorEmail);

    if (clean.trimEnd() !== message.trimEnd() || authorNeedsRewrite)
      changed += 1;
    const parents = (metadata[7] ?? "")
      .split(" ")
      .filter(Boolean)
      .map((parent) => mapping.get(parent) ?? parent);
    const parentArgs = parents.flatMap((parent) => ["-p", parent]);
    // oxlint-disable-next-line no-await-in-loop -- commits are rewritten in order: each replacement feeds its descendants' parents
    const replacementOutput = await git(
      repo,
      ["commit-tree", metadata[6] ?? "", ...parentArgs],
      clean,
      {
        GIT_AUTHOR_NAME: canonicalAuthor
          ? targetAuthorName
          : (metadata[0] ?? ""),
        GIT_AUTHOR_EMAIL: canonicalAuthor
          ? targetAuthorEmail
          : (metadata[1] ?? ""),
        GIT_AUTHOR_DATE: metadata[2] ?? "",
        GIT_COMMITTER_NAME: canonicalAuthor
          ? targetAuthorName
          : (metadata[3] ?? ""),
        GIT_COMMITTER_EMAIL: canonicalAuthor
          ? targetAuthorEmail
          : (metadata[4] ?? ""),
        GIT_COMMITTER_DATE: metadata[5] ?? "",
      },
    );
    const replacement = replacementOutput.trim();
    mapping.set(commit, replacement);
  }
  const newTip = mapping.get(oldTip) ?? oldTip;
  console.log(
    `${commits.length} commit(s) in ${range}; ${changed} rewritten (attributions / canonical authors)`,
  );
  console.log(`${branch}: ${oldTip.slice(0, 10)} -> ${newTip.slice(0, 10)}`);
  if (newTip === oldTip) return 0;
  if (!apply) {
    console.log("dry run: pass --apply to move the branch");
    return 0;
  }
  await git(repo, [
    "update-ref",
    "-m",
    "strip attribution trailers and normalize author metadata",
    `refs/heads/${branch}`,
    newTip,
    oldTip,
  ]);
  console.log("branch moved");
  return 0;
}
