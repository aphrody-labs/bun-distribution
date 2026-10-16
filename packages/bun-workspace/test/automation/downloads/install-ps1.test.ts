// SPDX-License-Identifier: Apache-2.0
// install.ps1 under PowerShell 7 against a local release: `all` installs the published plugin, skips what is not
// published and registers the plugin in Claude Code through a stub `claude` (.cmd on Windows). Skipped when pwsh is absent.
import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const script = resolve(import.meta.dir, "../../../assets/downloads/install-full.ps1");
const pwsh = Bun.which("pwsh");
const work = mkdtempSync(join(tmpdir(), "install-ps1-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const windows = process.platform === "win32";
// Windows keeps System32 off PATH: a host install drops aphrody*.exe there and would shadow the stubs.
const systemPath = windows ? "" : "/usr/bin:/bin";

/** Environment for the installer: Windows .NET networking and temp files need the system variables. */
function installerEnv(path: string, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {
    PATH: [path, systemPath].filter(Boolean).join(delimiter),
    ...extra,
  };
  if (windows)
    for (const name of [
      "SystemRoot",
      "WINDIR",
      "ComSpec",
      "PATHEXT",
      "TEMP",
      "TMP",
      "LOCALAPPDATA",
      "APPDATA",
      "ProgramFiles",
      "PSModulePath",
    ])
      if (process.env[name]) env[name] = process.env[name]!;
  return env;
}

/** A command stub: a POSIX shell script, or a .cmd batch file where PowerShell resolves PATHEXT. */
function stub(bin: string, name: string, kind: "ok" | { log: string }): string {
  if (windows) {
    const path = join(bin, `${name}.cmd`);
    writeFileSync(path, kind === "ok" ? "@exit /b 0\r\n" : `@>>"${kind.log}" echo %*\r\n`);
    return path;
  }
  const path = join(bin, name);
  const body = kind === "ok" ? "exit 0" : `echo "$@" >> '${kind.log}'`;
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** A stored (uncompressed) ZIP written in-process, so no `zip` binary is needed; `link` marks a Unix symlink. */
function storedZip(entries: { name: string; data: string; link?: boolean }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const data = new TextEncoder().encode(entry.data);
    const crc = Bun.hash.crc32(data);
    const local = new DataView(new ArrayBuffer(30 + name.length + data.length));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    const localBytes = new Uint8Array(local.buffer);
    localBytes.set(name, 30);
    localBytes.set(data, 30 + name.length);
    const central = new DataView(new ArrayBuffer(46 + name.length));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, (3 << 8) | 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(14, 0x21, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(38, ((entry.link ? 0o120777 : 0o100644) << 16) >>> 0, true);
    central.setUint32(42, offset, true);
    new Uint8Array(central.buffer).set(name, 46);
    locals.push(localBytes);
    centrals.push(new Uint8Array(central.buffer));
    offset += localBytes.length;
  }
  const directorySize = centrals.reduce((total, part) => total + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return Buffer.concat([...locals, ...centrals, new Uint8Array(end.buffer)]);
}

test.skipIf(!pwsh)(
  "`all` installs the published plugin, skips the rest and registers it",
  async () => {
    const site = mkdtempSync(join(work, "site-"));
    const pinned = join(site, "releases", "fixture-release");
    mkdirSync(pinned, { recursive: true });
    writeFileSync(join(site, "latest.json"), JSON.stringify({ release: { id: "fixture-release" } }));
    mkdirSync(join(pinned, "files"), { recursive: true });
    const file = "plugin-aphrody-2.2.0-abc-any-any.zip";
    writeFileSync(
      join(pinned, "files", file),
      storedZip([{ name: ".claude-plugin/plugin.json", data: '{"name":"aphrody"}' }]),
    );
    const sum = new Bun.CryptoHasher("sha256").update(readFileSync(join(pinned, "files", file))).digest("hex");
    writeFileSync(join(pinned, "SHA256SUMS"), `${sum}  ${file}\n`);
    const server = Bun.serve({
      port: 0,
      fetch: req => new Response(Bun.file(join(site, new URL(req.url).pathname))),
    });
    const bin = join(work, "bin");
    mkdirSync(bin);
    const log = join(work, "claude.log");
    stub(bin, "claude", { log });
    const home = join(work, "home");
    mkdirSync(home);
    try {
      const proc = Bun.spawn([pwsh!, "-NoProfile", "-File", script], {
        env: installerEnv(bin, {
          HOME: home,
          USERPROFILE: home,
          APHRODY_DOWNLOAD_URL: `http://127.0.0.1:${server.port}`,
        }),
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
      const calls = readFileSync(log, "utf8").trim().split(/\r?\n/);
      expect(calls[0]).toStartWith("plugin marketplace add ");
      expect(calls[1]).toBe("plugin install aphrody@aphrody-local --scope user");
      const root = calls[0]!.split(" ")[3]!;
      expect(existsSync(join(root, "plugin-aphrody", ".claude-plugin", "plugin.json"))).toBe(true);
      const market = JSON.parse(readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"));
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
      writeFileSync(join(site, "latest.json"), JSON.stringify({ release: { id: "fixture-release" } }));
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
      const stubPath = stub(bin, executable, "ok");
      stub(bin, "claude", { log });
      try {
        const proc = Bun.spawn([pwsh!, "-NoProfile", "-File", script], {
          env: installerEnv(bin, {
            HOME: bin,
            USERPROFILE: bin,
            APHRODY_COMPONENTS: "mcp",
            APHRODY_DOWNLOAD_URL: `http://127.0.0.1:${server.port}`,
          }),
          stdout: "pipe",
          stderr: "pipe",
        });
        const err = await new Response(proc.stderr).text();
        expect(err).toBe("");
        expect(await proc.exited).toBe(0);
        expect(requests).toEqual(["/latest.json", "/releases/fixture-release/SHA256SUMS"]);
        expect(readFileSync(log, "utf8").trim().split(/\r?\n/)).toEqual([
          "mcp remove aphrody --scope user",
          `mcp add --scope user aphrody -- ${stubPath}${canonical ? "" : " mcp-server"}`,
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
    const file = "plugin-yolo-unsafe-any-any.zip";
    const archive = join(pinned, "files", file);
    writeFileSync(archive, storedZip([{ name: "escape", data: "/tmp/aphrody-escape", link: true }]));
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
        env: installerEnv("", {
          HOME: prefix,
          USERPROFILE: prefix,
          APHRODY_PREFIX: prefix,
          APHRODY_COMPONENTS: "plugin-yolo",
          APHRODY_RELEASE: "fixture-release",
          APHRODY_DOWNLOAD_URL: `http://127.0.0.1:${server.port}`,
        }),
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
