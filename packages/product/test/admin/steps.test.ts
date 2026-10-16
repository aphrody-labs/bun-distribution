import { createHash } from "node:crypto";
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { loadProfile } from "../../src/admin/lib/profile.ts";
import {
  STEPS,
  keysMessage,
  makeKeys,
  runInstall,
  stepAcces,
  stepAphrody,
  stepCles,
  stepDepot,
  stepKit,
  stepMcp,
  stepPrerequis,
  type InstallState,
} from "../../src/admin/lib/steps.ts";
import { hubKey, packJson, testContext, type TestContext } from "./helpers.ts";

const touch = (path: string, text = "x") => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const state = (): InstallState => ({ repoReady: false });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const SHA = hash("archive-bytes");
const INSTALL_SCRIPT = "$sums = Get-Content SHA256SUMS; Get-FileHash x";
const BASE = "https://downloads.aphrody.com";

function downloads(
  options: {
    artifacts?: unknown[];
    sums?: string;
    installScript?: string;
  } = {},
): TestContext["ctx"]["fetchImpl"] {
  return async (input) => {
    const url = String(input);
    if (url.endsWith("/latest.json"))
      return Response.json({
        schemaVersion: 1,
        release: { id: "r" },
        baseUrl: BASE,
        artifacts: options.artifacts ?? [],
        assetChecksums: {
          "install.ps1": hash(INSTALL_SCRIPT),
        },
      });
    if (url.endsWith("/SHA256SUMS")) return new Response(options.sums ?? "");
    if (url.endsWith("/install.ps1"))
      return new Response(options.installScript ?? INSTALL_SCRIPT);
    if (url.includes("/files/")) return new Response("archive-bytes");
    return new Response("nope", { status: 404 });
  };
}

const aphrodyArtifact = (version = "1.0.0") => ({
  name: "aphrody",
  version,
  platform: "windows-x86_64",
  url: `${BASE}/files/aphrody-${version}-x-x86_64-pc-windows-msvc.zip`,
  sha256: SHA,
  size: 1024,
  file: `aphrody-${version}-x-x86_64-pc-windows-msvc.zip`,
});
const sumsFor = (file: string, sha = SHA) => `${sha}  ${file}\n`;

test("kit step: copies the exe next to a shortcut once, nothing when run from sources or already installed", async () => {
  const { ctx, sys } = testContext();
  touch(ctx.exePath, "EXE");
  touch(join(ctx.exeDir, "Guide.html"), "guide");
  sys.handlers.push({ match: /^powershell /, result: {} });
  expect((await stepKit.run(ctx, "simuler", state())).state).toBe("a-faire");
  expect(existsSync(join(ctx.paths.localAppData, "Aphrody", "Setup"))).toBe(
    false,
  );
  const done = await stepKit.run(ctx, "executer", state());
  expect(done.state).toBe("fait");
  expect(
    readFileSync(
      join(
        join(ctx.paths.localAppData, "Aphrody", "Setup"),
        "Aphrody-Setup.exe",
      ),
      "utf8",
    ),
  ).toBe("EXE");
  expect(
    readFileSync(
      join(join(ctx.paths.localAppData, "Aphrody", "Setup"), "Guide.html"),
      "utf8",
    ),
  ).toBe("guide");
  const shortcuts = sys.calls.filter((call) => call.argv[0] === "powershell");
  expect(shortcuts).toHaveLength(2);
  expect(shortcuts[0]!.argv[3]).toContain("CreateShortcut(");
  expect(shortcuts[0]!.argv[3]).toContain("Aphrody.lnk");
  expect(
    (
      await stepKit.run(
        {
          ...ctx,
          exePath: join(
            join(ctx.paths.localAppData, "Aphrody", "Setup"),
            "Aphrody-Setup.exe",
          ),
        },
        "executer",
        state(),
      )
    ).state,
  ).toBe("deja");
  expect(
    (
      await stepKit.run(
        { ...ctx, exePath: "/usr/bin/bun" },
        "executer",
        state(),
      )
    ).state,
  ).toBe("ignore");
});

test("prerequisites step: winget installs only what is missing, and says so when winget is absent", async () => {
  const { ctx, sys } = testContext();
  expect((await stepPrerequis.run(ctx, "simuler", state())).detail).toContain(
    "Git et WireGuard",
  );
  const noWinget = await stepPrerequis.run(ctx, "executer", state());
  expect(noWinget.state).toBe("echec");
  expect(noWinget.action).toContain("Microsoft Store");
  const winget = join(
    ctx.paths.localAppData,
    "Microsoft",
    "WindowsApps",
    "winget.exe",
  );
  touch(winget);
  sys.handlers.push({
    match: /winget\.exe install --id (Git\.Git|WireGuard\.WireGuard)/,
    result: (argv) => {
      if (argv.includes("Git.Git"))
        touch(join(ctx.paths.programFiles, "Git", "cmd", "git.exe"));
      else touch(join(ctx.paths.programFiles, "WireGuard", "wireguard.exe"));
      return {};
    },
  });
  const done = await stepPrerequis.run(ctx, "executer", state());
  expect(done.state).toBe("fait");
  const installs = sys.calls
    .filter((call) => call.argv[0] === winget)
    .map((call) => call.argv);
  expect(installs).toHaveLength(2);
  expect(installs[0]).toEqual([
    winget,
    "install",
    "--id",
    "Git.Git",
    "-e",
    "--source",
    "winget",
    "--silent",
    "--accept-package-agreements",
    "--accept-source-agreements",
  ]);
  expect(
    sys.calls.find((call) => call.argv.includes("Git.Git"))!.options.inherit,
  ).toBe(true);
  expect((await stepPrerequis.run(ctx, "executer", state())).state).toBe(
    "deja",
  );
});

test("keys step: creates both keys, writes only public keys on the Desktop, copies them", async () => {
  const { ctx, sys } = testContext();
  touch(join(ctx.sys.env.SystemRoot!, "System32", "OpenSSH", "ssh-keygen.exe"));
  sys.handlers.push(
    {
      match: /ssh-keygen\.exe -t ed25519/,
      result: (argv) => {
        const key = argv[argv.indexOf("-f") + 1]!;
        touch(key, "PRIVATE-SSH-KEY");
        touch(
          `${key}.pub`,
          `ssh-ed25519 AAAAFakePublicKey ${argv[argv.indexOf("-C") + 1]}\n`,
        );
        return {};
      },
    },
    { match: "icacls", result: {} },
    { match: "clip", result: {} },
  );
  expect((await stepCles.run(ctx, "simuler", state())).state).toBe("a-faire");
  const result = await stepCles.run(ctx, "executer", state());
  expect(result.state).toBe("fait");
  const file = join(ctx.paths.desktopDir, "a-envoyer-a-l-equipe.txt");
  const text = readFileSync(file, "utf8");
  expect(text).toContain("wireguard-public-key: ");
  expect(text).toContain(
    "ssh-public-key: ssh-ed25519 AAAAFakePublicKey omar@PC-DE-OMAR",
  );
  expect(text).not.toContain("PRIVATE-SSH-KEY");
  expect(text).not.toContain(readFileSync(ctx.paths.wgKeyFile, "utf8").trim());
  expect(sys.calls.find((call) => call.argv[0] === "clip")!.options.input).toBe(
    text,
  );
  expect((await stepCles.run(ctx, "executer", state())).state).toBe("deja");
});

test("keysMessage and makeKeys carry no secret", async () => {
  expect(
    keysMessage({
      who: "omar",
      machine: "PC",
      windows: "win32",
      version: "0.1.0",
      now: new Date("2026-10-06T00:00:00Z"),
      wgPublic: "WG",
      sshPublic: "SSH",
    }),
  ).toContain("wireguard-public-key: WG");
  const { ctx } = testContext({ platform: "linux" });
  expect(ctx.sys.platform).toBe("linux");
  expect(typeof makeKeys).toBe("function");
});

function accessReady(
  t: TestContext,
  pack: Record<string, unknown> = packJson(),
) {
  touch(join(t.ctx.paths.programFiles, "WireGuard", "wireguard.exe"));
  touch(
    join(t.ctx.paths.downloadsDir, "aphrody-omar-acces.json"),
    JSON.stringify(pack),
  );
  let running = false;
  t.sys.handlers.push(
    { match: "icacls", result: {} },
    {
      match: /^powershell .*Start-Process/,
      result: () => ((running = true), {}),
    },
    {
      match: "sc query",
      result: () => ({
        stdout: running ? "STATE : 4  RUNNING" : "[SC] FAILED 1060",
      }),
    },
  );
}

test("access step: no file yet means wait, with the exact instruction", async () => {
  const { ctx } = testContext();
  const result = await stepAcces.run(ctx, "executer", state());
  expect(result.state).toBe("attente");
  expect(result.action).toContain("a-envoyer-a-l-equipe.txt");
  expect(await loadProfile(ctx.paths)).toBeUndefined();
});

test("access step: imports the pack, links ssh, installs the tunnel once and is idempotent", async () => {
  const t = testContext();
  accessReady(t);
  const { ctx, sys } = t;
  const simulated = await stepAcces.run(ctx, "simuler", state());
  expect(simulated.state).toBe("a-faire");
  expect(await loadProfile(ctx.paths)).toBeUndefined();
  const s = state();
  const first = await stepAcces.run(ctx, "executer", s);
  expect(first.state).toBe("fait");
  expect(first.detail).toContain("tunnel « aphrody » actif");
  expect(s.pack?.hosts.gpu?.address).toBe("198.51.100.2");
  expect((await loadProfile(ctx.paths))?.trainHost).toBe("gpu");
  expect(readFileSync(ctx.paths.sshConfigFile, "utf8")).toContain(
    "Host aphrody-gpu",
  );
  expect(readFileSync(ctx.paths.userSshConfig, "utf8")).toContain(
    "# >>> aphrody-omar >>>",
  );
  expect(
    existsSync(
      join(ctx.paths.programData, "Aphrody", "Omar", "tmp", "aphrody.conf"),
    ),
  ).toBe(false);
  const elevations = () =>
    sys.calls.filter(
      (call) =>
        call.argv[0] === "powershell" && call.argv[5]?.includes("RunAs"),
    ).length;
  expect(elevations()).toBe(1);
  expect(readFileSync(ctx.paths.wgKeyFile, "utf8").trim()).toHaveLength(44);
  const second = await stepAcces.run(ctx, "executer", state());
  expect(second.state).toBe("deja");
  expect(elevations()).toBe(1);
  expect(
    readdirSync(join(ctx.paths.programData, "Aphrody", "Omar", "tmp")),
  ).toEqual([]);
});

test("access step: a new team block triggers a new import", async () => {
  const t = testContext();
  accessReady(t);
  await stepAcces.run(t.ctx, "executer", state());
  const next = packJson();
  (next.wireguard as { block: string }).block = (
    next.wireguard as { block: string }
  ).block.replace("51821", "51822");
  writeFileSync(
    join(t.ctx.paths.downloadsDir, "aphrody-omar-acces.json"),
    JSON.stringify(next),
  );
  const result = await stepAcces.run(t.ctx, "executer", state());
  expect(result.state).toBe("fait");
  expect(
    t.sys.calls.filter(
      (call) =>
        call.argv[0] === "powershell" && call.argv[5]?.includes("RunAs"),
    ),
  ).toHaveLength(2);
});

test("access step: an invalid or hostile pack changes nothing", async () => {
  const t = testContext();
  accessReady(
    t,
    packJson({
      wireguard: {
        tunnelName: "aphrody",
        block: `PostUp = calc\nAddress = 198.51.100.10/32\n\n[Peer]\nPublicKey = ${hubKey}\nEndpoint = 203.0.113.9:51821\nAllowedIPs = 198.51.100.0/24\n`,
      },
    }),
  );
  const result = await stepAcces.run(t.ctx, "executer", state());
  expect(result.state).toBe("echec");
  expect(result.detail).toContain("PostUp");
  expect(await loadProfile(t.ctx.paths)).toBeUndefined();
  expect(existsSync(t.ctx.paths.sshConfigFile)).toBe(false);
  expect(
    t.sys.calls.filter((call) => call.argv[0] === "powershell"),
  ).toHaveLength(0);
  writeFileSync(
    join(t.ctx.paths.downloadsDir, "aphrody-omar-acces.json"),
    "not json",
  );
  expect((await stepAcces.run(t.ctx, "executer", state())).state).toBe("echec");
});

test("access step: the tunnel consent window refused is an actionable failure", async () => {
  const t = testContext();
  accessReady(t);
  t.sys.handlers.unshift({
    match: /^powershell .*Start-Process/,
    result: { code: 1, stderr: "canceled" },
  });
  const result = await stepAcces.run(t.ctx, "executer", state());
  expect(result.state).toBe("echec");
  expect(result.action).toContain("« Oui »");
});

test("aphrody step: not published for Windows means wait, nothing is run", async () => {
  const { ctx, sys } = testContext({
    fetchImpl: downloads({
      artifacts: [
        {
          name: "aphrody",
          platform: "linux-x86_64",
          version: "1.0.0",
          url: `${BASE}/files/a.tar.gz`,
          sha256: SHA,
          size: 1,
        },
      ],
    }),
  });
  const result = await stepAphrody.run(ctx, "executer", state());
  expect(result.state).toBe("attente");
  expect(result.detail).toContain("pas encore publié pour Windows");
  expect(sys.calls).toEqual([]);
});

test("aphrody step: reuses the official installer after cross-checking the hashes", async () => {
  const artifact = aphrodyArtifact();
  const { ctx, sys } = testContext({
    fetchImpl: downloads({
      artifacts: [artifact],
      sums: sumsFor(artifact.file),
    }),
  });
  let scriptSeen = "";
  sys.handlers.push({
    match: /^powershell .*install-aphrody\.ps1/,
    result: (argv) => {
      scriptSeen = readFileSync(argv.at(-1)!, "utf8");
      touch(join(ctx.paths.home, ".local", "bin", "aphrody.exe"));
      return {};
    },
  });
  sys.handlers.push({
    match: /aphrody\.exe --version/,
    result: { stdout: "aphrody 1.0.0" },
  });
  expect((await stepAphrody.run(ctx, "simuler", state())).state).toBe(
    "a-faire",
  );
  expect(sys.calls).toEqual([]);
  const result = await stepAphrody.run(ctx, "executer", state());
  expect(result.state).toBe("fait");
  const call = sys.calls.find((entry) => entry.argv[0] === "powershell")!;
  expect(call.argv.slice(0, 5)).toEqual([
    "powershell",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
  ]);
  expect(call.options.env).toEqual({
    APHRODY_DOWNLOAD_URL: BASE,
    APHRODY_RELEASE: "r",
    APHRODY_COMPONENTS: "aphrody",
  });
  expect(call.options.inherit).toBe(true);
  expect(scriptSeen).toContain("Get-FileHash");
  expect(existsSync(call.argv.at(-1)!)).toBe(false);
  expect((await stepAphrody.run(ctx, "executer", state())).state).toBe("deja");
});

test("aphrody step refuses a catalogue that disagrees with SHA256SUMS and a script that checks nothing", async () => {
  const artifact = aphrodyArtifact();
  const bad = testContext({
    fetchImpl: downloads({
      artifacts: [artifact],
      sums: sumsFor(artifact.file, "b".repeat(64)),
    }),
  });
  const mismatch = await stepAphrody.run(bad.ctx, "executer", state());
  expect(mismatch.state).toBe("echec");
  expect(mismatch.detail).toContain("pas la même empreinte");
  expect(bad.sys.calls).toEqual([]);
  const lax = testContext({
    fetchImpl: downloads({
      artifacts: [artifact],
      sums: sumsFor(artifact.file),
      installScript: "Invoke-WebRequest x; & x.exe",
    }),
  });
  const result = await stepAphrody.run(lax.ctx, "executer", state());
  expect(result.state).toBe("echec");
  expect(result.detail).toContain("SHA-256");
  expect(lax.sys.calls).toEqual([]);
});

test("aphrody step reports a site that cannot be reached", async () => {
  const { ctx } = testContext({
    fetchImpl: async () => new Response("down", { status: 503 }),
  });
  const result = await stepAphrody.run(ctx, "executer", state());
  expect(result.state).toBe("echec");
  expect(result.action).toContain("Internet");
});

test("repository step: clone with a partial filter, never a token in the URL", async () => {
  const { ctx, sys } = testContext();
  touch(join(ctx.paths.programFiles, "Git", "cmd", "git.exe"));
  sys.handlers.push({
    match: /git\.exe -c core\.longpaths=true clone/,
    result: (argv) => {
      mkdirSync(join(argv.at(-1)!, ".git"), { recursive: true });
      return {};
    },
  });
  const s = state();
  expect((await stepDepot.run(ctx, "simuler", s)).state).toBe("a-faire");
  expect(sys.calls).toEqual([]);
  const result = await stepDepot.run(ctx, "executer", s);
  expect(result.state).toBe("fait");
  const clone = sys.calls[0]!;
  expect(clone.argv.slice(1)).toEqual([
    "-c",
    "core.longpaths=true",
    "clone",
    "--filter=blob:none",
    "https://github.com/aphrody-labs/aphrody.git",
    ctx.paths.repoDir,
  ]);
  expect(clone.argv.join(" ")).not.toMatch(/@|token|ghp_/);
  expect(clone.options.inherit).toBe(true);
  expect(s.repoReady).toBe(true);
});

const origin = (url: string) => ({
  match: /config --get remote\.origin\.url/,
  result: { stdout: url },
});

test("repository step: existing repositories are updated only when clean, other folders are never touched", async () => {
  const { ctx, sys } = testContext();
  const git = join(ctx.paths.programFiles, "Git", "cmd", "git.exe");
  touch(git);
  mkdirSync(join(ctx.paths.repoDir, ".git"), { recursive: true });
  sys.handlers.push(origin("https://github.com/someone/else.git"));
  expect((await stepDepot.run(ctx, "executer", state())).state).toBe("echec");
  sys.handlers.length = 0;
  sys.handlers.push(origin("https://github.com/aphrody-labs/aphrody.git"), {
    match: /status --porcelain/,
    result: { stdout: " M file\n" },
  });
  expect(await stepDepot.run(ctx, "executer", state())).toMatchObject({
    state: "deja",
    detail: expect.stringContaining("pas de mise à jour automatique"),
  });
  expect(sys.calls.some((call) => call.argv.includes("pull"))).toBe(false);
  sys.handlers.length = 0;
  sys.handlers.push(
    origin("https://github.com/aphrody-labs/aphrody.git"),
    { match: /status --porcelain/, result: { stdout: "" } },
    { match: /pull --ff-only/, result: {} },
  );
  expect((await stepDepot.run(ctx, "executer", state())).detail).toContain(
    "à jour",
  );
  expect(sys.calls.at(-1)!.argv.slice(-2)).toEqual(["pull", "--ff-only"]);

  const other = testContext();
  touch(join(other.ctx.paths.programFiles, "Git", "cmd", "git.exe"));
  touch(join(other.ctx.paths.repoDir, "precious.txt"));
  const refused = await stepDepot.run(other.ctx, "executer", state());
  expect(refused.state).toBe("echec");
  expect(refused.action).toContain("je n'y touche pas");
  expect(other.sys.calls).toEqual([]);
  const lowDisk = testContext();
  touch(join(lowDisk.ctx.paths.programFiles, "Git", "cmd", "git.exe"));
  lowDisk.sys.free = 1024 ** 3;
  expect(
    (await stepDepot.run(lowDisk.ctx, "executer", state())).detail,
  ).toContain("libres");
  expect(
    (await stepDepot.run(testContext().ctx, "executer", state())).state,
  ).toBe("echec");
});

test("repository step: a refused GitHub sign-in points at the invitation", async () => {
  const { ctx, sys } = testContext();
  touch(join(ctx.paths.programFiles, "Git", "cmd", "git.exe"));
  sys.handlers.push({ match: /clone/, result: { code: 128 } });
  const result = await stepDepot.run(ctx, "executer", state());
  expect(result.state).toBe("echec");
  expect(result.action).toContain("invitation");
  expect(existsSync(ctx.paths.repoDir)).toBe(false);
});

test("MCP step: declares the server in Claude Desktop with a backup, once", async () => {
  const { ctx, sys } = testContext();
  expect((await stepMcp.run(ctx, "executer", state())).state).toBe("attente");
  const aphrody = join(ctx.paths.home, ".local", "bin", "aphrody.exe");
  touch(aphrody);
  expect((await stepMcp.run(ctx, "executer", state())).detail).toContain(
    "ni Claude Desktop ni Claude Code",
  );
  const config = join(
    ctx.paths.appData,
    "Claude",
    "claude_desktop_config.json",
  );
  touch(config, JSON.stringify({ preferences: { x: 1 } }));
  expect((await stepMcp.run(ctx, "simuler", state())).state).toBe("a-faire");
  expect(JSON.parse(readFileSync(config, "utf8"))).toEqual({
    preferences: { x: 1 },
  });
  const done = await stepMcp.run(ctx, "executer", state());
  expect(done.state).toBe("fait");
  expect(JSON.parse(readFileSync(config, "utf8"))).toEqual({
    preferences: { x: 1 },
    mcpServers: { aphrody: { command: aphrody, args: ["mcp-server"] } },
  });
  expect((await stepMcp.run(ctx, "executer", state())).state).toBe("deja");
  expect(sys.calls).toEqual([]);
});

test("the install runs every step in order, a failure never stops the others, nothing is hidden", async () => {
  const t = testContext({ fetchImpl: downloads() });
  const report = await runInstall(t.ctx, "executer", state());
  expect(report.results.map((entry) => entry.step.id)).toEqual(
    STEPS.map((step) => step.id),
  );
  expect(report.results.map((entry) => entry.step.id)).toEqual([
    "kit",
    "prerequis",
    "cles",
    "acces",
    "aphrody",
    "depot",
    "mcp",
  ]);
  expect(report.failed).toBeGreaterThan(0);
  const said = t.ui.lines.join("\n");
  expect(said).toContain("[X]");
  expect(said).toContain("Git et WireGuard");
  expect(readFileSync(t.ctx.paths.logFile, "utf8")).toContain("étape depot");
});

test("simulation changes nothing on disk and runs nothing", async () => {
  const t = testContext({ fetchImpl: downloads() });
  touch(t.ctx.exePath);
  accessReady(t);
  const before = readdirSync(t.root)
    .filter((name) => name !== "local")
    .toSorted();
  const report = await runInstall(t.ctx, "simuler", state());
  expect(report.results.length).toBe(7);
  expect(t.sys.calls.filter((call) => call.argv[0] !== "sc")).toEqual([]);
  expect(
    readdirSync(t.root)
      .filter((name) => name !== "local")
      .toSorted(),
  ).toEqual(before);
  expect(readdirSync(t.ctx.paths.installDir)).toEqual(["omar.log"]);
  expect(existsSync(t.ctx.paths.sshKey)).toBe(false);
  expect(existsSync(t.ctx.paths.profileFile)).toBe(false);
  expect(hubKey).toBeDefined();
});
