// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCatalog, composeUnit, loadCatalog } from "../src/host/index.ts";
import {
  accountProblems,
  assertOutsideRepo,
  buildPlan,
  cidrsOverlap,
  clientConf,
  clientPasteBlock,
  clientSections,
  HUB_KEY_PLACEHOLDER,
  hubConfig,
  inCidr,
  isWgKey,
  loadTunnel,
  observePlan,
  PRIVATE_KEY_PATTERN,
  READ_ONLY,
  tunnelProblems,
  ufwRules,
} from "../src/host/wireguard.ts";

// The tree these tests live in, not $HOME/aphrody: a worktree is checked against itself.
const repo = join(import.meta.dir, "..", "..", "..", "..");
const root = join(repo, "tools", "config", "host");
const catalog = loadCatalog(root);
const tunnel = () => loadTunnel(root);
const unappliedTunnel = () => {
  const t = tunnel();
  t.hub.publicKey = null;
  for (const p of t.peers) if (["wsl", "dbfr"].includes(p.id)) p.publicKey = null;
  return t;
};
const plan = () =>
  buildPlan(unappliedTunnel(), {
    root,
    catalog,
    compose: u => composeUnit(u, root),
  });
const newKey = () => randomBytes(32).toString("base64");

/** A copy of the declaration and the account files that a test may mutate. */
function scratch(mutate: (t: Record<string, any>) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "wg-decl-"));
  mkdirSync(join(dir, "wireguard"), { recursive: true });
  const t = JSON.parse(readFileSync(join(root, "wireguard/aphrody-tunnel.json"), "utf8"));
  mutate(t);
  writeFileSync(join(dir, "wireguard/aphrody-tunnel.json"), JSON.stringify(t));
  return dir;
}

test("the host catalog, the tunnel declaration and the omar account agree", () => {
  expect(checkCatalog(root)).toEqual([]);
  expect(catalog.wireguard?.declaration).toBe("wireguard/aphrody-tunnel.json");
  expect(catalog.accounts?.map(a => a.user)).toEqual(["omar"]);
});

test("the tunnel subnet overlaps no existing network, wg0 included", () => {
  const t = tunnel();
  for (const n of t.existingNetworks) expect(cidrsOverlap(t.subnet, n.cidr)).toBe(false);
  expect(t.existingNetworks.map(n => n.cidr)).toContain("10.8.0.0/24");
  expect(cidrsOverlap("10.100.0.0/24", "10.64.0.0/10")).toBe(true);
  expect(cidrsOverlap("10.200.77.0/24", "10.8.0.0/24")).toBe(false);
  expect(inCidr("10.200.77.10", t.subnet)).toBe(true);
  expect(inCidr("10.8.0.3", t.subnet)).toBe(false);
});

test("a declaration that breaks a rule is reported", () => {
  const bad: [string, (t: Record<string, any>) => void, RegExp][] = [
    ["overlapping subnet", t => (t.subnet = "10.8.0.0/24"), /overlaps 10\.8\.0\.0\/24/],
    ["default route", t => (t.clientAllowedIps = "0.0.0.0/0"), /split tunnel/],
    ["wg0 reuse", t => (t.interface = "wg0"), /new wgN/],
    ["wg0 port", t => (t.hub.listenPort = 51820), /51820/],
    ["bad key", t => (t.peers[2].publicKey = "not-a-key"), /not a WireGuard key/],
    ["duplicate address", t => (t.peers[0].address = t.peers[1].address), /duplicate address/],
    ["address outside", t => (t.peers[0].address = "10.8.0.9"), /outside the subnet/],
    [
      "foreign marker",
      t =>
        (t.peers[3].udpSource = {
          mode: "ufw",
          ips: ["92.170.252.46"],
          comment: "shenron-admin",
        }),
      /comment must be/,
    ],
    [
      "world source",
      t =>
        (t.peers[3].udpSource = {
          mode: "ufw",
          ips: ["0.0.0.0/0"],
          comment: "aphrody-wg-omar",
        }),
      /one public address/,
    ],
    ["postgres exposed", t => (t.services[0].port = 5432), /never-open port/],
    ["unknown grant", t => (t.grants.omar = ["nope"]), /unknown service/],
    ["mesh to dbfr", t => t.mesh[0].to.push("dbfr"), /opens every port of dbfr/],
    ["mesh unknown member", t => t.mesh[0].from.push("nobody"), /unknown member nobody/],
    ["private key in file", t => (t.$note = `PrivateKey = ${newKey()}`), /private key material/],
  ];
  for (const [label, mutate, pattern] of bad) {
    const dir = scratch(mutate);
    try {
      const problems = tunnelProblems(dir).join("\n");
      expect({ label, hit: pattern.test(problems) }).toEqual({
        label,
        hit: true,
      });
    } finally {
      rmSync(dir, { recursive: true });
    }
  }
});

test("WireGuard key format: 44 base64 characters, 32 bytes", () => {
  expect(isWgKey(newKey())).toBe(true);
  expect(isWgKey(tunnel().peers.find(p => p.id === "aphro-pc")?.publicKey)).toBe(true);
  expect(isWgKey("AAAA")).toBe(false);
  expect(isWgKey(`${newKey().slice(0, 43)}!`)).toBe(false);
  expect(isWgKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHyaI3orZmtXCvv8ItHvbBVEGHbPOq+QCicxIbmrHBxO")).toBe(false);
});

test("registered peers have valid public keys after host-local generation", () => {
  const t = tunnel();
  expect(t.peers.find(p => p.id === "omar")?.publicKey).toBe("EXfatxgVFs8Lr9k7QoJ2wiznY5MYO4C19+4gLbGmCEw=");
  expect(t.peers.find(p => p.id === "omar")?.publicKeyNote).toContain("never handshaked");
  expect(t.peers.find(p => p.id === "aphro-pc")?.publicKey).toBe("VewVolGGwY3Lvp78jp9dKB7RIxg2xUR2pbVS+y+uj2I=");
  expect(isWgKey(t.hub.publicKey)).toBe(true);
  expect(t.peers.every(p => isWgKey(p.publicKey))).toBe(true);
});

test("client sections: split tunnel, no private key, hub key placeholder until it exists", () => {
  const t = unappliedTunnel();
  for (const p of t.peers) {
    const s = clientSections(t, p.id);
    const text = `${s.interface}\n${s.peer}`;
    expect(text).toContain(`Address = ${p.address}/32`);
    expect(text).toContain("AllowedIPs = 10.200.77.0/24");
    expect(text).toContain("Endpoint = 51.77.147.152:51821");
    expect(text).toContain("PersistentKeepalive = 25");
    expect(text).toContain(HUB_KEY_PLACEHOLDER);
    expect(text).not.toMatch(/\/0\b/);
    expect(text).not.toContain("PrivateKey");
    expect(text).not.toContain("DNS");
    expect(s.hubKeyKnown).toBe(false);
  }
  const hub = newKey();
  const withKey = clientSections(t, "omar", hub);
  expect(withKey.peer).toContain(`PublicKey = ${hub}`);
  expect(withKey.hubKeyKnown).toBe(true);
  expect(() => clientSections(t, "omar", "short")).toThrow(/not a WireGuard key/);
  expect(() => clientSections(t, "nobody")).toThrow(/unknown peer/);
});

test("the paste block goes under the PrivateKey line of the app's empty tunnel", () => {
  const block = clientPasteBlock(tunnel(), "omar", newKey());
  expect(block.split("\n")[0]).toBe("Address = 10.200.77.10/32");
  expect(block).not.toContain("[Interface]");
  expect(block).toContain("[Peer]");
  expect(block).not.toContain("PrivateKey");
});

test("a complete conf needs a valid private key and a valid hub key, and never lands in the checkout", () => {
  const t = tunnel();
  const hub = newKey();
  const priv = newKey();
  const conf = clientConf(t, "aphro-pc", hub, `${priv}\n`);
  expect(conf).toContain(`PrivateKey = ${priv}`);
  expect(conf.indexOf("[Interface]")).toBeLessThan(conf.indexOf("PrivateKey"));
  expect(conf.indexOf("PrivateKey")).toBeLessThan(conf.indexOf("[Peer]"));
  expect(() => clientConf(t, "aphro-pc", hub, "oops")).toThrow(/private key/);
  expect(() => clientConf(t, "aphro-pc", "oops", priv)).toThrow(/hub-public-key/);
  expect(() => assertOutsideRepo(join(repo, "tools", "config", "aphrody.conf"), repo)).toThrow(/inside the repository/);
  expect(() => assertOutsideRepo(join(repo, "not-yet", "dir", "a.conf"), repo)).toThrow(/inside the repository/);
  expect(() => assertOutsideRepo(join(tmpdir(), "aphrody.conf"), repo)).not.toThrow();
});

test("wg-client refuses to write a conf into the repository and writes it outside", async () => {
  const keyDir = mkdtempSync(join(tmpdir(), "wg-key-"));
  const keyFile = join(keyDir, "private.key");
  writeFileSync(keyFile, newKey(), { mode: 0o600 });
  const run = async (out: string) => {
    const p = Bun.spawn(
      [
        "bun",
        join(repo, "packages/engine/core/src/host/cli.ts"),
        "wg-client",
        "aphro-pc",
        "--format",
        "conf",
        "--hub-public-key",
        newKey(),
        "--private-key-file",
        keyFile,
        "--out",
        out,
      ],
      {
        windowsHide: true,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, YOLO_ROOT: repo },
      },
    );
    return { code: await p.exited, err: await new Response(p.stderr).text() };
  };
  const inside = join(repo, "tools", "config", "host", "should-not-exist.conf");
  const refused = await run(inside);
  expect(refused.code).toBe(1);
  expect(refused.err).toContain("inside the repository");
  expect(existsSync(inside)).toBe(false);
  const dir = mkdtempSync(join(tmpdir(), "wg-out-"));
  try {
    const ok = await run(join(dir, "aphrody.conf"));
    expect(ok.code).toBe(0);
    expect(readFileSync(join(dir, "aphrody.conf"), "utf8")).toContain("PrivateKey = ");
  } finally {
    rmSync(dir, { recursive: true });
    rmSync(keyDir, { recursive: true });
  }
});

test("hub config: known keys inline, the others are apply-time inputs, no private key", () => {
  const h = hubConfig(unappliedTunnel());
  expect(h.text).toContain("ListenPort = 51821");
  expect(h.text).toContain("Address = 10.200.77.1/24");
  expect(h.text).toContain("PublicKey = VewVolGGwY3Lvp78jp9dKB7RIxg2xUR2pbVS+y+uj2I=");
  expect(h.text).toContain("AllowedIPs = 10.200.77.10/32");
  expect(h.needs.map(n => n.env)).toEqual(["WSL_PUBLIC_KEY", "DBFR_PUBLIC_KEY"]);
  expect(h.text).toContain("PublicKey = EXfatxgVFs8Lr9k7QoJ2wiznY5MYO4C19+4gLbGmCEw=");
  expect(PRIVATE_KEY_PATTERN.test(h.text)).toBe(false);
  expect(h.text).not.toMatch(/AllowedIPs = [^\n]*\/(0|2[0-3])\b/);
});

test("ufw rules: specific sources, own marker, nothing for postgres, redis or the pending training ports", () => {
  const t = tunnel();
  const rules = ufwRules(t);
  expect(rules.length).toBeGreaterThan(0);
  for (const r of rules) {
    expect(r.text).toMatch(/comment 'aphrody-wg-[a-z-]+'$/);
    expect(r.text).not.toContain("shenron-admin");
    expect(r.text).not.toMatch(/Anywhere|from any\b|0\.0\.0\.0/);
    expect(r.text).not.toMatch(/port (5432|6379)\b/);
    if (r.text.includes("10.200.77.2 port")) expect(r.text).toContain("port 22 proto tcp"); // SSH is active; training remains pending
  }
  const udp = rules.filter(r => r.kind === "udp-source");
  // Omar's source is `open` since 2026-10-09 (dynamic public address): the hub rule is declared by hand, not generated.
  expect(udp.map(r => r.text)).toEqual([]);
  const omar = rules.filter(r => r.peer === "omar" && r.kind !== "udp-source").map(r => `${r.kind}:${r.service}`);
  expect(omar).toEqual([
    "input:ssh-vps",
    "route:ssh-dbfr",
    "route:ssh-wsl",
    "route:ssh-aphro-pc",
    "route:remote-desktop-aphro-pc",
    "route:vnc-aphro-pc",
    "route:mcp-http-aphro-pc",
    "route:remote-desktop-dbfr",
    "route:vnc-dbfr",
    "route:mesh:dev-pcs:aphro-pc",
    "input:mesh:pcs-to-build-hub:vps",
  ]);
  const mesh = rules.filter(r => r.service?.startsWith("mesh:"));
  expect(mesh.map(r => r.text)).toEqual([
    "ufw route allow in on wg1 out on wg1 from 10.200.77.4 to 10.200.77.10 comment 'aphrody-wg-aphro-pc'",
    "ufw route allow in on wg1 out on wg1 from 10.200.77.10 to 10.200.77.4 comment 'aphrody-wg-omar'",
    "ufw allow in on wg1 from 10.200.77.4 to 10.200.77.1 comment 'aphrody-wg-aphro-pc'",
    "ufw allow in on wg1 from 10.200.77.10 to 10.200.77.1 comment 'aphrody-wg-omar'",
    "ufw allow in on wg1 from 10.200.77.3 to 10.200.77.1 comment 'aphrody-wg-dbfr'",
    "ufw route allow in on wg1 out on wg1 from 10.200.77.3 to 10.200.77.4 comment 'aphrody-wg-dbfr'",
    "ufw route allow in on wg1 out on wg1 from 10.200.77.3 to 10.200.77.10 comment 'aphrody-wg-dbfr'",
  ]);
  // dbfr hosts PostgreSQL and Redis: no all-port rule ever targets it.
  expect(mesh.some(r => r.text.includes("to 10.200.77.3 "))).toBe(false);
  expect(
    rules
      .filter(r => r.kind === "route" && !r.service?.startsWith("mesh:"))
      .every(r =>
        /to 10\.200\.77\.(2 port (22|8793)|3 port (22|8793|5900|8795)|(4|10) port (22|5900|8793|8795)|10 port 2222) /.test(
          r.text,
        ),
      ),
  ).toBe(true);
  expect(rules.filter(r => r.peer === "dbfr" && !r.service?.startsWith("mesh:")).map(r => r.text)).toEqual([
    "ufw route allow in on wg1 out on wg1 from 10.200.77.3 to 10.200.77.4 port 22 proto tcp comment 'aphrody-wg-dbfr'",
    "ufw allow in on wg1 from 10.200.77.3 to 10.200.77.1 port 22 proto tcp comment 'aphrody-wg-dbfr'",
    "ufw route allow in on wg1 out on wg1 from 10.200.77.3 to 10.200.77.10 port 22 proto tcp comment 'aphrody-wg-dbfr'",
    "ufw route allow in on wg1 out on wg1 from 10.200.77.3 to 10.200.77.10 port 2222 proto tcp comment 'aphrody-wg-dbfr'",
  ]);
});

test("the plan carries no private key, names its inputs and repeats the shared ssh key findings", () => {
  const p = plan();
  expect(p.status).toBe("plan-only");
  expect(PRIVATE_KEY_PATTERN.test(JSON.stringify(p))).toBe(false);
  expect(new Set(p.steps.map(s => s.id)).size).toBe(p.steps.length);
  expect(p.steps.find(s => s.id === "vps.hub-conf")?.needs).toEqual(["WSL_PUBLIC_KEY", "DBFR_PUBLIC_KEY"]);
  expect(p.steps.find(s => s.id === "dbfr.conf")?.needs).toEqual(["HUB_PUBLIC_KEY"]);
  for (const host of ["vps", "dbfr"]) {
    const keys = p.steps.find(s => s.id === `${host}.account.omar.keys`)!;
    expect(keys.kind).toBe("mutate");
    expect(keys.run).toContain("/etc/ssh/authorized_keys.d/omar");
  }
  expect(p.decisions.join("\n")).toMatch(/omar: omar's ssh key is the same key pair as ~\/\.ssh\/id_ed25519\.pub/);
  expect(p.decisions.join("\n")).toMatch(/also a line of \/home\/ubuntu\/\.ssh\/authorized_keys on dbfr/);
  expect(p.decisions.join("\n")).toMatch(/recommendation: a distinct ssh key for omar/);
  const shared = p.steps.filter(s => s.id.includes("key-not-on-other-logins"));
  expect(shared.map(s => s.host).toSorted()).toEqual(["dbfr", "vps"]);
  for (const s of shared) {
    expect(s.kind).toBe("warn");
    expect(s.run).toContain("AAAAC3NzaC1lZDI1NTE5AAAAIJvmGjMWPLFJZWsACxRqCC0Ll+uXvnyunYdPG4E8jS4V");
    expect(s.run).toContain("/home/ubuntu/.ssh/authorized_keys");
  }
  expect(p.pending.join("\n")).not.toMatch(/omar/);
  expect(p.pending.join("\n")).toMatch(/hub: wg1 public key/);
  expect(p.pending.join("\n")).toMatch(/training/);
  expect(p.clients.omar!.peer).toContain("AllowedIPs = 10.200.77.0/24");
  expect(p.clients["aphro-pc"]!.pasteBlock.startsWith("Address = 10.200.77.4/32")).toBe(true);
  // every mutation is a root shell script that fails fast; the key is read from the host file, never inlined
  for (const s of p.steps.filter(x => x.kind === "mutate" && x.run))
    if (s.run!.includes("PrivateKey")) expect(s.run).toContain('"$(cat /etc/wireguard/wg1.key)"');
  const dbfr = p.steps.filter(s => s.host === "dbfr").map(s => s.id);
  expect(dbfr).toContain("dbfr.account.omar.pg-no-group");
  expect(dbfr).toContain("dbfr.account.omar.pg-direct");
  expect(p.steps.filter(s => s.host === "dbfr" && s.run?.includes("ufw allow"))).toHaveLength(3);
});

test("observe runs only read-only preflight steps, never a mutation", async () => {
  const p = plan();
  const ran: string[] = [];
  const result = await observePlan(p, async (_host, command) => {
    ran.push(command);
    return { code: 0, stdout: "", stderr: "" };
  });
  expect(ran.length).toBeGreaterThan(10);
  const mutations = new Set(p.steps.filter(s => s.kind === "mutate").map(s => s.run));
  for (const command of ran) expect(mutations.has(command)).toBe(false);
  for (const id of result.keys()) {
    const step = p.steps.find(s => s.id === id)!;
    expect(READ_ONLY.has(step.kind)).toBe(true);
    expect(step.phase).toBe("preflight");
  }
});

test("the omar account files: no key invented, root-owned key file, one sudoers rule, key-only sshd", () => {
  const keys = readFileSync(join(root, "ssh/omar.authorized_keys"), "utf8");
  const lines = keys.split("\n").filter(l => l.trim() && !l.trim().startsWith("#"));
  expect(lines).toEqual([
    'from="92.170.252.46,10.200.77.0/24",restrict,pty,port-forwarding,permitlisten="127.0.0.1:22010",permitlisten="127.0.0.1:28795",permitlisten="127.0.0.1:28793",permitlisten="127.0.0.1:22011",permitlisten="127.0.0.1:25900" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJvmGjMWPLFJZWsACxRqCC0Ll+uXvnyunYdPG4E8jS4V omar (supplied comment: windows-aphro)',
  ]);
  expect(keys).toContain("shared pair");
  expect(catalog.accounts![0]!.findings?.join("\n")).toMatch(/same key pair as ~\/\.ssh\/id_ed25519\.pub/);
  const sudoers = readFileSync(join(root, "sudoers/omar"), "utf8");
  expect(sudoers.split("\n").filter(l => l.trim() && !l.startsWith("#"))).toEqual([
    "Defaults:omar use_pty",
    "omar ALL=(ALL:ALL) NOPASSWD: ALL",
  ]);
  const visudo = Bun.which("visudo");
  if (visudo)
    expect(
      Bun.spawnSync([visudo, "-c", "-f", join(root, "sudoers/omar")], {
        windowsHide: true,
      }).exitCode,
    ).toBe(0);
  const sshd = readFileSync(join(root, "ssh/omar-sshd.conf"), "utf8");
  for (const line of [
    "Match User omar",
    "AuthenticationMethods publickey",
    "PasswordAuthentication no",
    "AllowTcpForwarding yes",
    "PermitListen 127.0.0.1:22010 127.0.0.1:28795 127.0.0.1:28793 127.0.0.1:22011 127.0.0.1:25900",
    "PermitOpen 127.0.0.1:23888 127.0.0.1:23889",
    "GatewayPorts no",
    "AuthorizedKeysFile /etc/ssh/authorized_keys.d/%u",
  ])
    expect(sshd).toContain(line);
  const pg = readFileSync(join(root, "ssh/postgres-no-login-sshd.conf"), "utf8");
  expect(pg).toMatch(/^DenyUsers postgres$/m);
  expect(catalog.accounts![0]!.groups).toEqual([]);
  expect(catalog.accounts![0]!.sshdDropIns.find(d => d.file.includes("postgres"))?.hosts).toEqual(["dbfr"]);
});

test("account checks reject an unrestricted key, a wrong source, a group grant and a missing postgres guard", () => {
  const dir = mkdtempSync(join(tmpdir(), "wg-acct-"));
  try {
    for (const sub of ["ssh", "sudoers"]) mkdirSync(join(dir, sub));
    for (const f of [
      "ssh/omar-sshd.conf",
      "ssh/postgres-no-login-sshd.conf",
      "sudoers/omar",
      "ssh/omar.authorized_keys",
    ])
      cpSync(join(root, f), join(dir, f));
    const acct = () => structuredClone(catalog.accounts!);
    expect(accountProblems(dir, acct(), tunnel())).toEqual([]);
    const blob = `AAAAC3NzaC1lZDI1NTE5AAAAI${"A".repeat(43)}`;
    const keyFile = (line: string) => writeFileSync(join(dir, "ssh/omar.authorized_keys"), `# c\n${line}\n`);
    keyFile(`ssh-ed25519 ${blob} omar`);
    expect(accountProblems(dir, acct(), tunnel()).join("\n")).toMatch(/not "options type key/);
    keyFile(`restrict ssh-ed25519 ${blob} omar`);
    expect(accountProblems(dir, acct(), tunnel()).join("\n")).toMatch(/without from=/);
    keyFile(`from="1.2.3.4",restrict ssh-ed25519 ${blob} omar`);
    expect(accountProblems(dir, acct(), tunnel()).join("\n")).toMatch(/from=1\.2\.3\.4 is not in allowedFrom/);
    keyFile(`from="92.170.252.46",pty ssh-ed25519 ${blob} omar`);
    expect(accountProblems(dir, acct(), tunnel()).join("\n")).toMatch(/without restrict/);
    keyFile(`from="92.170.252.46,10.200.77.0/24",restrict,pty ssh-ed25519 ${blob} omar`);
    expect(accountProblems(dir, acct(), tunnel())).toEqual([]);
    writeFileSync(join(dir, "ssh/omar.authorized_keys"), `-----BEGIN OPENSSH PRIVATE KEY-----\n`);
    expect(accountProblems(dir, acct(), tunnel()).join("\n")).toMatch(/private key material/);
    cpSync(join(root, "ssh/omar.authorized_keys"), join(dir, "ssh/omar.authorized_keys"));
    const grouped = acct();
    grouped[0]!.groups = ["postgres"];
    expect(accountProblems(dir, grouped, tunnel()).join("\n")).toMatch(/no postgres, docker, sudo or adm group/);
    writeFileSync(join(dir, "sudoers/omar"), "omar ALL=(ALL:ALL) NOPASSWD: ALL\n%admin ALL=(ALL) ALL\n");
    expect(accountProblems(dir, acct(), tunnel()).join("\n")).toMatch(/exactly one rule|must not grant a group/);
    cpSync(join(root, "sudoers/omar"), join(dir, "sudoers/omar"));
    writeFileSync(join(dir, "ssh/postgres-no-login-sshd.conf"), "# empty\n");
    expect(accountProblems(dir, acct(), tunnel()).join("\n")).toMatch(/denies the postgres login/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("the tunnel forwarder units bind the hub address only and compose from the catalog", () => {
  const t = tunnel();
  const socket = composeUnit("aphrody-wg-proxy@.socket", root);
  expect(socket).toContain(`ListenStream=${t.hub.address}:%i`);
  expect(socket).toContain("FreeBind=true");
  expect(socket).not.toMatch(/ListenStream=(0\.0\.0\.0|\[::\]|\d+\s)/);
  const service = composeUnit("aphrody-wg-proxy@.service", root);
  expect(service).toContain("ExecStart=/usr/lib/systemd/systemd-socket-proxyd");
  expect(service).toContain("127.0.0.1:%i");
  expect(service).toContain("IPAddressDeny=any");
  expect(service).toContain("IPAddressAllow=127.0.0.0/8 10.200.77.0/24");
  expect(service).toContain("DynamicUser=yes");
  expect(service).toContain("NoNewPrivileges=true");
  const proxied = t.services.filter(s => s.expose === "socket-proxyd").map(s => s.port);
  expect(proxied).toEqual([8793, 8788, 8793]);
  const mcp = t.services.find(s => s.id === "mcp-http")!;
  expect(mcp.upstream).toBe("127.0.0.1:8793");
  expect(mcp.auth).toBe("bearer-token");
  expect(t.grants.dbfr).toContain("mcp-http");
  const verify = plan().steps.find(s => s.id === "vps.systemd-verify")!;
  expect(verify.run).toContain("@8793.socket");
  expect(verify.run).not.toContain("@8789.socket");
});

test("peer MCP projections bind the actual host and grant only private sources", () => {
  const p = plan();
  const socket = p.steps.find(step => step.id === "dbfr.proxy-unit.socket")!;
  const encoded = socket.run!.match(/echo ([A-Za-z0-9+/=]+)/)![1]!;
  const text = Buffer.from(encoded, "base64").toString();
  expect(text).toContain("ListenStream=10.200.77.3:%i");
  expect(text).not.toContain("ListenStream=10.200.77.1:%i");
  expect(text).not.toMatch(/ListenStream=(0\.0\.0\.0|\[::\])/);
  const inputs = p.steps.filter(step => step.id.startsWith("dbfr.proxy-ufw."));
  expect(inputs).toHaveLength(3);
  for (const step of inputs) {
    expect(step.run).toContain("in on wg1");
    expect(step.run).toContain("to 10.200.77.3 port 8793");
    expect(step.run).not.toContain("from any");
    expect(step.run).not.toContain("omar");
  }
  expect(inputs.some(step => step.run!.includes("from 10.200.77.1"))).toBe(true);
  const start = p.steps.find(step => step.id === "dbfr.proxy-start")!;
  expect(start.run).toContain("aphrody-wg-proxy@8793.socket");
  const tmp = scratch(() => {});
  try {
    const t = loadTunnel(tmp);
    t.services.find(service => service.id === "mcp-http-dbfr")!.address = "10.200.77.1";
    writeFileSync(join(tmp, "wireguard/aphrody-tunnel.json"), JSON.stringify(t));
    expect(tunnelProblems(tmp).join("\n")).toContain("declared owner address");
  } finally {
    rmSync(tmp, { recursive: true });
  }
});

test("no private key material anywhere in the declared tunnel and account files", () => {
  for (const f of [
    "wireguard/aphrody-tunnel.json",
    "ssh/omar.authorized_keys",
    "ssh/omar-sshd.conf",
    "ssh/postgres-no-login-sshd.conf",
    "sudoers/omar",
    "inventory/private-tunnel-2026-10-06.json",
    "systemd/aphrody/aphrody-wg-proxy@.service",
    "systemd/aphrody/aphrody-wg-proxy@.socket",
  ])
    expect({
      f,
      hit: PRIVATE_KEY_PATTERN.test(readFileSync(join(root, f), "utf8")),
    }).toEqual({
      f,
      hit: false,
    });
});
