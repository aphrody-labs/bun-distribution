// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyPlan,
  hostPlan,
  pinnedSocketCheck,
  pinnedBinaryInstall,
  type UnitFacts,
  type Runner,
} from "../src/host/plan.ts";

const facts: UnitFacts = {
  unit: "aphrody-mcp-http.service",
  service: "aphrody-mcp-http",
  targetHost: "vps",
  user: "ubuntu",
  execStart: "/home/ubuntu/.local/bin/aphrody-mcp http --bind 127.0.0.1:8793",
  binary: "/home/ubuntu/.local/bin/aphrody-mcp",
  bind: { host: "127.0.0.1", port: 8793 },
  envFiles: [],
  writePaths: [],
};
const quoted = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
async function guard(rows: string[], pid: number, active = true, required = false) {
  const command = pinnedSocketCheck(facts, ["10.200.77.1:8793"], required)
    .replace(
      'timeout 5 sudo -n ss -H -ltnp "sport = :8793"',
      `printf '%s\\n' ${quoted(rows.join("\n"))}`,
    )
    .replace("systemctl is-active --quiet 'aphrody-mcp-http.service'", active ? "true" : "false")
    .replace("systemctl show 'aphrody-mcp-http.service' -p MainPID --value", `printf %s ${pid}`);
  return Bun.spawn(["sh", "-c", command], { windowsHide: true, stdout: "ignore", stderr: "ignore" })
    .exited;
}
const listener = (address: string, pid?: number) =>
  `LISTEN 0 128 ${address}:8793 *:*${pid === undefined ? "" : ` users:(("native",pid=${pid},fd=9))`}`;

test("A pinned refresh accepts only its active MainPID on the exact native socket", async () => {
  expect(await guard([listener("127.0.0.1", 700), listener("10.200.77.1", 800)], 700)).toBe(0);
  expect(await guard([listener("127.0.0.1", 701)], 700)).toBe(1);
  expect(await guard([listener("127.0.0.1", 7000)], 700)).toBe(1);
  expect(await guard([listener("127.0.0.1", 700)], 700, false)).toBe(1);
  expect(await guard([listener("127.0.0.1")], 700)).toBe(1);
  expect(await guard([listener("0.0.0.0", 700)], 700)).toBe(1);
  expect(await guard([listener("127.0.0.1", 700), listener("10.200.77.4", 800)], 700)).toBe(1);
});

test("An unbound fresh pinned install is allowed; readiness requires the native listener", async () => {
  expect(await guard([listener("10.200.77.1", 800)], 0, false)).toBe(0);
  expect(await guard([listener("10.200.77.1", 800)], 0, false, true)).toBe(1);
});

test("An unpinned bootstrap keeps the strict port-free gate", () => {
  const bootstrap = hostPlan(["aphrody-mcp-http-dbfr"], { target: "dbfr" });
  expect(bootstrap.steps.some((step) => step.id.endsWith("/port-free"))).toBe(true);
  expect(bootstrap.steps.some((step) => step.id.endsWith("/port-owner"))).toBe(false);
});

test("Failed pinned readiness restores the old unit and binary after a real restart", async () => {
  const plan = hostPlan(["aphrody-mcp-http-dbfr"], {
    target: "dbfr",
    binary: { from: "/private/qualified/aphrody", sha256: "a".repeat(64) },
  });
  const commands: string[] = [];
  const run: Runner = async (_host, command) => {
    commands.push(command);
    return { code: command.includes("curl -fsS -m 5") ? 1 : 0, stdout: "", stderr: "" };
  };
  expect(await applyPlan(plan, run, () => {})).toEqual(["aphrody-mcp-http-dbfr/health"]);
  expect(
    commands.some((command) => command.includes("systemctl restart aphrody-mcp-http-dbfr.service")),
  ).toBe(true);
  expect(commands.at(-1)).toContain(".previous");
  expect(commands.at(-1)).toContain(".binary-installed");
  expect(commands.at(-1)).toContain(".was-active");
  expect(commands.at(-1)).toContain(".prev");
  expect(plan.steps.findIndex((step) => step.id.endsWith("/upgrade-state"))).toBeLessThan(
    plan.steps.findIndex((step) => step.id.endsWith("/install-binary")),
  );
});

test("A failed binary installation rolls back even before replacing the unit", async () => {
  const plan = hostPlan(["aphrody-jobs-worker-dbfr"], {
    binary: { from: "/private/qualified/aphrody", sha256: "a".repeat(64) },
  });
  const commands: string[] = [];
  const run: Runner = async (_host, command) => {
    commands.push(command);
    return {
      code: command === plan.steps.find((step) => step.id.endsWith("/install-binary"))?.run ? 1 : 0,
      stdout: "",
      stderr: "",
    };
  };
  expect(await applyPlan(plan, run, () => {})).toEqual(["aphrody-jobs-worker-dbfr/install-binary"]);
  expect(commands.at(-1)).toContain(".previous");
  expect(commands.some((command) => command.includes("sudo install -o root"))).toBe(false);
});

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
function binaryFixture(sourceRoot = tmpdir()) {
  const root = mkdtempSync(join(tmpdir(), "host-pin-install-"));
  temporary.push(root);
  const source = mkdtempSync(join(sourceRoot, "host-pin-source-"));
  temporary.push(source);
  const from = join(source, "native");
  writeFileSync(from, "qualified-native-pin");
  chmodSync(from, 0o755);
  const binary = join(root, "native");
  writeFileSync(binary, "previous-native-binary");
  chmodSync(binary, 0o755);
  const marker = join(root, "installed");
  const sha256 = new Bun.CryptoHasher("sha256").update(readFileSync(from)).digest("hex");
  return { root, from, binary, marker, artifact: { from, sha256 } };
}
// The pinned install script targets Linux hosts: its guarantees are POSIX modes, inodes and symlinks.
const posixTest = test.skipIf(process.platform === "win32");
const shell = (command: string) =>
  Bun.spawn(["sh", "-c", command], { windowsHide: true, stdout: "ignore", stderr: "ignore" })
    .exited;

posixTest(
  "Non-executable or writable native pins are refused without modifying their permissions",
  async () => {
    await Promise.all(
      [0o644, 0o775].map(async (mode) => {
        const f = binaryFixture();
        chmodSync(f.from, mode);
        const oldInode = statSync(f.binary).ino;
        expect(await shell(pinnedBinaryInstall(f.binary, f.artifact, f.marker))).not.toBe(0);
        expect(statSync(f.from).mode & 0o777).toBe(mode);
        expect(statSync(f.binary).ino).toBe(oldInode);
        expect(existsSync(f.marker)).toBe(false);
        expect(existsSync(`${f.binary}.prev`)).toBe(false);
      }),
    );
  },
);

posixTest(
  "Pinned install retains shared pin and old running inode; rollback restores exact bytes",
  async () => {
    const f = binaryFixture();
    const previousInode = statSync(f.binary).ino;
    expect(await shell(pinnedBinaryInstall(f.binary, f.artifact, f.marker))).toBe(0);
    expect(statSync(f.binary).ino).toBe(statSync(f.from).ino);
    expect(statSync(`${f.binary}.prev`).ino).toBe(previousInode);
    expect(readFileSync(f.from, "utf8")).toBe("qualified-native-pin");
    expect(existsSync(f.marker)).toBe(true);
    expect(await shell(`mv -fT -- ${quoted(`${f.binary}.prev`)} ${quoted(f.binary)}`)).toBe(0);
    expect(statSync(f.binary).ino).toBe(previousInode);
    expect(readFileSync(f.binary, "utf8")).toBe("previous-native-binary");
    expect(readFileSync(f.from, "utf8")).toBe("qualified-native-pin");
  },
);

posixTest("Rollback symlinks preserve both old targets and replace only the alias", async () => {
  const f = binaryFixture();
  rmSync(f.binary);
  writeFileSync(join(f.root, "old-pin"), "previous-native-binary");
  writeFileSync(join(f.root, "older-pin"), "retained-ancestor");
  symlinkSync("old-pin", f.binary);
  symlinkSync("older-pin", `${f.binary}.prev`);
  expect(await shell(pinnedBinaryInstall(f.binary, f.artifact, f.marker))).toBe(0);
  expect(lstatSync(`${f.binary}.prev`).isSymbolicLink()).toBe(true);
  expect(readlinkSync(`${f.binary}.prev`)).toBe("old-pin");
  expect(readFileSync(join(f.root, "older-pin"), "utf8")).toBe("retained-ancestor");
  expect(await shell(`mv -fT -- ${quoted(`${f.binary}.prev`)} ${quoted(f.binary)}`)).toBe(0);
  expect(readlinkSync(f.binary)).toBe("old-pin");
  expect(readFileSync(f.binary, "utf8")).toBe("previous-native-binary");
});

test.skipIf(!existsSync("/dev/shm"))(
  "Cross-device pin installation falls back to a verified copy",
  async () => {
    const f = binaryFixture("/dev/shm");
    expect(statSync(f.from).dev).not.toBe(statSync(f.root).dev);
    expect(await shell(pinnedBinaryInstall(f.binary, f.artifact, f.marker))).toBe(0);
    expect(statSync(f.binary).dev).not.toBe(statSync(f.from).dev);
    expect(readFileSync(f.binary)).toEqual(readFileSync(f.from));
    expect(statSync(f.binary).mode & 0o777).toBe(0o755);
  },
);

test("Wrong SHA never alters the active executable, old rollback symlink or immutable pin", async () => {
  const f = binaryFixture();
  const oldInode = statSync(f.binary).ino;
  writeFileSync(join(f.root, "retained"), "retained-ancestor");
  symlinkSync("retained", `${f.binary}.prev`);
  expect(
    await shell(pinnedBinaryInstall(f.binary, { ...f.artifact, sha256: "0".repeat(64) }, f.marker)),
  ).not.toBe(0);
  expect(statSync(f.binary).ino).toBe(oldInode);
  expect(readlinkSync(`${f.binary}.prev`)).toBe("retained");
  expect(readFileSync(f.from, "utf8")).toBe("qualified-native-pin");
  expect(existsSync(f.marker)).toBe(false);
  expect(existsSync(`${f.binary}.new`)).toBe(false);
});
