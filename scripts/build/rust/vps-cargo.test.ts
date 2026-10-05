// SPDX-License-Identifier: Apache-2.0
import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expandHome,
  gitDaemonCommand,
  loadConfig,
  remoteCheckoutScript,
  remoteRunScript,
  remoteSeedScript,
  repositoryConfig,
  secretLikePaths,
  shellQuote,
  snapshot,
  tunnelCommand,
} from "./vps-cargo";

const config = await loadConfig();
const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("vps-cargo", () => {
  test("quotes only what needs quoting", () => {
    expect(shellQuote("clippy")).toBe("clippy");
    expect(shellQuote("-D warnings")).toBe("'-D warnings'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  test("expands the home prefix only", () => {
    expect(expandHome("~/.ssh/cm/x", "/home/u")).toBe("/home/u/.ssh/cm/x");
    expect(expandHome("/abs", "/home/u")).toBe("/abs");
  });

  test("tunnel carries the reverse git-daemon forward and reconnects", () => {
    const command = tunnelCommand(config);
    expect(command).toContain("-R 127.0.0.1:19418:127.0.0.1:9418");
    expect(command).toContain("ExitOnForwardFailure=yes");
    expect(command.startsWith("while true; do ssh ")).toBe(true);
    expect(gitDaemonCommand(config)).toContain("--listen=127.0.0.1");
  });

  test("checkout pins the exact snapshot and pulls through the tunnel on demand", () => {
    const push = remoteCheckoutScript(config, SHA, false);
    expect(push).toContain(`git checkout --quiet --detach --force ${SHA}`);
    expect(push).not.toContain("git fetch");
    const pull = remoteCheckoutScript(config, SHA, true);
    expect(pull).toContain("git fetch --quiet git://127.0.0.1:19418/aphrody refs/wsl/snapshot");
  });

  test("run script holds the factory lock and never runs outside the snapshot", () => {
    const script = remoteRunScript(
      config,
      SHA,
      "job-1",
      ["clippy", "-p", "aphrody", "--", "-D", "warnings"],
      4,
    );
    expect(script).toContain("tmux new-window -d -t vps-cargo -n job-1");
    expect(script).toContain("APHRODY_CARGO_JOBS=4");
    expect(script).toContain("APHRODY_BUILD_HOST=vps");
    expect(script).toContain("flock --close /srv/aphrody-build/locks/heavy.lock");
    expect(script).toContain("checkout moved away from");
    expect(script).toContain("umask 022; cd ");
    expect(script).toContain('exit "$(cat /srv/aphrody-build/artifacts/wsl/job-1.exit)"');
  });

  test("an external repository gets its own checkout, ref, target directory and the shared locks", async () => {
    const { config: vu, root } = repositoryConfig(config, "vu");
    expect(root.endsWith("/vu")).toBe(true);
    expect(vu.remoteWorkspace).toBe("/srv/aphrody-build/workspaces/vu-wsl");
    expect(vu.snapshotRef).toBe("refs/vu/snapshot");
    expect(vu.remoteHeavyLock).toBe(config.remoteHeavyLock);
    const script = remoteRunScript(vu, SHA, "job-2", ["build", "--release", "-p", "vu"], 2);
    expect(script).toContain("cd /srv/aphrody-build/workspaces/vu-wsl");
    expect(script).toContain("CARGO_TARGET_DIR=/srv/aphrody-build/cache/cargo/vu-wsl");
    expect(script).toContain("flock --close /srv/aphrody-build/locks/heavy.lock");
    expect(script).toContain(
      "/srv/aphrody-build/workspaces/aphrody-wsl/scripts/build/rust/cargo-serial.sh build --release -p vu",
    );
    // No factory seed: the first push into the new checkout is a full pack.
    expect(remoteSeedScript(vu)).toContain("git init --quiet /srv/aphrody-build/workspaces/vu-wsl");
    // The default repository keeps its relative wrapper.
    expect(remoteRunScript(config, SHA, "job-3", ["check"], 2)).toContain(
      " scripts/build/rust/cargo-serial.sh check",
    );
    expect(() => repositoryConfig(config, "nope")).toThrow("unknown repository");
    const secondary = await loadConfig(undefined, "dbfr");
    expect(() => repositoryConfig(secondary, "vu")).toThrow("primary host only");
  });

  test("secret-like paths are refused", () => {
    const refused = secretLikePaths(
      ["src/lib.rs", ".env", "config/.env.local", "keys/id_ed25519", "a/secrets.json", "x.pem"],
      config.refuseSnapshotPaths,
    );
    expect(refused).toEqual([
      ".env",
      "config/.env.local",
      "keys/id_ed25519",
      "a/secrets.json",
      "x.pem",
    ]);
  });

  test("snapshot captures tracked and untracked changes without touching HEAD or the index", async () => {
    const repo = await mkdtemp(join(tmpdir(), "vps-cargo-"));
    try {
      await $`git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init`.cwd(
        repo,
      );
      await Bun.write(join(repo, ".gitignore"), "ignored.txt\n");
      await Bun.write(join(repo, "new.txt"), "hello\n");
      await Bun.write(join(repo, "ignored.txt"), "nope\n");
      const head = (await $`git rev-parse HEAD`.cwd(repo).text()).trim();
      const sha = await snapshot(config, repo);
      expect(sha).not.toBe(head);
      expect((await $`git rev-parse HEAD`.cwd(repo).text()).trim()).toBe(head);
      expect((await $`git diff --cached --name-only`.cwd(repo).text()).trim()).toBe("");
      const files = (await $`git ls-tree --name-only ${sha}`.cwd(repo).text()).trim().split("\n");
      expect(files.sort()).toEqual([".gitignore", "new.txt"]);
      expect((await $`git rev-parse refs/wsl/snapshot`.cwd(repo).text()).trim()).toBe(sha);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
