// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  PackError,
  findPackFiles,
  isSafeRemotePath,
  loadProfile,
  parseAccessPack,
  saveProfile,
  trainHostId,
} from "../../src/admin/lib/profile.ts";
import { packJson, samplePack, testContext } from "./helpers.ts";

test("a valid pack is parsed with its defaults", () => {
  const pack = samplePack();
  expect(pack.hosts.vps).toEqual({
    address: "198.51.100.1",
    port: 22,
    user: "omar",
    roles: ["admin"],
    repoDir: "~/aphrody",
    aphrodyBin: "aphrody",
  });
  expect(pack.downloadsBase).toBe("https://downloads.aphrody.com");
  expect(pack.repository).toBe("aphrody-labs/aphrody");
  expect(trainHostId(pack)).toBe("gpu");
});

test("only an explicitly declared or train-role host is used for training", () => {
  const pack = samplePack({ trainHost: undefined });
  expect(trainHostId(pack)).toBe("gpu");
  const plain = parseAccessPack(
    packJson({
      trainHost: undefined,
      hosts: { vps: { address: "198.51.100.1" } },
    }),
  );
  expect(trainHostId(plain)).toBeUndefined();
});

const bad = (overrides: Record<string, unknown>) => () => parseAccessPack(packJson(overrides));

test("everything that reaches ssh, a shell, a URL or WireGuard is validated", () => {
  expect(bad({ kind: "other" })).toThrow(PackError);
  expect(bad({ schemaVersion: 2 })).toThrow(PackError);
  expect(bad({ hosts: {} })).toThrow("aucun hôte");
  expect(bad({ hosts: { "Bad Name": { address: "198.51.100.1" } } })).toThrow("nom d'hôte");
  expect(bad({ hosts: { vps: { address: "198.51.100.1; rm -rf /" } } })).toThrow("address");
  expect(bad({ hosts: { vps: { address: "198.51.100.1", port: 70000 } } })).toThrow("port");
  expect(bad({ hosts: { vps: { address: "198.51.100.1", user: "root; id" } } })).toThrow("user");
  expect(bad({ hosts: { vps: { address: "198.51.100.1", repoDir: "../etc" } } })).toThrow("chemin");
  expect(bad({ hosts: { vps: { address: "198.51.100.1", repoDir: "~/a b" } } })).toThrow("chemin");
  expect(bad({ hosts: { vps: { address: "198.51.100.1", repoDir: "$(id)" } } })).toThrow("chemin");
  expect(
    bad({
      hosts: { vps: { address: "198.51.100.1", aphrodyBin: "aphrody; id" } },
    }),
  ).toThrow("aphrodyBin");
  expect(bad({ trainHost: "ghost" })).toThrow("trainHost");
  expect(bad({ wireguard: { tunnelName: "../x" } })).toThrow("tunnelName");
  expect(
    bad({
      wireguard: {
        tunnelName: "aphrody",
        block: "PostUp = calc\nAddress = 198.51.100.10/32",
      },
    }),
  ).toThrow("wireguard.block");
  expect(bad({ services: { a2a: { url: "http://user:pass@198.51.100.1:8788" } } })).toThrow("identifiants");
  expect(bad({ services: { a2a: { url: "ftp://198.51.100.1" } } })).toThrow("http");
  expect(bad({ hostKeys: ["@cert-authority * ssh-ed25519 AAAA"] })).toThrow("hostKeys");
  expect(bad({ hostKeys: ["198.51.100.1 ssh-ed25519 AAAA\nextra"] })).toThrow("hostKeys");
  expect(bad({ downloadsBase: "http://evil.example" })).toThrow("downloadsBase");
  expect(bad({ repository: "not a repo" })).toThrow("repository");
});

test("known_hosts lines and https bases are accepted", () => {
  const pack = samplePack({
    hostKeys: ["198.51.100.1 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForTestsOnly0000000000000000000"],
    downloadsBase: "https://downloads.example.org/",
  });
  expect(pack.hostKeys).toHaveLength(1);
  expect(pack.downloadsBase).toBe("https://downloads.example.org");
});

test("remote path safety", () => {
  for (const ok of ["~/aphrody", "/home/ubuntu/src/aphrody", "data/triples.jsonl", "/a/b-c_d.e"])
    expect(isSafeRemotePath(ok)).toBe(true);
  for (const nope of ["a b", "a;b", "$HOME/x", "`id`", "../x", "a/../b", "a'b", 'a"b', "", "/a/*"])
    expect(isSafeRemotePath(nope)).toBe(false);
});

test("profile round trip through the kit's data folder", async () => {
  const { ctx } = testContext();
  expect(await loadProfile(ctx.paths)).toBeUndefined();
  await saveProfile(ctx.paths, samplePack());
  expect((await loadProfile(ctx.paths))?.hosts.gpu?.repoDir).toBe("/home/ubuntu/apps/aphrody");
  writeFileSync(ctx.paths.profileFile, "{broken");
  expect(await loadProfile(ctx.paths)).toBeUndefined();
});

test("findPackFiles finds browser-renamed copies, newest first", () => {
  const dir = mkdtempSync(join(tmpdir(), "packs-"));
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "aphrody-omar-acces.json"), "{}");
  writeFileSync(join(dir, "aphrody-omar-acces (1).json"), "{}");
  writeFileSync(join(dir, "other.json"), "{}");
  utimesSync(join(dir, "aphrody-omar-acces.json"), new Date("2026-10-01"), new Date("2026-10-01"));
  utimesSync(join(dir, "aphrody-omar-acces (1).json"), new Date("2026-10-05"), new Date("2026-10-05"));
  expect(findPackFiles([dir, join(dir, "missing")]).map(path => basename(path))).toEqual([
    "aphrody-omar-acces (1).json",
    "aphrody-omar-acces.json",
  ]);
});
