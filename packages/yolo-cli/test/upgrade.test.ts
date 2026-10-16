import { afterAll, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const work = mkdtempSync(join(tmpdir(), "yolo-upgrade-"));
const modulePath = resolve(import.meta.dir, "../src/distribution.ts");
const installerName =
  process.platform === "win32" ? "install.ps1" : "install.sh";
const installer =
  process.platform === "win32"
    ? 'Set-Content -Path (Join-Path $env:YOLO_HOME "upgrade.marker") -Value @($env:YOLO_VERSION, $env:YOLO_RELEASE_DIR, $env:YOLO_REPO)\n'
    : 'printf "%s\\n" "$YOLO_VERSION" "$YOLO_RELEASE_DIR" "$YOLO_REPO" > "$YOLO_HOME/upgrade.marker"\n';
let sequence = 0;

afterAll(() =>
  rmSync(work, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  }),
);

function fixture(version = "2.0.0", current = "1.0.0") {
  const dir = join(work, `case-${sequence++}`);
  const release = join(dir, "release");
  const home = join(dir, "home");
  mkdirSync(release, { recursive: true });
  mkdirSync(home);
  writeFileSync(join(home, "VERSION"), `${current}\n`);
  writeFileSync(
    join(release, "release.json"),
    JSON.stringify({ name: "yolo", version }),
  );
  writeFileSync(join(release, installerName), installer);
  const hash = new Bun.CryptoHasher("sha256").update(installer).digest("hex");
  writeFileSync(join(release, "SHA256SUMS"), `${hash}  ${installerName}\n`);
  return { dir, release, home, marker: join(home, "upgrade.marker") };
}

function run(
  entry: ReturnType<typeof fixture>,
  args: string[],
  options: { releaseEnv?: string; mockRemote?: string } = {},
) {
  const source = `
${options.mockRemote ?? 'globalThis.fetch = async () => { throw new Error("UNEXPECTED_NETWORK"); };'}
import { runUpgrade } from ${JSON.stringify(modulePath)};
runUpgrade(${JSON.stringify(args)}).then(code => { process.exitCode = code; }).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
`;
  return Bun.spawnSync([process.execPath, "--eval", source], {
    windowsHide: true,
    cwd: entry.dir,
    env: {
      PATH: process.env["PATH"] ?? "",
      ...(process.platform === "win32"
        ? { SystemRoot: process.env["SystemRoot"] }
        : {}),
      HOME: entry.home,
      YOLO_HOME: entry.home,
      YOLO_REPO: "aphrody-labs/yolo",
      YOLO_RELEASE_DIR: options.releaseEnv ?? "",
      GITHUB_TOKEN: "fixture-token",
      GH_TOKEN: "",
    },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5_000,
  });
}

function remoteMock(
  tag: string,
  options: { tampered?: boolean; foreignUrl?: boolean } = {},
): string {
  const scriptUrl = options.foreignUrl
    ? "https://untrusted.invalid/install.sh"
    : "https://api.github.com/repos/aphrody-labs/yolo/releases/assets/1";
  const sumsUrl =
    "https://api.github.com/repos/aphrody-labs/yolo/releases/assets/2";
  const hash = new Bun.CryptoHasher("sha256").update(installer).digest("hex");
  return `
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (new Headers(init?.headers).get("authorization") !== "Bearer fixture-token") {
    throw new Error("Missing fixture authentication");
  }
  console.log("FETCH " + url);
  if (url === ${JSON.stringify(`https://api.github.com/repos/aphrody-labs/yolo/releases/tags/${tag}`)}) {
    return Response.json({tag_name: ${JSON.stringify(tag)}, assets: [
      {name: ${JSON.stringify(installerName)}, url: ${JSON.stringify(scriptUrl)}},
      {name: "SHA256SUMS", url: ${JSON.stringify(sumsUrl)}}
    ]});
  }
  if (url === ${JSON.stringify(scriptUrl)} && !${options.foreignUrl ?? false}) {
    return new Response(${JSON.stringify(options.tampered ? `${installer}\n# tampered` : installer)});
  }
  if (url === ${JSON.stringify(sumsUrl)}) return new Response(${JSON.stringify(`${hash}  ${installerName}\n`)});
  throw new Error("Unexpected remote request: " + url);
};
`;
}

describe("verified native upgrade", () => {
  it("checks offline availability without network or executing the installer", () => {
    const entry = fixture();
    const result = run(entry, ["--release-dir", entry.release, "--check"]);
    expect(result.exitCode).toBe(10);
    expect(result.stdout.toString()).toContain(
      "installed 1.0.0, available 2.0.0",
    );
    expect(existsSync(entry.marker)).toBe(false);
  });

  it("runs the checksum-verified offline installer with the selected release and installation", () => {
    const entry = fixture();
    const result = run(entry, ["--release-dir", entry.release]);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(entry.marker, "utf8").trim().split(/\r?\n/)).toEqual([
      "2.0.0",
      entry.release,
      "aphrody-labs/yolo",
    ]);
  });

  it("honors YOLO_RELEASE_DIR and reinstalls an explicitly selected same-version release", () => {
    const entry = fixture("1.0.0");
    expect(
      run(entry, ["--check"], { releaseEnv: entry.release }).exitCode,
    ).toBe(0);
    expect(existsSync(entry.marker)).toBe(false);
    expect(run(entry, [], { releaseEnv: entry.release }).exitCode).toBe(0);
    expect(existsSync(entry.marker)).toBe(true);
  });

  it("rejects a tampered installer, missing hash and duplicate hashes before execution", () => {
    const tampered = fixture();
    writeFileSync(
      join(tampered.release, installerName),
      `${installer}\n# tampered`,
    );
    const result = run(tampered, ["--release-dir", tampered.release]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      `Checksum mismatch for ${installerName}`,
    );
    expect(existsSync(tampered.marker)).toBe(false);

    const missing = fixture();
    writeFileSync(
      join(missing.release, "SHA256SUMS"),
      `${"0".repeat(64)}  other-asset\n`,
    );
    expect(run(missing, ["--release-dir", missing.release]).exitCode).toBe(1);
    expect(existsSync(missing.marker)).toBe(false);

    const duplicate = fixture();
    const sums = readFileSync(join(duplicate.release, "SHA256SUMS"), "utf8");
    writeFileSync(join(duplicate.release, "SHA256SUMS"), `${sums}${sums}`);
    expect(run(duplicate, ["--release-dir", duplicate.release]).exitCode).toBe(
      1,
    );
    expect(existsSync(duplicate.marker)).toBe(false);
  });

  it("rejects missing or malformed offline release metadata and checksum manifests", () => {
    for (const data of [
      "{",
      "null",
      "{}",
      '{"version":"invalid"}',
      '{"version":"1.2.3-.."}',
      '{"version":"1.2.3-01"}',
      '{"name":"other","version":"2.0.0"}',
    ]) {
      const entry = fixture();
      writeFileSync(join(entry.release, "release.json"), data);
      expect(run(entry, ["--release-dir", entry.release]).exitCode).toBe(1);
      expect(existsSync(entry.marker)).toBe(false);
    }
    const missing = fixture();
    rmSync(join(missing.release, "release.json"));
    expect(run(missing, ["--release-dir", missing.release]).exitCode).toBe(1);
    expect(existsSync(missing.marker)).toBe(false);
    const malformed = fixture();
    writeFileSync(
      join(malformed.release, "SHA256SUMS"),
      "not a checksum manifest\n",
    );
    expect(run(malformed, ["--release-dir", malformed.release]).exitCode).toBe(
      1,
    );
    expect(existsSync(malformed.marker)).toBe(false);
  });

  it("rejects missing option values, unknown flags and mismatched offline versions", () => {
    for (const args of [
      ["--release-dir"],
      ["--repo"],
      ["--version"],
      ["--version", "--check"],
      ["--unknown"],
      ["--version", "bad"],
      ["--repo", "invalid"],
    ]) {
      const entry = fixture();
      expect(run(entry, args).exitCode).toBe(1);
      expect(existsSync(entry.marker)).toBe(false);
    }
    const mismatch = fixture();
    const result = run(mismatch, [
      "--release-dir",
      mismatch.release,
      "--version",
      "v3.0.0",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "does not match offline release",
    );
    expect(existsSync(mismatch.marker)).toBe(false);
  });

  it("compares prerelease versions through native Bun semver", () => {
    const entry = fixture("1.0.0", "1.0.0-rc.1");
    expect(
      run(entry, ["--release-dir", entry.release, "--check"]).exitCode,
    ).toBe(10);
    expect(existsSync(entry.marker)).toBe(false);
  });

  it("fetches the explicitly requested tag and verifies its installer before execution", () => {
    const entry = fixture();
    const result = run(entry, ["--version", "v2.0.0"], {
      mockRemote: remoteMock("v2.0.0"),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("/releases/tags/v2.0.0");
    expect(result.stdout.toString()).not.toContain("/releases/latest");
    expect(result.stdout.toString()).not.toContain("fixture-token");
    expect(readFileSync(entry.marker, "utf8").split(/\r?\n/)[0]).toBe("v2.0.0");
  });

  it("rejects remote installer tampering and foreign credential destinations", () => {
    const entry = fixture();
    const result = run(entry, ["--version", "v2.0.0"], {
      mockRemote: remoteMock("v2.0.0", { tampered: true }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      `Checksum mismatch for ${installerName}`,
    );
    expect(existsSync(entry.marker)).toBe(false);

    const foreign = fixture();
    const denied = run(foreign, ["--version", "v2.0.0"], {
      mockRemote: remoteMock("v2.0.0", { foreignUrl: true }),
    });
    expect(denied.exitCode).toBe(1);
    expect(denied.stderr.toString()).toContain("Invalid GitHub asset URL");
    expect(denied.stdout.toString()).not.toContain(
      "FETCH https://untrusted.invalid",
    );
    expect(existsSync(foreign.marker)).toBe(false);
  });
});
