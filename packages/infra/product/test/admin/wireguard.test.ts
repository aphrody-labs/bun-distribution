// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";

import {
  assembleConf,
  generateKeyPair,
  generatePrivateKey,
  isWgKey,
  normaliseConf,
  parseWgText,
  peerEndpoint,
  publicKeyOf,
} from "../../src/admin/lib/wireguard.ts";
import { hubKey, packJson } from "./helpers.ts";

const b64 = (hex: string) => Buffer.from(hex, "hex").toString("base64");
const block = (packJson().wireguard as { block: string }).block;

test("publicKeyOf matches the RFC 7748 X25519 vector", () => {
  expect(publicKeyOf(b64("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a"))).toBe(
    b64("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a"),
  );
});

test("generated keys are clamped, well formed and pair up", () => {
  const pair = generateKeyPair();
  expect(isWgKey(pair.privateKey)).toBe(true);
  expect(isWgKey(pair.publicKey)).toBe(true);
  const raw = Buffer.from(pair.privateKey, "base64");
  expect(raw[0]! & 7).toBe(0);
  expect(raw[31]! & 128).toBe(0);
  expect(raw[31]! & 64).toBe(64);
  expect(publicKeyOf(pair.privateKey)).toBe(pair.publicKey);
  expect(generatePrivateKey()).not.toBe(generatePrivateKey());
  expect(() => generatePrivateKey(new Uint8Array(5))).toThrow();
});

test("isWgKey refuses anything that is not 32 bytes of base64", () => {
  expect(isWgKey("short")).toBe(false);
  expect(isWgKey(`${"A".repeat(43)}=`)).toBe(true);
  expect(isWgKey(`${"A".repeat(44)}`)).toBe(false);
});

test("assembleConf puts the local private key in [Interface] and keeps the team's peer", () => {
  const { privateKey } = generateKeyPair();
  const conf = assembleConf(privateKey, block);
  expect(
    conf.startsWith(`[Interface]\nPrivateKey = ${privateKey}\nAddress = 198.51.100.10/32\n`),
  ).toBe(true);
  expect(conf).toContain(
    `[Peer]\nPublicKey = ${hubKey}\nEndpoint = 203.0.113.9:51821\nAllowedIPs = 198.51.100.0/24`,
  );
  expect(normaliseConf(conf)).toBe(conf);
  expect(peerEndpoint(conf)).toEqual({ host: "203.0.113.9", port: 51821 });
});

test("a block with its own [Interface] header is accepted too", () => {
  const { privateKey } = generateKeyPair();
  expect(assembleConf(privateKey, `[Interface]\n${block}`)).toContain("PrivateKey");
});

test("the team's block may never carry a private key", () => {
  const { privateKey } = generateKeyPair();
  expect(() => assembleConf(privateKey, `PrivateKey = ${privateKey}\n${block}`)).toThrow(
    "clé privée",
  );
});

test("script hooks and system settings are refused (they run as SYSTEM on Windows)", () => {
  const { privateKey } = generateKeyPair();
  for (const evil of [
    "PostUp = cmd /c calc",
    "preup = x",
    "PostDown = x",
    "SaveConfig = true",
    "DNS = 198.51.100.53",
    "Table = off",
    "ListenPort = 1",
  ]) {
    expect(() => assembleConf(privateKey, `${evil}\n${block}`)).toThrow("refusé");
  }
});

test("a default route in AllowedIPs is refused: only the private network goes through the tunnel", () => {
  const { privateKey } = generateKeyPair();
  expect(() => assembleConf(privateKey, block.replace("198.51.100.0/24", "0.0.0.0/0"))).toThrow(
    "route par défaut",
  );
  expect(() =>
    assembleConf(privateKey, block.replace("198.51.100.0/24", "198.51.100.0/24, ::/0")),
  ).toThrow("route par défaut");
});

test("malformed blocks are refused with a reason", () => {
  const { privateKey } = generateKeyPair();
  expect(() => assembleConf(privateKey, "Address = 198.51.100.10/32")).toThrow("[Peer]");
  expect(() =>
    assembleConf(privateKey, block.replace("Address = 198.51.100.10/32", "Address = not-an-ip")),
  ).toThrow("invalide");
  expect(() => assembleConf(privateKey, block.replace(hubKey, "tooshort"))).toThrow("invalide");
  expect(() =>
    assembleConf(privateKey, block.replace("203.0.113.9:51821", "bad host:1")),
  ).toThrow();
  expect(() => assembleConf(privateKey, `[Weird]\n${block}`)).toThrow("inconnue");
  expect(() => assembleConf("nope", block)).toThrow("clé privée");
});

test("normaliseConf validates a complete file from the team", () => {
  const { privateKey } = generateKeyPair();
  const full = assembleConf(privateKey, block);
  expect(normaliseConf(full.replace(/\n/g, "\r\n"))).toBe(full);
  expect(() => normaliseConf(full.replace(/PrivateKey = .*\n/, ""))).toThrow("PrivateKey");
  expect(() => normaliseConf(`${full}PostUp = x\n`)).toThrow();
});

test("parseWgText ignores comments and blank lines", () => {
  const sections = parseWgText(
    "# hello\n[Interface]\nAddress = 198.51.100.10/32 # trailing\n\n[Peer]\nPublicKey = x\n",
  );
  expect(sections.map((section) => section.name)).toEqual(["Interface", "Peer"]);
  expect(sections[0]!.entries[0]).toEqual(["Address", "198.51.100.10/32"]);
});
