// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  elevatedCommand,
  ensureWgKey,
  importTunnel,
  installTunnelElevated,
  parseServiceState,
  selfCommand,
  stageConf,
} from "../../src/admin/lib/tunnel.ts";
import {
  generateKeyPair,
  isWgKey,
  publicKeyOf,
} from "../../src/admin/lib/wireguard.ts";
import { samplePack, testContext } from "./helpers.ts";

const touch = (path: string, text = "x") => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

test("service state is read from sc output", () => {
  expect(
    parseServiceState(
      "SERVICE_NAME: WireGuardTunnel$aphrody\n        STATE              : 4  RUNNING",
    ),
  ).toBe("RUNNING");
  expect(parseServiceState("        STATE              : 1  STOPPED")).toBe(
    "STOPPED",
  );
  expect(
    parseServiceState("[SC] EnumQueryServicesStatus:OpenService FAILED 1060"),
  ).toBeUndefined();
});

test("the elevated command quotes paths with spaces for Start-Process", () => {
  const argv = elevatedCommand([
    "C:\\Users\\Omar Dupont\\AppData\\Local\\Aphrody\\Omar\\Aphrody-Omar.exe",
    "interne",
    "wg-installer",
    "C:\\ProgramData\\x y\\aphrody.conf",
    "aphrody",
  ]);
  expect(argv.slice(0, 5)).toEqual([
    "powershell",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
  ]);
  expect(argv[5]).toBe(
    `Start-Process -FilePath 'C:\\Users\\Omar Dupont\\AppData\\Local\\Aphrody\\Omar\\Aphrody-Omar.exe' -ArgumentList '"interne"','"wg-installer"','"C:\\ProgramData\\x y\\aphrody.conf"','"aphrody"' -Verb RunAs -Wait`,
  );
  expect(elevatedCommand(["it's.exe"])[5]).toBe(
    "Start-Process -FilePath 'it''s.exe' -Verb RunAs -Wait",
  );
});

test("selfCommand restarts the exe, or bun with the entry file from sources", () => {
  const { ctx } = testContext();
  expect(selfCommand(ctx)).toEqual([ctx.exePath]);
  expect(selfCommand({ ...ctx, exePath: "C:\\bun\\bun.exe" })[0]).toBe(
    "C:\\bun\\bun.exe",
  );
});

test("the WireGuard key is made once, kept in a protected file and never rewritten", async () => {
  const { ctx, sys } = testContext();
  const first = await ensureWgKey(sys, ctx.paths);
  expect(first.created).toBe(true);
  expect(isWgKey(first.privateKey)).toBe(true);
  expect(publicKeyOf(first.privateKey)).toBe(first.publicKey);
  expect(readFileSync(ctx.paths.wgKeyFile, "utf8").trim()).toBe(
    first.privateKey,
  );
  expect(sys.calls[0]!.argv.slice(0, 3)).toEqual([
    "icacls",
    ctx.paths.wgKeyFile,
    "/inheritance:r",
  ]);
  expect(sys.calls[0]!.argv).toContain("omar:F");
  const second = await ensureWgKey(sys, ctx.paths);
  expect(second).toEqual({ ...first, created: false });
  writeFileSync(ctx.paths.wgKeyFile, "garbage");
  await expect(ensureWgKey(sys, ctx.paths)).rejects.toThrow("illisible");
  expect(readFileSync(ctx.paths.wgKeyFile, "utf8")).toBe("garbage");
});

test("stageConf assembles the file in a protected temp folder and fingerprints it", async () => {
  const { ctx, sys } = testContext();
  const { privateKey } = generateKeyPair();
  const staged = await stageConf(sys, ctx.paths, samplePack(), privateKey);
  const conf = readFileSync(staged.path, "utf8");
  expect(conf).toContain(`PrivateKey = ${privateKey}`);
  expect(staged.path.startsWith(join(ctx.paths.programData, "Aphrody"))).toBe(
    true,
  );
  expect(
    sys.calls.some(
      (call) => call.argv[0] === "icacls" && call.argv.includes(staged.path),
    ),
  ).toBe(true);
  expect(
    (await stageConf(sys, ctx.paths, samplePack(), privateKey)).fingerprint,
  ).toBe(staged.fingerprint);
  expect(
    (
      await stageConf(
        sys,
        ctx.paths,
        samplePack(),
        generateKeyPair().privateKey,
      )
    ).fingerprint,
  ).not.toBe(staged.fingerprint);
  await expect(
    stageConf(sys, ctx.paths, samplePack({ wireguard: undefined }), privateKey),
  ).rejects.toThrow("WireGuard");
  await expect(
    stageConf(
      sys,
      ctx.paths,
      samplePack({ wireguard: { tunnelName: "aphrody" } }),
      privateKey,
    ),
  ).rejects.toThrow("ni bloc");
});

test("a complete conf from the team is validated before it is staged", async () => {
  const { ctx, sys } = testContext();
  const { privateKey } = generateKeyPair();
  const full = readFileSync(
    (await stageConf(sys, ctx.paths, samplePack(), privateKey)).path,
    "utf8",
  );
  const staged = await stageConf(
    sys,
    ctx.paths,
    samplePack({ wireguard: { tunnelName: "aphrody" } }),
    privateKey,
    full,
  );
  expect(readFileSync(staged.path, "utf8")).toBe(full);
  await expect(
    stageConf(
      sys,
      ctx.paths,
      samplePack({ wireguard: { tunnelName: "aphrody" } }),
      privateKey,
      `${full}PostUp = calc\n`,
    ),
  ).rejects.toThrow();
});

test("elevated install: encrypted copy preferred, previous tunnel removed first, temp conf always deleted", async () => {
  const { ctx, sys, root } = testContext();
  const wireguard = join(ctx.paths.programFiles, "WireGuard", "wireguard.exe");
  touch(wireguard);
  const conf = join(root, "stage", "aphrody.conf");
  touch(conf, "[Interface]\nPrivateKey = x\n");
  let queries = 0;
  sys.handlers.push(
    {
      match: "sc query",
      result: () => ({
        stdout: queries++ === 0 ? "STATE : 1  STOPPED" : "[SC] FAILED 1060",
      }),
    },
    {
      match: /uninstalltunnelservice/,
      result: {},
    },
    {
      match: /installtunnelservice/,
      result: {},
    },
  );
  // WireGuard's manager encrypts the plain file shortly after it appears
  const dpapi = join(
    ctx.paths.programFiles,
    "WireGuard",
    "Data",
    "Configurations",
    "aphrody.conf.dpapi",
  );
  sys.sleep = async () => {
    if (existsSync(join(dirname(dpapi), "aphrody.conf")))
      touch(dpapi, "encrypted");
  };
  const result = await installTunnelElevated(sys, ctx.paths, conf, "aphrody");
  expect(result.ok).toBe(true);
  expect(result.detail).toContain("chiffrée");
  const order = sys.calls
    .map((call) => call.argv.join(" "))
    .filter((line) => /tunnelservice/.test(line));
  expect(order[0]).toContain("/uninstalltunnelservice aphrody");
  expect(order[1]).toBe(`${wireguard} /installtunnelservice ${dpapi}`);
  expect(existsSync(conf)).toBe(false);
});

test("elevated install falls back to the plain file when the manager does not encrypt, and reports wireguard failures", async () => {
  const { ctx, sys, root } = testContext();
  touch(join(ctx.paths.programFiles, "WireGuard", "wireguard.exe"));
  const conf = join(root, "stage", "aphrody.conf");
  touch(conf, "[Interface]\n");
  sys.handlers.push(
    { match: "sc query", result: { stdout: "[SC] FAILED 1060" } },
    {
      match: /installtunnelservice/,
      result: { code: 1, stderr: "PrivateKey = AAAA boom" },
    },
  );
  const failed = await installTunnelElevated(sys, ctx.paths, conf, "aphrody");
  expect(failed.ok).toBe(false);
  expect(failed.detail).toContain("boom");
  expect(failed.detail).not.toContain("AAAA");
  expect(existsSync(conf)).toBe(false);
  expect(
    (
      await installTunnelElevated(
        sys,
        ctx.paths,
        join(root, "nothing.conf"),
        "aphrody",
      )
    ).ok,
  ).toBe(false);
});

test("importTunnel asks Windows for elevation, waits for the service and removes the staged conf", async () => {
  const { ctx, sys, root } = testContext();
  touch(join(ctx.paths.programFiles, "WireGuard", "wireguard.exe"));
  const staged = join(root, "stage", "aphrody.conf");
  touch(staged, "secret");
  let polls = 0;
  sys.handlers.push(
    { match: /^powershell .*Start-Process/, result: {} },
    {
      match: "sc query",
      result: () => ({
        stdout: ++polls < 3 ? "STATE : 2  START_PENDING" : "STATE : 4  RUNNING",
      }),
    },
  );
  const result = await importTunnel(
    ctx,
    { path: staged, fingerprint: "f" },
    "aphrody",
  );
  expect(result.ok).toBe(true);
  expect(existsSync(staged)).toBe(false);
  const elevated = sys.calls.find((call) => call.argv[0] === "powershell")!;
  expect(elevated.argv[5]).toContain("-Verb RunAs -Wait");
  expect(elevated.argv[5]).toContain("wg-installer");
});

test("importTunnel explains a refused consent window and a tunnel that never starts", async () => {
  const { ctx, sys, root } = testContext();
  touch(join(ctx.paths.programFiles, "WireGuard", "wireguard.exe"));
  const staged = join(root, "stage", "aphrody.conf");
  touch(staged, "secret");
  sys.handlers.push({
    match: /^powershell /,
    result: { code: 1, stderr: "The operation was canceled by the user" },
  });
  const refused = await importTunnel(
    ctx,
    { path: staged, fingerprint: "f" },
    "aphrody",
  );
  expect(refused.ok).toBe(false);
  expect(refused.detail).toContain("« Oui »");
  expect(existsSync(staged)).toBe(false);
  sys.handlers.length = 0;
  sys.handlers.push(
    { match: /^powershell /, result: {} },
    { match: "sc query", result: { stdout: "STATE : 1  STOPPED" } },
  );
  touch(staged, "secret");
  expect(
    (await importTunnel(ctx, { path: staged, fingerprint: "f" }, "aphrody"))
      .detail,
  ).toContain("n'a pas démarré");
  const linux = testContext({ platform: "linux" });
  expect(
    (
      await importTunnel(
        linux.ctx,
        { path: staged, fingerprint: "f" },
        "aphrody",
      )
    ).detail,
  ).toContain("Windows");
});
