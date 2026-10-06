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
    const site = join(work, "site");
    mkdirSync(join(site, "files"), { recursive: true });
    const plugin = join(work, "plugin");
    mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
    writeFileSync(join(plugin, ".claude-plugin", "plugin.json"), '{"name":"aphrody"}');
    const file = "plugin-aphrody-2.2.0-abc-any-any.zip";
    Bun.spawnSync(["zip", "-q", "-r", join(site, "files", file), "."], { cwd: plugin });
    const sum = new Bun.CryptoHasher("sha256")
      .update(readFileSync(join(site, "files", file)))
      .digest("hex");
    writeFileSync(join(site, "SHA256SUMS"), `${sum}  ${file}\n`);
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
