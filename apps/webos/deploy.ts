// SPDX-License-Identifier: Apache-2.0
// Deploy one pushed WebOS revision, then qualify every public hostname on that Worker.
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const workerRoot = import.meta.dir;

function git(...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root });
  if (result.exitCode !== 0)
    throw new Error(
      `git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr).trim()}`,
    );
  return new TextDecoder().decode(result.stdout).trim();
}

if (process.platform !== "linux")
  throw new Error(
    "Production WebOS builds and deployments run on the Linux VPS factory.",
  );
if (!process.env.CLOUDFLARE_API_TOKEN)
  throw new Error(
    "CLOUDFLARE_API_TOKEN must be supplied by the protected deployment environment.",
  );

if (git("status", "--porcelain", "--untracked-files=no"))
  throw new Error(
    "Refusing production deployment from a checkout with tracked source changes.",
  );
const commit = git("rev-parse", "HEAD");
const isCanonicalWorkflowRun =
  (process.env.GITHUB_EVENT_NAME === "push" ||
    process.env.GITHUB_EVENT_NAME === "schedule" ||
    process.env.GITHUB_EVENT_NAME === "workflow_dispatch") &&
  process.env.GITHUB_REF === "refs/heads/os" &&
  Boolean(process.env.GITHUB_SHA);
if (isCanonicalWorkflowRun) {
  const pushedCommit = process.env.GITHUB_SHA!.toLowerCase();
  const publishedTip = git("rev-parse", "refs/remotes/origin/os");
  if (commit !== pushedCommit || commit !== publishedTip)
    throw new Error(
      `Refusing deployment commit ${commit}; event=${pushedCommit}, origin/os=${publishedTip}.`,
    );
} else {
  const branch = git("branch", "--show-current");
  if (branch !== "os")
    throw new Error(
      `Expected the production source branch os, found ${branch || "detached HEAD"}`,
    );
  const upstream = git("rev-parse", "@{upstream}");
  if (commit !== upstream)
    throw new Error(
      `Refusing unpublished source ${commit}; branch tip is ${upstream}.`,
    );
}

const config = Bun.JSONC.parse(
  await Bun.file(join(workerRoot, "wrangler.jsonc")).text(),
) as {
  name: string;
  services?: { binding: string; service: string }[];
  routes: { pattern: string; custom_domain?: boolean }[];
};
if (
  config.name !== "aphrody-webos" ||
  !config.services?.some(
    ({ binding, service }) => binding === "LEGACY" && service === "aphrody-app",
  )
)
  throw new Error("Expected WebOS to own the public hosts and bind the legacy API Worker.");
const hosts = [
  ...new Set(config.routes.map(({ pattern }) => pattern.replace(/\/\*$/, ""))),
];
if (hosts.length < 30)
  throw new Error(
    `Expected the complete Worker host set; found only ${hosts.length}.`,
  );

const legacyConfigPath = join(
  root,
  "toolchains/bun/packages/web/cloudflare/wrangler.jsonc",
);
const legacyConfig = Bun.JSONC.parse(
  await Bun.file(legacyConfigPath).text(),
) as {
  name: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  routes?: unknown[];
};
if (
  legacyConfig.name !== "aphrody-app" ||
  legacyConfig.workers_dev !== false ||
  legacyConfig.preview_urls !== false ||
  (legacyConfig.routes?.length ?? 0) > 0
)
  throw new Error(
    "The aphrody-app backend must stay private; aphrody-webos is the sole public host owner.",
  );

async function run(command: string[]) {
  const child = Bun.spawn(command, {
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) process.exit(exitCode);
}

await run([process.execPath, join(workerRoot, "build-product.ts")]);
await run([
  join(root, "node_modules/.bin/wrangler"),
  "deploy",
  "--config",
  join(workerRoot, "wrangler.jsonc"),
]);

const checks = await Promise.all(
  hosts.map(async (host) => {
    const response = await fetch(`https://${host}/`, {
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw new Error(`${host} returned HTTP ${response.status}`);
    return { host, status: response.status, finalUrl: response.url };
  }),
);
const receipt = {
  service: "aphrody-webos",
  sourceCommit: commit,
  deployedAt: new Date().toISOString(),
  verifiedHosts: checks,
};
const receiptDir = join(root, "build", "deployments");
await mkdir(receiptDir, { recursive: true });
const receiptPath = join(receiptDir, `webos-${commit}.json`);
await Bun.write(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(
  `WebOS deployment qualified: ${checks.length} hosts; receipt ${receiptPath}`,
);
