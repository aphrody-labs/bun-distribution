// SPDX-License-Identifier: Apache-2.0
// install.ps1 under PowerShell 7 against a local release: `all` installs the published plugin, skips what is not
// published and registers the plugin in Claude Code through a stub `claude`. Skipped when pwsh is absent.
import { afterAll, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "../install.ps1");
const pwsh = Bun.which("pwsh");
const work = mkdtempSync(join(tmpdir(), "install-ps1-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

test.skipIf(!pwsh)(
  "`all` installs the published plugin, skips the rest and registers it",
  async () => {
    const site = mkdtempSync(join(work, "site-"));
    const pinned = join(site, "releases", "fixture-release");
    mkdirSync(pinned, { recursive: true });
    writeFileSync(
      join(site, "latest.json"),
      JSON.stringify({ release: { id: "fixture-release" } }),
    );
    mkdirSync(join(pinned, "files"), { recursive: true });
    const plugin = join(work, "plugin");
    mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
    writeFileSync(join(plugin, ".claude-plugin", "plugin.json"), '{"name":"aphrody"}');
    const file = "plugin-aphrody-2.2.0-abc-any-any.zip";
    Bun.spawnSync(["zip", "-q", "-r", join(pinned, "files", file), "."], { cwd: plugin });
    const sum = new Bun.CryptoHasher("sha256")
      .update(readFileSync(join(pinned, "files", file)))
      .digest("hex");
    writeFileSync(join(pinned, "SHA256SUMS"), `${sum}  ${file}\n`);
    const server = Bun.serve({
      port: 0,
      fetch: (req) => new Response(Bun.file(join(site, new URL(req.url).pathname))),
    });
    const bin = join(work, "bin");
    mkdirSync(bin);
    const log = join(work, "claude.log");
    writeFileSync(join(bin, "claude"), `#!/bin/sh\necho "$@" >> ${log}\n`);
    chmodSync(join(bin, "claude"), 0o755);
    const home = join(work, "home");
    mkdirSync(home);
    try {
      const proc = Bun.spawn([pwsh!, "-NoProfile", "-File", script], {
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          HOME: home,
          USERPROFILE: home,
          APHRODY_DOWNLOAD_URL: `http://127.0.0.1:${server.port}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(err).toBe("");
      expect(code).toBe(0);
      expect(out).toContain("skipped: no aphrody build");
      expect(out).toContain("skipped: the desktop app is not published");
      const calls = readFileSync(log, "utf8").trim().split("\n");
      expect(calls[0]).toStartWith("plugin marketplace add ");
      expect(calls[1]).toBe("plugin install aphrody@aphrody-local --scope user");
      const root = calls[0]!.split(" ")[3]!;
      expect(existsSync(join(root, "plugin-aphrody", ".claude-plugin", "plugin.json"))).toBe(true);
      const market = JSON.parse(
        readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"),
      );
      expect(market.plugins).toEqual([{ name: "aphrody", source: "./plugin-aphrody" }]);
    } finally {
      server.stop(true);
    }
  },
  60_000,
);

for (const canonical of [true, false]) {
  test.skipIf(!pwsh)(
    `PowerShell MCP uses ${canonical ? "aphrody-mcp" : "aphrody mcp-server"} from one immutable release`,
    async () => {
      const site = mkdtempSync(join(work, "mcp-site-"));
      const pinned = join(site, "releases", "fixture-release");
      mkdirSync(pinned, { recursive: true });
      writeFileSync(
        join(site, "latest.json"),
        JSON.stringify({ release: { id: "fixture-release" } }),
      );
      writeFileSync(join(pinned, "SHA256SUMS"), "");
      const requests: string[] = [];
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const path = new URL(req.url).pathname;
          requests.push(path);
          return new Response(Bun.file(join(site, path)));
        },
      });
      const bin = mkdtempSync(join(work, "mcp-bin-"));
      const log = join(bin, "claude.log");
      const executable = canonical ? "aphrody-mcp" : "aphrody";
      for (const [name, body] of [
        [executable, "exit 0"],
        ["claude", `echo "$@" >> '${log}'`],
      ]) {
        writeFileSync(join(bin, name!), `#!/bin/sh\n${body}\n`);
        chmodSync(join(bin, name!), 0o755);
      }
      try {
        const proc = Bun.spawn([pwsh!, "-NoProfile", "-File", script], {
          env: {
            PATH: `${bin}:/usr/bin:/bin`,
            HOME: bin,
            USERPROFILE: bin,
            APHRODY_COMPONENTS: "mcp",
            APHRODY_DOWNLOAD_URL: `http://127.0.0.1:${server.port}`,
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const err = await new Response(proc.stderr).text();
        expect(err).toBe("");
        expect(await proc.exited).toBe(0);
        expect(requests).toEqual(["/latest.json", "/releases/fixture-release/SHA256SUMS"]);
        expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
          "mcp remove aphrody --scope user",
          `mcp add --scope user aphrody -- ${join(bin, executable)}${canonical ? "" : " mcp-server"}`,
        ]);
      } finally {
        server.stop(true);
      }
    },
    60_000,
  );
}

test.skipIf(!pwsh)(
  "PowerShell rejects archive links and preserves the installed plugin",
  async () => {
    const site = mkdtempSync(join(work, "unsafe-site-"));
    const pinned = join(site, "releases", "fixture-release");
    mkdirSync(join(pinned, "files"), { recursive: true });
    const payload = mkdtempSync(join(work, "unsafe-plugin-"));
    Bun.spawnSync(["ln", "-s", "/tmp/aphrody-escape", join(payload, "escape")]);
    const file = "plugin-yolo-unsafe-any-any.zip";
    const archive = join(pinned, "files", file);
    Bun.spawnSync(["zip", "-q", "-y", archive, "escape"], { cwd: payload });
    writeFileSync(
      join(pinned, "SHA256SUMS"),
      `${new Bun.CryptoHasher("sha256").update(readFileSync(archive)).digest("hex")}  ${file}\n`,
    );
    const prefix = mkdtempSync(join(work, "active-plugin-"));
    const dest = join(prefix, "share", "aphrody", "plugins", "plugin-yolo");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "sentinel"), "original");
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        requests.push(path);
        return new Response(Bun.file(join(site, path)));
      },
    });
    try {
      const proc = Bun.spawn([pwsh!, "-NoProfile", "-File", script], {
        env: {
          PATH: "/usr/bin:/bin",
          HOME: prefix,
          USERPROFILE: prefix,
          APHRODY_PREFIX: prefix,
          APHRODY_COMPONENTS: "plugin-yolo",
          APHRODY_RELEASE: "fixture-release",
          APHRODY_DOWNLOAD_URL: `http://127.0.0.1:${server.port}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await new Response(proc.stderr).text()).toContain("unsafe archive entry");
      expect(await proc.exited).toBe(1);
      expect(readFileSync(join(dest, "sentinel"), "utf8")).toBe("original");
      expect(existsSync(`${dest}.new`)).toBe(false);
      expect(requests).not.toContain("/latest.json");
    } finally {
      server.stop(true);
    }
  },
  60_000,
);
