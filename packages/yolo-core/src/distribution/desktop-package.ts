/**
 * Packages an actual desktop host: the executable plus the CEF payload it loads from its own directory.
 * Run through the native Yolo desktop-runtime package owner; engine compilation is a separate serialized
 * factory step (the CEF distribution is copied next to the executable by the `cef-dll-sys` build script).
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  inspectDesktopBinary,
  writeDesktopManifest,
} from "@aphrody/runtime-sdk/desktop-artifact";
import { cefNotice, cefPayload, strippedInArtifact } from "./cef-payload";

/** Runs `strip` on a copy. Fails loudly: an unstripped libcef.so is 1.4 GB. */
export function stripLibrary(copy: string): void {
  const strip = Bun.which("strip");
  if (strip === null) {
    throw new Error(
      "`strip` (binutils) is required to package the CEF libraries; pass --no-strip",
    );
  }
  const reply = Bun.spawnSync([strip, copy], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  });
  if (reply.exitCode !== 0) {
    throw new Error(
      `strip failed on ${copy}: ${new TextDecoder().decode(reply.stderr).slice(0, 512)}`,
    );
  }
}

export function packageDesktop(options: {
  root: string;
  executable?: string;
  output?: string;
  allowDirty?: boolean;
  /** Directory of the CEF binary distribution; defaults to the executable's own directory. */
  cefDir?: string;
  /** Skip stripping the CEF libraries (a larger artifact, for hosts without binutils). */
  strip?: boolean;
}): string {
  const root = resolve(options.root);
  const git = (args: string[]): string => {
    const reply = Bun.spawnSync(["git", ...args], {
      windowsHide: true,
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });
    if (reply.exitCode !== 0)
      throw new Error("Desktop source provenance command failed");
    return new TextDecoder().decode(reply.stdout).trim();
  };
  const executable = resolve(
    options.executable ??
      join(
        root,
        "target/runtime",
        process.platform === "win32" ? "aphrody-app.exe" : "aphrody-app",
      ),
  );
  const info = inspectDesktopBinary(executable);
  if (info.git_rev !== git(["rev-parse", "HEAD"])) {
    throw new Error(
      "Desktop host was built from another revision; rebuild on the serialized factory",
    );
  }
  const dirty = git(["status", "--porcelain", "--untracked-files=all"]) !== "";
  if (dirty && options.allowDirty !== true)
    throw new Error(
      "Desktop source is dirty; commit qualified owned sources before packaging",
    );
  const cefDir = resolve(options.cefDir ?? dirname(executable));
  const payload = cefPayload(info.target, cefDir);
  const output = resolve(
    options.output ?? join(root, "dist/desktop", info.target),
  );
  mkdirSync(dirname(output), { recursive: true });
  if (existsSync(output)) {
    throw new Error(
      "Desktop artifact destination already exists; choose a new owned output directory",
    );
  }
  const staging = mkdtempSync(join(dirname(output), ".desktop-artifact-"));
  try {
    const manifest = writeDesktopManifest(staging, executable, dirty, {
      notices: {
        "THIRD-PARTY.md": join(root, "THIRD-PARTY.md"),
        "LICENSE-tauri-APACHE": join(
          root,
          "crates/tauri/aphrody-tauri/LICENSE-APACHE-2.0",
        ),
        "LICENSE-tauri-MIT": join(
          root,
          "crates/tauri/aphrody-tauri/LICENSE-MIT",
        ),
        ...cefNotice(cefDir),
      },
      payload,
      transform: (copy, name) => {
        if (options.strip !== false && strippedInArtifact(info.target, name))
          stripLibrary(copy);
      },
    });
    // The manifest itself is also pinned by the surrounding release SHA256SUMS owner.
    const manifestSha256 = new Bun.CryptoHasher("sha256")
      .update(readFileSync(join(staging, "manifest.json")))
      .digest("hex");
    renameSync(staging, output);
    console.log(
      JSON.stringify({
        protocol: manifest.protocol,
        artifact: output,
        target: manifest.target,
        source: manifest.source,
        engine: manifest.build.engine,
        files: Object.keys(manifest.files).length,
        bytes: Object.values(manifest.files).reduce(
          (sum, file) => sum + file.bytes,
          0,
        ),
        manifestSha256,
      }),
    );
    return output;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
