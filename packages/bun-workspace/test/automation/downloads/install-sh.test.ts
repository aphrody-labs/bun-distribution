// SPDX-License-Identifier: Apache-2.0
// install.sh against a local release: `all` installs what is published, skips the rest with a note, writes the
// local Claude Code marketplace and declares the MCP server through a stub `claude` (never the real one).
import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "../../../assets/downloads/install-full.sh");
const work = mkdtempSync(join(tmpdir(), "install-sh-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
// install.sh installs Linux/macOS builds only (it refuses other kernels and points Windows to install.ps1, covered
// by install-ps1.test.ts), so its installation scenarios run on POSIX hosts.
const posixTest = process.platform === "win32" ? test.skip : test;

async function release(): Promise<string> {
  const site = mkdtempSync(join(work, "site-"));
  const pinned = join(site, "releases", "fixture-release");
  mkdirSync(pinned, { recursive: true });
  writeFileSync(join(site, "latest.json"), JSON.stringify({ release: { id: "fixture-release" } }));
  mkdirSync(join(pinned, "files"), { recursive: true });
  const plugin = join(work, "plugin");
  mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
  writeFileSync(join(plugin, ".claude-plugin", "plugin.json"), '{"name":"yolo"}');
  const file = "plugin-yolo-2.2.1-abc-any-any.tar.gz";
  Bun.spawnSync(["tar", "-czf", join(pinned, "files", file), "-C", plugin, "."]);
  const sum = new Bun.CryptoHasher("sha256").update(readFileSync(join(pinned, "files", file))).digest("hex");
  writeFileSync(join(pinned, "SHA256SUMS"), `${sum}  ${file}\n`);
  return site;
}

posixTest("`all` installs the published plugins, skips the rest and registers them in Claude Code", async () => {
  const site = await release();
  const server = Bun.serve({
    port: 0,
    fetch: req => new Response(Bun.file(join(site, new URL(req.url).pathname))),
  });
  const bin = join(work, "bin");
  mkdirSync(bin);
  const log = join(work, "claude.log");
  writeFileSync(join(bin, "claude"), `#!/bin/sh\necho "$@" >> ${log}\n`);
  chmodSync(join(bin, "claude"), 0o755);
  const home = join(work, "home");
  mkdirSync(home);
  try {
    const proc = Bun.spawn(["sh", script], {
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: home,
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
    expect(out).toContain("skipped: aphrody is not installed");
    const root = join(home, ".local", "share", "aphrody", "plugins");
    expect(readFileSync(join(root, "plugin-yolo", ".claude-plugin", "plugin.json"), "utf8")).toContain("yolo");
    const market = JSON.parse(readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"));
    expect(market.plugins).toEqual([{ name: "yolo", source: "./plugin-yolo" }]);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
      `plugin marketplace add ${root} --scope user`,
      "plugin install yolo@aphrody-local --scope user",
    ]);
  } finally {
    server.stop(true);
  }
});

posixTest("a component named explicitly must install", async () => {
  const site = await release();
  const server = Bun.serve({
    port: 0,
    fetch: req => new Response(Bun.file(join(site, new URL(req.url).pathname))),
  });
  try {
    const proc = Bun.spawn(["sh", script], {
      env: {
        PATH: "/usr/bin:/bin",
        HOME: join(work, "home2"),
        APHRODY_DOWNLOAD_URL: `http://127.0.0.1:${server.port}`,
        APHRODY_COMPONENTS: "aphrody",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await proc.exited).toBe(1);
    expect(await new Response(proc.stderr).text()).toContain("no aphrody build");
  } finally {
    server.stop(true);
  }
});

for (const canonical of [true, false]) {
  posixTest(`MCP uses ${canonical ? "aphrody-mcp" : "aphrody mcp-server"} and one pinned release`, async () => {
    const site = await release();
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        requests.push(path);
        // Mutable endpoints must never be read after selecting the release.
        if (path === "/SHA256SUMS" || path.startsWith("/files/"))
          return new Response("release changed", { status: 409 });
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
      const proc = Bun.spawn(["sh", script], {
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          HOME: bin,
          APHRODY_DOWNLOAD_URL: `http://127.0.0.1:${server.port}`,
          APHRODY_COMPONENTS: "mcp",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await new Response(proc.stderr).text()).toBe("");
      expect(await proc.exited).toBe(0);
      expect(requests).toEqual(["/latest.json", "/releases/fixture-release/SHA256SUMS"]);
      expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
        "mcp remove aphrody --scope user",
        `mcp add --scope user aphrody -- ${join(bin, executable)}${canonical ? "" : " mcp-server"}`,
      ]);
    } finally {
      server.stop(true);
    }
  });
}

posixTest(
  "an explicit release bypasses latest and rejects archive links without replacing the active plugin",
  async () => {
    const site = await release();
    const pinned = join(site, "releases", "fixture-release");
    const plugin = mkdtempSync(join(work, "unsafe-plugin-"));
    Bun.spawnSync(["ln", "-s", "/tmp/aphrody-escape", join(plugin, "escape")]);
    const file = "plugin-yolo-unsafe-any-any.tar.gz";
    const archive = join(pinned, "files", file);
    Bun.spawnSync(["tar", "-czf", archive, "-C", plugin, "."]);
    const sum = new Bun.CryptoHasher("sha256").update(readFileSync(archive)).digest("hex");
    writeFileSync(join(pinned, "SHA256SUMS"), `${sum}  ${file}\n`);
    const prefix = mkdtempSync(join(work, "active-plugin-"));
    const dest = join(prefix, "share", "aphrody", "plugins", "plugin-yolo");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "sentinel"), "previous working plugin");
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
      const proc = Bun.spawn(["sh", script], {
        env: {
          PATH: "/usr/bin:/bin",
          HOME: prefix,
          APHRODY_PREFIX: prefix,
          APHRODY_COMPONENTS: "plugin-yolo",
          APHRODY_RELEASE: "fixture-release",
          APHRODY_DOWNLOAD_URL: `http://127.0.0.1:${server.port}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await new Response(proc.stderr).text()).toContain("archive links or special files are unsupported");
      expect(await proc.exited).toBe(1);
      expect(readFileSync(join(dest, "sentinel"), "utf8")).toBe("previous working plugin");
      expect(requests).not.toContain("/latest.json");
      expect(requests.every(path => path.startsWith("/releases/fixture-release/"))).toBe(true);
    } finally {
      server.stop(true);
    }
  },
);

posixTest("a failed binary probe preserves the installed release and cleans staging", async () => {
  const site = await release();
  const pinned = join(site, "releases", "fixture-release");
  const payload = mkdtempSync(join(work, "failed-binary-"));
  writeFileSync(join(payload, "aphrody"), "#!/bin/sh\nexit 1\n");
  chmodSync(join(payload, "aphrody"), 0o755);
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const os = process.platform === "darwin" ? "apple-darwin" : "unknown-linux-gnu";
  const file = `aphrody-broken-${arch}-${os}.tar.gz`;
  const archive = join(pinned, "files", file);
  Bun.spawnSync(["tar", "-czf", archive, "-C", payload, "."]);
  writeFileSync(
    join(pinned, "SHA256SUMS"),
    `${new Bun.CryptoHasher("sha256").update(readFileSync(archive)).digest("hex")}  ${file}\n`,
  );
  const prefix = mkdtempSync(join(work, "existing-binary-"));
  const dest = join(prefix, "lib", "aphrody", "aphrody-broken");
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "aphrody"), "original");
  const server = Bun.serve({
    port: 0,
    fetch: req => new Response(Bun.file(join(site, new URL(req.url).pathname))),
  });
  try {
    const proc = Bun.spawn(["sh", script], {
      env: {
        PATH: "/usr/bin:/bin",
        HOME: prefix,
        APHRODY_PREFIX: prefix,
        APHRODY_COMPONENTS: "aphrody",
        APHRODY_NO_LINKS: "1",
        APHRODY_DOWNLOAD_URL: `http://127.0.0.1:${server.port}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await new Response(proc.stderr).text()).toContain("downloaded aphrody does not run");
    expect(await proc.exited).toBe(1);
    expect(readFileSync(join(dest, "aphrody"), "utf8")).toBe("original");
    expect(existsSync(`${dest}.new`)).toBe(false);
  } finally {
    server.stop(true);
  }
});

posixTest("pinning an earlier release rolls the CLI link back without rebuilding", async () => {
  const site = mkdtempSync(join(work, "rollback-site-"));
  const prefix = mkdtempSync(join(work, "rollback-home-"));
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const os = process.platform === "darwin" ? "apple-darwin" : "unknown-linux-gnu";
  for (const version of ["first", "second"]) {
    const pinned = join(site, "releases", version);
    mkdirSync(join(pinned, "files"), { recursive: true });
    const payload = mkdtempSync(join(work, "rollback-payload-"));
    writeFileSync(
      join(payload, "aphrody"),
      `#!/bin/sh\nif [ "$1" = --version ]; then echo '${version}'; exit 0; fi\nif [ "$1" = self ]; then mkdir -p "$HOME/.local/bin"; ln -sf "$4" "$HOME/.local/bin/aphrody"; exit 0; fi\nexit 1\n`,
    );
    chmodSync(join(payload, "aphrody"), 0o755);
    const file = `aphrody-${version}-${arch}-${os}.tar.gz`;
    const archive = join(pinned, "files", file);
    Bun.spawnSync(["tar", "-czf", archive, "-C", payload, "."]);
    writeFileSync(
      join(pinned, "SHA256SUMS"),
      `${new Bun.CryptoHasher("sha256").update(readFileSync(archive)).digest("hex")}  ${file}\n`,
    );
  }
  const server = Bun.serve({
    port: 0,
    fetch: req => new Response(Bun.file(join(site, new URL(req.url).pathname))),
  });
  try {
    for (const version of ["first", "second", "first"]) {
      const proc = Bun.spawn(["sh", script], {
        env: {
          PATH: "/usr/bin:/bin",
          HOME: prefix,
          APHRODY_PREFIX: prefix,
          APHRODY_COMPONENTS: "aphrody",
          APHRODY_RELEASE: version,
          APHRODY_DOWNLOAD_URL: `http://127.0.0.1:${server.port}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      // Upgrade and rollback share one installation, so activation must be serialized.
      // eslint-disable-next-line no-await-in-loop
      expect(await new Response(proc.stderr).text()).toBe("");
      // eslint-disable-next-line no-await-in-loop
      expect(await proc.exited).toBe(0);
      const probe = Bun.spawnSync([join(prefix, ".local", "bin", "aphrody"), "--version"]);
      expect(probe.stdout.toString().trim()).toBe(version);
    }
  } finally {
    server.stop(true);
  }
});

test.skipIf(process.platform !== "win32" || !Bun.which("sh"))(
  "on Windows the POSIX installer refuses and points to install.ps1",
  async () => {
    const proc = Bun.spawn(["sh", script], {
      env: { ...process.env, APHRODY_DOWNLOAD_URL: "http://127.0.0.1:9" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await new Response(proc.stderr).text()).toContain("install.ps1");
    expect(await proc.exited).toBe(1);
  },
);
