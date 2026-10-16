// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  BEGIN,
  END,
  captureSshConfig,
  envValue,
  mergeNetMap,
  reachable,
  renderNetMap,
} from "../src/host/net-env.ts";
import {
  collectFacts,
  parseWgDump,
  renderFacts,
  setKeys,
  staticUpdates,
} from "../src/host/net-facts.ts";
import { loadTunnel } from "../src/host/wireguard.ts";

const tunnel = loadTunnel(resolve(import.meta.dir, "../../../tools/aphrody/config/host"));
const now = new Date("2026-10-09T12:00:00Z");

test("aphro-pc reaches its grants and its mesh members, never a meshDenied host by mesh", () => {
  const own = reachable(tunnel, "aphro-pc");
  expect(own.mesh.map((m) => m.id).toSorted()).toEqual(["omar", "vps"]);
  expect(own.services.every((s) => s.status !== "pending")).toBe(true);
  expect(
    reachable(tunnel, "dbfr")
      .mesh.map((m) => m.id)
      .toSorted(),
  ).toEqual(["aphro-pc", "omar", "vps"]);
});

test("the rendered block carries addresses and probes but no secret", () => {
  const block = renderNetMap(
    tunnel,
    "aphro-pc",
    [{ name: "ssh-vps", target: "10.200.77.1:22", ok: true, ms: 3 }],
    now,
  );
  expect(block.startsWith(BEGIN)).toBe(true);
  expect(block.endsWith(END)).toBe(true);
  expect(block).toContain("NET_SELF=aphro-pc");
  expect(block).toContain("NET_APHRO_PC_ADDRESS=10.200.77.4");
  expect(block).toContain("NET_MESH_DENIED=dbfr");
  expect(block).toContain("NET_STATUS_SSH_VPS=up 10.200.77.1:22 3ms");
  expect(block).toContain("NET_STATUS_UP=1/1");
  expect(block).not.toMatch(/PRIVATE KEY|PrivateKey|TOKEN=/i);
});

test("merge replaces only the generated block and keeps the secrets around it", () => {
  const secrets = 'WG_PRIVATE_KEY=abc\nSSH_KEY="-----BEGIN\nx\n-----END"\n';
  const first = mergeNetMap(secrets, renderNetMap(tunnel, "aphro-pc", undefined, now));
  expect(first.startsWith(secrets.trimEnd())).toBe(true);
  const second = mergeNetMap(first, `${BEGIN}\nNET_SELF=omar\n${END}`);
  expect(second.split(BEGIN).length).toBe(2);
  expect(second).toContain("NET_SELF=omar");
  expect(second).not.toContain("NET_SELF=aphro-pc");
  expect(envValue(second, "SSH_KEY")).toBe("-----BEGIN\nx\n-----END");
  expect(envValue(second, "WG_PRIVATE_KEY")).toBe("abc");
});

test("the SSH config is mirrored from the live file", () => {
  const file = join(mkdtempSync(join(tmpdir(), "net-env-")), "config");
  writeFileSync(file, 'Host vps\r\n  HostName 10.200.77.1\r\n  ProxyCommand "x"\r\n');
  const added = captureSshConfig("A=1\n", file);
  expect(envValue(added, "SSH_CONFIG")).toBe(
    "Host vps\n  HostName 10.200.77.1\n  ProxyCommand 'x'",
  );
  const replaced = captureSshConfig('A=1\nSSH_CONFIG="old\nvalue"\nB=2\n', file);
  expect(replaced).toContain("B=2");
  expect(replaced).not.toContain("old");
});

test("wg dump parsing gives public address, handshake age and traffic per member address", () => {
  const dump = [
    "priv\tpub\t51821\toff",
    "k1\t(none)\t92.170.252.46:52103\t10.200.77.10/32\t1000\t10\t20\t25",
    "k2\t(none)\t(none)\t10.200.77.2/32\t0\t0\t0\t25",
  ].join("\n");
  const peers = parseWgDump(dump, 1071);
  expect(peers[0]).toMatchObject({
    address: "10.200.77.10",
    publicIp: "92.170.252.46",
    handshakeAgeS: 71,
    rx: 10,
    tx: 20,
  });
  expect(peers[1]).toMatchObject({ address: "10.200.77.2", publicIp: "", handshakeAgeS: null });
});

test("live facts are rendered without secrets and rewrite the static public addresses", async () => {
  const hubDump = "i\tp\t1\toff\nk\t(none)\t92.170.252.46:1\t10.200.77.10/32\t100\t1\t2\t25";
  const runner = async (cmd: string[]) =>
    cmd.at(-1)?.includes("wg show") ? hubDump : "hostname=h\nufw_rules=3";
  const c = await collectFacts(tunnel, "aphro-pc", async (_h, p) => p === 22, runner, 130);
  const lines = renderFacts(c, now).join("\n");
  expect(lines).toContain("NET_LIVE_OMAR_PUBLIC_IP=92.170.252.46");
  expect(lines).toContain("NET_LIVE_OMAR_WG_ONLINE=yes");
  expect(lines).toContain("NET_LIVE_VPS_UFW_RULES=3");
  expect(lines).toContain("NET_LIVE_DBFR_PORTS_OPEN=22");
  expect(lines).not.toMatch(/PRIVATE|KEY=/);
  const text = setKeys("OMAR_PUBLIC_IP=1.1.1.1\nOTHER=x\n", staticUpdates(c.publicIps));
  expect(text).toBe("OMAR_PUBLIC_IP=92.170.252.46\nOTHER=x\n");
});
