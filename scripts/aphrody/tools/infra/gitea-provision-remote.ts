// SPDX-License-Identifier: Apache-2.0
// Canonical VPS program extracted from Aphrody Infra Gitea provisioning.
/* oxlint-disable no-await-in-loop -- Repository mutation and readback gates must remain sequential. */
interface RemoteRepository {
  name: string;
  mirror: boolean;
  private: boolean;
  upstream?: string;
}
interface RemotePlan {
  owner: string;
  branch: string;
  private: boolean;
  actions: boolean;
  apiUrl: string;
  tokenFile: string;
  tokenVariable: string;
  runnerKey: string;
  accountKey: string;
  repositories: RemoteRepository[];
}
interface ApiKey {
  id: number;
  key: string;
  read_only: boolean;
}
interface ApiRepository {
  owner?: { login: string };
  private: boolean;
  mirror: boolean;
  fork: boolean;
  default_branch: string;
  has_actions: boolean;
}
const encodedPlan = process.env.APHRODY_GITEA_PLAN_B64;
if (!encodedPlan) throw new Error("Gitea public plan missing");
const d = JSON.parse(
  Buffer.from(encodedPlan, "base64").toString(),
) as RemotePlan;
function bad(message: string): never {
  console.error(message);
  process.exit(2);
}
if (
  d.owner !== "aphrody-dev" ||
  d.branch !== "os" ||
  d.private !== true ||
  d.actions !== true ||
  d.apiUrl !== "http://127.0.0.1:29020/api/v1" ||
  d.tokenFile !== "/home/ubuntu/.aphrody/config/gitea.env" ||
  d.tokenVariable !== "GITEA_TOKEN_OWNER" ||
  d.runnerKey !== "/home/ubuntu/.aphrody/secrets/gitea/bun-os-crate-runner" ||
  !Array.isArray(d.repositories) ||
  d.repositories.length !== 1 ||
  d.repositories.some(
    (repo) =>
      repo.mirror !== false ||
      repo.private !== true ||
      !/^(bun-crate-|bun-package-)[a-zA-Z0-9-]+$/.test(repo.name),
  )
)
  bad("Gitea selected private scope invalid");
const tokenFile = Bun.file(d.tokenFile);
const tokenDir = Bun.file("/home/ubuntu/.aphrody/config");
await Bun.$`mkdir -p /home/ubuntu/.aphrody/config && chmod 700 /home/ubuntu/.aphrody/config`;
if (!(await tokenFile.exists())) await Bun.write(d.tokenFile, "");
await Bun.$`chmod 600 /home/ubuntu/.aphrody/config/gitea.env`;
const [fileStat, dirStat] = await Promise.all([
  tokenFile.stat(),
  tokenDir.stat(),
]);
if ((fileStat.mode & 0o777) !== 0o600 || (dirStat.mode & 0o777) !== 0o700)
  bad("Gitea credential store permissions invalid");
const parsed = Object.fromEntries(
  (await tokenFile.text())
    .split(/\r?\n/)
    .filter((x) => x && !x.trimStart().startsWith("#"))
    .map((x): [string, string] | null => {
      const i = x.indexOf("=");
      return i < 0
        ? null
        : [
            x.slice(0, i).trim(),
            x
              .slice(i + 1)
              .trim()
              .replace(/^['"]|['"]$/g, ""),
          ];
    })
    .filter((entry): entry is [string, string] => entry !== null),
);
let token = parsed[d.tokenVariable];
if (!token) {
  const issued = Bun.spawnSync(
    [
      "docker",
      "exec",
      "--user",
      "git",
      "aphrody-gitea",
      "gitea",
      "admin",
      "user",
      "generate-access-token",
      "--username",
      d.owner,
      "--token-name",
      "bun-os-infra",
      "--scopes",
      "write:user,write:repository",
      "--raw",
    ],
    { timeout: 15000 },
  );
  if (issued.exitCode !== 0)
    bad("Gitea token missing and official admin token generation unavailable");
  token = issued.stdout.toString().trim();
  if (!token) bad("Gitea admin returned no token");
  const updated = (await tokenFile.text())
    .split(/\r?\n/)
    .filter((x) => !x.startsWith(d.tokenVariable + "="))
    .concat(d.tokenVariable + "=" + token, "")
    .join("\n");
  const temp = d.tokenFile + ".bun-os.tmp";
  await Bun.write(temp, updated);
  await Bun.$`chmod 600 ${temp} && mv ${temp} ${d.tokenFile}`;
}
const base = d.apiUrl;
async function req(
  method: string,
  path: string,
  payload: unknown = undefined,
  missing = false,
): Promise<[number, any]> {
  const options: RequestInit = {
    method,
    headers: {
      Authorization: "token " + token,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(12000),
  };
  if (payload !== undefined) {
    if (method === "GET" || method === "HEAD")
      bad("Gitea read request body refused");
    options.body = JSON.stringify(payload);
  }
  const response = await fetch(base + path, options);
  if (missing && response.status === 404) return [404, null];
  if (!response.ok) bad("Gitea API request failed: " + response.status);
  return [
    response.status,
    response.status === 204 ? null : await response.json(),
  ];
}
async function ensureAccountKey(key: string) {
  const [, items] = await req("GET", "/user/keys");
  if (items.some((x: ApiKey) => x.key.trim() === key)) return;
  await req("POST", "/user/keys", { title: "aphrody workstation Bun OS", key });
}
async function ensureDeployKey(path: string, key: string) {
  const [, items] = await req("GET", path + "/keys");
  const found = items.find((x: ApiKey) => x.key.trim() === key);
  if (!found) {
    await req("POST", path + "/keys", {
      title: "bun-os VPS runner",
      key,
      read_only: false,
    });
    return;
  }
  if (found.read_only)
    await req("PATCH", path + "/keys/" + found.id, { read_only: false });
}
const identity = await req("GET", "/user");
if (identity[1].login !== d.owner) bad("Gitea token owner mismatch");
function sourceRefs(url: string): { ref: string; sha: string }[] {
  const result = Bun.spawnSync(["git", "ls-remote", "--refs", url], {
    timeout: 12000,
  });
  if (result.exitCode !== 0) bad("Gitea upstream ref query failed");
  return result.stdout
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, ref] = line.trim().split(/\s+/);
      if (!sha || !ref) bad("Invalid upstream public ref metadata");
      return { ref, sha };
    })
    .toSorted((a, b) => a.ref.localeCompare(b.ref));
}
async function syncAndQualifyMirror(
  path: string,
  repo: RemoteRepository,
  privateState: boolean,
) {
  if (repo.upstream !== "https://github.com/aphrody-labs/bun-distribution.git")
    bad("Gitea mirror upstream is outside the approved source");
  const upstream = sourceRefs(repo.upstream!);
  const source = upstream[0];
  if (
    upstream.length !== 1 ||
    !source ||
    source.ref !== "refs/heads/" + d.branch
  )
    bad("Gitea mirror upstream ref set is not the qualified default branch");
  const [status, current] = await req("GET", path, undefined, true);
  if (status === 404) {
    await req("POST", "/repos/migrate", {
      clone_addr: repo.upstream,
      repo_name: repo.name,
      repo_owner: d.owner,
      service: "git",
      mirror: true,
      private: true,
      mirror_interval: "8h",
    });
  } else if (!current.mirror || current.original_url !== repo.upstream)
    bad("Existing Gitea mirror conflicts with upstream");
  const existing = (await req("GET", path))[1];
  if (!existing.private) await req("PATCH", path, { private: true });
  const before = (await req("GET", path))[1];
  if (before.has_actions !== d.actions)
    await req("PATCH", path, { has_actions: d.actions });
  await req("POST", path + "/mirror-sync");
  const branches = await req("GET", path + "/branches?limit=50&page=1");
  const tags = await req("GET", path + "/tags?limit=50&page=1");
  if (
    branches[1].length !== 1 ||
    branches[1][0].name !== d.branch ||
    branches[1][0].commit.id !== source!.sha ||
    tags[1].length !== 0
  )
    bad("Gitea mirror refs diverge; repository remains private");
  const currentUpstream = sourceRefs(repo.upstream!);
  const currentSource = currentUpstream[0];
  if (
    currentUpstream.length !== upstream.length ||
    !currentSource ||
    currentSource!.ref !== source!.ref ||
    currentSource!.sha !== source!.sha
  )
    bad(
      "Gitea upstream moved during synchronization; repository remains private",
    );
  const synced = (await req("GET", path))[1];
  if (
    !synced.mirror ||
    synced.private !== true ||
    synced.original_url !== repo.upstream ||
    synced.default_branch !== d.branch ||
    synced.has_actions !== d.actions
  )
    bad("Gitea private mirror verification failed");
  if (!privateState) await req("PATCH", path, { private: false });
  const published = (await req("GET", path))[1];
  if (
    !published.mirror ||
    published.private !== privateState ||
    published.original_url !== repo.upstream ||
    published.default_branch !== d.branch ||
    published.has_actions !== d.actions
  )
    bad("Gitea mirror visibility postcondition failed");
}
const keyPath = d.runnerKey;
await Bun.$`mkdir -p ${keyPath.slice(0, keyPath.lastIndexOf("/"))} && chmod 700 ${keyPath.slice(0, keyPath.lastIndexOf("/"))}`;
if (!(await Bun.file(keyPath).exists())) {
  const p = Bun.spawnSync(
    [
      "ssh-keygen",
      "-q",
      "-t",
      "ed25519",
      "-N",
      "",
      "-C",
      "bun-os-crate-runner",
      "-f",
      keyPath,
    ],
    { timeout: 15000 },
  );
  if (p.exitCode !== 0) bad("VPS runner key generation failed");
} else if (!(await Bun.file(keyPath + ".pub").exists())) {
  const p = Bun.spawnSync(["ssh-keygen", "-y", "-f", keyPath], {
    timeout: 15000,
  });
  if (p.exitCode !== 0) bad("VPS runner public key repair failed");
  await Bun.write(keyPath + ".pub", p.stdout);
}
await Bun.$`chmod 600 ${keyPath}`;
const [runnerStat, runnerDirStat] = await Promise.all([
  Bun.file(keyPath).stat(),
  Bun.file(keyPath.slice(0, keyPath.lastIndexOf("/"))).stat(),
]);
if (
  (runnerStat.mode & 0o777) !== 0o600 ||
  (runnerDirStat.mode & 0o777) !== 0o700
)
  bad("VPS runner identity permissions invalid");
const runner = (await Bun.file(keyPath + ".pub").text()).trim();
await ensureAccountKey(d.accountKey);
for (const repo of d.repositories) {
  const path: string = "/repos/" + d.owner + "/" + repo.name;
  const targetPrivate = repo.private ?? d.private;
  const [status, current] = await req("GET", path, undefined, true);
  if (
    status !== 404 &&
    (current.mirror || current.fork || current.owner?.login !== d.owner)
  )
    bad(
      "Existing Gitea repository type or owner conflicts with private source ownership",
    );
  if (repo.mirror) {
    await syncAndQualifyMirror(path, repo, targetPrivate);
    continue;
  }
  if (status === 404)
    await req("POST", "/user/repos", {
      name: repo.name,
      private: targetPrivate,
      default_branch: d.branch,
      auto_init: false,
    });
  await req("PATCH", path, {
    private: targetPrivate,
    has_actions: d.actions,
    default_branch: d.branch,
  });
  await ensureDeployKey(path, runner);
  const verified: ApiRepository = (await req("GET", path))[1];
  if (
    verified.owner?.login !== d.owner ||
    verified.private !== targetPrivate ||
    verified.mirror !== false ||
    verified.fork !== false ||
    verified.default_branch !== d.branch ||
    verified.has_actions !== d.actions
  )
    bad("Gitea private repository postconditions failed");
  const keys = (await req("GET", path + "/keys"))[1];
  if (
    !keys.some(
      (key: ApiKey) => key.key.trim() === runner && key.read_only === false,
    )
  )
    bad("Gitea runner write deploy key postcondition failed");
}
const accountKeys = (await req("GET", "/user/keys"))[1];
if (!accountKeys.some((key: ApiKey) => key.key.trim() === d.accountKey))
  bad("Gitea workstation account key postcondition failed");
console.log(
  JSON.stringify({
    owner: d.owner,
    repositories: d.repositories.map((x) => x.name),
    actions: d.actions,
    account_key: "present",
    runner_key: "present",
  }),
);
export const programOwner = "aphrody-infra-gitea";
