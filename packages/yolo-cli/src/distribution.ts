/**
 * Distribution commands of the standalone `yolo` executable: `version`, `doctor`, `runtime ...`,
 * `upgrade`, `uninstall`. They manage the installation under the yolo home
 * (`~/.yolo`: bin/, runtime/, packages/runtime/, templates/, crates/, VERSION), see docs/operations/release/DISTRIBUTION.md.
 */
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  hostTarget,
  loadArtifact,
  runtimeHome,
  verifyArtifact,
} from "@aphrody/runtime-sdk/src/artifact.ts";
import { install, list, rollback } from "@aphrody/runtime-sdk/src/release.ts";
import { Runtime } from "@aphrody/runtime-sdk";
import { embeddedNativeLibraryPath } from "@aphrody/runtime-sdk/ffi";
import { yoloHome, yoloVersion } from "./home";

export const DEFAULT_REPO = "aphrody-labs/yolo";

const ok = (text: string): void => console.log(`  \x1b[32m✔\x1b[0m ${text}`);
const warn = (text: string): void => console.log(`  \x1b[33m!\x1b[0m ${text}`);
const bad = (text: string): void => console.log(`  \x1b[31m✘\x1b[0m ${text}`);

export { runVersion } from "./version";

export {
  collectDoctorReport,
  renderDoctorMarkdown,
  type DoctorComponent,
  type DoctorReport,
} from "@aphrody/yolo-core/src/sys/doctor.ts";
import { collectDoctorReport, renderDoctorMarkdown } from "@aphrody/yolo-core/src/sys/doctor.ts";

/** Checks the installation; returns 1 if something required is missing. */
export function runDoctor(args: readonly string[] = []): number {
  const report = collectDoctorReport();

  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  }

  if (args.includes("--md")) {
    console.log(renderDoctorMarkdown(report));
    return report.ok ? 0 : 1;
  }

  console.log(`\x1b[1myolo doctor\x1b[0m  home ${report.home}`);
  ok(`version ${report.yoloVersion}, target ${report.hostTarget}, Bun ${report.bunVersion}`);

  for (const tool of report.tools) {
    if (tool.found) ok(`${tool.name} on PATH (yolo infra|ops|workflow|ship)`);
    else warn(`${tool.name} not on PATH (Aphrody control plane commands unavailable)`);
  }

  for (const tool of report.codeIntel) {
    if (tool.found) ok(`${tool.name} on PATH (code intelligence / context reduction)`);
    else warn(`${tool.name} not on PATH (run Aphrody toolchain-sync to install)`);
  }

  for (const comp of report.components) {
    if (comp.exists) ok(comp.label);
    else if (comp.required) bad(`${comp.label} missing (${comp.path})`);
    else warn(`${comp.label} not installed: \`yolo create --with desktop\` needs it`);
  }

  if (report.runtime.installed && !report.runtime.error) {
    ok(
      `runtime ${report.runtime.version} (ABI ${report.runtime.abi}, ${report.runtime.active}) verified and loadable`,
    );
    ok(`capabilities: ${(report.runtime.capabilities ?? []).join(", ")}`);
    if (!report.runtime.panicRecovery) warn("runtime built without panic recovery");
  } else {
    bad(`runtime: ${report.runtime.error ?? "not installed"}`);
  }

  if (report.rollbackAvailable) ok(`rollback available: ${report.rollbackAvailable}`);
  const bin = join(report.home, "bin");
  if (report.binOnPath) ok(`${bin} is on PATH`);
  else warn(`${bin} is not on PATH`);

  warn(
    report.ghFound
      ? "gh found (private release downloads)"
      : "gh not found (public releases and GITHUB_TOKEN only)",
  );

  return report.ok ? 0 : 1;
}

export async function runRuntimeCommand(args: readonly string[]): Promise<number> {
  const [command = "list", argument] = args;
  switch (command) {
    case "install": {
      if (argument === undefined) throw new Error("usage: yolo runtime install <artifact-dir>");
      console.log(
        `Installed ${install(resolve(argument))} in ${join(runtimeHome(), hostTarget())}`,
      );
      return 0;
    }
    case "rollback": {
      const result = rollback();
      console.log(`Rolled back: current=${result.current} previous=${result.previous ?? "-"}`);
      return 0;
    }
    case "list":
      for (const e of list()) console.log(`${e.current ? "*" : e.previous ? "-" : " "} ${e.name}`);
      return 0;
    case "verify": {
      const current = list().find((e) => e.current);
      if (current === undefined) throw new Error("No installed artifact");
      const manifest = verifyArtifact(join(runtimeHome(), hostTarget(), current.name));
      console.log(`OK ${manifest.name} ${manifest.version} ABI ${manifest.abi} (${current.name})`);
      return 0;
    }
    case "info": {
      using runtime =
        !args.includes("--installed") && embeddedNativeLibraryPath("aphrody_ffi") !== null
          ? Runtime.load()
          : loadArtifact(join(runtimeHome(), hostTarget(), "current"));
      console.log(
        JSON.stringify(
          { build: runtime.buildInfo(), capabilities: runtime.capabilities() },
          null,
          2,
        ),
      );
      return 0;
    }
    default:
      console.error(
        "usage: yolo runtime install <dir> | list | verify | rollback | info [--installed]",
      );
      return 1;
  }
}

async function githubToken(): Promise<string | undefined> {
  const fromEnv = process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"];
  if (fromEnv) return fromEnv;
  if (!Bun.which("gh")) return undefined;
  const proc = Bun.spawn(["gh", "auth", "token"], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "ignore",
    timeout: 5_000,
  });
  const out = (await new Response(proc.stdout).text()).trim();
  return (await proc.exited) === 0 && out !== "" ? out : undefined;
}

interface ReleaseAsset {
  readonly name: string;
  readonly url: string;
}

const VERSION_PATTERN =
  /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function validVersion(value: string): boolean {
  const match = value.match(VERSION_PATTERN);
  return match !== null && !(match[1]?.split(".").some((part) => /^0\d+$/.test(part)) ?? false);
}

async function githubRelease(
  repo: string,
  wanted: string | undefined,
  token: string | undefined,
): Promise<{ tag: string; assets: ReleaseAsset[] }> {
  const selector = wanted === undefined ? "latest" : `tags/${encodeURIComponent(wanted)}`;
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/${selector}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "yolo-cli",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(
      `cannot read release ${wanted ?? "latest"} of ${repo}: HTTP ${response.status}`,
    );
  const json = (await response.json()) as { tag_name?: unknown; assets?: unknown };
  if (typeof json.tag_name !== "string" || !validVersion(json.tag_name)) {
    throw new Error("Invalid release metadata: expected a semantic version tag");
  }
  if (wanted !== undefined && json.tag_name !== wanted) {
    throw new Error(`Requested release ${wanted}, received ${json.tag_name}`);
  }
  if (
    !Array.isArray(json.assets) ||
    !json.assets.every(
      (asset: unknown) =>
        asset !== null &&
        typeof asset === "object" &&
        "name" in asset &&
        typeof asset.name === "string" &&
        "url" in asset &&
        typeof asset.url === "string",
    )
  ) {
    throw new Error("Invalid release metadata: expected named assets");
  }
  return { tag: json.tag_name, assets: json.assets as ReleaseAsset[] };
}

async function githubAsset(
  assets: readonly ReleaseAsset[],
  name: string,
  repo: string,
  token: string | undefined,
): Promise<Uint8Array> {
  const matches = assets.filter((asset) => asset.name === name);
  if (matches.length !== 1) throw new Error(`Release must contain exactly one ${name} asset`);
  const asset = matches[0] as ReleaseAsset;
  const url = new URL(asset.url);
  // Credentials belong only to GitHub's asset API, even if release metadata is malformed.
  if (
    url.origin !== "https://api.github.com" ||
    !url.pathname.toLowerCase().startsWith(`/repos/${repo.toLowerCase()}/releases/assets/`) ||
    !/^\d+$/.test(url.pathname.split("/").at(-1) ?? "") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`Invalid GitHub asset URL for ${name}`);
  }
  const response = await fetch(url, {
    headers: {
      accept: "application/octet-stream",
      "user-agent": "yolo-cli",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`cannot download ${name}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function offlineVersion(dir: string): string {
  let metadata: unknown;
  try {
    metadata = JSON.parse(readFileSync(join(dir, "release.json"), "utf8"));
  } catch {
    throw new Error(`Cannot read valid release.json in ${dir}`);
  }
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    !("version" in metadata) ||
    typeof metadata.version !== "string" ||
    !validVersion(metadata.version) ||
    ("name" in metadata && metadata.name !== "yolo")
  ) {
    throw new Error(`Invalid release.json in ${dir}: expected a yolo semantic version`);
  }
  return metadata.version;
}

function verifyInstaller(script: Uint8Array, sums: string, name: string): void {
  const entries: string[] = [];
  for (const line of sums.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const match = line.match(/^([0-9a-fA-F]{64})[ \t]+\*?(.+)$/);
    if (match === null) throw new Error("Invalid SHA256SUMS entry");
    if (match[2] === name) entries.push((match[1] as string).toLowerCase());
  }
  if (entries.length !== 1) throw new Error(`SHA256SUMS must contain exactly one ${name} entry`);
  const hash = new Bun.CryptoHasher("sha256").update(script).digest("hex");
  if (hash !== entries[0]) throw new Error(`Checksum mismatch for ${name}`);
}

function compareVersions(a: string, b: string): number {
  return Bun.semver.order(a.replace(/^v/, ""), b.replace(/^v/, ""));
}

/**
 * `yolo upgrade [--check] [--repo owner/name] [--version vX.Y.Z] [--release-dir DIR]`:
 * verifies and runs the selected release's installer. An explicit offline directory reinstalls that release
 * even when its version matches; --check compares versions without executing or qualifying its artifacts.
 * Windows self-replacement remains unqualified: on win32 the installer replaces
 * `bin/yolo.exe` while this very process is that executable, which Windows can refuse (the running file is
 * locked). install.ps1 replaces it the same `.new` + rename way install.sh does, which helps, but a locked
 * executable specifically still needs a detached helper that waits for this process to exit first.
 */
export async function runUpgrade(args: readonly string[]): Promise<number> {
  let repo = process.env["YOLO_REPO"] ?? DEFAULT_REPO;
  let checkOnly = false;
  let wanted: string | undefined;
  let releaseDir = process.env["YOLO_RELEASE_DIR"] || undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const value = (): string => {
      const result = args[++i];
      if (result === undefined || result.trim() === "" || result.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      return result;
    };
    if (arg === "--check") checkOnly = true;
    else if (arg === "--repo") repo = value();
    else if (arg === "--version") wanted = value();
    else if (arg === "--release-dir") releaseDir = resolve(value());
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("--repo must be owner/name");
  }
  if (wanted !== undefined && !validVersion(wanted)) {
    throw new Error("--version must be a semantic version such as v1.2.3");
  }
  if (releaseDir !== undefined) releaseDir = resolve(releaseDir);
  let token: string | undefined;
  let tag: string;
  let assets: readonly ReleaseAsset[] = [];
  if (releaseDir === undefined) {
    token = await githubToken();
    const release = await githubRelease(repo, wanted, token);
    tag = release.tag;
    assets = release.assets;
  } else {
    tag = offlineVersion(releaseDir);
  }
  if (wanted !== undefined && wanted.replace(/^v/, "") !== tag.replace(/^v/, "")) {
    throw new Error(`Requested version ${wanted} does not match offline release ${tag}`);
  }
  const current = yoloVersion();
  console.log(`installed ${current}, available ${tag}`);
  if (checkOnly) return compareVersions(tag, current) > 0 ? 10 : 0;
  if (wanted === undefined && releaseDir === undefined && compareVersions(tag, current) <= 0) {
    console.log("Already up to date.");
    return 0;
  }
  // Windows has no `sh`: re-run install.ps1 under PowerShell (pwsh if present, else the built-in powershell.exe).
  const installerName = process.platform === "win32" ? "install.ps1" : "install.sh";
  const [script, checksums] =
    releaseDir === undefined
      ? await Promise.all([
          githubAsset(assets, installerName, repo, token),
          githubAsset(assets, "SHA256SUMS", repo, token),
        ])
      : [
          new Uint8Array(readFileSync(join(releaseDir, installerName))),
          new Uint8Array(readFileSync(join(releaseDir, "SHA256SUMS"))),
        ];
  verifyInstaller(script, new TextDecoder().decode(checksums), installerName);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    YOLO_VERSION: tag,
    YOLO_REPO: repo,
    YOLO_HOME: yoloHome(),
  };
  if (releaseDir !== undefined) env["YOLO_RELEASE_DIR"] = releaseDir;
  const command =
    process.platform === "win32"
      ? [Bun.which("pwsh") ?? "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "-"]
      : ["sh", "-s", "--"];
  const proc = Bun.spawn(command, {
    windowsHide: true,
    stdin: script,
    stdout: "inherit",
    stderr: "inherit",
    env,
  });
  return await proc.exited;
}

/** `yolo uninstall [--yes]`: removes the installation directory (never anything else). */
export function runUninstall(args: readonly string[]): number {
  const home = yoloHome();
  const guarded = new Set([resolve("/"), resolve(homedir()), resolve(homedir(), "..")]);
  if (guarded.has(home) || !existsSync(join(home, "VERSION")) || !existsSync(join(home, "bin"))) {
    console.error(`Refusing to remove ${home}: it does not look like a yolo installation`);
    return 1;
  }
  const entries = readdirSync(home);
  if (!args.includes("--yes")) {
    console.log(
      `This removes ${home} (${entries.join(", ")}), including installed runtime artifacts.`,
    );
    console.log(
      "Re-run with --yes to confirm. Remove the PATH line from your shell profile afterwards.",
    );
    return 1;
  }
  rmSync(home, { recursive: true, force: true });
  console.log(`Removed ${home}. Remove the PATH line from your shell profile.`);
  return 0;
}
