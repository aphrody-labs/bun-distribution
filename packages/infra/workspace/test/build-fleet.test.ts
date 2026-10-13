// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { win32 } from "node:path";
import { tmpdir } from "node:os";
import {
  encodedCommand,
  resolveExternalLocks,
  selectHost,
  validateRequest,
  workerScript,
  type FleetHost,
  type FleetRequest,
} from "../src/build-fleet.ts";

const hosts: FleetHost[] = [
  { id: "local", os: "win32", local: true, reserveGiB: 4, maxJobs: 4, heavy: true },
  { id: "omar", os: "win32", local: false, reserveGiB: 4, maxJobs: 2, heavy: true },
  { id: "vps", os: "linux", local: false, reserveGiB: 4, maxJobs: 6, heavy: true },
  { id: "dbfr", os: "linux", local: false, reserveGiB: 8, maxJobs: 1, heavy: false },
];
const readiness = hosts.map((host) => ({
  host: host.id,
  ready: true,
  os: host.os,
  freeGiB: 16,
  diskGiB: 100,
  load: host.id === "omar" ? 0.1 : 0.5,
}));
const build: FleetRequest = {
  id: "public-build",
  kind: "build",
  os: "win32",
  memoryGiB: 2,
  jobs: 2,
  workspace: "C:/bun",
  revision: "a".repeat(40),
  command: ["bun", "bd", "-j2"],
};

test("automatic placement preserves OS, capacity and one heavy host lease", () => {
  expect(selectHost(hosts, readiness, build).id).toBe("omar");
  expect(selectHost(hosts, readiness, build, new Set(["omar"])).id).toBe("local");
  expect(() => selectHost(hosts, readiness, build, new Set(["omar", "local"]))).toThrow(
    "No qualified host",
  );
  expect(() =>
    selectHost(
      hosts,
      readiness.map((r) => Object.assign({}, r, { freeGiB: 5 })),
      build,
    ),
  ).toThrow("reserved capacity");
  expect(() =>
    selectHost(
      hosts,
      readiness.map((r) => Object.assign({}, r, { freeGiB: 12 })),
      { ...build, memoryGiB: 0.1 },
    ),
  ).toThrow("reserved capacity");
  expect(() =>
    selectHost(
      hosts,
      readiness.map((r) => Object.assign({}, r, { ready: false })),
      build,
    ),
  ).toThrow();
  expect(() =>
    selectHost(hosts, readiness, { ...build, host: "dbfr", os: "linux", jobs: 1 }),
  ).toThrow();
  expect(() =>
    selectHost(
      hosts,
      readiness.map((r) => Object.assign({}, r, { busy: true })),
      build,
    ),
  ).toThrow();
});

test("request validation rejects mutable pins, unsafe identities and invalid OS/jobs", () => {
  for (const revision of ["main", "a".repeat(39), "../main"])
    expect(() => validateRequest({ ...build, revision })).toThrow("revision");
  expect(() => validateRequest({ ...build, id: "../secret" })).toThrow("job id");
  expect(() => validateRequest({ ...build, os: "darwin" as "win32" })).toThrow("OS");
  expect(() => validateRequest({ ...build, jobs: 0 })).toThrow("jobs");
  expect(() => validateRequest({ ...build, command: ["bun", "bad\0arg"] })).toThrow(
    "owner command",
  );
  expect(() =>
    validateRequest({ ...build, command: ["bun", "bd", "test", "fixture", "-j2"] }),
  ).toThrow("precede");
  expect(() => validateRequest({ ...build, command: ["bun", "bd", "-j8"] })).toThrow("bounded");
  expect(() => validateRequest({ ...build, command: ["bun", "run", "unknown", "-j2"] })).toThrow(
    "Unknown owner",
  );
  expect(() =>
    selectHost(
      hosts,
      readiness.map((r) => Object.assign({}, r, { observed: Date.now() - 60001 })),
      build,
    ),
  ).toThrow();
  expect(() =>
    selectHost(
      hosts,
      readiness.map((r) => Object.assign({}, r, { diskGiB: 5 })),
      build,
    ),
  ).toThrow();
  expect(() =>
    selectHost(
      hosts,
      readiness.map((r) => Object.assign({}, r, { load: 1 })),
      build,
    ),
  ).toThrow();
});

test("Windows transport encodes public source without shell interpolation", () => {
  const source = "console.log('apostrophe; $HOME `shell`')";
  const command = encodedCommand(hosts[1]!, source);
  expect(command).toStartWith("powershell.exe -NoProfile -NonInteractive -EncodedCommand ");
  const ps = Buffer.from(command.split(" ").at(-1)!, "base64").toString("utf16le");
  expect(ps).toContain(Buffer.from(source).toString("base64"));
  expect(ps).not.toContain("$HOME");
  expect(encodedCommand(hosts[2]!, source)).toStartWith("bun -e '");
});

test("external locks resolve through each Windows host checkout", () => {
  const locks = ["$APHRODY_BUN_CHECKOUT/build/chromium/setup.lock"];
  expect(resolveExternalLocks(locks, "C:/src/bun", win32)).toEqual([
    "C:\\src\\bun\\build\\chromium\\setup.lock",
  ]);
  expect(() => resolveExternalLocks(locks, undefined, win32)).toThrow(
    "APHRODY_BUN_CHECKOUT is required",
  );
  expect(() => resolveExternalLocks(locks, "relative/bun", win32)).toThrow(
    "APHRODY_BUN_CHECKOUT is required",
  );
});

test("worker preserves stale and foreign leases, requests and dirty source", () => {
  const host = {
    ...hosts[1]!,
    externalLocks: ["$APHRODY_BUN_CHECKOUT/build/chromium/setup.lock"],
  };
  const script = workerScript(host, build, "fingerprint");
  expect(script).toContain("fs.openSync(lease,'wx',384)");
  expect(script).toContain("process.env.APHRODY_BUN_CHECKOUT");
  expect(script).toContain("resolveExternalLocks(host.externalLocks||[]");
  expect(script).toContain("Remote request already exists; reconcile status, never replay");
  expect(script).toContain("Source pin differs");
  expect(script).toContain("Source checkout dirty; preserved");
  expect(script).toContain("JSON.parse(fs.readFileSync(lease,'utf8')).token===token");
  expect(script).not.toContain("git reset");
  expect(script).not.toContain("git clean");
});

test("real isolated worker persists completion, refuses replay and preserves foreign lease", async () => {
  const home = await mkdtemp(join(tmpdir(), "fleet-worker-"));
  const state = join(home, ".aphrody", "build-fleet");
  const host: FleetHost = {
    id: "local",
    os: process.platform as "win32" | "linux",
    local: true,
    reserveGiB: 1,
    maxJobs: 1,
    heavy: true,
  };
  const request: FleetRequest = { id: "fixture-probe", kind: "probe", memoryGiB: 0.1, jobs: 1 };
  const run = async (r: FleetRequest) => {
    const p = Bun.spawn([process.execPath, "-e", workerScript(host, r, "fixture-fingerprint")], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    return {
      stdout: await new Response(p.stdout).text(),
      stderr: await new Response(p.stderr).text(),
      exitCode: await p.exited,
    };
  };
  try {
    const completed = await run(request);
    expect(completed.stdout).toContain('"state":"complete"');
    expect(completed.exitCode).toBe(0);
    const persisted = JSON.parse(await readFile(join(state, request.id + ".json"), "utf8"));
    expect(persisted.fingerprint).toBe("fixture-fingerprint");
    expect(persisted.processIdentity).toBeTruthy();
    const replay = await run(request);
    expect(replay.stderr).toContain("never replay");
    expect(replay.exitCode).toBe(1);
    await mkdir(state, { recursive: true });
    await writeFile(join(state, "probe.lock"), "foreign");
    const occupied = await run({ ...request, id: "other-fixture" });
    expect(occupied.stderr).toContain("occupied");
    expect(occupied.exitCode).toBe(1);
    expect(await readFile(join(state, "probe.lock"), "utf8")).toBe("foreign");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 10000);

test("real refused source pin records terminal failure and releases only owned lease", async () => {
  const home = await mkdtemp(join(tmpdir(), "fleet-pin-"));
  const host: FleetHost = {
    id: "local",
    os: process.platform as "win32" | "linux",
    local: true,
    reserveGiB: 1,
    maxJobs: 1,
    heavy: true,
  };
  try {
    const init = Bun.spawn(["git", "init", home], { stdout: "pipe", stderr: "pipe" });
    await init.exited;
    const commit = Bun.spawn(
      [
        "git",
        "-C",
        home,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--allow-empty",
        "-m",
        "fixture",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    await commit.exited;
    const request: FleetRequest = {
      ...build,
      id: "pin-fixture",
      workspace: home,
      jobs: 1,
      command: ["bun", "bd", "-j1"],
    };
    const p = Bun.spawn([process.execPath, "-e", workerScript(host, request, "pin-fingerprint")], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    const stdout = await new Response(p.stdout).text();
    await new Response(p.stderr).text();
    expect(stdout).toContain('"state":"failed"');
    expect(await p.exited).toBe(1);
    const result = JSON.parse(
      await readFile(join(home, ".aphrody/build-fleet/pin-fixture.json"), "utf8"),
    );
    expect(result.state).toBe("failed");
    expect(result.error).toBe("Source pin differs");
    expect(result.exitCode).toBe(1);
    expect(await Bun.file(join(home, ".aphrody/build-fleet/heavy.lock")).exists()).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 10000);
