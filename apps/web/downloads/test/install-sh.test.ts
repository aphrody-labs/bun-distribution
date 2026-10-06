// SPDX-License-Identifier: Apache-2.0
// install.sh against a local release: `all` installs what is published, skips the rest with a note, writes the
// local Claude Code marketplace and declares the MCP server through a stub `claude` (never the real one).
import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "../install.sh");
const work = mkdtempSync(join(tmpdir(), "install-sh-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

async function release(): Promise<string> {
  const site = join(work, "site");
  mkdirSync(join(site, "files"), { recursive: true });
  const plugin = join(work, "plugin");
  mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
  writeFileSync(join(plugin, ".claude-plugin", "plugin.json"), '{"name":"yolo"}');
  const file = "plugin-yolo-2.2.1-abc-any-any.tar.gz";
  Bun.spawnSync(["tar", "-czf", join(site, "files", file), "-C", plugin, "."]);
  const sum = new Bun.CryptoHasher("sha256")
    .update(readFileSync(join(site, "files", file)))
    .digest("hex");
  writeFileSync(join(site, "SHA256SUMS"), `${sum}  ${file}\n`);
  return site;
}

test("`all` installs the published plugins, skips the rest and registers them in Claude Code", async () => {
  const site = await release();
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
    expect(
      readFileSync(join(root, "plugin-yolo", ".claude-plugin", "plugin.json"), "utf8"),
    ).toContain("yolo");
    const market = JSON.parse(
      readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"),
    );
    expect(market.plugins).toEqual([{ name: "yolo", source: "./plugin-yolo" }]);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
      `plugin marketplace add ${root} --scope user`,
      "plugin install yolo@aphrody-local --scope user",
    ]);
  } finally {
    server.stop(true);
  }
});

test("a component named explicitly must install", async () => {
  const site = await release();
  const server = Bun.serve({
    port: 0,
    fetch: (req) => new Response(Bun.file(join(site, new URL(req.url).pathname))),
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
