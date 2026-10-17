// SPDX-License-Identifier: Apache-2.0
// Stage main in an isolated worktree; never pull/reset the developer's working tree.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export type UpdateConfig = {
  repository: string;
  bundle: string;
  intervalSeconds: number;
};
const sources = [
  "scripts/install/container-service.ts",
  "scripts/install/mesh-supervisor.ts",
  "scripts/install/mesh-update.ts",
];
const tests = [
  "scripts/install/container-service.test.ts",
  "scripts/install/mesh-supervisor.test.ts",
  "scripts/install/mesh-update.test.ts",
];

async function invoke(args: string[], cwd: string, timeout = 120_000): Promise<string> {
  const child = Bun.spawn(args, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    windowsHide: true,
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
  try {
    const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    if (code !== 0) throw new Error(`update gate failed: ${args[0]} ${args[1]}`);
    return stdout.trim();
  } finally {
    clearTimeout(timer);
  }
}

export function validateUpdate(config: UpdateConfig): void {
  if (
    !config ||
    !isAbsolute(config.repository) ||
    !isAbsolute(config.bundle) ||
    !Number.isInteger(config.intervalSeconds) ||
    config.intervalSeconds < 60
  )
    throw new Error("invalid main update configuration");
}

export async function updateMain(config: UpdateConfig, home: string): Promise<boolean> {
  validateUpdate(config);
  const receipt = join(home, "run", "mesh-release.json");
  const root = config.repository;
  const remote = await invoke(["git", "remote", "get-url", "origin"], root);
  if (
    !/^(?:https:\/\/github\.com\/aphrody-labs\/aphrody(?:\.git)?|git@[^:]+:aphrody-labs\/aphrody(?:\.git)?)$/.test(
      remote,
    )
  )
    throw new Error("main updater requires the existing authorized Aphrody remote");
  await invoke(["git", "fetch", "--no-tags", "origin", "main"], root);
  const commit = await invoke(["git", "rev-parse", "origin/main"], root);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("invalid main commit");
  const previous = existsSync(receipt) ? (JSON.parse(readFileSync(receipt, "utf8")) as { commit: string }) : null;
  if (previous?.commit === commit) return false;
  if (previous?.commit) await invoke(["git", "merge-base", "--is-ancestor", previous.commit, commit], root);
  const updates = join(home, "updates");
  mkdirSync(updates, { recursive: true });
  const staging = join(updates, `mesh-${commit.slice(0, 12)}-${process.pid}`);
  await invoke(["git", "worktree", "add", "--detach", staging, commit], root);
  try {
    for (const path of [...sources, ...tests])
      if (!existsSync(join(staging, path))) throw new Error("main lacks the complete mesh release");
    await invoke([process.execPath, "test", ...tests], staging);
    await invoke(
      [
        process.execPath,
        "check",
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--target",
        "esnext",
        "--module",
        "preserve",
        "--moduleResolution",
        "bundler",
        "--allowImportingTsExtensions",
        "--typeRoots",
        join(root, "node_modules", "@types"),
        "--types",
        "bun,node",
        ...sources,
        ...tests,
      ],
      staging,
    );
    await invoke([process.execPath, "lint", "--deny-warnings", ...sources, ...tests], staging);
    await invoke([process.execPath, "fmt", "--check", ...sources, ...tests], staging);
    const output = `${config.bundle}.next`;
    await invoke([process.execPath, "build", sources[0]!, "--target", "bun", "--outfile", output], staging);
    // Validate the staged artifact against this host's actual configuration before activation.
    await invoke(
      [process.execPath, "--no-env-file", output, "--mesh", "plan", "--config", join(home, "host", "mesh.json")],
      staging,
    );
    const checksum = new Bun.CryptoHasher("sha256").update(await Bun.file(output).arrayBuffer()).digest("hex");
    if (existsSync(config.bundle)) {
      const old = await Bun.file(config.bundle).arrayBuffer();
      writeFileSync(`${config.bundle}.previous`, new Uint8Array(old), {
        mode: 0o600,
      });
      const backupHash = new Bun.CryptoHasher("sha256")
        .update(await Bun.file(`${config.bundle}.previous`).arrayBuffer())
        .digest("hex");
      if (backupHash !== new Bun.CryptoHasher("sha256").update(old).digest("hex"))
        throw new Error("bundle backup checksum mismatch");
    }
    renameSync(output, config.bundle);
    mkdirSync(join(home, "run"), { recursive: true });
    writeFileSync(
      `${receipt}.new`,
      JSON.stringify({
        commit,
        checksum,
        activatedAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    renameSync(`${receipt}.new`, receipt);
    return true;
  } finally {
    // Worktree removal is a Git operation on this updater's own staging tree only; never force.
    await invoke(["git", "worktree", "remove", staging], root).catch(() => {});
  }
}
