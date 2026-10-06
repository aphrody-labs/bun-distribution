// SPDX-License-Identifier: Apache-2.0
// Idempotent GitHub automation for the owned (non-fork) repositories of an organization: merged branches are
// deleted, auto-merge and branch updates are enabled, Dependabot alerts and security updates are on.
//   bun scripts/ops/github-automation.ts [--org aphrody-labs] [--dry-run]
const args = process.argv.slice(2);
const org = args.includes("--org") ? args[args.indexOf("--org") + 1] : "aphrody-labs";
const dry = args.includes("--dry-run");

async function gh(...a: string[]): Promise<{ ok: boolean; out: string }> {
  const p = Bun.spawn(["gh", ...a], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { ok: (await p.exited) === 0, out: out || err };
}

const list = await gh("api", `/orgs/${org}/repos?per_page=100&type=all`, "--paginate");
const repos = (JSON.parse(`[${list.out.replace(/\]\s*\[/g, "],[")}]`) as unknown[]).flat() as {
  name: string;
  fork: boolean;
  archived: boolean;
}[];
for (const r of repos.filter((r) => !r.fork && !r.archived)) {
  const slug = `${org}/${r.name}`;
  if (dry) {
    console.log(`would configure ${slug}`);
    continue;
  }
  const steps: [string, { ok: boolean }][] = [
    [
      "settings",
      await gh(
        "api",
        "-X",
        "PATCH",
        `/repos/${slug}`,
        "-F",
        "delete_branch_on_merge=true",
        "-F",
        "allow_auto_merge=true",
        "-F",
        "allow_update_branch=true",
      ),
    ],
    ["alerts", await gh("api", "-X", "PUT", `/repos/${slug}/vulnerability-alerts`)],
    ["security-updates", await gh("api", "-X", "PUT", `/repos/${slug}/automated-security-fixes`)],
  ];
  console.log(`${slug}: ${steps.map(([n, s]) => `${n}=${s.ok ? "ok" : "fail"}`).join(" ")}`);
}
