import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  releaseShipClaim,
  remoteCommand,
  remotePaths,
  remotePrepareCommand,
  remoteSyncCommand,
  shipClaimPath,
  stopCommand,
  waitCommand,
  writeShipClaim,
} from "../src/aphrody";
import { findCheckout } from "../src/home";

const factory = {
  target: "vps",
  workspaceRoot: "/home/ubuntu/src/aphrody",
  artifactRoot: "/home/ubuntu/build/artifacts",
  lockPath: "/home/ubuntu/build/locks/heavy.lock",
};
const sha = "abcdef012345".padEnd(40, "0");

describe("aphrody bridge", () => {
  it("places the yolo workspace next to the other first-party workspaces", () => {
    const p = remotePaths(factory, "abc123");
    expect(p.workspace).toBe("/home/ubuntu/src/yolo");
    expect(p.artifacts).toBe("/home/ubuntu/build/artifacts/yolo/abc123");
  });

  it("runs the commit's own unit script from the artifacts in a detached tmux session, behind the heavy lock", () => {
    const cmd = remoteCommand(factory, sha);
    const art = `/home/ubuntu/build/artifacts/yolo/${sha}`;
    expect(cmd).toContain(
      `git -C '/home/ubuntu/src/yolo' show '${sha}:scripts/release/ship_unit.sh' > '${art}/ship_unit.sh'`,
    );
    expect(cmd).toContain("tmux new-session -d -s 'yolo-ship-abcdef012345'");
    expect(cmd).toContain(`bash '${art}/ship_unit.sh'`);
    expect(cmd).toContain("'/home/ubuntu/build/locks/heavy.lock'");
  });

  it("leaves a build already running for the commit alone unless forced", () => {
    const cmd = remoteCommand(factory, sha);
    expect(cmd.startsWith("if tmux has-session -t 'yolo-ship-abcdef012345'")).toBe(true);
    expect(cmd).toContain("already running");
    const forced = remoteCommand(factory, sha, true);
    expect(forced).not.toContain("has-session");
    expect(forced.indexOf("tmux kill-session")).toBeLessThan(forced.indexOf("tmux new-session"));
  });

  it("fetches the commit and the tags but never touches the working tree outside the lock", () => {
    const cmd = remoteSyncCommand(factory, sha, "https://github.com/aphrody-labs/yolo.git");
    expect(cmd).toContain("git clone --filter=blob:none --no-checkout");
    expect(cmd).toContain("git fetch --prune --tags --filter=blob:none origin");
    expect(cmd).not.toContain("checkout -f");
    expect(cmd).not.toContain("submodule update");
    expect(cmd).not.toContain("--global");
    expect(cmd).not.toContain("auth setup-git");
  });

  it("prepares a clean pinned workspace under the lock without forcing a checkout or starting engines", () => {
    const cmd = remotePrepareCommand(factory, sha);
    expect(cmd).toContain("flock --close -- '/home/ubuntu/build/locks/heavy.lock'");
    expect(cmd).toContain("checkout --detach");
    expect(cmd).toContain("Factory checkout is dirty; preserved");
    expect(cmd).toContain("unowned files; preserved");
    expect(cmd).not.toContain("checkout -f");
    expect(cmd).not.toContain("systemd-run");
    expect(cmd).not.toContain("tmux new-session");
    expect(() => remotePrepareCommand(factory, "abc123")).toThrow("full Git SHA");
  });

  it.skipIf(process.platform === "win32")(
    "actually selects the requested revision and preserves a dirty factory checkout",
    () => {
      const temporary = mkdtempSync(join(tmpdir(), "yolo-factory-prepare-"));
      const workspace = join(temporary, "workspaces/yolo");
      const localFactory = {
        target: "local",
        workspaceRoot: join(temporary, "workspaces/aphrody"),
        artifactRoot: join(temporary, "artifacts"),
        lockPath: join(temporary, "locks/heavy.lock"),
      };
      const git = (...args: string[]): string => {
        const result = Bun.spawnSync(["git", "-C", workspace, ...args], {
          windowsHide: true,
          stdout: "pipe",
          stderr: "pipe",
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "aphrody-dev",
            GIT_AUTHOR_EMAIL: "contact@aphrody.com",
            GIT_COMMITTER_NAME: "aphrody-dev",
            GIT_COMMITTER_EMAIL: "contact@aphrody.com",
          },
        });
        if (result.exitCode !== 0) throw new Error(result.stderr.toString());
        return result.stdout.toString().trim();
      };
      try {
        mkdirSync(workspace, { recursive: true });
        git("init", "-q");
        writeFileSync(join(workspace, "source.txt"), "first");
        git("add", "source.txt");
        git("commit", "-qm", "first");
        const first = git("rev-parse", "HEAD");
        writeFileSync(join(workspace, "source.txt"), "second");
        git("commit", "-qam", "second");
        const second = git("rev-parse", "HEAD");
        const prepared = Bun.spawnSync(["bash", "-c", remotePrepareCommand(localFactory, first)], {
          windowsHide: true,
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(prepared.exitCode).toBe(0);
        expect(git("rev-parse", "HEAD")).toBe(first);
        expect(readFileSync(join(workspace, "source.txt"), "utf8")).toBe("first");
        writeFileSync(join(workspace, "source.txt"), "concurrent work");
        const rejected = Bun.spawnSync(["bash", "-c", remotePrepareCommand(localFactory, second)], {
          windowsHide: true,
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(rejected.exitCode).toBe(2);
        expect(git("rev-parse", "HEAD")).toBe(first);
        expect(readFileSync(join(workspace, "source.txt"), "utf8")).toBe("concurrent work");
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    },
  );

  it("stops the tmux session and the systemd unit together", () => {
    const cmd = stopCommand(sha);
    expect(cmd).toContain("tmux kill-session -t 'yolo-ship-abcdef012345'");
    expect(cmd).toContain("systemctl stop 'yolo-ship-abcdef012345.service'");
  });

  it("waits for a terminal status and succeeds only on ok", () => {
    const cmd = waitCommand(factory, sha);
    expect(cmd).toContain("until grep -qE '^(ok|failed|stopped)'");
    expect(
      cmd.trimEnd().endsWith(`grep -qx ok '/home/ubuntu/build/artifacts/yolo/${sha}/STATUS'`),
    ).toBe(true);
  });
});

describe(".coord claim for a running build (so another agent can see it before stopping anything)", () => {
  const priorAphrodyRoot = process.env["YOLO_APHRODY_ROOT"];
  let coordRoot: string;
  beforeEach(() => {
    coordRoot = mkdtempSync(join(tmpdir(), "yolo-coord-"));
    process.env["YOLO_APHRODY_ROOT"] = coordRoot;
  });
  afterEach(() => {
    if (priorAphrodyRoot === undefined) delete process.env["YOLO_APHRODY_ROOT"];
    else process.env["YOLO_APHRODY_ROOT"] = priorAphrodyRoot;
    rmSync(coordRoot, { recursive: true, force: true });
  });

  it("writes an active claim naming the lock, the session and the safe way to cancel it", () => {
    writeShipClaim("vps", factory, sha);
    const path = shipClaimPath(sha);
    expect(existsSync(path)).toBe(true);
    const claim = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(claim["owner"]).toBe("yolo-ship");
    expect(claim["state"]).toBe("active");
    expect(claim["paths"]).toContain(factory.lockPath);
    expect(claim["task"]).toContain("yolo ship stop --sha abcdef012345");
  });

  it("updates the same file's state instead of deleting it when the build ends", () => {
    writeShipClaim("vps", factory, sha);
    releaseShipClaim(sha, "complete: ok");
    const claim = JSON.parse(readFileSync(shipClaimPath(sha), "utf8")) as Record<string, unknown>;
    expect(claim["state"]).toBe("complete: ok");
    expect(claim["owner"]).toBe("yolo-ship"); // original fields survive the update
    expect(claim["endedAt"]).toBeDefined();
  });

  it("never throws when .coord cannot be created (coordination is advisory, not required)", () => {
    // a file where a directory needs to go: mkdirSync(..., { recursive: true }) fails with ENOTDIR
    rmSync(coordRoot, { recursive: true, force: true });
    writeFileSync(coordRoot, "not a directory");
    expect(() => writeShipClaim("vps", factory, sha)).not.toThrow();
    expect(() => releaseShipClaim(sha, "complete: ok")).not.toThrow();
  });
});

describe("checkout lookup for the installed executable", () => {
  const root = resolve(import.meta.dir, "../../../docs/aphrody");

  it("finds the checkout from any directory inside it", () => {
    expect(findCheckout(join(root, "crates/infra/aphrody/src"))).toBe(root);
    expect(findCheckout(root)).toBe(root);
  });

  it("returns null outside a checkout", () => {
    const dir = mkdtempSync(join(tmpdir(), "yolo-no-checkout-"));
    try {
      expect(findCheckout(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
