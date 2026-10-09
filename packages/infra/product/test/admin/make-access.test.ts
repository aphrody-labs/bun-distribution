// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertOutsideRepo, buildAccessPack } from "../../src/admin/access.ts";
import { hubKey } from "./helpers.ts";

const TUNNEL = {
  windowsTunnelName: "aphrody",
  peers: [{ id: "omar" }, { id: "wsl" }],
  services: [
    { id: "ssh-vps", host: "vps", address: "198.51.100.1", port: 22 },
    { id: "ssh-dbfr", host: "dbfr", address: "198.51.100.3", port: 22 },
    { id: "mcp-http", host: "vps", address: "198.51.100.1", port: 8789 },
    { id: "a2a", host: "vps", address: "198.51.100.1", port: 8788 },
    { id: "training", host: "wsl", address: "198.51.100.2" },
  ],
  grants: { omar: ["ssh-vps", "ssh-dbfr", "mcp-http", "a2a", "training"], wsl: ["ssh-vps"] },
};
const BLOCK = `Address = 198.51.100.10/32\n\n[Peer]\nPublicKey = ${hubKey}\nEndpoint = 203.0.113.9:51821\nAllowedIPs = 198.51.100.0/24\nPersistentKeepalive = 25\n`;

test("the pack mirrors the grants of the peer: hosts with ssh, services with a port, the training host marked", () => {
  const pack = buildAccessPack(TUNNEL, {
    peer: "omar",
    wgBlock: BLOCK,
    trainHost: "dbfr",
    repoDirs: { dbfr: "/home/ubuntu/apps/aphrody" },
    issuedAt: "2026-10-06T00:00:00Z",
  });
  expect(Object.keys(pack.hosts)).toEqual(["vps", "dbfr"]);
  expect(pack.hosts.vps).toMatchObject({
    address: "198.51.100.1",
    user: "omar",
    roles: ["admin"],
    repoDir: "~/aphrody",
  });
  expect(pack.hosts.dbfr).toMatchObject({ roles: ["train"], repoDir: "/home/ubuntu/apps/aphrody" });
  expect(pack.trainHost).toBe("dbfr");
  expect(pack.services.mcpHttp).toEqual({
    url: "http://198.51.100.1:8789/mcp",
    health: "http://198.51.100.1:8789/healthz",
  });
  expect(pack.services.a2a?.health).toBe("http://198.51.100.1:8788/ping");
  expect(pack.wireguard).toEqual({ tunnelName: "aphrody", block: BLOCK });
  expect(pack.issuedFor).toBe("omar");
});

test("a peer without ssh grants, an unknown peer, a hostile block or an unknown train host are refused", () => {
  expect(() => buildAccessPack(TUNNEL, { peer: "wsl", wgBlock: BLOCK })).not.toThrow();
  expect(() =>
    buildAccessPack({ ...TUNNEL, grants: { omar: ["mcp-http"] } }, { peer: "omar" }),
  ).toThrow("aucun accès SSH");
  expect(() => buildAccessPack(TUNNEL, { peer: "ghost" })).toThrow("inconnu");
  expect(() =>
    buildAccessPack(TUNNEL, { peer: "omar", wgBlock: `PostUp = calc\n${BLOCK}` }),
  ).toThrow("PostUp");
  expect(() =>
    buildAccessPack(TUNNEL, { peer: "omar", wgBlock: BLOCK, trainHost: "ghost" }),
  ).toThrow("trainHost");
});

test("the pack never contains a private key and is written outside the repository only", () => {
  const pack = buildAccessPack(TUNNEL, { peer: "omar", wgBlock: BLOCK });
  expect(JSON.stringify(pack)).not.toMatch(/PrivateKey/i);
  const repo = mkdtempSync(join(tmpdir(), "repo-"));
  mkdirSync(join(repo, "sub"));
  expect(() => assertOutsideRepo(join(repo, "pack.json"), repo)).toThrow("refus");
  expect(() => assertOutsideRepo(join(repo, "sub", "deeper", "pack.json"), repo)).toThrow("refus");
  const outside = mkdtempSync(join(tmpdir(), "private-"));
  expect(() => assertOutsideRepo(join(outside, "pack.json"), repo)).not.toThrow();
});

test("the command writes a mode 600 file that the kit itself accepts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "make-access-"));
  writeFileSync(join(dir, "tunnel.json"), JSON.stringify(TUNNEL));
  writeFileSync(join(dir, "block.txt"), BLOCK);
  writeFileSync(join(dir, "hosts.txt"), "# comment\n198.51.100.1 ssh-ed25519 AAAAFakeKey\n");
  const out = join(dir, "out", "aphrody-omar-acces.json");
  const proc = Bun.spawnSync(
    [
      "bun",
      join(import.meta.dir, "../../src/cli.ts"),
      "admin",
      "access-pack",
      "--tunnel",
      join(dir, "tunnel.json"),
      "--peer",
      "omar",
      "--wg-block",
      join(dir, "block.txt"),
      "--host-keys",
      join(dir, "hosts.txt"),
      "--train-host",
      "vps",
      "--out",
      out,
    ],
    { windowsHide: true },
  );
  expect(proc.exitCode).toBe(0);
  expect(proc.stdout.toString()).toContain("1 empreintes");
  const { parseAccessPack } = await import("../../src/admin/lib/profile.ts");
  const pack = parseAccessPack(JSON.parse(readFileSync(out, "utf8")));
  expect(pack.hostKeys).toEqual(["198.51.100.1 ssh-ed25519 AAAAFakeKey"]);
  expect(pack.trainHost).toBe("vps");
  const inRepo = Bun.spawnSync(
    [
      "bun",
      join(import.meta.dir, "../../src/cli.ts"),
      "admin",
      "access-pack",
      "--peer",
      "omar",
      "--out",
      join(import.meta.dir, "leak.json"),
    ],
    { windowsHide: true },
  );
  expect(inRepo.exitCode).toBe(1);
  expect(inRepo.stderr.toString()).toContain("refus");
});
